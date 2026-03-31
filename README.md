# lyrics-server

Windows-first local lyrics server that reads the active media session through SMTC, serves a browser lyrics UI, and streams now-playing updates over WebSocket.

This project combines:

- A Node.js server built with Hono
- A Windows SMTC bridge written in C#/.NET
- A browser UI in `public/` for live lyrics and now-playing display
- Lyrics lookup and caching powered by `lrclib.net`
- On-demand romanization for Japanese, Korean, and Chinese lyrics

## What It Does

- Detects the current system media session on Windows via `GlobalSystemMediaTransportControlsSessionManager`
- Exposes current song metadata through HTTP and WebSocket
- Fetches synced or plain lyrics from `lrclib.net`
- Caches lyrics to disk
- Serves a local lyrics page at `/lyrics`
- Includes a `/welcome` flow backed by sample data
- Proxies album artwork through `/api/v1/image-proxy`

## Requirements

- Windows 10 or Windows 11
- Node.js 18+
- npm
- .NET 8 SDK for local helper builds
- 7-Zip for packaged `.7z` builds

Notes:

- The SMTC bridge is Windows-specific and the main app is designed around it.
- `npm run dev` expects the helper to be built locally.

## Repository Layout

- `server.js`: Node entrypoint, HTTP routes, static serving, WebSocket server, SMTC helper process management
- `lib/lyrics.js`: lyrics fetching, normalization, caching, romanization
- `lib/image-proxy.js`: artwork proxy and in-memory image cache
- `public/`: browser UI assets
- `tools/smtc-bridge-cs/`: C# SMTC bridge project
- `scripts/build-smtc.js`: Windows packaging script

## Install

```powershell
npm install
```

## Run In Development

Build the Windows SMTC helper and start the server:

```powershell
npm run dev
```

Then open:

- `http://127.0.0.1:1312/lyrics`
- `http://127.0.0.1:1312/welcome`

## Build

Create a bundled Windows executable:

```powershell
npm run build
```

Useful variants:

```powershell
npm run build:x64
npm run build:gui
npm run build:bundle
```

Build outputs are written to `dist/`.

## HTTP API

### `GET /api/v1/song`

Returns the latest active media session snapshot.

Example response:

```json
{
  "videoId": "stable-song-id",
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "elapsedSeconds": 42.1,
  "songDuration": 215.5,
  "isPaused": false,
  "imageSrc": "data:image/png;base64,...",
  "sampledAtMs": 1710000000000
}
```

### `GET /api/v1/lyrics`

Query params:

- `videoId` required
- `artist` required
- `title` required
- `album` optional
- `duration` optional

Example:

```text
/api/v1/lyrics?videoId=abc123&artist=Utada%20Hikaru&title=First%20Love&album=First%20Love&duration=249
```

### `GET /api/v1/image-proxy`

Fetches and caches remote artwork by URL.

### `GET /api/v1/welcome-sample`

Returns sample song, lyrics, and audio payloads used by the welcome flow.

## WebSocket

Connect to:

```text
ws://127.0.0.1:1312/ws
```

Observed message types:

- `song_updated`
- `song_progress`
- `playback_updated`
- `lyrics_updated`

## Environment Variables

Common runtime variables:

- `PORT`: server port, default `1312`
- `PUBLIC_DIR`: override static asset directory
- `SMTC_HELPER_PATH`: explicit path to `lyrics-smtc-bridge.exe`
- `LYRICS_DIR`: lyrics cache directory, default `C:/tmp/lyrics`

Image cache tuning:

- `IMAGE_CACHE_TTL_MS`
- `IMAGE_MAX_SIZE_BYTES`
- `IMAGE_CACHE_MAX_ENTRIES`
- `IMAGE_CACHE_MAX_MEMORY_BYTES`
- `IMAGE_CACHE_CLEANUP_INTERVAL_MS`

Romanization tuning:

- `ROMANIZATION_IDLE_UNLOAD_MS`
- `ROMANIZATION_UNLOAD_IMMEDIATELY`
- `ROMANIZATION_FORCE_GC_AFTER_UNLOAD`
- `ROMANIZATION_INMEMORY_MAX_ENTRIES`

Logging and cache throttling:

- `LOG_REPEAT_TTL`
- `MAX_RECENT_LOG_KEYS`
- `LYRICS_CACHE_HIT_TTL`
- `MAX_RECENT_LYRICS_CACHE_HITS`

## Notes For Development

- The server starts the SMTC bridge automatically on boot.
- If the helper executable is missing, the server logs the expected output path and the `dotnet publish` command needed to build it.
- When packaged, the helper is embedded and extracted to a temp directory at runtime.
- CORS is enabled for all routes.

## Scripts

- `npm run dev`: build helper, then start `server.js`
- `npm run build:smtc:helper`: publish the C# SMTC bridge for `win-x64`
- `npm run build`: bundle and package the Windows app
- `npm run build:gui`: package without console window
- `npm run build:bundle`: create `bundle.js` with esbuild

## License

No license file is currently included in this repository.
