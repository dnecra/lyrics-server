const axios = require('axios');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { logEvent, logOnce } = require('./logger');
let tinyldDetect = null;
let pinyinFn = null;
let esHangulRomanize = null;
let KuroshiroCtor = null;
let KuromojiAnalyzerCtor = null;
let romanizationDepsLoaded = false;
const romanizationModuleRoots = new Set();
let romanizationLastUsedAt = 0;
let romanizationUnloadTimer = null;
let activeRomanizationJobs = 0;

const LYRICS_DIR = path.resolve(process.env.LYRICS_DIR || 'C:/tmp/lyrics');
const lyricsCache = new Map();
const LYRICS_CACHE_MAX_ENTRIES = Infinity;
const ROMANIZATION_CACHE_SUFFIX = '.romanized.json';
const ROMANIZATION_IDLE_UNLOAD_MS = Number(process.env.ROMANIZATION_IDLE_UNLOAD_MS || (5 * 60 * 1000));
const ROMANIZATION_UNLOAD_IMMEDIATELY = String(process.env.ROMANIZATION_UNLOAD_IMMEDIATELY || 'true').toLowerCase() !== 'false';
const ROMANIZATION_FORCE_GC_AFTER_UNLOAD = String(process.env.ROMANIZATION_FORCE_GC_AFTER_UNLOAD || 'true').toLowerCase() !== 'false';
const ROMANIZATION_INMEMORY_MAX_ENTRIES = Math.max(0, Number(process.env.ROMANIZATION_INMEMORY_MAX_ENTRIES || 300));
const romanizationCache = new Map();
let activeLyricsFetches = new Map();
const LYRICS_CACHE_FILE = path.join(LYRICS_DIR, 'lyrics-cache.json');
const LYRICS_PERSIST_DIR = LYRICS_DIR;
const SYNCED_LYRIC_PARSE_OFFSET_SECONDS = 1.0;
const KUROSHIRO_SINGLETON_KEY = '__ytShareKuroshiroSingleton';
if (!globalThis[KUROSHIRO_SINGLETON_KEY]) {
    globalThis[KUROSHIRO_SINGLETON_KEY] = {
        instance: null,
        initPromise: null,
        initFailed: false,
        initAttempts: 0
    };
}
const kuroshiroSingleton = globalThis[KUROSHIRO_SINGLETON_KEY];

function markRomanizationModuleRoot(packageName) {
    try {
        const packageJsonPath = require.resolve(`${packageName}/package.json`);
        romanizationModuleRoots.add(path.dirname(packageJsonPath));
    } catch (_) {
    }
}

function loadRomanizationDeps() {
    if (romanizationDepsLoaded) return;

    romanizationDepsLoaded = true;
    try {
        markRomanizationModuleRoot('tinyld');
        const tinyld = require('tinyld');
        tinyldDetect = typeof tinyld?.detect === 'function' ? tinyld.detect : (typeof tinyld === 'function' ? tinyld : null);
    } catch (_) {}
    try {
        markRomanizationModuleRoot('pinyin-pro');
        const pinyinPro = require('pinyin-pro');
        pinyinFn = typeof pinyinPro?.pinyin === 'function' ? pinyinPro.pinyin : null;
    } catch (_) {}
    try {
        markRomanizationModuleRoot('es-hangul');
        const esHangul = require('es-hangul');
        esHangulRomanize = typeof esHangul?.romanize === 'function' ? esHangul.romanize : null;
    } catch (_) {}
    try {
        markRomanizationModuleRoot('kuroshiro');
        const KuroshiroModule = require('kuroshiro');
        KuroshiroCtor = KuroshiroModule?.default || KuroshiroModule?.Kuroshiro || KuroshiroModule;
    } catch (_) {}
    try {
        markRomanizationModuleRoot('kuroshiro-analyzer-kuromoji');
        markRomanizationModuleRoot('kuromoji');
        const AnalyzerModule = require('kuroshiro-analyzer-kuromoji');
        KuromojiAnalyzerCtor = AnalyzerModule?.default || AnalyzerModule?.KuromojiAnalyzer || AnalyzerModule;
    } catch (_) {}
}

function unloadRomanizationDeps() {
    if (!romanizationDepsLoaded) return;

    tinyldDetect = null;
    pinyinFn = null;
    esHangulRomanize = null;
    KuroshiroCtor = null;
    KuromojiAnalyzerCtor = null;
    romanizationDepsLoaded = false;

    kuroshiroSingleton.instance = null;
    kuroshiroSingleton.initPromise = null;
    kuroshiroSingleton.initFailed = false;

    const roots = Array.from(romanizationModuleRoots).map((root) => root.toLowerCase());
    for (const cacheKey of Object.keys(require.cache)) {
        const lowered = cacheKey.toLowerCase();
        if (roots.some((root) => lowered === root || lowered.startsWith(`${root}\\`) || lowered.startsWith(`${root}/`))) {
            delete require.cache[cacheKey];
        }
    }
    if (ROMANIZATION_FORCE_GC_AFTER_UNLOAD && typeof global.gc === 'function') {
        // Trigger a few GC cycles to improve post-unload memory reclamation.
        try {
            global.gc();
            setImmediate(() => {
                try { global.gc(); } catch (_) {}
                setImmediate(() => {
                    try { global.gc(); } catch (_) {}
                });
            });
        } catch (_) {
        }
    }
    logEvent('info', 'LYRICS', '[ROMANIZATION] Unloaded idle romanization modules from memory');
}

function scheduleRomanizationUnloadCheck() {
    if (ROMANIZATION_UNLOAD_IMMEDIATELY) return;
    if (ROMANIZATION_IDLE_UNLOAD_MS <= 0) return;
    if (romanizationUnloadTimer) {
        clearTimeout(romanizationUnloadTimer);
    }

    romanizationUnloadTimer = setTimeout(() => {
        romanizationUnloadTimer = null;
        if (activeRomanizationJobs > 0 || kuroshiroSingleton.initPromise) {
            scheduleRomanizationUnloadCheck();
            return;
        }
        const idleForMs = Date.now() - romanizationLastUsedAt;
        if (idleForMs >= ROMANIZATION_IDLE_UNLOAD_MS) {
            unloadRomanizationDeps();
            return;
        }
        scheduleRomanizationUnloadCheck();
    }, Math.max(5_000, Math.min(ROMANIZATION_IDLE_UNLOAD_MS, 60_000)));

    if (typeof romanizationUnloadTimer.unref === 'function') {
        romanizationUnloadTimer.unref();
    }
}

function touchRomanizationUsage() {
    romanizationLastUsedAt = Date.now();
    scheduleRomanizationUnloadCheck();
}

function maybeUnloadRomanizationNow() {
    if (!ROMANIZATION_UNLOAD_IMMEDIATELY) return;
    if (activeRomanizationJobs > 0) return;
    if (kuroshiroSingleton.initPromise) return;
    unloadRomanizationDeps();
}

async function withRomanizationSession(work) {
    activeRomanizationJobs += 1;
    touchRomanizationUsage();
    try {
        return await work();
    } finally {
        activeRomanizationJobs = Math.max(0, activeRomanizationJobs - 1);
        touchRomanizationUsage();
        maybeUnloadRomanizationNow();
    }
}

function parseSyncedLyricsForRomanization(syncedSource) {
    if (!syncedSource) return [];

    if (Array.isArray(syncedSource)) {
        return syncedSource
            .map((item, sourceIndex) => {
                const text = (item?.text || '').toString();
                const trimmedText = text.trim();
                const isIncomingBlank = !!item?.isEmpty || !!item?.isSourceBlank;
                const isBlank = isIncomingBlank || trimmedText === '';
                return {
                    time: Number.isFinite(Number(item?.time)) ? Number(item?.time) : 0,
                    text,
                    isEmpty: isBlank,
                    sourceIndex: Number.isFinite(Number(item?.sourceIndex)) ? Number(item?.sourceIndex) : sourceIndex
                };
            });
    }

    if (typeof syncedSource === 'string') {
        return syncedSource
            .split(/\r?\n/)
            .map((line, sourceIndex) => {
                const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
                if (!match) return null;
                const min = parseInt(match[1], 10);
                const sec = parseInt(match[2], 10);
                const ms = parseInt(match[3], 10);
                const divisor = (match[3].length === 3 ? 1000 : 100);
                const text = (match[4] || '').toString();
                return {
                    time: (min * 60) + sec + (ms / divisor) - SYNCED_LYRIC_PARSE_OFFSET_SECONDS,
                    text,
                    isEmpty: (text.trim() === ''),
                    sourceIndex
                };
            })
            .filter(Boolean);
    }

    return [];
}

function sanitizeLyricsCacheData(data) {
    if (!data || typeof data !== 'object') return data;
    const copy = { ...data };
    delete copy.romanizedSyncedLyrics;
    delete copy.romanizedPlainLyrics;
    delete copy.romanizedSyncLyrics;
    return normalizeLyricsDataForCache(copy);
}

function normalizeLineBreaks(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\r\n?/g, '\n');
}

function normalizeWrappedText(text) {
    return normalizeLineBreaks(text)
        .split('\n')
        .map((line) => line.replace(/\s+$/g, ''))
        .join('\n');
}

function normalizeLyricsDataForCache(data) {
    if (!data || typeof data !== 'object') return data;
    const normalized = {};
    const syncedSource = data.syncLyrics || data.syncedLyrics || data.synced;
    const wordSyncedSource = data.wordSyncedLyrics || data.wordSyncLyrics || data.wordSynced;
    if (Array.isArray(syncedSource) && syncedSource.length > 0) {
        const lrcLines = syncedSource.map((line) => {
            const time = Number(line?.time);
            const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
            const min = Math.floor(safeTime / 60);
            const sec = Math.floor(safeTime % 60);
            const hundredths = Math.floor((safeTime - Math.floor(safeTime)) * 100);
            const text = (line?.text || '').toString();
            const mm = String(min).padStart(2, '0');
            const ss = String(sec).padStart(2, '0');
            const xx = String(hundredths).padStart(2, '0');
            return `[${mm}:${ss}.${xx}] ${text}`;
        });
        normalized.syncedLyrics = normalizeWrappedText(lrcLines.join('\n'));
    } else if (typeof syncedSource === 'string' && syncedSource.trim().length > 0) {
        normalized.syncedLyrics = normalizeWrappedText(syncedSource);
    }

    if (typeof wordSyncedSource === 'string' && wordSyncedSource.trim().length > 0) {
        normalized.wordSyncedLyrics = normalizeWrappedText(wordSyncedSource);
    }

    if (typeof data.plainLyrics === 'string' && data.plainLyrics.trim().length > 0) {
        normalized.plainLyrics = normalizeWrappedText(data.plainLyrics);
    } else if (Array.isArray(data.plain) && data.plain.length > 0) {
        normalized.plainLyrics = normalizeWrappedText(data.plain.join('\n'));
    } else if (typeof data.plain === 'string' && data.plain.trim().length > 0) {
        normalized.plainLyrics = normalizeWrappedText(data.plain);
    } else if (typeof data.lyrics === 'string' && data.lyrics.trim().length > 0) {
        normalized.plainLyrics = normalizeWrappedText(data.lyrics);
    }

    return normalized;
}

function hasJapanese(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u3040-\u30FF]/.test(text);
}

function hasKorean(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\uAC00-\uD7A3]/.test(text);
}

function hasChinese(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u4E00-\u9FFF]/.test(text);
}

async function initServerKuroshiro() {
    loadRomanizationDeps();
    touchRomanizationUsage();
    if (kuroshiroSingleton.instance) return kuroshiroSingleton.instance;
    if (kuroshiroSingleton.initFailed) return null;
    if (kuroshiroSingleton.initPromise) return kuroshiroSingleton.initPromise;
    if (typeof KuroshiroCtor !== 'function' || typeof KuromojiAnalyzerCtor !== 'function') return null;

    kuroshiroSingleton.initPromise = (async () => {
        try {
            kuroshiroSingleton.initAttempts += 1;
            if (kuroshiroSingleton.instance) return kuroshiroSingleton.instance;
            const kuroshiro = new KuroshiroCtor();
            const kuromojiPackagePath = require.resolve('kuromoji/package.json');
            const dictPath = path.join(path.dirname(kuromojiPackagePath), 'dict');
            const analyzer = new KuromojiAnalyzerCtor({ dictPath });
            await kuroshiro.init(analyzer);
            kuroshiroSingleton.instance = kuroshiro;
            return kuroshiroSingleton.instance;
        } catch (error) {
            kuroshiroSingleton.initFailed = true;
            logOnce('LYRICS', `[ROMANIZATION] Kuroshiro init failed: ${error?.message || error}`);
            return null;
        } finally {
            kuroshiroSingleton.initPromise = null;
        }
    })();

    return kuroshiroSingleton.initPromise;
}

async function romanizeJapanese(text) {
    if (!text || typeof text !== 'string') return text;
    loadRomanizationDeps();
    touchRomanizationUsage();
    const kuroshiro = await initServerKuroshiro();
    if (!kuroshiro) return text;
    try {
        const out = await kuroshiro.convert(text, {
            to: 'romaji',
            mode: 'spaced',
            romajiSystem: 'hepburn'
        });
        return (typeof out === 'string' && out.trim()) ? out : text;
    } catch (_) {
        return text;
    }
}

function romanizeKorean(text) {
    if (!text || typeof text !== 'string') return text;
    loadRomanizationDeps();
    touchRomanizationUsage();
    if (typeof esHangulRomanize !== 'function') return text;
    try {
        const out = esHangulRomanize(text);
        return (typeof out === 'string' && out.trim()) ? out : text;
    } catch (_) {
        return text;
    }
}

function romanizeChinese(text) {
    if (!text || typeof text !== 'string') return text;
    loadRomanizationDeps();
    touchRomanizationUsage();
    if (typeof pinyinFn !== 'function') return text;
    try {
        return text.replace(/[\u4E00-\u9FFF]+/g, (segment) => {
            try {
                const out = pinyinFn(segment, { toneType: 'none' });
                return (typeof out === 'string' && out.trim()) ? out : segment;
            } catch (_) {
                return segment;
            }
        });
    } catch (_) {
        return text;
    }
}

function detectLang(text) {
    loadRomanizationDeps();
    touchRomanizationUsage();
    if (typeof tinyldDetect !== 'function') return null;
    try {
        return tinyldDetect(text);
    } catch (_) {
        return null;
    }
}

async function romanizeTextWithOriginalMethod(text) {
    if (!text || typeof text !== 'string') return text;
    if (!hasJapanese(text) && !hasKorean(text) && !hasChinese(text)) return text;

    const detected = detectLang(text);
    if (detected === 'ja' || detected === 'jpn') {
        const out = await romanizeJapanese(text);
        return out || text;
    }
    if (detected === 'ko' || detected === 'kor') {
        return romanizeKorean(text);
    }
    if (detected === 'zh' || detected === 'cmn') {
        return romanizeChinese(text);
    }

    if (hasJapanese(text)) {
        const out = await romanizeJapanese(text);
        return out || text;
    }
    if (hasKorean(text)) {
        return romanizeKorean(text);
    }
    if (hasChinese(text)) {
        return romanizeChinese(text);
    }

    return text;
}

function isRomanizationPayload(value) {
    return !!value && typeof value === 'object';
}

function pruneRomanizationInMemoryCache() {
    if (romanizationCache.size === 0) return;
    const now = Date.now();
    for (const [videoId, entry] of romanizationCache.entries()) {
        if (!entry || typeof entry.timestamp !== 'number') {
            romanizationCache.delete(videoId);
        }
    }
    if (ROMANIZATION_INMEMORY_MAX_ENTRIES <= 0) {
        romanizationCache.clear();
        return;
    }
    if (romanizationCache.size <= ROMANIZATION_INMEMORY_MAX_ENTRIES) return;

    const sorted = Array.from(romanizationCache.entries())
        .sort((a, b) => (a[1]?.timestamp || 0) - (b[1]?.timestamp || 0));
    const removeCount = sorted.length - ROMANIZATION_INMEMORY_MAX_ENTRIES;
    for (let i = 0; i < removeCount; i += 1) {
        romanizationCache.delete(sorted[i][0]);
    }
}

async function getRomanizationCacheEntry(videoId) {
    pruneRomanizationInMemoryCache();
    const inMemory = romanizationCache.get(videoId);
    if (inMemory && typeof inMemory.timestamp === 'number') {
        return inMemory;
    }

    try {
        const filePath = path.join(LYRICS_PERSIST_DIR, `${videoId}${ROMANIZATION_CACHE_SUFFIX}`);
        const raw = await fsp.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.timestamp !== 'number' || !isRomanizationPayload(parsed.data)) {
            return null;
        }
        const entry = {
            timestamp: parsed.timestamp,
            data: normalizeLyricsDataForCache(parsed.data)
        };
        romanizationCache.set(videoId, entry);
        return entry;
    } catch (_) {
        return null;
    }
}

async function setRomanizationCacheEntry(videoId, data) {
    pruneRomanizationInMemoryCache();
    const entry = {
        timestamp: Date.now(),
        data: normalizeLyricsDataForCache(data)
    };
    romanizationCache.set(videoId, entry);
    pruneRomanizationInMemoryCache();
    try {
        await fsp.mkdir(LYRICS_PERSIST_DIR, { recursive: true });
        const tempPath = path.join(LYRICS_PERSIST_DIR, `${videoId}${ROMANIZATION_CACHE_SUFFIX}.tmp`);
        const filePath = path.join(LYRICS_PERSIST_DIR, `${videoId}${ROMANIZATION_CACHE_SUFFIX}`);
        await fsp.writeFile(tempPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
        await fsp.rename(tempPath, filePath);
    } catch (_) {
    }
}

function isRomanizableLyricsData(data) {
    const normalized = normalizeLyricsDataForCache(data);
    const syncedSource = normalized?.syncedLyrics;
    if (typeof syncedSource === 'string' && syncedSource.length > 0) {
        const withoutTags = syncedSource.replace(/\[[^\]]+\]/g, ' ');
        if (hasJapanese(withoutTags) || hasKorean(withoutTags) || hasChinese(withoutTags)) {
            return true;
        }
    }
    if (Array.isArray(syncedSource) && syncedSource.length > 0) {
        const merged = syncedSource.map((item) => (item?.text || '').toString()).join('\n');
        if (hasJapanese(merged) || hasKorean(merged) || hasChinese(merged)) {
            return true;
        }
    }
    const plainText = normalized?.plainLyrics || '';
    return hasJapanese(plainText) || hasKorean(plainText) || hasChinese(plainText);
}

async function romanizeSyncedLyricsText(syncedText) {
    const normalized = normalizeWrappedText(syncedText);
    const lines = normalized.split('\n');
    const romanizedLines = await Promise.all(lines.map(async (line) => {
        const match = line.match(/^(\[[^\]]+\]\s*)(.*)$/);
        if (!match) {
            return await romanizeTextWithOriginalMethod(line);
        }
        const prefix = match[1] || '';
        const lyric = match[2] || '';
        const romanizedLyric = await romanizeTextWithOriginalMethod(lyric);
        return `${prefix}${romanizedLyric}`;
    }));
    return romanizedLines.join('\n');
}

async function buildRomanizedLyricsData(data) {
    const normalized = normalizeLyricsDataForCache(data);
    if (typeof normalized?.syncedLyrics === 'string' && normalized.syncedLyrics.length > 0) {
        return {
            syncedLyrics: await romanizeSyncedLyricsText(normalized.syncedLyrics)
        };
    }
    if (Array.isArray(normalized?.syncedLyrics) && normalized.syncedLyrics.length > 0) {
        return {
            syncedLyrics: await Promise.all(normalized.syncedLyrics.map(async (line) => ({
                ...line,
                text: await romanizeTextWithOriginalMethod((line?.text || '').toString())
            })))
        };
    }
    if (typeof normalized?.plainLyrics === 'string' && normalized.plainLyrics.length > 0) {
        const plainLines = normalizeWrappedText(normalized.plainLyrics).split('\n');
        const romanizedLines = await Promise.all(plainLines.map((line) => romanizeTextWithOriginalMethod(line)));
        return { plainLyrics: romanizedLines.join('\n') };
    }

    return {};
}

async function resolveRomanizationPayload(videoId, data) {
    if (!isRomanizableLyricsData(data)) {
        maybeUnloadRomanizationNow();
        return {};
    }
    const cached = await getRomanizationCacheEntry(videoId);
    if (cached && isRomanizationPayload(cached.data)) {
        maybeUnloadRomanizationNow();
        return cached.data;
    }
    const payload = await withRomanizationSession(() => buildRomanizedLyricsData(data));
    if (isRomanizationPayload(payload) && Object.keys(payload).length > 0) {
        await setRomanizationCacheEntry(videoId, payload);
    }
    maybeUnloadRomanizationNow();
    return payload;
}

async function attachRomanization(videoId, data) {
    const payload = await resolveRomanizationPayload(videoId, data);
    const response = { ...data };
    if (payload?.syncedLyrics) {
        response.romanizedSyncedLyrics = parseSyncedLyricsForRomanization(payload.syncedLyrics).map((line) => ({
            time: line.time,
            text: line.text,
            sourceIndex: line.sourceIndex
        }));
    }
    if (payload?.plainLyrics) {
        response.romanizedPlainLyrics = payload.plainLyrics;
    }
    return response;
}

/**
 * Calculate Jaro-Winkler similarity between two strings (0..1).
 */
function jaroWinkler(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2 || str1.length === 0 || str2.length === 0) return 0.0;
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    let matches = 0;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);
    for (let i = 0; i < s1.length; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, s2.length);
        for (let j = start; j < end; j++) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }
    if (matches === 0) return 0.0;
    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < s1.length; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }
    const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3.0;
    let prefix = 0;
    const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
    for (let i = 0; i < maxPrefix; i++) {
        if (s1[i] === s2[i]) prefix++;
        else break;
    }
    return jaro + (prefix * 0.1 * (1 - jaro));
}

/**
 * Query lrclib.net for lyric matches by title/artist/album.
 */
async function searchLRCLib(searchTitle, searchArtist, album = '') {
    const query = new URLSearchParams({
        artist_name: searchArtist,
        track_name: searchTitle,
    });
    if (album) {
        query.set('album_name', album);
    }
    const url = `https://lrclib.net/api/search?${query.toString()}`;
    try {
        const response = await axios.get(url, {
            headers: { 'Accept': 'application/json' }
        });
        return response.data;
    } catch (error) {
        return null;
    }
}

/**
 * Filter and rank lyrics search results by artist similarity and duration.
 */
function filterLyricsResults(results, searchArtist, searchTitle, searchDuration) {
    if (!results || results.length === 0) return [];
    const artistTokens = (searchArtist || '').toLowerCase().split(/[&,]/g).map(s => s.trim()).filter(Boolean);
    const filtered = results.filter(item => {
        if (item.instrumental) return false;
        const itemArtist = (item.artistName || '').toLowerCase();
        if (!itemArtist) return false;
        for (const t of artistTokens) {
            if (t && itemArtist.includes(t)) return true;
        }
        return jaroWinkler((searchArtist || '').toLowerCase(), itemArtist) >= 0.8;
    });
    filtered.sort((a, b) => {
        const aHasSynced = !!(a.syncedLyrics || a.syncLyrics);
        const bHasSynced = !!(b.syncedLyrics || b.syncLyrics);
        if (aHasSynced && !bHasSynced) return -1;
        if (!aHasSynced && bHasSynced) return 1;
        if (searchDuration > 0 && a.duration && b.duration) {
            const da = Math.abs(a.duration - searchDuration || 0);
            const db = Math.abs(b.duration - searchDuration || 0);
            return da - db;
        }
        return 0;
    });
    return filtered;
}

/**
 * Choose the best lyrics candidate, preferring synced entries and matching duration.
 */
function selectBestMatch(candidates, searchDuration) {
    if (!candidates || candidates.length === 0) return null;
    const synced = candidates.filter(item => !!(item.syncedLyrics || item.syncLyrics));
    if (synced.length > 0) {
        if (searchDuration > 0) {
            synced.sort((a, b) => Math.abs((a.duration || 0) - searchDuration) - Math.abs((b.duration || 0) - searchDuration));
        }
        return synced[0];
    }
    if (searchDuration > 0) {
        const byDuration = Array.from(candidates).filter(it => it.duration).sort((a, b) => Math.abs((a.duration || 0) - searchDuration) - Math.abs((b.duration || 0) - searchDuration));
        if (byDuration.length > 0) return byDuration[0];
    }
    return candidates[0];
}

/**
 * Clean song title for improved fallback lyric searches.
 */
function normalizeTitleForLyricsFallback(title) {
    if (!title || typeof title !== 'string') return title;
    let cleaned = title.replace(/\s*\([^)]*\)/g, '');
    cleaned = cleaned.split(/[-–—]/)[0];
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

/**
 * Initialize lyrics cache storage without preloading all entries into memory.
 * Entries are loaded lazily per videoId on demand.
 */
async function loadLyricsCacheFromDisk() {
    try {
        await fsp.mkdir(LYRICS_PERSIST_DIR, { recursive: true });
        logEvent('info', 'LYRICS-CACHE', 'Lazy cache mode enabled (entries load per song on demand)');
    } catch (err) {
        console.warn('[LYRICS-CACHE] load error:', err?.message || err);
    }
}

/**
 * Load one lyrics cache entry from disk into memory for a specific videoId.
 */
async function loadLyricsCacheEntryFromDisk(videoId) {
    if (!videoId) return null;
    const cached = lyricsCache.get(videoId);
    if (cached) return cached;

    try {
        const filePath = path.join(LYRICS_PERSIST_DIR, `${videoId}.json`);
        const raw = await fsp.readFile(filePath, 'utf8');
        const entry = JSON.parse(raw);
        if (entry && entry.timestamp) {
            const sanitized = {
                ...entry,
                data: sanitizeLyricsCacheData(entry.data)
            };
            lyricsCache.set(videoId, sanitized);
            return sanitized;
        }
    } catch (err) {
        if (err?.code !== 'ENOENT') {
            console.warn(`[LYRICS-CACHE] Failed to read cache entry ${videoId}:`, err.message);
        }
    }

    // Legacy fallback: check old single-file cache only for requested videoId.
    try {
        const legacyRaw = await fsp.readFile(LYRICS_CACHE_FILE, 'utf8');
        const parsed = JSON.parse(legacyRaw);
        const legacyEntry = parsed?.[videoId];
        if (!legacyEntry || !legacyEntry.timestamp) return null;

        const sanitized = {
            ...legacyEntry,
            data: sanitizeLyricsCacheData(legacyEntry.data)
        };
        lyricsCache.set(videoId, sanitized);
        try {
            await saveLyricsCacheEntryToDisk(videoId, sanitized);
        } catch (_) {
        }
        return sanitized;
    } catch (err) {
        if (err?.code !== 'ENOENT') {
            console.warn('[LYRICS-CACHE] Failed to read legacy cache file:', err.message);
        }
    }
    return null;
}

/**
 * Persist one lyrics cache entry to disk.
 */
async function saveLyricsCacheEntryToDisk(videoId, entry) {
    if (!videoId || !entry) return;
    try {
        await fsp.mkdir(LYRICS_PERSIST_DIR, { recursive: true });
        const tmp = path.join(LYRICS_PERSIST_DIR, `${videoId}.json.tmp`);
        const final = path.join(LYRICS_PERSIST_DIR, `${videoId}.json`);
        await fsp.writeFile(tmp, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
        await fsp.rename(tmp, final);
    } catch (err) {
        console.warn(`[LYRICS-CACHE] Failed to save cache entry ${videoId}:`, err.message);
    }
}

/**
 * Fetch lyrics for a song from lrclib.net with caching and fallback strategies.
 */
async function fetchLyrics(videoId, artist, title, album = '', duration = 0, broadcast) {
    let cached = lyricsCache.get(videoId);
    if (!cached) {
        cached = await loadLyricsCacheEntryFromDisk(videoId);
    }
    let cachedFallback = null;
    if (cached) {
        const hasSyncedInCache = !!(cached.data && (cached.data.syncedLyrics || cached.data.syncLyrics || cached.data.wordSyncedLyrics));
        if (!hasSyncedInCache && cached.data && cached.data.plainLyrics) {
            cachedFallback = cached;
            logEvent('info', 'LYRICS', `Plain-only cache for videoId: ${videoId}, attempting fresh fetch`);
        } else {
            const responseData = await attachRomanization(videoId, cached.data);
            return { success: true, data: responseData, cached: true };
        }
    }

    if (activeLyricsFetches.has(videoId)) {
        logOnce('LYRICS', `Waiting for in-progress fetch: ${videoId}`);
        const result = await activeLyricsFetches.get(videoId);
        return { success: true, data: result, cached: false };
    }

    const fetchPromise = (async () => {
        try {
            logOnce('LYRICS', `Fetching for: "${title}" by "${artist}" (${videoId})`);
            let data = null;
            let matchedCandidate = null;
            const individualArtists = (artist || '').split(/,|&| and |;/i).map(s => s.trim()).filter(Boolean);
            const artistCandidates = [artist, ...individualArtists.filter(a => a && a !== artist)];
            
            for (const candidate of artistCandidates) {
                try {
                    const results = await searchLRCLib(title, candidate, album);
                    if (!results || results.length === 0) continue;
                    const filtered = filterLyricsResults(results, candidate, title, duration);
                    if (!filtered || filtered.length === 0) continue;
                    const bestMatch = selectBestMatch(filtered, duration);
                    if (bestMatch) {
                        const hasSynced = !!(bestMatch.syncedLyrics || bestMatch.syncLyrics);
                        if (hasSynced || !duration || Math.abs((bestMatch.duration || 0) - duration) <= 15) {
                            data = {
                                syncedLyrics: bestMatch.syncedLyrics,
                                plainLyrics: bestMatch.plainLyrics
                            };
                            data = normalizeLyricsDataForCache(data);
                            matchedCandidate = candidate;
                            break;
                        }
                    }
                } catch (err) {
                }
            }

            if (!data) {
                try {
                    for (const candidate of artistCandidates) {
                        try {
                            const results = await searchLRCLib(title, candidate, '');
                            if (!results || results.length === 0) continue;
                            const filtered = filterLyricsResults(results, candidate, title, duration);
                            if (!filtered || filtered.length === 0) continue;
                            const bestMatch = selectBestMatch(filtered, duration);
                            if (bestMatch) {
                                const hasSynced = !!(bestMatch.syncedLyrics || bestMatch.syncLyrics);
                                if (hasSynced || !duration || Math.abs((bestMatch.duration || 0) - duration) <= 15) {
                                    data = {
                                        syncedLyrics: bestMatch.syncedLyrics,
                                        plainLyrics: bestMatch.plainLyrics
                                    };
                                    data = normalizeLyricsDataForCache(data);
                                    matchedCandidate = `${candidate} (no-album)`;
                                    break;
                                }
                            }
                        } catch (err) {
                        }
                    }
                } catch (e) {
                }
            }

            if (!data) {
                try {
                    const cleanedTitle = normalizeTitleForLyricsFallback(title);
                    if (cleanedTitle && cleanedTitle !== title) {
                        logOnce('LYRICS', `Retrying with cleaned title: "${cleanedTitle}"`);
                        for (const candidate of artistCandidates) {
                            try {
                                const results = await searchLRCLib(cleanedTitle, candidate, '');
                                if (!results || results.length === 0) continue;
                                const filtered = filterLyricsResults(results, candidate, cleanedTitle, duration);
                                if (!filtered || filtered.length === 0) continue;
                                let bestMatch = null;
                                for (const item of filtered) {
                                    const hasSynced = !!(item.syncedLyrics || item.syncLyrics);
                                    if (hasSynced) {
                                        if (duration > 0 && Math.abs(item.duration - duration) > 15) {
                                            continue;
                                        }
                                        bestMatch = item;
                                        break;
                                    }
                                }
                                if (!bestMatch) bestMatch = filtered[0];
                                if (!duration || Math.abs(bestMatch.duration - duration) <= 15) {
                                    data = {
                                        syncedLyrics: bestMatch.syncedLyrics,
                                        plainLyrics: bestMatch.plainLyrics
                                    };
                                    data = normalizeLyricsDataForCache(data);
                                    matchedCandidate = `${candidate} (cleaned-title: ${cleanedTitle})`;
                                    break;
                                }
                            } catch (err) {
                            }
                        }
                    }
                } catch (err) {
                }
            }

            if (!data || (!data.syncedLyrics && !data.syncLyrics && !data.wordSyncedLyrics && !data.plainLyrics)) {
                logOnce('LYRICS', `✖ No lyrics found for: ${title} by ${artist}`);
                return null;
            }
            lyricsCache.set(videoId, {
                data,
                timestamp: Date.now()
            });
            const cachedEntry = lyricsCache.get(videoId);
            try {
                await saveLyricsCacheEntryToDisk(videoId, cachedEntry);
            } catch (err) {
                console.warn('[LYRICS-CACHE] Error saving cache after set:', err.message);
            }
            if (lyricsCache.size > LYRICS_CACHE_MAX_ENTRIES) {
                const entries = Array.from(lyricsCache.entries());
                entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
                const toDelete = entries.slice(0, entries.length - LYRICS_CACHE_MAX_ENTRIES);
                toDelete.forEach(([key]) => lyricsCache.delete(key));
            }
            const matchedLog = typeof matchedCandidate === 'string' && matchedCandidate ? ` (matched: ${matchedCandidate})` : '';
            logEvent('info', 'LYRICS', `✓ Found lyrics for: ${title} by ${artist}${matchedLog}`);
            const responseData = await attachRomanization(videoId, data);
            broadcast({ 
                type: 'lyrics_updated', 
                data: { 
                    videoId, 
                    artist, 
                    title,
                    matchedCandidate: matchedCandidate || null,
                    lyrics: responseData 
                } 
            });
            return responseData;
        } finally {
            activeLyricsFetches.delete(videoId);
        }
    })();

    activeLyricsFetches.set(videoId, fetchPromise);
    const result = await fetchPromise;
    
    if (result) {
        return { success: true, data: result, cached: false };
    } else if (cachedFallback) {
        logOnce('LYRICS', `Returning plain-only cached lyrics for videoId: ${videoId} after failed refresh`);
        const responseData = await attachRomanization(videoId, cachedFallback.data);
        return { success: true, data: responseData, cached: true, fallback: true };
    } else {
        return { success: false, error: 'No lyrics found' };
    }
}

module.exports = {
    jaroWinkler,
    searchLRCLib,
    filterLyricsResults,
    selectBestMatch,
    normalizeTitleForLyricsFallback,
    loadLyricsCacheFromDisk,
    saveLyricsCacheEntryToDisk,
    fetchLyrics
};
