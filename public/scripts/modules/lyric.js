import { API_URL, state } from './config.js';

let lastRenderedLyricIndex = -1;
let lastRenderedLyricsExpanded = null;
const MUSIC_NOTE_SYMBOL = '\u266A';
const GAP_FILL_BASE_THRESHOLD_SECONDS = 20;
const GAP_FILL_THRESHOLD_PER_WORD_SECONDS = 1;
const FINAL_BLANK_MIN_GAP_SECONDS = 3;
const FINAL_BLANK_TARGET_GAP_SECONDS = 5;
const ACTIVE_LYRIC_TIME_OFFSET_SECONDS = 0;
const AUTO_CENTER_LEAD_SECONDS = 0.12;
const SYNCED_LYRIC_PARSE_OFFSET_SECONDS = 1.0;
const LYRIC_BACKWARD_SEEK_THRESHOLD_SECONDS = 2.0;
const AUTO_CENTER_TOLERANCE_PX = 3;
const AUTO_CENTER_RETARGET_DEADZONE_PX = 2;
const AUTO_CENTER_ANIMATION_DURATION_MS = 220;
const AUTO_CENTER_ANIMATION_FAST_DURATION_MS = 120;
let lyricLineElements = [];
let lyricsRenderVersion = 0;
let lastStableLyricEffectiveTime = null;
let latchedBlankCutoffIndex = -1;
const LYRIC_DISPLAY_MODES = new Set(['scroll', 'fixed-3', 'fixed-2', 'fixed-1']);
let currentLyricDisplayMode = 'scroll';
let lastRenderedLyricDisplayMode = 'scroll';
let compactNoLyricsLeavingTimer = null;
let compactNoLyricsEnteringTimer = null;
const activeScrollAnimations = new WeakMap();

function setCompactNoLyricsState(enabled) {
    const body = document.body;
    if (!body) return;

    if (compactNoLyricsEnteringTimer) {
        clearTimeout(compactNoLyricsEnteringTimer);
        compactNoLyricsEnteringTimer = null;
    }

    if (compactNoLyricsLeavingTimer) {
        clearTimeout(compactNoLyricsLeavingTimer);
        compactNoLyricsLeavingTimer = null;
    }

    if (enabled) {
        if (body.classList.contains('compact-no-lyrics') && !body.classList.contains('compact-no-lyrics-leaving')) {
            body.classList.remove('compact-no-lyrics-entering');
            return;
        }

        body.classList.remove('compact-no-lyrics-leaving');
        body.classList.add('compact-no-lyrics');
        body.classList.add('compact-no-lyrics-entering');
        compactNoLyricsEnteringTimer = setTimeout(() => {
            body.classList.remove('compact-no-lyrics-entering');
            compactNoLyricsEnteringTimer = null;
        }, 220);
        return;
    }

    if (!body.classList.contains('compact-no-lyrics')) {
        body.classList.remove('compact-no-lyrics-entering');
        body.classList.remove('compact-no-lyrics-leaving');
        return;
    }

    body.classList.remove('compact-no-lyrics-entering');
    body.classList.remove('compact-no-lyrics');
    body.classList.add('compact-no-lyrics-leaving');
    compactNoLyricsLeavingTimer = setTimeout(() => {
        body.classList.remove('compact-no-lyrics-leaving');
        compactNoLyricsLeavingTimer = null;
    }, 220);
}

function isBlankCutoffEnabledForCurrentPage() {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const isPhoneLayout = !!document.documentElement?.classList?.contains('is-phone-layout');
    if (viewportWidth <= 767 || isPhoneLayout) {
        return false;
    }
    return !!window.__lyricsBlankCutoffEnabled;
}

function getLeadingGhostLinesCountForCurrentPage() {
    const raw = Number(window.__lyricsLeadingGhostLinesCount);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.floor(raw));
}

function countLyricWords(text) {
    if (!text || typeof text !== 'string') return 0;
    const trimmed = text.trim();
    if (!trimmed || trimmed === MUSIC_NOTE_SYMBOL) return 0;
    const tokens = trimmed.match(/\S+/g) || [];
    let count = 0;
    for (const token of tokens) {
        const normalized = token.replace(/^[^0-9A-Za-z\u00C0-\u024F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7A3]+|[^0-9A-Za-z\u00C0-\u024F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7A3]+$/g, '');
        if (normalized) count += 1;
    }
    return count;
}

function refreshLyricLineElements() {
    lyricLineElements = Array.from(document.querySelectorAll('#synced-lyrics .lyric-line, #plain-lyrics .lyric-line'))
        .sort((a, b) => {
            const aIndex = Number.parseInt(a?.dataset?.index || '-1', 10);
            const bIndex = Number.parseInt(b?.dataset?.index || '-1', 10);
            return aIndex - bIndex;
        });
    return lyricLineElements;
}

function clearLyricLineElementsCache() {
    lyricLineElements = [];
}

function normalizeLyricDisplayMode(mode) {
    if (typeof mode !== 'string') return 'scroll';
    const normalized = mode.trim().toLowerCase();
    return LYRIC_DISPLAY_MODES.has(normalized) ? normalized : 'scroll';
}

function updateLyricDisplayModeDomState(mode) {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return;
    lyricsContainer.dataset.lyricDisplayMode = mode;
    const isFixedMode = mode !== 'scroll';
    lyricsContainer.classList.toggle('fixed-line-mode', isFixedMode);
    lyricsContainer.classList.toggle('scroll-line-mode', !isFixedMode);
}

function shouldShowLineForDisplayMode(mode, currentIndex, lineIndex) {
    if (!Number.isFinite(currentIndex) || currentIndex < 0) {
        if (mode === 'fixed-3') return lineIndex <= 2;
        if (mode === 'fixed-2') return lineIndex <= 1;
        if (mode === 'fixed-1') return lineIndex === 0;
        return true;
    }
    if (mode === 'fixed-3') return Math.abs(lineIndex - currentIndex) <= 1;
    // fixed-2: show current (top, active) + next (bottom, inactive)
    if (mode === 'fixed-2') return lineIndex === currentIndex || lineIndex === (currentIndex + 1);
    if (mode === 'fixed-1') return lineIndex === currentIndex;
    return true;
}

function reorderFixedModeVisibleLines(mode, currentIndex, lines) {
    if (!Array.isArray(lines) || lines.length === 0) return;
    if (!Number.isFinite(currentIndex) || currentIndex < 0) return;
    if (mode === 'scroll' || mode === 'fixed-1') return;

    const parent = lines[0]?.parentElement;
    if (!parent) return;

    const targetOrder = mode === 'fixed-2'
        ? [currentIndex, currentIndex + 1]
        : [currentIndex - 1, currentIndex, currentIndex + 1];

    targetOrder.forEach((index) => {
        if (!Number.isFinite(index) || index < 0) return;
        const line = lines[index];
        if (!line || line.parentElement !== parent) return;
        if (line.classList.contains('fixed-hidden')) return;
        parent.appendChild(line);
    });
}

function restoreNaturalLyricDomOrder(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return;
    const parent = lines[0]?.parentElement;
    if (!parent) return;

    [...lines]
        .sort((a, b) => {
            const aIndex = Number.parseInt(a?.dataset?.index || '-1', 10);
            const bIndex = Number.parseInt(b?.dataset?.index || '-1', 10);
            return aIndex - bIndex;
        })
        .forEach((line) => {
            if (line?.parentElement === parent) {
                parent.appendChild(line);
            }
        });
}

export function getLyricDisplayMode() {
    return currentLyricDisplayMode;
}

export function setLyricDisplayMode(mode, { refresh = true } = {}) {
    const nextMode = normalizeLyricDisplayMode(mode);
    const modeChanged = currentLyricDisplayMode !== nextMode;
    currentLyricDisplayMode = nextMode;
    updateLyricDisplayModeDomState(nextMode);

    if (!modeChanged) return currentLyricDisplayMode;

    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsContainer && nextMode !== 'scroll') {
        const scrollContainer = getLyricsScrollContainer(lyricsContainer);
        if (scrollContainer) scrollContainer.scrollTop = 0;
    }

    if (refresh) {
        const elapsed = Number(state?.currentSongData?.elapsedSeconds);
        if (Number.isFinite(elapsed) && elapsed >= 0) {
            updateLyricsDisplay(elapsed);
        }
    }

    return currentLyricDisplayMode;
}

function getLyricsScrollContainer(lyricsContainer) {
    if (!lyricsContainer) return null;
    const viewport = lyricsContainer.querySelector('#lyrics-content');
    return viewport || lyricsContainer;
}

function getOffsetTopWithinContainer(element, container) {
    let node = element;
    let top = 0;
    while (node && node !== container) {
        top += node.offsetTop || 0;
        node = node.offsetParent;
    }
    if (node === container) return top;
    return element.offsetTop || 0;
}

function getStableCenterAnchor(lineElement) {
    if (!lineElement) return null;
    return lineElement.querySelector('.text-lyrics') || lineElement;
}

function getStableCenterTargetTop(lineElement, scrollContainer) {
    if (!lineElement || !scrollContainer) return 0;

    const anchorElement = getStableCenterAnchor(lineElement);
    if (!anchorElement) return 0;

    const anchorOffsetTop = getOffsetTopWithinContainer(anchorElement, scrollContainer);
    const targetTop = anchorOffsetTop - (scrollContainer.clientHeight / 2);
    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);

    return Math.max(0, Math.min(maxScrollTop, targetTop));
}

function smoothScrollContainerTo(container, targetTop, behavior = 'smooth') {
    if (!container) return;
    if (Math.abs((container.scrollTop || 0) - targetTop) <= AUTO_CENTER_TOLERANCE_PX) return;

    if (behavior !== 'smooth') {
        const existingAnimation = activeScrollAnimations.get(container);
        if (existingAnimation?.rafId) {
            cancelAnimationFrame(existingAnimation.rafId);
        }
        activeScrollAnimations.delete(container);
        container.scrollTop = targetTop;
        return;
    }

    const existingAnimation = activeScrollAnimations.get(container);
    const existingTargetTop = Number(existingAnimation?.targetTop);
    if (Number.isFinite(existingTargetTop) && Math.abs(existingTargetTop - targetTop) < AUTO_CENTER_RETARGET_DEADZONE_PX) {
        return;
    }

    if (existingAnimation?.rafId) {
        cancelAnimationFrame(existingAnimation.rafId);
    }

    const startTop = Number(container.scrollTop) || 0;
    const delta = targetTop - startTop;
    if (Math.abs(delta) <= AUTO_CENTER_TOLERANCE_PX) {
        activeScrollAnimations.delete(container);
        container.scrollTop = targetTop;
        return;
    }

    const durationMs = Math.abs(delta) >= 140
        ? AUTO_CENTER_ANIMATION_FAST_DURATION_MS
        : AUTO_CENTER_ANIMATION_DURATION_MS;
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const animationState = {
        rafId: 0,
        targetTop
    };
    activeScrollAnimations.set(container, animationState);

    const startTime = performance.now();
    const tick = (now) => {
        const latestAnimation = activeScrollAnimations.get(container);
        if (latestAnimation !== animationState) return;

        const progress = Math.max(0, Math.min(1, (now - startTime) / durationMs));
        const eased = easeOutCubic(progress);
        container.scrollTop = startTop + (delta * eased);

        if (progress >= 1) {
            container.scrollTop = targetTop;
            activeScrollAnimations.delete(container);
            return;
        }

        animationState.rafId = requestAnimationFrame(tick);
    };

    // Start immediately so the motion does not feel delayed.
    tick(startTime);
}

export function centerActiveLyricLineStrict(currentIndex, lyricsContainer, options = {}) {
    if (!lyricsContainer || currentIndex < 0) return;
    if (lyricsContainer.classList.contains('collapsed')) return;

    const behavior = options?.behavior === 'instant' ? 'instant' : 'smooth';

    const scrollContainer = getLyricsScrollContainer(lyricsContainer);
    if (!scrollContainer) return;

    const lineElement = lyricsContainer.querySelector(`.lyric-line[data-index="${currentIndex}"]`);
    if (!lineElement) return;

    const targetTop = getStableCenterTargetTop(lineElement, scrollContainer);
    if (Math.abs(scrollContainer.scrollTop - targetTop) <= AUTO_CENTER_TOLERANCE_PX) return;

    smoothScrollContainerTo(scrollContainer, targetTop, behavior);
}

function getWordStaggerSeconds(wordCount, { romanized = false } = {}) {
    const safeWordCount = Math.max(1, Number(wordCount) || 1);
    // Keep stagger clearly visible; previous values were too small and looked simultaneous.
    const baseMs = romanized ? 360 : 520;
    const minMs = romanized ? 45 : 70;
    const maxMs = romanized ? 130 : 180;
    const staggerMs = Math.max(minMs, Math.min(maxMs, baseMs / safeWordCount));
    return staggerMs / 1000;
}

function applyActiveWordStagger(lineElement) {
    if (!lineElement) return;
    const words = lineElement.querySelectorAll('.lyric-word');
    if (!words.length) return;

    const staggerSeconds = getWordStaggerSeconds(words.length);
    words.forEach((word, index) => {
        const delay = `${(index * staggerSeconds).toFixed(3)}s`;
        word.style.willChange = 'opacity, transform';
        word.style.transitionDelay = delay;
        word.style.animationDelay = delay;
    });
}

function queueActivatingCurrentCleanup(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setTimeout(() => {
                lines.forEach((line) => line.classList.remove('activating-current'));
            }, 50);
        });
    });
}

function findCurrentLyricIndexAtTime(lines, time) {
    if (!Array.isArray(lines) || lines.length === 0) return -1;
    const safeTime = Math.max(0, Number(time) || 0);

    let currentIndex = -1;
    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const midTime = Number(lines[mid]?.time);
        const safeMidTime = Number.isFinite(midTime) ? midTime : 0;
        if (safeMidTime <= safeTime) {
            currentIndex = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return currentIndex;
}

function applyDynamicLineAnimationVars(lineElement, durationMs) {
    if (!lineElement) return;

    const parsedCount = Number.parseInt(lineElement.dataset.wordCount || '0', 10);
    const wordCount = Math.max(1, Number.isFinite(parsedCount) ? parsedCount : 1);
    const safeDurationMs = Math.max(200, Number(durationMs) || 200);

    // Longer lines get a gentler, floatier wobble window.
    const wordFactor = Math.min(1.6, 0.9 + (wordCount * 0.07));
    const wobbleDurationMs = Math.min(
        1800,
        Math.max(420, Math.round((safeDurationMs * 0.38) * wordFactor))
    );
    const glowDurationMs = Math.max(500, Math.round(safeDurationMs * 0.72));

    lineElement.style.setProperty('--lyrics-wobble-duration', `${wobbleDurationMs}ms`);
    lineElement.style.setProperty('--lyrics-glow-duration', `${glowDurationMs}ms`);
}

function applyLineTimingStyles(lineElement, index) {
    if (!lineElement || !state.currentLyrics || state.currentLyrics.length === 0) return;
    const lyricLine = state.currentLyrics[index];
    const lineTime = lyricLine?.time ?? 0;
    const nextLineTime = (index < state.currentLyrics.length - 1)
        ? (state.currentLyrics[index + 1]?.time ?? (lineTime + 2))
        : (lineTime + 2);
    const durationMs = Math.max(200, (nextLineTime - lineTime) * 1000);
    lineElement.style.setProperty('--lyrics-duration', `${durationMs}ms`);
    applyDynamicLineAnimationVars(lineElement, durationMs);
    const textLyrics = lineElement.querySelector('.text-lyrics');
    if (textLyrics) {
        textLyrics.style.setProperty('--lyrics-duration', `${durationMs}ms`);
    }
}

// Language detection
export function hasJapanese(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
}

export function hasKorean(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\uAC00-\uD7A3]/.test(text);
}

export function hasChinese(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u4E00-\u9FFF]+/.test(text);
}

export function isNonLatin(text) {
    if (!text || typeof text !== 'string') return false;
    return hasJapanese(text) || hasKorean(text) || hasChinese(text);
}

export function addRomanizedText(lineElement, romanizedText) {
    const existing = lineElement.querySelector('.romanized');
    if (existing) {
        existing.remove();
    }

    const romanizedSpan = document.createElement('span');
    romanizedSpan.className = 'romanized';

    const parts = String(romanizedText).split(/(\s+)/).filter(p => p.length > 0);
    const wordParts = parts.filter(part => !/^\s+$/.test(part));
    const staggerSeconds = getWordStaggerSeconds(wordParts.length, { romanized: true });

    parts.forEach(part => {
        if (/^\s+$/.test(part)) {
            romanizedSpan.appendChild(document.createTextNode(part));
        } else {
            const w = document.createElement('span');
            w.className = 'lyric-word romanized-word';
            const wordIndex = romanizedSpan.querySelectorAll('.romanized-word').length;
            const delay = wordIndex * staggerSeconds;
            w.style.transitionDelay = `${delay}s`;
            w.style.animationDelay = `${delay}s`;
            w.textContent = part;
            romanizedSpan.appendChild(w);
        }
    });

    const wordContainer = lineElement.querySelector('.lyric-words');
    if (wordContainer && wordContainer.parentNode) {
        wordContainer.parentNode.insertBefore(romanizedSpan, wordContainer);
        return;
    }

    const textLyrics = lineElement.querySelector('.text-lyrics');
    if (textLyrics) {
        textLyrics.insertBefore(romanizedSpan, textLyrics.firstChild);
    } else {
        lineElement.insertBefore(romanizedSpan, lineElement.firstChild);
    }
}

export function addLyricTranslation(lineElement, translationText) {
    const existing = lineElement.querySelector('.lyric-translation');
    if (existing) {
        existing.remove();
    }

    const translationSpan = document.createElement('span');
    translationSpan.className = 'lyric-translation';
    const parts = String(translationText || '').split(/(\s+)/).filter(p => p.length > 0);
    const wordParts = parts.filter(part => !/^\s+$/.test(part));
    const staggerSeconds = getWordStaggerSeconds(wordParts.length, { romanized: true });

    if (wordParts.length === 0) {
        return;
    }

    parts.forEach(part => {
        if (/^\s+$/.test(part)) {
            translationSpan.appendChild(document.createTextNode(part));
        } else {
            const w = document.createElement('span');
            w.className = 'lyric-word translation-word';
            const wordIndex = translationSpan.querySelectorAll('.translation-word').length;
            const delay = wordIndex * staggerSeconds;
            w.style.transitionDelay = `${delay}s`;
            w.style.animationDelay = `${delay}s`;
            w.textContent = part;
            translationSpan.appendChild(w);
        }
    });

    const wordContainer = lineElement.querySelector('.lyric-words');
    const romanized = lineElement.querySelector('.romanized');
    if (romanized && romanized.parentNode) {
        romanized.parentNode.insertBefore(translationSpan, romanized.nextSibling);
        return;
    }

    if (wordContainer && wordContainer.parentNode) {
        wordContainer.parentNode.insertBefore(translationSpan, wordContainer);
        return;
    }

    const textLyrics = lineElement.querySelector('.text-lyrics');
    if (textLyrics) {
        textLyrics.insertBefore(translationSpan, textLyrics.firstChild);
    } else {
        lineElement.insertBefore(translationSpan, lineElement.firstChild);
    }
}

// Lyrics fetching
export async function fetchLyrics(artist, title, album = '', duration = 0, onSuccess, onError) {
    const normalizeVideoId = (v) => (v === undefined || v === null) ? '' : String(v).trim();
    const fetchVideoId = normalizeVideoId(state.currentVideoId);
    if (!fetchVideoId) {
        console.log('[LYRICS] No video ID available, skipping fetch');
        return;
    }

    state.currentFetchVideoId = fetchVideoId;
    console.log(`[LYRICS] Requesting lyrics from server: "${title}" by "${artist}" (videoId: ${fetchVideoId})`);

    const isSameSong = () => normalizeVideoId(state.currentVideoId) === fetchVideoId;
    const isFetchStillValid = () => {
        if (!isSameSong()) return false;
        const currentFetch = normalizeVideoId(state.currentFetchVideoId);
        // Allow same-song late results when no active fetch marker is set.
        return currentFetch === fetchVideoId || currentFetch === '';
    };
    const hasDisplayedLyricsForCurrentSong = () => {
        return state.currentVideoId === fetchVideoId
            && state.lastFetchedVideoId === fetchVideoId
            && Array.isArray(state.currentLyrics)
            && state.currentLyrics.length > 0;
    };

    const FETCH_TIMEOUT_MS = 15000;
    const isTransientStatus = (status) => [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
    const isTransientError = (error) => {
        const name = String(error?.name || '').toLowerCase();
        const message = String(error?.message || '').toLowerCase();
        return name === 'abortederror'
            || name === 'timeouterror'
            || message.includes('timed out')
            || message.includes('timeout')
            || message.includes('networkerror')
            || message.includes('failed to fetch');
    };

    try {
        const params = new URLSearchParams({
            videoId: fetchVideoId,
            artist: artist,
            title: title,
            album: album || '',
            duration: duration.toString()
        });

        const response = await fetch(`${API_URL}/lyrics?${params.toString()}`, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });

        if (!response.ok) {
            console.warn(`[LYRICS] Server returned error: ${response.status}`);
            if (isTransientStatus(response.status)) {
                // Keep current lyrics visible and wait for late server-side broadcast.
                state.currentFetchVideoId = null;
                return;
            }
            if (hasDisplayedLyricsForCurrentSong()) {
                // Do not hide existing lyrics due to re-fetch failure for the same song.
                state.currentFetchVideoId = null;
                return;
            }
            throw new Error('No lyrics found');
        }

        const result = await response.json();
        if (!result.success || !result.data) {
            console.warn(`[LYRICS] No lyrics found for "${title}" by "${artist}"`);
            if (hasDisplayedLyricsForCurrentSong()) {
                state.currentFetchVideoId = null;
                return;
            }
            throw new Error('No lyrics found');
        }

        const data = result.data;
        if (!isFetchStillValid()) {
            if (!isSameSong()) {
                console.log('[LYRICS] Fetch completed but song changed; ignoring result');
            } else {
                console.log('[LYRICS] Fetch completed but request context changed; ignoring stale result');
            }
            return;
        }

        if (onSuccess) {
            onSuccess(data, fetchVideoId);
        }
    } catch (error) {
        if (!isFetchStillValid()) {
            if (!isSameSong()) {
                console.log('[LYRICS] Fetch error but song changed; ignoring');
            } else {
                console.log('[LYRICS] Fetch error from stale request context; ignoring');
            }
            return;
        }
        if (isTransientError(error)) {
            console.warn('[LYRICS] Fetch timed out/transient error; keeping current lyrics and waiting for server push');
            // Allow future fetch attempts while keeping UI state intact.
            state.currentFetchVideoId = null;
            return;
        }
        if (hasDisplayedLyricsForCurrentSong()) {
            console.warn('[LYRICS] Non-transient fetch error for current song; keeping existing lyrics visible');
            state.currentFetchVideoId = null;
            return;
        }
        console.warn('[LYRICS] Error fetching lyrics:', error.message);
        if (onError) {
            onError();
        }
    }
}

// Lyrics display update
export function updateLyricsDisplay(currentTime, options = {}) {
    const { trustedTiming = false } = options;
    const numericTime = Number(currentTime);
    if (!Number.isFinite(numericTime)) return;
    currentTime = Math.max(0, numericTime);

    const rawEffectiveTime = Math.max(0, currentTime - ACTIVE_LYRIC_TIME_OFFSET_SECONDS);
    let didBackwardSeek = false;
    const effectiveTime = (() => {
        const prev = Number(lastStableLyricEffectiveTime);
        if (!Number.isFinite(prev)) {
            lastStableLyricEffectiveTime = rawEffectiveTime;
            return rawEffectiveTime;
        }
        if (rawEffectiveTime >= prev) {
            lastStableLyricEffectiveTime = rawEffectiveTime;
            return rawEffectiveTime;
        }

        const backwardDelta = prev - rawEffectiveTime;
        if (!trustedTiming && backwardDelta <= LYRIC_BACKWARD_SEEK_THRESHOLD_SECONDS) {
            return prev;
        }

        didBackwardSeek = true;
        lastStableLyricEffectiveTime = rawEffectiveTime;
        return rawEffectiveTime;
    })();

    if (!state.currentLyrics || state.currentLyrics.length === 0) return;

    const lyricsLength = state.currentLyrics.length;
    let currentIndex = findCurrentLyricIndexAtTime(state.currentLyrics, effectiveTime);

    // Keep the frontend-injected leading placeholder active from 0s until the
    // first actual lyric line starts, so the opening blank row never looks inactive.
    if (lyricsLength > 0 && effectiveTime >= 0) {
        let leadingSyntheticIndex = -1;
        let firstActualLineTime = null;

        for (let i = 0; i < lyricsLength; i += 1) {
            const line = state.currentLyrics[i];
            if (line?.isLeadingSynthetic) {
                if (!line?.isGhostLeadingSynthetic) {
                    leadingSyntheticIndex = i;
                }
                continue;
            }

            const lineTime = Number(line?.time);
            firstActualLineTime = Number.isFinite(lineTime) ? lineTime : 0;
            break;
        }

        if (
            leadingSyntheticIndex >= 0
            && Number.isFinite(firstActualLineTime)
            && effectiveTime < firstActualLineTime
        ) {
            currentIndex = leadingSyntheticIndex;
        }
    }

    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return;

    const displayMode = normalizeLyricDisplayMode(currentLyricDisplayMode);
    updateLyricDisplayModeDomState(displayMode);
    const isExpanded = lyricsContainer.classList.contains('expanded');
    const leadingGhostCountForPage = getLeadingGhostLinesCountForCurrentPage();

    const hasActiveLineChanged = lastRenderedLyricIndex !== currentIndex;
    const hasExpandedModeChanged = lastRenderedLyricsExpanded !== isExpanded;
    const hasDisplayModeChanged = lastRenderedLyricDisplayMode !== displayMode;
    if (!hasActiveLineChanged && !hasExpandedModeChanged && !hasDisplayModeChanged) {
        return;
    }

    const shouldAnimateActiveLine = hasActiveLineChanged;
    let lines = lyricLineElements;
    if (!lines || lines.length === 0) {
        lines = refreshLyricLineElements();
    }
    if (state.currentLyrics.length > 0 && lines.length !== state.currentLyrics.length) {
        lines = refreshLyricLineElements();
    }
    const isLyricsDomReady =
        Array.isArray(lines)
        && lines.length > 0
        && lines.length === state.currentLyrics.length;
    if (!isLyricsDomReady) {
        // Startup progress / websocket updates can arrive after lyric data is set
        // but before the corresponding DOM lines are mounted. Do not cache the
        // current render state yet, or fixed-line mode can skip the first real pass.
        return;
    }

    const isFrontendBlankNote = (line) => {
        const text = (line?.text || '').toString().trim();
        const isNote = text === MUSIC_NOTE_SYMBOL;
        const isBlankLike = !!line?.isEmpty || !!line?.isSourceBlank || text === '';
        return isBlankLike
            && (isNote || text === '')
            && !line?.isLeadingSynthetic;
    };
    const latestBlankCutoffIndex = (() => {
        let idx = -1;
        for (let i = 0; i < state.currentLyrics.length; i += 1) {
            if (i <= currentIndex && isFrontendBlankNote(state.currentLyrics[i])) {
                idx = i;
            }
        }
        return idx;
    })();
    if (isBlankCutoffEnabledForCurrentPage()) {
        if (didBackwardSeek) {
            latchedBlankCutoffIndex = latestBlankCutoffIndex;
        } else if (latestBlankCutoffIndex > latchedBlankCutoffIndex) {
            latchedBlankCutoffIndex = latestBlankCutoffIndex;
        }
    } else {
        latchedBlankCutoffIndex = -1;
    }
    const activeBlankCutoffIndex = latchedBlankCutoffIndex;
    const shouldApplyBlankCutoff = isBlankCutoffEnabledForCurrentPage() && activeBlankCutoffIndex >= 0;

    if (hasActiveLineChanged || hasExpandedModeChanged || hasDisplayModeChanged) {
        lines.forEach((line, index) => {
            line.classList.remove('current', 'previous', 'upcoming', 'before', 'after', 'far-before', 'far-after', 'activating-current');
            line.classList.remove('hidden-after-blank', 'fixed-hidden', 'fixed-secondary');
            const relation = getLyricLineRelation(currentIndex, index);
            line.dataset.lineRelation = relation;

            if (index < currentIndex) {
                line.classList.add('previous');
            } else if (index > currentIndex) {
                line.classList.add('upcoming');
            } else {
                line.classList.add('current');
                if (shouldAnimateActiveLine) {
                    applyActiveWordStagger(line);
                }
            }

            if (!isExpanded) {
                const position = index - currentIndex;
                if (position === -1) {
                    line.classList.add('after');
                } else if (position === 1) {
                    line.classList.add('before');
                } else if (position < -1) {
                    line.classList.add('far-before');
                } else if (position > 1) {
                    line.classList.add('far-after');
                }
            }

            if (displayMode !== 'scroll') {
                const shouldShow = shouldShowLineForDisplayMode(displayMode, currentIndex, index);
                if (!shouldShow) {
                    line.classList.add('fixed-hidden');
                }
            }

            const sourceLine = state.currentLyrics[index];
            if (shouldApplyBlankCutoff && index < activeBlankCutoffIndex && !sourceLine?.isLeadingSynthetic) {
                line.classList.add('hidden-after-blank');
            }
        });

        if (displayMode !== 'scroll') {
            reorderFixedModeVisibleLines(displayMode, currentIndex, lines);
        } else {
            restoreNaturalLyricDomOrder(lines);
        }

        if ((hasActiveLineChanged || hasDisplayModeChanged || hasExpandedModeChanged) && displayMode === 'scroll') {
            let leadingSyntheticPrefixCount = -1;
            if (leadingGhostCountForPage > 0) {
                for (let i = 0; i < state.currentLyrics.length; i += 1) {
                    if (state.currentLyrics[i]?.isLeadingSynthetic) leadingSyntheticPrefixCount = i;
                    else break;
                }
            }
            let scrollIndex = findCurrentLyricIndexAtTime(state.currentLyrics, effectiveTime + AUTO_CENTER_LEAD_SECONDS);
            if (
                leadingGhostCountForPage > 0
                && Number.isFinite(scrollIndex)
                && scrollIndex >= 0
                && scrollIndex <= leadingSyntheticPrefixCount + 1
            ) {
                scrollIndex = currentIndex;
            }
            const shouldSkipCenteringForLeadingGhost =
                leadingGhostCountForPage > 0 && currentIndex <= leadingSyntheticPrefixCount + 1;
            if (!shouldSkipCenteringForLeadingGhost) {
                centerActiveLyricLineStrict(scrollIndex, lyricsContainer);
            }
        }
    }

    lastRenderedLyricIndex = currentIndex;
    lastRenderedLyricsExpanded = isExpanded;
    lastRenderedLyricDisplayMode = displayMode;
}

export function getLyricLineRelation(currentIndex, lineIndex) {
    if (!Number.isFinite(currentIndex) || !Number.isFinite(lineIndex)) return 'unknown';
    if (lineIndex < currentIndex) return 'after';
    if (lineIndex > currentIndex) return 'before';
    return 'current';
}

// ------------------------------------------------------------
// Shared lyrics rendering (used by scripts/main.js and scripts/lyrics.js)
// ------------------------------------------------------------

function buildWordAnimatedLine(text, {
    index = 0,
    needsRomanization = false,
    isMusicNote = false,
    prefetchedRomanized = '',
    prefetchedTranslation = ''
} = {}) {
    const div = document.createElement('div');
    div.className = 'lyric-line synced-line';
    div.dataset.index = index;
    div.dataset.original = (text || '').toString();

    if (needsRomanization) div.classList.add('romanizable');
    if (isMusicNote) div.classList.add('music-note-line');

    const textLyrics = document.createElement('div');
    textLyrics.className = 'text-lyrics';
    let wordContainer = null;
    if ((text || '').trim() !== '') {
        const words = (text || '').toString().split(/(\s+)/).filter(p => p.length > 0);
        const wordParts = words.filter(part => !/^\s+$/.test(part));
        const staggerSeconds = getWordStaggerSeconds(wordParts.length);
        div.dataset.wordCount = String(Math.max(1, wordParts.length));
        wordContainer = document.createElement('span');
        wordContainer.className = 'lyric-words';

        words.forEach(part => {
            if (/^\s+$/.test(part)) {
                wordContainer.appendChild(document.createTextNode(part));
                return;
            }
            const wordSpan = document.createElement('span');
            wordSpan.className = 'lyric-word';
            const wordIndex = wordContainer.querySelectorAll('.lyric-word').length;
            const delay = wordIndex * staggerSeconds;
            wordSpan.style.transitionDelay = `${delay}s`;
            wordSpan.style.animationDelay = `${delay}s`;
            wordSpan.textContent = part;
            wordContainer.appendChild(wordSpan);
        });

        textLyrics.appendChild(wordContainer);
    } else {
        div.dataset.wordCount = '1';
    }

    div.appendChild(textLyrics);

    if (
        needsRomanization
        && prefetchedRomanized
        && prefetchedRomanized.trim()
        && prefetchedRomanized.trim() !== (text || '').toString().trim()
    ) {
        addRomanizedText(div, prefetchedRomanized);
    }

    if (
        needsRomanization
        && prefetchedTranslation
        && prefetchedTranslation.trim()
        && prefetchedTranslation.trim() !== (text || '').toString().trim()
    ) {
        addLyricTranslation(div, prefetchedTranslation);
    }

    return div;
}

function parseSyncedLyrics(syncedSource) {
    if (!syncedSource) return [];
    const REMOVE_BLANK_GAP_SECONDS = 5;

    const addGapFillNotes = (lines) => {
        if (!Array.isArray(lines) || lines.length < 2) return lines || [];

        const result = [lines[0]];
        for (let i = 1; i < lines.length; i += 1) {
            const currentLine = lines[i];
            const prevLine = lines[i - 1];
            const prevTime = Number(prevLine?.time);
            const currentTime = Number(currentLine?.time);

            if (Number.isFinite(prevTime) && Number.isFinite(currentTime)) {
                const gapSeconds = currentTime - prevTime;
                const prevWordCount = countLyricWords(prevLine?.text || '');
                const dynamicThreshold = GAP_FILL_BASE_THRESHOLD_SECONDS + (prevWordCount * GAP_FILL_THRESHOLD_PER_WORD_SECONDS);
                if (gapSeconds > dynamicThreshold) {
                    const insertTime = prevTime + (gapSeconds / 2);
                    if (insertTime < currentTime) {
                        result.push({
                            time: insertTime,
                            text: MUSIC_NOTE_SYMBOL,
                            isEmpty: true,
                            isGapFill: true
                        });
                    }
                }
            }

            result.push(currentLine);
        }

        return result;
    };
    const mergeConsecutiveBlankLines = (lines) => {
        if (!Array.isArray(lines) || lines.length < 2) return lines || [];

        const merged = [];
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const prev = merged[merged.length - 1];
            const isLineBlank = !!line?.isEmpty;
            const isPrevBlank = !!prev?.isEmpty;

            if (isLineBlank && isPrevBlank) continue;
            merged.push(line);
        }

        return merged;
    };
    const removeShortGapBlankLines = (lines) => {
        if (!Array.isArray(lines) || lines.length < 3) return lines || [];

        const out = [];
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const isBlank = !!line?.isEmpty || ((line?.text || '').toString().trim() === '');
            if (!isBlank) {
                out.push(line);
                continue;
            }

            const prev = lines[i - 1];
            const current = line;
            const next = lines[i + 1];
            const prevTime = Number(prev?.time);
            const currentTime = Number(current?.time);
            const nextTime = Number(next?.time);
            const hasTimedNeighbors = Number.isFinite(prevTime) && Number.isFinite(nextTime) && Number.isFinite(currentTime);

            if (hasTimedNeighbors) {
                const prevToBlank = currentTime - prevTime;
                const blankToNext = nextTime - currentTime;
                // Remove timed blank only when it is tightly bounded on both sides.
                if (prevToBlank < REMOVE_BLANK_GAP_SECONDS && blankToNext < REMOVE_BLANK_GAP_SECONDS) {
                    continue;
                }
            }

            out.push(line);
        }

        return out;
    };
    const addTrailingNote = (lines) => {
        if (!Array.isArray(lines) || lines.length === 0) return lines || [];
        const out = [...lines];
        const last = out[out.length - 1];
        const lastText = (last?.text || '').toString().trim();
        const lastIsBlankOrNote = !!last?.isEmpty || lastText === '' || lastText === MUSIC_NOTE_SYMBOL;
        if (lastIsBlankOrNote) return out;
        const lastTime = Number(last?.time);
        if (!Number.isFinite(lastTime)) return out;
        out.push({
            time: lastTime + 5,
            text: MUSIC_NOTE_SYMBOL,
            isEmpty: true,
            isTrailingNote: true
        });
        return out;
    };
    const delayFinalBlankLineIfTooClose = (lines) => {
        if (!Array.isArray(lines) || lines.length < 2) return lines || [];
        const out = [...lines];
        const lastIndex = out.length - 1;
        const last = out[lastIndex];
        const prev = out[lastIndex - 1];
        const lastText = (last?.text || '').toString().trim();
        const lastIsBlankOrNote = !!last?.isEmpty || lastText === '' || lastText === MUSIC_NOTE_SYMBOL;
        if (!lastIsBlankOrNote || !!last?.isLeadingSynthetic) return out;

        const prevTime = Number(prev?.time);
        const lastTime = Number(last?.time);
        if (!Number.isFinite(prevTime) || !Number.isFinite(lastTime)) return out;

        const gap = lastTime - prevTime;
        if (gap >= FINAL_BLANK_MIN_GAP_SECONDS) return out;

        out[lastIndex] = {
            ...last,
            time: prevTime + FINAL_BLANK_TARGET_GAP_SECONDS
        };
        return out;
    };
    const addLeadingNoteIfMissing = (lines) => {
        if (!Array.isArray(lines) || lines.length === 0) return lines || [];
        const out = [...lines];
        const first = out[0];
        const firstText = (first?.text || '').toString().trim();
        const firstIsBlankOrNote = !!first?.isEmpty || firstText === '' || firstText === MUSIC_NOTE_SYMBOL;
        if (firstIsBlankOrNote) return out;
        out.unshift({
            time: 0,
            text: MUSIC_NOTE_SYMBOL,
            isEmpty: true,
            isLeadingSynthetic: true
        });
        return out;
    };
    const delayFirstActualLineIfAtZero = (lines) => {
        if (!Array.isArray(lines) || lines.length < 2) return lines || [];
        const out = [...lines];
        let sawLeadingBlankOrNote = false;

        for (let i = 0; i < out.length; i += 1) {
            const line = out[i];
            if (line?.isLeadingSynthetic) {
                sawLeadingBlankOrNote = true;
                continue;
            }

            const text = (line?.text || '').toString().trim();
            const isBlankOrNote = !!line?.isEmpty || text === '' || text === MUSIC_NOTE_SYMBOL;
            if (isBlankOrNote) {
                sawLeadingBlankOrNote = true;
                continue;
            }

            const time = Number(line?.time);
            if (sawLeadingBlankOrNote && Number.isFinite(time)) {
                const rawTime = Number(line?.rawTime);
                if (Number.isFinite(rawTime) && rawTime > 0) {
                    out[i] = {
                        ...line,
                        time: Math.max(time, rawTime)
                    };
                } else if (time <= 0) {
                    out[i] = {
                        ...line,
                        time: 0.5
                    };
                }
            }
            break;
        }

        return out;
    };
    const normalizeParsedLines = (lines) => (
        (() => {
            const normalizedBase = delayFirstActualLineIfAtZero(
                addLeadingNoteIfMissing(
                    delayFinalBlankLineIfTooClose(
                        addTrailingNote(
                            mergeConsecutiveBlankLines(
                                addGapFillNotes(
                                    removeShortGapBlankLines(lines)
                                )
                            )
                        )
                    )
                )
            );
            if (!Array.isArray(normalizedBase) || normalizedBase.length === 0) {
                return normalizedBase;
            }

            let normalized = normalizedBase;
            const leadingGhostLines = getLeadingGhostLinesCountForCurrentPage();
            if (leadingGhostLines > 0) {
                const firstTimeRaw = Number(normalized[0]?.time);
                const firstTime = Number.isFinite(firstTimeRaw) ? firstTimeRaw : 0;
                const ghosts = Array.from({ length: leadingGhostLines }, () => ({
                    time: firstTime,
                    text: '',
                    isEmpty: false,
                    isLeadingSynthetic: true,
                    isGhostLeadingSynthetic: true
                }));
                normalized = [...ghosts, ...normalized];
            }

            return normalized;
        })()
    );

    // Array format: [{ time, text }]
    if (Array.isArray(syncedSource)) {
        return normalizeParsedLines(syncedSource
            .map((item, sourceIndex) => {
                const time = (typeof item?.time === 'number') ? item.time : 0;
                const text = (item?.text || '').toString();
                const trimmedText = text.trim();
                const isIncomingBlank = !!item?.isEmpty || !!item?.isSourceBlank;
                const isBlank = isIncomingBlank || trimmedText === '';
                return {
                    time,
                    text: trimmedText === '' ? MUSIC_NOTE_SYMBOL : text,
                    isEmpty: isBlank,
                    isSourceBlank: isBlank,
                    sourceIndex
                };
            })
            .filter(Boolean));
    }

    // LRC string format
    if (typeof syncedSource === 'string') {
        return normalizeParsedLines(syncedSource
            .split(/\r?\n/)
            .map((line, sourceIndex) => {
                const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
                if (!match) return null;
                const min = parseInt(match[1], 10);
                const sec = parseInt(match[2], 10);
                const ms = parseInt(match[3], 10);
                const divisor = (match[3].length === 3 ? 1000 : 100);
                const text = (match[4] || '').toString();
                const trimmedText = text.trim();
                const rawTime = (min * 60) + sec + (ms / divisor);
                const time = rawTime - SYNCED_LYRIC_PARSE_OFFSET_SECONDS;
                return {
                    time,
                    rawTime,
                    text: trimmedText === '' ? MUSIC_NOTE_SYMBOL : text,
                    isEmpty: trimmedText === '',
                    isSourceBlank: trimmedText === '',
                    sourceIndex
                };
            })
            .filter(Boolean));
    }

    return [];
}

function clampTrailingNoteToSongDuration(lines, songDuration) {
    if (!Array.isArray(lines) || lines.length === 0) return lines || [];
    const duration = Number(songDuration);
    if (!Number.isFinite(duration) || duration <= 0) return lines;

    const out = [...lines];
    const lastIndex = out.length - 1;
    const last = out[lastIndex];
    if (!last?.isTrailingNote) return out;

    const trailingTime = Number(last?.time);
    if (!Number.isFinite(trailingTime)) return out;
    if (trailingTime <= duration) return out;

    // Keep the trailing note reachable before playback time clamps at duration.
    const targetTime = Math.max(0, duration - 0.05);
    out[lastIndex] = { ...last, time: targetTime };
    return out;
}

function getPlainTextFromLyricsPayload(data) {
    const plainText = data?.plainLyrics
        || (Array.isArray(data?.plain) ? data.plain.join('\n') : data?.plain)
        || data?.lyrics
        || '';
    return plainText;
}

/**
 * Render lyrics into #lyrics-container / #synced-lyrics / #plain-lyrics.
 *
 * Used by both the main page and the dedicated lyrics page.
 */
export function displayLyricsUI(data, {
    fetchVideoId = null,
    validateFetch = () => true,
    resetState = true,
    logTag = 'LYRICS',
    setLastFetched = true
} = {}) {
    const renderVersion = ++lyricsRenderVersion;
    const isFetchStillValid = () => {
        try {
            return !!validateFetch();
        } catch (_) {
            return false;
        }
    };
    const isRenderStillCurrent = () => renderVersion === lyricsRenderVersion;

    const lyricsContainer = document.getElementById('lyrics-container');
    const syncedLyricsContainer = document.getElementById('synced-lyrics');
    const plainLyricsContainer = document.getElementById('plain-lyrics');
    const lyricsLoadingEl = document.getElementById('lyrics-loading');
    const rightNowPlaying = document.getElementById('song-info');

    const revealLyricsBlock = (activeContainer, inactiveContainer) => {
        if (inactiveContainer) {
            inactiveContainer.classList.remove('revealed');
            inactiveContainer.style.display = 'none';
        }
        if (!activeContainer) return;

        activeContainer.classList.remove('revealed');
        activeContainer.style.display = 'flex';
        // Replay content reveal even if the same container was already visible.
        void activeContainer.offsetHeight;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                activeContainer.classList.add('revealed');
            });
        });
    };

    if (lyricsContainer) {
        lyricsContainer.classList.add('no-lyrics');
        lyricsContainer.classList.add('loading-lyrics');
        lyricsContainer.classList.remove('has-lyrics');
    }

    // Check if there are existing lyrics to animate out
    const hasExistingLyrics = (syncedLyricsContainer?.children.length > 0 || 
                              plainLyricsContainer?.children.length > 0) &&
                              (syncedLyricsContainer?.style.display !== 'none' ||
                              plainLyricsContainer?.style.display !== 'none');

    // Function to animate out existing lyrics
    const animateOutLyrics = () => {
        return new Promise((resolve) => {
            if (!hasExistingLyrics) {
                resolve();
                return;
            }

            // Add transitioning class to containers
            if (lyricsContainer) lyricsContainer.classList.add('song-changing');
            if (syncedLyricsContainer) syncedLyricsContainer.classList.add('song-changing');
            if (plainLyricsContainer) plainLyricsContainer.classList.add('song-changing');

            // Animate out all existing lines
            const allLines = document.querySelectorAll('#synced-lyrics .lyric-line, #plain-lyrics .lyric-line');
            allLines.forEach(line => line.classList.add('transitioning-out'));

            // Wait for animation to complete
            setTimeout(() => {
                resolve();
            }, 300);
        });
    };

    // Function to clear and prepare containers
    const clearContainers = () => {
        if (lyricsContainer) {
            lyricsContainer.classList.remove('has-lyrics');
            lyricsContainer.classList.remove('no-lyrics');
            lyricsContainer.classList.remove('song-changing');
            lyricsContainer.classList.remove('visible');
        }
        if (rightNowPlaying) rightNowPlaying.classList.remove('no-lyrics');
        setCompactNoLyricsState(false);
        clearLyricLineElementsCache();
        if (syncedLyricsContainer) {
            syncedLyricsContainer.innerHTML = '';
            // Re-enable normal line transitions after hide state.
            syncedLyricsContainer.classList.remove('transitioning');
            syncedLyricsContainer.classList.remove('song-changing');
            syncedLyricsContainer.classList.remove('revealed');
        }
        if (plainLyricsContainer) {
            plainLyricsContainer.innerHTML = '';
            plainLyricsContainer.style.display = 'none';
            plainLyricsContainer.classList.remove('revealed');
            plainLyricsContainer.classList.remove('active', 'song-changing');
        }
    };

    // Start the animation sequence
animateOutLyrics().then(() => {
    lastRenderedLyricIndex = -1;
    lastRenderedLyricsExpanded = null;
    lastRenderedLyricDisplayMode = null;
    lastStableLyricEffectiveTime = null;
    latchedBlankCutoffIndex = -1;

    if (!isFetchStillValid() || !isRenderStillCurrent()) return;

    // One rAF keeps the render check alive for the next frame rather than
    // a fixed 500 ms timeout that could expire and fail isRenderStillCurrent.
    requestAnimationFrame(() => {
        if (!isFetchStillValid() || !isRenderStillCurrent()) return;

        clearContainers();

        try {
            if (resetState && typeof state !== 'undefined') {
                state.currentLyrics = [];
                state.isSyncedLyrics = false;
                state.lyricsOffset = 0;
            }
        } catch (_) {}

        if (syncedLyricsContainer) {
            syncedLyricsContainer.classList.remove('transitioning');
            syncedLyricsContainer.style.display = 'none';
        }
        const syncedSource = data?.syncLyrics || data?.syncedLyrics || data?.synced;
        const romanizedSyncedSource = data?.romanizedSyncedLyrics || data?.romanizedSyncLyrics || null;
        const translatedSyncedSource = data?.translatedSyncedLyrics || data?.englishSyncedLyrics || null;
        const plainText = getPlainTextFromLyricsPayload(data);
        const romanizedPlainText = (typeof data?.romanizedPlainLyrics === 'string') ? data.romanizedPlainLyrics : '';

        if (syncedSource) {
            state.isSyncedLyrics = true;
            state.currentLyrics = parseSyncedLyrics(syncedSource);
            const knownDuration = Number(state.currentSongData?.songDuration ?? data?.songDuration ?? 0);
            state.currentLyrics = clampTrailingNoteToSongDuration(state.currentLyrics, knownDuration);

            if (state.currentLyrics.length > 0) {
                if (!isFetchStillValid() || !isRenderStillCurrent()) return;
                const romanizedBySourceIndex = (() => {
                    if (!Array.isArray(romanizedSyncedSource)) return null;
                    const map = new Map();
                    romanizedSyncedSource.forEach((item, idx) => {
                        const rawSourceIndex = Number(item?.sourceIndex);
                        const key = Number.isFinite(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : idx;
                        if (!map.has(key)) {
                            map.set(key, (item?.text || '').toString());
                        }
                    });
                    return map;
                })();
                const translatedBySourceIndex = (() => {
                    if (!Array.isArray(translatedSyncedSource)) return null;
                    const map = new Map();
                    translatedSyncedSource.forEach((item, idx) => {
                        const rawSourceIndex = Number(item?.sourceIndex);
                        const key = Number.isFinite(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : idx;
                        if (!map.has(key)) {
                            map.set(key, (item?.text || '').toString());
                        }
                    });
                    return map;
                })();

                state.currentLyrics.forEach((line, index) => {
                    const text = line?.isGhostLeadingSynthetic
                        ? ''
                        : (line?.text || MUSIC_NOTE_SYMBOL).toString();
                    let prefetchedRomanized = '';
                    let prefetchedTranslation = '';
                    if (romanizedBySourceIndex) {
                        const sourceIndex = Number(line?.sourceIndex);
                        if (Number.isFinite(sourceIndex) && sourceIndex >= 0) {
                            prefetchedRomanized = (romanizedBySourceIndex.get(sourceIndex) || '').toString();
                        } else {
                            prefetchedRomanized = (romanizedBySourceIndex.get(index) || '').toString();
                        }
                    }
                    if (translatedBySourceIndex) {
                        const sourceIndex = Number(line?.sourceIndex);
                        if (Number.isFinite(sourceIndex) && sourceIndex >= 0) {
                            prefetchedTranslation = (translatedBySourceIndex.get(sourceIndex) || '').toString();
                        } else {
                            prefetchedTranslation = (translatedBySourceIndex.get(index) || '').toString();
                        }
                    }
                    const div = buildWordAnimatedLine(text, {
                        index,
                        needsRomanization: isNonLatin(text),
                        isMusicNote: !line?.isGhostLeadingSynthetic
                            && ((text.trim() === MUSIC_NOTE_SYMBOL) || !!line?.isEmpty),
                        prefetchedRomanized,
                        prefetchedTranslation
                    });
                    if (line?.isGhostLeadingSynthetic) {
                        div.classList.add('leading-ghost-line');
                    }
                    applyLineTimingStyles(div, index);
                    if (syncedLyricsContainer) syncedLyricsContainer.appendChild(div);
                });
                refreshLyricLineElements();

                if (lyricsContainer) lyricsContainer.classList.remove('plain-mode');
                const finalizeLyricsReveal = () => {
                    if (!isFetchStillValid() || !isRenderStillCurrent()) return;

                    const currentTime = (state.currentSongData && typeof state.currentSongData.elapsedSeconds === 'number')
                        ? state.currentSongData.elapsedSeconds
                        : 0;

                    if (isFetchStillValid() && isRenderStillCurrent()) {
                        if (lyricsLoadingEl) lyricsLoadingEl.classList.remove('active');
                        if (lyricsContainer) {
                            lyricsContainer.classList.remove('loading-lyrics');
                            lyricsContainer.classList.add('has-lyrics');
                        }
                    }

                    if (isFetchStillValid() && isRenderStillCurrent()) {
                        revealLyricsBlock(syncedLyricsContainer, plainLyricsContainer);
                        if (lyricsContainer) {
                            lyricsContainer.classList.remove('no-lyrics');
                            lyricsContainer.classList.add('visible');
                        }
                        if (rightNowPlaying) rightNowPlaying.classList.remove('no-lyrics');
                        requestAnimationFrame(() => setCompactNoLyricsState(false));
                        if (lyricsContainer && !state.lyricsManuallyCollapsed && lyricsContainer.classList.contains('collapsed')) {
                            toggleLyricsCollapse({ auto: true, force: 'expand' });
                        }
                    }

                    updateLyricsDisplay(currentTime);

                    if (setLastFetched) {
                        state.lastFetchedVideoId = state.currentVideoId;
                        state.currentFetchVideoId = null;
                    }

                    console.log(`[${logTag}] Lyrics loaded and displayed (synced)`);
                };

                finalizeLyricsReveal();
                return;
            }

            console.warn(`[${logTag}] No valid synced lyrics lines were parsed. Falling back to plain lyrics.`);
        }

        if (!isFetchStillValid() || !isRenderStillCurrent()) return;

        if (plainText && plainText.trim().length > 0) {
            if (plainLyricsContainer) {
                plainLyricsContainer.innerHTML = '';
                plainLyricsContainer.style.display = 'none';
                plainLyricsContainer.classList.remove('revealed', 'active', 'song-changing');
            }
            if (lyricsContainer) {
                lyricsContainer.classList.add('no-lyrics');
                lyricsContainer.classList.remove('plain-mode');
                lyricsContainer.classList.remove('has-lyrics');
                lyricsContainer.classList.remove('loading-lyrics');
                lyricsContainer.classList.remove('visible');
            }
            if (rightNowPlaying) rightNowPlaying.classList.add('no-lyrics');
            setCompactNoLyricsState(true);
            if (lyricsLoadingEl) lyricsLoadingEl.classList.remove('active');

            if (setLastFetched) {
                state.lastFetchedVideoId = state.currentVideoId;
                state.currentFetchVideoId = null;
            }

            console.log(`[${logTag}] Plain lyrics available but hidden by policy`);
            return;
        }

        if (lyricsContainer) {
            lyricsContainer.classList.add('no-lyrics');
            lyricsContainer.classList.remove('has-lyrics');
            lyricsContainer.classList.remove('loading-lyrics');
            lyricsContainer.classList.remove('visible');
        }
        if (rightNowPlaying) rightNowPlaying.classList.add('no-lyrics');
        setCompactNoLyricsState(true);
        if (lyricsLoadingEl) lyricsLoadingEl.classList.remove('active');
        console.log(`[${logTag}] No lyrics available to display`);
    });
});
}
export function hideLyricsUI({
    clearVideoId = false,
    logTag = 'LYRICS'
} = {}) {
    lastRenderedLyricIndex = -1;
    lastRenderedLyricsExpanded = null;
    lastRenderedLyricDisplayMode = null;
    lastStableLyricEffectiveTime = null;
    latchedBlankCutoffIndex = -1;

    try {
        state.currentLyrics = [];
        state.isSyncedLyrics = false;
        state.currentFetchVideoId = null;
        state.lastFetchedVideoId = null;
        state.lyricsOffset = 0;
        if (clearVideoId) state.currentVideoId = null;
    } catch (_) {
        // ignore
    }

    const lyricsContainer = document.getElementById('lyrics-container');
    const syncedLyricsContainer = document.getElementById('synced-lyrics');
    const plainLyricsContainer = document.getElementById('plain-lyrics');
    const lyricsLoadingEl = document.getElementById('lyrics-loading');

    if (syncedLyricsContainer) syncedLyricsContainer.innerHTML = '';
    clearLyricLineElementsCache();
    if (plainLyricsContainer) {
        plainLyricsContainer.innerHTML = '';
        plainLyricsContainer.style.display = 'none';
        plainLyricsContainer.classList.remove('revealed');
        plainLyricsContainer.classList.remove('active');
    }

    if (syncedLyricsContainer) {
        syncedLyricsContainer.classList.remove('revealed');
        syncedLyricsContainer.classList.add('transitioning');
    }
    if (lyricsContainer) {
        lyricsContainer.classList.add('no-lyrics');
        lyricsContainer.classList.remove('visible');
        lyricsContainer.classList.remove('has-lyrics');
        lyricsContainer.classList.remove('loading-lyrics');
    }
    if (lyricsLoadingEl) {
        lyricsLoadingEl.classList.remove('active');
        lyricsLoadingEl.style.display = '';
    }
    if (lyricsContainer && !state.lyricsManuallyCollapsed && !lyricsContainer.classList.contains('collapsed')) {
        toggleLyricsCollapse({ auto: true, force: 'collapse' });
    }

    const songInfo = document.getElementById('song-info');
    if (songInfo) songInfo.classList.add('no-lyrics');
    setCompactNoLyricsState(true);

    console.log(`[${logTag}] Lyrics hidden`);
}

export function toggleLyricsCollapse(options = {}) {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return;

    const { auto = false, force = null } = options || {};
    const isCollapsed = lyricsContainer.classList.contains('collapsed');

    let nextCollapsed = isCollapsed;
    if (force === 'collapse') {
        nextCollapsed = true;
    } else if (force === 'expand') {
        nextCollapsed = false;
    } else {
        nextCollapsed = !isCollapsed;
    }

    if (nextCollapsed) {
        lyricsContainer.classList.add('collapsed');
    } else {
        lyricsContainer.classList.remove('collapsed');
    }
    document.body.classList.toggle('lyrics-collapsed', nextCollapsed);

    if (auto) {
        state.lyricsAutoCollapsed = nextCollapsed;
        return;
    }

    state.lyricsManuallyCollapsed = nextCollapsed;
    state.lyricsAutoCollapsed = false;
}
