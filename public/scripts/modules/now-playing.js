import { state, resetSongState } from './config.js';
import { getThumbnailUrl } from './connection.js';
import { fetchLyrics, updateLyricsDisplay } from './lyric.js';
import { refreshLyricDynamicTheme } from './lyric-dynamic-theme.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SONG_INFO_REVEAL_ANIMATION_MS = 1000;
const SONG_INFO_SWAP_OUT_MS = 260;
const FALLBACK_ALBUM_COVER_SRC = '/icons/album-cover-placeholder.png';
const LOCAL_PROGRESS_INTERVAL_MS = 250;

// ---------------------------------------------------------------------------
// Song-info animation state
// ---------------------------------------------------------------------------
let songInfoSwapTimer = null;
let songInfoRevealTimer = null;
let songInfoVisibilityFailSafeTimer = null;
let songInfoLaunchRecoveryTimer = null;
let pendingSongInfoRevealToken = 0;
let lyricsSongInfoUpdateToken = 0;
let pendingSongInfoContentKey = '';


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
    cover.onerror = () => {
        cover.onerror = null;
        cover.src = FALLBACK_ALBUM_COVER_SRC;
        cover.dataset.appliedImageSrc = FALLBACK_ALBUM_COVER_SRC;
    };
    cover.src = resolvedSrc;
    cover.dataset.appliedImageSrc = resolvedSrc;
}

// ---------------------------------------------------------------------------
// Song-info UI animation helpers
// ---------------------------------------------------------------------------
function cancelSongInfoSwapTimer() {
    if (songInfoSwapTimer) { clearTimeout(songInfoSwapTimer); songInfoSwapTimer = null; }
}
function cancelSongInfoRevealTimer() {
    if (songInfoRevealTimer) { clearTimeout(songInfoRevealTimer); songInfoRevealTimer = null; }
}
function cancelSongInfoVisibilityFailSafeTimer() {
    if (songInfoVisibilityFailSafeTimer) { clearTimeout(songInfoVisibilityFailSafeTimer); songInfoVisibilityFailSafeTimer = null; }
}
function cancelSongInfoLaunchRecoveryTimer() {
    if (songInfoLaunchRecoveryTimer) { clearTimeout(songInfoLaunchRecoveryTimer); songInfoLaunchRecoveryTimer = null; }
}
function clearPendingSongInfoReveal() {
    pendingSongInfoRevealToken = 0;
    window.__lyricsSongInfoRevealPendingUntil = 0;
}

function buildSongInfoContentKey(title, artist, thumbnailUrl) {
    return JSON.stringify([
        (title || '').toString(),
        (artist || '').toString(),
        (thumbnailUrl || '').toString().trim()
    ]);
}


function replaySongInfoReveal(songInfo, songInfoContent) {
    if (!songInfo || !songInfoContent) return;
    songInfo.classList.add('loaded');
    songInfo.classList.remove('no-transition');
    songInfoContent.classList.remove('transitioning-out', 'transitioning');
    songInfoContent.classList.remove('reveal-up');
    void songInfoContent.offsetHeight;
    songInfoContent.classList.add('reveal-up');
}

function scheduleSongInfoVisibilityFailSafe(songInfo, songInfoContent, updateToken, delayMs = 600) {
    if (!songInfo || !songInfoContent) return;
    cancelSongInfoVisibilityFailSafeTimer();
    songInfoVisibilityFailSafeTimer = setTimeout(() => {
        if (updateToken !== lyricsSongInfoUpdateToken) return;
        songInfo.classList.add('loaded');
        replaySongInfoReveal(songInfo, songInfoContent);
        pendingSongInfoRevealToken = 0;
        songInfoVisibilityFailSafeTimer = null;
    }, Math.max(0, Number(delayMs) || 0));
}

function scheduleSongInfoReveal(songInfo, songInfoContent, delayMs = 0) {
    if (!songInfo || !songInfoContent) return;
    cancelSongInfoRevealTimer();
    cancelSongInfoVisibilityFailSafeTimer();
    window.__lyricsSongInfoRevealPendingUntil = Date.now() + Math.max(0, Number(delayMs) || 0) + SONG_INFO_REVEAL_ANIMATION_MS;
    songInfoRevealTimer = setTimeout(() => {
        songInfoContent.classList.remove('transitioning-out', 'transitioning');
        replaySongInfoReveal(songInfo, songInfoContent);
        songInfoRevealTimer = null;
    }, Math.max(0, Number(delayMs) || 0));
}

function markSongInfoRevealPending(songInfo, songInfoContent, updateToken) {
    if (!songInfo || !songInfoContent) return;
    pendingSongInfoRevealToken = updateToken;
    songInfoContent.classList.remove('reveal-up');
    songInfoContent.classList.remove('transitioning-out');
    songInfoContent.classList.add('transitioning');
    scheduleSongInfoVisibilityFailSafe(songInfo, songInfoContent, updateToken);
}

export function settleLyricsSongInfoReveal() {
    if (!pendingSongInfoRevealToken) return;
    if (pendingSongInfoRevealToken !== lyricsSongInfoUpdateToken) {
        clearPendingSongInfoReveal();
        return;
    }
    const songInfo = document.getElementById('song-info');
    const songInfoContent = document.getElementById('song-info-content');
    if (!songInfo || !songInfoContent) { clearPendingSongInfoReveal(); return; }
    scheduleSongInfoReveal(songInfo, songInfoContent);
    clearPendingSongInfoReveal();
}

export function getRemainingSongInfoRevealMs() {
    const pendingUntil = Number(window.__lyricsSongInfoRevealPendingUntil || 0);
    if (!Number.isFinite(pendingUntil) || pendingUntil <= 0) return 0;
    return Math.max(0, pendingUntil - Date.now());
}

export function ensureLyricsSongInfoVisible() {
    const songInfo = document.getElementById('song-info');
    const songInfoContent = document.getElementById('song-info-content');
    if (!songInfo || !songInfoContent) return;
    if (document.body.classList.contains('no-song-playing')) return;
    const hasContent = (songInfoContent.textContent || '').trim().length > 0;
    if (!songInfo.classList.contains('loaded') && !hasContent) return;

    const isStuckHidden =
        !songInfo.classList.contains('loaded') ||
        songInfoContent.classList.contains('transitioning') ||
        songInfoContent.classList.contains('transitioning-out') ||
        !songInfoContent.classList.contains('reveal-up');

    if (isStuckHidden) {
        cancelSongInfoRevealTimer();
        cancelSongInfoVisibilityFailSafeTimer();
        replaySongInfoReveal(songInfo, songInfoContent);
        clearPendingSongInfoReveal();
    }
}

function scheduleSongInfoLaunchRecovery() {
    cancelSongInfoLaunchRecoveryTimer();
    songInfoLaunchRecoveryTimer = setTimeout(() => {
        songInfoLaunchRecoveryTimer = null;
        ensureLyricsSongInfoVisible();
    }, 900);
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
    const { animate = false, isMainApp = false, trustedTiming = false } = options;

    if (!data || !data.title || !data.artist) {
        document.body.classList.add('no-song-playing');
        const songInfo = document.getElementById(isMainApp ? 'nowplaying' : 'song-info');
        const songInfoContent = document.getElementById('song-info-content');
        if (songInfo) {
            if (isMainApp) {
                songInfo.style.display = 'none';
            } else {
                cancelSongInfoSwapTimer();
                if (songInfoContent) {
                    songInfoContent.classList.remove('transitioning-out', 'transitioning', 'reveal-up');
                }
                cancelSongInfoRevealTimer();
                cancelSongInfoVisibilityFailSafeTimer();
                clearPendingSongInfoReveal();
                pendingSongInfoContentKey = '';
                delete songInfo.dataset.contentKey;
                songInfo.classList.remove('loaded');
            }
        }
        return;
    }

    const thumbnailUrl = resolveDisplayCoverSrc(data.imageSrc);
    if (isMainApp) {
        updateMainAppUI(data, thumbnailUrl);
    } else {
        updateLyricsAppUI(data, thumbnailUrl, animate);
        scheduleSongInfoLaunchRecovery();
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

function updateLyricsAppUI(data, thumbnailUrl, animate) {
    const songInfo = document.getElementById('song-info');
    const songInfoContent = document.getElementById('song-info-content');
    const titleEl = document.getElementById('song-info-title');
    const artistEl = document.getElementById('song-info-artist');
    const cover = document.getElementById('song-info-cover');
    const ambientBg = document.getElementById('ambient-bg');
    if (!songInfo || !titleEl || !artistEl || !cover) return;

    const nextThumbnailUrl = (thumbnailUrl || '').toString().trim();
    const currentAppliedThumbnailUrl = (cover.dataset.appliedImageSrc || '').trim();
    const currentAmbientThumbnailUrl = (ambientBg?.dataset.appliedImageSrc || '').trim();
    const updateToken = ++lyricsSongInfoUpdateToken;
    const isFirstLoad = !songInfo.classList.contains('loaded');
    const nextContentKey = buildSongInfoContentKey(data.title, data.artist, nextThumbnailUrl);
    const currentContentKey =
        songInfo.dataset.contentKey ||
        buildSongInfoContentKey(titleEl.textContent, artistEl.textContent, currentAppliedThumbnailUrl);

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

    const contentChanged =
        currentContentKey !== nextContentKey;
    const shouldAnimate = contentChanged && animate && !isFirstLoad;
    const isAnimatingSameTarget =
        pendingSongInfoContentKey === nextContentKey &&
        (
            !!songInfoSwapTimer ||
            pendingSongInfoRevealToken === updateToken - 1 ||
            songInfoContent?.classList.contains('transitioning') ||
            songInfoContent?.classList.contains('transitioning-out')
        );

    if (isAnimatingSameTarget) {
        if (!window.manuallyPaused) {
            document.body.classList.toggle('paused', !!data.isPaused);
        }
        return;
    }

    cancelSongInfoSwapTimer();
    cancelSongInfoRevealTimer();
    cancelSongInfoVisibilityFailSafeTimer();
    clearPendingSongInfoReveal();
    if (songInfoContent) {
        songInfoContent.classList.remove('transitioning-out', 'transitioning', 'reveal-up');
    }

    if (shouldAnimate && songInfoContent) {
        pendingSongInfoContentKey = nextContentKey;
        songInfo.classList.add('loaded');
        songInfoContent.classList.add('transitioning-out');
        songInfoSwapTimer = setTimeout(() => {
            if (updateToken !== lyricsSongInfoUpdateToken) return;
            markSongInfoRevealPending(songInfo, songInfoContent, updateToken);
            titleEl.textContent = data.title;
            artistEl.textContent = data.artist;
            applyCoverImage(cover, nextThumbnailUrl);
            songInfo.dataset.contentKey = nextContentKey;
            refreshLyricDynamicTheme({ imageSrc: nextThumbnailUrl });
            songInfoSwapTimer = null;
        }, SONG_INFO_SWAP_OUT_MS);
    } else {
        pendingSongInfoContentKey = '';
        titleEl.textContent = data.title;
        artistEl.textContent = data.artist;
        applyCoverImage(cover, nextThumbnailUrl);
        songInfo.dataset.contentKey = nextContentKey;
        refreshLyricDynamicTheme({ imageSrc: nextThumbnailUrl });
        if (isFirstLoad || animate || !songInfo.classList.contains('loaded')) {
            markSongInfoRevealPending(songInfo, songInfoContent, updateToken);
        } else {
            songInfo.classList.add('loaded');
        }
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

    const displayData = {
        ...state.currentSongData,
        ...data,
        title: Object.prototype.hasOwnProperty.call(data, 'title')
            ? (data.title || '')
            : (state.currentSongData?.title || ''),
        artist: Object.prototype.hasOwnProperty.call(data, 'artist')
            ? (data.artist || '')
            : (state.currentSongData?.artist || ''),
        imageSrc: Object.prototype.hasOwnProperty.call(data, 'imageSrc')
            ? (data.imageSrc || '')
            : ((!songChanged ? state.currentSongData?.imageSrc : '') || ''),
        album: Object.prototype.hasOwnProperty.call(data, 'album')
            ? (data.album || '')
            : (state.currentSongData?.album || '')
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

        if (displayData.artist && displayData.title) {
            fetchLyrics(
                displayData.artist,
                displayData.title,
                displayData.album || '',
                displayData.songDuration || 0,
                onLyricsDisplay,
                onLyricsHide
            );
        } else if (loadingEl) {
            loadingEl.classList.remove('active');
        }
    } else if (
        data.videoId &&
        data.videoId !== state.lastFetchedVideoId &&
        data.videoId !== state.currentFetchVideoId &&
        displayData.artist &&
        displayData.title
    ) {
        console.log('[LYRICS] Fetching lyrics for current song (mid-song load)');
        fetchLyrics(
            displayData.artist,
            displayData.title,
            displayData.album || '',
            displayData.songDuration || 0,
            onLyricsDisplay,
            onLyricsHide
        );
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
        animate: songChanged,
        isMainApp,
        trustedTiming: incomingElapsed !== null
    });

    if (data.isPaused) {
        stopProgressTracking();
    } else if (songChanged || !state.currentSongData) {
        startProgressTracking(data);
    }
}
