import { buildExpressivePaletteFromImage } from './material-color-utilities.bundle.js';

let dynamicThemeState = null;

function isDynamicThemeEnabled() {
    return window.__dynamicThemeEnabled !== false;
}

function setDynamicThemeEnabledFlag(enabled) {
    window.__dynamicThemeEnabled = !!enabled;
}

function getCoverSelectors() {
    return [
        '#song-info-cover',
        '.song-info-cover',
        '[id*="song-info-cover"]',
        '[class*="song-info-cover"]',
        '[id*="cover"]',
        'img[src*="cover"]',
        'img[alt*="cover"]',
        'img[alt*="album"]'
    ];
}

function resolveCoverImageElement() {
    for (const sel of getCoverSelectors()) {
        const el = document.querySelector(sel);
        if (!el) continue;
        if (el.tagName === 'IMG') return el;

        const bgMatch = el.style.backgroundImage?.match(/url\(['"]?([^'"]+)['"]?\)/);
        if (!bgMatch) continue;

        const proxy = new Image();
        proxy.crossOrigin = 'anonymous';
        proxy.src = bgMatch[1];
        if (proxy.complete) return proxy;
    }
    return null;
}

function normalizeThemeImageSrc(src) {
    try {
        return new URL(src, window.location.href).href;
    } catch (_) {
        return String(src || '').trim();
    }
}

function findCoverImageForSrc(src) {
    const expectedSrc = normalizeThemeImageSrc(src);
    for (const selector of ['#right-now-playing-cover', '#song-info-cover', '#nowplaying-thumbnail']) {
        const image = document.querySelector(selector);
        if (!image || image.tagName !== 'IMG') continue;
        const imageSrc = normalizeThemeImageSrc(image.getAttribute('src') || image.src || '');
        if (imageSrc === expectedSrc) return image;
    }
    return null;
}

export function refreshLyricDynamicTheme(options = {}) {
    if (!isDynamicThemeEnabled()) return;
    const refresh = window.__dynamicThemeRefresh;
    if (typeof refresh !== 'function') return;
    refresh(options);
}

export function setLyricDynamicThemeEnabled(enabled, options = {}) {
    const nextEnabled = !!enabled;
    const shouldRefresh = options?.refresh !== false;

    setDynamicThemeEnabledFlag(nextEnabled);

    if (!nextEnabled) {
        const cleanup = window.__dynamicThemeCleanup;
        if (typeof cleanup === 'function') cleanup();
        return false;
    }

    initLyricDynamicTheme();
    if (shouldRefresh) {
        refreshLyricDynamicTheme(options);
    }
    return true;
}

export function toggleLyricDynamicTheme(options = {}) {
    return setLyricDynamicThemeEnabled(!isDynamicThemeEnabled(), options);
}

export function getLyricDynamicThemeEnabled() {
    return isDynamicThemeEnabled();
}

if (typeof window !== 'undefined') {
    window.setLyricDynamicThemeEnabled = setLyricDynamicThemeEnabled;
    window.toggleLyricDynamicTheme = toggleLyricDynamicTheme;
    window.getLyricDynamicThemeEnabled = getLyricDynamicThemeEnabled;
}

export function initLyricDynamicTheme() {
    if (!isDynamicThemeEnabled()) return;
    if (window.__dynamicThemeInitialized) return;
    window.__dynamicThemeInitialized = true;

    let lastImageSrc = null;
    let lastPalette = null;
    let pendingUpdate = null;
    let pendingImageSrc = null;
    let latestRequestedSrc = null;
    const PALETTE_CACHE_INDEX_KEY = 'yt-share-dynamic-palette-v2-index';
    const PALETTE_CACHE_PREFIX = 'yt-share-dynamic-palette-v2:';

    function normalizeImageSrc(src) {
        return normalizeThemeImageSrc(src);
    }

    function getPaletteCacheKey(src) {
        let hash = 2166136261;
        for (let i = 0; i < src.length; i += 1) {
            hash ^= src.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return `${PALETTE_CACHE_PREFIX}${(hash >>> 0).toString(36)}`;
    }

    function isValidPalette(palette) {
        return palette && ['primary', 'secondary', 'secVar1', 'secVar2', 'bgTint', 'onPrimary']
            .every(key => typeof palette[key] === 'string' && /^#[\da-f]{6}$/i.test(palette[key]));
    }

    function readCachedPalette(src) {
        try {
            const cached = JSON.parse(localStorage.getItem(getPaletteCacheKey(src)) || 'null');
            return cached?.src === src && isValidPalette(cached.palette) ? cached.palette : null;
        } catch (_) {
            return null;
        }
    }

    function cachePalette(src, palette) {
        try {
            const key = getPaletteCacheKey(src);
            const index = JSON.parse(localStorage.getItem(PALETTE_CACHE_INDEX_KEY) || '[]');
            const keys = Array.isArray(index) ? index.filter(item => item !== key) : [];
            keys.push(key);
            while (keys.length > 24) localStorage.removeItem(keys.shift());
            localStorage.setItem(key, JSON.stringify({ src, palette }));
            localStorage.setItem(PALETTE_CACHE_INDEX_KEY, JSON.stringify(keys));
        } catch (_) {
            // Storage may be unavailable or full; the in-memory result still applies.
        }
    }

    async function extractPalette(img) {
        if (!img || !img.complete || img.naturalWidth === 0) return null;
        try {
            return await buildExpressivePaletteFromImage(img);
        } catch (e) {
            console.error('[DynamicTheme] cover palette extraction error:', e);
            return null;
        }
    }

    function applyPalette(palette) {
        const tauri = window.__TAURI__?.core ?? window.__TAURI_INTERNALS__?.core ?? window.__TAURI__;
        const invoke = tauri?.invoke ?? tauri?.core?.invoke;
        if (typeof invoke === 'function') {
            invoke('set_theme_palette', { palette }).catch((e) =>
                console.error('[DynamicTheme] Tauri invoke error:', e)
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

    function applyPaletteFromImage(img, currentSrc, options = {}) {
        if (!img) return;

        const process = async () => {
            try {
                const palette = await extractPalette(img);
                if (!palette || !isDynamicThemeEnabled() || currentSrc !== latestRequestedSrc) return;
                const loadedSrc = normalizeImageSrc(img.currentSrc || img.src || currentSrc);
                if (loadedSrc !== currentSrc) return;
                cachePalette(currentSrc, palette);
                lastImageSrc = currentSrc;
                const key = JSON.stringify(palette);
                if (key === lastPalette) return;

                lastPalette = key;
                applyPalette(palette);

                window.dispatchEvent(new CustomEvent('dynamic-theme-change', { detail: palette }));
                if (typeof window.__dynamicThemeOnChange === 'function') {
                    window.__dynamicThemeOnChange(palette);
                }
            } finally {
                if (pendingImageSrc === currentSrc) pendingImageSrc = null;
            }
        };

        if (!img.complete) {
            img.addEventListener('load', process, { once: true });
            img.addEventListener('error', () => {
                if (pendingImageSrc === currentSrc) pendingImageSrc = null;
            }, { once: true });
        } else {
            process();
        }
    }

    function updateColorFromImage(options = {}) {
        if (!isDynamicThemeEnabled()) return;
        const explicitSrc = String(options?.imageSrc || '').trim();
        let img = null;
        let currentSrc = '';

        if (explicitSrc) {
            currentSrc = normalizeImageSrc(explicitSrc);
            img = findCoverImageForSrc(currentSrc);
            if (!img) {
                img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = explicitSrc;
            }
        } else {
            img = resolveCoverImageElement();
            if (!img) return;
            currentSrc = normalizeImageSrc(img.currentSrc || img.src || img.getAttribute?.('src') || '');
        }

        if (!currentSrc) return;
        latestRequestedSrc = currentSrc;
        if (currentSrc === lastImageSrc && lastPalette) return;
        const cachedPalette = readCachedPalette(currentSrc);
        if (cachedPalette) {
            const key = JSON.stringify(cachedPalette);
            if (key !== lastPalette) {
                lastPalette = key;
                lastImageSrc = currentSrc;
                applyPalette(cachedPalette);
                window.dispatchEvent(new CustomEvent('dynamic-theme-change', { detail: cachedPalette }));
            } else {
                lastImageSrc = currentSrc;
            }
            return;
        }
        if (currentSrc === pendingImageSrc) return;
        pendingImageSrc = currentSrc;
        applyPaletteFromImage(img, currentSrc, options);
    }

    function scheduleUpdate(delay = 120, options = {}) {
        if (!isDynamicThemeEnabled()) return;
        if (pendingUpdate) clearTimeout(pendingUpdate);
        pendingUpdate = setTimeout(() => {
            pendingUpdate = null;
            updateColorFromImage(options);
        }, delay);
    }

    dynamicThemeState = {
        refresh: updateColorFromImage,
        scheduleRefresh: scheduleUpdate
    };

    updateColorFromImage();
    window.__dynamicThemeRefresh = updateColorFromImage;
    window.__dynamicThemeScheduleRefresh = scheduleUpdate;

    window.__dynamicThemeCleanup = function cleanupDynamicTheme() {
        try {
            if (pendingUpdate) {
                clearTimeout(pendingUpdate);
                pendingUpdate = null;
            }
            document.getElementById('__dt_vars')?.remove();
            const root = document.documentElement;
            root.classList.remove(INSTANT_THEME_APPLY_CLASS);
            [
                '--text-primary', '--text-secondary',
                '--text-secondary-var1', '--text-secondary-var2',
                '--dt-primary', '--dt-secondary',
                '--dt-secondary-var1', '--dt-secondary-var2',
                '--dt-bg-tint', '--dt-on-primary'
            ].forEach((v) => root.style.removeProperty(v));
        } catch (e) {
            console.error('[DynamicTheme] cleanup error', e);
        }
        lastImageSrc = null;
        lastPalette = null;
        latestRequestedSrc = null;
        pendingImageSrc = null;
        dynamicThemeState = null;
        window.__dynamicThemeRefresh = null;
        window.__dynamicThemeScheduleRefresh = null;
        window.__dynamicThemeInitialized = false;
    };
}
