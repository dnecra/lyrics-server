import { state, resetSongState } from './config.js';
import { getThumbnailUrl } from './connection.js';
import { fetchLyrics, updateLyricsDisplay } from './lyric.js';
import { refreshLyricDynamicTheme } from './lyric-dynamic-theme.js';

const FALLBACK_ALBUM_COVER_SRC = '/icons/album-cover-placeholder.png';
const LOCAL_PROGRESS_INTERVAL_MS = 250;


// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------
function normalizeIncomingImageSrc(imageSrc) {
    const rawImageSrc = (imageSrc || '').toString().trim();
    if (!rawImageSrc) return '';
    if (rawImageSrc.startsWith('data:')) return rawImageSrc;
    if (rawImageSrc.startsWith('http://') || rawImageSrc.startsWith('https://')) return rawImageSrc;
    if (rawImageSrc.startsWith('//')) return `https:${rawImageSrc}`;
    return '';
}

function resolveDisplayCoverSrc(imageSrc) {
    const normalized = normalizeIncomingImageSrc(imageSrc);
    const proxied = getThumbnailUrl(normalized);
    return proxied || FALLBACK_ALBUM_COVER_SRC;
}

function applyCoverImage(cover, imageSrc) {
    if (!cover) return;
    const resolvedSrc = (imageSrc || '').toString().trim() || FALLBACK_ALBUM_COVER_SRC;
    const currentSrc = (cover.dataset.appliedImageSrc || '').trim();
    if (currentSrc === resolvedSrc) return;

    const pendingToken = `${Date.now()}-${Math.random()}`;
    cover.dataset.pendingImageSrc = resolvedSrc;
    cover.dataset.pendingImageToken = pendingToken;
    const shouldRevealActualCover =
        currentSrc === FALLBACK_ALBUM_COVER_SRC &&
        resolvedSrc !== FALLBACK_ALBUM_COVER_SRC;

    const commitImage = (nextSrc, expectedToken = pendingToken) => {
        if (cover.dataset.pendingImageToken !== expectedToken) return;
        cover.onerror = () => {
            cover.onerror = null;
            cover.src = FALLBACK_ALBUM_COVER_SRC;
            cover.dataset.appliedImageSrc = FALLBACK_ALBUM_COVER_SRC;
        };
        cover.src = nextSrc;
        cover.dataset.appliedImageSrc = nextSrc;
        delete cover.dataset.pendingImageSrc;
        delete cover.dataset.pendingImageToken;
        if (shouldRevealActualCover && nextSrc !== FALLBACK_ALBUM_COVER_SRC && typeof cover.animate === 'function') {
            if (typeof cover.getAnimations === 'function') {
                cover.getAnimations().forEach((animation) => animation.cancel());
            }
            cover.animate(
                [
                    { opacity: 0.18 },
                    { opacity: 1 }
                ],
                {
                    duration: 500,
                    easing: 'ease-out'
                }
            );
        }
    };

    if (resolvedSrc === FALLBACK_ALBUM_COVER_SRC) {
        commitImage(resolvedSrc);
        return;
    }

    const preloader = new Image();
    preloader.onload = () => commitImage(resolvedSrc);
    preloader.onerror = () => commitImage(FALLBACK_ALBUM_COVER_SRC);
    preloader.src = resolvedSrc;
}

function buildSongInfoContentKey(title, artist) {
    return JSON.stringify([
        (title || '').toString(),
        (artist || '').toString()
    ]);
}

function hasSongInfoTextContent(songInfoContent) {
    return ((songInfoContent?.textContent) || '').trim().length > 0;
}

function normalizeSongText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function buildLyricsRequestKey(songData) {
    if (!songData || !songData.videoId) return '';
    return JSON.stringify([
        String(songData.videoId).trim(),
        normalizeSongText(songData.artist),
        normalizeSongText(songData.title),
        String(songData.album || '').trim(),
        Number(songData.songDuration || 0) || 0
    ]);
}

function requestLyricsIfReady(songData, onLyricsDisplay, onLyricsHide) {
    const videoId = typeof songData?.videoId === 'string' ? songData.videoId.trim() : '';
    const artist = normalizeSongText(songData?.artist);
    const title = normalizeSongText(songData?.title);
    if (!videoId || !artist || !title) return false;

    const requestKey = buildLyricsRequestKey(songData);
    const hasLyricsForCurrentSong =
        state.currentVideoId === videoId &&
        state.lastFetchedVideoId === videoId &&
        Array.isArray(state.currentLyrics) &&
        state.currentLyrics.length > 0;

    if (hasLyricsForCurrentSong) return false;
    if (state.currentFetchVideoId === videoId) return false;
    if (state.lastLyricsRequestKey === requestKey) return false;

    state.lastLyricsRequestKey = requestKey;
    fetchLyrics(
        artist,
        title,
        songData.album || '',
        songData.songDuration || 0,
        onLyricsDisplay,
        onLyricsHide
    );
    return true;
}

function playSongInfoFadeIn(songInfoContent) {
    if (!songInfoContent || typeof songInfoContent.animate !== 'function') return;
    if (typeof songInfoContent.getAnimations === 'function') {
        songInfoContent.getAnimations().forEach((animation) => animation.cancel());
    }
    songInfoContent.animate(
        [
            { opacity: 0.2 },
            { opacity: 1 }
        ],
        {
            duration: 220,
            easing: 'ease-out'
        }
    );
}

export function ensureLyricsSongInfoVisible() {
    const songInfo = document.getElementById('song-info');
    if (!songInfo) return;
    if (document.body.classList.contains('no-song-playing')) return;
    const songInfoContent = document.getElementById('song-info-content');
    if (!hasSongInfoTextContent(songInfoContent)) return;
    songInfo.classList.add('loaded');
}

function replayAmbientBgReveal(ambientBg) {
    if (!ambientBg) return;
    ambientBg.classList.remove('cover-transition');
    void ambientBg.offsetHeight;
    requestAnimationFrame(() => {
        ambientBg.classList.add('cover-transition');
        requestAnimationFrame(() => requestAnimationFrame(() => {
            ambientBg.classList.remove('cover-transition');
        }));
    });
}

function stopProgressTracking() {
    if (state.progressTimer) {
        clearInterval(state.progressTimer);
        state.progressTimer = null;
    }
}

function resolvePlaybackAnchorAt(songData, nowMs = Date.now()) {
    const sampledAtMs = Number(songData?.sampledAtMs);
    return Number.isFinite(sampledAtMs) && sampledAtMs > 0 ? sampledAtMs : nowMs;
}

function syncPlaybackAnchor(songData, nowMs = Date.now()) {
    const elapsedSeconds = Number(songData?.elapsedSeconds);
    if (!Number.isFinite(elapsedSeconds)) return;

    const anchorAt = resolvePlaybackAnchorAt(songData, nowMs);
    state.playbackAnchorAt = anchorAt;
    state.playbackAnchorElapsed = elapsedSeconds;
    state.serverProgressBaseAt = anchorAt;
    state.serverProgressBaseElapsed = elapsedSeconds;
    state.lastServerProgressAt = nowMs;
    state.lastProgressUpdate = elapsedSeconds;
}

function getEstimatedElapsedSeconds(nowMs) {
    const now = Number(nowMs) || Date.now();
    const currentElapsed = Number(state.currentSongData?.elapsedSeconds) || 0;
    const baseAt = Number(state.playbackAnchorAt) || Number(state.serverProgressBaseAt) || 0;
    const baseElapsed = Number.isFinite(Number(state.playbackAnchorElapsed))
        ? Number(state.playbackAnchorElapsed)
        : Number(state.serverProgressBaseElapsed);

    if (baseAt > 0 && Number.isFinite(baseElapsed)) {
        const deltaSeconds = Math.max(0, (now - baseAt) / 1000);
        return baseElapsed + deltaSeconds;
    }

    return currentElapsed;
}

function startProgressTracking(songData) {
    if (!songData) return;
    stopProgressTracking();

    if (!state.currentSongData || state.currentSongData.videoId !== songData.videoId) {
        state.currentSongData = { ...songData };
    }

    if (state.currentSongData.isPaused) return;

    state.progressTimer = setInterval(() => {
        if (!state.currentSongData || state.currentSongData.isPaused) return;

        const now = Date.now();
        const duration = Number(state.currentSongData.songDuration) || 0;
        let nextElapsed = getEstimatedElapsedSeconds(now);

        if (duration > 0 && nextElapsed > duration) {
            nextElapsed = duration;
            stopProgressTracking();
        }

        state.currentSongData.elapsedSeconds = nextElapsed;
        updateLyricsDisplay(nextElapsed);
    }, LOCAL_PROGRESS_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Now-playing UI (shared)
// ---------------------------------------------------------------------------
export function updateNowPlayingUI(data, options = {}) {
    const { isMainApp = false, trustedTiming = false } = options;
    const hasVideoId = typeof data?.videoId === 'string' && data.videoId.trim().length > 0;

    if (!data || !hasVideoId) {
        document.body.classList.add('no-song-playing');
        const songInfo = document.getElementById(isMainApp ? 'nowplaying' : 'song-info');
        if (songInfo) {
            if (isMainApp) {
                songInfo.style.display = 'none';
            } else {
                delete songInfo.dataset.contentKey;
                songInfo.classList.remove('loaded');
            }
        }
        return;
    }

    if (!data.title || !data.artist) {
        document.body.classList.remove('no-song-playing');
        if (!isMainApp) {
            const songInfo = document.getElementById('song-info');
            const songInfoContent = document.getElementById('song-info-content');
            if (songInfo && hasSongInfoTextContent(songInfoContent)) {
                songInfo.classList.add('loaded');
                state.isPaused = data.isPaused;
                return;
            }
        }
    }

    const thumbnailUrl = resolveDisplayCoverSrc(data.imageSrc);
    if (isMainApp) {
        updateMainAppUI(data, thumbnailUrl);
    } else {
        updateLyricsAppUI(data, thumbnailUrl);
    }

    state.isPaused = data.isPaused;
    document.body.classList.remove('no-song-playing');
    if (data.elapsedSeconds !== undefined) {
        updateLyricsDisplay(data.elapsedSeconds, { trustedTiming });
    }
}

function updateMainAppUI(data, thumbnailUrl) {
    const nowPlayingDiv = document.getElementById('nowplaying');
    if (nowPlayingDiv) {
        document.getElementById('nowplaying-title').textContent = data.title;
        document.getElementById('nowplaying-artist').textContent = data.artist;
        const nowThumb = document.getElementById('nowplaying-thumbnail');
        if (nowThumb) nowThumb.src = thumbnailUrl || FALLBACK_ALBUM_COVER_SRC;
        nowPlayingDiv.style.display = 'flex';
    }
    const rightTitle = document.getElementById('right-now-playing-title');
    const rightArtist = document.getElementById('right-now-playing-artist');
    const rightCover = document.getElementById('right-now-playing-cover');
    const rightBgBlur = document.getElementById('right-bg-blur');
    if (rightTitle) rightTitle.textContent = data.title;
    if (rightArtist) rightArtist.textContent = data.artist;
    if (rightCover) rightCover.src = thumbnailUrl || FALLBACK_ALBUM_COVER_SRC;
    if (rightBgBlur) {
        rightBgBlur.style.backgroundImage = thumbnailUrl ? `url('${thumbnailUrl}')` : 'none';
        rightBgBlur.classList.toggle('paused', !!data.isPaused);
    }
    const playPauseIcon = document.getElementById('play-pause-icon');
    const rightPlayPauseIcon = document.getElementById('right-play-pause-icon');
    if (playPauseIcon) playPauseIcon.textContent = data.isPaused ? 'play_arrow' : 'pause';
    if (rightPlayPauseIcon) rightPlayPauseIcon.textContent = data.isPaused ? 'play_arrow' : 'pause';
}

function updateLyricsAppUI(data, thumbnailUrl) {
    const songInfo = document.getElementById('song-info');
    const songInfoContent = document.getElementById('song-info-content');
    const titleEl = document.getElementById('song-info-title');
    const artistEl = document.getElementById('song-info-artist');
    const cover = document.getElementById('song-info-cover');
    const ambientBg = document.getElementById('ambient-bg');
    if (!songInfo || !songInfoContent || !titleEl || !artistEl || !cover) return;

    const nextThumbnailUrl = (thumbnailUrl || '').toString().trim();
    const currentAppliedThumbnailUrl = (cover.dataset.appliedImageSrc || '').trim();
    const currentAmbientThumbnailUrl = (ambientBg?.dataset.appliedImageSrc || '').trim();
    const wasLoaded = songInfo.classList.contains('loaded');
    const nextContentKey = buildSongInfoContentKey(data.title, data.artist);
    const currentContentKey =
        songInfo.dataset.contentKey ||
        buildSongInfoContentKey(titleEl.textContent, artistEl.textContent);

    if (ambientBg) {
        if (currentAmbientThumbnailUrl !== nextThumbnailUrl) {
            ambientBg.style.backgroundImage = nextThumbnailUrl ? `url('${nextThumbnailUrl}')` : 'none';
            ambientBg.dataset.appliedImageSrc = nextThumbnailUrl;
            replayAmbientBgReveal(ambientBg);
        }
        if (!window.manuallyPaused) {
            ambientBg.classList.toggle('paused', !!data.isPaused);
        }
    }

    const contentChanged = currentContentKey !== nextContentKey;
    if (contentChanged) {
        titleEl.textContent = data.title;
        artistEl.textContent = data.artist;
        applyCoverImage(cover, nextThumbnailUrl);
        songInfo.dataset.contentKey = nextContentKey;
        refreshLyricDynamicTheme({ imageSrc: nextThumbnailUrl });
    } else if (currentAppliedThumbnailUrl !== nextThumbnailUrl) {
        applyCoverImage(cover, nextThumbnailUrl);
    }

    songInfo.classList.add('loaded');
    if (wasLoaded && contentChanged) {
        playSongInfoFadeIn(songInfoContent);
    }

    if (!window.manuallyPaused) {
        document.body.classList.toggle('paused', !!data.isPaused);
    }
}

// ---------------------------------------------------------------------------
// Main update entry-point (called from WebSocket messages + HTTP re-fetch)
// ---------------------------------------------------------------------------
export async function updateNowPlayingFromData(data, handlers = {}) {
    if (!data) return;

    const {
        isMainApp = false,
        onSongChange = null,
        onLyricsDisplay = null,
        onLyricsHide = null
    } = handlers;

    const hasVideoId = typeof data.videoId === 'string' && data.videoId.trim().length > 0;
    if (!hasVideoId) {
        // Ignore partial song payloads so transient backend states do not clear/reset lyrics UI.
        if (state.currentSongData) {
            state.currentSongData = { ...state.currentSongData, ...data };
        }
        return;
    }

    const songChanged = data.videoId !== state.currentVideoId;
    const nowMs = Date.now();
    const hasElapsed = Number.isFinite(Number(data.elapsedSeconds));
    const incomingElapsed = hasElapsed ? Number(data.elapsedSeconds) : null;

    const previousSongData = songChanged ? null : state.currentSongData;
    const displayData = {
        ...(previousSongData || {}),
        ...data,
        title: Object.prototype.hasOwnProperty.call(data, 'title')
            ? (normalizeSongText(data.title) || (previousSongData?.title || ''))
            : (previousSongData?.title || ''),
        artist: Object.prototype.hasOwnProperty.call(data, 'artist')
            ? (normalizeSongText(data.artist) || (previousSongData?.artist || ''))
            : (previousSongData?.artist || ''),
        imageSrc: Object.prototype.hasOwnProperty.call(data, 'imageSrc')
            ? (data.imageSrc || '')
            : (previousSongData?.imageSrc || ''),
        album: Object.prototype.hasOwnProperty.call(data, 'album')
            ? (data.album || '')
            : (previousSongData?.album || '')
    };

    if (songChanged) {
        stopProgressTracking();
        state.currentVideoId = data.videoId;
        resetSongState();
        state.currentSongData = { ...displayData };
        if (incomingElapsed !== null) {
            syncPlaybackAnchor(data, nowMs);
        }

        if (onSongChange) onSongChange(data);

        // Clear lyrics containers
        const syncedEl = document.getElementById('synced-lyrics');
        const plainEl = document.getElementById('plain-lyrics');
        const loadingEl = document.getElementById('lyrics-loading');
        if (syncedEl) { syncedEl.innerHTML = ''; syncedEl.style.display = 'none'; }
        if (plainEl) { plainEl.innerHTML = ''; plainEl.style.display = 'none'; }
        if (loadingEl) { loadingEl.style.display = ''; loadingEl.classList.add('active'); }

        if (!requestLyricsIfReady(displayData, onLyricsDisplay, onLyricsHide) && loadingEl) {
            loadingEl.classList.remove('active');
        }
    } else if (
        requestLyricsIfReady(displayData, onLyricsDisplay, onLyricsHide)
    ) {
        console.log('[LYRICS] Fetching lyrics for current song (mid-song load)');
    } else if (incomingElapsed !== null) {
        syncPlaybackAnchor(data, nowMs);
    }

    if (songChanged) {
        startProgressTracking(data);
    } else if (state.currentSongData) {
        state.currentSongData = { ...state.currentSongData, ...data };
        if (state.currentSongData.isPaused) {
            stopProgressTracking();
        } else {
            startProgressTracking(state.currentSongData);
        }
    }

    updateNowPlayingUI(displayData, {
        isMainApp,
        trustedTiming: incomingElapsed !== null
    });

    if (data.isPaused) {
        stopProgressTracking();
    } else if (songChanged || !state.currentSongData) {
        startProgressTracking(data);
    }
}
