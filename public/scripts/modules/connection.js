import { API_URL, MAX_RECONNECT_ATTEMPTS, state } from './config.js';
import { logMessage } from './utils.js';

let reconnectTimeoutId = null;

// Image proxy
export function getThumbnailUrl(originalUrl) {
    if (!originalUrl || originalUrl.startsWith('data:')) {
        return originalUrl || '';
    }
    const fullUrl = originalUrl.startsWith('http') ? originalUrl : `https:${originalUrl}`;
    return `${API_URL}/image-proxy?url=${encodeURIComponent(fullUrl)}`;
}

// WebSocket initialization
export function initWebSocket(messageHandler) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const overrideWsUrl = window.LYRICS_WS_URL;
    const wsUrl = overrideWsUrl || `${protocol}//${window.location.host}/ws`;

    try {
        state.ws = new WebSocket(wsUrl);

        state.ws.onopen = () => {
            console.log('WebSocket connected');
            state.reconnectAttempts = 0;
            if (reconnectTimeoutId) {
                clearTimeout(reconnectTimeoutId);
                reconnectTimeoutId = null;
            }
            if (logMessage) logMessage('Connected to server');
            try {
                window.dispatchEvent(new CustomEvent('lyrics-ws-open'));
            } catch (_) {
                // ignore environments without CustomEvent support
            }
        };

        state.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (messageHandler) {
                    messageHandler(message);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        state.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        state.ws.onclose = () => {
            console.log('WebSocket disconnected');
            if (logMessage) logMessage('Disconnected from server');
            if (messageHandler && state.currentSongData) {
                const pausedData = {
                    ...state.currentSongData,
                    isPaused: true
                };
                state.currentSongData = pausedData;
                messageHandler({ type: 'playback_updated', data: pausedData });
            }

            if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                state.reconnectAttempts++;
                if (reconnectTimeoutId) {
                    clearTimeout(reconnectTimeoutId);
                    reconnectTimeoutId = null;
                }
                reconnectTimeoutId = setTimeout(() => {
                    console.log(`Reconnecting... (attempt ${state.reconnectAttempts})`);
                    initWebSocket(messageHandler);
                    reconnectTimeoutId = null;
                }, 2000 * state.reconnectAttempts);
            }
        };
    } catch (error) {
        console.error('Failed to initialize WebSocket:', error);
    }
}
