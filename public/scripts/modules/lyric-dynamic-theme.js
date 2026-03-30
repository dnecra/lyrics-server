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

    window.__dynamicThemeTimeoutIds = window.__dynamicThemeTimeoutIds || [];

    let lastImageSrc = null;
    let lastPalette = null;
    let pendingUpdate = null;

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map((x) => {
            const h = Math.round(Math.min(255, Math.max(0, x))).toString(16);
            return h.length === 1 ? `0${h}` : h;
        }).join('');
    }

    function rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                    break;
                case g:
                    h = ((b - r) / d + 2) / 6;
                    break;
                default:
                    h = ((r - g) / d + 4) / 6;
                    break;
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

    function rgbToHsv(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        const s = max === 0 ? 0 : d / max;
        const v = max;

        if (d !== 0) {
            switch (max) {
                case r:
                    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                    break;
                case g:
                    h = ((b - r) / d + 2) / 6;
                    break;
                default:
                    h = ((r - g) / d + 4) / 6;
                    break;
            }
        }

        return [h * 360, s, v];
    }

    function hsvToRgb(h, s, v) {
        h /= 60;
        const c = v * s;
        const x = c * (1 - Math.abs((h % 2) - 1));
        const m = v - c;
        let r1 = 0;
        let g1 = 0;
        let b1 = 0;

        if (h >= 0 && h < 1) [r1, g1, b1] = [c, x, 0];
        else if (h < 2) [r1, g1, b1] = [x, c, 0];
        else if (h < 3) [r1, g1, b1] = [0, c, x];
        else if (h < 4) [r1, g1, b1] = [0, x, c];
        else if (h < 5) [r1, g1, b1] = [x, 0, c];
        else [r1, g1, b1] = [c, 0, x];

        return [
            Math.round((r1 + m) * 255),
            Math.round((g1 + m) * 255),
            Math.round((b1 + m) * 255)
        ];
    }

    function luminance(r, g, b) {
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    function clampColor(r, g, b, { minL = 0.28, maxL = 0.78, minS = 0.30 } = {}) {
        let [h, s, l] = rgbToHsl(r, g, b);
        s = Math.max(s, minS);
        l = Math.min(maxL, Math.max(minL, l));
        return hslToRgb(h, s, l);
    }

    function liftColorValue(r, g, b, { minLuma = 0.42, boost = 0.22, maxV = 0.82 } = {}) {
        let [h, s, v] = rgbToHsv(r, g, b);
        const currentLuma = luminance(r, g, b);
        if (currentLuma < minLuma) {
            const deficit = minLuma - currentLuma;
            v = Math.min(maxV, v + (deficit * (1 + boost)));
        }
        return hsvToRgb(h, s, v);
    }

    function getCanvasData(img) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxSize = 180;
        const scale = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1);
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }

    function extractAverageColor(data) {
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;
            const [,, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            if (l < 0.18 || l > 0.95) continue;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count += 1;
        }
        if (count === 0) return null;
        return { r: r / count, g: g / count, b: b / count };
    }

    function detectNearWhiteAverage(data) {
        let totalCount = 0;
        let neutralCount = 0;
        let brightCount = 0;
        let eligibleCount = 0;
        let accentCount = 0;
        let r = 0;
        let g = 0;
        let b = 0;

        for (let i = 0; i < data.length; i += 8) {
            if (data[i + 3] < 128) continue;
            totalCount += 1;
            const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            if (s <= 0.18 && l >= 0.08) {
                neutralCount += 1;
            }
            if (s >= 0.28 && l >= 0.2) {
                accentCount += 1;
            }
            if (l < 0.75) continue;
            eligibleCount += 1;
            if (l >= 0.88 && s <= 0.18) {
                brightCount += 1;
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
            }
        }

        const brightNeutralShare = eligibleCount ? (brightCount / eligibleCount) : 0;
        const neutralShare = totalCount ? (neutralCount / totalCount) : 0;
        const accentShare = totalCount ? (accentCount / totalCount) : 0;
        const isMostlyWhite = brightNeutralShare >= 0.72;
        const isMostlyNeutralMonochrome = neutralShare >= 0.78 && brightCount >= 12 && accentShare <= 0.12;

        if (!isMostlyWhite && !isMostlyNeutralMonochrome) return null;
        if (!brightCount) return { r: 245, g: 245, b: 245 };
        return { r: r / brightCount, g: g / brightCount, b: b / brightCount };
    }

    function extractDominantColor(data) {
        const HUE_BUCKETS = 12;
        const LUM_BUCKETS = 3;
        const buckets = Array.from(
            { length: HUE_BUCKETS * LUM_BUCKETS },
            () => ({ r: 0, g: 0, b: 0, weight: 0 })
        );

        for (let i = 0; i < data.length; i += 12) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a < 128) continue;

            const [h, s, l] = rgbToHsl(r, g, b);
            if (l < 0.14 || l > 0.95) continue;

            const hIdx = Math.min(HUE_BUCKETS - 1, Math.floor((h / 360) * HUE_BUCKETS));
            const lIdx = l < 0.35 ? 0 : l < 0.65 ? 1 : 2;
            const idx = hIdx * LUM_BUCKETS + lIdx;

            // Favor bright vivid accent regions over large dark background fields.
            const vividness = Math.max(s, 0.05);
            const brightnessBoost = Math.max(0, l - 0.18);
            const w = 0.5 + (vividness * 3.2) + (brightnessBoost * 4.5);
            buckets[idx].r += r * w;
            buckets[idx].g += g * w;
            buckets[idx].b += b * w;
            buckets[idx].weight += w;
        }

        let best = null;
        for (const bucket of buckets) {
            if (!best || bucket.weight > best.weight) best = bucket;
        }
        if (!best || best.weight === 0) return null;

        return {
            r: best.r / best.weight,
            g: best.g / best.weight,
            b: best.b / best.weight
        };
    }

    function blendColors(dominant, average) {
        return {
            r: dominant.r * 0.85 + average.r * 0.15,
            g: dominant.g * 0.85 + average.g * 0.15,
            b: dominant.b * 0.85 + average.b * 0.15
        };
    }

    function extractBlendedColor(img) {
        if (!img || !img.complete || img.naturalWidth === 0) return null;
        try {
            const data = getCanvasData(img);
            const nearWhite = detectNearWhiteAverage(data);
            if (nearWhite) return nearWhite;
            const dominant = extractDominantColor(data);
            const average = extractAverageColor(data);
            if (!dominant && !average) return null;
            if (!dominant) return average;
            if (!average) return dominant;
            return blendColors(dominant, average);
        } catch (e) {
            console.error('[DynamicTheme] extraction error:', e);
            return null;
        }
    }

    function buildPalette(r, g, b) {
        const [h, s] = rgbToHsl(r, g, b);

        let [pr, pg, pb] = clampColor(r, g, b, { minL: 0.28, maxL: 0.78, minS: 0.30 });
        [pr, pg, pb] = liftColorValue(pr, pg, pb, { minLuma: 0.42, boost: 0.22, maxV: 0.82 });
        const primaryL = rgbToHsl(pr, pg, pb)[2];

        const [sr, sg, sb] = hslToRgb(h, Math.min(1, s * 0.75), primaryL * 0.50);
        const [v1r, v1g, v1b] = hslToRgb(h, Math.min(1, s * 0.25), Math.min(0.93, primaryL * 0.75));
        const [v2r, v2g, v2b] = hslToRgb(h, Math.min(1, s * 0.125), primaryL * 0.50);
        const [br, bg2, bb] = hslToRgb(h, Math.min(1, s * 0.125), primaryL * 0.05);

        const onPrimary = luminance(pr, pg, pb) > 0.55 ? '#1a1a1a' : '#f5f5f5';

        return {
            primary: rgbToHex(pr, pg, pb),
            secondary: rgbToHex(sr, sg, sb),
            secVar1: rgbToHex(v1r, v1g, v1b),
            secVar2: rgbToHex(v2r, v2g, v2b),
            bgTint: rgbToHex(br, bg2, bb),
            onPrimary
        };
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

        const process = () => {
            const raw = extractBlendedColor(img);
            if (!raw) return;

            const palette = buildPalette(raw.r, raw.g, raw.b);
            const key = JSON.stringify(palette);
            if (key === lastPalette) return;

            lastPalette = key;
            lastImageSrc = currentSrc;
            applyPalette(palette);

            if (typeof window.__dynamicThemeOnChange === 'function') {
                window.__dynamicThemeOnChange(palette);
            }
        };

        if (!img.complete) {
            img.addEventListener('load', process, { once: true });
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
            currentSrc = explicitSrc;
            img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = explicitSrc;
        } else {
            img = resolveCoverImageElement();
            if (!img) return;
            currentSrc = img.currentSrc || img.src || img.getAttribute?.('src') || '';
        }

        if (!currentSrc) return;
        if (currentSrc === lastImageSrc && lastPalette) return;
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

    const observer = new MutationObserver(() => scheduleUpdate(120));
    window.__dynamicThemeObserver = observer;

    function startObserver() {
        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'style', 'class']
            });
        } else {
            requestAnimationFrame(startObserver);
        }
    }
    startObserver();

    dynamicThemeState = {
        refresh: updateColorFromImage,
        scheduleRefresh: scheduleUpdate
    };

    updateColorFromImage();
    window.__dynamicThemeTimeoutIds.push(setTimeout(updateColorFromImage, 500));
    window.__dynamicThemeTimeoutIds.push(setTimeout(updateColorFromImage, 1500));
    window.__dynamicThemeRefresh = updateColorFromImage;
    window.__dynamicThemeScheduleRefresh = scheduleUpdate;

    window.__dynamicThemeCleanup = function cleanupDynamicTheme() {
        try {
            for (const id of (window.__dynamicThemeTimeoutIds || [])) {
                try { clearTimeout(id); } catch (_) {}
            }
            window.__dynamicThemeTimeoutIds = [];
            if (pendingUpdate) {
                clearTimeout(pendingUpdate);
                pendingUpdate = null;
            }
            if (window.__dynamicThemeObserver) {
                try { window.__dynamicThemeObserver.disconnect(); } catch (_) {}
                window.__dynamicThemeObserver = null;
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
        dynamicThemeState = null;
        window.__dynamicThemeRefresh = null;
        window.__dynamicThemeScheduleRefresh = null;
        window.__dynamicThemeInitialized = false;
    };
}
