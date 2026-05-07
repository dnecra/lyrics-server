import { API_URL, state } from './config.js';

let lastRenderedLyricIndex = -1;
let lastRenderedLyricsExpanded = null;
const MUSIC_NOTE_SYMBOL = '\u266A';
const GAP_FILL_BASE_THRESHOLD_SECONDS = 20;
const FINAL_BLANK_TARGET_GAP_SECONDS = 5;
const LYRICS_OFFSET_SECONDS = -1;
const AUTO_CENTER_TOLERANCE_PX = 6;
const AUTO_CENTER_RETARGET_DEADZONE_PX = 8;
let lyricLineElements = [];
let lyricsRenderVersion = 0;
let lastStableLyricEffectiveTime = null;
let latchedBlankCutoffIndex = -1;
let pendingLeavingCurrentAnimationFrame = 0;
const LYRIC_DISPLAY_MODES = new Set(['scroll', 'fixed-3', 'fixed-2', 'fixed-1']);
const LYRICS_CONTAINER_EXIT_DURATION_MS = 1000;
let currentLyricDisplayMode = 'scroll';
let lastRenderedLyricDisplayMode = 'scroll';
let compactNoLyricsLeavingTimer = null;
let compactNoLyricsEnteringTimer = null;
let lyricsContainerHideTimer = null;
let lyricModeSwitchRevealFrame = 0;
const activeScrollAnimations = new WeakMap();
const fixedLineHideTimers = new WeakMap();
const scrollBlankFadeFrames = new WeakMap();
const BLANK_CUTOFF_HIDE_DELAY_MS = 2000;

function isBlankCutoffEnabledForCurrentPage() {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const isPhoneLayout = !!document.documentElement?.classList?.contains('is-phone-layout');
    if (viewportWidth <= 767 || isPhoneLayout) {
        return false;
    }
    // Default to enabled unless the page explicitly disables it.
    return window.__lyricsBlankCutoffEnabled !== false;
}

function clearPendingLyricsContainerHide() {
    if (lyricsContainerHideTimer) {
        clearTimeout(lyricsContainerHideTimer);
        lyricsContainerHideTimer = null;
    }
}

async function fetchFreshSongElapsedForRender(expectedVideoId, fallbackElapsed = 0) {
    const normalizedExpectedVideoId = (expectedVideoId === undefined || expectedVideoId === null)
        ? ''
        : String(expectedVideoId).trim();
    const fallback = Number.isFinite(Number(fallbackElapsed)) ? Math.max(0, Number(fallbackElapsed)) : 0;
    if (!normalizedExpectedVideoId) return fallback;

    try {
        const response = await fetch(`${API_URL}/song`, { cache: 'no-store' });
        if (!response.ok) return fallback;

        const payload = await response.json().catch(() => null);
        const payloadVideoId = String(payload?.videoId || '').trim();
        if (!payloadVideoId || payloadVideoId !== normalizedExpectedVideoId) {
            return fallback;
        }

        const elapsed = Number(payload?.elapsedSeconds);
        if (!Number.isFinite(elapsed)) return fallback;

        if (state.currentSongData && String(state.currentSongData.videoId || '').trim() === normalizedExpectedVideoId) {
            const localElapsed = Number(state.currentSongData.elapsedSeconds);
            const safeLocalElapsed = Number.isFinite(localElapsed) ? Math.max(0, localElapsed) : 0;
            const nextElapsed = Math.max(safeLocalElapsed, elapsed);
            state.currentSongData = {
                ...state.currentSongData,
                ...payload,
                elapsedSeconds: nextElapsed
            };
        }

        return Math.max(fallback, elapsed);
    } catch (_) {
        return fallback;
    }
}

function cancelPendingLyricModeReveal() {
    if (lyricModeSwitchRevealFrame) {
        cancelAnimationFrame(lyricModeSwitchRevealFrame);
        lyricModeSwitchRevealFrame = 0;
    }
}

function beginLyricModeSwitchMask() {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return;
    cancelPendingLyricModeReveal();
    lyricsContainer.classList.add('mode-switching');
}

function endLyricModeSwitchMaskSoon() {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return;
    cancelPendingLyricModeReveal();
    lyricModeSwitchRevealFrame = requestAnimationFrame(() => {
        lyricModeSwitchRevealFrame = requestAnimationFrame(() => {
            lyricModeSwitchRevealFrame = 0;
            lyricsContainer.classList.remove('mode-switching');
        });
    });
}

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

function cancelPendingLeavingCurrentAnimation() {
    if (pendingLeavingCurrentAnimationFrame) {
        cancelAnimationFrame(pendingLeavingCurrentAnimationFrame);
        pendingLeavingCurrentAnimationFrame = 0;
    }
}

function clearScheduledFixedLineHide(line) {
    if (!line) return;
    const timerId = fixedLineHideTimers.get(line);
    if (timerId) {
        clearTimeout(timerId);
        fixedLineHideTimers.delete(line);
    }
}

function cancelScheduledScrollBlankFade(line) {
    if (!line) return;
    const rafId = scrollBlankFadeFrames.get(line);
    if (rafId) {
        cancelAnimationFrame(rafId);
        scrollBlankFadeFrames.delete(line);
    }
}

function scheduleScrollBlankFade(line) {
    if (!line) return;
    if (line.classList.contains('hidden-after-blank')) return;
    cancelScheduledScrollBlankFade(line);
    line.classList.add('blank-fade-pending');
    const rafId = requestAnimationFrame(() => {
        scrollBlankFadeFrames.delete(line);
        if (!line?.isConnected) return;
        line.classList.remove('blank-fade-pending');
        line.classList.add('hidden-after-blank');
    });
    scrollBlankFadeFrames.set(line, rafId);
}

function scheduleFixedLineHide(line, delayMs = BLANK_CUTOFF_HIDE_DELAY_MS) {
    if (!line) return;
    clearScheduledFixedLineHide(line);
    const timeoutMs = Math.max(0, Number(delayMs) || 0);
    if (timeoutMs === 0) {
        line.classList.add('fixed-hidden');
        line.classList.remove('fixed-leaving');
        return;
    }

    line.classList.add('fixed-leaving');
    const timerId = setTimeout(() => {
        fixedLineHideTimers.delete(line);
        if (!line?.isConnected) return;
        line.classList.add('fixed-hidden');
        line.classList.remove('fixed-leaving');
    }, timeoutMs);
    fixedLineHideTimers.set(line, timerId);
}

function scheduleLeavingCurrentRelease(linesToRelease) {
    if (!Array.isArray(linesToRelease) || linesToRelease.length === 0) return;
    cancelPendingLeavingCurrentAnimation();
    pendingLeavingCurrentAnimationFrame = requestAnimationFrame(() => {
        pendingLeavingCurrentAnimationFrame = 0;
        linesToRelease.forEach((line) => {
            if (!line?.isConnected) return;
            line.classList.remove('leaving-current');
        });
    });
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
        // Before any lyric is active, hide all lines in fixed mode
        // to prevent showing incorrect lines at wrong positions.
        return false;
    }
    if (mode === 'fixed-3') return Math.abs(lineIndex - currentIndex) <= 1;
    // fixed-2: show current (active) + next (inactive, about to become active).
    if (mode === 'fixed-2') return lineIndex === currentIndex || lineIndex === (currentIndex + 1);
    if (mode === 'fixed-1') return lineIndex === currentIndex;
    return true;
}

function reorderFixedModeVisibleLines(mode, currentIndex, lines) {
    if (!Array.isArray(lines) || lines.length === 0) return;
    if (!Number.isFinite(currentIndex) || currentIndex < 0) return;
    if (mode === 'scroll' || mode === 'fixed-1') return;
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
    if (modeChanged) {
        beginLyricModeSwitchMask();
    }
    currentLyricDisplayMode = nextMode;
    updateLyricDisplayModeDomState(nextMode);

    if (!modeChanged) {
        endLyricModeSwitchMaskSoon();
        return currentLyricDisplayMode;
    }

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

    endLyricModeSwitchMaskSoon();

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

    // getOffsetTopWithinContainer walks offsetParent chain — this correctly
    // accounts for the padding-top on the scroll container.
    const anchorOffsetTop = getOffsetTopWithinContainer(anchorElement, scrollContainer);

    // For wrapped multi-line blocks align to the first rendered row only,
    // not the vertical midpoint of the whole block height.
    const computedStyle = window.getComputedStyle(lineElement);
    const lineHeightPx = parseFloat(computedStyle.lineHeight) || lineElement.getBoundingClientRect().height;
    const singleRowHeight = Math.min(lineHeightPx, lineElement.getBoundingClientRect().height);

    // Center the first row in the viewport. The CSS padding-top/bottom on
    // .scroll-line-mode guarantees even the first and last lines are reachable.
    const viewportH = scrollContainer.clientHeight;
    const targetTop = anchorOffsetTop + (singleRowHeight / 2) - (viewportH / 2);
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

    // Always start from wherever the container currently sits — not from where
    // the interrupted animation originally started. This prevents visual
    // snap-backs when a new target arrives mid-scroll (common on wrapped lines).
    const startTop = Number(container.scrollTop) || 0;
    const delta = targetTop - startTop;
    if (Math.abs(delta) <= AUTO_CENTER_TOLERANCE_PX) {
        activeScrollAnimations.delete(container);
        container.scrollTop = targetTop;
        return;
    }

    const distance = Math.abs(delta);
    // Keep duration generous and consistent — the buttery feel comes from
    // a long deceleration tail, not from matching scroll distance exactly.
    // Short hops (adjacent lines) get ~600ms, long seeks up to 800ms.
    const durationMs = Math.max(600, Math.min(800, Math.round(distance * 0.6 + 600)));

    // easeOutExpo: very fast onset (syncs with word-bounce) then a long,
    // smooth deceleration tail — the "buttery" feel.
    const easeOutExpo = (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

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
        const eased = easeOutExpo(progress);
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
    if (!lyricsContainer || getLyricDisplayMode() !== 'scroll') return;

    const index = Number(currentIndex);
    if (!Number.isFinite(index) || index < 0) return;

    const scrollContainer = getLyricsScrollContainer(lyricsContainer);
    if (!scrollContainer) return;

    const lineElement = lyricsContainer.querySelector(`.lyric-line[data-index="${index}"]`);
    if (!lineElement) return;

    const targetTop = getStableCenterTargetTop(lineElement, scrollContainer);
    const behavior = options?.behavior === 'instant' ? 'instant' : 'smooth';
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

function applyWordDelaySequence(words, staggerSeconds) {
    if (!words || words.length === 0) return;
    words.forEach((word, index) => {
        const delay = `${(index * staggerSeconds).toFixed(3)}s`;
        word.style.willChange = 'opacity, transform';
        word.style.setProperty('--word-reveal-delay', delay);
        word.style.transitionDelay = '0s';
        word.style.animationDelay = delay;
    });
}

function applyActiveWordStagger(lineElement) {
    if (!lineElement) return;
    const wordGroups = [
        lineElement.querySelectorAll('.lyric-words .lyric-word'),
        lineElement.querySelectorAll('.romanized .romanized-word'),
        lineElement.querySelectorAll('.lyric-translation .translation-word')
    ].filter((group) => group.length > 0);
    if (wordGroups.length === 0) return;

    const maxWordCount = Math.max(...wordGroups.map((group) => group.length));
    const staggerSeconds = getWordStaggerSeconds(maxWordCount);
    wordGroups.forEach((group) => applyWordDelaySequence(group, staggerSeconds));
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

function getLyricLineTime(lines, index) {
    if (!Array.isArray(lines) || !Number.isFinite(index) || index < 0 || index >= lines.length) {
        return null;
    }
    const time = Number(lines[index]?.time);
    return Number.isFinite(time) ? time : null;
}

function stabilizeCurrentLyricIndex(lines, candidateIndex, effectiveTime, previousIndex) {
    if (!Array.isArray(lines) || lines.length === 0) return candidateIndex;
    if (!Number.isFinite(candidateIndex) || candidateIndex < 0) return candidateIndex;
    if (!Number.isFinite(previousIndex) || previousIndex < 0) return candidateIndex;
    if (candidateIndex === previousIndex) return candidateIndex;

    const jumpDistance = Math.abs(candidateIndex - previousIndex);
    if (jumpDistance > 1) return candidateIndex;
    const previousLineTime = getLyricLineTime(lines, previousIndex);
    const candidateLineTime = getLyricLineTime(lines, candidateIndex);

    if (candidateIndex === previousIndex + 1) {
        if (!Number.isFinite(candidateLineTime)) return candidateIndex;
        return effectiveTime >= candidateLineTime ? candidateIndex : previousIndex;
    }

    if (candidateIndex === previousIndex - 1) {
        if (!Number.isFinite(previousLineTime)) return candidateIndex;
        return effectiveTime < previousLineTime ? candidateIndex : previousIndex;
    }

    return candidateIndex;
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
    const isBlankLine = lineElement?.classList?.contains('music-note-line')
        || lineElement?.dataset?.isBlankLine === 'true'
        || !lineElement?.querySelector('.lyric-words');
    if (isBlankLine) {
        const existingBlankTranslation = lineElement?.querySelector('.lyric-translation');
        if (existingBlankTranslation) {
            existingBlankTranslation.remove();
        }
        lineElement?.classList?.remove('translation-assisted');
        return;
    }

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
    lineElement.classList.add('translation-assisted');
    if (wordContainer && wordContainer.parentNode) {
        wordContainer.parentNode.insertBefore(translationSpan, wordContainer.nextSibling);
        return;
    }

    const textLyrics = lineElement.querySelector('.text-lyrics');
    if (textLyrics) {
        textLyrics.appendChild(translationSpan);
    } else {
        lineElement.appendChild(translationSpan);
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
        const excludedLanguages = Array.isArray(window.__lyricTranslationExcludedLanguages)
            ? window.__lyricTranslationExcludedLanguages
            : [];
        const params = new URLSearchParams({
            videoId: fetchVideoId,
            artist: artist,
            title: title,
            album: album || '',
            duration: duration.toString(),
            translationExclude: excludedLanguages.join(',')
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
        const provider = String(result.provider || data.provider || 'lrclib').trim().toLowerCase() || 'lrclib';
        console.log(`[LYRICS] Server selected provider: ${provider}${result.cached ? ' (cache)' : ''}`);
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
    const numericTime = Number(currentTime);
    if (!Number.isFinite(numericTime)) return;
    // Shift only the active-line selection window. Playback timing, provider
    // timestamps, and animation durations still use the original source data.
    const rawEffectiveTime = Math.max(0, numericTime - LYRICS_OFFSET_SECONDS);
    const effectiveTime = (() => {
        const prev = Number(lastStableLyricEffectiveTime);
        if (!Number.isFinite(prev)) {
            lastStableLyricEffectiveTime = rawEffectiveTime;
            return rawEffectiveTime;
        }
        lastStableLyricEffectiveTime = rawEffectiveTime;
        return rawEffectiveTime;
    })();

    if (!state.currentLyrics || state.currentLyrics.length === 0) return;

    let currentIndex = findCurrentLyricIndexAtTime(state.currentLyrics, effectiveTime);

    currentIndex = stabilizeCurrentLyricIndex(
        state.currentLyrics,
        currentIndex,
        effectiveTime,
        lastRenderedLyricIndex
    );

    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return;

    const displayMode = normalizeLyricDisplayMode(currentLyricDisplayMode);
    updateLyricDisplayModeDomState(displayMode);
    const isExpanded = lyricsContainer.classList.contains('expanded');

    const hasActiveLineChanged = lastRenderedLyricIndex !== currentIndex;
    const hasExpandedModeChanged = lastRenderedLyricsExpanded !== isExpanded;
    const hasDisplayModeChanged = lastRenderedLyricDisplayMode !== displayMode;
    if (!hasActiveLineChanged && !hasExpandedModeChanged && !hasDisplayModeChanged) {
        endLyricModeSwitchMaskSoon();
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
        const isBlankLike = !!line?.isEmpty || !!line?.isSourceBlank || !!line?.isInjectedBlank || text === '';
        return isBlankLike && (isNote || text === '') && !line?.isLeadingSynthetic;
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
        if (latestBlankCutoffIndex > latchedBlankCutoffIndex) {
            latchedBlankCutoffIndex = latestBlankCutoffIndex;
        }
    } else {
        latchedBlankCutoffIndex = -1;
    }
    const activeBlankCutoffIndex = latchedBlankCutoffIndex;
    const shouldApplyBlankCutoff = isBlankCutoffEnabledForCurrentPage() && activeBlankCutoffIndex >= 0;

    if (hasActiveLineChanged || hasExpandedModeChanged || hasDisplayModeChanged) {
        const pendingLeavingCurrentLines = [];
        const previousActiveIndex = Number.isFinite(lastRenderedLyricIndex) ? lastRenderedLyricIndex : -1;

        lines.forEach((line, index) => {
            const wasCurrent = line.classList.contains('current');
            const shouldHideAfterBlank = shouldApplyBlankCutoff && index < activeBlankCutoffIndex;
            line.classList.remove('current', 'previous', 'upcoming', 'before', 'after', 'far-before', 'far-after', 'activating-current');
            line.classList.remove('fixed-secondary');
            if (!shouldHideAfterBlank) {
                line.classList.remove('hidden-after-blank');
                line.classList.remove('blank-fade-pending');
            }
            clearScheduledFixedLineHide(line);
            cancelScheduledScrollBlankFade(line);
            const relation = getLyricLineRelation(currentIndex, index);
            line.dataset.lineRelation = relation;

            if (index < currentIndex) {
                line.classList.add('previous');
            } else if (index > currentIndex) {
                line.classList.add('upcoming');
            } else {
                line.classList.add('current');
                if (shouldAnimateActiveLine) {
                    if (displayMode !== 'scroll') {
                        line.classList.add('activating-current');
                    }
                    applyActiveWordStagger(line);
                }
                line.classList.remove('leaving-current');
            }

            if (index !== currentIndex && shouldAnimateActiveLine && index === previousActiveIndex && wasCurrent) {
                const shouldUseLeavingCurrent = !(displayMode === 'scroll' && shouldHideAfterBlank);
                if (shouldUseLeavingCurrent) {
                    line.classList.add('leaving-current');
                    pendingLeavingCurrentLines.push(line);
                } else {
                    line.classList.remove('leaving-current');
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
                    if (shouldHideAfterBlank) {
                        line.classList.add('hidden-after-blank', 'fixed-leaving');
                        line.classList.remove('fixed-hidden');
                        scheduleFixedLineHide(line, BLANK_CUTOFF_HIDE_DELAY_MS);
                    } else {
                        line.classList.add('fixed-hidden');
                        line.classList.remove('fixed-leaving');
                    }
                } else {
                    line.classList.remove('fixed-hidden', 'fixed-leaving');
                }
            } else {
                line.classList.remove('fixed-hidden', 'fixed-leaving');
            }

            if (shouldHideAfterBlank) {
                if (displayMode === 'scroll') {
                    scheduleScrollBlankFade(line);
                } else {
                    line.classList.add('hidden-after-blank');
                }
            }
        });

        scheduleLeavingCurrentRelease(pendingLeavingCurrentLines);

        if (displayMode !== 'scroll') {
            reorderFixedModeVisibleLines(displayMode, currentIndex, lines);
            if (shouldAnimateActiveLine) {
                queueActivatingCurrentCleanup(lines);
            }
        } else {
            restoreNaturalLyricDomOrder(lines);
        }

        if ((hasActiveLineChanged || hasDisplayModeChanged || hasExpandedModeChanged) && displayMode === 'scroll') {
            const currentSourceLine = state.currentLyrics[currentIndex];
            const isCurrentBlankCutoffLine = shouldApplyBlankCutoff && isFrontendBlankNote(currentSourceLine);
            if (isCurrentBlankCutoffLine) {
                lastRenderedLyricIndex = currentIndex;
                lastRenderedLyricsExpanded = isExpanded;
                lastRenderedLyricDisplayMode = displayMode;
                endLyricModeSwitchMaskSoon();
                return;
            }
            // Defer by one animation frame so the browser reflows the
            // newly-applied .current class before we read offsetTop.
            // This makes the scroll fire at the same frame as word-bounce,
            // eliminating the "late" feeling.
            requestAnimationFrame(() => {
                centerActiveLyricLineStrict(currentIndex, lyricsContainer);
            });
        }
    }

    lastRenderedLyricIndex = currentIndex;
    lastRenderedLyricsExpanded = isExpanded;
    lastRenderedLyricDisplayMode = displayMode;
    endLyricModeSwitchMaskSoon();
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
    div.dataset.isBlankLine = isMusicNote ? 'true' : 'false';

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
        !isMusicNote
        && div.dataset.isBlankLine !== 'true'
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
    const normalizeParsedLines = (lines) => Array.isArray(lines) ? lines.filter(Boolean) : [];
    const createLyricLine = ({
        time,
        rawTime = time,
        text = '',
        sourceIndex = null,
        parsedIndex = null,
        isInjectedBlank = false,
        injectedKind = '',
        isLeadingSynthetic = false
    }) => {
        const numericTime = Number(time);
        const safeTime = Number.isFinite(numericTime) ? Math.max(0, numericTime) : 0;
        const normalizedText = (text || '').toString();
        const trimmedText = normalizedText.trim();
        const isBlank = trimmedText === '';
        return {
            time: safeTime,
            rawTime: Number.isFinite(Number(rawTime)) ? Number(rawTime) : safeTime,
            text: normalizedText,
            isEmpty: isBlank,
            isSourceBlank: !isInjectedBlank && isBlank,
            isInjectedBlank,
            injectedKind,
            isLeadingSynthetic,
            sourceIndex: Number.isFinite(Number(sourceIndex)) ? Number(sourceIndex) : null,
            parsedIndex: Number.isFinite(Number(parsedIndex)) ? Number(parsedIndex) : null
        };
    };
    const isBlankLine = (line) => {
        const text = (line?.text || '').toString().trim();
        return !!line?.isInjectedBlank || !!line?.isEmpty || !!line?.isSourceBlank || text === '';
    };
    const injectSyntheticBlankLines = (lines) => {
        if (!Array.isArray(lines) || lines.length === 0) return [];

        const injected = [];
        const firstLine = lines[0];
        const firstLineTime = Number(firstLine?.time);
        if (!isBlankLine(firstLine) && Number.isFinite(firstLineTime) && firstLineTime > 0) {
            injected.push(createLyricLine({
                time: 0,
                text: '',
                isInjectedBlank: true,
                injectedKind: 'leading-gap',
                isLeadingSynthetic: true
            }));
        }

        for (let i = 0; i < lines.length; i += 1) {
            const currentLine = lines[i];
            injected.push(currentLine);

            if (i >= lines.length - 1) continue;

            const nextLine = lines[i + 1];
            const currentTime = Number(currentLine?.time);
            const nextTime = Number(nextLine?.time);
            if (!Number.isFinite(currentTime) || !Number.isFinite(nextTime)) continue;

            const gapSeconds = nextTime - currentTime;
            if (gapSeconds <= GAP_FILL_BASE_THRESHOLD_SECONDS) continue;
            if (isBlankLine(currentLine) || isBlankLine(nextLine)) continue;

            const blankTime = currentTime + FINAL_BLANK_TARGET_GAP_SECONDS;
            if (!(blankTime < nextTime)) continue;

            injected.push(createLyricLine({
                time: blankTime,
                text: '',
                isInjectedBlank: true,
                injectedKind: 'mid-gap'
            }));
        }

        const lastLine = lines[lines.length - 1];
        const lastLineTime = Number(lastLine?.time);
        if (!isBlankLine(lastLine) && Number.isFinite(lastLineTime)) {
            injected.push(createLyricLine({
                time: lastLineTime + FINAL_BLANK_TARGET_GAP_SECONDS,
                text: '',
                isInjectedBlank: true,
                injectedKind: 'trailing-gap'
            }));
        }

        return injected;
    };

    // Array format: [{ time, text }]
    if (Array.isArray(syncedSource)) {
        return injectSyntheticBlankLines(normalizeParsedLines(syncedSource
            .map((item, sourceIndex) => {
                const numericTime = Number(item?.time);
                const time = Number.isFinite(numericTime) ? numericTime : 0;
                const text = (item?.text || '').toString();
                const isIncomingBlank = !!item?.isEmpty || !!item?.isSourceBlank || text.trim() === '';
                const rawSourceIndex = Number(item?.sourceIndex);
                const rawParsedIndex = Number(item?.parsedIndex);
                return createLyricLine({
                    time,
                    rawTime: time,
                    text: isIncomingBlank ? '' : text,
                    sourceIndex: Number.isFinite(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : sourceIndex,
                    parsedIndex: Number.isFinite(rawParsedIndex) && rawParsedIndex >= 0 ? rawParsedIndex : sourceIndex
                });
            })
            .filter(Boolean)));
    }

    // LRC string format
    if (typeof syncedSource === 'string') {
        const parsedLines = normalizeParsedLines(syncedSource
            .split(/\r?\n/)
            .map((line, sourceIndex) => {
                const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
                if (!match) return null;
                const min = parseInt(match[1], 10);
                const sec = parseInt(match[2], 10);
                const ms = parseInt(match[3], 10);
                const divisor = (match[3].length === 3 ? 1000 : 100);
                const text = (match[4] || '').toString();
                const rawTime = (min * 60) + sec + (ms / divisor);
                return createLyricLine({
                    // Keep provider timestamps intact. Subtracting a fixed parse-time
                    // offset makes some sources, including YouTube Music-backed flows,
                    // advance to the next lyric line too early for the entire song.
                    time: rawTime,
                    rawTime,
                    text,
                    sourceIndex
                });
            })
            .filter(Boolean))
            .map((line, parsedIndex) => ({
                ...line,
                parsedIndex
            }));
        return injectSyntheticBlankLines(parsedLines);
    }

    return [];
}

function clampTrailingBlankToSongDuration(lines, songDuration) {
    if (!Array.isArray(lines) || lines.length === 0) return lines || [];
    const duration = Number(songDuration);
    if (!Number.isFinite(duration) || duration <= 0) return lines;

    const out = [...lines];
    const lastIndex = out.length - 1;
    const last = out[lastIndex];
    if (!last?.isInjectedBlank || last?.injectedKind !== 'trailing-gap') return out;

    const trailingTime = Number(last?.time);
    if (!Number.isFinite(trailingTime)) return out;
    if (trailingTime <= duration) return out;

    // Keep the trailing blank reachable before playback time clamps at duration.
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
    clearPendingLyricsContainerHide();

    const revealLyricsBlock = (activeContainer, inactiveContainer, beforeReveal = null) => {
        if (inactiveContainer) {
            inactiveContainer.classList.remove('revealed');
            inactiveContainer.style.display = 'none';
        }
        if (!activeContainer) return;

        activeContainer.classList.remove('revealed');
        activeContainer.style.display = 'flex';
        if (typeof beforeReveal === 'function') {
            beforeReveal();
        }
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
        updateLyricDisplayModeDomState(normalizeLyricDisplayMode(currentLyricDisplayMode));
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
            }, LYRICS_CONTAINER_EXIT_DURATION_MS);
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
    cancelPendingLeavingCurrentAnimation();
    cancelPendingLyricModeReveal();

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
            state.currentLyrics = clampTrailingBlankToSongDuration(state.currentLyrics, knownDuration);

            if (state.currentLyrics.length > 0) {
                if (!isFetchStillValid() || !isRenderStillCurrent()) return;
                const buildAssistIndexMaps = (sourceItems) => {
                    if (!Array.isArray(sourceItems)) return null;
                    const bySourceIndex = new Map();
                    const byParsedIndex = new Map();
                    let hasSourceIndexes = false;
                    sourceItems.forEach((item, idx) => {
                        const text = (item?.text || '').toString();
                        const rawSourceIndex = Number(item?.sourceIndex);
                        const rawParsedIndex = Number(item?.parsedIndex);
                        if (Number.isFinite(rawSourceIndex) && rawSourceIndex >= 0 && !bySourceIndex.has(rawSourceIndex)) {
                            bySourceIndex.set(rawSourceIndex, text);
                            hasSourceIndexes = true;
                        }
                        const parsedKey = Number.isFinite(rawParsedIndex) && rawParsedIndex >= 0 ? rawParsedIndex : idx;
                        if (!byParsedIndex.has(parsedKey)) {
                            byParsedIndex.set(parsedKey, text);
                        }
                    });
                    return { bySourceIndex, byParsedIndex, hasSourceIndexes };
                };
                const romanizedAssistMaps = buildAssistIndexMaps(romanizedSyncedSource);
                const translatedAssistMaps = buildAssistIndexMaps(translatedSyncedSource);
                const resolveAssistText = (maps, line) => {
                    if (!maps || line?.isInjectedBlank) return '';
                    const sourceIndex = Number(line?.sourceIndex);
                    if (Number.isFinite(sourceIndex) && sourceIndex >= 0 && maps.bySourceIndex.has(sourceIndex)) {
                        return (maps.bySourceIndex.get(sourceIndex) || '').toString();
                    }
                    if (maps.hasSourceIndexes && Number.isFinite(sourceIndex) && sourceIndex >= 0) {
                        return '';
                    }
                    const parsedIndex = Number(line?.parsedIndex);
                    if (Number.isFinite(parsedIndex) && parsedIndex >= 0) {
                        return (maps.byParsedIndex.get(parsedIndex) || '').toString();
                    }
                    return '';
                };

                state.currentLyrics.forEach((line, index) => {
                    const isBlankLine = !!line?.isEmpty || !!line?.isSourceBlank || !!line?.isInjectedBlank;
                    const text = isBlankLine
                        ? MUSIC_NOTE_SYMBOL
                        : (line?.text ?? '').toString();
                    const prefetchedRomanized = resolveAssistText(romanizedAssistMaps, line);
                    const prefetchedTranslation = resolveAssistText(translatedAssistMaps, line);
                    const div = buildWordAnimatedLine(text, {
                        index,
                        needsRomanization: !isBlankLine && !line?.isInjectedBlank && isNonLatin(text),
                        isMusicNote: isBlankLine,
                        prefetchedRomanized,
                        prefetchedTranslation
                    });
                    applyLineTimingStyles(div, index);
                    if (syncedLyricsContainer) syncedLyricsContainer.appendChild(div);
                });
                refreshLyricLineElements();

                if (lyricsContainer) lyricsContainer.classList.remove('plain-mode');
                const finalizeLyricsReveal = async () => {
                    if (!isFetchStillValid() || !isRenderStillCurrent()) return;

                    const localCurrentTime = (state.currentSongData && typeof state.currentSongData.elapsedSeconds === 'number')
                        ? state.currentSongData.elapsedSeconds
                        : 0;
                    const fetchedCurrentTime = await fetchFreshSongElapsedForRender(
                        state.currentVideoId,
                        localCurrentTime
                    );
                    if (!isFetchStillValid() || !isRenderStillCurrent()) return;
                    const currentTime = (() => {
                        const localTime = Number(localCurrentTime);
                        const fetchedTime = Number(fetchedCurrentTime);
                        const safeLocalTime = Number.isFinite(localTime) ? Math.max(0, localTime) : 0;
                        const safeFetchedTime = Number.isFinite(fetchedTime) ? Math.max(0, fetchedTime) : safeLocalTime;

                        // On song changes, the local client state can briefly keep a
                        // stale advanced elapsed value while /song has already been
                        // corrected by newer server data. Preserve the "use the more
                        // advanced local time" behavior only for small tick-sized
                        // differences; otherwise prefer the fresher server value.
                        if (safeLocalTime > (safeFetchedTime + 2)) {
                            return safeFetchedTime;
                        }

                        return Math.max(safeLocalTime, safeFetchedTime);
                    })();

                    if (isFetchStillValid() && isRenderStillCurrent()) {
                        if (lyricsLoadingEl) lyricsLoadingEl.classList.remove('active');
                        if (lyricsContainer) {
                            lyricsContainer.classList.remove('loading-lyrics');
                            lyricsContainer.classList.add('has-lyrics');
                        }
                    }

                    if (isFetchStillValid() && isRenderStillCurrent()) {
                        revealLyricsBlock(syncedLyricsContainer, plainLyricsContainer, () => {
                            updateLyricsDisplay(currentTime, { initialReveal: true });
                        });
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

                    // When lyrics finish mounting mid-song, keep the most advanced
                    // elapsed time we already know locally. A fresh /song response
                    // can legitimately lag behind the websocket/local progress path
                    // by a tick, and forcing that older value on first paint is what
                    // makes the initial line appear late until the next playback event.
                    centerActiveLyricLineStrict(lastRenderedLyricIndex, lyricsContainer, { behavior: 'instant' });

                    if (setLastFetched) {
                        state.lastFetchedVideoId = state.currentVideoId;
                        state.currentFetchVideoId = null;
                    }

                    console.log(`[${logTag}] Lyrics loaded and displayed (synced)`);
                };

                void finalizeLyricsReveal();
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
    cancelPendingLeavingCurrentAnimation();
    cancelPendingLyricModeReveal();

    try {
        state.currentLyrics = [];
        state.isSyncedLyrics = false;
        state.currentFetchVideoId = null;
        state.lastFetchedVideoId = null;
        if (clearVideoId) state.currentVideoId = null;
    } catch (_) {
        // ignore
    }

    const lyricsContainer = document.getElementById('lyrics-container');
    const syncedLyricsContainer = document.getElementById('synced-lyrics');
    const plainLyricsContainer = document.getElementById('plain-lyrics');
    const lyricsLoadingEl = document.getElementById('lyrics-loading');
    const hadVisibleLyrics =
        !!lyricsContainer?.classList.contains('visible')
        || !!lyricsContainer?.classList.contains('has-lyrics')
        || !!syncedLyricsContainer?.children.length
        || !!plainLyricsContainer?.children.length;

    clearPendingLyricsContainerHide();

    if (hadVisibleLyrics) {
        if (lyricsContainer) lyricsContainer.classList.add('song-changing');
        if (syncedLyricsContainer) syncedLyricsContainer.classList.add('song-changing');
        if (plainLyricsContainer) plainLyricsContainer.classList.add('song-changing');
        const allLines = document.querySelectorAll('#synced-lyrics .lyric-line, #plain-lyrics .lyric-line');
        allLines.forEach((line) => line.classList.add('transitioning-out'));
    }

    const finalizeHide = () => {
        if (syncedLyricsContainer) syncedLyricsContainer.innerHTML = '';
        clearLyricLineElementsCache();
        if (plainLyricsContainer) {
            plainLyricsContainer.innerHTML = '';
            plainLyricsContainer.style.display = 'none';
            plainLyricsContainer.classList.remove('revealed');
            plainLyricsContainer.classList.remove('active', 'song-changing');
        }

        if (syncedLyricsContainer) {
            syncedLyricsContainer.classList.remove('revealed');
            syncedLyricsContainer.classList.remove('song-changing');
            syncedLyricsContainer.classList.add('transitioning');
        }
        if (lyricsContainer) {
            lyricsContainer.classList.add('no-lyrics');
            lyricsContainer.classList.remove('visible');
            lyricsContainer.classList.remove('has-lyrics');
            lyricsContainer.classList.remove('loading-lyrics');
            lyricsContainer.classList.remove('song-changing');
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
        lyricsContainerHideTimer = null;
    };

    if (hadVisibleLyrics) {
        lyricsContainerHideTimer = setTimeout(finalizeHide, LYRICS_CONTAINER_EXIT_DURATION_MS);
    } else {
        finalizeHide();
    }

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
