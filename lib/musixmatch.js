const axios = require('axios');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { logEvent } = require('./logger');
const { detectCjkScript, romanizeLine } = require('./romanization');

const MUSIXMATCH_BASE_URL = 'https://apic-desktop.musixmatch.com/ws/1.1/';
const MUSIXMATCH_APP_ID = 'web-desktop-app-v1.0';
const MUSIXMATCH_TOKEN_TTL_MS = 50 * 60 * 1000;
const LYRICS_DIR = path.resolve(process.env.LYRICS_DIR || 'C:\\temp\\lyrics');
const MUSIXMATCH_SESSION_PATH = path.join(LYRICS_DIR, 'musixmatch-session.json');
const DEFAULT_TIMEOUT_MS = Number(process.env.LYRICS_PROVIDER_TIMEOUT_MS || 10_000);
const MAX_REDIRECTS = 3;
const TOKEN_RETRY_DELAYS_MS = [0, 500, 1500, 3000];
const TOKEN_BACKGROUND_RETRY_MS = 15_000;
const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

const musixmatchSession = {
    token: (process.env.MUSIXMATCH_USER_TOKEN || '').trim(),
    expiresAt: (process.env.MUSIXMATCH_USER_TOKEN || '').trim() ? Number.POSITIVE_INFINITY : 0,
    cookies: new Map(),
    tokenPromise: null,
    lastTokenFailureAt: 0,
    warmupTimer: null
};

function seedCookies(cookieHeader) {
    const raw = (cookieHeader || '').toString().trim();
    if (!raw) return;
    for (const part of raw.split(';')) {
        const segment = part.trim();
        const separatorIndex = segment.indexOf('=');
        if (separatorIndex <= 0) continue;
        const key = segment.slice(0, separatorIndex).trim();
        const value = segment.slice(separatorIndex + 1).trim();
        if (key) musixmatchSession.cookies.set(key, value);
    }
}

seedCookies(process.env.MUSIXMATCH_COOKIE || '');

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

async function normalizedTextVariants(value) {
    const raw = (value || '').toString();
    const variants = new Set([normalizeText(raw)]);

    if (detectCjkScript(raw)) {
        const romanized = await romanizeLine(raw);
        variants.add(normalizeText(romanized));
        variants.add(normalizeText(romanized.replace(/\s+/g, '')));
    }

    return Array.from(variants).filter(Boolean);
}

function jaroWinkler(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2 || str1.length === 0 || str2.length === 0) return 0.0;
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
    let matches = 0;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    for (let i = 0; i < s1.length; i += 1) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, s2.length);
        for (let j = start; j < end; j += 1) {
            if (s2Matches[j] || s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches += 1;
            break;
        }
    }

    if (matches === 0) return 0.0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < s1.length; i += 1) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k += 1;
        if (s1[i] !== s2[k]) transpositions += 1;
        k += 1;
    }

    const jaro = (
        (matches / s1.length) +
        (matches / s2.length) +
        ((matches - (transpositions / 2)) / matches)
    ) / 3.0;

    let prefix = 0;
    const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
    for (let i = 0; i < maxPrefix; i += 1) {
        if (s1[i] !== s2[i]) break;
        prefix += 1;
    }

    return jaro + (prefix * 0.1 * (1 - jaro));
}

function buildCookieHeader() {
    return Array.from(musixmatchSession.cookies.entries())
        .filter(([, value]) => String(value || '').trim() !== '')
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
}

function updateSessionCookies(headers) {
    const setCookie = headers?.['set-cookie'];
    const values = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
    for (const cookie of values) {
        const firstPart = cookie.split(';')[0]?.trim();
        const separatorIndex = firstPart.indexOf('=');
        if (separatorIndex <= 0) continue;
        const key = firstPart.slice(0, separatorIndex).trim();
        const value = firstPart.slice(separatorIndex + 1).trim();
        if (key) musixmatchSession.cookies.set(key, value);
    }
}

async function readSessionCache() {
    try {
        const cached = JSON.parse(await fsp.readFile(MUSIXMATCH_SESSION_PATH, 'utf8'));
        if (cached?.cookies && typeof cached.cookies === 'object') {
            for (const [key, value] of Object.entries(cached.cookies)) {
                if (key && String(value || '').trim()) musixmatchSession.cookies.set(key, String(value));
            }
        }
        if (typeof cached?.token === 'string' && cached.token.trim() && Number(cached.expiresAt) > Date.now()) {
            musixmatchSession.token = cached.token.trim();
            musixmatchSession.expiresAt = Number(cached.expiresAt);
            return musixmatchSession.token;
        }
    } catch (_) {}
    return '';
}

async function writeSessionCache() {
    try {
        await fsp.mkdir(path.dirname(MUSIXMATCH_SESSION_PATH), { recursive: true });
        const cookies = Object.fromEntries(
            Array.from(musixmatchSession.cookies.entries())
                .filter(([, value]) => String(value || '').trim() !== '')
        );
        await fsp.writeFile(MUSIXMATCH_SESSION_PATH, JSON.stringify({
            token: musixmatchSession.token,
            expiresAt: musixmatchSession.expiresAt,
            cookies
        }, null, 2) + '\n', 'utf8');
    } catch (_) {}
}

function buildHeaders() {
    const headers = {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://www.musixmatch.com',
        Referer: 'https://www.musixmatch.com/',
        'User-Agent': DESKTOP_USER_AGENT
    };
    const cookie = buildCookieHeader();
    if (cookie) headers.Cookie = cookie;
    return headers;
}

function musixmatchUrl(action, params = {}, token = '') {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        query.append(key, String(value));
    });
    query.append('app_id', MUSIXMATCH_APP_ID);
    if (token) query.append('usertoken', token);
    query.append('t', String(Date.now()));
    return `${MUSIXMATCH_BASE_URL}${action}?${query.toString()}`;
}

async function requestMusixmatchAction(action, params = {}, options = {}) {
    const withToken = options.withToken !== false && action !== 'token.get';
    const query = { ...params };
    if (withToken) {
        const token = await getUserToken();
        if (!token) return null;
        query.__token = token;
    }

    const token = query.__token || '';
    delete query.__token;
    let url = musixmatchUrl(action, query, token);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const response = await axios.get(url, {
            headers: buildHeaders(),
            timeout: DEFAULT_TIMEOUT_MS,
            maxRedirects: 0,
            validateStatus: () => true
        });

        updateSessionCookies(response.headers);

        if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
            url = new URL(response.headers.location, MUSIXMATCH_BASE_URL).toString();
            continue;
        }

        const statusCode = Number(response?.data?.message?.header?.status_code || response.status);
        if (response.status === 401 || statusCode === 401) {
            if (action !== 'token.get') {
                logEvent('warn', 'MUSIXMATCH', `401 on action "${action}" — token invalid or expired`);
                musixmatchSession.token = '';
                musixmatchSession.expiresAt = 0;
            }
            return null;
        }

        if (response.status < 200 || response.status >= 300 || statusCode < 200 || statusCode >= 300) {
            logEvent('warn', 'MUSIXMATCH', `Action "${action}" returned status HTTP ${response.status} / API ${statusCode}`);
            return null;
        }

        return response.data;
    }

    return null;
}

async function getUserToken() {
    const envToken = (process.env.MUSIXMATCH_USER_TOKEN || '').trim();
    if (envToken) {
        musixmatchSession.token = envToken;
        musixmatchSession.expiresAt = Number.POSITIVE_INFINITY;
        seedCookies(process.env.MUSIXMATCH_COOKIE || '');
        return musixmatchSession.token;
    }

    if (musixmatchSession.token && musixmatchSession.expiresAt > Date.now()) {
        return musixmatchSession.token;
    }

    if (musixmatchSession.tokenPromise) {
        return musixmatchSession.tokenPromise;
    }

    const cachedToken = await readSessionCache();
    if (cachedToken) {
        return cachedToken;
    }

    musixmatchSession.tokenPromise = acquireUserToken()
        .finally(() => {
            musixmatchSession.tokenPromise = null;
        });

    return musixmatchSession.tokenPromise;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireUserToken() {
    musixmatchSession.token = '';
    musixmatchSession.expiresAt = 0;

    for (let attempt = 0; attempt < TOKEN_RETRY_DELAYS_MS.length; attempt += 1) {
        const delay = TOKEN_RETRY_DELAYS_MS[attempt];
        if (delay > 0) await sleep(delay);

        const payload = await requestMusixmatchAction('token.get', {
            user_language: 'en'
        }, { withToken: false });
        const token = payload?.message?.body?.user_token;
        if (typeof token === 'string' && token.trim()) {
            musixmatchSession.token = token.trim();
            musixmatchSession.expiresAt = Date.now() + MUSIXMATCH_TOKEN_TTL_MS;
            await writeSessionCache();
            if (attempt > 0) {
                logEvent('info', 'MUSIXMATCH', `Anonymous token acquired after retry ${attempt}`);
            }
            return musixmatchSession.token;
        }
    }

    musixmatchSession.lastTokenFailureAt = Date.now();
    logEvent('warn', 'MUSIXMATCH', 'token.get returned no user token');
    return '';
}

function scheduleTokenWarmup(delay = 250) {
    if (musixmatchSession.warmupTimer || (musixmatchSession.token && musixmatchSession.expiresAt > Date.now())) {
        return;
    }
    musixmatchSession.warmupTimer = setTimeout(() => {
        musixmatchSession.warmupTimer = null;
        getUserToken()
            .then((token) => {
                if (!token) scheduleTokenWarmup(TOKEN_BACKGROUND_RETRY_MS);
            })
            .catch(() => scheduleTokenWarmup(TOKEN_BACKGROUND_RETRY_MS));
    }, delay);
    if (typeof musixmatchSession.warmupTimer.unref === 'function') {
        musixmatchSession.warmupTimer.unref();
    }
}

scheduleTokenWarmup();

async function initMusixmatch(options = {}) {
    const timeoutMs = Number(options.timeoutMs ?? process.env.MUSIXMATCH_INIT_TIMEOUT_MS ?? 8_000);
    const timeoutToken = Symbol('musixmatch-init-timeout');
    const result = await Promise.race([
        getUserToken(),
        sleep(Math.max(0, timeoutMs)).then(() => timeoutToken)
    ]);

    if (result === timeoutToken) {
        logEvent('warn', 'MUSIXMATCH', `Token warm-up still pending after ${timeoutMs}ms; continuing startup`);
        scheduleTokenWarmup(0);
        return false;
    }

    if (result) {
        logEvent('success', 'MUSIXMATCH', 'Token ready');
        return true;
    }

    logEvent('warn', 'MUSIXMATCH', 'Token warm-up failed; continuing with fallback providers');
    scheduleTokenWarmup(TOKEN_BACKGROUND_RETRY_MS);
    return false;
}

function sanitizePlainLyrics(lyrics) {
    if (typeof lyrics !== 'string') return '';
    const normalized = lyrics.replace(/\r\n?/g, '\n');
    const disclaimerIndex = normalized.indexOf('******* This Lyrics is NOT for Commercial use *******');
    const trimmed = disclaimerIndex >= 0 ? normalized.slice(0, disclaimerIndex) : normalized;
    return trimmed
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatLrcTime(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = Math.floor(safeSeconds % 60);
    const hundredths = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 100);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function richSyncBodyToEnhancedLrc(richSyncBody) {
    if (!Array.isArray(richSyncBody) || richSyncBody.length === 0) return '';
    const lines = [];

    for (const item of richSyncBody) {
        const lineStart = Number(item?.ts);
        const lineEnd = Number(item?.te);
        const tokens = Array.isArray(item?.l) ? item.l : [];
        if (!Number.isFinite(lineStart) || tokens.length === 0) continue;

        let line = `[${formatLrcTime(lineStart)}] `;
        for (const token of tokens) {
            const offset = Number(token?.o) || 0;
            const word = (token?.c || '').toString();
            if (!word) continue;
            line += `<${formatLrcTime(lineStart + offset)}>${word}`;
            if (!/\s$/.test(word)) line += ' ';
        }
        if (Number.isFinite(lineEnd) && lineEnd > lineStart) {
            line += `<${formatLrcTime(lineEnd)}>`;
        }
        lines.push(line.trimEnd());
    }

    return lines.join('\n');
}

function parseRichSyncBody(rawBody) {
    if (Array.isArray(rawBody)) return rawBody;
    if (typeof rawBody !== 'string' || !rawBody.trim()) return [];
    try {
        const parsed = JSON.parse(rawBody);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function isArtistMatch(requestArtist, candidateArtist) {
    const requestNormalized = normalizeText(requestArtist);
    const candidateNormalized = normalizeText(candidateArtist);
    if (!requestNormalized || !candidateNormalized) return false;
    if (requestNormalized === candidateNormalized) return true;
    if (candidateNormalized.includes(requestNormalized) || requestNormalized.includes(candidateNormalized)) {
        return true;
    }

    const requestTokens = requestNormalized.split(/\s+/g).filter(Boolean);
    const candidateTokens = candidateNormalized.split(/\s+/g).filter(Boolean);
    if (requestTokens.some((token) => candidateTokens.includes(token))) {
        return true;
    }

    return jaroWinkler(requestNormalized, candidateNormalized) >= 0.82;
}

async function isTitleMatch(requestTitle, candidateTitle) {
    const requestVariants = await normalizedTextVariants(requestTitle);
    const candidateVariants = await normalizedTextVariants(candidateTitle);
    if (requestVariants.length === 0 || candidateVariants.length === 0) return false;

    for (const requestNormalized of requestVariants) {
        for (const candidateNormalized of candidateVariants) {
            if (requestNormalized === candidateNormalized) return true;
            if (candidateNormalized.includes(requestNormalized) || requestNormalized.includes(candidateNormalized)) {
                return true;
            }
            if (jaroWinkler(requestNormalized, candidateNormalized) >= 0.88) return true;
        }
    }

    return false;
}

function isDurationMatch(requestDuration, candidateDuration) {
    const requested = Number(requestDuration) || 0;
    const candidate = Number(candidateDuration) || 0;
    if (requested <= 0 || candidate <= 0) return true;
    return Math.abs(requested - candidate) <= 30;
}

async function trackMatchScore(track, { artist, title, duration }) {
    if (!track || typeof track !== 'object') return 0;
    if (Number(track.track_id) === 115264642) return 0;

    const requestTitleVariants = await normalizedTextVariants(title);
    const candidateTitleVariants = await normalizedTextVariants(track.track_name || '');
    let titleScore = 0;
    for (const requestTitle of requestTitleVariants) {
        for (const candidateTitle of candidateTitleVariants) {
            titleScore = Math.max(titleScore, jaroWinkler(requestTitle, candidateTitle));
        }
    }
    const artistScore = jaroWinkler(normalizeText(artist), normalizeText(track.artist_name || ''));
    const candidateDuration = Number(track.track_length || track.commontrack_track_length || 0);
    const requestedDuration = Number(duration) || 0;
    const durationDelta = requestedDuration > 0 && candidateDuration > 0
        ? Math.abs(requestedDuration - candidateDuration)
        : 0;
    const durationScore = durationDelta === 0 ? 1 : Math.max(0, 1 - (durationDelta / 90));
    const lyricsBoost = Number(track.has_richsync) > 0
        ? 0.08
        : (Number(track.has_subtitles) > 0 ? 0.04 : 0);

    return (titleScore * 0.52) + (artistScore * 0.34) + (durationScore * 0.14) + lyricsBoost;
}

async function isUsableTrack(track, { artist, title, duration }, options = {}) {
    const strict = options.strict !== false;
    const log = options.log !== false;

    if (!track || typeof track !== 'object') {
        return false;
    }
    if (Number(track.track_id) === 115264642) {
        if (log) logEvent('warn', 'MUSIXMATCH', `Blocked track id 115264642`);
        return false;
    }
    if (!isArtistMatch(artist, track.artist_name || '')) {
        if (log) logEvent('warn', 'MUSIXMATCH', `Artist mismatch: expected "${artist}", got "${track.artist_name}"`);
        return false;
    }
    if (!(await isTitleMatch(title, track.track_name || ''))) {
        if (log) logEvent('warn', 'MUSIXMATCH', `Title mismatch: expected "${title}", got "${track.track_name}"`);
        return false;
    }
    if (strict && !isDurationMatch(duration, track.track_length || track.commontrack_track_length || 0)) {
        if (log) logEvent('warn', 'MUSIXMATCH', `Duration mismatch: expected ${duration}s, got ${track.track_length}s`);
        return false;
    }
    return true;
}

function extractTrackList(payload) {
    const list = payload?.message?.body?.track_list;
    if (!Array.isArray(list)) return [];
    return list.map((item) => item?.track || item).filter(Boolean);
}

async function fetchMatcherTrack(params) {
    const payload = await requestMusixmatchAction('matcher.track.get', {
        q_track: params.title,
        q_artist: params.artist,
        ...(params.albumParam ? { [params.albumParam]: params.album } : {}),
        ...(params.withDuration && Number(params.duration) > 0 ? { q_duration: Math.round(Number(params.duration)) } : {}),
        page_size: 1,
        page: 1
    });
    return payload?.message?.body?.track || null;
}

async function searchTracks({ artist, title, pageSize = 8 }) {
    const queries = [
        { q_track: title, q_artist: artist },
        { q: `${artist} ${title}` }
    ];

    const seen = new Set();
    const tracks = [];
    for (const query of queries) {
        const payload = await requestMusixmatchAction('track.search', {
            ...query,
            page_size: pageSize,
            page: 1,
            s_track_rating: 'desc',
            f_has_lyrics: 1
        });
        for (const track of extractTrackList(payload)) {
            const id = String(track.track_id || '');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            tracks.push(track);
        }
    }
    return tracks;
}

async function fetchTrack({ artist, title, album = '', duration = 0 }) {
    const token = await getUserToken();
    if (!token) {
        logEvent('warn', 'MUSIXMATCH', 'Skipping Musixmatch fetch because no user token is available yet');
        return { unavailable: true, reason: 'no_token' };
    }

    const matcherAttempts = [
        { label: 'better-lyrics matcher', artist, title, album, albumParam: album ? 'album' : '', duration, withDuration: false },
        { label: 'matcher without album', artist, title, album: '', albumParam: '', duration, withDuration: false },
        { label: 'matcher with duration', artist, title, album: '', albumParam: '', duration, withDuration: true },
        { label: 'legacy matcher', artist, title, album, albumParam: album ? 'q_album' : '', duration, withDuration: true }
    ];

    for (const attempt of matcherAttempts) {
        const track = await fetchMatcherTrack(attempt);
        if (await isUsableTrack(track, { artist, title, duration }, { strict: false, log: false })) {
            logEvent('info', 'MUSIXMATCH', `Track found via ${attempt.label}`);
            return track;
        }
    }

    const tracks = await searchTracks({ artist, title });
    const scored = [];
    for (const track of tracks) {
        const score = await trackMatchScore(track, { artist, title, duration });
        if (score >= 0.74 && await isUsableTrack(track, { artist, title, duration }, { strict: false, log: false })) {
            scored.push({ track, score });
        }
    }
    scored.sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
        const best = scored[0];
        logEvent('info', 'MUSIXMATCH', `Track found via search (${best.score.toFixed(2)})`);
        return best.track;
    }

    logEvent('warn', 'MUSIXMATCH', `No usable search candidate for "${title}" — ${artist}`);
    return null;
}

async function fetchRichsync(trackId) {
    if (!trackId) return '';
    const payload = await requestMusixmatchAction('track.richsync.get', {
        track_id: String(trackId)
    });
    const rawBody = payload?.message?.body?.richsync?.richsync_body || '';
    return richSyncBodyToEnhancedLrc(parseRichSyncBody(rawBody));
}

async function fetchSubtitleLrc(trackId) {
    if (!trackId) return '';
    const payload = await requestMusixmatchAction('track.subtitle.get', {
        track_id: String(trackId),
        subtitle_format: 'lrc'
    });
    return payload?.message?.body?.subtitle?.subtitle_body || '';
}

async function fetchPlainLyrics(trackId) {
    if (!trackId) return '';
    const payload = await requestMusixmatchAction('track.lyrics.get', {
        track_id: String(trackId)
    });
    return sanitizePlainLyrics(payload?.message?.body?.lyrics?.lyrics_body || '');
}

async function fetchMusixmatchLyrics({ artist, title, album = '', duration = 0 }) {
    try {
        const track = await fetchTrack({ artist, title, album, duration });
        if (track?.unavailable) {
            scheduleTokenWarmup(0);
            return { provider: 'musixmatch', unavailable: true, reason: track.reason };
        }
        if (!(await isUsableTrack(track, { artist, title, duration }, { strict: false, log: true }))) {
            logEvent('warn', 'MUSIXMATCH', `No track returned for "${title}" — ${artist}`);
            return null;
        }

        logEvent('info', 'MUSIXMATCH', `Matched: "${track.track_name}" — ${track.artist_name} (id: ${track.track_id}, richsync: ${track.has_richsync}, subtitles: ${track.has_subtitles})`);

        const trackId = track.track_id;
        const [wordSyncedLyrics, syncedLyrics, plainLyrics] = await Promise.all([
            Number(track.has_richsync) > 0 ? fetchRichsync(trackId) : Promise.resolve(''),
            Number(track.has_subtitles) > 0 ? fetchSubtitleLrc(trackId) : Promise.resolve(''),
            Number(track.has_lyrics) > 0 ? fetchPlainLyrics(trackId) : Promise.resolve('')
        ]);

        if (!wordSyncedLyrics && !syncedLyrics && !plainLyrics) {
            logEvent('warn', 'MUSIXMATCH', `Track matched but all lyric fetches returned empty (restricted token?)`);
            return null;
        }

        return {
            provider: 'musixmatch',
            wordSyncedLyrics,
            syncedLyrics,
            plainLyrics,
            matchedCandidate: `${track.track_name || title} - ${track.artist_name || artist}`
        };
    } catch (err) {
        logEvent('error', 'MUSIXMATCH', `fetchMusixmatchLyrics threw: ${err.message}`);
        return null;
    }
}

module.exports = {
    fetchMusixmatchLyrics,
    initMusixmatch
};
