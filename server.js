const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const WebSocket = require('ws');
const { spawn } = require('child_process');

const { logEvent } = require('./lib/logger');
const { fetchLyrics, fetchLyricsCandidate } = require('./lib/lyrics');
const { fetchImage } = require('./lib/image-proxy');
const { initMusixmatch } = require('./lib/musixmatch');

const PORT = process.env.PORT || 1312;
const PUBLIC_DIR = process.env.PUBLIC_DIR
    ? path.resolve(process.env.PUBLIC_DIR)
    : path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.webm': 'audio/webm'
};

// --- State ---
const clients = new Set();
let latestSongData = null;
let sharedTranslationExcludedLanguages = [];

// --- Helpers ---

function broadcast(data) {
    const message = JSON.stringify(data);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

function normalizeExcludedLanguageCodes(value) {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(/[,\s]+/g).filter(Boolean);

    return Array.from(new Set(values
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)));
}

function materializeSongDataForDispatch(songData, nowMs = Date.now()) {
    if (!songData || typeof songData !== 'object') return songData;
    const sampledAtMs = Number(songData.sampledAtMs);
    const elapsedSeconds = Number(songData.elapsedSeconds);
    const songDuration = Number(songData.songDuration);
    if (!Number.isFinite(sampledAtMs) || !Number.isFinite(elapsedSeconds) || songData.isPaused) {
        return songData;
    }

    const deltaSeconds = Math.max(0, (nowMs - sampledAtMs) / 1000);
    let projectedElapsed = elapsedSeconds + deltaSeconds;
    if (Number.isFinite(songDuration) && songDuration > 0) {
        projectedElapsed = Math.min(songDuration, projectedElapsed);
    }

    return { ...songData, elapsedSeconds: projectedElapsed, sampledAtMs: nowMs };
}

function getEffectiveMusicEligibilityForVideoId(videoId) {
    const normalizedVideoId = String(videoId || '').trim();
    if (!normalizedVideoId) return null;
    const currentVideoId = String(latestSongData?.videoId || '').trim();
    if (!currentVideoId || currentVideoId !== normalizedVideoId) return null;
    return typeof latestSongData?.isMusicEligible === 'boolean' ? latestSongData.isMusicEligible : null;
}

function normalizeLyricsDataForFrontend(data) {
    if (!data || typeof data !== 'object') return data;
    const normalized = { ...data };
    if (normalized.romanizedLyrics && !normalized.romanizedSyncedLyrics) {
        normalized.romanizedSyncedLyrics = normalized.romanizedLyrics;
    }
    if (normalized.translatedLines && !normalized.translatedSyncedLyrics) {
        normalized.translatedSyncedLyrics = normalized.translatedLines;
    }
    if (normalized.provider && typeof normalized.provider === 'string') {
        normalized.provider = normalized.provider.toLowerCase();
    }
    return normalized;
}

function normalizeLyricsResultForFrontend(result) {
    if (!result || typeof result !== 'object') return result;
    const data = normalizeLyricsDataForFrontend(result.data || {
        wordSyncedLyrics: result.wordSyncedLyrics || '',
        syncedLyrics: result.syncedLyrics || '',
        plainLyrics: result.plainLyrics || '',
        romanizedLyrics: result.romanizedLyrics,
        romanizedSyncedLyrics: result.romanizedSyncedLyrics,
        translatedLines: result.translatedLines,
        translatedSyncedLyrics: result.translatedSyncedLyrics,
        provider: result.provider
    });

    return {
        success: !!result.success,
        data,
        cached: !!result.cached,
        fallback: !!result.fallback,
        provider: result.provider || data?.provider || 'unknown',
        matchedCandidate: result.matchedCandidate || null,
        candidateOffset: Number(result.candidateOffset || 0) || 0,
        totalCandidates: Number(result.totalCandidates || 0) || 0,
        error: result.error
    };
}

function makeLyricsBroadcastContext(base = {}) {
    return (message) => {
        if (!message || message.type !== 'lyrics_updated') {
            broadcast(message);
            return;
        }

        const incoming = message.data || {};
        const lyrics = normalizeLyricsDataForFrontend(incoming.lyrics || incoming);
        broadcast({
            type: 'lyrics_updated',
            data: {
                ...incoming,
                videoId: incoming.videoId || base.videoId,
                artist: incoming.artist || base.artist,
                title: incoming.title || base.title,
                provider: incoming.provider || lyrics?.provider,
                matchedCandidate: incoming.matchedCandidate || null,
                candidateOffset: Number(incoming.candidateOffset || 0) || 0,
                totalCandidates: Number(incoming.totalCandidates || 0) || 0,
                lyrics
            }
        });
    };
}

function sendJson(res, status, payload, headers = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ...headers
    });
    res.end(body);
}

function sendText(res, status, text, headers = {}) {
    const body = String(text || '');
    res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        ...headers
    });
    res.end(body);
}

function sendRedirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

async function readRequestJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function getRequestUrl(req) {
    return new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
}

function getTranslationExcludedLanguagesFromUrl(url) {
    const requested = normalizeExcludedLanguageCodes(url.searchParams.get('translationExclude'));
    return requested.length > 0 ? requested : sharedTranslationExcludedLanguages;
}

async function serveStaticFile(url, res, { headOnly = false } = {}) {
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const requestedPath = path.resolve(PUBLIC_DIR, relativePath);
    const rootWithSep = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : `${PUBLIC_DIR}${path.sep}`;
    if (requestedPath !== PUBLIC_DIR && !requestedPath.startsWith(rootWithSep)) {
        sendText(res, 403, 'Forbidden');
        return;
    }

    try {
        const stats = await fsp.stat(requestedPath);
        if (!stats.isFile()) {
            sendText(res, 404, 'Not Found');
            return;
        }
        const file = await fsp.readFile(requestedPath);
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(requestedPath).toLowerCase()] || 'application/octet-stream',
            'Content-Length': String(file.length)
        });
        res.end(headOnly ? undefined : file);
    } catch (_) {
        sendText(res, 404, 'Not Found');
    }
}

async function handleLyricsRequest(url, res, candidate = false) {
    const videoId = url.searchParams.get('videoId');
    const artist = url.searchParams.get('artist');
    const title = url.searchParams.get('title');
    const album = url.searchParams.get('album') || '';
    const duration = Number.parseFloat(url.searchParams.get('duration') || '0') || 0;
    const offset = Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0;
    const excludedLanguages = getTranslationExcludedLanguagesFromUrl(url);

    if (!videoId || !artist || !title) {
        sendJson(res, 400, { success: false, error: 'Missing required parameters: videoId, artist, title' });
        return;
    }
    if (getEffectiveMusicEligibilityForVideoId(videoId) === false) {
        sendJson(res, 404, { success: false, error: 'Lyrics disabled for non-music session' });
        return;
    }

    const lyricsBroadcast = makeLyricsBroadcastContext({ videoId, artist, title });
    const result = candidate
        ? await fetchLyricsCandidate(videoId, artist, title, album, duration, offset, lyricsBroadcast, { excludedLanguages })
        : await fetchLyrics(videoId, artist, title, album, duration, lyricsBroadcast, { excludedLanguages });
    const normalized = normalizeLyricsResultForFrontend(result);
    if (normalized.success) {
        sendJson(res, 200, normalized);
    } else {
        sendJson(res, 404, {
            success: false,
            error: normalized.error || (candidate ? 'No alternate lyrics found' : 'No lyrics found'),
            candidateOffset: normalized.candidateOffset,
            totalCandidates: normalized.totalCandidates
        });
    }
}

function normalizeSongData(input) {
    if (!input || typeof input !== 'object') return null;
    const videoId = input.videoId || input.id || null;
    if (!videoId) return null;
    return {
        ...input,
        videoId,
        elapsedSeconds: Number(input.elapsedSeconds ?? input.progress ?? 0) || 0,
        songDuration: Number(input.songDuration ?? input.duration ?? 0) || 0,
        isPaused: input.isPaused ?? false,
        isMusicEligible: typeof input.isMusicEligible === 'boolean' ? input.isMusicEligible : null,
        imageSrc: input.imageSrc || '',
        albumArtist: input.albumArtist || '',
        trackNumber: Number(input.trackNumber ?? 0) || 0,
        albumTrackCount: Number(input.albumTrackCount ?? 0) || 0,
        genres: Array.isArray(input.genres) ? input.genres : [],
        playbackType: input.playbackType || '',
        sampledAtMs: Number(input.sampledAtMs ?? input.serverReceivedAtMs ?? Date.now()) || Date.now()
    };
}

// --- Song update broadcasting ---

let lastSongSnapshot = null;
let lastProgressSecond = null;
let lastPlaybackPaused = null;
let pendingSongTimingGuardVideoId = null;
let pendingSongTimingGuardStartedAt = 0;
const NEW_SONG_TIMING_GUARD_MS = 1500;
const NEW_SONG_TIMING_GUARD_MAX_INITIAL_ELAPSED_SECONDS = 1.0;

function maybeBroadcastSongUpdate(songData) {
    const previousVideoId = String(latestSongData?.videoId || '').trim();
    const nextVideoId = String(songData?.videoId || '').trim();
    const nowMs = Date.now();
    const songChanged = !!nextVideoId && nextVideoId !== previousVideoId;

    if (songChanged) {
        pendingSongTimingGuardVideoId = nextVideoId;
        pendingSongTimingGuardStartedAt = nowMs;
    }

    const guardedSongData = (() => {
        const isGuardedVideo = pendingSongTimingGuardVideoId
            && nextVideoId
            && pendingSongTimingGuardVideoId === nextVideoId;
        if (!isGuardedVideo) return songData;

        const guardAgeMs = Math.max(0, nowMs - pendingSongTimingGuardStartedAt);
        const elapsedSeconds = Number(songData.elapsedSeconds);
        const shouldHoldAtStart = !songData.isPaused
            && Number.isFinite(elapsedSeconds)
            && elapsedSeconds > NEW_SONG_TIMING_GUARD_MAX_INITIAL_ELAPSED_SECONDS
            && guardAgeMs <= NEW_SONG_TIMING_GUARD_MS;

        if (shouldHoldAtStart) {
            return { ...songData, elapsedSeconds: 0, sampledAtMs: nowMs };
        }

        pendingSongTimingGuardVideoId = null;
        pendingSongTimingGuardStartedAt = 0;
        return songData;
    })();

    latestSongData = guardedSongData;
    const comparable = {
        videoId: guardedSongData.videoId,
        title: guardedSongData.title || '',
        artist: guardedSongData.artist || '',
        album: guardedSongData.album || '',
        imageSrc: guardedSongData.imageSrc || '',
        isPaused: !!guardedSongData.isPaused
    };

    const snapshotChanged = JSON.stringify(comparable) !== JSON.stringify(lastSongSnapshot);
    if (snapshotChanged) {
        if (songChanged) {
            const title = guardedSongData.title || 'Unknown';
            const artist = guardedSongData.artist || 'Unknown';
            const album = guardedSongData.album ? ` (${guardedSongData.album})` : '';
            logEvent('info', 'NOW-PLAYING', `${title} - ${artist}${album}`);
            fetchLyrics(
                guardedSongData.videoId,
                guardedSongData.artist || '',
                guardedSongData.title || '',
                guardedSongData.album || '',
                guardedSongData.songDuration || 0,
                makeLyricsBroadcastContext({
                    videoId: guardedSongData.videoId,
                    artist: guardedSongData.artist || '',
                    title: guardedSongData.title || ''
                }),
                { excludedLanguages: sharedTranslationExcludedLanguages }
            ).catch((err) => logEvent('error', 'LYRICS', `Fetch failed: ${err.message}`));
        }
        lastSongSnapshot = comparable;
        broadcast({ type: 'song_updated', data: guardedSongData });
    }

    const progressSecond = Math.floor(Number(guardedSongData.elapsedSeconds || 0));
    if (Number.isFinite(progressSecond) && progressSecond !== lastProgressSecond) {
        lastProgressSecond = progressSecond;
        broadcast({
            type: 'song_progress',
            data: {
                elapsedSeconds: guardedSongData.elapsedSeconds,
                songDuration: guardedSongData.songDuration,
                videoId: guardedSongData.videoId,
                isPaused: !!guardedSongData.isPaused,
                sampledAtMs: guardedSongData.sampledAtMs
            }
        });
    }

    const paused = !!guardedSongData.isPaused;
    if (paused !== lastPlaybackPaused) {
        lastPlaybackPaused = paused;
        broadcast({ type: 'playback_updated', data: guardedSongData });
    }
}

// --- HTTP server + WebSocket ---

const server = http.createServer(async (req, res) => {
    try {
        const url = getRequestUrl(req);
        const pathname = url.pathname;

        if (req.method === 'GET' && pathname === '/') {
            sendRedirect(res, '/lyrics');
            return;
        }

        if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/lyrics') {
            const html = await fsp.readFile(path.join(PUBLIC_DIR, 'lyrics.html'), 'utf8');
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': String(Buffer.byteLength(html))
            });
            res.end(req.method === 'HEAD' ? undefined : html);
            return;
        }

        if (req.method === 'GET' && pathname === '/api/song') {
            if (!latestSongData) {
                sendJson(res, 404, { error: 'No active media session' });
                return;
            }
            sendJson(res, 200, materializeSongDataForDispatch(latestSongData));
            return;
        }

        if (req.method === 'GET' && pathname === '/api/lyrics') {
            await handleLyricsRequest(url, res, false);
            return;
        }

        if (req.method === 'GET' && pathname === '/api/lyrics/candidate') {
            await handleLyricsRequest(url, res, true);
            return;
        }

        if (req.method === 'GET' && pathname === '/api/preferences/translation-exclusions') {
            sendJson(res, 200, { success: true, languages: sharedTranslationExcludedLanguages });
            return;
        }

        if (req.method === 'POST' && pathname === '/api/preferences/translation-exclusions') {
            const payload = await readRequestJson(req).catch(() => ({}));
            sharedTranslationExcludedLanguages = normalizeExcludedLanguageCodes(
                payload?.languages ?? payload?.translationExclude ?? []
            );
            broadcast({
                type: 'translation_exclusions_updated',
                data: { languages: sharedTranslationExcludedLanguages }
            });
            sendJson(res, 200, { success: true, languages: sharedTranslationExcludedLanguages });
            return;
        }

        if (req.method === 'GET' && pathname === '/api/image-proxy') {
            const imageUrl = url.searchParams.get('url');
            if (!imageUrl) {
                sendJson(res, 400, { error: 'URL parameter is required' });
                return;
            }
            const result = await fetchImage(imageUrl);
            res.writeHead(200, {
                'Content-Type': result.contentType || 'image/jpeg',
                'Cache-Control': 'public, max-age=3600',
                'Content-Length': String(result.data.length)
            });
            res.end(result.data);
            return;
        }

        if (pathname.startsWith('/api/')) {
            sendJson(res, 404, { error: 'Not Found' });
            return;
        }

        if (req.method === 'GET' || req.method === 'HEAD') {
            await serveStaticFile(url, res, { headOnly: req.method === 'HEAD' });
            return;
        }

        sendText(res, 405, 'Method Not Allowed');
    } catch (error) {
        logEvent('error', 'SERVER', `Request failed: ${error.message}`);
        if (!res.headersSent) sendJson(res, 500, { error: error.message });
        else res.end();
    }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    if (req.url && !req.url.startsWith('/ws')) {
        ws.close(1008, 'Unsupported websocket endpoint');
        return;
    }

    clients.add(ws);
    logEvent('info', 'WS', `Client connected (${clients.size} total)`);

    if (latestSongData && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'song_updated',
            data: materializeSongDataForDispatch(latestSongData)
        }));
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'translation_exclusions_updated',
            data: { languages: sharedTranslationExcludedLanguages }
        }));
    }

    ws.on('close', () => {
        clients.delete(ws);
        logEvent('info', 'WS', `Client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => clients.delete(ws));
});

// --- SMTC bridge ---

let smtcProcess = null;
let smtcReconnectTimeout = null;
let smtcReconnectAttempts = 0;
let smtcStdoutBuffer = '';
let resolvedSmtcHelperPath = null;
let attemptedHelperAutoBuild = false;
const BRIDGE_RECONNECT_BASE_DELAY_MS = 3000;
const BRIDGE_RECONNECT_MAX_DELAY_MS = 30000;

function getSmtcHelperCandidates() {
    const archStagingPath = path.resolve(__dirname, 'smtc-helper', `${process.arch}-staging`, 'lyrics-smtc-bridge.exe');
    const archSpecificPath = path.resolve(__dirname, 'smtc-helper', process.arch, 'lyrics-smtc-bridge.exe');
    const canonicalPath = path.resolve(__dirname, 'smtc-helper', 'lyrics-smtc-bridge.exe');
    return process.pkg
        ? [canonicalPath, archSpecificPath]
        : [archStagingPath, archSpecificPath, canonicalPath];
}

function resolveSmtcHelperPath() {
    if (resolvedSmtcHelperPath) return resolvedSmtcHelperPath;
    if (process.env.SMTC_HELPER_PATH) {
        resolvedSmtcHelperPath = process.env.SMTC_HELPER_PATH;
        return resolvedSmtcHelperPath;
    }

    const candidates = getSmtcHelperCandidates();

    if (!process.pkg) {
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                resolvedSmtcHelperPath = candidate;
                return resolvedSmtcHelperPath;
            }
        }
        resolvedSmtcHelperPath = candidates[0];
        return resolvedSmtcHelperPath;
    }

    try {
        let embeddedPath = null;
        let helperBytes = null;
        for (const candidate of candidates) {
            try {
                const bytes = fs.readFileSync(candidate);
                embeddedPath = candidate;
                helperBytes = bytes;
                break;
            } catch (_) {}
        }

        if (!embeddedPath || !helperBytes) {
            throw new Error(`Embedded helper not found for arch ${process.arch}`);
        }

        const hash = crypto.createHash('sha1').update(helperBytes).digest('hex').slice(0, 12);
        const outDir = path.join(os.tmpdir(), 'lyrics-smtc');
        const outPath = path.join(outDir, `lyrics-smtc-bridge-${hash}.exe`);
        fs.mkdirSync(outDir, { recursive: true });
        if (!fs.existsSync(outPath)) fs.writeFileSync(outPath, helperBytes);

        resolvedSmtcHelperPath = outPath;
        return resolvedSmtcHelperPath;
    } catch (error) {
        logEvent('error', 'SMTC', `Failed extracting helper exe: ${error.message}`);
        resolvedSmtcHelperPath = '';
        return resolvedSmtcHelperPath;
    }
}

function scheduleSmtcReconnect() {
    if (smtcReconnectTimeout) clearTimeout(smtcReconnectTimeout);
    const delay = Math.min(
        BRIDGE_RECONNECT_BASE_DELAY_MS * Math.pow(2, smtcReconnectAttempts),
        BRIDGE_RECONNECT_MAX_DELAY_MS
    );
    smtcReconnectAttempts += 1;
    smtcReconnectTimeout = setTimeout(startSmtcBridge, delay);
}

function handleSmtcPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.error) {
        logEvent('error', 'SMTC', payload.error);
        return;
    }

    if (payload.hasSession === false) {
        if (latestSongData) {
            latestSongData = { ...latestSongData, isPaused: true, sampledAtMs: Date.now() };
            lastPlaybackPaused = true;
            broadcast({ type: 'playback_updated', data: latestSongData });
        }
        return;
    }

    const songData = normalizeSongData({ ...payload, serverReceivedAtMs: Date.now() });
    if (songData) maybeBroadcastSongUpdate(songData);
}

function parseSmtcStdoutChunk(chunk) {
    smtcStdoutBuffer += chunk.toString();
    const lines = smtcStdoutBuffer.split(/\r?\n/);
    smtcStdoutBuffer = lines.pop() || '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            handleSmtcPayload(JSON.parse(trimmed));
        } catch (error) {
            logEvent('error', 'SMTC', `Invalid JSON from bridge: ${error.message}`);
        }
    }
}

function startSmtcBridge() {
    if (smtcProcess) return;

    let helperPath = resolveSmtcHelperPath();

    if (!process.pkg && (!helperPath || !fs.existsSync(helperPath))) {
        if (!attemptedHelperAutoBuild) {
            attemptedHelperAutoBuild = true;
            const targetArch = process.arch === 'arm64' ? 'arm64' : 'x64';
            logEvent('error', 'SMTC', `Helper exe not found. Please place lyrics-smtc-bridge.exe at: ${helperPath}`);
            logEvent('info', 'SMTC', `Build it with: dotnet publish SmtcBridge.csproj -c Release -r win-${targetArch} --self-contained`);
        }
        helperPath = resolveSmtcHelperPath();
    }

    if (!helperPath) {
        logEvent('error', 'SMTC', 'Helper path is empty');
        scheduleSmtcReconnect();
        return;
    }

    smtcStdoutBuffer = '';
    const child = spawn(helperPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    smtcProcess = child;

    child.stdout.on('data', parseSmtcStdoutChunk);
    child.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message) logEvent('info', 'SMTC', message);
    });
    child.on('spawn', () => {
        smtcReconnectAttempts = 0;
        logEvent('success', 'SMTC', 'Bridge started');
    });
    child.on('close', (code) => {
        smtcProcess = null;
        logEvent('error', 'SMTC', `Bridge exited (code ${code ?? 'unknown'})`);
        scheduleSmtcReconnect();
    });
    child.on('error', (error) => {
        smtcProcess = null;
        logEvent('error', 'SMTC', `Bridge failed to start: ${error.message}`);
        scheduleSmtcReconnect();
    });
}

// --- Start ---

server.listen(PORT, async () => {
    logEvent('success', 'SERVER', `Server running on http://127.0.0.1:${PORT}`);
    await initMusixmatch();
    startSmtcBridge();
});
