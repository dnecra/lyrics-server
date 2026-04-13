import { state } from '../scripts/modules/config.js';
import { updateLyricsDisplay, displayLyricsUI, getLyricDisplayMode, setLyricDisplayMode, centerActiveLyricLineStrict } from '../scripts/modules/lyric.js';
import {
    initLyricDynamicTheme,
    getLyricDynamicThemeEnabled,
    setLyricDynamicThemeEnabled
} from '../scripts/modules/lyric-dynamic-theme.js';
import {
    initLyricControlPanel,
    isPhoneLayoutEnvironment,
    DEFAULT_FONT_SIZE,
    MIN_FONT_SIZE,
    MAX_FONT_SIZE,
    FONT_SIZE_STEP,
    MIN_LYRICS_WIDTH_VW,
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
} from '../scripts/modules/lyric-control.js';

function isDownloadPreviewPage() {
    return false;
}

function isDownloadMobilePreview() {
    return false;
}

// ── Dummy static data (no external files, no network) ─────────────────────────
let DUMMY_VIDEO_ID = 'welcome-static';
let DUMMY_TITLE    = 'Track Title';
let DUMMY_ARTIST   = 'Artist Name';
let DUMMY_ALBUM    = '';
let DUMMY_COVER    = '/icons/album-cover-placeholder.png';
let DUMMY_DURATION = 34;

let DUMMY_SYNCED_LYRICS = [
    '[00:02.00] ろれむ いぷすむ どろろ しっと あめっと',
    '[00:04.00] こんせくてとぅる あでぃぴしっちんぐ えりっと',
    '[00:06.00] せっど どぅ えいうすもっど てんぽる',
    '[00:08.00] いんちぢでんっと うっと らぼれ えっと どろれ',
    '[00:10.00] まぐな ありくぁ えにむ あっど みにむ',
    '[00:12.00] べにあむ くいす のすとるっど えぜるしてぃおん',
    '[00:14.00] うるらむこ らぼりす にしっ うっと ありくぃっぷ',
    '[00:16.00] えくす えあ こんもっど こんせくぁっと',
    '[00:18.00] どぅいす あうっと いるれ どろろ いん れぷれへんでりっと',
    '[00:20.00] ぼるぷたてぃ べりっと えっせ しるらむ',
    '[00:22.00] どろれ えう ふぎあっと ぬら ぱりあとぅる',
    '[00:24.00] えくせぷてぅる しんっと おっかえかっと くぴだたっと',
    '[00:26.00] のん ぷろいでんっと すんっと いん くるぱ',
    '[00:28.00] くい おふぃしあ でぜるんっと もりっと あにむ いっど',
    '[00:30.00] えすっと らぼるむ にしっ うっと ありくぃっぷ',
    '[00:32.00] えくす えあ こんもっど くぁ ぷらえせんっと',
    '[00:34.00]',
].join('\n');

let DUMMY_PLAIN_LYRICS = [
    'ろれむ いぷすむ どろろ しっと あめっと',
    'こんせくてとぅる あでぃぴしっちんぐ えりっと',
    'せっど どぅ えいうすもっど てんぽる',
    'いんちぢでんっと うっと らぼれ えっと どろれ',
    'まぐな ありくぁ えにむ あっど みにむ',
    'べにあむ くいす のすとるっど えぜるしてぃおん',
    'うるらむこ らぼりす にしっ うっと ありくぃっぷ',
    'えくす えあ こんもっど こんせくぁっと',
    'どぅいす あうっと いるれ どろろ いん れぷれへんでりっと',
    'ぼるぷたてぃ べりっと えっせ しるらむ',
    'どろれ えう ふぎあっと ぬら ぱりあとぅる',
    'えくせぷてぅる しんっと おっかえかっと くぴだたっと',
    'のん ぷろいでんっと すんっと いん くるぱ',
    'くい おふぃしあ でぜるんっと もりっと あにむ いっど',
    'えすっと らぼるむ にしっ うっと ありくぃっぷ',
    'えくす えあ こんもっど くぁ ぷらえせんっと',
].join('\n');

let DUMMY_ROMANIZED_SYNCED = [
    { text: 'lorem ipsum dolor sit amet' },
    { text: 'consectetur adipiscing elit' },
    { text: 'sed do eiusmod tempor' },
    { text: 'incididunt ut labore et dolore' },
    { text: 'magna aliqua enim ad minim' },
    { text: 'veniam quis nostrud exercitation' },
    { text: 'ullamco laboris nisi ut aliquip' },
    { text: 'ex ea commodo consequat' },
    { text: 'duis aute irure dolor in reprehenderit' },
    { text: 'voluptate velit esse cillum' },
    { text: 'dolore eu fugiat nulla pariatur' },
    { text: 'excepteur sint occaecat cupidatat' },
    { text: 'non proident sunt in culpa' },
    { text: 'qui officia deserunt mollit anim id' },
    { text: 'est laborum nisi ut aliquip' },
    { text: 'ex ea commodo qua praesent' },
    { text: '' },
];

let DUMMY_TRANSLATED_SYNCED = [
    { text: 'lorem ipsum dolor sit amet' },
    { text: 'consectetur adipiscing elit' },
    { text: 'sed do eiusmod tempor' },
    { text: 'incididunt ut labore et dolore' },
    { text: 'magna aliqua enim ad minim' },
    { text: 'veniam quis nostrud exercitation' },
    { text: 'ullamco laboris nisi ut aliquip' },
    { text: 'ex ea commodo consequat' },
    { text: 'duis aute irure dolor in reprehenderit' },
    { text: 'voluptate velit esse cillum' },
    { text: 'dolore eu fugiat nulla pariatur' },
    { text: 'excepteur sint occaecat cupidatat' },
    { text: 'non proident sunt in culpa' },
    { text: 'qui officia deserunt mollit anim id' },
    { text: 'est laborum nisi ut aliquip' },
    { text: 'ex ea commodo qua praesent' },
    { text: '' },
];


// ── Settings ──────────────────────────────────────────────────────────────────
window.manuallyPaused = false;

let lyricsContainerClickable = false;
const SETTINGS_KEY = 'lyricsSettings';
const LEGACY_SETTINGS_KEY = 'welcomeLyricsSettings';

// Manual theme colors (fixed palette used when dynamic theme is toggled off).
const MANUAL_LYRIC_THEME_COLORS = [
    { name: 'Green', hex: '8fc04f' },
    { name: 'Red', hex: 'ef4144' },
    { name: 'Red V2', hex: '990f04' },
    { name: 'Light Pink', hex: 'ffbaba' },
    { name: 'White', hex: 'ccccc1' },
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

function refreshDynamicLyricBackgroundIfNeeded() {
    if (normalizeLyricBackgroundPreset(currentLyricBackgroundPreset) !== 'dynamic') return;
    applyDynamicLyricBackground();
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

// Font sizing + layout defaults are centralized in `lyric-control.js`.

let currentLyricFontSize = DEFAULT_FONT_SIZE;
let lowResLyricFontSizeOffset = 0;
let currentLyricFontWeightPreset = 'regular';
let currentLyricBackgroundPreset = DEFAULT_LYRIC_BACKGROUND_PRESET;
let currentLyricRomanizationMode = 'both';
const lyricControlLabelTouched = {
    mode: false,
    font: false,
    background: false,
    translation: false,
    position: false,
    dynamic: false,
    color: false
};
let lyricsViewportResizeObserver = null;
let recenterAfterResizeRaf = null;
let viewportSyncTimeout = null;
let currentLyricsMaxWidthVw = DEFAULT_LYRICS_WIDTH_VW;
let currentLyricsDisplayMode = DEFAULT_LYRIC_DISPLAY_MODE;
let lyricsWidthDragActive = false;
let lyricsWidthDragHandleSide = null;
let isWidthShortcutHeld = false;
let isWidthControlHovered = false;
let widthControlAutoHideTimeout = null;
let translationToggleVisibilityObserver = null;
let configuredLyricsMinWidthVwCache = null;
let configuredLyricsMaxWidthVwCache = null;
let configuredLyricsMinWidthPxCache = null;

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

function getAuthoredRootCssPxVar(name, fallback) {
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

function getCssPxVar(name, fallback) {
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

function getConfiguredLyricsMinWidthPx() {
    if (configuredLyricsMinWidthPxCache == null) {
        configuredLyricsMinWidthPxCache = getAuthoredRootCssPxVar(
            '--lyrics-min-width-px',
            256
        );
    }
    return configuredLyricsMinWidthPxCache;
}

// ── Playback clock ────────────────────────────────────────────────────────────
const LOCAL_PROGRESS_INTERVAL_MS = 250;
let progressTimer = null;
let playbackStartedAtMs = 0;
let playbackBaseElapsedSeconds = 0;

function getElapsedSeconds() {
    if (!playbackStartedAtMs) return playbackBaseElapsedSeconds;
    return Math.min(
        DUMMY_DURATION,
        playbackBaseElapsedSeconds + ((Date.now() - playbackStartedAtMs) / 1000)
    );
}

function formatPlayerTime(totalSeconds) {
    const clamped = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}


// ── Bootstrap ─────────────────────────────────────────────────────────────────
function bootstrapStaticSong() {
    const titleEl  = document.getElementById('song-info-title');
    const artistEl = document.getElementById('song-info-artist');
    const coverEl  = document.getElementById('song-info-cover');
    if (titleEl)  titleEl.textContent  = DUMMY_TITLE;
    if (artistEl) artistEl.textContent = DUMMY_ARTIST;
    if (coverEl)  coverEl.src          = DUMMY_COVER;

    const ambientBg = document.getElementById('ambient-bg');
    if (ambientBg) ambientBg.style.backgroundImage = `url('${DUMMY_COVER}')`;

    const songInfo        = document.getElementById('song-info');
    const songInfoContent = document.getElementById('song-info-content');
    if (songInfo) songInfo.classList.add('loaded');
    if (songInfoContent) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            songInfoContent.classList.remove('reveal-up');
            void songInfoContent.offsetHeight;
            songInfoContent.classList.add('reveal-up');
        }));
    }

    state.currentVideoId      = DUMMY_VIDEO_ID;
    state.currentFetchVideoId = DUMMY_VIDEO_ID;
    state.lastFetchedVideoId  = DUMMY_VIDEO_ID;
    state.currentSongData = {
        videoId: DUMMY_VIDEO_ID, title: DUMMY_TITLE, artist: DUMMY_ARTIST, album: DUMMY_ALBUM,
        imageSrc: DUMMY_COVER, songDuration: DUMMY_DURATION, elapsedSeconds: 0, isPaused: false
    };
    playbackBaseElapsedSeconds = 0;
    playbackStartedAtMs = 0;

    displayLyricsUI(
        { syncedLyrics: DUMMY_SYNCED_LYRICS, syncLyrics: DUMMY_SYNCED_LYRICS,
          plainLyrics: DUMMY_PLAIN_LYRICS,
          romanizedSyncedLyrics: DUMMY_ROMANIZED_SYNCED,
          translatedSyncedLyrics: DUMMY_TRANSLATED_SYNCED,
          romanizedPlainLyrics: '' },
        { fetchVideoId: DUMMY_VIDEO_ID, validateFetch: () => true, logTag: 'WELCOME-STATIC' }
    );

    requestAnimationFrame(() => runViewportSyncAndRecenter());
}

function startProgressTracking() {
    if (progressTimer) clearInterval(progressTimer);
    playbackStartedAtMs = Date.now();
    playbackBaseElapsedSeconds = 0;
    progressTimer = setInterval(() => {
        if (!state.currentSongData) return;
        if (state.currentSongData.isPaused) return;
        const elapsed = getElapsedSeconds();
        state.currentSongData.elapsedSeconds = elapsed;
        state.currentSongData.isPaused = false;
        updateLyricsDisplay(elapsed);
    }, LOCAL_PROGRESS_INTERVAL_MS);
}

// ── Viewport / sizing ─────────────────────────────────────────────────────────
function syncLyricsViewportHeight() {
    syncCenterViewportMaxHeight();
    const root = document.documentElement;
    const lyricsContainer = document.getElementById('lyrics-container');
    if (!root || !lyricsContainer) return;
    const visibleLines = parseFloat(getComputedStyle(root).getPropertyValue('--lyrics-visible-lines')) || 3;
    const allLines = Array.from(lyricsContainer.querySelectorAll('#synced-lyrics .lyric-line, #plain-lyrics .lyric-line'))
        .filter(line => line && line.getClientRects().length > 0);
    const rootStyles = getComputedStyle(root);
    const measuredRowHeights = allLines.slice(0, 12).map(line => {
        const styles = getComputedStyle(line);
        return line.getBoundingClientRect().height + Math.max(0, parseFloat(styles.marginTop) || 0) + Math.max(0, parseFloat(styles.marginBottom) || 0);
    }).filter(v => Number.isFinite(v) && v > 0);
    const fallbackLineHeight = parseFloat(rootStyles.getPropertyValue('--lyric-line-height')) || 40;
    const fallbackGap = parseFloat(rootStyles.getPropertyValue('--lyrics-line-gap'))
        || parseFloat(rootStyles.getPropertyValue('--lyrics-line-outer-gap'))
        || 16;
    const singleRowHeight = measuredRowHeights.length > 0 ? Math.max(...measuredRowHeights) : (fallbackLineHeight + fallbackGap);
    root.style.setProperty('--lyrics-viewport-height', `${Math.max(1, Math.round(singleRowHeight * visibleLines))}px`);
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
    if (viewportSyncTimeout) { clearTimeout(viewportSyncTimeout); viewportSyncTimeout = null; }
    const shouldCenterActiveLine = getLyricDisplayMode() === 'scroll';
    const activeIndex = shouldCenterActiveLine ? captureCurrentActiveLyricIndex() : -1;
    scheduleViewportSync();
    if (recenterAfterResizeRaf) cancelAnimationFrame(recenterAfterResizeRaf);
    recenterAfterResizeRaf = requestAnimationFrame(() => {
        recenterAfterResizeRaf = requestAnimationFrame(() => {
            recenterAfterResizeRaf = null;
            const elapsed = Number(state?.currentSongData?.elapsedSeconds);
            if (Number.isFinite(elapsed) && elapsed >= 0) updateLyricsDisplay(elapsed);
            if (!shouldCenterActiveLine || activeIndex < 0) return;
            const lyricsContainer = document.getElementById('lyrics-container');
            if (!lyricsContainer) return;
            centerActiveLyricLineStrict(activeIndex, lyricsContainer, { behavior: 'instant' });
        });
    });
}

function scheduleViewportSyncAndRecenter() {
    if (viewportSyncTimeout) clearTimeout(viewportSyncTimeout);
    viewportSyncTimeout = setTimeout(() => runViewportSyncAndRecenter(), 120);
}

function applyLyricsMaxWidth(nextWidthVw) {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const useMobileSizing = viewportWidth <= 768 || isPhoneLayoutEnvironment();
    const minWidthPx = Math.max(20, getConfiguredLyricsMinWidthPx());
    const configuredMaxWidthVw = getConfiguredLyricsMaxWidthVw();
    const rootStyles = getComputedStyle(document.documentElement);
    const cornerLeftPx = parseFloat(rootStyles.getPropertyValue('--lyrics-corner-left')) || 0;
    const cornerRightPx = parseFloat(rootStyles.getPropertyValue('--lyrics-corner-right')) || 0;
    const availableWidthPx = Math.max(20, viewportWidth - cornerLeftPx - cornerRightPx);
    const minWidthVw = (minWidthPx / availableWidthPx) * 100;
    document.documentElement.style.setProperty('--lyrics-available-width', `${Math.round(availableWidthPx)}px`);
    document.documentElement.style.setProperty('--lyrics-min-width-px', `${Math.round(minWidthPx)}px`);
    if (useMobileSizing) {
        currentLyricsMaxWidthVw = configuredMaxWidthVw;
        document.documentElement.style.setProperty('--lyrics-max-width', `${configuredMaxWidthVw}%`);
        document.documentElement.style.setProperty('--lyrics-max-width-px', `${Math.round((availableWidthPx * configuredMaxWidthVw) / 100)}px`);
        return;
    }

    const parsed = Number(nextWidthVw);
    const clamped = Math.max(
        minWidthVw,
        Math.min(configuredMaxWidthVw, Number.isFinite(parsed) ? parsed : configuredMaxWidthVw)
    );
    currentLyricsMaxWidthVw = clamped;
    document.documentElement.style.setProperty('--lyrics-max-width', `${clamped}%`);
    document.documentElement.style.setProperty('--lyrics-max-width-px', `${Math.round((availableWidthPx * clamped) / 100)}px`);
}

function getResponsiveLowResMaxFontSize() {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);

    if (viewportWidth > 768) {
        return MAX_FONT_SIZE;
    }

    return Math.max(
        MIN_FONT_SIZE,
        Math.min(
            48,
            Math.round(Math.min(viewportWidth * 0.08, viewportHeight * 0.1))
        )
    );
}

function getResponsiveLowResBaseFontSize() {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const mobileCap = 48;
    const mobileBaseFloorOffset = 8;

    if (viewportWidth > 768) {
        return DEFAULT_FONT_SIZE;
    }

    return Math.max(
        MIN_FONT_SIZE,
        Math.min(
            mobileCap,
            Math.round(Math.min(viewportWidth * 0.09, viewportHeight * 0.12)) - mobileBaseFloorOffset
        )
    );
}

function getEffectiveLyricFontSize() {
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const useMobileSizing = viewportWidth <= 768 || isPhoneLayoutEnvironment();

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
    const plain  = document.getElementById('plain-lyrics');
    if (!synced && !plain) return;
    lyricsViewportResizeObserver = new ResizeObserver(() => scheduleViewportSync());
    if (synced) lyricsViewportResizeObserver.observe(synced);
    if (plain)  lyricsViewportResizeObserver.observe(plain);
}

function applyLyricSizing() {
    applyLyricsMaxWidth(currentLyricsMaxWidthVw);
    const effectiveFontSize = getEffectiveLyricFontSize();
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const priority = (viewportWidth <= 768 || isDownloadMobilePreview()) ? 'important' : '';
    const boostedFontSize = viewportWidth <= 768 ? effectiveFontSize + 16 : effectiveFontSize;
    const baseGap = getCssPxVar('--lyrics-line-gap', 16);
    const outerGap = Math.max(8, Math.round((boostedFontSize / DEFAULT_FONT_SIZE) * baseGap));
    document.documentElement.style.setProperty('--lyric-font-size', `${boostedFontSize}px`, priority);
    document.documentElement.style.setProperty('--lyric-line-height', `${Math.round(boostedFontSize * 1.16)}px`, priority);
    document.documentElement.style.setProperty('--lyrics-line-outer-gap', `${outerGap}px`, priority);
    document.documentElement.style.setProperty('--lyric-romanized-size', `${boostedFontSize * 0.6}px`, priority);
    syncCenterViewportMaxHeight();
    scheduleViewportSyncAndRecenter();
}

// ── Settings ──────────────────────────────────────────────────────────────────
function saveSettings() {
    return;
}

function loadSettings() {
    return null;
}

function normalizeLyricDisplayMode(mode) {
    if (typeof mode !== 'string') return DEFAULT_LYRIC_DISPLAY_MODE;
    const n = mode.trim().toLowerCase();
    return LYRIC_DISPLAY_MODE_ORDER.includes(n) ? n : DEFAULT_LYRIC_DISPLAY_MODE;
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

function normalizeLyricRomanizationMode(mode) {
    if (typeof mode !== 'string') return 'both';
    const normalized = mode.trim().toLowerCase();
    return ['romanized', 'both', 'off'].includes(normalized) ? normalized : 'both';
}

function hasRenderedRomanizedLines() {
    return !!document.querySelector('#synced-lyrics .romanized, #plain-lyrics .romanized');
}

function hasRenderedTranslationLines() {
    return !!document.querySelector('#synced-lyrics .lyric-translation, #plain-lyrics .lyric-translation');
}

function getLyricAssistCapabilities() {
    return {
        hasRomanized: hasRenderedRomanizedLines(),
        hasTranslation: hasRenderedTranslationLines()
    };
}

function getLyricAssistToggleOrder() {
    const { hasRomanized, hasTranslation } = getLyricAssistCapabilities();
    if (hasRomanized && hasTranslation) return ['romanized', 'both', 'off'];
    if (hasTranslation) return ['both', 'off'];
    if (hasRomanized) return ['romanized', 'off'];
    return ['both', 'off'];
}

function normalizeLyricAssistModeForAvailableContent(mode) {
    const normalized = normalizeLyricRomanizationMode(mode);
    const order = getLyricAssistToggleOrder();
    if (order.includes(normalized)) return normalized;
    return order[0] || 'off';
}

function applyLyricRomanizationMode(mode, { persist = true } = {}) {
    currentLyricRomanizationMode = normalizeLyricAssistModeForAvailableContent(mode);
    const root = document.documentElement;
    root.classList.toggle('lyrics-translation-hidden', currentLyricRomanizationMode !== 'both');
    root.classList.toggle('lyrics-romanization-off', currentLyricRomanizationMode === 'off');
    updateLyricsTranslationToggleLabel();
    requestAnimationFrame(() => {
        scheduleViewportSyncAndRecenter();
    });
    if (persist) saveSettings();
}

function hasVisibleLyricAssistLines() {
    const { hasRomanized, hasTranslation } = getLyricAssistCapabilities();
    return hasRomanized || hasTranslation;
}

function syncTranslationToggleVisibility() {
    const btn = document.getElementById('lyrics-translation-toggle');
    if (!btn) return;
    const visible = hasVisibleLyricAssistLines();
    btn.hidden = !visible;
    btn.style.display = visible ? '' : 'none';
    btn.setAttribute('aria-hidden', visible ? 'false' : 'true');
    syncWidthControlButtonMetrics();
}

function initTranslationToggleVisibilityObserver() {
    if (translationToggleVisibilityObserver || typeof MutationObserver === 'undefined') return;
    const synced = document.getElementById('synced-lyrics');
    const plain = document.getElementById('plain-lyrics');
    if (!synced && !plain) return;

    translationToggleVisibilityObserver = new MutationObserver(() => {
        syncTranslationToggleVisibility();
    });

    if (synced) translationToggleVisibilityObserver.observe(synced, { childList: true, subtree: true });
    if (plain) translationToggleVisibilityObserver.observe(plain, { childList: true, subtree: true });
    syncTranslationToggleVisibility();
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
    lyricControlLabelTouched.translation = false;
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

function updateLyricsTranslationToggleLabel() {
    const btn = document.getElementById('lyrics-translation-toggle');
    if (!btn) return;
    syncTranslationToggleVisibility();
    if (btn.hidden) return;
    const { hasRomanized, hasTranslation } = getLyricAssistCapabilities();
    const isTranslationOnly = hasTranslation && !hasRomanized;
    const mode = normalizeLyricAssistModeForAvailableContent(currentLyricRomanizationMode);
    currentLyricRomanizationMode = mode;

    const labelMap = isTranslationOnly
        ? {
            both: 'Translated',
            off: 'Off'
        }
        : {
            romanized: 'Romanized',
            both: 'Translated',
            off: 'Off'
        };
    const titleMap = isTranslationOnly
        ? {
            both: 'Translation: On',
            off: 'Translation: Off'
        }
        : {
            romanized: 'Romanization: On',
            both: 'Romanization + Translation: On',
            off: 'Romanization + Translation: Off'
        };
    const baseLabel = isTranslationOnly ? 'Translation' : 'Romanization';
    setLyricButtonLabel(btn, lyricControlLabelTouched.translation ? (labelMap[mode] || 'Off') : baseLabel);
    btn.setAttribute('aria-label', `Cycle lyric ${isTranslationOnly ? 'translation' : 'romanization'} mode (current: ${labelMap[mode] || 'Off'})`);
    btn.setAttribute('title', titleMap[mode] || `${baseLabel}: Off`);
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
    const swatchHex = normalizeHexColor(fixedHex) || '#e5e5e5';
    setLyricButtonLabel(btn, lyricControlLabelTouched.color ? currentName : 'Color');
    setLyricButtonIcon(btn, getThemeColorIconSvg(dynamicEnabled));
    btn.style.setProperty('--lyrics-theme-cycle-color', swatchHex);
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

function updateLyricsPositionToggleLabelLegacy() {
    const btn = document.getElementById('lyrics-position-toggle');
    const layoutContainer = document.getElementById('layout-container');
    if (!btn || !layoutContainer) return;
    const label = layoutContainer.classList.contains('position-right') ? 'Right' : 'Left';
    setLyricButtonLabel(btn, lyricControlLabelTouched.position ? label : 'Position');
    setLyricButtonIcon(btn, getPositionIconSvg(getCurrentLayoutPosition(layoutContainer)));
    btn.setAttribute('aria-label', `Switch lyrics position (current: ${label})`);
    btn.setAttribute('title', `Position: ${label}`);
}

function getNextLyricDisplayMode(mode) {
    const idx = LYRIC_DISPLAY_MODE_ORDER.indexOf(normalizeLyricDisplayMode(mode));
    return LYRIC_DISPLAY_MODE_ORDER[(idx < 0 ? 0 : idx + 1) % LYRIC_DISPLAY_MODE_ORDER.length];
}

function applyLyricsDisplayMode(mode, { persist = true, refresh = true } = {}) {
    const normalized = normalizeLyricDisplayMode(mode);
    currentLyricsDisplayMode = normalized;
    document.documentElement.style.setProperty('--lyrics-visible-lines', String(LYRIC_DISPLAY_MODE_VISIBLE_LINES[normalized] || 3));
    setLyricDisplayMode(normalized, { refresh });
    updateLyricsDisplayModeToggleLabel();
    scheduleViewportSyncAndRecenter();
    if (persist) saveSettings();
}

function cycleLyricsDisplayMode() {
    lyricControlLabelTouched.mode = true;
    applyLyricsDisplayMode(getNextLyricDisplayMode(currentLyricsDisplayMode || getLyricDisplayMode()), { persist: true, refresh: true });
}

function applyLyricFontWeightPreset(preset, { persist = true } = {}) {
    const normalized = normalizeLyricFontWeightPreset(preset);
    const config = LYRIC_FONT_WEIGHT_PRESETS[normalized] || LYRIC_FONT_WEIGHT_PRESETS.regular;
    currentLyricFontWeightPreset = normalized;
    document.documentElement.style.setProperty('--lyrics-inactive-font-weight', String(config.main));
    document.documentElement.style.setProperty('--lyrics-active-font-weight', String(config.main));
    document.documentElement.style.setProperty('--lyrics-translation-font-weight', String(config.translation));
    updateLyricsFontWeightToggleLabel();
    if (persist) saveSettings();
}

function applyLyricBackgroundPreset(preset, { persist = true } = {}) {
    const normalized = normalizeLyricBackgroundPreset(preset);
    const config = LYRIC_BACKGROUND_PRESETS[normalized] || LYRIC_BACKGROUND_PRESETS.solid;
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

function syncWidthControlButtonMetrics() {
    const widthControl = document.getElementById('lyrics-width-control');
    const positionButton = document.getElementById('lyrics-position-toggle');
    const modeButton = document.getElementById('lyrics-display-mode-toggle');
    const weightButton = document.getElementById('lyrics-font-weight-toggle');
    const backgroundButton = document.getElementById('lyrics-background-toggle');
    const translationButton = document.getElementById('lyrics-translation-toggle');
    const dynamicThemeToggleButton = document.getElementById('lyrics-dynamic-theme-toggle');
    const themeColorCycleButton = document.getElementById('lyrics-theme-color-cycle');
    if (
        !widthControl
        || !positionButton
        || !modeButton
        || !weightButton
        || !backgroundButton
        || !translationButton
        || !dynamicThemeToggleButton
        || !themeColorCycleButton
    ) return;

    const positionWidth = Math.ceil(positionButton.offsetWidth);
    const modeWidth = Math.ceil(modeButton.offsetWidth);
    const weightWidth = Math.ceil(weightButton.offsetWidth);
    const backgroundWidth = Math.ceil(backgroundButton.offsetWidth);
    const translationVisible = !!(translationButton.offsetParent && !translationButton.hidden);
    const translationWidth = translationVisible ? Math.ceil(translationButton.offsetWidth) : 0;
    const dynamicThemeToggleVisible = !!(dynamicThemeToggleButton.offsetParent && !dynamicThemeToggleButton.hidden);
    const dynamicThemeToggleWidth = dynamicThemeToggleVisible ? Math.ceil(dynamicThemeToggleButton.offsetWidth) : 0;
    const themeColorCycleWidth = Math.ceil(themeColorCycleButton.offsetWidth);
    const gap = 8;
    const modeOffset = positionWidth + gap;
    const weightOffset = positionWidth + modeWidth + (gap * 2);
    const backgroundOffset = weightOffset + weightWidth + gap;
    const translationOffset = backgroundOffset + backgroundWidth + gap;
    const dynamicThemeToggleOffset = translationVisible
        ? translationOffset + translationWidth + gap
        : backgroundOffset + backgroundWidth + gap;
    const themeColorCycleOffset = dynamicThemeToggleVisible
        ? dynamicThemeToggleOffset + dynamicThemeToggleWidth + gap
        : dynamicThemeToggleOffset;
    const totalWidth = dynamicThemeToggleVisible
        ? positionWidth + modeWidth + weightWidth + backgroundWidth + translationWidth + dynamicThemeToggleWidth + themeColorCycleWidth + (gap * (translationVisible ? 6 : 5))
        : positionWidth + modeWidth + weightWidth + backgroundWidth + translationWidth + themeColorCycleWidth + (gap * (translationVisible ? 5 : 4));
    widthControl.style.setProperty('--lyrics-control-buttons-width', `${totalWidth}px`);
    widthControl.style.setProperty('--lyrics-mode-toggle-left', `${modeOffset}px`);
    widthControl.style.setProperty('--lyrics-font-weight-toggle-left', `${weightOffset}px`);
    widthControl.style.setProperty('--lyrics-background-toggle-left', `${backgroundOffset}px`);
    widthControl.style.setProperty('--lyrics-translation-toggle-left', `${translationOffset}px`);
    widthControl.style.setProperty('--lyrics-dynamic-theme-toggle-left', `${dynamicThemeToggleOffset}px`);
    widthControl.style.setProperty('--lyrics-theme-color-cycle-left', `${themeColorCycleOffset}px`);
    widthControl.style.setProperty('--lyrics-position-toggle-right', `0px`);
    widthControl.style.setProperty('--lyrics-mode-toggle-right', `${positionWidth + gap}px`);
    widthControl.style.setProperty('--lyrics-font-weight-toggle-right', `${positionWidth + modeWidth + (gap * 2)}px`);
    widthControl.style.setProperty('--lyrics-background-toggle-right', `${positionWidth + modeWidth + weightWidth + (gap * 3)}px`);
    widthControl.style.setProperty('--lyrics-translation-toggle-right', `${positionWidth + modeWidth + weightWidth + backgroundWidth + (gap * 4)}px`);
    widthControl.style.setProperty('--lyrics-dynamic-theme-toggle-right', translationVisible
        ? `${positionWidth + modeWidth + weightWidth + backgroundWidth + translationWidth + (gap * 5)}px`
        : `${positionWidth + modeWidth + weightWidth + backgroundWidth + (gap * 4)}px`);
    widthControl.style.setProperty('--lyrics-theme-color-cycle-right', dynamicThemeToggleVisible
        ? `${positionWidth + modeWidth + weightWidth + backgroundWidth + translationWidth + dynamicThemeToggleWidth + (gap * (translationVisible ? 6 : 5))}px`
        : `${positionWidth + modeWidth + weightWidth + backgroundWidth + translationWidth + (gap * (translationVisible ? 5 : 4))}px`);
}

function updateLyricsPositionToggleLabel() {
    const btn = document.getElementById('lyrics-position-toggle');
    const layoutContainer = document.getElementById('layout-container');
    if (!btn || !layoutContainer) return;
    const position = getCurrentLayoutPosition(layoutContainer);
    const label = LAYOUT_POSITION_LABELS[position] || LAYOUT_POSITION_LABELS.left;
    setLyricButtonLabel(btn, lyricControlLabelTouched.position ? label : 'Position');
    setLyricButtonIcon(btn, getPositionIconSvg(getCurrentLayoutPosition(layoutContainer)));
    btn.setAttribute('aria-label', `Switch lyrics position (current: ${label})`);
    btn.setAttribute('title', `Position: ${label}`);
    syncWidthControlButtonMetrics();
}

function syncWidthControlPositionClass() {
    const layoutContainer = document.getElementById('layout-container');
    const widthControl    = document.getElementById('lyrics-width-control');
    const closeControl    = document.getElementById('close-dummy-control');
    if (!layoutContainer || !widthControl) return;
    const position = getCurrentLayoutPosition(layoutContainer);
    widthControl.classList.toggle('position-right', position === 'right');
    widthControl.classList.toggle('position-center', position === 'center');
    if (closeControl) {
        // Keep welcome close button fixed at center (no position-specific variants).
        closeControl.classList.remove('position-right', 'position-center');
    }
}

function toggleLayoutPosition() {
    lyricControlLabelTouched.position = true;
    const layoutContainer = document.getElementById('layout-container');
    if (!layoutContainer) return;
    applyLayoutPosition(getNextLayoutPosition(getCurrentLayoutPosition(layoutContainer)));
    saveSettings();
}

function setWidthControlVisible(visible) {
    const widthControl = document.getElementById('lyrics-width-control');
    if (widthControl) widthControl.classList.toggle('show', !!visible);
}

function setCloseWindowButtonVisible(visible) {
    const closeControl = document.getElementById('close-dummy-control');
    if (!closeControl) return;
    closeControl.classList.toggle('show', !!visible);
    closeControl.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function hideWelcomeControllerUi() {
    lyricsWidthDragActive = false;
    isWidthShortcutHeld = false;
    isWidthControlHovered = false;
    if (widthControlAutoHideTimeout) {
        clearTimeout(widthControlAutoHideTimeout);
        widthControlAutoHideTimeout = null;
    }
    setWidthControlVisible(false);
    setCloseWindowButtonVisible(false);
}

function enableWelcomeHotkeyOnlyLyricControls() {
    document.body.classList.add('welcome-hotkey-only-controls');
}

function scheduleWidthControlAutoHide(delayMs = 1000) {
    if (widthControlAutoHideTimeout) { clearTimeout(widthControlAutoHideTimeout); widthControlAutoHideTimeout = null; }
    widthControlAutoHideTimeout = setTimeout(() => {
        widthControlAutoHideTimeout = null;
        if (!isWidthShortcutHeld && !isWidthControlHovered && !lyricsWidthDragActive) {
            setWidthControlVisible(false); setCloseWindowButtonVisible(false);
        }
    }, delayMs);
}

function applyLyricsContainerClickability() {
    if (!window.electronAPI) return;
    const lyricsContainer = document.getElementById('lyrics-container');
    window.electronAPI.enableClickThrough();
    if (lyricsContainer) {
        lyricsContainer.style.removeProperty('pointer-events');
        lyricsContainer.style.removeProperty('opacity');
        lyricsContainer.style.removeProperty('visibility');
    }
}

function toggleLyricsContainerClickability() {
    lyricsContainerClickable = !lyricsContainerClickable;
    applyLyricsContainerClickability(); saveSettings();
}

function detectUiScale() {
    try {
        const sw = (window.screen && window.screen.width) || window.innerWidth || 1920;
        const sh = (window.screen && window.screen.height) || window.innerHeight || 1080;
        if (sw >= 3840 || sh >= 2160) return 2;
    } catch (_) {}
    return 1;
}

function applyUiScale() {
    const scale = detectUiScale();
    document.documentElement.style.setProperty('--ui-scale', String(scale));
    try { document.body.style.removeProperty('zoom'); } catch (_) {}
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    if (viewportWidth <= 768) {
        lowResLyricFontSizeOffset = 0;
        currentLyricFontSize = getResponsiveLowResBaseFontSize();
    } else if (!window._userSetFontSize) {
        currentLyricFontSize = Math.round(DEFAULT_FONT_SIZE * scale);
    }
    applyLyricsMaxWidth(currentLyricsMaxWidthVw);
    applyLyricSizing();
    requestAnimationFrame(() => syncWidthControlButtonMetrics());
}

function applySavedSettings() {
    const settings = loadSettings();
    if (settings) {
        const layoutContainer = document.getElementById('layout-container');
        if (layoutContainer) {
            applyLayoutPosition(settings.position || (isPhoneLayoutEnvironment() ? 'center' : 'left'));
        }
        if (settings.fontSize >= MIN_FONT_SIZE && settings.fontSize <= MAX_FONT_SIZE) {
            currentLyricFontSize = settings.fontSize; window._userSetFontSize = true;
        }
        lyricsContainerClickable = settings.lyricsContainerClickable ?? false;
        applyLyricsMaxWidth(settings.lyricsMaxWidthVw ?? DEFAULT_LYRICS_WIDTH_VW);
        applyLyricsDisplayMode(settings.lyricsDisplayMode || (isPhoneLayoutEnvironment() ? 'scroll' : DEFAULT_LYRIC_DISPLAY_MODE), { persist: false, refresh: false });
        applyLyricFontWeightPreset(settings.lyricFontWeightPreset || 'regular', { persist: false });
        applyLyricBackgroundPreset(settings.lyricBackgroundPreset || DEFAULT_LYRIC_BACKGROUND_PRESET, { persist: false });
        const savedRomanizationMode = settings.lyricRomanizationMode
            || (settings.lyricTranslationEnabled === true ? 'both' : 'both');
        applyLyricRomanizationMode(savedRomanizationMode, { persist: false });
        syncWidthControlPositionClass(); updateLyricsPositionToggleLabel(); applyLyricsContainerClickability();
    } else {
        const layoutContainer = document.getElementById('layout-container');
        if (layoutContainer) applyLayoutPosition(isPhoneLayoutEnvironment() ? 'center' : 'left');
        setLyricDynamicThemeEnabled(false, { refresh: false });
        currentManualLyricThemeColorIndex = 0;
        applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
        currentLyricFontSize = DEFAULT_FONT_SIZE;
        window._userSetFontSize = true;
        applyLyricsContainerClickability();
        applyLyricsMaxWidth(DEFAULT_LYRICS_WIDTH_VW);
        applyLyricsDisplayMode(isPhoneLayoutEnvironment() ? 'scroll' : DEFAULT_LYRIC_DISPLAY_MODE, { persist: false, refresh: false });
        applyLyricFontWeightPreset('regular', { persist: false });
        applyLyricBackgroundPreset(DEFAULT_LYRIC_BACKGROUND_PRESET, { persist: false });
        applyLyricRomanizationMode('both', { persist: false });
    }
    applyLyricSizing();
}

// ── UI initializers ───────────────────────────────────────────────────────────
function initializePositionToggle() {
    if (window._layoutToggleListenerAdded) return;
    if (isDownloadMobilePreview()) return;
    let _pdi = null;
    const _MAX_DUR = 250, _MAX_MOV = 10;
    const _t = document.getElementById('song-info-content') || document.body;
    _t.addEventListener('pointerdown', (ev) => {
        if (ev.button && ev.button !== 0) return;
        _pdi = { time: Date.now(), x: ev.clientX, y: ev.clientY, moved: false };
    }, true);
    _t.addEventListener('pointermove', (ev) => {
        if (!_pdi) return;
        if (Math.hypot(ev.clientX - _pdi.x, ev.clientY - _pdi.y) > _MAX_MOV) _pdi.moved = true;
    }, true);
    _t.addEventListener('pointerup', (ev) => {
        try {
            if (!_pdi) return;
            const dur = Date.now() - _pdi.time;
            if ((window.getSelection?.().toString?.() || '').trim().length > 0) { _pdi = null; return; }
            if (!_pdi.moved && dur <= _MAX_DUR) {
                if (ev.target?.closest?.('a, button, input, textarea, select')) { _pdi = null; return; }
                toggleLayoutPosition();
            }
        } catch (err) { console.warn('tap-detect error', err); }
        finally { _pdi = null; }
    }, true);
    _t.addEventListener('pointercancel', () => { _pdi = null; }, true);
    window._layoutToggleListenerAdded = true;
}

function initializeFontSizeControl() {
    if (window._lyricsFontSizeListenerAdded) return;
    document.addEventListener('wheel', (event) => {
        if (isDownloadMobilePreview()) {
            return;
        }
        event.preventDefault(); event.stopPropagation();
        const delta = event.deltaY || event.detail || -event.wheelDelta;
        setWidthControlVisible(true); scheduleWidthControlAutoHide();
        const lc = document.getElementById('layout-container');
        if (lc) { lc.style.opacity = '1'; lc.style.pointerEvents = 'auto'; }
        if ((window.innerWidth || document.documentElement.clientWidth || 1) <= 768) {
            const baseFontSize = getResponsiveLowResBaseFontSize();
            const effectiveMaxFontSize = getResponsiveLowResMaxFontSize();
            lowResLyricFontSizeOffset = delta > 0
                ? Math.max(MIN_FONT_SIZE - baseFontSize, lowResLyricFontSizeOffset - FONT_SIZE_STEP)
                : Math.min(effectiveMaxFontSize - baseFontSize, lowResLyricFontSizeOffset + FONT_SIZE_STEP);
        } else {
            currentLyricFontSize = delta > 0
                ? Math.max(MIN_FONT_SIZE, currentLyricFontSize - FONT_SIZE_STEP)
                : Math.min(MAX_FONT_SIZE, currentLyricFontSize + FONT_SIZE_STEP);
        }
        applyLyricSizing();
        clearTimeout(window.fontSizeSaveTimeout);
        window.fontSizeSaveTimeout = setTimeout(saveSettings, 500);
    }, { passive: false, capture: true });
    window._lyricsFontSizeListenerAdded = true;
}

function initializeLyricsClickabilityToggle() {
    const contentEl = document.getElementById('song-info-content');
    if (contentEl) contentEl.onclick = (e) => { e.stopPropagation(); toggleLyricsContainerClickability(); };
}

function initializeLyricsWidthHandle() {
    const handles = [
        document.getElementById('lyrics-width-handle'),
        document.getElementById('lyrics-width-handle-secondary')
    ].filter(Boolean);
    if (handles.length === 0 || window._lyricsWidthHandleInitialized) return;
    const beginDrag = (e, handle) => {
        const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        if (viewportWidth <= 768) {
            return;
        }

        e.preventDefault(); e.stopPropagation(); lyricsWidthDragActive = true;
        lyricsWidthDragHandleSide = handle?.id === 'lyrics-width-handle-secondary' ? 'right' : 'left';
        if (widthControlAutoHideTimeout) { clearTimeout(widthControlAutoHideTimeout); widthControlAutoHideTimeout = null; }
        setWidthControlVisible(true);
        const lc = document.getElementById('layout-container');
        if (lc) { lc.style.opacity = '1'; lc.style.pointerEvents = 'auto'; }
    };
    const endDrag = () => {
        if (!lyricsWidthDragActive) return;
        lyricsWidthDragActive = false; lyricsWidthDragHandleSide = null; scheduleViewportSyncAndRecenter(); saveSettings(); scheduleWidthControlAutoHide();
    };
    const updateDrag = (e) => {
        if (!lyricsWidthDragActive) return;
        const lc = document.getElementById('layout-container');
        const position = getCurrentLayoutPosition(lc);
        const px = Number(e.clientX);
        if (!Number.isFinite(px)) return;
        const vw = Math.max(1, window.innerWidth || 1);
        const minWidthPx = Math.max(20, getConfiguredLyricsMinWidthPx());
        const widthPx = position === 'right'
            ? (vw - px)
            : position === 'center'
                ? (() => {
                    const halfMin = minWidthPx / 2;
                    const centerX = vw / 2;
                    if (lyricsWidthDragHandleSide === 'right') {
                        const clampedPointerX = Math.max(centerX + halfMin, px);
                        return Math.max(minWidthPx, (clampedPointerX - centerX) * 2);
                    }
                    const clampedPointerX = Math.min(centerX - halfMin, px);
                    return Math.max(minWidthPx, (centerX - clampedPointerX) * 2);
                })()
                : px;
        applyLyricsMaxWidth((widthPx / vw) * 100);
        scheduleViewportSync();
    };
    handles.forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => { beginDrag(e, handle); try { handle.setPointerCapture(e.pointerId); } catch (_) {} });
    });
    window.addEventListener('pointermove', updateDrag, { passive: true });
    window.addEventListener('pointerup', endDrag, { passive: true });
    window.addEventListener('pointercancel', endDrag, { passive: true });
    window.addEventListener('blur', endDrag);
    const widthControl = document.getElementById('lyrics-width-control');
    if (widthControl) {
        widthControl.addEventListener('pointerenter', () => {
            isWidthControlHovered = true;
            if (widthControlAutoHideTimeout) { clearTimeout(widthControlAutoHideTimeout); widthControlAutoHideTimeout = null; }
        });
        widthControl.addEventListener('pointerleave', () => {
            isWidthControlHovered = false;
            if (!lyricsWidthDragActive) scheduleWidthControlAutoHide();
        });
    }
    window._lyricsWidthHandleInitialized = true;
}

function initializeWidthControlShortcut() {
    if (window._lyricsWidthShortcutInitialized) return;
    const pressedCodes = new Set();
    const isCombo = () =>
        pressedCodes.has('KeyF') &&
        (pressedCodes.has('AltLeft') || pressedCodes.has('AltRight')) &&
        (pressedCodes.has('ShiftLeft') || pressedCodes.has('ShiftRight')) &&
        !pressedCodes.has('ControlLeft') && !pressedCodes.has('ControlRight') &&
        !pressedCodes.has('MetaLeft') && !pressedCodes.has('MetaRight');
    const isEditable = (t) => !!(t instanceof Element) && !!(t.closest('[contenteditable="true"]') || t.closest('input, textarea, select'));
    const clearUi = () => { pressedCodes.clear(); isWidthShortcutHeld = false; setWidthControlVisible(false); setCloseWindowButtonVisible(false); };
    document.addEventListener('keydown', (e) => {
        pressedCodes.add(e.code);
        if (isEditable(e.target)) return;
        if (!isCombo()) { if (isWidthShortcutHeld) clearUi(); return; }
        e.preventDefault(); isWidthShortcutHeld = true;
        if (widthControlAutoHideTimeout) { clearTimeout(widthControlAutoHideTimeout); widthControlAutoHideTimeout = null; }
        setWidthControlVisible(true); setCloseWindowButtonVisible(true);
    }, true);
    document.addEventListener('keyup', (e) => {
        pressedCodes.delete(e.code);
        if (!isWidthShortcutHeld) return;
        if (isCombo()) return;
        e.preventDefault(); clearUi();
    }, true);
    window.addEventListener('blur', clearUi);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearUi(); });
    window._lyricsWidthShortcutInitialized = true;
}

window.__welcomeHideControllerUi = hideWelcomeControllerUi;

function initializeLyricsDisplayModeToggle() {
    const btn = document.getElementById('lyrics-display-mode-toggle');
    if (!btn || window._lyricsDisplayModeToggleInitialized) return;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); cycleLyricsDisplayMode(); scheduleWidthControlAutoHide(); });
    window._lyricsDisplayModeToggleInitialized = true;
}

function initializeLyricsPositionToggle() {
    const btn = document.getElementById('lyrics-position-toggle');
    if (!btn || window._lyricsPositionToggleInitialized) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleLayoutPosition();
        scheduleWidthControlAutoHide();
    });
    updateLyricsPositionToggleLabel();
    window._lyricsPositionToggleInitialized = true;
}

function initializeLyricsFontWeightToggle() {
    const btn = document.getElementById('lyrics-font-weight-toggle');
    if (!btn || window._lyricsFontWeightToggleInitialized) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cycleLyricFontWeightPreset();
        scheduleWidthControlAutoHide();
    });
    updateLyricsFontWeightToggleLabel();
    window._lyricsFontWeightToggleInitialized = true;
}

function initializeLyricsBackgroundToggle() {
    const btn = document.getElementById('lyrics-background-toggle');
    if (!btn || window._lyricsBackgroundToggleInitialized) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cycleLyricBackgroundPreset();
        scheduleWidthControlAutoHide();
    });
    updateLyricsBackgroundToggleLabel();
    window._lyricsBackgroundToggleInitialized = true;
}

function initializeLyricsDynamicThemeToggle() {
    const btn = document.getElementById('lyrics-dynamic-theme-toggle');
    if (!btn || window._lyricsDynamicThemeToggleInitialized) return;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lyricControlLabelTouched.dynamic = true;

        const enabled = getLyricDynamicThemeEnabled();
        const nextEnabled = !enabled;

        setLyricDynamicThemeEnabled(nextEnabled, { refresh: true });
        if (!nextEnabled) {
            applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
        }

        scheduleWidthControlAutoHide();
        updateLyricsDynamicThemeToggleLabel();
        updateLyricsThemeColorCycleLabel();
    });

    updateLyricsDynamicThemeToggleLabel();
    window._lyricsDynamicThemeToggleInitialized = true;
}

function initializeLyricsThemeColorCycle() {
    const btn = document.getElementById('lyrics-theme-color-cycle');
    if (!btn || window._lyricsThemeColorCycleInitialized) return;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lyricControlLabelTouched.color = true;

        currentManualLyricThemeColorIndex = (currentManualLyricThemeColorIndex + 1) % MANUAL_LYRIC_THEME_COLORS.length;

        setLyricDynamicThemeEnabled(false, { refresh: false });
        applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);

        scheduleWidthControlAutoHide();
        updateLyricsDynamicThemeToggleLabel();
        updateLyricsThemeColorCycleLabel();
    });

    updateLyricsThemeColorCycleLabel();
    window._lyricsThemeColorCycleInitialized = true;
}

// ── Lyric control module wiring callbacks ─────────────────────────────────────
function onLyricControlWheel(delta) {
    if (isDownloadMobilePreview()) return;

    if ((window.innerWidth || document.documentElement.clientWidth || 1) <= 768) {
        const baseFontSize = getResponsiveLowResBaseFontSize();
        const effectiveMaxFontSize = getResponsiveLowResMaxFontSize();
        lowResLyricFontSizeOffset = delta > 0
            ? Math.max(MIN_FONT_SIZE - baseFontSize, lowResLyricFontSizeOffset - FONT_SIZE_STEP)
            : Math.min(effectiveMaxFontSize - baseFontSize, lowResLyricFontSizeOffset + FONT_SIZE_STEP);
    } else {
        currentLyricFontSize = delta > 0
            ? Math.max(MIN_FONT_SIZE, currentLyricFontSize - FONT_SIZE_STEP)
            : Math.min(MAX_FONT_SIZE, currentLyricFontSize + FONT_SIZE_STEP);
    }

    applyLyricSizing();
    clearTimeout(window.fontSizeSaveTimeout);
    window.fontSizeSaveTimeout = setTimeout(saveSettings, 500);
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
    lyricControlLabelTouched.color = true;
    const dynamicEnabled = getLyricDynamicThemeEnabled();

    if (dynamicEnabled) {
        currentManualLyricThemeColorIndex = 0;
        setLyricDynamicThemeEnabled(false, { refresh: false });
        applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
    } else {
        const lastIndex = MANUAL_LYRIC_THEME_COLORS.length - 1;
        if (currentManualLyricThemeColorIndex >= lastIndex) {
            setLyricDynamicThemeEnabled(true, { refresh: true });
        } else {
            currentManualLyricThemeColorIndex = (currentManualLyricThemeColorIndex + 1) % MANUAL_LYRIC_THEME_COLORS.length;
            applyLyricThemeColorHex(MANUAL_LYRIC_THEME_COLORS[currentManualLyricThemeColorIndex]?.hex);
        }
    }

    updateLyricsDynamicThemeToggleLabel();
    updateLyricsThemeColorCycleLabel();
    saveSettings();
}

function toggleLyricTranslationButton() {
    lyricControlLabelTouched.translation = true;
    const order = getLyricAssistToggleOrder();
    const currentIndex = order.indexOf(normalizeLyricAssistModeForAvailableContent(currentLyricRomanizationMode));
    const nextMode = order[(currentIndex + 1) % order.length];
    applyLyricRomanizationMode(nextMode, { persist: true });
}

function updateAllLyricControlLabels() {
    updateLyricsPositionToggleLabel();
    updateLyricsDisplayModeToggleLabel();
    updateLyricsFontWeightToggleLabel();
    updateLyricsBackgroundToggleLabel();
    updateLyricsTranslationToggleLabel();
    updateLyricsDynamicThemeToggleLabel();
    updateLyricsThemeColorCycleLabel();
}

function resolveInitialBootVisibility() {
    document.body?.classList.remove('lyrics-booting');
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    if (window.__lyricsAppInitDone) return;
    if (window.__lyricsAppInitPromise) return window.__lyricsAppInitPromise;
    window.__lyricsAppInitPromise = (async () => {
        const runWelcomeInitStep = (label, fn) => {
            try {
                return fn();
            } catch (error) {
                console.warn(`[WELCOME] ${label} failed:`, error);
                return null;
            }
        };

        if (!window.electronAPI) window.electronAPI = { disableClickThrough: () => {}, enableClickThrough: () => {} };
        window.__startWelcomePlayback = () => Promise.resolve();

        // Render the static preview first so optional control setup errors cannot blank the page.
        runWelcomeInitStep('bootstrapStaticSong', bootstrapStaticSong);
        resolveInitialBootVisibility();
        runWelcomeInitStep('startProgressTracking', startProgressTracking);

        runWelcomeInitStep('applySavedSettings', applySavedSettings);
        runWelcomeInitStep('enableWelcomeHotkeyOnlyLyricControls', enableWelcomeHotkeyOnlyLyricControls);
        runWelcomeInitStep('initLyricDynamicTheme', initLyricDynamicTheme);
        runWelcomeInitStep('initializePositionToggle', initializePositionToggle);
        runWelcomeInitStep('initializeLyricsClickabilityToggle', initializeLyricsClickabilityToggle);
        // Ensure width-control sizing vars are initialized before the control panel is shown.
        runWelcomeInitStep('applyUiScale', applyUiScale);
        runWelcomeInitStep('initLyricControlPanel', () => initLyricControlPanel({
            // UI visibility (module handles show/hide + hotkey close toggle)
            setWidthControlVisible,
            setCloseWindowButtonVisible,

            // Buttons/actions
            toggleLayoutPosition,
            saveSettings,
            cycleLyricsDisplayMode,
            cycleLyricFontWeightPreset,
            cycleLyricBackgroundPreset,
            toggleLyricTranslation: toggleLyricTranslationButton,
            toggleLyricDynamicTheme: toggleLyricDynamicThemeButton,
            cycleLyricThemeColor: cycleLyricThemeColorButton,
            cycleLyricTheme: cycleLyricThemeColorButton,

            // Drag calculations
            getCurrentLayoutPosition,
            getLyricDynamicThemeEnabled,
            getMinLyricsWidthVw: () => getConfiguredLyricsMinWidthVw(),
            applyLyricsMaxWidth,
            scheduleViewportSync,
            scheduleViewportSyncAndRecenter,

            // Scroll/hotkey
            isDownloadMobilePreview,
            onLyricsWheel: (delta) => onLyricControlWheel(delta),
            hoverRevealEnabled: false,
            wheelRevealEnabled: false,
            tapRevealEnabled: false,
            autoHideEnabled: false,

            // Labels
            updateAllLabels: updateAllLyricControlLabels
        }));
        runWelcomeInitStep('initializeDynamicThemeDependentSync', initializeDynamicThemeDependentSync);
        runWelcomeInitStep('initTranslationToggleVisibilityObserver', initTranslationToggleVisibilityObserver);

        const lyricsContainer = document.getElementById('lyrics-container');
        if (lyricsContainer) lyricsContainer.classList.add('expanded');

        runWelcomeInitStep('initLyricsViewportObserver', initLyricsViewportObserver);
        runWelcomeInitStep('scheduleViewportSyncAndRecenter', scheduleViewportSyncAndRecenter);
        document.body.classList.remove('paused');
        window.__lyricsAppInitDone = true;
        resolveInitialBootVisibility();
    })();
    try {
        await window.__lyricsAppInitPromise;
    } catch (error) {
        window.__lyricsAppInitPromise = null;
        resolveInitialBootVisibility();
        throw error;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else { init(); }

window.addEventListener('resize', () => applyUiScale());
