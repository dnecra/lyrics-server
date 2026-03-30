// Centralized UI wiring for the lyrics control panel.
// Keeps welcome-song.js and scripts/lyrics.js from duplicating slider/shortcut wiring.

/**
 * Injects the full #lyrics-width-control markup.
 * into document.body so it remains independent from layout-container flow.
 * Call before initLyricControlPanel.
 */
export function createLyricControlPanel() {
    if (typeof window === 'undefined') return;
    if (document.getElementById('lyrics-width-control')) {
        return; // already present (static HTML path)
    }

    // ── Width control panel ──────────────────────────────────────────────────
    const widthControl = document.createElement('div');
    widthControl.id = 'lyrics-width-control';
    widthControl.setAttribute('aria-label', 'Lyrics width control');

    // SVG icon definitions for each button
    const ICONS = {
        // Arrows pointing left/center/right — layout position
        position: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8L22 12L18 16"/><path d="M6 8L2 12L6 16"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
        // Stacked lines with varying widths — scroll vs fixed display mode
        mode: `<svg class="mode-scroll-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="22" viewBox="0 0 24 30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="5" opacity="0.32"/><line x1="5" y1="10" x2="19" y2="10" opacity="0.62"/><line x1="5" y1="15" x2="19" y2="15"/><line x1="5" y1="20" x2="19" y2="20" opacity="0.62"/><line x1="5" y1="25" x2="19" y2="25" opacity="0.32"/></svg>`,
        // Thin + thick "Aa" letterform — represents weight range
        fontWeight: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><text x="1" y="17" font-size="13" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="400" fill="currentColor" opacity="0.65">A</text><text x="10" y="18" font-size="16" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="800" fill="currentColor">A</text></svg>`,
        // Panel with a dim content area — background opacity
        background: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>`,
        // Hidden in runtime (dynamic theme is merged into the Color cycle button).
        theme: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><text x="12" y="14.8" font-size="11.8" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="700" text-anchor="middle" fill="currentColor">A</text><rect x="6.2" y="17.1" width="11.6" height="2.3" rx="1.15" fill="currentColor"/></svg>`,
        // Theme color icon (circle swatch).
        color: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="none" aria-hidden="true"><circle cx="12" cy="12" r="6.8" fill="currentColor"/><circle cx="12" cy="12" r="7.8" fill="none" stroke="rgba(255,255,255,0.72)" stroke-width="1.2"/></svg>`,
    };

    const btn = (id, ariaLabel, labelText, iconSvg) => {
        const el = document.createElement('button');
        el.id = id;
        el.type = 'button';
        el.setAttribute('aria-label', ariaLabel);
        el.innerHTML = iconSvg + `<span class="lyrics-btn-label" aria-hidden="true">${labelText}</span>`;
        return el;
    };

    const handle = (id, ariaLabel) => {
        const el = document.createElement('div');
        el.id = id;
        el.setAttribute('role', 'separator');
        el.setAttribute('aria-orientation', 'horizontal');
        el.setAttribute('aria-label', ariaLabel);
        el.setAttribute('title', ariaLabel);
        return el;
    };

    widthControl.appendChild(btn(
        'lyrics-position-toggle',
        'Switch lyrics position',
        'Position',
        ICONS.position
    ));
    widthControl.appendChild(btn(
        'lyrics-display-mode-toggle',
        'Switch lyric display mode',
        'Mode',
        ICONS.mode
    ));
    widthControl.appendChild(btn(
        'lyrics-font-weight-toggle',
        'Switch lyric font weight',
        'Weight',
        ICONS.fontWeight
    ));
    widthControl.appendChild(btn(
        'lyrics-background-toggle',
        'Switch lyric background',
        'Background',
        ICONS.background
    ));
    widthControl.appendChild(btn(
        'lyrics-dynamic-theme-toggle',
        'Cycle lyric theme',
        'Theme',
        ICONS.theme
    ));
    widthControl.appendChild(btn(
        'lyrics-theme-color-cycle',
        'Cycle fixed lyric theme color',
        'Color',
        ICONS.color
    ));
    if (!document.getElementById('lyrics-scroll-hint')) {
        const scrollHint = document.createElement('div');
        scrollHint.id = 'lyrics-scroll-hint';
        scrollHint.setAttribute('aria-hidden', 'true');
        scrollHint.innerHTML = `
            <span class="lyrics-scroll-hint-text">Scroll</span>
            <div class="lyrics-scroll-icon">
                <div class="lyrics-scroll-wheel"></div>
            </div>
            <span class="lyrics-scroll-hint-text">to adjust lyric font size</span>
        `;
        widthControl.appendChild(scrollHint);
    }
    widthControl.appendChild(handle(
        'lyrics-width-handle',
        'Drag to resize lyrics width'
    ));
    widthControl.appendChild(handle(
        'lyrics-width-handle-secondary',
        'Drag to resize lyrics width'
    ));
    document.body.appendChild(widthControl);

    // Close control (lyrics page). Keep no-op if host page already provides one.
    if (!document.getElementById('close-window-control') && !document.getElementById('close-dummy-control')) {
        const closeControl = document.createElement('div');
        closeControl.id = 'close-window-control';
        closeControl.setAttribute('aria-hidden', 'true');

        const button = document.createElement('button');
        button.id = 'close-window-btn';
        button.type = 'button';
        button.setAttribute('aria-label', 'Close Floating Lyrics');
        button.setAttribute('title', 'Close Floating Lyrics');

        const icon = document.createElement('span');
        icon.className = 'material-icons';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = 'close';

        const label = document.createElement('span');
        label.id = 'close-window-label';
        label.textContent = 'Close App';

        button.appendChild(icon);
        closeControl.appendChild(button);
        closeControl.appendChild(label);
        document.body.appendChild(closeControl);
    }

}

export function initLyricControlPanel(deps = {}) {
    if (typeof window === 'undefined') return;
    if (window._lyricControlPanelInitialized) return;

    // Generate DOM if it hasn't been provided statically in the HTML.
    createLyricControlPanel();

    const widthControl = document.getElementById('lyrics-width-control');
    if (!widthControl) return;
    const layoutContainer = document.getElementById('layout-container');
    const getCloseControl = () =>
        document.getElementById('close-window-control')
        || document.getElementById('close-dummy-control');
    const scrollHint = document.getElementById('lyrics-scroll-hint');
    const syncScrollHintMount = () => {
        if (!scrollHint) return;
        const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        const useCompactPositioning = viewportWidth <= 767;
        if (scrollHint.parentElement !== widthControl) {
            widthControl.appendChild(scrollHint);
        }
        scrollHint.classList.toggle('mobile-mounted', useCompactPositioning);
    };
    syncScrollHintMount();

    // Keep the control independent from layout-container so song-info layout
    // changes do not shift the control vertically.
    if (widthControl.parentElement !== document.body) {
        document.body.appendChild(widthControl);
    }
    if (layoutContainer) {
        layoutContainer.style.overflow = 'visible';
    }

    // Ensure correct initial alignment on first paint.
    // `#lyrics-width-control` has CSS defaults that assume "left" unless we
    // explicitly set the position classes.
    const syncPositionClasses = () => {
        if (typeof deps.getCurrentLayoutPosition !== 'function') return;
        const position = deps.getCurrentLayoutPosition();
        const isRight = position === 'right';
        const isCenter = position === 'center';
        widthControl.classList.toggle('position-right', isRight);
        widthControl.classList.toggle('position-center', isCenter);
        if (scrollHint) {
            scrollHint.classList.toggle('position-right', isRight);
            scrollHint.classList.toggle('position-center', isCenter);
        }

        const closeControl = getCloseControl();
        if (closeControl) {
            // Close button stays centered regardless of layout position.
            closeControl.classList.remove('position-right', 'position-center');
        }
    };
    syncPositionClasses();

    const positionToggle = document.getElementById('lyrics-position-toggle');
    const displayModeToggle = document.getElementById('lyrics-display-mode-toggle');
    const fontWeightToggle = document.getElementById('lyrics-font-weight-toggle');
    const backgroundToggle = document.getElementById('lyrics-background-toggle');
    const dynamicThemeToggle = document.getElementById('lyrics-dynamic-theme-toggle');
    const themeColorCycle = document.getElementById('lyrics-theme-color-cycle');

    const handleLeft = document.getElementById('lyrics-width-handle');
    const handleRight = document.getElementById('lyrics-width-handle-secondary');

    const setWidthControlVisible = typeof deps.setWidthControlVisible === 'function'
        ? deps.setWidthControlVisible
        : (visible) => widthControl.classList.toggle('show', !!visible);

    const setCloseWindowButtonVisible = typeof deps.setCloseWindowButtonVisible === 'function'
        ? deps.setCloseWindowButtonVisible
        : null;

    const scheduleWidthControlAutoHide = typeof deps.scheduleWidthControlAutoHide === 'function'
        ? deps.scheduleWidthControlAutoHide
        : null;
    const hoverBoundsElement = typeof deps.getHoverBoundsElement === 'function'
        ? (deps.getHoverBoundsElement() || layoutContainer)
        : layoutContainer;
    const getDragBoundsElement = typeof deps.getDragBoundsElement === 'function'
        ? deps.getDragBoundsElement
        : null;

    const hasTouchInput = (navigator.maxTouchPoints || 0) > 0
        || ('ontouchstart' in window);
    const ua = navigator.userAgent || '';
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const noHover = window.matchMedia?.('(hover: none)')?.matches ?? false;
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const shortestSide = Math.min(viewportWidth, viewportHeight);
    const isActualPhoneUa = /iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile/i.test(ua);
    const phoneViewport = shortestSide <= 520 || viewportWidth <= 767;
    const isMobileTapMode = isActualPhoneUa && hasTouchInput && coarsePointer && noHover && phoneViewport;
    const defaultAutoHideDelayMs = Number.isFinite(deps.autoHideDelayMs)
        ? deps.autoHideDelayMs
        : (isMobileTapMode ? 3000 : 1000);
    const syncScrollHintCopy = () => {
        if (!scrollHint) return;
        const leadingText = scrollHint.querySelector('.lyrics-scroll-hint-text');
        if (!leadingText) return;
        leadingText.textContent = isMobileTapMode ? 'Swipe' : 'Scroll';
    };
    const syncScrollHintVisibility = () => {
        if (!scrollHint) return;
        const visible = widthControl.classList.contains('show');
        scrollHint.setAttribute('aria-hidden', visible ? 'false' : 'true');
        scrollHint.classList.toggle('show', visible);
    };

    // Internal state mirrors old implementations.
    let autoHideTimeout = null;
    let isWidthShortcutHeld = false;
    let isWidthControlHovered = false;
    let lyricsWidthDragActive = false;
    let lyricsWidthDragHandleSide = null; // 'left' | 'right'
    let lyricsWidthDragBoundsRect = null;
    let isLyricsWindowHovered = false;

    const clearAutoHide = () => {
        if (autoHideTimeout) clearTimeout(autoHideTimeout);
        autoHideTimeout = null;
    };

    const hideControls = () => {
        setWidthControlVisible(false);
        if (setCloseWindowButtonVisible) setCloseWindowButtonVisible(false);
        syncScrollHintVisibility();
    };

    const showControls = () => {
        setWidthControlVisible(true);
        syncScrollHintVisibility();
    };

    const showControlsWithClose = () => {
        setWidthControlVisible(true);
        if (setCloseWindowButtonVisible) setCloseWindowButtonVisible(true);
        syncScrollHintVisibility();
    };

    const scheduleAutoHide = (delayMs = defaultAutoHideDelayMs) => {
        // If caller provided scheduling, prefer it (keeps behavior identical to existing pages).
        if (scheduleWidthControlAutoHide) {
            scheduleWidthControlAutoHide(delayMs);
            return;
        }

        clearAutoHide();
        autoHideTimeout = setTimeout(() => {
            autoHideTimeout = null;
            if (!isWidthShortcutHeld && !isWidthControlHovered && !isLyricsWindowHovered && !lyricsWidthDragActive) {
                hideControls();
            }
        }, delayMs);
    };

    const isEditableTarget = (t) => {
        try {
            return !!(t instanceof Element)
                && (!!t.closest('[contenteditable="true"]') || !!t.closest('input, textarea, select'));
        } catch (_) {
            return false;
        }
    };

    // Buttons
    const addButtonClick = (el, fn) => {
        if (!el || typeof fn !== 'function') return;
        el.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            fn();
            scheduleAutoHide();
        });
    };

    addButtonClick(positionToggle, () => {
        deps.toggleLayoutPosition?.();
        deps.saveSettings?.();
    });
    addButtonClick(displayModeToggle, () => deps.cycleLyricsDisplayMode?.());
    addButtonClick(fontWeightToggle, () => deps.cycleLyricFontWeightPreset?.());
    addButtonClick(backgroundToggle, () => deps.cycleLyricBackgroundPreset?.());
    const syncThemePresetEnabledState = () => {
        if (dynamicThemeToggle) {
            dynamicThemeToggle.hidden = true;
            dynamicThemeToggle.style.display = 'none';
            dynamicThemeToggle.setAttribute('aria-hidden', 'true');
        }
        if (!themeColorCycle) return;
        themeColorCycle.disabled = false;
        themeColorCycle.setAttribute('aria-disabled', 'false');
        themeColorCycle.hidden = false;
        themeColorCycle.style.display = '';
        themeColorCycle.setAttribute('aria-hidden', 'false');
    };

    if (dynamicThemeToggle) {
        dynamicThemeToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            deps.toggleLyricDynamicTheme?.();
            syncThemePresetEnabledState();
            scheduleAutoHide();
        });
    }

    if (themeColorCycle) {
        themeColorCycle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof deps.cycleLyricTheme === 'function') {
                deps.cycleLyricTheme();
            } else {
                deps.cycleLyricThemeColor?.();
            }
            syncThemePresetEnabledState();
            scheduleAutoHide();
        });
    }

    // Ensure initial labels match current state.
    deps.updateAllLabels?.();
    syncScrollHintMount();
    syncThemePresetEnabledState();
    syncScrollHintCopy();
    syncScrollHintVisibility();
    if (widthControl && !window._lyricControlPanelPositionObserverInitialized) {
        const observer = new MutationObserver(() => {
            syncPositionClasses();
            syncScrollHintVisibility();
        });
        observer.observe(widthControl, { attributes: true, attributeFilter: ['class'] });
        window._lyricControlPanelPositionObserverInitialized = true;
    }
    window.addEventListener('resize', syncScrollHintMount, { passive: true });
    window.addEventListener('orientationchange', syncScrollHintMount, { passive: true });

    // Width slider drag
    const handles = [handleLeft, handleRight].filter(Boolean);

    const getPositionFromLayout = () => {
        // Prefer explicit callback to avoid coupling to DOM/class structure.
        if (typeof deps.getCurrentLayoutPosition === 'function') return deps.getCurrentLayoutPosition();
        const layoutContainer = document.getElementById('layout-container');
        if (!layoutContainer) return 'left';
        if (layoutContainer.classList.contains('position-right')) return 'right';
        if (layoutContainer.classList.contains('position-center')) return 'center';
        return 'left';
    };

    const getMinLyricsWidthVw = (viewportWidth) => {
        if (typeof deps.getMinLyricsWidthVw === 'function') return deps.getMinLyricsWidthVw(viewportWidth);
        if (viewportWidth <= 767) return 20;
        return 10;
    };

    const getDragBoundsRect = () => {
        const candidate = getDragBoundsElement?.() || layoutContainer || document.documentElement;
        const rect = candidate?.getBoundingClientRect?.();
        if (rect && rect.width > 0) return rect;
        return document.documentElement.getBoundingClientRect();
    };

    const beginDrag = (event, handle) => {
        const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        if (viewportWidth <= 767) return;

        event.preventDefault();
        event.stopPropagation();

        lyricsWidthDragActive = true;
        lyricsWidthDragHandleSide = handle?.id === 'lyrics-width-handle-secondary' ? 'right' : 'left';
        lyricsWidthDragBoundsRect = getDragBoundsRect();

        clearAutoHide();
        showControls();

        // Keep layout interactive during drag (matches old behavior).
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
        lyricsWidthDragBoundsRect = null;

        deps.scheduleViewportSyncAndRecenter?.();
        deps.saveSettings?.();
        scheduleAutoHide();
    };

    const updateDrag = (event) => {
        if (!lyricsWidthDragActive) return;

        const lc = document.getElementById('layout-container');
        const position = getPositionFromLayout(lc);

        const pointerX = Number(event.clientX);
        if (!Number.isFinite(pointerX)) return;

        const boundsRect = lyricsWidthDragBoundsRect || getDragBoundsRect();
        const boundsLeft = Number(boundsRect.left) || 0;
        const boundsRight = Number(boundsRect.right) || (boundsLeft + 1);
        const boundsWidth = Math.max(1, boundsRight - boundsLeft);
        const minWidthPx = (() => {
            const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lyrics-min-width-px'));
            return Number.isFinite(raw) && raw > 0 ? raw : 128;
        })();

        const widthPx = position === 'right'
            ? (boundsRight - pointerX)
            : position === 'center'
                ? (() => {
                    const halfMin = minWidthPx / 2;
                    const centerX = boundsLeft + (boundsWidth / 2);
                    if (lyricsWidthDragHandleSide === 'right') {
                        const clampedPointerX = Math.max(centerX + halfMin, pointerX);
                        return Math.max(minWidthPx, (clampedPointerX - centerX) * 2);
                    }
                    const clampedPointerX = Math.min(centerX - halfMin, pointerX);
                    return Math.max(minWidthPx, (centerX - clampedPointerX) * 2);
                })()
                : (pointerX - boundsLeft);

        deps.applyLyricsMaxWidth?.((widthPx / boundsWidth) * 100);
        deps.scheduleViewportSync?.();
    };

    handles.forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            beginDrag(e, handle);
            try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        });
    });

    window.addEventListener('pointermove', updateDrag, { passive: true });
    window.addEventListener('pointerup', endDrag, { passive: true });
    window.addEventListener('pointercancel', endDrag, { passive: true });
    window.addEventListener('blur', endDrag);

    // Hover tracking for auto-hide (desktop).
    widthControl.addEventListener('pointerenter', () => {
        isWidthControlHovered = true;
        clearAutoHide();
    });
    widthControl.addEventListener('pointerleave', () => {
        isWidthControlHovered = false;
        if (!lyricsWidthDragActive) scheduleAutoHide(1000);
    });

    // Keep controls visible while the pointer is inside the layout container.
    const onLyricsWindowEnter = () => {
        if (isLyricsWindowHovered) return;
        isLyricsWindowHovered = true;
        clearAutoHide();
        showControls();
    };

    const onLyricsWindowLeave = () => {
        if (!isLyricsWindowHovered) return;
        isLyricsWindowHovered = false;
        // If the pointer is leaving the whole app area, delay slightly before hiding.
        if (!isWidthControlHovered && !lyricsWidthDragActive && !isWidthShortcutHeld) {
            scheduleAutoHide(1000);
        }
    };

    if (isMobileTapMode) {
        if (hoverBoundsElement instanceof HTMLElement) {
            hoverBoundsElement.style.touchAction = 'none';
            hoverBoundsElement.style.overscrollBehavior = 'none';
        }
        let tapPointerId = null;
        let tapStartX = 0;
        let tapStartY = 0;
        let tapMoved = false;
        let swipeActive = false;
        let swipeLastFontStepY = 0;
        let pointerActiveInBounds = false;
        const TAP_MOVE_TOLERANCE = 10;
        const FONT_SWIPE_STEP_PX = 16;
        const tapBoundsElement = hoverBoundsElement || layoutContainer || document.documentElement;
        const isWithinBounds = (x, y) => {
            const rect = tapBoundsElement?.getBoundingClientRect?.();
            if (!rect) return false;
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        };

        window.addEventListener('pointerdown', (event) => {
            if (!event.isPrimary) return;
            if (event?.target instanceof Element && event.target.closest('#lyrics-width-control')) {
                tapPointerId = null;
                tapMoved = false;
                pointerActiveInBounds = false;
                return;
            }
            tapPointerId = event.pointerId;
            tapStartX = event.clientX;
            tapStartY = event.clientY;
            tapMoved = false;
            swipeActive = false;
            swipeLastFontStepY = event.clientY;
            pointerActiveInBounds = isWithinBounds(event.clientX, event.clientY);
        }, { passive: true, capture: true });

        window.addEventListener('pointermove', (event) => {
            if (tapPointerId == null || event.pointerId !== tapPointerId) return;
            const dx = event.clientX - tapStartX;
            const dyFromStart = event.clientY - tapStartY;
            if (!tapMoved && Math.hypot(dx, dyFromStart) > TAP_MOVE_TOLERANCE) tapMoved = true;
            if (!pointerActiveInBounds || !Number.isFinite(event.clientY)) return;

            const shouldStartSwipe = Math.abs(dyFromStart) > TAP_MOVE_TOLERANCE;
            if (!swipeActive && shouldStartSwipe) {
                swipeActive = true;
                swipeLastFontStepY = tapStartY;
                showControls();
                scheduleAutoHide(3000);
            }

            if (!swipeActive || typeof deps.onLyricsWheel !== 'function') return;

            let deltaFromStep = event.clientY - swipeLastFontStepY;
            while (Math.abs(deltaFromStep) >= FONT_SWIPE_STEP_PX) {
                const stepDelta = deltaFromStep > 0 ? 1 : -1;
                deps.onLyricsWheel(stepDelta, event);
                swipeLastFontStepY += FONT_SWIPE_STEP_PX * Math.sign(deltaFromStep);
                deltaFromStep = event.clientY - swipeLastFontStepY;
            }
        }, { passive: true, capture: true });

        const finalizeTap = (event) => {
            if (tapPointerId == null || event.pointerId !== tapPointerId) return;
            const shouldToggle = !tapMoved;
            const endedInBounds = isWithinBounds(event.clientX, event.clientY);
            const shouldHandleTap = pointerActiveInBounds && endedInBounds;
            tapPointerId = null;
            tapMoved = false;
            swipeActive = false;
            swipeLastFontStepY = 0;
            pointerActiveInBounds = false;
            if (!shouldToggle || !shouldHandleTap) return;
            const isVisible = widthControl.classList.contains('show');
            if (isVisible) {
                clearAutoHide();
                hideControls();
            } else {
                showControls();
                scheduleAutoHide(3000);
            }
        };

        window.addEventListener('pointerup', finalizeTap, { passive: true, capture: true });
        window.addEventListener('pointercancel', (event) => {
            if (tapPointerId != null && event.pointerId === tapPointerId) {
                tapPointerId = null;
                tapMoved = false;
                swipeActive = false;
                swipeLastFontStepY = 0;
                pointerActiveInBounds = false;
            }
        }, { passive: true, capture: true });
    } else if (hoverBoundsElement) {
        const isPointWithinRect = (x, y, rect) => (
            rect
            && x >= rect.left
            && x <= rect.right
            && y >= rect.top
            && y <= rect.bottom
        );

        window.addEventListener('pointermove', (event) => {
            const rect = hoverBoundsElement.getBoundingClientRect();
            if (isPointWithinRect(event.clientX, event.clientY, rect)) {
                onLyricsWindowEnter();
            } else {
                onLyricsWindowLeave();
            }
        }, { passive: true });

        hoverBoundsElement.addEventListener('pointerenter', onLyricsWindowEnter);
        hoverBoundsElement.addEventListener('pointerleave', onLyricsWindowLeave);
    } else {
        // Fallback for pages without #layout-container.
        document.addEventListener('pointermove', onLyricsWindowEnter, true);
        document.addEventListener('pointerenter', onLyricsWindowEnter, true);
        document.addEventListener('mouseleave', onLyricsWindowLeave, true);
    }
    window.addEventListener('blur', onLyricsWindowLeave);

    // Hotkey (F + Alt + Shift)
    let pressedCodes = new Set();
    const isComboHeld = () =>
        pressedCodes.has('KeyF')
        && (pressedCodes.has('AltLeft') || pressedCodes.has('AltRight'))
        && (pressedCodes.has('ShiftLeft') || pressedCodes.has('ShiftRight'))
        && !pressedCodes.has('ControlLeft') && !pressedCodes.has('ControlRight')
        && !pressedCodes.has('MetaLeft') && !pressedCodes.has('MetaRight');

    const clearUi = () => {
        pressedCodes = new Set();
        isWidthShortcutHeld = false;
        hideControls();
    };

    document.addEventListener('keydown', (e) => {
        pressedCodes.add(e.code);
        if (isEditableTarget(e.target)) return;

        if (!isComboHeld()) {
            if (isWidthShortcutHeld) clearUi();
            return;
        }

        e.preventDefault();
        isWidthShortcutHeld = true;
        clearAutoHide();
        showControlsWithClose();
    }, true);

    document.addEventListener('keyup', (e) => {
        pressedCodes.delete(e.code);
        if (!isWidthShortcutHeld) return;
        if (isComboHeld()) return;
        e.preventDefault();
        clearUi();
    }, true);

    window.addEventListener('blur', clearUi);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearUi();
    });

    // Wheel font-size / scroll control
    if (typeof deps.onLyricsWheel === 'function') {
        document.addEventListener('wheel', (event) => {
            if (typeof deps.isDownloadMobilePreview === 'function' && deps.isDownloadMobilePreview()) return;
            event.preventDefault();
            event.stopPropagation();

            const delta = event.deltaY || event.detail || -event.wheelDelta;
            // Show controls on wheel, like the welcome page behavior.
            showControls();
            scheduleAutoHide();

            const layoutContainer = document.getElementById('layout-container');
            if (layoutContainer) {
                layoutContainer.style.opacity = '1';
                layoutContainer.style.pointerEvents = 'auto';
            }

            deps.onLyricsWheel(delta, event);
        }, { passive: false, capture: true });
    }

    window._lyricControlPanelInitialized = true;
}

// Shared responsive heuristic so welcome and lyrics pages behave consistently.
export function isPhoneLayoutEnvironment() {
    const ua = navigator.userAgent || '';
    const isPhoneUa = /iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile/i.test(ua);
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const noHover = window.matchMedia?.('(hover: none)')?.matches ?? false;
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const shortestSide = Math.min(viewportWidth, viewportHeight);
    const phoneViewport = shortestSide <= 520 || viewportWidth <= 767;

    // Treat as phone layout only on actual phone devices with phone-sized viewports.
    return isPhoneUa && coarsePointer && noHover && phoneViewport;
}

// Default lyric-control state values (shared by /lyrics and /welcome).
export const DEFAULT_FONT_SIZE = 32;
export const MIN_FONT_SIZE = 16;
export const MAX_FONT_SIZE = 128;
export const FONT_SIZE_STEP = 4;

export const MIN_LYRICS_WIDTH_VW = 25;
export const MIN_LYRICS_WIDTH_VW_LOW_RES = 25;
export const MAX_LYRICS_WIDTH_VW = 98;
export const DEFAULT_LYRICS_WIDTH_VW = 25;

export const DEFAULT_LYRIC_DISPLAY_MODE = 'scroll';
export const LYRIC_DISPLAY_MODE_LABELS = {
    scroll: 'Scroll',
    'fixed-3': 'Triple Lines',
    'fixed-2': 'Double Lines',
    'fixed-1': 'Single Line'
};
export const LYRIC_DISPLAY_MODE_VISIBLE_LINES = {
    scroll: 3,
    'fixed-3': 3,
    'fixed-2': 2,
    'fixed-1': 1
};
export const LYRIC_DISPLAY_MODE_ORDER = ['scroll', 'fixed-3', 'fixed-2', 'fixed-1'];

export const LYRIC_FONT_WEIGHT_PRESETS = {
    thin: { label: 'Thin', inactive: 400, active: 500 },
    regular: { label: 'Regular', inactive: 500, active: 600 },
    bold: { label: 'Bold', inactive: 700, active: 800 }
};
export const LYRIC_FONT_WEIGHT_ORDER = ['thin', 'regular', 'bold'];

export const LYRIC_BACKGROUND_PRESETS = {
    none: { label: 'None', value: 'transparent' },
    solid: { label: 'Black Background', value: 'rgba(18, 18, 18, 1)' },
    dynamic: { label: 'Dynamic Background', value: null }
};
export const DEFAULT_LYRIC_BACKGROUND_PRESET = 'dynamic';
export const LYRIC_BACKGROUND_ORDER = ['none', 'solid', 'dynamic'];

export const LAYOUT_POSITION_ORDER = ['left', 'center', 'right'];
export const LAYOUT_POSITION_LABELS = {
    left: 'Left',
    center: 'Center',
    right: 'Right'
};
