const axios = require('axios');

const MUSIXMATCH_BASE_URL = 'https://apic-desktop.musixmatch.com/ws/1.1/';
const MUSIXMATCH_APP_ID = 'web-desktop-app-v1.0';
const MUSIXMATCH_AUTHORITY = 'apic-desktop.musixmatch.com';
const MUSIXMATCH_DEFAULT_COOKIE = 'x-mxm-user-id=';
const MUSIXMATCH_TOKEN_TTL_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;

const musixmatchSession = {
    token: '',
    expiresAt: 0,
    cookie: MUSIXMATCH_DEFAULT_COOKIE
};

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

function jaroWinkler(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2 || str1.length === 0 || str2.length === 0) return 0.0;
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
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

function extractSetCookie(headers) {
    const setCookie = headers?.['set-cookie'];
    if (Array.isArray(setCookie) && setCookie.length > 0) {
        return setCookie[0];
    }
    if (typeof setCookie === 'string' && setCookie.trim()) {
        return setCookie.trim();
    }
    return '';
}

function updateSessionCookie(headers) {
    const nextCookie = extractSetCookie(headers);
    if (nextCookie) {
        musixmatchSession.cookie = nextCookie;
    }
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

function isTitleMatch(requestTitle, candidateTitle) {
    const requestNormalized = normalizeText(requestTitle);
    const candidateNormalized = normalizeText(candidateTitle);
    if (!requestNormalized || !candidateNormalized) return false;
    if (requestNormalized === candidateNormalized) return true;
    if (candidateNormalized.includes(requestNormalized) || requestNormalized.includes(candidateNormalized)) {
        return true;
    }
    return jaroWinkler(requestNormalized, candidateNormalized) >= 0.88;
}

function isDurationMatch(requestDuration, candidateDuration) {
    const requested = Number(requestDuration) || 0;
    const candidate = Number(candidateDuration) || 0;
    if (requested <= 0 || candidate <= 0) return true;
    return Math.abs(requested - candidate) <= 20;
}

function isUsableTrack(track, { artist, title, duration }) {
    if (!track || typeof track !== 'object') return false;
    if (Number(track.track_id) === 115264642) return false;
    if (!isArtistMatch(artist, track.artist_name || '')) return false;
    if (!isTitleMatch(title, track.track_name || '')) return false;
    return isDurationMatch(duration, track.track_length || track.commontrack_track_length || 0);
}

async function getUserToken() {
    if (musixmatchSession.token && musixmatchSession.expiresAt > Date.now()) {
        return musixmatchSession.token;
    }

    musixmatchSession.token = '';
    musixmatchSession.expiresAt = 0;

    const response = await axios.get(`${MUSIXMATCH_BASE_URL}token.get`, {
        params: {
            app_id: MUSIXMATCH_APP_ID
        },
        headers: {
            Accept: 'application/json',
            Authority: MUSIXMATCH_AUTHORITY,
            Cookie: musixmatchSession.cookie,
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: DEFAULT_TIMEOUT_MS,
        validateStatus: () => true
    });

    updateSessionCookie(response.headers);

    if (response.status < 200 || response.status >= 300) {
        return '';
    }

    const token = response?.data?.message?.body?.user_token;
    if (typeof token !== 'string' || !token.trim()) {
        return '';
    }

    musixmatchSession.token = token.trim();
    musixmatchSession.expiresAt = Date.now() + MUSIXMATCH_TOKEN_TTL_MS;
    return musixmatchSession.token;
}

async function fetchMacroSubtitles({ artist, title, album = '', duration = 0 }) {
    const token = await getUserToken();
    if (!token) return null;

    const response = await axios.get(`${MUSIXMATCH_BASE_URL}macro.subtitles.get`, {
        params: {
            app_id: MUSIXMATCH_APP_ID,
            format: 'json',
            usertoken: token,
            q_track: title,
            q_artist: artist,
            ...(album ? { q_album: album } : {}),
            ...(duration > 0 ? { q_duration: Math.round(duration).toString() } : {}),
            namespace: 'lyrics_richsynched',
            subtitle_format: 'lrc'
        },
        headers: {
            Accept: 'application/json',
            Authority: MUSIXMATCH_AUTHORITY,
            Cookie: musixmatchSession.cookie,
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: DEFAULT_TIMEOUT_MS,
        validateStatus: () => true
    });

    updateSessionCookie(response.headers);

    if (response.status === 401) {
        musixmatchSession.token = '';
        musixmatchSession.expiresAt = 0;
        return null;
    }

    if (response.status < 200 || response.status >= 300) {
        return null;
    }

    return response.data;
}

async function fetchMusixmatchLyrics({ artist, title, album = '', duration = 0 }) {
    try {
        const payload = await fetchMacroSubtitles({ artist, title, album, duration });
        const macroCalls = payload?.message?.body?.macro_calls;
        if (!macroCalls || typeof macroCalls !== 'object') {
            return null;
        }

        const track = macroCalls?.['matcher.track.get']?.message?.body?.track;
        if (!isUsableTrack(track, { artist, title, duration })) {
            return null;
        }

        const subtitleBody =
            macroCalls?.['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body || '';
        const plainLyrics = sanitizePlainLyrics(
            macroCalls?.['track.lyrics.get']?.message?.body?.lyrics?.lyrics_body || ''
        );

        if (!subtitleBody && !plainLyrics) {
            return null;
        }

        return {
            provider: 'musixmatch',
            syncedLyrics: subtitleBody || '',
            plainLyrics,
            matchedCandidate: `${track.track_name || title} - ${track.artist_name || artist}`
        };
    } catch (_) {
        return null;
    }
}

module.exports = {
    fetchMusixmatchLyrics
};
