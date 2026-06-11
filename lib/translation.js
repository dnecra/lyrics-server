const path = require('path');
const fsp = require('fs').promises;
const axios = require('axios');
const { logEvent } = require('./logger');
const { detectCjkScript, detectLatinLang } = require('./romanization');

// --- Config ---

const CACHE_DIR = path.resolve(process.env.LYRICS_DIR || 'C:\\temp\\lyrics');
const TRANSLATE_TIMEOUT_MS = 8000;
const CHUNK_MAX_CHARS = 1200;

// --- Language detection ---

// Strip LRC/word-timing tags and get plain lyric text
function plainLyricText(lrcText) {
    return (lrcText || '')
        .replace(/\[\d+:\d+\.\d+\]/g, '')
        .replace(/<\d+:\d+\.\d+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isNonEnglish(text) {
    // CJK is always non-English — no need for tinyld
    if (detectCjkScript(text)) return true;

    // For Latin scripts, use tinyld
    const lang = detectLatinLang(text);
    if (!lang) return false;
    return !['en', 'eng'].includes(lang.toLowerCase());
}

function getTranslationLanguageInfo(syncedLyrics) {
    const plain = plainLyricText(syncedLyrics);
    if (!plain) {
        return {
            detectedLanguage: '',
            isNonEnglish: false
        };
    }

    const detectedLanguage = detectCjkScript(plain) || detectLatinLang(plain) || '';
    return {
        detectedLanguage: String(detectedLanguage || '').trim().toLowerCase(),
        isNonEnglish: isNonEnglish(plain)
    };
}

// --- Google Translate (unofficial) ---

async function translateChunk(text) {
    if (!text.trim()) return '';
    try {
        const res = await axios.get('https://translate.googleapis.com/translate_a/single', {
            params: { client: 'gtx', sl: 'auto', tl: 'en', dt: 't', q: text },
            timeout: TRANSLATE_TIMEOUT_MS,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const data = res?.data;
        if (!Array.isArray(data?.[0])) return '';
        const out = data[0].map((p) => Array.isArray(p) ? p[0] || '' : '').join('').trim();
        // If translation == input, Google didn't actually translate it
        return out.toLowerCase() === text.toLowerCase() ? '' : out;
    } catch (_) { return ''; }
}

// Batch lines into chunks to minimise API calls
async function translateLines(lines) {
    const results = new Array(lines.length).fill('');
    const chunks = [];
    let cur = { lines: [], indices: [], len: 0 };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (cur.len + line.length + 1 > CHUNK_MAX_CHARS && cur.lines.length > 0) {
            chunks.push(cur);
            cur = { lines: [], indices: [], len: 0 };
        }
        cur.lines.push(line);
        cur.indices.push(i);
        cur.len += line.length + 1;
    }
    if (cur.lines.length > 0) chunks.push(cur);

    for (const chunk of chunks) {
        const translated = await translateChunk(chunk.lines.join('\n'));
        if (!translated) continue;
        const translatedLines = translated.split('\n');
        chunk.indices.forEach((idx, pos) => {
            results[idx] = (translatedLines[pos] || '').trim();
        });
    }

    return results;
}

// --- LRC parsing ---

function parseLrcLines(lrcText) {
    return lrcText.replace(/\r\n?/g, '\n').split('\n').map((line, sourceIndex) => {
        const match = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/);
        if (!match) return null;
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms  = parseInt(match[3], 10);
        const divisor = match[3].length === 3 ? 1000 : 100;
        const text = (match[4] || '').replace(/<\d+:\d+\.\d+>/g, '').trim();
        return { time: min * 60 + sec + ms / divisor, text, sourceIndex };
    }).filter(Boolean);
}

// --- Cache ---

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
    return path.join(CACHE_DIR, `${safeCacheKey(videoId)}.translated.en.json`);
}

async function readCache(videoId) {
    const mem = memoryCache.get(videoId);
    if (mem) return mem;
    try {
        const parsed = JSON.parse(await fsp.readFile(cachePath(videoId), 'utf8'));
        if (parsed?.data) {
            memoryCache.set(videoId, parsed);
            return parsed;
        }
    } catch (_) {}
    return null;
}

async function writeCache(videoId, data) {
    const entry = { timestamp: Date.now(), data };
    memoryCache.set(videoId, entry);
    try {
        await fsp.mkdir(CACHE_DIR, { recursive: true });
        const file = cachePath(videoId);
        const tmp = `${file}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(entry, null, 2) + '\n', 'utf8');
        await fsp.rename(tmp, file);
    } catch (_) {}
}

// --- Public API ---

/**
 * Returns translated lines array or null if lyrics are English / nothing to translate.
 * Shape: Array of { time, text, sourceIndex }
 */
async function getTranslatedLyrics(videoId, syncedLyrics, options = {}) {
    const plain = plainLyricText(syncedLyrics);
    if (!plain || !isNonEnglish(plain)) return null;

    // Check excluded languages
    const excluded = (options.excludedLanguages || []).map((l) => l.toLowerCase());
    const detectedLanguage = getTranslationLanguageInfo(syncedLyrics).detectedLanguage;
    if (excluded.length > 0) {
        if (detectedLanguage && excluded.includes(detectedLanguage)) {
            logEvent('info', 'TRANSLATION', `Skipping ${videoId} - excluded language: ${detectedLanguage}`);
            return null;
        }
    }

    const cached = await readCache(videoId);
    if (cached?.data?.translatedLines) {
        logEvent('info', 'TRANSLATION', `Cache hit for ${videoId} (${cached.data.translatedLines.length} lines)`);
        return cached.data.translatedLines;
    }

    const parsed = parseLrcLines(syncedLyrics);
    const toTranslate = parsed.filter((l) => l.text && l.text !== '♪');
    if (toTranslate.length === 0) return null;

    logEvent('info', 'TRANSLATION', `Translating ${toTranslate.length} lines for ${videoId}`);
    const start = Date.now();

    const texts = await translateLines(toTranslate.map((l) => l.text));
    const translatedLines = toTranslate
        .map((line, i) => ({ time: line.time, text: texts[i] || '', sourceIndex: line.sourceIndex }))
        .filter((l) => l.text);

    if (translatedLines.length === 0) return null;

    logEvent('success', 'TRANSLATION', `Done in ${Date.now() - start}ms — ${translatedLines.length} lines for ${videoId}`);
    await writeCache(videoId, { translatedLines });
    return translatedLines;
}

module.exports = { getTranslatedLyrics, getTranslationLanguageInfo };
