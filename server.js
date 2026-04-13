const { Hono } = require('hono');
const { cors } = require('hono/cors');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const WebSocket = require('ws');
const { WritableStream } = require('stream/web');
const { spawn } = require('child_process');

const { logEvent } = require('./lib/logger');
const {
    loadLyricsCacheFromDisk,
    fetchLyrics,
    fetchLyricsCandidate
} = require('./lib/lyrics');
const { fetchImage } = require('./lib/image-proxy');

const app = new Hono();
const PORT = process.env.PORT || 1312;
const PUBLIC_DIR = process.env.PUBLIC_DIR
    ? path.resolve(process.env.PUBLIC_DIR)
    : (process.pkg ? path.join(__dirname, 'public') : path.resolve('public'));
const SAMPLE_DIR = path.join(PUBLIC_DIR, 'welcome', 'sample');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.webmanifest': 'application/manifest+json',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.webm': 'audio/webm'
};

app.use('*', cors());

const clients = new Set();
let latestSongData = null;

async function readJsonFileSafe(filePath) {
    try {
        const raw = await fsp.readFile(filePath, 'utf8');
        if (!raw.trim()) return {};
        return JSON.parse(raw);
    } catch (_) {
        return {};
    }
}

async function buildLyricsVariantHtmlFromTemplate({
    title,
    bodyClass = '',
    bodyWrapperId = '',
    stylesheetHref,
    scriptHrefs = []
}) {
    const lyricsHtmlPath = path.join(PUBLIC_DIR, 'lyrics.html');
    let html = await fsp.readFile(lyricsHtmlPath, 'utf8');

    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
    html = html.replace(
        /<script[^>]*type=["']module["'][^>]*src=["']scripts\/lyrics\.js(?:\?[^"']*)?["'][^>]*><\/script>\s*/i,
        ''
    );

    const headAdditions = [
        `    <link rel="stylesheet" href="${stylesheetHref}">`,
        ...scriptHrefs.map((href) => `    <script type="module" src="${href}"></script>`)
    ].join('\n');
    html = html.replace('</head>', `${headAdditions}\n  </head>`);

    if (bodyClass || bodyWrapperId) {
        const bodyOpen = bodyClass ? `<body class="${bodyClass}">` : '<body>';
        html = html.replace('<body>', bodyOpen);
        if (bodyWrapperId) {
            html = html.replace(bodyOpen, `${bodyOpen}\n    <div id="${bodyWrapperId}">`);
            html = html.replace('</body>', '    </div>\n  </body>');
        }
    }

    html = html.replace(
        '<img id="song-info-cover" class="cover" src="" alt="Album Cover">',
        '<img id="song-info-cover" class="cover" src="/icons/album-cover-placeholder.png" alt="Album Cover">'
    );
    html = html
        .replace(/id="close-window-control"/g, 'id="close-dummy-control"')
        .replace(/id="close-window-btn"/g, 'id="close-dummy-btn"');
    return html;
}

async function buildWelcomeHtmlFromLyricsTemplate() {
    return buildLyricsVariantHtmlFromTemplate({
        title: 'Welcome!',
        stylesheetHref: '/welcome/welcome-tour.css',
        scriptHrefs: [
            '/welcome/welcome-song.js',
            '/welcome/welcome-tour.js'
        ]
    });
}

function broadcast(data) {
    const message = JSON.stringify(data);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

function materializeSongDataForDispatch(songData, nowMs = Date.now()) {
    if (!songData || typeof songData !== 'object') return songData;

    const sampledAtMs = Number(songData.sampledAtMs);
    const elapsedSeconds = Number(songData.elapsedSeconds);
    const songDuration = Number(songData.songDuration);
    const isPaused = !!songData.isPaused;

    if (!Number.isFinite(sampledAtMs) || !Number.isFinite(elapsedSeconds) || isPaused) {
        return songData;
    }

    const deltaSeconds = Math.max(0, (nowMs - sampledAtMs) / 1000);
    let projectedElapsed = elapsedSeconds + deltaSeconds;
    if (Number.isFinite(songDuration) && songDuration > 0) {
        projectedElapsed = Math.min(songDuration, projectedElapsed);
    }

    return {
        ...songData,
        elapsedSeconds: projectedElapsed,
        sampledAtMs: nowMs
    };
}

app.get('/api/v1/song', async (c) => {
    try {
        if (latestSongData) {
            return c.json(materializeSongDataForDispatch(latestSongData));
        }
        return c.json({ error: 'No active media session' }, 404);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
});

app.get('/api/v1/lyrics', async (c) => {
    try {
        const videoId = c.req.query('videoId');
        const artist = c.req.query('artist');
        const title = c.req.query('title');
        const album = c.req.query('album') || '';
        const duration = parseFloat(c.req.query('duration') || '0');
        const translationExcludedLanguages = String(c.req.query('translationExclude') || '')
            .split(/[,\s]+/g)
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean);

        if (!videoId || !artist || !title) {
            return c.json({ error: 'Missing required parameters: videoId, artist, title' }, 400);
        }

        const result = await fetchLyrics(videoId, artist, title, album, duration, broadcast, {
            excludedLanguages: translationExcludedLanguages
        });
        if (result.success) {
            return c.json(result);
        }

        return c.json({ success: false, error: result.error || 'No lyrics found' }, 404);
    } catch (error) {
        console.error('[LYRICS] Error fetching lyrics:', error);
        return c.json({ error: error.message }, 500);
    }
});

app.get('/api/v1/lyrics/candidate', async (c) => {
    try {
        const videoId = c.req.query('videoId');
        const artist = c.req.query('artist');
        const title = c.req.query('title');
        const album = c.req.query('album') || '';
        const duration = parseFloat(c.req.query('duration') || '0');
        const offset = parseInt(c.req.query('offset') || '0', 10);
        const translationExcludedLanguages = String(c.req.query('translationExclude') || '')
            .split(/[,\s]+/g)
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean);

        if (!videoId || !artist || !title) {
            return c.json({ error: 'Missing required parameters: videoId, artist, title' }, 400);
        }

        const result = await fetchLyricsCandidate(videoId, artist, title, album, duration, offset, broadcast, {
            excludedLanguages: translationExcludedLanguages
        });
        if (result.success) {
            return c.json(result);
        }

        return c.json({
            success: false,
            error: result.error || 'No alternate lyrics found',
            candidateOffset: result.candidateOffset ?? offset,
            totalCandidates: result.totalCandidates ?? 0
        }, 404);
    } catch (error) {
        console.error('[LYRICS] Error fetching alternate lyrics candidate:', error);
        return c.json({ error: error.message }, 500);
    }
});

app.get('/api/v1/image-proxy', async (c) => {
    try {
        const imageUrl = c.req.query('url');
        if (!imageUrl) {
            return c.json({ error: 'URL parameter is required' }, 400);
        }

        const result = await fetchImage(imageUrl);
        c.header('Content-Type', result.contentType || 'image/jpeg');
        c.header('Cache-Control', 'public, max-age=3600');
        c.header('Content-Length', String(result.data.length));
        return c.body(result.data);
    } catch (error) {
        console.error('Error in image proxy:', error);
        return c.json({
            error: 'Failed to fetch image',
            message: error.message
        }, error.response?.status || 500);
    }
});

app.get('/api/v1/welcome-sample', async (c) => {
    try {
        const [lyricPayload, songPayload] = await Promise.all([
            readJsonFileSafe(path.join(SAMPLE_DIR, 'lyric-sample.json')),
            readJsonFileSafe(path.join(SAMPLE_DIR, 'song-info-sample.json'))
        ]);

        const lyricsData = lyricPayload?.data || lyricPayload || {};
        const songInfoData = songPayload?.data || songPayload || {};

        return c.json({
            success: true,
            data: {
                songInfo: songInfoData,
                lyrics: lyricsData,
                audio: {
                    src: '/sample/audio-sample.webm',
                    serverStartedAtMs: Date.now()
                }
            }
        });
    } catch (error) {
        return c.json({ success: false, error: error.message }, 500);
    }
});

app.get('/lyrics', async (c) => {
    try {
        const html = await fsp.readFile(path.join(PUBLIC_DIR, 'lyrics.html'), 'utf8');
        return c.html(html);
    } catch (error) {
        console.error('Error serving lyrics.html:', error);
        return c.text('Error loading lyrics page', 500);
    }
});

app.get('/welcome', async (c) => {
    try {
        const html = await buildWelcomeHtmlFromLyricsTemplate();
        return c.html(html);
    } catch (error) {
        console.error('Error serving welcome.html:', error);
        return c.text('Error loading welcome page', 500);
    }
});

app.get('/', (c) => c.redirect('/lyrics'));

app.get('*', async (c) => {
    try {
        const url = new URL(c.req.url);
        if (url.pathname.startsWith('/api')) {
            return c.notFound();
        }

        const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const requestedPath = path.resolve(PUBLIC_DIR, relativePath);

        if (!requestedPath.startsWith(PUBLIC_DIR)) {
            return c.text('Forbidden', 403);
        }

        const stats = await fsp.stat(requestedPath);
        if (!stats.isFile()) {
            return c.notFound();
        }

        const ext = path.extname(requestedPath).toLowerCase();
        const file = await fsp.readFile(requestedPath);
        c.header('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        return c.body(file);
    } catch (_) {
        return c.notFound();
    }
});

function createNodeRequest(req) {
    const protocol = req.socket.encrypted ? 'https' : 'http';
    const host = req.headers.host || '127.0.0.1';
    const url = `${protocol}://${host}${req.url}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const entry of value) {
                if (entry !== undefined) {
                    headers.append(key, entry);
                }
            }
        } else {
            headers.set(key, value);
        }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const init = {
        method: req.method,
        headers,
        body: hasBody ? req : undefined
    };

    if (hasBody) {
        init.duplex = 'half';
    }

    return new Request(url, init);
}

const server = http.createServer((req, res) => {
    app.fetch(createNodeRequest(req))
        .then((response) => {
            const responseHeaders = Object.fromEntries(response.headers.entries());
            res.writeHead(response.status, responseHeaders);

            if (!response.body) {
                res.end();
                return;
            }

            response.body.pipeTo(new WritableStream({
                write(chunk) {
                    res.write(Buffer.from(chunk));
                },
                close() {
                    res.end();
                },
                abort(err) {
                    console.error('Response stream aborted:', err);
                    res.end();
                }
            })).catch((error) => {
                console.error('Error piping response:', error);
                res.end();
            });
        })
        .catch((error) => {
            console.error('Error handling request:', error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            res.end('Internal Server Error');
        });
});

const wss = new WebSocket.Server({ server });

function sendLatestStateToClient(client) {
    if (!client || client.readyState !== WebSocket.OPEN || !latestSongData) return;

    client.send(JSON.stringify({
        type: 'song_updated',
        data: materializeSongDataForDispatch(latestSongData)
    }));
}

wss.on('connection', (ws, req) => {
    if (req.url && !req.url.startsWith('/ws')) {
        ws.close(1008, 'Unsupported websocket endpoint');
        return;
    }

    clients.add(ws);
    logEvent('info', 'WS', `Client connected (${clients.size} total)`);
    sendLatestStateToClient(ws);

    ws.on('message', () => {
        // Lyrics page does not send control commands.
    });

    ws.on('close', () => {
        clients.delete(ws);
        logEvent('info', 'WS', `Client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => {
        clients.delete(ws);
    });
});

let lastSongSnapshot = null;
let lastProgressSecond = null;
let lastPlaybackPaused = null;

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
        imageSrc: input.imageSrc || '',
        albumArtist: input.albumArtist || '',
        trackNumber: Number(input.trackNumber ?? 0) || 0,
        albumTrackCount: Number(input.albumTrackCount ?? 0) || 0,
        genres: Array.isArray(input.genres) ? input.genres : [],
        playbackType: input.playbackType || '',
        sampledAtMs: Number(input.sampledAtMs ?? input.serverReceivedAtMs ?? Date.now()) || Date.now()
    };
}

function maybeBroadcastSongUpdate(songData) {
    latestSongData = songData;
    const comparable = {
        videoId: songData.videoId,
        title: songData.title || '',
        artist: songData.artist || '',
        album: songData.album || '',
        imageSrc: songData.imageSrc || '',
        isPaused: !!songData.isPaused
    };

    const snapshotChanged = JSON.stringify(comparable) !== JSON.stringify(lastSongSnapshot);
    if (snapshotChanged) {
        lastSongSnapshot = comparable;
        broadcast({ type: 'song_updated', data: songData });
    }

    const progressSecond = Math.floor(Number(songData.elapsedSeconds || 0));
    if (Number.isFinite(progressSecond) && progressSecond !== lastProgressSecond) {
        lastProgressSecond = progressSecond;
        broadcast({
            type: 'song_progress',
            data: {
                elapsedSeconds: songData.elapsedSeconds,
                songDuration: songData.songDuration,
                videoId: songData.videoId,
                isPaused: !!songData.isPaused,
                sampledAtMs: songData.sampledAtMs
            }
        });
    }

    const paused = !!songData.isPaused;
    if (paused !== lastPlaybackPaused) {
        lastPlaybackPaused = paused;
        broadcast({ type: 'playback_updated', data: songData });
    }
}

let smtcProcess = null;
let smtcReconnectTimeout = null;
let smtcReconnectAttempts = 0;
let smtcStdoutBuffer = '';
const BRIDGE_RECONNECT_BASE_DELAY_MS = 3000;
const BRIDGE_RECONNECT_MAX_DELAY_MS = 30000;
let resolvedSmtcHelperPath = null;
let attemptedHelperAutoBuild = false;

function getSmtcHelperCandidates() {
    const archStagingPath = path.resolve(__dirname, 'smtc-helper', `${process.arch}-staging`, 'lyrics-smtc-bridge.exe');
    const archSpecificPath = path.resolve(__dirname, 'smtc-helper', process.arch, 'lyrics-smtc-bridge.exe');
    const canonicalPath = path.resolve(__dirname, 'smtc-helper', 'lyrics-smtc-bridge.exe');

    if (process.pkg) {
        return [canonicalPath, archSpecificPath];
    }

    return [archStagingPath, archSpecificPath, canonicalPath];
}

function readEmbeddedHelperBytes(helperPath) {
    try {
        return fs.readFileSync(helperPath);
    } catch (_) {
        return null;
    }
}

function buildLocalSmtcHelperIfMissing(helperPath) {
    if (attemptedHelperAutoBuild) return;
    attemptedHelperAutoBuild = true;
    const targetArch = process.arch === 'arm64' ? 'arm64' : 'x64';
    logEvent('error', 'SMTC', `Helper exe not found. Please place lyrics-smtc-bridge.exe at: ${helperPath}`);
    logEvent('info', 'SMTC', `Build it on a machine with .NET 8 SDK: dotnet publish SmtcBridge.csproj -c Release -r win-${targetArch} --self-contained`);
}

function resolveSmtcHelperPath() {
    if (resolvedSmtcHelperPath) return resolvedSmtcHelperPath;
    if (process.env.SMTC_HELPER_PATH) {
        resolvedSmtcHelperPath = process.env.SMTC_HELPER_PATH;
        return resolvedSmtcHelperPath;
    }

    const helperCandidates = getSmtcHelperCandidates();

    if (!process.pkg) {
        for (const candidate of helperCandidates) {
            if (fs.existsSync(candidate)) {
                resolvedSmtcHelperPath = candidate;
                return resolvedSmtcHelperPath;
            }
        }
        resolvedSmtcHelperPath = helperCandidates[0];
        return resolvedSmtcHelperPath;
    }

    try {
        let embeddedPath = null;
        let helperBytes = null;

        for (const candidate of helperCandidates) {
            const bytes = readEmbeddedHelperBytes(candidate);
            if (bytes) {
                embeddedPath = candidate;
                helperBytes = bytes;
                break;
            }
        }

        if (!embeddedPath || !helperBytes) {
            throw new Error(`Embedded helper not found for arch ${process.arch}`);
        }
        const hash = crypto.createHash('sha1').update(helperBytes).digest('hex').slice(0, 12);
        const outDir = path.join(os.tmpdir(), 'lyrics-smtc');
        const outPath = path.join(outDir, `lyrics-smtc-bridge-${hash}.exe`);

        fs.mkdirSync(outDir, { recursive: true });
        if (!fs.existsSync(outPath)) {
            fs.writeFileSync(outPath, helperBytes);
        }

        resolvedSmtcHelperPath = outPath;
        return resolvedSmtcHelperPath;
    } catch (error) {
        logEvent('error', 'SMTC', `Failed extracting helper exe: ${error.message}`);
        resolvedSmtcHelperPath = '';
        return resolvedSmtcHelperPath;
    }
}

function scheduleSmtcReconnect() {
    if (smtcReconnectTimeout) {
        clearTimeout(smtcReconnectTimeout);
    }
    const delay = Math.min(
        BRIDGE_RECONNECT_BASE_DELAY_MS * Math.pow(2, smtcReconnectAttempts),
        BRIDGE_RECONNECT_MAX_DELAY_MS
    );
    smtcReconnectAttempts += 1;
    smtcReconnectTimeout = setTimeout(() => {
        startSmtcBridge();
    }, delay);
}

function handleSmtcPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.error) {
        logEvent('error', 'SMTC', payload.error);
        return;
    }

    if (payload.hasSession === false) {
        if (latestSongData) {
            latestSongData = {
                ...latestSongData,
                isPaused: true,
                sampledAtMs: Date.now()
            };
            lastPlaybackPaused = true;
            broadcast({ type: 'playback_updated', data: latestSongData });
        }
        return;
    }

    const songData = normalizeSongData({
        ...payload,
        serverReceivedAtMs: Date.now()
    });
    if (!songData) return;
    maybeBroadcastSongUpdate(songData);
}

function parseSmtcStdoutChunk(chunk) {
    smtcStdoutBuffer += chunk.toString();
    const lines = smtcStdoutBuffer.split(/\r?\n/);
    smtcStdoutBuffer = lines.pop() || '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const payload = JSON.parse(trimmed);
            handleSmtcPayload(payload);
        } catch (error) {
            logEvent('error', 'SMTC', `Invalid JSON from bridge: ${error.message}`);
        }
    }
}

function startSmtcBridge() {
    if (smtcProcess) return;

    let helperPath = resolveSmtcHelperPath();
    if (!process.pkg && (!helperPath || !fs.existsSync(helperPath))) {
        buildLocalSmtcHelperIfMissing(helperPath);
        helperPath = resolveSmtcHelperPath();
    }

    if (!helperPath) {
        logEvent('error', 'SMTC', 'Helper path is empty');
        scheduleSmtcReconnect();
        return;
    }
    smtcStdoutBuffer = '';
    const child = spawn(helperPath, [], {
        stdio: ['ignore', 'pipe', 'pipe']
    });
    smtcProcess = child;

    child.stdout.on('data', parseSmtcStdoutChunk);
    child.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
            logEvent('error', 'SMTC', message);
        }
    });

    child.on('spawn', () => {
        smtcReconnectAttempts = 0;
        logEvent('success', 'SMTC', `Bridge started (${helperPath})`);
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

loadLyricsCacheFromDisk().catch(() => {});

server.listen(PORT, () => {
    logEvent('success', 'SERVER', `Lyrics server running on http://127.0.0.1:${PORT}/lyrics`);
    const helperSource = process.pkg ? 'embedded asset' : resolveSmtcHelperPath();
    logEvent('info', 'SERVER', `SMTC helper source: ${helperSource}`);
    startSmtcBridge();
});
