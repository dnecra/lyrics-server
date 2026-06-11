const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const axios = require('axios');
const { logEvent } = require('./logger');
const { fetchMusixmatchLyrics } = require('./musixmatch');
const { getRomanizedLyrics, isRomanizable } = require('./romanization');
const { getTranslatedLyrics, getTranslationLanguageInfo } = require('./translation');

// --- Config ---

const LYRICS_DIR = path.resolve(process.env.LYRICS_DIR || 'C:\\temp\\lyrics');
const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const REQUEST_TIMEOUT_MS = Number(process.env.LYRICS_PROVIDER_TIMEOUT_MS || 10_000);

// --- In-flight dedup ---

const activeFetches = new Map();
const activeMusixmatchRefreshes = new Map();

// --- Disk cache helpers ---

function safeSeg(value) {
    return String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 240);
}

function safeNamePart(value) {
    const normalized = String(value || '')
        .trim()
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/g, '');
    return (normalized || 'unknown').slice(0, 120);
}

function lyricsCacheKey({ artist, title, videoId }) {
    const artistPart = safeNamePart(artist);
    const titlePart = safeNamePart(title);
    const key = `${artistPart}-${titlePart}`.slice(0, 240);
    return key === 'unknown-unknown' ? safeSeg(videoId) : key;
}

function positiveCachePath(cacheKey) {
    return path.join(LYRICS_DIR, `${safeSeg(cacheKey)}.json`);
}

function legacyPositiveCachePath(videoId) {
    return path.join(LYRICS_DIR, `${safeSeg(videoId)}.json`);
}

async function readCacheFile(filePath) {
    try {
        return JSON.parse(await fsp.readFile(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

async function writeCacheFile(filePath, data) {
    try {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
        await fsp.rename(tmp, filePath);
    } catch (_) {}
}

async function getCached(context) {
    const cacheKey = lyricsCacheKey(context);
    const entry = (await readCacheFile(positiveCachePath(cacheKey)))
        || (context.videoId ? await readCacheFile(legacyPositiveCachePath(context.videoId)) : null);
    return normalizeCachedEntrySource(entry);
}

async function setCached(context, entry) {
    await writeCacheFile(positiveCachePath(lyricsCacheKey(context)), normalizeCachedEntrySource(entry));
}

// --- Text normalization ---

function normalizeText(value) {
    return (value || '')
        .toString()
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\s*\([^)]*\)/g, ' ')
        .replace(/\s*\[[^\]]*\]/g, ' ')
        .replace(/\b(feat|ft|featuring|remaster(ed)?|version|live|edit|mix)\b.*$/i, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Strip featured artists, parenthetical suffixes, and subtitle separators
function stripTitle(title) {
    return title
        .replace(/\s*\([^)]*\)/g, '')
        .split(/[-\u2013\u2014]/)[0]
        .replace(/\s+/g, ' ')
        .trim();
}

// Split "Artist A, Artist B" or "Artist A & Artist B" into primary artist
function primaryArtist(artist) {
    return artist.split(/,|&| and |;/i)[0].trim();
}

// --- LRCLib ---

async function lrclibGet(context) {
    const query = new URLSearchParams({ artist_name: context.artist, track_name: context.title });
    if (context.album) query.set('album_name', context.album);
    if (context.duration > 0) query.set('duration', String(Math.round(context.duration)));
    try {
        const res = await axios.get(`${LRCLIB_BASE_URL}/get?${query}`, {
            headers: { Accept: 'application/json', 'User-Agent': 'lyrics-smtc/1.0' },
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true
        });
        return res.status >= 200 && res.status < 300 ? res.data : null;
    } catch (_) {
        return null;
    }
}

async function lrclibSearch(title, artist, album = '') {
    const query = new URLSearchParams({ artist_name: artist, track_name: title });
    if (album) query.set('album_name', album);
    try {
        const res = await axios.get(`${LRCLIB_BASE_URL}/search?${query}`, {
            headers: { Accept: 'application/json', 'User-Agent': 'lyrics-smtc/1.0' },
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true
        });
        return res.status >= 200 && res.status < 300 && Array.isArray(res.data) ? res.data : [];
    } catch (_) {
        return [];
    }
}

function jaroWinkler(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    let matches = 0;
    const aMatches = new Array(a.length).fill(false);
    const bMatches = new Array(b.length).fill(false);
    for (let i = 0; i < a.length; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, b.length);
        for (let j = start; j < end; j++) {
            if (bMatches[j] || a[i] !== b[j]) continue;
            aMatches[i] = bMatches[j] = true;
            matches++;
            break;
        }
    }
    if (!matches) return 0;
    let t = 0, k = 0;
    for (let i = 0; i < a.length; i++) {
        if (!aMatches[i]) continue;
        while (!bMatches[k]) k++;
        if (a[i] !== b[k]) t++;
        k++;
    }
    const jaro = ((matches / a.length) + (matches / b.length) + ((matches - t / 2) / matches)) / 3;
    let prefix = 0;
    for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
        if (a[i] !== b[i]) break;
        prefix++;
    }
    return jaro + prefix * 0.1 * (1 - jaro);
}

function hasWordSyncedLyrics(data) {
    return typeof data?.wordSyncedLyrics === 'string' && data.wordSyncedLyrics.trim().length > 0;
}

function hasSyncedLyrics(data) {
    return hasWordSyncedLyrics(data)
        || (typeof data?.syncedLyrics === 'string' && data.syncedLyrics.trim().length > 0);
}

function hasAnyLyrics(data) {
    return hasSyncedLyrics(data)
        || (typeof data?.plainLyrics === 'string' && data.plainLyrics.trim().length > 0);
}

function getProviderName(entryOrData) {
    return String(entryOrData?.provider || entryOrData?.data?.provider || '').trim().toLowerCase();
}

function getLyricType(data) {
    if (hasWordSyncedLyrics(data)) return 'word-synced';
    if (hasSyncedLyrics(data)) return 'synced';
    if (typeof data?.plainLyrics === 'string' && data.plainLyrics.trim()) return 'plain';
    return 'none';
}

function deriveSyncedLyricsFromWordSynced(wordSyncedLyrics) {
    if (typeof wordSyncedLyrics !== 'string' || !wordSyncedLyrics.trim()) return '';
    return wordSyncedLyrics
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/<\d+:\d+\.\d+>/g, '').replace(/[ \t]+$/g, ''))
        .join('\n')
        .trim();
}

function normalizeProviderCandidate(provider, source = {}, matchedCandidate = null) {
    const normalizedProvider = String(provider || source.provider || '').trim().toLowerCase();
    const wordSyncedLyrics = normalizedProvider === 'musixmatch'
        ? String(source.wordSyncedLyrics || '')
        : '';
    const syncedLyrics = String(
        source.syncedLyrics
        || (normalizedProvider === 'musixmatch' ? deriveSyncedLyricsFromWordSynced(wordSyncedLyrics) : '')
        || ''
    );

    return {
        provider: normalizedProvider,
        wordSyncedLyrics,
        syncedLyrics,
        plainLyrics: String(source.plainLyrics || ''),
        matchedCandidate: matchedCandidate || source.matchedCandidate || null
    };
}

function normalizeCachedEntrySource(entry) {
    if (!entry || typeof entry !== 'object' || !entry.data) return entry;
    const provider = getProviderName(entry);
    if (!provider) return entry;

    const normalized = normalizeProviderCandidate(provider, entry.data, entry.matchedCandidate);
    return {
        ...entry,
        provider,
        matchedCandidate: normalized.matchedCandidate,
        data: {
            ...entry.data,
            wordSyncedLyrics: normalized.wordSyncedLyrics,
            syncedLyrics: normalized.syncedLyrics,
            plainLyrics: normalized.plainLyrics
        }
    };
}

function isGoodLrclibMatch(item, context, { requireSynced = true } = {}) {
    if (!item || item.instrumental) return false;
    const titleSim = jaroWinkler(normalizeText(context.title), normalizeText(item.trackName || ''));
    const artistSim = jaroWinkler(normalizeText(context.artist), normalizeText(item.artistName || ''));
    if (titleSim < 0.75 || artistSim < 0.7) return false;
    if (context.duration > 0 && item.duration > 0 && Math.abs(context.duration - item.duration) > 25) return false;
    return requireSynced ? !!item.syncedLyrics : hasAnyLyrics(item);
}

async function fetchFromLrclib(context) {
    logEvent('info', 'LYRICS', `[LRCLIB] Fetching "${context.title}" — ${context.artist}`);
    // Try exact get first
    const exact = await lrclibGet(context);
    if (hasAnyLyrics(exact)) {
        return { syncedLyrics: exact.syncedLyrics, plainLyrics: exact.plainLyrics || '', matchedCandidate: context.title };
    }

    // Search fallback
    const rows = await lrclibSearch(context.title, context.artist, context.album);
    const match = rows.find((row) => isGoodLrclibMatch(row, context))
        || rows.find((row) => isGoodLrclibMatch(row, context, { requireSynced: false }));
    if (match) {
        return { syncedLyrics: match.syncedLyrics, plainLyrics: match.plainLyrics || '', matchedCandidate: match.trackName };
    }

    // Stripped title fallback
    const stripped = stripTitle(context.title);
    if (stripped && stripped !== context.title) {
        logEvent('info', 'LYRICS', `[LRCLIB] Retrying with stripped title "${stripped}" — ${primaryArtist(context.artist)}`);
        const rows2 = await lrclibSearch(stripped, primaryArtist(context.artist));
        const strippedContext = { ...context, title: stripped, artist: primaryArtist(context.artist) };
        const match2 = rows2.find((row) => isGoodLrclibMatch(row, strippedContext))
            || rows2.find((row) => isGoodLrclibMatch(row, strippedContext, { requireSynced: false }));
        if (match2) {
            return { syncedLyrics: match2.syncedLyrics, plainLyrics: match2.plainLyrics || '', matchedCandidate: match2.trackName };
        }
    }

    logEvent('warn', 'LYRICS', `[LRCLIB] Not found for "${context.title}" — ${context.artist}`);
    return null;
}

// --- Musixmatch with fallback ---

async function fetchFromMusixmatch(context) {
    logEvent('info', 'LYRICS', `[MUSIXMATCH] Fetching "${context.title}" — ${context.artist}`);
    // Try as-is
    let result = await fetchMusixmatchLyrics({
        artist: context.artist,
        title: context.title,
        album: context.album,
        duration: context.duration
    });
    if (hasAnyLyrics(result)) return result;
    if (result?.unavailable) {
        logEvent('warn', 'LYRICS', `[MUSIXMATCH] Temporarily unavailable (${result.reason || 'no token'}); using fallback`);
        return null;
    }

    // Stripped title + primary artist fallback
    const stripped = stripTitle(context.title);
    const artist = primaryArtist(context.artist);
    if (stripped !== context.title || artist !== context.artist) {
        logEvent('info', 'LYRICS', `[MUSIXMATCH] Retrying with stripped title "${stripped}" — ${artist}`);
        result = await fetchMusixmatchLyrics({ artist, title: stripped, album: '', duration: context.duration });
        if (hasAnyLyrics(result)) return result;
    }

    logEvent('warn', 'LYRICS', `[MUSIXMATCH] Not found for "${context.title}" — ${context.artist}`);
    return null;
}

// --- Collect all candidates (for swap/cycle feature) ---

async function collectCandidates(context, { includeFallbackAfterPrimary = false } = {}) {
    const candidates = [];

    const mxm = await fetchFromMusixmatch(context);
    if (hasAnyLyrics(mxm)) {
        candidates.push(normalizeProviderCandidate('musixmatch', mxm, mxm.matchedCandidate || context.title));
        if (!includeFallbackAfterPrimary) return candidates;
    }

    const lrc = await fetchFromLrclib(context);
    if (hasAnyLyrics(lrc)) {
        candidates.push(normalizeProviderCandidate('lrclib', lrc, lrc.matchedCandidate || context.title));
    }

    return candidates;
}

// --- Romanization + Translation ---

// Pick the best synced lyrics string to process (word-synced preferred)
function bestSyncedLyrics(candidate) {
    return candidate.wordSyncedLyrics || candidate.syncedLyrics || '';
}

async function enrichWithRomanizationAndTranslation(videoId, candidate, options = {}) {
    const synced = bestSyncedLyrics(candidate);
    if (!synced) return {};

    const needsRomanization = isRomanizable(synced.replace(/\[[^\]]+\]|<[^>]+>/g, ' '));
    const translationLanguage = getTranslationLanguageInfo(synced);
    const excludedLanguages = Array.isArray(options.excludedLanguages)
        ? options.excludedLanguages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
        : [];
    if (translationLanguage.detectedLanguage) {
        translationLanguage.isExcluded = excludedLanguages.includes(translationLanguage.detectedLanguage);
    }

    const [romanizedLyrics, translatedLines] = await Promise.all([
        needsRomanization
            ? getRomanizedLyrics(videoId, synced).catch((err) => {
                logEvent('warn', 'ROMANIZATION', `Failed: ${err.message}`);
                return null;
            })
            : Promise.resolve(null),
        getTranslatedLyrics(videoId, synced, options).catch((err) => {
            logEvent('warn', 'TRANSLATION', `Failed: ${err.message}`);
            return null;
        })
    ]);

    return {
        ...(romanizedLyrics ? { romanizedLyrics, romanizedSyncedLyrics: romanizedLyrics } : {}),
        ...(translatedLines ? { translatedLines, translatedSyncedLyrics: translatedLines } : {}),
        ...(translationLanguage.detectedLanguage ? { translationLanguage } : {})
    };
}

function applyTranslationExclusionsForDelivery(data, options = {}) {
    if (!data || typeof data !== 'object') return data;
    const excludedLanguages = Array.isArray(options.excludedLanguages)
        ? options.excludedLanguages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
        : [];
    if (excludedLanguages.length === 0) return data;

    const synced = bestSyncedLyrics(data);
    const translationLanguage = data.translationLanguage || getTranslationLanguageInfo(synced);
    const detectedLanguage = String(translationLanguage?.detectedLanguage || '').trim().toLowerCase();
    if (!detectedLanguage || !excludedLanguages.includes(detectedLanguage)) return data;

    const nextData = {
        ...data,
        translationLanguage: {
            ...translationLanguage,
            detectedLanguage,
            isExcluded: true
        }
    };
    delete nextData.translatedLines;
    delete nextData.translatedSyncedLyrics;
    delete nextData.englishSyncedLyrics;
    return nextData;
}

function broadcastLyricsUpdate({ videoId, artist, title, data, provider, broadcast, extra = {} }) {
    if (typeof broadcast !== 'function') return;
    broadcast({
        type: 'lyrics_updated',
        data: {
            videoId,
            artist,
            title,
            ...data,
            provider,
            ...extra
        }
    });
}

function buildCacheEntry(context, candidate, enriched = {}) {
    const normalizedCandidate = normalizeProviderCandidate(candidate.provider, candidate, candidate.matchedCandidate);
    return {
        videoId: context.videoId,
        cacheKey: lyricsCacheKey(context),
        provider: normalizedCandidate.provider,
        matchedCandidate: normalizedCandidate.matchedCandidate || null,
        timestamp: Date.now(),
        data: {
            wordSyncedLyrics: normalizedCandidate.wordSyncedLyrics,
            syncedLyrics: normalizedCandidate.syncedLyrics,
            plainLyrics: normalizedCandidate.plainLyrics,
            ...enriched
        }
    };
}

async function refreshMusixmatchInBackground(context, broadcast, options = {}) {
    const cacheKey = lyricsCacheKey(context);
    if (activeMusixmatchRefreshes.has(cacheKey)) return activeMusixmatchRefreshes.get(cacheKey);

    const promise = (async () => {
        const mxm = await fetchFromMusixmatch(context);
        if (!hasAnyLyrics(mxm)) {
            logEvent('info', 'LYRICS', `[MUSIXMATCH] Background refresh found no lyrics for "${context.title}"`);
            return null;
        }

        const candidate = normalizeProviderCandidate('musixmatch', mxm, mxm.matchedCandidate || context.title);

        if (!hasSyncedLyrics(candidate)) {
            logEvent('info', 'LYRICS', `[MUSIXMATCH] Background refresh returned plain lyrics only; keeping synced LRCLib cache for "${context.title}"`);
            return null;
        }

        const enriched = await enrichWithRomanizationAndTranslation(cacheKey, candidate, options);
        const entry = buildCacheEntry(context, candidate, enriched);
        await setCached(context, entry);

        const deliveryData = applyTranslationExclusionsForDelivery(entry.data, options);
        broadcastLyricsUpdate({
            videoId: context.videoId,
            artist: context.artist,
            title: context.title,
            data: deliveryData,
            provider: entry.provider,
            broadcast
        });
        logEvent('success', 'LYRICS', `[MUSIXMATCH] Background refresh upgraded cache for "${context.title}" (${getLyricType(entry.data)})`);
        return entry;
    })()
        .catch((err) => {
            logEvent('warn', 'LYRICS', `[MUSIXMATCH] Background refresh failed for "${context.title}": ${err.message}`);
            return null;
        })
        .finally(() => activeMusixmatchRefreshes.delete(cacheKey));

    activeMusixmatchRefreshes.set(cacheKey, promise);
    return promise;
}

// --- Main fetch ---

async function fetchLyricsFresh(context, broadcast, options = {}) {
    const { videoId, artist, title } = context;
    const cacheKey = lyricsCacheKey(context);

    logEvent('info', 'LYRICS', `Fetching for "${title}" — ${artist} (${videoId})`);

    const candidates = await collectCandidates(context);
    if (candidates.length === 0) {
        logEvent('warn', 'LYRICS', `No lyrics found for "${title}" — ${artist}`);
        return { success: false, error: 'No lyrics found' };
    }

    const best = candidates[0];
    const enriched = await enrichWithRomanizationAndTranslation(cacheKey, best, options);

    const entry = buildCacheEntry(context, best, enriched);

    await setCached(context, entry);

    const syncType = getLyricType(entry.data);
    logEvent('success', 'LYRICS', `[${best.provider.toUpperCase()}] Found ${syncType} lyrics for "${title}" — ${artist}`);

    broadcastLyricsUpdate({ videoId, artist, title, data: entry.data, provider: best.provider, broadcast });

    return { success: true, ...entry.data, provider: best.provider, matchedCandidate: best.matchedCandidate };
}

async function fetchLyrics(videoId, artist, title, album = '', duration = 0, broadcast, options = {}) {
    const context = { videoId, artist, title, album, duration };
    const cacheKey = lyricsCacheKey(context);
    let plainCacheFallback = null;

    // Serve from cache
    const cached = await getCached(context);
    if (cached?.data && cached.timestamp && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        const cachedProvider = getProviderName(cached);
        const cachedType = getLyricType(cached.data);

        if (cachedType === 'plain') {
            logEvent('info', 'LYRICS', `[CACHE] Plain-only cache for "${title}"; fetching again until synced lyrics are found`);
            plainCacheFallback = cached;
        } else {
            logEvent('info', 'LYRICS', `[CACHE] Serving cached ${cachedProvider || cached.provider} ${cachedType} lyrics for "${title}"`);

            // Enrich if missing (e.g. cache pre-dates romanization/translation)
            const needsEnrich = !cached.data.romanizedLyrics && !cached.data.translatedLines;
            if (needsEnrich) {
                const enriched = await enrichWithRomanizationAndTranslation(cacheKey, cached.data, options);
                if (Object.keys(enriched).length > 0) {
                    cached.cacheKey = cacheKey;
                    cached.data = { ...cached.data, ...enriched };
                    await setCached(context, cached);
                }
            }

            const deliveryData = applyTranslationExclusionsForDelivery(cached.data, options);
            broadcastLyricsUpdate({ videoId, artist, title, data: deliveryData, provider: cached.provider, broadcast });

            if (cachedProvider === 'lrclib' && hasSyncedLyrics(cached.data)) {
                refreshMusixmatchInBackground(context, broadcast, options);
            }

            return { success: true, ...deliveryData, provider: cached.provider, matchedCandidate: cached.matchedCandidate, cached: true };
        }
    }

    // Dedup in-flight fetches
    if (activeFetches.has(cacheKey)) {
        const result = await activeFetches.get(cacheKey);
        if (result?.success || !plainCacheFallback) return result;
        const deliveryData = applyTranslationExclusionsForDelivery(plainCacheFallback.data, options);
        broadcastLyricsUpdate({ videoId, artist, title, data: deliveryData, provider: plainCacheFallback.provider, broadcast });
        return {
            success: true,
            ...deliveryData,
            provider: plainCacheFallback.provider,
            matchedCandidate: plainCacheFallback.matchedCandidate,
            cached: true,
            fallback: true
        };
    }

    const promise = fetchLyricsFresh(context, broadcast, options).finally(() => activeFetches.delete(cacheKey));
    activeFetches.set(cacheKey, promise);
    const result = await promise;
    if (result?.success || !plainCacheFallback) return result;

    const deliveryData = applyTranslationExclusionsForDelivery(plainCacheFallback.data, options);
    broadcastLyricsUpdate({ videoId, artist, title, data: deliveryData, provider: plainCacheFallback.provider, broadcast });
    return {
        success: true,
        ...deliveryData,
        provider: plainCacheFallback.provider,
        matchedCandidate: plainCacheFallback.matchedCandidate,
        cached: true,
        fallback: true
    };
}

// --- Candidate swap (cycle through alternate results) ---

async function fetchLyricsCandidate(videoId, artist, title, album = '', duration = 0, candidateOffset = 0, broadcast, options = {}) {
    const context = { videoId, artist, title, album, duration };
    const cacheKey = lyricsCacheKey(context);
    const candidates = await collectCandidates(context, { includeFallbackAfterPrimary: true });
    const safeOffset = Math.max(0, Number(candidateOffset) || 0);
    const selected = candidates[safeOffset] || null;

    if (!selected) {
        return {
            success: false,
            error: 'No candidate found at offset',
            candidateOffset: safeOffset,
            totalCandidates: candidates.length
        };
    }

    const enriched = await enrichWithRomanizationAndTranslation(cacheKey, selected, options);

    const entry = buildCacheEntry(context, selected, enriched);

    await setCached(context, entry);

    if (typeof broadcast === 'function') {
        broadcast({
            type: 'lyrics_updated',
            data: {
                videoId, artist, title,
                ...entry.data,
                provider: selected.provider,
                candidateOffset: safeOffset,
                totalCandidates: candidates.length
            }
        });
    }

    return {
        success: true,
        ...entry.data,
        provider: selected.provider,
        matchedCandidate: selected.matchedCandidate,
        candidateOffset: safeOffset,
        totalCandidates: candidates.length
    };
}

module.exports = {
    fetchLyrics,
    fetchLyricsCandidate
};
