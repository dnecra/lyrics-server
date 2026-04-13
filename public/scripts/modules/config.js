// Configuration and shared state
export const API_URL = '/api/v1';
export const MAX_RECONNECT_ATTEMPTS = 10;

// Shared state
export const state = {
    currentVideoId: null,
    currentLyrics: [],
    isSyncedLyrics: false,
    lastFetchedVideoId: null,
    currentFetchVideoId: null,
    lastLyricsRequestKey: null,
    lyricsCandidateOffset: 0,
    lyricsCandidateTotal: 0,
    isPaused: false,
    currentSongData: null,
    currentPlayingIndex: null,
    
    // WebSocket
    ws: null,
    reconnectAttempts: 0,
    
    // Timers
    lyricsTimer: null,
    progressTimer: null,
    // Queue (main app only)
    rawQueueData: null,
    processedQueueData: null,
    previousQueueLength: 0,
    shouldScrollToBottom: false,
    newlyAddedIndex: null,
    highlightTimeout: null,
    scrollTimeout: null,
    failedItems: [],
    draggedItem: null,
    draggedIndex: null,
    
    // UI state (main app only)
    isCursorOnPage: false,
    lyricsManuallyCollapsed: false,
    lyricsAutoCollapsed: false,
    suppressLyricsAutoExpand: false,
    lastUpdateTime: 0,
    lastProgressUpdate: 0,
    lastServerProgressAt: 0,
    serverProgressBaseAt: 0,
    serverProgressBaseElapsed: 0,
    playbackAnchorAt: 0,
    playbackAnchorElapsed: 0,
    
    // Volume
    isUserAdjustingVolume: false,
    lastLocalVolumeUpdateMs: 0,
    serverVolumeScale: 'percent',
    lastVolumeSentAt: 0,
    lastVolumeSentValue: null,
    volumeDebounceTimer: null,
    
    // Mobile
    mobileSection: 'right'
};

// Reset state for new song
export function resetSongState() {
    state.currentLyrics = [];
    state.isSyncedLyrics = false;
    state.lastFetchedVideoId = null;
    state.currentFetchVideoId = null;
    state.lastLyricsRequestKey = null;
    state.lyricsCandidateOffset = 0;
    state.lyricsCandidateTotal = 0;
    state.lastProgressUpdate = 0;
    state.lastServerProgressAt = 0;
    state.serverProgressBaseAt = 0;
    state.serverProgressBaseElapsed = 0;
    state.playbackAnchorAt = 0;
    state.playbackAnchorElapsed = 0;
}
