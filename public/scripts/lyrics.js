import { API_URL, state, resetSongState } from './modules/config.js';
import { initWebSocket } from './modules/connection.js';
import { ensureLyricsSongInfoVisible, settleLyricsSongInfoReveal, updateNowPlayingFromData } from './modules/now-playing.js';
import { updateLyricsDisplay, displayLyricsUI, hideLyricsUI, getLyricDisplayMode, setLyricDisplayMode, centerActiveLyricLineStrict } from './modules/lyric.js';
import {
    initLyricDynamicTheme,
    getLyricDynamicThemeEnabled,
    setLyricDynamicThemeEnabled
} from './modules/lyric-dynamic-theme.js';
import {
    initLyricControlPanel,
    DEFAULT_FONT_SIZE,
    MIN_FONT_SIZE,
    MAX_FONT_SIZE,
    FONT_SIZE_STEP,
    MIN_LYRICS_WIDTH_VW,
    MIN_LYRICS_WIDTH_VW_LOW_RES,
    MAX_LYRICS_WIDTH_VW,
    DEFAULT_LYRICS_WIDTH_VW,
    DEFAULT_LYRIC_DISPLAY_MODE,
    LYRIC_DISPLAY_MODE_LABELS,
    LYRIC_DISPLAY_MODE_VISIBLE_LINES,
    LYRIC_DISPLAY_MODE_ORDER,
    LYRIC_FONT_WEIGHT_PRESETS,
    LYRIC_FONT_WEIGHT_ORDER,
    LYRIC_BACKGROUND_PRESETS,
    DEFAULT_LYRIC_BACKGROUND_PRESET,
    LYRIC_BACKGROUND_ORDER,
    LAYOUT_POSITION_ORDER,
    LAYOUT_POSITION_LABELS
} from './modules/lyric-control.js';
import { canonicalizeText, escapeHtml, escapeHtmlAttribute } from './modules/utils.js';

// Enable "hide lines after active blank-note" only for dedicated lyrics page.
window.__lyricsBlankCutoffEnabled = true;
window.__lyricsLeadingGhostLinesCount = 1;
window.__lyricsLeadingSpacingGhostLinesCount = 0;

// Lyrics app specific state
let lyricsContainerClickable = false;
const SETTINGS_KEY = 'lyricsSettings';
const DEFAULT_LYRICS_PAGE_WIDTH_PERCENT = 15;
const DEFAULT_LYRICS_PAGE_DISPLAY_MODE = 'fixed-2';
const DEFAULT_LYRICS_PAGE_FONT_WEIGHT_PRESET = 'bold';

function isDownloadPreviewPage() {
    return !!document.body?.classList.contains('download-page');
}

// Manual theme colors (used when dynamic theme is toggled off, and when cycling).
const MANUAL_LYRIC_THEME_COLORS = [
    { name: 'White', hex: 'ccccc1' },
    { name: 'Red', hex: 'ef4144' },
    { name: 'Red V2', hex: '990f04' },
    { name: 'Light Pink', hex: 'ffbaba' },
    { name: 'Green', hex: '8fc04f' },
    { name: 'Blue', hex: '30bdd5' },
    { name: 'Yellow', hex: 'f5f07c' },
    { name: 'Orange', hex: 'fbbf1f' },
    { name: 'Purple', hex: 'c09ccb' }
];
let currentManualLyricThemeColorIndex = 0;

function normalizeHexColor(hex) {
    const raw = String(hex || '').trim().replace(/^#/, '');
    if (raw.length === 3) {
        return `#${raw.split('').map((c) => c + c).join('')}`;
    }
    if (raw.length !== 6) return null;
    return `#${raw}`;
}

function parseCssColorToRgbStruct(colorValue) {
    const raw = String(colorValue || '').trim();
    if (!raw) return null;

    const hex = normalizeHexColor(raw);
    if (hex) return hexToRgb(hex);

    const rgbMatch = raw.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+\s*)?\)$/i);
    if (!rgbMatch) return null;
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if (![r, g, b].every((v) => Number.isFinite(v))) return null;
    return {
        r: Math.max(0, Math.min(255, Math.round(r))),
        g: Math.max(0, Math.min(255, Math.round(g))),
        b: Math.max(0, Math.min(255, Math.round(b)))
    };
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    const h = normalized.slice(1);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (![r, g, b].every((v) => Number.isFinite(v))) return null;
    return { r, g, b };
}

function rgbToHex(r, g, b) {
    const to = (x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            default: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
    h /= 360;
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }

    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
}

function luminanceFromRgb(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function buildLyricPaletteFromPrimaryHex(primaryHex) {
    const primaryRgb = hexToRgb(primaryHex);
    if (!primaryRgb) return null;
    const primary = normalizeHexColor(primaryHex);
    if (!primary) return null;

    const [h, s, l] = rgbToHsl(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    const primaryL = l;

    const secondaryRgb = hslToRgb(h, Math.min(1, s * 0.75), primaryL * 0.50);
    const secVar1Rgb = hslToRgb(h, Math.min(1, s * 0.25), Math.min(0.93, primaryL * 0.75));
    const secVar2Rgb = hslToRgb(h, Math.min(1, s * 0.125), primaryL * 0.50);
    const bgRgb = hslToRgb(h, Math.min(1, s * 0.125), primaryL * 0.05);

    const secondary = rgbToHex(...secondaryRgb);
    const secVar1 = rgbToHex(...secVar1Rgb);
    const secVar2 = rgbToHex(...secVar2Rgb);
    const bgTint = rgbToHex(...bgRgb);
    const onPrimary = luminanceFromRgb(primaryRgb.r, primaryRgb.g, primaryRgb.b) > 0.55 ? '#1a1a1a' : '#f5f5f5';

    return { primary, secondary, secVar1, secVar2, bgTint, onPrimary };
}

function applyLyricThemePalette(palette) {
    if (!palette) return;

    const tauri = window.__TAURI__?.core ?? window.__TAURI_INTERNALS__?.core ?? window.__TAURI__;
    const invoke = tauri?.invoke ?? tauri?.core?.invoke;
    if (typeof invoke === 'function') {
        invoke('set_theme_palette', { palette }).catch((e) =>
            console.error('[LyricTheme] Tauri invoke error:', e)
        );
    }

    let styleEl = document.getElementById('__dt_vars');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = '__dt_vars';
        (document.head || document.documentElement).appendChild(styleEl);
    }

    styleEl.textContent = `
      :root {
        --text-primary:         ${palette.primary}   !important;
        --text-secondary:       ${palette.secondary} !important;
        --text-secondary-var1:  ${palette.secVar1}   !important;
        --text-secondary-var2:  ${palette.secVar2}   !important;
        --dt-primary:           ${palette.primary}   !important;
        --dt-secondary:         ${palette.secondary} !important;
        --dt-secondary-var1:    ${palette.secVar1}   !important;
        --dt-secondary-var2:    ${palette.secVar2}   !important;
        --dt-bg-tint:           ${palette.bgTint}    !important;
        --dt-on-primary:        ${palette.onPrimary} !important;
      }
    `;

    const root = document.documentElement;
    const vars = {
        '--text-primary': palette.primary,
        '--text-secondary': palette.secondary,
        '--text-secondary-var1': palette.secVar1,
        '--text-secondary-var2': palette.secVar2,
        '--dt-primary': palette.primary,
        '--dt-secondary': palette.secondary,
        '--dt-secondary-var1': palette.secVar1,
        '--dt-secondary-var2': palette.secVar2,
        '--dt-bg-tint': palette.bgTint,
        '--dt-on-primary': palette.onPrimary
    };

    for (const [key, value] of Object.entries(vars)) {
        root.style.setProperty(key, value);
    }
}

function applyLyricThemeColorHex(primaryHex) {
    const palette = buildLyricPaletteFromPrimaryHex(primaryHex);
    applyLyricThemePalette(palette);
    refreshDynamicLyricBackgroundIfNeeded();
    refreshDynamicThemeIconColor();
    return palette;
}

function getCurrentAppliedThemePrimaryHex() {
    const rootStyles = getComputedStyle(document.documentElement);
    const fromTextPrimary = parseCssColorToRgbStruct(rootStyles.getPropertyValue('--text-primary'));
    if (fromTextPrimary) return rgbToHex(fromTextPrimary.r, fromTextPrimary.g, fromTextPrimary.b);
    const fromDtPrimary = parseCssColorToRgbStruct(rootStyles.getPropertyValue('--dt-primary'));
    if (fromDtPrimary) return rgbToHex(fromDtPrimary.r, fromDtPrimary.g, fromDtPrimary.b);
    const fallback = MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex;
    return normalizeHexColor(fallback) || '#2a2a2a';
}

function buildDynamicLyricBackgroundFromPrimaryHex(primaryHex) {
    const rgb = hexToRgb(primaryHex);
    if (!rgb) return 'rgba(12, 12, 12, 0.96)';
    const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const darkL = Math.max(0.02, Math.min(0.12, l * 0.24));
    const darkS = Math.max(0.06, Math.min(0.62, s * 0.55));
    const [r, g, b] = hslToRgb(h, darkS, darkL);
    return `rgba(${r}, ${g}, ${b}, 0.96)`;
}

function applyDynamicLyricBackground() {
    const primaryHex = getCurrentAppliedThemePrimaryHex();
    const dynamicBg = buildDynamicLyricBackgroundFromPrimaryHex(primaryHex);
    document.documentElement.style.setProperty('--text-bg', dynamicBg, 'important');
}

function refreshDynamicThemeIconColor() {
    const btn = document.getElementById('lyrics-dynamic-theme-toggle');
    if (!btn) return;
    const primaryHex = getCurrentAppliedThemePrimaryHex();
    btn.style.setProperty('--lyrics-dynamic-theme-icon-color', primaryHex);
}

function scheduleDynamicThemeDependentRefresh() {
    if (window._dynamicThemeDependentSyncRaf) cancelAnimationFrame(window._dynamicThemeDependentSyncRaf);
    window._dynamicThemeDependentSyncRaf = requestAnimationFrame(() => {
        window._dynamicThemeDependentSyncRaf = null;
        refreshDynamicLyricBackgroundIfNeeded();
        refreshDynamicThemeIconColor();
        updateLyricsBackgroundToggleLabel();
        updateLyricsThemeColorCycleLabel();
    });
}

function initializeDynamicThemeDependentSync() {
    if (window._lyricsDynamicThemeDependentSyncInitialized) return;
    window._lyricsDynamicThemeDependentSyncInitialized = true;

    const observeDtVarsIfPresent = () => {
        const dtVars = document.getElementById('__dt_vars');
        if (!dtVars || dtVars.__lyricsObserverAttached) return;
        const styleObserver = new MutationObserver(() => scheduleDynamicThemeDependentRefresh());
        styleObserver.observe(dtVars, { childList: true, characterData: true, subtree: true });
        dtVars.__lyricsObserverAttached = true;
    };

    const rootObserver = new MutationObserver(() => scheduleDynamicThemeDependentRefresh());
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

    const headObserver = new MutationObserver(() => {
        observeDtVarsIfPresent();
        scheduleDynamicThemeDependentRefresh();
    });
    headObserver.observe(document.head || document.documentElement, { childList: true, subtree: true });

    observeDtVarsIfPresent();
}

function refreshDynamicLyricBackgroundIfNeeded() {
    if (normalizeLyricBackgroundPreset(currentLyricBackgroundPreset) !== 'dynamic') return;
    applyDynamicLyricBackground();
}

// Track manual pause state (separate from playback pause) - make it global
window.manuallyPaused = false;

// Font sizing + layout defaults are centralized in `lyric-control.js`.
let currentLyricFontSize = DEFAULT_FONT_SIZE;
let lowResLyricFontSizeOffset = 0;
let currentLyricFontWeightPreset = DEFAULT_LYRICS_PAGE_FONT_WEIGHT_PRESET;
let currentLyricBackgroundPreset = DEFAULT_LYRIC_BACKGROUND_PRESET;
const lyricControlLabelTouched = {
    mode: false,
    font: false,
    background: false,
    position: false,
    dynamic: false,
    color: false
};
let lyricsViewportResizeObserver = null;
let lyricsWidthBoundsResizeObserver = null;
let lyricsWidthBoundsObservedElement = null;
let lyricsWidthBoundsResizeRaf = null;
let recenterAfterResizeRaf = null;
let viewportSyncTimeout = null;
let currentLyricsMaxWidthVw = DEFAULT_LYRICS_PAGE_WIDTH_PERCENT;
let currentLyricsDisplayMode = DEFAULT_LYRICS_PAGE_DISPLAY_MODE;
let lyricsWidthDragActive = false;
let lyricsWidthDragHandleSide = null;
let isWidthShortcutHeld = false;
let isWidthControlHovered = false;
let isLyricsWindowHovered = false;
let widthControlAutoHideTimeout = null;
let wheelResizeAnchorRaf = null;
let wheelResizeFreezeTimeout = null;
let applyLyricSizingRaf = null;
let windowResizeRaf = null;
let windowResizeSettleTimeout = null;
let configuredLyricsMinWidthVwCache = null;
let configuredLyricsMaxWidthVwCache = null;
const WHEEL_RESIZE_ACTIVE_LINE_FREEZE_MS = 650;

function getAuthoredRootCssPercentVar(name, fallback) {
    try {
        for (const sheet of Array.from(document.styleSheets || [])) {
            let rules;
            try {
                rules = sheet.cssRules;
            } catch (_) {
                continue;
            }
            if (!rules) continue;
            for (const rule of Array.from(rules)) {
                if (!(rule instanceof CSSStyleRule)) continue;
                if (rule.selectorText !== ':root') continue;
                const raw = rule.style?.getPropertyValue(name)?.trim();
                const parsed = parseFloat(raw || '');
                if (Number.isFinite(parsed)) return parsed;
            }
        }
    } catch (_) {}
    return fallback;
}

function getCssPercentVar(name, fallback) {
    const root = document.documentElement;
    if (!root) return fallback;
    const raw = getComputedStyle(root).getPropertyValue(name).trim();
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getConfiguredLyricsMinWidthVw() {
    if (configuredLyricsMinWidthVwCache == null) {
        configuredLyricsMinWidthVwCache = getAuthoredRootCssPercentVar(
            '--lyrics-min-width',
            getCssPercentVar('--lyrics-min-width', MIN_LYRICS_WIDTH_VW)
        );
    }
    return configuredLyricsMinWidthVwCache;
}

function getConfiguredLyricsMaxWidthVw() {
    if (configuredLyricsMaxWidthVwCache == null) {
        configuredLyricsMaxWidthVwCache = getAuthoredRootCssPercentVar(
            '--lyrics-max-width',
            getCssPercentVar('--lyrics-max-width', DEFAULT_LYRICS_WIDTH_VW)
        );
    }
    return configuredLyricsMaxWidthVwCache;
}
// Single-shot re-anchor fetch when tab regains visibility (no burst polling needed —
// the rAF clock in now-playing.js keeps time accurately while hidden).
function isPhoneLayoutEnvironment() {
    const ua = navigator.userAgent || '';
    const isPhoneUa = /iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile/i.test(ua);
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const noHover = window.matchMedia?.('(hover: none)')?.matches ?? false;
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const shortestSide = Math.min(viewportWidth, viewportHeight);
    const phoneViewport = shortestSide <= 520 || viewportWidth <= 767;

    // Treat as phone layout only when the viewport is actually phone-sized.
    // This avoids wide DevTools responsive widths (e.g. 1200px+) being forced into phone rules.
    return (isPhoneUa && coarsePointer && noHover && phoneViewport)
        || (coarsePointer && noHover && phoneViewport);
}

function applyPhoneLayoutMode() {
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle('is-phone-layout', isPhoneLayoutEnvironment());
}

function getLyricsWidthBoundsElement() {
    const layoutContainer = document.getElementById('layout-container');
    const explicitBounds = document.querySelector('[data-lyrics-width-bounds]');
    const previewBounds = document.getElementById('main-demo');
    const parentBounds = layoutContainer?.parentElement;
    const scopedParentBounds = (parentBounds && parentBounds !== document.body && parentBounds !== document.documentElement)
        ? parentBounds
        : null;
    const candidates = [
        explicitBounds,
        previewBounds,
        scopedParentBounds,
        isDownloadPreviewPage() ? layoutContainer : null,
        document.documentElement
    ];

    for (const candidate of candidates) {
        if (!(candidate instanceof Element)) continue;
        const rect = candidate.getBoundingClientRect?.();
        if ((rect?.width || 0) > 0) {
            return candidate;
        }
    }

    return document.documentElement;
}

function getLyricsHoverBoundsElement() {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsContainer instanceof Element) {
        return lyricsContainer;
    }
    return getLyricsWidthBoundsElement();
}

function getLyricsWidthBoundsRect() {
    return getLyricsWidthBoundsElement()?.getBoundingClientRect?.()
        || document.documentElement.getBoundingClientRect();
}

function syncAmbientBgScreenMetrics() {
    const root = document.documentElement;
    if (!root) return;
    const screenWidth = Math.max(
        window.screen?.availWidth || 0,
        window.screen?.width || 0,
        window.innerWidth || 0,
        document.documentElement.clientWidth || 0,
        1
    );
    const screenHeight = Math.max(
        window.screen?.availHeight || 0,
        window.screen?.height || 0,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        1
    );

    // Oversize the ambient layer relative to the full display so window resize
    // does not keep changing the blur surface at the viewport edges.
    root.style.setProperty('--ambient-bg-screen-width', `${Math.round(screenWidth * 1.35)}px`);
    root.style.setProperty('--ambient-bg-screen-height', `${Math.round(screenHeight * 1.35)}px`);
}

function applyBaseSizing() {
    const scale = detectUiScale();
    document.documentElement.style.setProperty('--ui-scale', String(scale));
    document.documentElement.style.setProperty('--lyrics-center-max-height', '90vh');
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    if (viewportWidth <= 767) {
        lowResLyricFontSizeOffset = 0;
        currentLyricFontSize = getResponsiveLowResBaseFontSize();
    } else if (!window._userSetFontSize) {
        currentLyricFontSize = Math.round(DEFAULT_FONT_SIZE * scale);
    }
    initLyricsWidthBoundsObserver();
    applyLyricsMaxWidth(currentLyricsMaxWidthVw);
    applyLyricSizing();
    requestAnimationFrame(() => syncWidthControlButtonMetrics());
}

function syncLyricsViewportHeight() {
    const root = document.documentElement;
    if (!root) return;
    syncCenterViewportMaxHeight();

    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return;

    const visibleLines = parseFloat(getComputedStyle(root).getPropertyValue('--lyrics-visible-lines')) || 3;
    const allLines = Array.from(lyricsContainer.querySelectorAll('#synced-lyrics .lyric-line, #plain-lyrics .lyric-line'))
        .filter((line) => line && line.getClientRects().length > 0);
    const rootStyles = getComputedStyle(root);

    // Measure actual rendered row height to avoid stale CSS var values/cropping after zoom.
    const measuredRowHeights = allLines
        .slice(0, 12)
        .map((line) => {
            const styles = getComputedStyle(line);
            const marginTop = parseFloat(styles.marginTop) || 0;
            const marginBottom = parseFloat(styles.marginBottom) || 0;
            const rectHeight = line.getBoundingClientRect().height || 0;
            return rectHeight + Math.max(0, marginTop) + Math.max(0, marginBottom);
        })
        .filter((value) => Number.isFinite(value) && value > 0);

    const fallbackLineHeight = parseFloat(rootStyles.getPropertyValue('--lyric-line-height')) || 40;
    const fallbackGap = parseFloat(rootStyles.getPropertyValue('--lyrics-line-outer-gap')) || 16;
    const singleRowHeight = measuredRowHeights.length > 0
        ? Math.max(...measuredRowHeights)
        : (fallbackLineHeight + fallbackGap);
    const viewportHeight = Math.max(1, Math.round(singleRowHeight * visibleLines));
    const fadeSize = Math.max(12, Math.min(160, Math.round(singleRowHeight * 0.9)));

    root.style.setProperty('--lyrics-viewport-height', `${viewportHeight}px`);
    root.style.setProperty('--lyrics-edge-fade-size', `${fadeSize}px`);
}

function syncCenterViewportMaxHeight() {
    const root = document.documentElement;
    if (!root) return;

    const layoutContainer = document.getElementById('layout-container');
    const songInfo = document.getElementById('song-info');
    const widthControl = document.getElementById('lyrics-width-control');
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const songInfoHeight = songInfo?.getBoundingClientRect?.().height || 0;
    const controlsHeight = Math.max(44, widthControl?.getBoundingClientRect?.().height || 0);
    root.style.setProperty('--lyrics-song-info-height', `${Math.round(songInfoHeight)}px`);
    const isCenter = !!layoutContainer?.classList.contains('position-center');
    const reservedHeight = isCenter
        ? (songInfoHeight + controlsHeight + 96)
        : 96;
    const safeMaxHeight = Math.max(180, Math.floor(viewportHeight - reservedHeight));
    root.style.setProperty('--lyrics-center-max-height', `${safeMaxHeight}px`);
}

function scheduleViewportSync() {
    syncLyricsViewportHeight();
    requestAnimationFrame(() => syncLyricsViewportHeight());
}

function runViewportSyncAndRecenter() {
    if (viewportSyncTimeout) {
        clearTimeout(viewportSyncTimeout);
        viewportSyncTimeout = null;
    }

    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const layoutContainer = document.getElementById('layout-container');
    const isMobileCenterScroll =
        viewportWidth <= 767
        && !!layoutContainer?.classList.contains('position-center')
        && getLyricDisplayMode() === 'scroll';
    const activeIndex = isMobileCenterScroll ? captureCurrentActiveLyricIndex() : -1;
    scheduleViewportSync();

    if (recenterAfterResizeRaf) cancelAnimationFrame(recenterAfterResizeRaf);
    recenterAfterResizeRaf = requestAnimationFrame(() => {
        recenterAfterResizeRaf = requestAnimationFrame(() => {
            recenterAfterResizeRaf = null;
            if (!isMobileCenterScroll || activeIndex < 0) return;
            const lyricsContainer = document.getElementById('lyrics-container');
            if (!lyricsContainer) return;
            centerActiveLyricLineStrict(activeIndex, lyricsContainer);
        });
    });
}

function scheduleViewportSyncAndRecenter() {
    if (viewportSyncTimeout) clearTimeout(viewportSyncTimeout);
    viewportSyncTimeout = setTimeout(() => {
        runViewportSyncAndRecenter();
    }, 16);
}

function getLyricsScrollContainer() {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return null;
    return lyricsContainer.querySelector('#lyrics-content') || lyricsContainer;
}

function captureActiveLyricAnchor() {
    if (getLyricDisplayMode() !== 'scroll') return null;

    const lyricsContainer = document.getElementById('lyrics-container');
    const scrollContainer = getLyricsScrollContainer();
    if (!lyricsContainer || !scrollContainer) return null;

    const activeLine = lyricsContainer.querySelector(
        '#synced-lyrics .lyric-line.current, #plain-lyrics .lyric-line.current'
    );
    if (!activeLine) return null;

    const lineRect = activeLine.getBoundingClientRect();
    const scrollRect = scrollContainer.getBoundingClientRect();
    const centerOffset = (lineRect.top - scrollRect.top) + (lineRect.height / 2);
    const index = Number.parseInt(activeLine.dataset.index || '-1', 10);
    if (!Number.isFinite(index) || index < 0) return null;

    return { index, centerOffset };
}

function captureCurrentActiveLyricIndex() {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return -1;
    const activeLine = lyricsContainer.querySelector(
        '#synced-lyrics .lyric-line.current, #plain-lyrics .lyric-line.current'
    );
    if (!activeLine) return -1;
    const index = Number.parseInt(activeLine.dataset.index || '-1', 10);
    return Number.isFinite(index) ? index : -1;
}

function restoreActiveLyricAnchor(anchor) {
    if (!anchor || getLyricDisplayMode() !== 'scroll') return;

    const lyricsContainer = document.getElementById('lyrics-container');
    const scrollContainer = getLyricsScrollContainer();
    if (!lyricsContainer || !scrollContainer) return;

    const lineElement = lyricsContainer.querySelector(`.lyric-line[data-index="${anchor.index}"]`);
    if (!lineElement) return;

    const lineRect = lineElement.getBoundingClientRect();
    const scrollRect = scrollContainer.getBoundingClientRect();
    const currentCenterOffset = (lineRect.top - scrollRect.top) + (lineRect.height / 2);
    const delta = currentCenterOffset - anchor.centerOffset;
    if (Math.abs(delta) <= 0.5) return;

    scrollContainer.scrollTop += delta;
}

function scheduleWheelResizeAnchorRestore(anchor, activeIndex = -1) {
    if (!anchor && (!Number.isFinite(activeIndex) || activeIndex < 0)) return;
    if (wheelResizeAnchorRaf) cancelAnimationFrame(wheelResizeAnchorRaf);
    wheelResizeAnchorRaf = requestAnimationFrame(() => {
        wheelResizeAnchorRaf = null;
        scheduleViewportSync();
        if (anchor) {
            restoreActiveLyricAnchor(anchor);
        }
        if (Number.isFinite(activeIndex) && activeIndex >= 0) {
            const lyricsContainer = document.getElementById('lyrics-container');
            if (lyricsContainer) {
                centerActiveLyricLineStrict(activeIndex, lyricsContainer, { behavior: 'instant' });
                requestAnimationFrame(() => {
                    if (!document.body?.contains(lyricsContainer)) return;
                    centerActiveLyricLineStrict(activeIndex, lyricsContainer, { behavior: 'instant' });
                });
            }
        }
    });
}

function scheduleWheelResizeActiveLineFreeze(index) {
    if (!Number.isFinite(index) || index < 0) return;
    window.__lyricsFrozenActiveLyricIndex = index;
    window.__lyricsFreezeActiveLyricUntil = Date.now() + WHEEL_RESIZE_ACTIVE_LINE_FREEZE_MS;
    if (wheelResizeFreezeTimeout) clearTimeout(wheelResizeFreezeTimeout);
    wheelResizeFreezeTimeout = setTimeout(() => {
        wheelResizeFreezeTimeout = null;
        window.__lyricsFreezeActiveLyricUntil = 0;
        window.__lyricsFrozenActiveLyricIndex = -1;
        runViewportSyncAndRecenter();
    }, WHEEL_RESIZE_ACTIVE_LINE_FREEZE_MS);
}

function applyLyricsMaxWidth(nextWidthVw) {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const root = document.documentElement;
    const layoutContainer = document.getElementById('layout-container');
    const boundsElement = getLyricsWidthBoundsElement();
    const boundsRect = getLyricsWidthBoundsRect();
    const availableWidthPx = boundsElement && boundsElement !== document.documentElement
        ? Math.max(20, Math.round(Number(boundsRect?.width) || viewportWidth))
        : (() => {
            const rootStyles = getComputedStyle(document.documentElement);
            const cornerLeftPx = parseFloat(rootStyles.getPropertyValue('--lyrics-corner-left')) || 0;
            const cornerRightPx = parseFloat(rootStyles.getPropertyValue('--lyrics-corner-right')) || 0;
            return Math.max(20, viewportWidth - cornerLeftPx - cornerRightPx);
        })();
    const useMobileSizing = viewportWidth <= 767 || isPhoneLayoutEnvironment();
    const configuredMaxWidthVw = getConfiguredLyricsMaxWidthVw();
    const mobileMaxWidthVw = 90;
    const minWidthPx = (() => {
        const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lyrics-min-width-px'));
        return Number.isFinite(raw) && raw > 0 ? raw : 128;
    })();
    const minWidthVw = (minWidthPx / availableWidthPx) * 100;

    root.style.setProperty('--lyrics-available-width', `${Math.round(availableWidthPx)}px`);
    if (layoutContainer) {
        layoutContainer.style.setProperty('--lyrics-available-width', `${Math.round(availableWidthPx)}px`);
    }
    root.style.setProperty('--lyrics-min-width-px', `${Math.round(minWidthPx)}px`);
    if (layoutContainer) {
        layoutContainer.style.setProperty('--lyrics-min-width-px', `${Math.round(minWidthPx)}px`);
    }
    if (useMobileSizing) {
        currentLyricsMaxWidthVw = mobileMaxWidthVw;
        root.style.setProperty('--lyrics-max-width', `${mobileMaxWidthVw}%`);
        root.style.setProperty('--lyrics-max-width-px', `${Math.round((availableWidthPx * mobileMaxWidthVw) / 100)}px`);
        if (layoutContainer) {
            layoutContainer.style.setProperty('--lyrics-max-width-px', `${Math.round((availableWidthPx * mobileMaxWidthVw) / 100)}px`);
        }
        return;
    }

    const parsed = Number(nextWidthVw);
    const clamped = Math.max(
        minWidthVw,
        Math.min(configuredMaxWidthVw, Number.isFinite(parsed) ? parsed : configuredMaxWidthVw)
    );
    currentLyricsMaxWidthVw = clamped;
    root.style.setProperty('--lyrics-max-width', `${clamped}%`);
    root.style.setProperty('--lyrics-max-width-px', `${Math.round((availableWidthPx * clamped) / 100)}px`);
    if (layoutContainer) {
        layoutContainer.style.setProperty('--lyrics-max-width-px', `${Math.round((availableWidthPx * clamped) / 100)}px`);
    }
}

function initLyricsWidthBoundsObserver() {
    if (typeof ResizeObserver === 'undefined') return;

    const nextObservedElement = getLyricsWidthBoundsElement();
    if (!(nextObservedElement instanceof Element)) return;
    if (lyricsWidthBoundsObservedElement === nextObservedElement && lyricsWidthBoundsResizeObserver) return;

    if (!lyricsWidthBoundsResizeObserver) {
        lyricsWidthBoundsResizeObserver = new ResizeObserver(() => {
            if (lyricsWidthBoundsResizeRaf) cancelAnimationFrame(lyricsWidthBoundsResizeRaf);
            lyricsWidthBoundsResizeRaf = requestAnimationFrame(() => {
                lyricsWidthBoundsResizeRaf = null;
                applyLyricsMaxWidth(currentLyricsMaxWidthVw);
                syncWidthControlButtonMetrics();
                scheduleViewportSyncAndRecenter();
            });
        });
    }

    if (lyricsWidthBoundsObservedElement) {
        lyricsWidthBoundsResizeObserver.unobserve(lyricsWidthBoundsObservedElement);
    }

    lyricsWidthBoundsObservedElement = nextObservedElement;
    lyricsWidthBoundsResizeObserver.observe(nextObservedElement);
}

function detectUiScale() {
    try {
        const screenWidth = (window.screen && window.screen.width) || window.innerWidth || 1920;
        const screenHeight = (window.screen && window.screen.height) || window.innerHeight || 1080;
        if (screenWidth >= 3840 || screenHeight >= 2160) return 2;
    } catch (_) {}
    return 1;
}

function getResponsiveLowResMaxFontSize() {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const mobileDownloadBoost = isDownloadPreviewPage() ? 4 : 0;
    const mobileCap = 64 + mobileDownloadBoost;

    if (viewportWidth > 768) {
        return MAX_FONT_SIZE;
    }

    return Math.max(
        MIN_FONT_SIZE,
        Math.min(
            mobileCap,
            Math.round(Math.min(viewportWidth * 0.08, viewportHeight * 0.1)) + mobileDownloadBoost
        )
    );
}

function getResponsiveLowResBaseFontSize() {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const mobileDownloadBoost = isDownloadPreviewPage() ? 4 : 0;
    const mobileCap = 48 + mobileDownloadBoost;
    const mobileBaseFloorOffset = 8;

    if (viewportWidth > 768) {
        return DEFAULT_FONT_SIZE;
    }

    return Math.max(
        MIN_FONT_SIZE,
        Math.min(
            mobileCap,
            Math.round(Math.min(viewportWidth * 0.09, viewportHeight * 0.12)) + mobileDownloadBoost - mobileBaseFloorOffset
        )
    );
}

function getEffectiveLyricFontSize() {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const useMobileSizing = viewportWidth <= 767 || isPhoneLayoutEnvironment();

    if (useMobileSizing) {
        const baseFontSize = getResponsiveLowResBaseFontSize();
        const maxFontSize = getResponsiveLowResMaxFontSize();
        return Math.max(MIN_FONT_SIZE, Math.min(maxFontSize, baseFontSize + lowResLyricFontSizeOffset));
    }

    return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, currentLyricFontSize));
}

function initLyricsViewportObserver() {
    if (lyricsViewportResizeObserver) return;
    if (typeof ResizeObserver === 'undefined') return;

    const synced = document.getElementById('synced-lyrics');
    const plain = document.getElementById('plain-lyrics');
    if (!synced && !plain) return;

    lyricsViewportResizeObserver = new ResizeObserver(() => {
        // Avoid recenter loops from animated lyric class changes; active-line updates already center.
        scheduleViewportSync();
    });

    if (synced) lyricsViewportResizeObserver.observe(synced);
    if (plain) lyricsViewportResizeObserver.observe(plain);
}

function applyLyricSizing({ recenter = true } = {}) {
    let effectiveFontSize = getEffectiveLyricFontSize();
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const useMobileSizing = viewportWidth <= 767 || isPhoneLayoutEnvironment();
    if (viewportWidth <= 767) {
        effectiveFontSize += 16;
    }
    const forcePriority = (viewportWidth <= 767) || (isDownloadPreviewPage() && useMobileSizing);
    const cssPriority = forcePriority ? 'important' : '';
    if (forcePriority) {
        effectiveFontSize += 4;
    }
    const lineHeight = Math.round(effectiveFontSize * 1.16);
    const outerGap = Math.max(8, Math.round(effectiveFontSize * 0.2));
    const romanizedSize = effectiveFontSize * 0.6;

    if (applyLyricSizingRaf) cancelAnimationFrame(applyLyricSizingRaf);
    applyLyricSizingRaf = requestAnimationFrame(() => {
        applyLyricSizingRaf = null;
        document.documentElement.style.setProperty('--lyric-font-size', `${effectiveFontSize}px`, cssPriority);
        document.documentElement.style.setProperty('--lyric-line-height', `${lineHeight}px`, cssPriority);
        document.documentElement.style.setProperty('--lyrics-line-outer-gap', `${outerGap}px`, cssPriority);
        document.documentElement.style.setProperty('--lyric-romanized-size', `${romanizedSize}px`, cssPriority);
        syncCenterViewportMaxHeight();

        if (recenter) {
            scheduleViewportSyncAndRecenter();
        } else {
            scheduleViewportSync();
        }
    });
}
function syncWidthControlButtonMetrics() {
    const widthControl = document.getElementById('lyrics-width-control');
    const positionButton = document.getElementById('lyrics-position-toggle');
    const modeButton = document.getElementById('lyrics-display-mode-toggle');
    const weightButton = document.getElementById('lyrics-font-weight-toggle');
    const backgroundButton = document.getElementById('lyrics-background-toggle');
    const dynamicThemeToggleButton = document.getElementById('lyrics-dynamic-theme-toggle');
    const themeColorCycleButton = document.getElementById('lyrics-theme-color-cycle');
    if (
        !widthControl
        || !positionButton
        || !modeButton
        || !weightButton
        || !backgroundButton
        || !dynamicThemeToggleButton
        || !themeColorCycleButton
    ) return;

    const positionWidth = Math.ceil(positionButton.offsetWidth);
    const modeWidth = Math.ceil(modeButton.offsetWidth);
    const weightWidth = Math.ceil(weightButton.offsetWidth);
    const backgroundWidth = Math.ceil(backgroundButton.offsetWidth);
    const dynamicThemeToggleVisible = !!(dynamicThemeToggleButton.offsetParent && !dynamicThemeToggleButton.hidden);
    const dynamicThemeToggleWidth = dynamicThemeToggleVisible ? Math.ceil(dynamicThemeToggleButton.offsetWidth) : 0;
    const themeColorCycleWidth = Math.ceil(themeColorCycleButton.offsetWidth);
    const gap = 8;
    const modeOffset = positionWidth + gap;
    const weightOffset = positionWidth + modeWidth + (gap * 2);
    const backgroundOffset = weightOffset + weightWidth + gap;
    const dynamicThemeToggleOffset = backgroundOffset + backgroundWidth + gap;
    const themeColorCycleOffset = dynamicThemeToggleVisible
        ? dynamicThemeToggleOffset + dynamicThemeToggleWidth + gap
        : backgroundOffset + backgroundWidth + gap;
    const totalWidth = dynamicThemeToggleVisible
        ? positionWidth + modeWidth + weightWidth + backgroundWidth + dynamicThemeToggleWidth + themeColorCycleWidth + (gap * 5)
        : positionWidth + modeWidth + weightWidth + backgroundWidth + themeColorCycleWidth + (gap * 4);
    widthControl.style.setProperty('--lyrics-control-buttons-width', `${totalWidth}px`);
    widthControl.style.setProperty('--lyrics-mode-toggle-left', `${modeOffset}px`);
    widthControl.style.setProperty('--lyrics-font-weight-toggle-left', `${weightOffset}px`);
    widthControl.style.setProperty('--lyrics-background-toggle-left', `${backgroundOffset}px`);
    widthControl.style.setProperty('--lyrics-dynamic-theme-toggle-left', `${dynamicThemeToggleOffset}px`);
    widthControl.style.setProperty('--lyrics-theme-color-cycle-left', `${themeColorCycleOffset}px`);
    widthControl.style.setProperty('--lyrics-position-toggle-right', `0px`);
    widthControl.style.setProperty('--lyrics-mode-toggle-right', `${positionWidth + gap}px`);
    widthControl.style.setProperty('--lyrics-font-weight-toggle-right', `${positionWidth + modeWidth + (gap * 2)}px`);
    widthControl.style.setProperty('--lyrics-background-toggle-right', `${positionWidth + modeWidth + weightWidth + (gap * 3)}px`);
    widthControl.style.setProperty('--lyrics-dynamic-theme-toggle-right', `${positionWidth + modeWidth + weightWidth + backgroundWidth + (gap * 4)}px`);
    widthControl.style.setProperty('--lyrics-theme-color-cycle-right', dynamicThemeToggleVisible
        ? `${positionWidth + modeWidth + weightWidth + backgroundWidth + dynamicThemeToggleWidth + (gap * 5)}px`
        : `${positionWidth + modeWidth + weightWidth + backgroundWidth + (gap * 4)}px`);
}

function handleSongInfoScroll(event) {
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY || event.detail || -event.wheelDelta;
    const activeLyricAnchor = captureActiveLyricAnchor();
    const frozenActiveLyricIndex = captureCurrentActiveLyricIndex();
    scheduleWheelResizeActiveLineFreeze(frozenActiveLyricIndex);

    const layoutContainer = document.getElementById('layout-container');
    if (layoutContainer) {
        layoutContainer.style.opacity = '1';
        layoutContainer.style.pointerEvents = 'auto';
    }

    if (delta > 0) {
        if ((window.innerWidth || document.documentElement.clientWidth || 1) <= 767) {
            const baseFontSize = getResponsiveLowResBaseFontSize();
            lowResLyricFontSizeOffset = Math.max(
                MIN_FONT_SIZE - baseFontSize,
                lowResLyricFontSizeOffset - FONT_SIZE_STEP
            );
        } else {
            currentLyricFontSize = Math.max(MIN_FONT_SIZE, currentLyricFontSize - FONT_SIZE_STEP);
        }
        applyLyricSizing({ recenter: false });
    } else {
        if ((window.innerWidth || document.documentElement.clientWidth || 1) <= 767) {
            const baseFontSize = getResponsiveLowResBaseFontSize();
            const effectiveMaxFontSize = getResponsiveLowResMaxFontSize();
            lowResLyricFontSizeOffset = Math.min(
                effectiveMaxFontSize - baseFontSize,
                lowResLyricFontSizeOffset + FONT_SIZE_STEP
            );
        } else {
            currentLyricFontSize = Math.min(MAX_FONT_SIZE, currentLyricFontSize + FONT_SIZE_STEP);
        }
        applyLyricSizing({ recenter: false });
    }
    scheduleWheelResizeAnchorRestore(activeLyricAnchor, frozenActiveLyricIndex);

    clearTimeout(window.fontSizeSaveTimeout);
    window.fontSizeSaveTimeout = setTimeout(saveSettings, 500);
}

// Settings
function saveSettings() {
    if (isDownloadPreviewPage()) return;
    const layoutContainer = document.getElementById('layout-container');
    const settings = {
        position: getCurrentLayoutPosition(layoutContainer),
        fontSize: currentLyricFontSize,
        lyricsContainerClickable: lyricsContainerClickable,
        lyricsMaxWidthVw: currentLyricsMaxWidthVw,
        lyricsDisplayMode: currentLyricsDisplayMode,
        lyricFontWeightPreset: currentLyricFontWeightPreset,
        lyricBackgroundPreset: currentLyricBackgroundPreset,
        dynamicThemeEnabled: getLyricDynamicThemeEnabled(),
        themeColorIndex: currentManualLyricThemeColorIndex,
    };
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
        console.warn('Failed to save settings:', error);
    }
}

function normalizeLyricFontWeightPreset(preset) {
    if (typeof preset !== 'string') return 'regular';
    const normalized = preset.trim().toLowerCase();
    return LYRIC_FONT_WEIGHT_ORDER.includes(normalized) ? normalized : 'regular';
}

function normalizeLyricBackgroundPreset(preset) {
    if (typeof preset !== 'string') return DEFAULT_LYRIC_BACKGROUND_PRESET;
    const normalized = preset.trim().toLowerCase();
    if (normalized === 'soft') return 'solid';
    return LYRIC_BACKGROUND_ORDER.includes(normalized) ? normalized : DEFAULT_LYRIC_BACKGROUND_PRESET;
}

function loadSettings() {
    if (isDownloadPreviewPage()) return null;
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (error) {
        console.warn('Failed to load settings:', error);
    }
    return null;
}

function normalizeLyricDisplayMode(mode) {
    if (typeof mode !== 'string') return DEFAULT_LYRIC_DISPLAY_MODE;
    const normalized = mode.trim().toLowerCase();
    return LYRIC_DISPLAY_MODE_ORDER.includes(normalized) ? normalized : DEFAULT_LYRIC_DISPLAY_MODE;
}

function setLyricButtonLabel(button, text) {
    if (!button) return;
    const labelEl = button.querySelector('.lyrics-btn-label');
    if (!labelEl) return;
    labelEl.textContent = text;
}

function setLyricButtonIcon(button, svgMarkup) {
    if (!button || !svgMarkup) return;
    const iconEl = button.querySelector('svg');
    if (iconEl) {
        iconEl.outerHTML = svgMarkup;
    } else {
        button.insertAdjacentHTML('afterbegin', svgMarkup);
    }
}

function getPositionIconSvg(position) {
    if (position === 'center') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8L2 12L6 16"/><path d="M18 8L22 12L18 16"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`;
    }
    if (position === 'right') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8L2 12L6 16"/><line x1="22" y1="12" x2="2" y2="12"/></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8L22 12L18 16"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`;
}

function getModeIconSvg(mode) {
    if (mode === 'scroll') {
        return `<svg class="mode-scroll-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="22" viewBox="0 0 24 30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="5" opacity="0.32"/><line x1="5" y1="10" x2="19" y2="10" opacity="0.62"/><line x1="5" y1="15" x2="19" y2="15"/><line x1="5" y1="20" x2="19" y2="20" opacity="0.62"/><line x1="5" y1="25" x2="19" y2="25" opacity="0.32"/></svg>`;
    }
    if (mode === 'fixed-1') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="20" y2="12"/></svg>`;
    }
    if (mode === 'fixed-2') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`;
}

function getFontWeightIconSvg(preset) {
    const weight = preset === 'thin' ? 400 : preset === 'bold' ? 800 : 600;
    const minorOpacity = preset === 'thin' ? 0.45 : preset === 'bold' ? 0.7 : 0.55;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><text x="1" y="17" font-size="13" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="400" fill="currentColor" opacity="${minorOpacity}">A</text><text x="10" y="18" font-size="16" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="${weight}" fill="currentColor">A</text></svg>`;
}

function getBackgroundIconSvg(preset) {
    if (preset === 'none') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><text x="12" y="15.5" text-anchor="middle" font-size="12.5" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="700" fill="currentColor" stroke="none">A</text></svg>`;
    }
    if (preset === 'dynamic') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="4.6" width="15.6" height="14.8" rx="3.2" fill="currentColor" opacity="0.3"/><circle cx="16.8" cy="7.2" r="1.25" fill="currentColor" opacity="0.9"/><text x="12" y="15.8" text-anchor="middle" font-size="12" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="700" fill="currentColor">A</text></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4.2" y="4.6" width="15.6" height="14.8" rx="3.2" fill="#101010" opacity="0.92" stroke="none"/><text x="12" y="15.8" text-anchor="middle" font-size="12" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="700" fill="#ffffff" stroke="none">A</text></svg>`;
}

function getDynamicThemeIconSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><text x="12" y="14.8" font-size="11.8" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="700" text-anchor="middle" fill="currentColor">A</text><rect x="6.2" y="17.1" width="11.6" height="2.3" rx="1.15" fill="currentColor"/></svg>`;
}

function getThemeColorIconSvg(isDynamic) {
    if (isDynamic) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="none" aria-hidden="true"><defs><linearGradient id="lyrics-color-dynamic-grad" x1="12" y1="4" x2="12" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ff3b30"/><stop offset="22%" stop-color="#ff9500"/><stop offset="42%" stop-color="#ffd60a"/><stop offset="60%" stop-color="#34c759"/><stop offset="78%" stop-color="#0a84ff"/><stop offset="100%" stop-color="#bf5af2"/></linearGradient></defs><circle cx="12" cy="12" r="6.8" fill="url(#lyrics-color-dynamic-grad)"/><circle cx="12" cy="12" r="7.8" fill="none" stroke="rgba(255,255,255,0.72)" stroke-width="1.2"/></svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="none" aria-hidden="true"><circle cx="12" cy="12" r="6.8" fill="currentColor"/><circle cx="12" cy="12" r="7.8" fill="none" stroke="rgba(255,255,255,0.72)" stroke-width="1.2"/></svg>`;
}

function resetLyricControlHoverLabels() {
    lyricControlLabelTouched.mode = false;
    lyricControlLabelTouched.font = false;
    lyricControlLabelTouched.background = false;
    lyricControlLabelTouched.position = false;
    lyricControlLabelTouched.dynamic = false;
    lyricControlLabelTouched.color = false;
    updateAllLyricControlLabels();
}

function initializeLyricControlLabelHoverReset() {
    const widthControl = document.getElementById('lyrics-width-control');
    if (!widthControl || window._lyricsControlLabelHoverResetInitialized) return;
    const reset = () => resetLyricControlHoverLabels();
    widthControl.addEventListener('pointerleave', reset);
    widthControl.addEventListener('pointerenter', reset);
    window._lyricsControlLabelHoverResetInitialized = true;
}

function updateLyricsDisplayModeToggleLabel() {
    const btn = document.getElementById('lyrics-display-mode-toggle');
    if (!btn) return;
    const mode = normalizeLyricDisplayMode(currentLyricsDisplayMode);
    const label = LYRIC_DISPLAY_MODE_LABELS[mode] || LYRIC_DISPLAY_MODE_LABELS[DEFAULT_LYRIC_DISPLAY_MODE];
    setLyricButtonLabel(btn, lyricControlLabelTouched.mode ? label : 'Mode');
    setLyricButtonIcon(btn, getModeIconSvg(mode));
    btn.setAttribute('aria-label', `Switch lyric display mode (current: ${label})`);
    btn.setAttribute('title', `Mode: ${label}`);
    syncWidthControlButtonMetrics();
}

function updateLyricsFontWeightToggleLabel() {
    const btn = document.getElementById('lyrics-font-weight-toggle');
    if (!btn) return;
    const preset = LYRIC_FONT_WEIGHT_PRESETS[normalizeLyricFontWeightPreset(currentLyricFontWeightPreset)] || LYRIC_FONT_WEIGHT_PRESETS.regular;
    const presetKey = normalizeLyricFontWeightPreset(currentLyricFontWeightPreset);
    setLyricButtonLabel(btn, lyricControlLabelTouched.font ? preset.label : 'Font Weight');
    setLyricButtonIcon(btn, getFontWeightIconSvg(presetKey));
    btn.setAttribute('aria-label', `Switch lyric font weight (current: ${preset.label})`);
    btn.setAttribute('title', `Font: ${preset.label}`);
    syncWidthControlButtonMetrics();
}

function updateLyricsBackgroundToggleLabel() {
    const btn = document.getElementById('lyrics-background-toggle');
    if (!btn) return;
    const presetKey = normalizeLyricBackgroundPreset(currentLyricBackgroundPreset);
    const preset = LYRIC_BACKGROUND_PRESETS[presetKey] || LYRIC_BACKGROUND_PRESETS[DEFAULT_LYRIC_BACKGROUND_PRESET];
    const shortLabel = preset.label.replace(' Background', '');
    setLyricButtonLabel(btn, lyricControlLabelTouched.background ? shortLabel : 'Font BG');
    setLyricButtonIcon(btn, getBackgroundIconSvg(presetKey));
    if (presetKey === 'dynamic') {
        const swatchHex = getCurrentAppliedThemePrimaryHex();
        btn.style.setProperty('--lyrics-bg-icon-color', swatchHex);
    } else {
        btn.style.removeProperty('--lyrics-bg-icon-color');
    }
    btn.setAttribute('aria-label', `Switch lyric background (current: ${preset.label})`);
    btn.setAttribute('title', `Background: ${preset.label}`);
    syncWidthControlButtonMetrics();
}

function updateLyricsDynamicThemeToggleLabel() {
    const btn = document.getElementById('lyrics-dynamic-theme-toggle');
    if (!btn) return;
    btn.hidden = true;
    btn.style.display = 'none';
    btn.setAttribute('aria-hidden', 'true');
    setLyricButtonIcon(btn, getDynamicThemeIconSvg());

    const enabled = getLyricDynamicThemeEnabled();
    if (enabled) {
        setLyricButtonLabel(btn, lyricControlLabelTouched.dynamic ? 'On' : 'Dynamic Theme');
        btn.setAttribute('aria-label', 'Turn dynamic lyric theme off');
        btn.setAttribute('title', 'Dynamic theme follows album art colors');
    } else {
        const preset = MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex] || MANUAL_LYRIC_THEME_COLORS[0];
        const name = preset?.name || 'Color';
        setLyricButtonLabel(btn, lyricControlLabelTouched.dynamic ? 'Off' : 'Dynamic Theme');
        btn.setAttribute('aria-label', 'Turn dynamic lyric theme on');
        btn.setAttribute('title', `Dynamic theme is off (using fixed theme color: ${name})`);
    }

    refreshDynamicLyricBackgroundIfNeeded();
    refreshDynamicThemeIconColor();
    syncWidthControlButtonMetrics();
}

function updateLyricsThemeColorCycleLabel() {
    const btn = document.getElementById('lyrics-theme-color-cycle');
    if (!btn) return;
    const dynamicEnabled = getLyricDynamicThemeEnabled();
    btn.hidden = false;
    btn.style.display = '';
    btn.setAttribute('aria-hidden', 'false');
    const preset = MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex] || MANUAL_LYRIC_THEME_COLORS[0];
    const fixedName = preset?.name || 'Color';
    const fixedHex = preset?.hex || '';
    const currentName = dynamicEnabled ? 'Dynamic Theme' : fixedName;
    const currentHex = normalizeHexColor(fixedHex) || '#e5e5e5';
    setLyricButtonLabel(btn, lyricControlLabelTouched.color ? currentName : 'Color');
    setLyricButtonIcon(btn, getThemeColorIconSvg(dynamicEnabled));
    btn.style.setProperty('--lyrics-theme-cycle-color', currentHex);
    if (dynamicEnabled) {
        const activeDynamicHex = getCurrentAppliedThemePrimaryHex();
        btn.style.borderColor = activeDynamicHex;
        btn.style.borderWidth = '2.4px';
    } else {
        btn.style.removeProperty('border-color');
        btn.style.removeProperty('border-width');
    }
    btn.setAttribute('aria-label', `Cycle lyric theme color (current: ${currentName})`);
    btn.setAttribute('title', dynamicEnabled
        ? 'Theme: Dynamic Theme'
        : `Theme: ${fixedName} (${fixedHex})`);
    refreshDynamicLyricBackgroundIfNeeded();
    refreshDynamicThemeIconColor();
    syncWidthControlButtonMetrics();
}

function updateLyricsThemeColorPickerLabel() {
    // Custom picker was removed as part of the merged Theme control.
}

function toggleLyricDynamicThemeButton() {
    lyricControlLabelTouched.dynamic = true;
    const enabled = getLyricDynamicThemeEnabled();
    const nextEnabled = !enabled;

    setLyricDynamicThemeEnabled(nextEnabled, { refresh: true });
    if (!nextEnabled) {
        applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
    }

    updateLyricsDynamicThemeToggleLabel();
    updateLyricsThemeColorCycleLabel();
    saveSettings();
}

function cycleLyricThemeColorButton() {
    cycleLyricThemeButton();
}

function cycleLyricThemeButton() {
    lyricControlLabelTouched.color = true;
    const dynamicEnabled = getLyricDynamicThemeEnabled();

    if (dynamicEnabled) {
        // Dynamic -> fixed palette (start from White)
        currentManualLyricThemeColorIndex = 0;
        setLyricDynamicThemeEnabled(false, { refresh: false });
        applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
    } else {
        const lastIndex = MANUAL_LYRIC_THEME_COLORS.length - 1;
        if (currentManualLyricThemeColorIndex >= lastIndex) {
            // Fixed -> dynamic
            setLyricDynamicThemeEnabled(true, { refresh: true });
        } else {
            // Fixed -> next fixed palette
            currentManualLyricThemeColorIndex = (currentManualLyricThemeColorIndex + 1) % MANUAL_LYRIC_THEME_COLORS.length;
            applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
        }
    }

    updateLyricsDynamicThemeToggleLabel();
    updateLyricsThemeColorCycleLabel();
    saveSettings();
}

function updateAllLyricControlLabels() {
    updateLyricsPositionToggleLabel();
    updateLyricsDisplayModeToggleLabel();
    updateLyricsFontWeightToggleLabel();
    updateLyricsBackgroundToggleLabel();
    updateLyricsDynamicThemeToggleLabel();
    updateLyricsThemeColorCycleLabel();
}

function handleLyricWheelDelta(delta) {
    // Reuse existing logic that expects an Event-like object.
    handleSongInfoScroll({
        preventDefault: () => {},
        stopPropagation: () => {},
        deltaY: delta
    });
}

function getNextLyricDisplayMode(mode) {
    const normalized = normalizeLyricDisplayMode(mode);
    const idx = LYRIC_DISPLAY_MODE_ORDER.indexOf(normalized);
    if (idx < 0) return DEFAULT_LYRIC_DISPLAY_MODE;
    return LYRIC_DISPLAY_MODE_ORDER[(idx + 1) % LYRIC_DISPLAY_MODE_ORDER.length];
}

function applyLyricsDisplayMode(mode, { persist = true, refresh = true } = {}) {
    const normalized = normalizeLyricDisplayMode(mode);
    currentLyricsDisplayMode = normalized;
    const visibleLines = LYRIC_DISPLAY_MODE_VISIBLE_LINES[normalized] || LYRIC_DISPLAY_MODE_VISIBLE_LINES[DEFAULT_LYRIC_DISPLAY_MODE];
    document.documentElement.style.setProperty('--lyrics-visible-lines', String(visibleLines));
    setLyricDisplayMode(normalized, { refresh });
    updateLyricsDisplayModeToggleLabel();
    scheduleViewportSyncAndRecenter();
    if (persist) saveSettings();
}

function cycleLyricsDisplayMode() {
    lyricControlLabelTouched.mode = true;
    const nextMode = getNextLyricDisplayMode(currentLyricsDisplayMode || getLyricDisplayMode());
    applyLyricsDisplayMode(nextMode, { persist: true, refresh: true });
}

function applyLyricFontWeightPreset(preset, { persist = true } = {}) {
    const normalized = normalizeLyricFontWeightPreset(preset);
    const config = LYRIC_FONT_WEIGHT_PRESETS[normalized] || LYRIC_FONT_WEIGHT_PRESETS.regular;
    currentLyricFontWeightPreset = normalized;
    document.documentElement.style.setProperty('--lyrics-inactive-font-weight', String(config.inactive));
    document.documentElement.style.setProperty('--lyrics-active-font-weight', String(config.active));
    updateLyricsFontWeightToggleLabel();
    if (persist) saveSettings();
}

function applyLyricBackgroundPreset(preset, { persist = true } = {}) {
    const normalized = normalizeLyricBackgroundPreset(preset);
    const config = LYRIC_BACKGROUND_PRESETS[normalized] || LYRIC_BACKGROUND_PRESETS[DEFAULT_LYRIC_BACKGROUND_PRESET];
    currentLyricBackgroundPreset = normalized;
    if (normalized === 'dynamic') {
        applyDynamicLyricBackground();
    } else {
        document.documentElement.style.setProperty('--text-bg', config.value, 'important');
    }
    updateLyricsBackgroundToggleLabel();
    if (persist) saveSettings();
}

function cycleLyricFontWeightPreset() {
    lyricControlLabelTouched.font = true;
    const normalized = normalizeLyricFontWeightPreset(currentLyricFontWeightPreset);
    const idx = LYRIC_FONT_WEIGHT_ORDER.indexOf(normalized);
    applyLyricFontWeightPreset(LYRIC_FONT_WEIGHT_ORDER[(idx + 1) % LYRIC_FONT_WEIGHT_ORDER.length], { persist: true });
}

function cycleLyricBackgroundPreset() {
    lyricControlLabelTouched.background = true;
    const normalized = normalizeLyricBackgroundPreset(currentLyricBackgroundPreset);
    const idx = LYRIC_BACKGROUND_ORDER.indexOf(normalized);
    applyLyricBackgroundPreset(LYRIC_BACKGROUND_ORDER[(idx + 1) % LYRIC_BACKGROUND_ORDER.length], { persist: true });
}

function getCurrentLayoutPosition(layoutContainer = document.getElementById('layout-container')) {
    if (!layoutContainer) return 'left';
    if (layoutContainer.classList.contains('position-center')) return 'center';
    if (layoutContainer.classList.contains('position-right')) return 'right';
    return 'left';
}

function applyLayoutPosition(position) {
    const layoutContainer = document.getElementById('layout-container');
    if (!layoutContainer) return;
    const normalized = LAYOUT_POSITION_ORDER.includes(position) ? position : 'left';
    layoutContainer.classList.toggle('position-right', normalized === 'right');
    layoutContainer.classList.toggle('position-center', normalized === 'center');
    syncWidthControlPositionClass();
    updateLyricsPositionToggleLabel();
}

function getNextLayoutPosition(position) {
    const normalized = LAYOUT_POSITION_ORDER.includes(position) ? position : 'left';
    const idx = LAYOUT_POSITION_ORDER.indexOf(normalized);
    return LAYOUT_POSITION_ORDER[(idx + 1) % LAYOUT_POSITION_ORDER.length];
}

function updateLyricsPositionToggleLabel() {
    const btn = document.getElementById('lyrics-position-toggle');
    const layoutContainer = document.getElementById('layout-container');
    if (!btn || !layoutContainer) return;
    const position = getCurrentLayoutPosition(layoutContainer);
    const label = LAYOUT_POSITION_LABELS[position] || LAYOUT_POSITION_LABELS.left;
    setLyricButtonLabel(btn, lyricControlLabelTouched.position ? label : 'Position');
    setLyricButtonIcon(btn, getPositionIconSvg(position));
    btn.setAttribute('aria-label', `Switch lyrics position (current: ${label})`);
    btn.setAttribute('title', `Position: ${label}`);
    syncWidthControlButtonMetrics();
}

function syncWidthControlPositionClass() {
    const layoutContainer = document.getElementById('layout-container');
    const widthControl = document.getElementById('lyrics-width-control');
    const closeControl = document.getElementById('close-window-control')
        || document.getElementById('close-dummy-control');
    if (!layoutContainer || !widthControl) return;
    const position = getCurrentLayoutPosition(layoutContainer);
    widthControl.classList.toggle('position-right', position === 'right');
    widthControl.classList.toggle('position-center', position === 'center');
    if (closeControl) {
        // Keep close button fixed at center.
        closeControl.classList.remove('position-right', 'position-center');
    }
}

function setWidthControlVisible(visible) {
    const widthControl = document.getElementById('lyrics-width-control');
    if (!widthControl) return;
    widthControl.classList.toggle('show', !!visible);
}

function setCloseWindowButtonVisible(visible) {
    const closeControl = document.getElementById('close-window-control')
        || document.getElementById('close-dummy-control');
    if (!closeControl) return;
    closeControl.classList.toggle('show', !!visible);
    closeControl.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function scheduleWidthControlAutoHide(delayMs = 1000) {
    if (widthControlAutoHideTimeout) {
        clearTimeout(widthControlAutoHideTimeout);
        widthControlAutoHideTimeout = null;
    }
    widthControlAutoHideTimeout = setTimeout(() => {
        widthControlAutoHideTimeout = null;
        if (!isWidthShortcutHeld && !isWidthControlHovered && !isLyricsWindowHovered && !lyricsWidthDragActive) {
            setWidthControlVisible(false);
        }
    }, delayMs);
}

function initializeLyricsWindowHoverControls() {
    if (window._lyricsWindowHoverControlsInitialized) return;

    const showControls = () => {
        isLyricsWindowHovered = true;
        if (widthControlAutoHideTimeout) {
            clearTimeout(widthControlAutoHideTimeout);
            widthControlAutoHideTimeout = null;
        }
        setWidthControlVisible(true);
    };

    const hideControls = () => {
        isLyricsWindowHovered = false;
        if (!isWidthControlHovered && !lyricsWidthDragActive && !isWidthShortcutHeld) {
            scheduleWidthControlAutoHide(120);
        }
    };

    document.addEventListener('pointermove', showControls, true);
    document.addEventListener('pointerenter', showControls, true);
    document.addEventListener('mouseleave', hideControls, true);
    window.addEventListener('blur', hideControls);

    window._lyricsWindowHoverControlsInitialized = true;
}

function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.closest('[contenteditable="true"]')) return true;
    return !!target.closest('input, textarea, select');
}

function initializeWidthControlShortcut() {
    if (window._lyricsWidthShortcutInitialized) return;
    const pressedCodes = new Set();

    const isShortcutComboHeld = () => {
        const hasF = pressedCodes.has('KeyF');
        const hasAlt = pressedCodes.has('AltLeft') || pressedCodes.has('AltRight');
        const hasShift = pressedCodes.has('ShiftLeft') || pressedCodes.has('ShiftRight');
        const hasCtrl = pressedCodes.has('ControlLeft') || pressedCodes.has('ControlRight');
        const hasMeta = pressedCodes.has('MetaLeft') || pressedCodes.has('MetaRight');
        return hasF && hasAlt && hasShift && !hasCtrl && !hasMeta;
    };

    const clearShortcutUi = () => {
        pressedCodes.clear();
        isWidthShortcutHeld = false;
        setWidthControlVisible(false);
        setCloseWindowButtonVisible(false);
    };

    document.addEventListener('keydown', (event) => {
        pressedCodes.add(event.code);
        if (isEditableTarget(event.target)) return;
        if (!isShortcutComboHeld()) {
            if (isWidthShortcutHeld) clearShortcutUi();
            return;
        }

        event.preventDefault();
        isWidthShortcutHeld = true;
        if (widthControlAutoHideTimeout) {
            clearTimeout(widthControlAutoHideTimeout);
            widthControlAutoHideTimeout = null;
        }
        setWidthControlVisible(true);
        setCloseWindowButtonVisible(true);
    }, true);

    document.addEventListener('keyup', (event) => {
        pressedCodes.delete(event.code);
        if (!isWidthShortcutHeld) return;
        if (isShortcutComboHeld()) return;
        event.preventDefault();
        clearShortcutUi();
    }, true);
    window.addEventListener('blur', clearShortcutUi);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearShortcutUi();
    });

    window._lyricsWidthShortcutInitialized = true;
}

function initializeLyricsDisplayModeToggle() {
    const modeToggle = document.getElementById('lyrics-display-mode-toggle');
    if (!modeToggle || window._lyricsDisplayModeToggleInitialized) return;

    modeToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        cycleLyricsDisplayMode();
        scheduleWidthControlAutoHide();
    });

    window._lyricsDisplayModeToggleInitialized = true;
}

function initializeLyricsPositionToggle() {
    const positionToggle = document.getElementById('lyrics-position-toggle');
    if (!positionToggle || window._lyricsPositionToggleInitialized) return;

    positionToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleLayoutPosition();
        saveSettings();
        scheduleWidthControlAutoHide();
    });

    updateLyricsPositionToggleLabel();
    window._lyricsPositionToggleInitialized = true;
}

function initializeLyricsFontWeightToggle() {
    const weightToggle = document.getElementById('lyrics-font-weight-toggle');
    if (!weightToggle || window._lyricsFontWeightToggleInitialized) return;

    weightToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        cycleLyricFontWeightPreset();
        scheduleWidthControlAutoHide();
    });

    updateLyricsFontWeightToggleLabel();
    window._lyricsFontWeightToggleInitialized = true;
}

function initializeLyricsBackgroundToggle() {
    const backgroundToggle = document.getElementById('lyrics-background-toggle');
    if (!backgroundToggle || window._lyricsBackgroundToggleInitialized) return;

    backgroundToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        cycleLyricBackgroundPreset();
        scheduleWidthControlAutoHide();
    });

    updateLyricsBackgroundToggleLabel();
    window._lyricsBackgroundToggleInitialized = true;
}

function initializeLyricsDynamicThemeToggle() {
    const dynamicToggle = document.getElementById('lyrics-dynamic-theme-toggle');
    if (!dynamicToggle || window._lyricsDynamicThemeToggleInitialized) return;

    dynamicToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        lyricControlLabelTouched.dynamic = true;

        const enabled = getLyricDynamicThemeEnabled();
        const nextEnabled = !enabled;

        setLyricDynamicThemeEnabled(nextEnabled, { refresh: true });
        if (!nextEnabled) {
            applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
        }

        saveSettings();
        scheduleWidthControlAutoHide();
        updateLyricsDynamicThemeToggleLabel();
        updateLyricsThemeColorCycleLabel();
    });

    updateLyricsDynamicThemeToggleLabel();
    window._lyricsDynamicThemeToggleInitialized = true;
}

function initializeLyricsThemeColorCycle() {
    const colorCycleBtn = document.getElementById('lyrics-theme-color-cycle');
    if (!colorCycleBtn || window._lyricsThemeColorCycleInitialized) return;

    colorCycleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        lyricControlLabelTouched.color = true;

        currentManualLyricThemeColorIndex = (currentManualLyricThemeColorIndex + 1) % MANUAL_LYRIC_THEME_COLORS.length;

        // Turn dynamic theme off so the chosen palette doesn't get overwritten by cover sampling.
        setLyricDynamicThemeEnabled(false, { refresh: false });
        applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);

        saveSettings();
        scheduleWidthControlAutoHide();
        updateLyricsDynamicThemeToggleLabel();
        updateLyricsThemeColorCycleLabel();
    });

    updateLyricsThemeColorCycleLabel();
    window._lyricsThemeColorCycleInitialized = true;
}

function applySavedSettings() {
    const isPhoneLayout = isPhoneLayoutEnvironment();
    const defaultLayoutPosition = isPhoneLayout ? 'center' : 'left';
    const defaultDisplayMode = isPhoneLayout ? 'scroll' : DEFAULT_LYRICS_PAGE_DISPLAY_MODE;
    const defaultLyricsWidthPercent = DEFAULT_LYRICS_PAGE_WIDTH_PERCENT;
    const settings = loadSettings();
    if (settings) {
        if (settings.dynamicThemeEnabled !== undefined) {
            // The dynamic theme module treats `!== false` as enabled.
            window.__dynamicThemeEnabled = settings.dynamicThemeEnabled !== false;
        }
        if (Number.isFinite(settings.themeColorIndex)) {
            const idx = Math.floor(settings.themeColorIndex);
            currentManualLyricThemeColorIndex = Math.max(0, Math.min(MANUAL_LYRIC_THEME_COLORS.length - 1, idx));
        }

        if (window.__dynamicThemeEnabled === false) {
            applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
        }

        const layoutContainer = document.getElementById('layout-container');
        if (layoutContainer) {
            applyLayoutPosition(settings.position || defaultLayoutPosition);
        }

        if (settings.fontSize && settings.fontSize >= MIN_FONT_SIZE && settings.fontSize <= MAX_FONT_SIZE) {
            currentLyricFontSize = settings.fontSize;
            window._userSetFontSize = true;
        } else {
            currentLyricFontSize = DEFAULT_FONT_SIZE;
            lowResLyricFontSizeOffset = 0;
            window._userSetFontSize = false;
        }

        if (settings.lyricsContainerClickable !== undefined) {
            lyricsContainerClickable = settings.lyricsContainerClickable;
        } else {
            lyricsContainerClickable = false;
        }

        if (settings.lyricsMaxWidthVw !== undefined) {
            applyLyricsMaxWidth(settings.lyricsMaxWidthVw);
        } else {
            applyLyricsMaxWidth(defaultLyricsWidthPercent);
        }

        applyLyricsDisplayMode(settings.lyricsDisplayMode || defaultDisplayMode, {
            persist: false,
            refresh: false
        });
        applyLyricFontWeightPreset(settings.lyricFontWeightPreset || DEFAULT_LYRICS_PAGE_FONT_WEIGHT_PRESET, { persist: false });
        applyLyricBackgroundPreset(settings.lyricBackgroundPreset || DEFAULT_LYRIC_BACKGROUND_PRESET, { persist: false });

        syncWidthControlPositionClass();
        updateLyricsPositionToggleLabel();
        applyLyricsContainerClickability();
        console.log('Settings loaded:', settings);
    } else {
        console.log('No saved settings found, using defaults');
        currentManualLyricThemeColorIndex = 0;
        applyLayoutPosition(defaultLayoutPosition);
        window._userSetFontSize = false;
        applyLyricsContainerClickability();
        applyLyricsMaxWidth(defaultLyricsWidthPercent);
        applyLyricsDisplayMode(defaultDisplayMode, {
            persist: false,
            refresh: false
        });
        applyLyricFontWeightPreset(DEFAULT_LYRICS_PAGE_FONT_WEIGHT_PRESET, { persist: false });
        applyLyricBackgroundPreset(DEFAULT_LYRIC_BACKGROUND_PRESET, { persist: false });
    }

    applyLyricSizing();
}

function scheduleInitialSizingStabilization() {
    if (window._lyricsInitialSizingStabilized) return;
    window._lyricsInitialSizingStabilized = true;

    const rerunSizing = () => {
        if (window._userSetFontSize) return;
        applyBaseSizing();
        scheduleViewportSyncAndRecenter();
    };

    requestAnimationFrame(() => {
        requestAnimationFrame(rerunSizing);
    });

    setTimeout(rerunSizing, 180);
}

function toggleLayoutPosition() {
    lyricControlLabelTouched.position = true;
    const layoutContainer = document.getElementById('layout-container');
    if (!layoutContainer) return;
    applyLayoutPosition(getNextLayoutPosition(getCurrentLayoutPosition(layoutContainer)));
    saveSettings();
}

function toggleLyricsContainerClickability() {
    lyricsContainerClickable = !lyricsContainerClickable;
    applyLyricsContainerClickability();
    saveSettings();
    console.log('Lyrics container clickability:', lyricsContainerClickable ? 'ENABLED (always clickable)' : 'DISABLED (click-through enabled)');
}

function applyLyricsContainerClickability() {
    if (!window.electronAPI) return;

    const lyricsContainer = document.getElementById('lyrics-container');
    window.electronAPI.enableClickThrough();
    if (lyricsContainer) {
        // Do not force inline visibility/pointer styles; CSS state classes control transitions.
        lyricsContainer.style.removeProperty('pointer-events');
        lyricsContainer.style.removeProperty('opacity');
        lyricsContainer.style.removeProperty('visibility');
    }
}

// Initialize UI interactions
function initializePositionToggle() {
    const cover = document.getElementById('song-info-cover');
    if (!window._layoutToggleListenerAdded) {
        let _pointerDownInfo = null;
        const _MAX_TAP_DURATION = 250;
        const _MAX_TAP_MOVEMENT = 10;
        const _toggleTarget = document.getElementById('song-info-content') || document.body;

        _toggleTarget.addEventListener('pointerdown', (ev) => {
            if (ev.button && ev.button !== 0) return;
            _pointerDownInfo = {
                time: Date.now(),
                x: ev.clientX,
                y: ev.clientY,
                moved: false
            };
        }, true);

        _toggleTarget.addEventListener('pointermove', (ev) => {
            if (!_pointerDownInfo) return;
            const dx = ev.clientX - _pointerDownInfo.x;
            const dy = ev.clientY - _pointerDownInfo.y;
            if (Math.hypot(dx, dy) > _MAX_TAP_MOVEMENT) _pointerDownInfo.moved = true;
        }, true);

        _toggleTarget.addEventListener('pointerup', (ev) => {
            try {
                if (!_pointerDownInfo) return;
                const duration = Date.now() - _pointerDownInfo.time;
                const selection = (window.getSelection && window.getSelection().toString && window.getSelection().toString()) || '';
                if (selection.trim().length > 0) {
                    _pointerDownInfo = null;
                    return;
                }
                if (!_pointerDownInfo.moved && duration <= _MAX_TAP_DURATION) {
                    if (ev.target && ev.target.closest && ev.target.closest('a, button, input, textarea, select')) {
                        _pointerDownInfo = null;
                        return;
                    }
                    toggleLayoutPosition();
                }
            } catch (err) {
                console.warn('tap-detect error', err);
            } finally {
                _pointerDownInfo = null;
            }
        }, true);

        _toggleTarget.addEventListener('pointercancel', () => {
            _pointerDownInfo = null;
        }, true);

        window._layoutToggleListenerAdded = true;
    }

    if (cover) {
        cover.onclick = null;
    }
}

function initializeFontSizeControl() {
    if (!window._lyricsFontSizeListenerAdded) {
        document.addEventListener('wheel', handleSongInfoScroll, {
            passive: false,
            capture: true
        });
        window._lyricsFontSizeListenerAdded = true;
    }
}

function initializeLyricsClickabilityToggle() {
    const contentEl = document.getElementById('song-info-content');
    if (contentEl) {
        contentEl.onclick = (e) => {
            e.stopPropagation();
            toggleLyricsContainerClickability();
        };
    }
}

function initializeLyricsWidthHandle() {
    const handles = [
        document.getElementById('lyrics-width-handle'),
        document.getElementById('lyrics-width-handle-secondary')
    ].filter(Boolean);
    if (handles.length === 0) return;
    if (window._lyricsWidthHandleInitialized) return;

    const beginDrag = (event, handle) => {
        const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        if (viewportWidth <= 767) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        lyricsWidthDragActive = true;
        lyricsWidthDragHandleSide = handle?.id === 'lyrics-width-handle-secondary' ? 'right' : 'left';
        // Cancel any pending hide while dragging
        if (widthControlAutoHideTimeout) {
            clearTimeout(widthControlAutoHideTimeout);
            widthControlAutoHideTimeout = null;
        }
        setWidthControlVisible(true);
        const layoutContainer = document.getElementById('layout-container');
        if (layoutContainer) {
            layoutContainer.style.opacity = '1';
            layoutContainer.style.pointerEvents = 'auto';
        }
    };

    const endDrag = () => {
        if (!lyricsWidthDragActive) return;
        lyricsWidthDragActive = false;
        lyricsWidthDragHandleSide = null;
        scheduleViewportSyncAndRecenter();
        saveSettings();
        // Start the 1s hide countdown now that drag is done
        scheduleWidthControlAutoHide();
    };

    const updateDrag = (event) => {
        if (!lyricsWidthDragActive) return;
        const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        const layoutContainer = document.getElementById('layout-container');
        const position = getCurrentLayoutPosition(layoutContainer);
        const pointerX = Number(event.clientX);
        if (!Number.isFinite(pointerX)) return;

        const minWidthPx = (() => {
            const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lyrics-min-width-px'));
            return Number.isFinite(raw) && raw > 0 ? raw : 128;
        })();
        const widthPx = position === 'right'
            ? (viewportWidth - pointerX)
            : position === 'center'
                ? (() => {
                    const halfMin = minWidthPx / 2;
                    const centerX = viewportWidth / 2;
                    if (lyricsWidthDragHandleSide === 'right') {
                        const clampedPointerX = Math.max(centerX + halfMin, pointerX);
                        return Math.max(minWidthPx, (clampedPointerX - centerX) * 2);
                    }
                    const clampedPointerX = Math.min(centerX - halfMin, pointerX);
                    return Math.max(minWidthPx, (centerX - clampedPointerX) * 2);
                })()
                : pointerX;
        const widthVw = (widthPx / viewportWidth) * 100;
        applyLyricsMaxWidth(widthVw);
        // Keep wrapped-line layout stable during drag; full recenter runs on drag end.
        scheduleViewportSync();
    };

    handles.forEach((handle) => {
        handle.addEventListener('pointerdown', (event) => {
            beginDrag(event, handle);
            try { handle.setPointerCapture(event.pointerId); } catch (_) {}
        });
    });

    window.addEventListener('pointermove', updateDrag, { passive: true });
    window.addEventListener('pointerup', endDrag, { passive: true });
    window.addEventListener('pointercancel', endDrag, { passive: true });
    window.addEventListener('blur', endDrag);

    // Keep control visible while the pointer is anywhere inside it
    const widthControl = document.getElementById('lyrics-width-control');
    if (widthControl) {
        widthControl.addEventListener('pointerenter', () => {
            isWidthControlHovered = true;
            if (widthControlAutoHideTimeout) {
                clearTimeout(widthControlAutoHideTimeout);
                widthControlAutoHideTimeout = null;
            }
        });
        widthControl.addEventListener('pointerleave', () => {
            isWidthControlHovered = false;
            if (!lyricsWidthDragActive) {
                scheduleWidthControlAutoHide();
            }
        });
    }

    window._lyricsWidthHandleInitialized = true;
}

// Lyrics display (shared renderer lives in modules/lyric.js)
function displayLyrics(data, fetchVideoId) {
    const normalizeVideoId = (value) => (value === undefined || value === null) ? '' : String(value).trim();
    const targetVideoId = normalizeVideoId(fetchVideoId);
    const result = displayLyricsUI(data, {
        fetchVideoId,
        validateFetch: () => {
            const currentVideoId = normalizeVideoId(state.currentVideoId);
            const currentFetchVideoId = normalizeVideoId(state.currentFetchVideoId);
            // Accept late server-pushed lyrics for the same song even after transient fetch timeout
            // cleared currentFetchVideoId.
            return currentVideoId === targetVideoId
                && (currentFetchVideoId === targetVideoId || currentFetchVideoId === '');
        },
        logTag: 'LYRICS'
    });
    settleLyricsSongInfoReveal();
    requestAnimationFrame(() => runViewportSyncAndRecenter());
    return result;
}

function hideLyrics() {
    const result = hideLyricsUI({
        clearVideoId: true,
        logTag: 'LYRICS'
    });
    settleLyricsSongInfoReveal();
    return result;
}

async function refreshSongStateFromServer() {
    try {
        const response = await fetch(`${API_URL}/song`, {
            cache: 'no-store'
        });
        if (!response.ok) {
            if (response.status !== 404) {
                console.warn(`[LYRICS] Failed to refresh song state: HTTP ${response.status}`);
            }
            return;
        }

        const data = await response.json();
        if (!data || typeof data !== 'object' || !data.videoId) return;

        updateNowPlayingFromData(data, {
            isMainApp: false,
            onLyricsDisplay: displayLyrics,
            onLyricsHide: hideLyrics
        });
    } catch (error) {
        console.warn('[LYRICS] Failed to refresh song state from server:', error);
    }
}

// WebSocket message handler
function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'song_updated':
            if (message.data) {
                updateNowPlayingFromData(message.data, {
                    isMainApp: false,
                    onLyricsDisplay: displayLyrics,
                    onLyricsHide: hideLyrics
                });
            }
            break;

        case 'lyrics_updated':
            if (message.data && message.data.videoId === state.currentVideoId) {
                console.log(`[LYRICS] Received shared lyrics for: ${message.data.title} by ${message.data.artist}`);
                displayLyrics(message.data.lyrics, message.data.videoId);
            }
            break;

        case 'song_progress':
            if (message.data && message.data.elapsedSeconds !== undefined) {
                const serverElapsed = message.data.elapsedSeconds;
                const serverDuration = message.data.songDuration;
                const nowMs = Date.now();
                state.lastServerProgressAt = nowMs;
                state.lastProgressUpdate = serverElapsed;
                state.serverProgressBaseAt = Number(message.data.sampledAtMs) || nowMs;
                state.serverProgressBaseElapsed = Number(serverElapsed) || 0;
                state.playbackAnchorAt = Number(message.data.sampledAtMs) || nowMs;
                state.playbackAnchorElapsed = Number(serverElapsed) || 0;

                if (message.data.isPaused !== undefined && !window.manuallyPaused) {
                    state.isPaused = message.data.isPaused;
                    if (state.isPaused) {
                        document.body.classList.add('paused');
                    } else {
                        document.body.classList.remove('paused');
                    }
                }

                updateLyricsDisplay(serverElapsed, { trustedTiming: true });

                if (state.currentSongData) {
                    state.currentSongData.elapsedSeconds = serverElapsed;
                    if (serverDuration) {
                        state.currentSongData.songDuration = serverDuration;
                    }
                    if (message.data.isPaused !== undefined) {
                        state.currentSongData.isPaused = message.data.isPaused;
                    }
                }
            }
            break;

        case 'playback_updated':
            if (message.data) {
                updateNowPlayingFromData(message.data, {
                    isMainApp: false,
                    onLyricsDisplay: displayLyrics,
                    onLyricsHide: hideLyrics
                });
            }
            break;

    }
}

// Initialize app
async function init() {
    if (window.__lyricsAppInitDone) return;
    if (window.__lyricsAppInitPromise) return window.__lyricsAppInitPromise;

    window.__lyricsAppInitPromise = (async () => {
    console.log('[LYRICS] Initializing...');

    // Initialize Electron API stub if not present
    if (!window.electronAPI) {
        window.electronAPI = {
            disableClickThrough: () => {},
            enableClickThrough: () => {}
        };
    }

    // Apply saved settings
    applyPhoneLayoutMode();
    syncAmbientBgScreenMetrics();
    window.addEventListener('resize', applyPhoneLayoutMode, { passive: true });
    window.addEventListener('orientationchange', applyPhoneLayoutMode, { passive: true });
    applySavedSettings();
    initLyricDynamicTheme();

    // Initialize UI handlers
    initializePositionToggle();
    initializeLyricsClickabilityToggle();

    // Centralize lyric control wiring in a shared module.
    initLyricControlPanel({
        setWidthControlVisible,
        setCloseWindowButtonVisible,

        // Actions
        toggleLayoutPosition,
        saveSettings,
        cycleLyricsDisplayMode,
        cycleLyricFontWeightPreset,
        cycleLyricBackgroundPreset,
        toggleLyricDynamicTheme: toggleLyricDynamicThemeButton,
        cycleLyricThemeColor: cycleLyricThemeColorButton,
        cycleLyricTheme: cycleLyricThemeButton,

        // Queries + sizing
        getCurrentLayoutPosition,
        getHoverBoundsElement: () => getLyricsHoverBoundsElement(),
        getDragBoundsElement: () => getLyricsWidthBoundsElement(),
        getLyricDynamicThemeEnabled,
        getMinLyricsWidthVw: (viewportWidth) => (viewportWidth <= 767 ? MIN_LYRICS_WIDTH_VW_LOW_RES : MIN_LYRICS_WIDTH_VW),
        applyLyricsMaxWidth,
        scheduleViewportSync,
        scheduleViewportSyncAndRecenter,

        // Wheel (font-size)
        onLyricsWheel: (delta) => handleLyricWheelDelta(delta),

        // Labels
        updateAllLabels: updateAllLyricControlLabels
    });
    initializeLyricControlLabelHoverReset();
    initializeDynamicThemeDependentSync();

    // Keep dedicated /lyrics page in full-list mode (same as index expanded view).
    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsContainer) lyricsContainer.classList.add('expanded');
    initLyricsViewportObserver();
    initLyricsWidthBoundsObserver();
    scheduleViewportSyncAndRecenter();

    // Initialize WebSocket
    if (typeof WebSocket !== 'undefined' && !state.ws) {
        initWebSocket(handleWebSocketMessage);
    }
    refreshSongStateFromServer();

    // Apply UI scale
    applyBaseSizing();
    scheduleInitialSizingStabilization();

    const handleVisibilityRestore = () => {
        if (document.hidden) return;
        refreshSongStateFromServer();
        scheduleViewportSyncAndRecenter();
    };
    document.addEventListener('visibilitychange', handleVisibilityRestore);
    window.addEventListener('focus', handleVisibilityRestore, { passive: true });
    window.addEventListener('pageshow', handleVisibilityRestore, { passive: true });

    

    console.log('[LYRICS] Initialization complete');
    window.__lyricsAppInitDone = true;
    })();

    try {
        await window.__lyricsAppInitPromise;
    } catch (error) {
        window.__lyricsAppInitPromise = null;
        throw error;
    }
}

function handleWindowResize() {
    document.body?.classList.add('window-resizing');

    if (windowResizeSettleTimeout) {
        clearTimeout(windowResizeSettleTimeout);
        windowResizeSettleTimeout = null;
    }

    if (windowResizeRaf) {
        cancelAnimationFrame(windowResizeRaf);
        windowResizeRaf = null;
    }

    windowResizeRaf = requestAnimationFrame(() => {
        windowResizeRaf = null;
        applyBaseSizing();
        applyPhoneLayoutMode();
        scheduleViewportSyncAndRecenter();
    });

    windowResizeSettleTimeout = setTimeout(() => {
        windowResizeSettleTimeout = null;
        document.body?.classList.remove('window-resizing');
        ensureLyricsSongInfoVisible();
        scheduleViewportSyncAndRecenter();
    }, 140);
}

// Start app on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}

window.addEventListener('resize', handleWindowResize, { passive: true });

// Toggle function to manually hide/show layout (callable from external app)
window.togglePause = function() {
    const body = document.body;
    const ambientBg = document.getElementById('ambient-bg');
    
    if (body.classList.contains('paused')) {
        // Currently hidden - show it
        body.classList.remove('paused');
        if (ambientBg) {
            ambientBg.classList.remove('paused');
        }
        window.manuallyPaused = false;
        console.log('[LYRICS] Layout shown (togglePause)');
    } else {
        // Currently visible - hide it
        body.classList.add('paused');
        if (ambientBg) {
            ambientBg.classList.add('paused');
        }
        window.manuallyPaused = true;
        console.log('[LYRICS] Layout hidden (togglePause)');
    }
};
