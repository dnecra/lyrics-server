const path = require('path');
const fsp = require('fs').promises;
const { logEvent } = require('./logger');

// --- Config ---

const CACHE_DIR = path.resolve(process.env.LYRICS_DIR || 'C:\\temp\\lyrics');
const MAX_MEMORY_ENTRIES = Number(process.env.ROMANIZATION_INMEMORY_MAX_ENTRIES || 300);

// --- Unicode script detection (no deps, instant) ---

const hasJapanese = (t) => /[\u3040-\u30FF\u31F0-\u31FF]/.test(t);
const hasKorean   = (t) => /[\uAC00-\uD7A3\u1100-\u11FF]/.test(t);
const hasChinese  = (t) => /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(t);

function detectCjkScript(text) {
    if (hasJapanese(text)) return 'ja';
    if (hasKorean(text))   return 'ko';
    if (hasChinese(text))  return 'zh';
    return null;
}

function isRomanizable(text) {
    return !!detectCjkScript(text);
}

// --- tinyld (Latin-script non-English detection only) ---

let tinyldDetect = null;
function detectLatinLang(text) {
    if (!tinyldDetect) {
        try {
            const m = require('tinyld');
            tinyldDetect = m?.detect ?? (typeof m === 'function' ? m : null);
        } catch (_) {}
    }
    try { return typeof tinyldDetect === 'function' ? tinyldDetect(text) : null; } catch (_) { return null; }
}

// --- Kuroshiro (Japanese) — lazy load, idle unload ---

const kuroshiro = {
    instance: null,
    initPromise: null,
    initFailed: false,
    idleTimer: null
};

async function getKuroshiro() {
    if (kuroshiro.instance) return kuroshiro.instance;
    if (kuroshiro.initFailed) return null;
    if (kuroshiro.initPromise) return kuroshiro.initPromise;

    let KuroshiroCtor, KuromojiAnalyzerCtor;
    try { const m = require('kuroshiro'); KuroshiroCtor = m?.default ?? m?.Kuroshiro ?? m; } catch (_) {}
    try { const m = require('kuroshiro-analyzer-kuromoji'); KuromojiAnalyzerCtor = m?.default ?? m?.KuromojiAnalyzer ?? m; } catch (_) {}

    if (typeof KuroshiroCtor !== 'function') {
        logEvent('warn', 'ROMANIZATION', `kuroshiro not installed — run: npm install kuroshiro kuroshiro-analyzer-kuromoji kuromoji`);
        kuroshiro.initFailed = true;
        return null;
    }
    if (typeof KuromojiAnalyzerCtor !== 'function') {
        logEvent('warn', 'ROMANIZATION', `kuroshiro-analyzer-kuromoji not installed`);
        kuroshiro.initFailed = true;
        return null;
    }

    kuroshiro.initPromise = (async () => {
        try {
            const instance = new KuroshiroCtor();
            let dictPath;
            try {
                dictPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
            } catch (_) {
                dictPath = path.join(__dirname, '..', 'node_modules', 'kuromoji', 'dict');
            }
            logEvent('info', 'ROMANIZATION', `Initializing Kuroshiro (dict: ${dictPath})`);
            await instance.init(new KuromojiAnalyzerCtor({ dictPath }));
            kuroshiro.instance = instance;
            kuroshiro.initPromise = null;
            logEvent('success', 'ROMANIZATION', `Kuroshiro ready`);
            return instance;
        } catch (err) {
            kuroshiro.initFailed = true;
            kuroshiro.initPromise = null;
            logEvent('error', 'ROMANIZATION', `Kuroshiro init failed: ${err.message}`);
            return null;
        }
    })();

    return kuroshiro.initPromise;
}

// --- Per-script romanization ---

async function romanizeJapanese(text) {
    const k = await getKuroshiro();
    if (!k) return text;
    try {
        const out = await k.convert(text, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' });
        return (typeof out === 'string' && out.trim()) ? out : text;
    } catch (err) {
        logEvent('warn', 'ROMANIZATION', `convert() failed: ${err.message}`);
        return text;
    }
}

function romanizeKorean(text) {
    let fn;
    try { fn = require('es-hangul')?.romanize ?? null; } catch (_) {}
    if (!fn) {
        logEvent('warn', 'ROMANIZATION', `es-hangul not installed — run: npm install es-hangul`);
        return text;
    }
    try { return fn(text) || text; } catch (_) { return text; }
}

function romanizeChinese(text) {
    let pinyinFn;
    try { pinyinFn = require('pinyin-pro')?.pinyin ?? null; } catch (_) {}
    if (!pinyinFn) {
        logEvent('warn', 'ROMANIZATION', `pinyin-pro not installed — run: npm install pinyin-pro`);
        return text;
    }
    try {
        return text.replace(/[\u4E00-\u9FFF\u3400-\u4DBF]+/g, (seg) => {
            try { return pinyinFn(seg, { toneType: 'none' }) || seg; } catch (_) { return seg; }
        });
    } catch (_) { return text; }
}

async function romanizeLine(text) {
    const script = detectCjkScript(text);
    if (!script) return text;
    if (script === 'ja') return romanizeJapanese(text);
    if (script === 'ko') return romanizeKorean(text);
    if (script === 'zh') return romanizeChinese(text);
    return text;
}

// --- LRC processing ---

function stripTimingTags(text) {
    return (text || '').replace(/<\d+:\d+\.\d+>/g, '');
}

async function romanizeSyncedLyrics(lrcText) {
    const lines = lrcText.replace(/\r\n?/g, '\n').split('\n');
    const romanized = await Promise.all(lines.map(async (line) => {
        const match = line.match(/^(\[\d+:\d+\.\d+\]\s*)(.*)/);
        if (!match) return line;
        const tag = match[1];
        const lyric = stripTimingTags(match[2] || '').trim();
        if (!lyric) return line;
        return `${tag}${await romanizeLine(lyric)}`;
    }));

    // Unload immediately after job — no reason to hold RAM
    if (kuroshiro.instance) {
        logEvent('info', 'ROMANIZATION', `Unloading Kuroshiro`);
        if (kuroshiro.idleTimer) clearTimeout(kuroshiro.idleTimer);
        kuroshiro.idleTimer = null;
        kuroshiro.instance = null;
        kuroshiro.initFailed = false; // allow reinit next time
    }

    return romanized.join('\n');
}

// --- Disk + memory cache ---

const memoryCache = new Map();

function safeCacheKey(value) {
    return String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 240);
}

function cachePath(videoId) {
    return path.join(CACHE_DIR, `${safeCacheKey(videoId)}.romanized.json`);
}

function pruneMemory() {
    if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;
    const sorted = [...memoryCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (const [key] of sorted.slice(0, memoryCache.size - MAX_MEMORY_ENTRIES)) {
        memoryCache.delete(key);
    }
}

async function readCache(videoId) {
    const mem = memoryCache.get(videoId);
    if (mem) return mem.data;
    try {
        const parsed = JSON.parse(await fsp.readFile(cachePath(videoId), 'utf8'));
        if (parsed?.data) {
            memoryCache.set(videoId, { ts: parsed.timestamp || Date.now(), data: parsed.data });
            pruneMemory();
            return parsed.data;
        }
    } catch (_) {}
    return null;
}

async function writeCache(videoId, data) {
    memoryCache.set(videoId, { ts: Date.now(), data });
    pruneMemory();
    try {
        await fsp.mkdir(CACHE_DIR, { recursive: true });
        const file = cachePath(videoId);
        const tmp = `${file}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify({ timestamp: Date.now(), data }, null, 2) + '\n', 'utf8');
        await fsp.rename(tmp, file);
    } catch (_) {}
}

// --- Public API ---

/**
 * Returns romanized synced lyrics string, or null if not needed / not possible.
 */
async function getRomanizedLyrics(videoId, syncedLyrics) {
    const plainText = syncedLyrics
        .replace(/\[\d+:\d+\.\d+\]/g, '')
        .replace(/<\d+:\d+\.\d+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!isRomanizable(plainText)) return null;

    const cached = await readCache(videoId);
    if (cached?.romanizedLyrics) {
        logEvent('info', 'ROMANIZATION', `Cache hit for ${videoId}`);
        return cached.romanizedLyrics;
    }

    logEvent('info', 'ROMANIZATION', `Romanizing ${detectCjkScript(plainText)} lyrics for ${videoId}`);
    const result = await romanizeSyncedLyrics(syncedLyrics);

    if (result === syncedLyrics) {
        logEvent('warn', 'ROMANIZATION', `Output unchanged — check Kuroshiro/deps are installed correctly`);
        return null;
    }

    await writeCache(videoId, { romanizedLyrics: result });
    return result;
}

module.exports = { getRomanizedLyrics, isRomanizable, romanizeLine, hasJapanese, hasKorean, hasChinese, detectCjkScript, detectLatinLang };
