// welcome-tour.js

const STEPS = ['splash','shortcut','font-size','width','mode','position','close','tray'];
const HOTKEY_GATED_STEPS = new Set(['shortcut', 'font-size', 'width', 'mode', 'position', 'close']);
const SPLASH_AUTO_START_MS = 3000;
const TRAY_SKIP_MS = 5000;
const EXIT_FADE_MS = 260;
let step = 0;
let shortcutDone = false;
let modeTaps = 0;
let dim, row, guide, pin, arrowEl, hotkeyReminderEl;
let spotClean = null, arrowTick = null;
let stepCleanup = null;
const heldKeys = new Set();
let hotkeyHeld = false;
let windowPos = null; // shared position for all floating windows

function ensureOrthoArrowMarkup(el) {
  if (!el) return;
  if (el.querySelector('.wt-arrow-svg') && el.querySelector('.wt-arrow-head')) return;
  el.innerHTML = `
    <svg class="wt-arrow-svg" aria-hidden="true">
      <path class="wt-arrow-path"></path>
    </svg>
    <span class="wt-arrow-head"></span>
  `;
}

function drawOrthoArrow(el, sx, sy, ex, ey) {
  if (!el) return;
  ensureOrthoArrowMarkup(el);
  const svg = el.querySelector('.wt-arrow-svg');
  const path = el.querySelector('.wt-arrow-path');
  const head = el.querySelector('.wt-arrow-head');
  if (!svg || !path || !head) return;

  const dx = ex - sx;
  const dy = ey - sy;
  const manhattan = Math.abs(dx) + Math.abs(dy);
  if (manhattan < 16) {
    el.classList.remove('visible');
    return;
  }

  const hSign = dx >= 0 ? 1 : -1;
  const vSign = dy >= 0 ? 1 : -1;
  const maxR = Math.min(18, Math.abs(dx) / 2, Math.abs(dy) / 2);
  const r = Number.isFinite(maxR) ? Math.max(0, maxR) : 0;
  const cornerX = ex;
  const preX = cornerX - (hSign * r);
  const postY = sy + (vSign * r);

  svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  svg.setAttribute('width', String(window.innerWidth));
  svg.setAttribute('height', String(window.innerHeight));

  const d = r > 0
    ? `M ${sx} ${sy} L ${preX} ${sy} Q ${cornerX} ${sy} ${cornerX} ${postY} L ${ex} ${ey}`
    : `M ${sx} ${sy} L ${cornerX} ${sy} L ${ex} ${ey}`;
  path.setAttribute('d', d);

  head.style.left = `${ex}px`;
  head.style.top = `${ey}px`;
  const verticalTerminal = Math.abs(dy) > 1;
  const rotation = verticalTerminal
    ? (vSign > 0 ? 90 : -90)
    : (hSign > 0 ? 0 : 180);
  head.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
  el.classList.add('visible');
}



function dismissWelcomeTour() {
  document.getElementById('wt-tray-scene')?.remove();
  delete window.__wtDismissTrayScene;
  document.body.classList.remove('wt-splash-active');
  document.getElementById('wt-splash')?.remove();
  document.getElementById('skip-welcome-btn')?.remove();
  document.getElementById('close-dummy-control')?.remove();
  const layoutContainer = document.getElementById('layout-container');
  if (layoutContainer) {
    layoutContainer.style.removeProperty('display');
  }
  if (typeof window.__welcomeHideControllerUi === 'function') {
    window.__welcomeHideControllerUi();
  }
  arrowEl?.remove();
  dim?.remove();
  row?.remove();
}

function startGraphicCountdown(el, durationMs) {
  if (!el) return () => {};
  const progress = el.querySelector('.wt-timer-progress');
  if (!progress) return () => {};
  el.style.setProperty('--wt-mini-duration', `${durationMs}ms`);
  progress.style.animation = 'none';
  void progress.offsetHeight;
  progress.style.animation = '';
  el.classList.add('is-running');
  return () => {
    el.classList.remove('is-running');
    progress.style.animation = 'none';
  };
}

function exitWelcomeTour({ smooth = true } = {}) {
  const finish = () => {
    dismissWelcomeTour();
  };
  if (!smooth) {
    finish();
    return;
  }

  const splash = document.getElementById('wt-splash');
  const skipBtn = document.getElementById('skip-welcome-btn');
  const closeBtn = document.getElementById('close-dummy-control');
  if (skipBtn) skipBtn.classList.remove('show');
  if (closeBtn) closeBtn.classList.remove('show');
  if (splash) {
    splash.style.transition = `opacity ${EXIT_FADE_MS}ms ease`;
    splash.style.opacity = '0';
  }
  if (dim) {
    dim.style.transition = `opacity ${EXIT_FADE_MS}ms ease`;
    dim.style.opacity = '0';
  }
  setTimeout(finish, EXIT_FADE_MS);
}

function ensureSkipGuideButton() {
  let btn = document.getElementById('skip-welcome-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'skip-welcome-btn';
    btn.type = 'button';
    btn.className = 'wt-start-btn wt-skip-guide-floating';
    btn.setAttribute('aria-label', 'Skip guide');
    btn.setAttribute('title', 'Skip guide');
    btn.setAttribute('data-label', 'Skip Guide');
    btn.innerHTML = '<span class="material-icons" aria-hidden="true">skip_next</span>';
    btn.addEventListener('click', () => exitWelcomeTour());
    document.body.appendChild(btn);
  }
  return btn;
}

function ensureDummyCloseButton() {
  let control = document.getElementById('close-dummy-control');
  if (!control) {
    control = document.createElement('div');
    control.id = 'close-dummy-control';
    control.className = 'wt-tour-close-control';
    control.setAttribute('aria-hidden', 'true');
    control.innerHTML = `
      <button id="close-dummy-btn" type="button" aria-label="Close Floating Lyrics" title="Close Floating Lyrics">
        <span class="material-icons" aria-hidden="true">close</span>
      </button>
      <span id="close-window-label">Close App</span>
    `;
    const btn = control.querySelector('#close-dummy-btn');
    btn?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    document.body.appendChild(control);
  }
  return control;
}

function syncSkipButtonVisibility() {
  const btn = document.getElementById('skip-welcome-btn');
  if (!btn) return;
  btn.classList.add('show');
}

function kbFocus(on) {}
function guideFocus(on) {
  if (on) row.classList.add('guide-focus');
  else    row.classList.remove('guide-focus');
}

function isAllThreeHeld() {
  return (
    (heldKeys.has('AltLeft') || heldKeys.has('AltRight')) &&
    (heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight')) &&
    heldKeys.has('KeyF')
  );
}

function isHotkeyPartHeld(part) {
  if (part === 'alt') return heldKeys.has('AltLeft') || heldKeys.has('AltRight');
  if (part === 'shift') return heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight');
  if (part === 'f') return heldKeys.has('KeyF');
  return false;
}

function syncHotkeyKeycaps() {
  document.querySelectorAll('[data-hotkey]').forEach((el) => {
    const part = (el.getAttribute('data-hotkey') || '').trim().toLowerCase();
    el.classList.toggle('is-pressed', isHotkeyPartHeld(part));
  });
}

function isHotkeyGatedStep() {
  return HOTKEY_GATED_STEPS.has(STEPS[step]);
}

function syncHotkeyGuideState() {
  if (!isHotkeyGatedStep()) {
    guideFocus(false);
    row.classList.remove('reminder-focus', 'dual-focus', 'hotkey-held');
    return;
  }

  row.classList.toggle('hotkey-held', !!hotkeyHeld);

  if (STEPS[step] === 'shortcut') {
    guideFocus(true);
    row.classList.toggle('reminder-focus', !hotkeyHeld);
    row.classList.toggle('dual-focus', !hotkeyHeld);
  } else {
    guideFocus(hotkeyHeld);
    row.classList.toggle('reminder-focus', !hotkeyHeld);
    row.classList.remove('dual-focus');
  }
}

// ─── shared drag helper ───────────────────────────────────────────────────────
// windowPos stores the CENTER of the window in viewport coords.
// All windows use translate(-50%,-50%) from their stored center — no size dependency.
function applyWindowPos(target, pos) {
  if (!pos || !target) return;
  target.style.left      = pos.cx + 'px';
  target.style.top       = pos.cy + 'px';
  target.style.transform = 'translate(-50%, -50%)';
  target.style.transition = 'none';
}

function makeDraggable(handle, target) {
  if (!handle || !target) return;
  let dragging = false, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.wt-titlebar-skip')) return;
    dragging = true;
    const r = target.getBoundingClientRect();
    // Offset from cursor to center of window
    ox = e.clientX - (r.left + r.width  / 2);
    oy = e.clientY - (r.top  + r.height / 2);
    handle.setPointerCapture(e.pointerId);
    target.style.transition = 'none';
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const cx = e.clientX - ox;
    const cy = e.clientY - oy;
    target.style.left      = cx + 'px';
    target.style.top       = cy + 'px';
    target.style.transform = 'translate(-50%, -50%)';
    windowPos = { cx, cy };
  });
  handle.addEventListener('pointerup',     () => { dragging = false; });
  handle.addEventListener('pointercancel', () => { dragging = false; });
}

// ─── boot ─────────────────────────────────────────────────────────────────────
function boot() {
  dim = document.createElement('div');
  dim.id = 'wt-dim';
  document.body.insertBefore(dim, document.body.firstChild);

  row = document.createElement('div');
  row.id = 'wt-row';
  row.className = 'hidden';
  document.body.appendChild(row);

  guide = document.createElement('div');
  guide.id = 'wt-guide';
  row.appendChild(guide);

  // Titlebar — 1 red dot top-right = skip/close
  const titlebar = document.createElement('div');
  titlebar.id = 'wt-titlebar';
  titlebar.innerHTML = `
    <span class="wt-titlebar-label">floating-lyrics</span>
    <button class="wt-titlebar-skip" id="wt-titlebar-skip" type="button" aria-label="Skip step" title="Skip step">
      <span></span>
    </button>
  `;
  guide.appendChild(titlebar);
  makeDraggable(titlebar, guide);

  // Hotkey reminder — SEPARATE floating window above guide
  hotkeyReminderEl = document.createElement('div');
  hotkeyReminderEl.id = 'wt-hotkey-reminder';
  hotkeyReminderEl.className = 'wt-hotkey-reminder';
  hotkeyReminderEl.innerHTML = `
    <div class="wt-reminder-inner">
      <span class="wt-reminder-press">Press</span>
      <div class="wt-reminder-keys">
        <span class="wt-keycap" data-hotkey="alt">Alt</span>
        <span class="wt-keycap-plus">+</span>
        <span class="wt-keycap" data-hotkey="shift">Shift</span>
        <span class="wt-keycap-plus">+</span>
        <span class="wt-keycap" data-hotkey="f">F</span>
      </div>
      <span class="wt-reminder-sub">to continue</span>
    </div>
  `;

  // Reminder lives inside guide (position:absolute covers entire guide)
  guide.appendChild(hotkeyReminderEl);

  pin = null;

  arrowEl = document.createElement('div');
  arrowEl.id = 'wt-arrow';
  arrowEl.setAttribute('aria-hidden', 'true');
  ensureOrthoArrowMarkup(arrowEl);
  document.body.appendChild(arrowEl);

  ensureSkipGuideButton();
  ensureDummyCloseButton();
  syncSkipButtonVisibility();
}

// ─── router ───────────────────────────────────────────────────────────────────
function go(name) {
  step = STEPS.indexOf(name);
  if (typeof stepCleanup === 'function') {
    stepCleanup();
    stepCleanup = null;
  }
  clearSpot();
  setHotkeyReminderVisible(false);

  ensureSkipGuideButton();
  ensureDummyCloseButton();
  syncSkipButtonVisibility();

  const fullscreen = name === 'splash';
  dim.className = fullscreen ? 'full' : 'half';
  if (name === 'splash') dim.classList.add('under-layout');
  else dim.classList.remove('under-layout');

  if (fullscreen) {
    row.classList.add('hidden');
    setTimeout(() => ({ splash: doSplash })[name]?.(), 0);
    return;
  }

  row.classList.remove('hidden');
  row.classList.remove('shortcut-step');
  row.classList.remove('guide-focus', 'dual-focus', 'hotkey-held', 'reminder-focus');
  row.classList.add('fade-out');
  row.classList.remove('fade-in');

  setTimeout(() => {
    const titlebarEl = document.getElementById('wt-titlebar');
    const reminderEl = hotkeyReminderEl;

    // Hide guide completely while rebuilding — prevents ghost titlebar
    guide.style.opacity   = '0';
    guide.style.animation = 'none';

    // Apply stored center position
    if (windowPos) applyWindowPos(guide, windowPos);
    else { guide.style.transform = 'translate(-50%, -50%)'; guide.style.transition = ''; }
    guide.innerHTML = '';

    if (titlebarEl) guide.appendChild(titlebarEl);

    ({
      shortcut:    doShortcut,
      'font-size': doFontSize,
      width:       doWidth,
      mode:        doMode,
      position:    doPosition,
      close:       doCloseApp,
      tray:        doTray,
    })[name]?.();

    if (reminderEl) guide.appendChild(reminderEl);

    const skipBtn = document.getElementById('wt-titlebar-skip');
    if (skipBtn) {
      skipBtn.onclick = () => {
        const nextStep = STEPS[STEPS.indexOf(name) + 1];
        if (nextStep) markDone(() => go(nextStep));
      };
    }

    // Wait two frames so all DOM is painted, then trigger animation from scratch
    raf2(() => {
      // Reset animation so wt-win-in fires fresh from opacity:0
      guide.style.opacity   = '';
      guide.style.animation = '';
      // Force reflow so removing animation property is picked up
      void guide.offsetHeight;
      row.classList.remove('fade-out');
      row.classList.add('fade-in');
    });
  }, 220);
}

function raf2(fn) { requestAnimationFrame(() => requestAnimationFrame(fn)); }

// ─── SPLASH ───────────────────────────────────────────────────────────────────
function doSplash() {
  document.body.classList.add('wt-splash-active');
  const wrap = document.createElement('div');
  wrap.id = 'wt-splash';
  const introLeft = splashWords('Hey, your', 0);
  const introChipDelay = (2 * 0.09).toFixed(3);
  const introRight = splashWords('is here!', 3);
  wrap.innerHTML = `
    <canvas id="wt-cv"></canvas>
    <div id="wt-splash-body">
      <div id="wt-splash-titlebar">
        <span class="wt-titlebar-label">floating-lyrics</span>
      </div>
      <div class="wt-splash-inner">
        <div id="wt-splash-badge"><img src="/icons/icon-serverless.ico" alt="App icon"></div>
        <h1 id="wt-splash-h">${introLeft} <span class="wt-sw wt-inline-chip" style="--wt-amp:8px;--wt-wd:1s;animation-delay:${introChipDelay}s">floating-lyrics</span> ${introRight}</h1>
        <p id="wt-splash-sub">Quick tour &middot; 6 steps</p>
      </div>
      <div class="wt-splash-footer">
        <div class="wt-splash-start-group">
          <span id="wt-splash-start-label" class="wt-splash-start-label">Starting in 3...</span>
          <button id="wt-start-btn" type="button" class="wt-start-btn wt-start-btn-countdown" aria-label="Start tour" title="Start tour">
            <span class="wt-start-ring" aria-hidden="true">
              <svg viewBox="0 0 44 44" focusable="false">
                <circle class="wt-start-ring-track" cx="22" cy="22" r="20"></circle>
                <circle class="wt-start-ring-progress" cx="22" cy="22" r="20"></circle>
              </svg>
            </span>
            <span class="material-icons" aria-hidden="true">play_arrow</span>
          </button>
        </div>
      </div>
    </div>
  `;
  dim.appendChild(wrap);
  const splashBody = wrap.querySelector('#wt-splash-body');

  // Draggable — CSS handles default position, drag updates windowPos
  makeDraggable(wrap.querySelector('#wt-splash-titlebar'), splashBody);

  splashBody.style.opacity = '0';
  // Restore dragged position if user moved a window earlier
  if (windowPos) applyWindowPos(splashBody, windowPos);

  requestAnimationFrame(() => {
    splashBody.style.transition = 'opacity 0.35s ease';
    splashBody.style.opacity = '1';
  });
  runCanvas([]);
  raf2(() => {
    const startBtn = document.getElementById('wt-start-btn');
    const startLabel = document.getElementById('wt-splash-start-label');
    let autoStartTimer = null;
    let labelTimer = null;
    const autoStartAt = Date.now() + SPLASH_AUTO_START_MS;
    const clearLabelTimer = () => {
      if (!labelTimer) return;
      clearInterval(labelTimer);
      labelTimer = null;
    };
    const updateStartLabel = () => {
      if (!startLabel) return;
      const leftMs = Math.max(0, autoStartAt - Date.now());
      const leftSec = Math.max(1, Math.ceil(leftMs / 1000));
      startLabel.textContent = `Starting in ${leftSec}...`;
    };
    const clearAutoStartTimer = () => {
      if (!autoStartTimer) return;
      clearTimeout(autoStartTimer);
      autoStartTimer = null;
    };
    let startLocked = false;
    const beginTour = async () => {
      if (startLocked) return;
      startLocked = true;
      clearAutoStartTimer();
      clearLabelTimer();
      if (startLabel) startLabel.textContent = 'Starting...';
      if (startBtn) startBtn.disabled = true;
      startBtn?.classList.remove('wt-start-btn-countdown');
      splashBody.style.transition = 'opacity 0.3s ease, scale 0.3s ease';
      splashBody.style.opacity = '0';
      splashBody.style.scale = '0.96';
      setTimeout(() => {
        document.body.classList.remove('wt-splash-active');
        wrap.remove();
        // Double rAF ensures the splash DOM is fully removed before guide appears
        requestAnimationFrame(() => requestAnimationFrame(() => go('shortcut')));
      }, 310);
    };
    startBtn?.addEventListener('click', beginTour);
    updateStartLabel();
    labelTimer = setInterval(updateStartLabel, 150);
    autoStartTimer = setTimeout(() => {
      beginTour().catch(() => {});
    }, SPLASH_AUTO_START_MS);
  });
}

// ─── GOODBYE ─────────────────────────────────────────────────────────────────
function doGoodbye() {}
/*
  const wrap = document.createElement('div');
  wrap.id = 'wt-splash';
  wrap.innerHTML = `
    <div id="wt-splash-body">
      <div id="wt-splash-titlebar">
        <span class="wt-titlebar-label">floating-lyrics</span>
      </div>
      <div class="wt-splash-inner">
        <div id="wt-splash-badge" class="done">✓</div>
        <h1 id="wt-splash-h">${splashWords("You're all set.", 0)}</h1>
        <p id="wt-splash-sub">Tour complete</p>
      </div>
      <div class="wt-splash-footer">
        <span class="wt-timer-graphic wt-footer-timer-graphic" id="wt-goodbye-timer" aria-hidden="true">
          <svg viewBox="0 0 32 32" focusable="false">
            <circle class="wt-timer-track" cx="16" cy="16" r="12"></circle>
            <circle class="wt-timer-progress" cx="16" cy="16" r="12"></circle>
          </svg>
        </span>
      </div>
    </div>
  `;
  dim.appendChild(wrap);

  const splashBody = wrap.querySelector('#wt-splash-body');

  makeDraggable(wrap.querySelector('#wt-splash-titlebar'), splashBody);

  splashBody.style.opacity = '0';
  if (windowPos) applyWindowPos(splashBody, windowPos);

  requestAnimationFrame(() => {
    splashBody.style.transition = 'opacity 0.35s ease';
    splashBody.style.opacity = '1';
  });

  const clearCountdown = startGraphicCountdown(document.getElementById('wt-goodbye-timer'), GOODBYE_AUTO_NEXT_MS);
  setTimeout(() => {
    clearCountdown();
    exitWelcomeTour({ smooth: true });
  }, GOODBYE_AUTO_NEXT_MS);
}

// ─── word animations ──────────────────────────────────────────────────────────
*/
function splashWords(text, startIndex = 0) {
  return text.split(' ').map((w, i) =>
    `<span class="wt-sw" style="--wt-amp:8px;--wt-wd:1s;--wt-gd:2s;animation-delay:${((i + startIndex)*0.09).toFixed(3)}s">${w}</span>`
  ).join(' ');
}
function guideWords(text) {
  const words = text.split(' ');
  const stagger = Math.max(65, Math.min(140, 440/words.length)) / 1000;
  const base = 0.25; // wait for row fade-in to complete before words animate
  return words.map((w, i) =>
    `<span class="wt-w" style="--wt-amp:5px;--wt-wd:0.9s;animation-delay:${(base + i*stagger).toFixed(3)}s">${w}</span>`
  ).join(' ');
}

// ─── canvas particles ─────────────────────────────────────────────────────────
function runCanvas(wordPool = []) {
  const cv = document.getElementById('wt-cv');
  if (!cv) return;
  const cx = cv.getContext('2d');
  if (!cx) return;
  let W, H;
  const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
  resize();
  window.addEventListener('resize', resize);

  const pts = Array.from({ length: 55 }, () => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.00011,
    vy: -(0.00004 + Math.random() * 0.00009),
    r: 0.8 + Math.random() * 1.8,
    o: 0.05 + Math.random() * 0.2,
    ph: Math.random() * Math.PI * 2
  }));

  let startT=null;
  const draw=(t)=>{
    if (!cv.isConnected) { cx.clearRect(0,0,W,H); return; }
    if(!startT)startT=t; const e=(t-startT)*0.001;
    cx.clearRect(0,0,W,H);
    const grd=cx.createLinearGradient(W * 0.5, 0, W * 0.5, H);
    grd.addColorStop(0,'rgba(255,255,255,0)');grd.addColorStop(0.5,'rgba(255,255,255,0.035)');grd.addColorStop(1,'rgba(255,255,255,0)');
    cx.fillStyle=grd;cx.fillRect(0,0,W,H);
    pts.forEach(p=>{
      p.x+=p.vx+Math.sin(e*0.55+p.ph)*0.00005;p.y+=p.vy;if(p.y<-0.04)p.y=1.04;
      cx.globalAlpha=p.o;
      cx.beginPath();
      cx.arc(p.x*W,p.y*H,p.r,0,Math.PI*2);
      cx.fillStyle='#fff';
      cx.fill();
    });
    cx.globalAlpha=1;requestAnimationFrame(draw);
  };requestAnimationFrame(draw);
}

// ─── step content helper ──────────────────────────────────────────────────────
function setGuideContent(html, taskHtml) {
  guide.querySelectorAll('.wt-guide-content, .wt-task').forEach(el => el.remove());
  const div = document.createElement('div');
  div.className = 'wt-guide-content';
  div.innerHTML = html;
  guide.appendChild(div);
  if (taskHtml !== undefined) {
    const task = document.createElement('div');
    task.className = 'wt-task';
    task.id = 'wt-task';
    task.innerHTML = taskHtml;
    guide.appendChild(task);
  }
}

// ─── step functions ───────────────────────────────────────────────────────────

function doShortcut() {
  shortcutDone = false;
  row.classList.add('shortcut-step');
  setGuideContent(`
    <div class="wt-step">1 / 6</div>
    <div class="wt-label">${guideWords('Press Alt+Shift+F')}</div>
    <div class="wt-desc">Press and <strong>hold</strong> <span class="wt-combo">Alt + Shift + F</span> to activate and show the Controller.</div>
    <div class="wt-desc">Try clicking this window if shortcut not working</div>
  `, `<span class="wt-td" id="wt-td"></span><span id="wt-tl">Hold <span class="wt-keycap" data-hotkey="alt">Alt</span> <span class="wt-keycap" data-hotkey="shift">Shift</span> <span class="wt-keycap" data-hotkey="f">F</span></span>`);
  setHotkeyReminderVisible(true);
  syncHotkeyKeycaps();
  syncHotkeyGuideState();
}

function doFontSize() {
  setGuideContent(`
    <div class="wt-step">2 / 6</div>
    <div class="wt-font-size-row">
      <div class="wt-font-size-text">
        <div class="wt-label">${guideWords('Scroll to Resize')}</div>
        <div class="wt-desc">Scroll your mouse wheel anywhere to make lyrics font size bigger or smaller.</div>
      </div>
      <div class="wt-scroll-icon" aria-hidden="true">
        <span class="wt-scroll-arrow up"></span>
        <span class="wt-scroll-wheel"></span>
        <span class="wt-scroll-arrow down"></span>
      </div>
    </div>
  `, `<span class="wt-td" id="wt-td"></span><span id="wt-tl">Scroll up or down <span id="wt-sc">0 / 3</span></span>`);
  setHotkeyReminderVisible(true);
  syncHotkeyGuideState();
  let done = false;
  let scrollCount = 0;
  const requiredScrolls = 3;
  const fn = () => {
    if (!hotkeyHeld) return;
    if (done) return;
    scrollCount += 1;
    const sc = document.getElementById('wt-sc');
    if (sc) sc.textContent = `${Math.min(scrollCount, requiredScrolls)} / ${requiredScrolls}`;
    if (scrollCount < requiredScrolls) return;
    done = true;
    document.removeEventListener('wheel', fn, true);
    markDone(() => go('width'));
  };
  document.addEventListener('wheel', fn, {capture:true, passive:true});
}

function doWidth() {
  setGuideContent(`
    <div class="wt-step">3 / 6</div>
    <div class="wt-label">${guideWords('Drag to Resize')}</div>
    <div class="wt-desc">Drag the <strong>resize handle</strong> in the control bar left and right.</div>
  `, `<span class="wt-td" id="wt-td"></span><span id="wt-tl">Drag the handle</span>`);
  setHotkeyReminderVisible(true);
  syncHotkeyGuideState();
  const handle = document.getElementById('lyrics-width-handle');
  if (handle) spotOn(handle);
  let down=false, moved=false, done=false;
  const onDown = () => {
    if (!hotkeyHeld) return;
    down = true;
    moved = false;
  };
  const onMove = () => {
    if (!down || done || !hotkeyHeld) return;
    moved = true;
  };
  const onUp = () => {
    if (!down || done) return;
    down = false;
    if (!moved) return;
    done = true;
    handle?.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    markDone(() => go('mode'));
  };
  handle?.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, {passive:true});
  window.addEventListener('pointerup', onUp, {passive:true});
}

function doMode() {
  modeTaps = 0;
  setGuideContent(`
    <div class="wt-step">4 / 6</div>
    <div class="wt-label">${guideWords('Switch Lyrics Mode')}</div>
    <div class="wt-desc">Tap <strong>Mode</strong> to switch through 4 different lyrics display modes.</div>
  `, `<span class="wt-td" id="wt-td"></span><span id="wt-tl">Tap <span class="wt-control-clone" id="wt-mode-clone"></span> <span id="wt-mc">0 / 3</span></span>`);
  setHotkeyReminderVisible(true);
  syncHotkeyGuideState();
  const cleanupControlBar = forceControlBarVisible();
  let clearTargetHighlight = () => {};
  stepCleanup = () => {
    clearTargetHighlight();
    cleanupControlBar();
    stepCleanup = null;
  };
  const btn = document.getElementById('lyrics-display-mode-toggle');
  const clone = document.getElementById('wt-mode-clone');
  if (clone) clone.textContent = 'Mode';
  if (btn) {
    spotOnWhenReady(btn);
    clearTargetHighlight = highlightControlTarget(btn);
  }
  const fn = () => {
    if (!hotkeyHeld) return;
    modeTaps++;
    const mc = document.getElementById('wt-mc'); if(mc) mc.textContent=`${Math.min(modeTaps,3)} / 3`;
    if (modeTaps>=3) {
      btn?.removeEventListener('click',fn);
      clearTargetHighlight();
      cleanupControlBar();
      stepCleanup = null;
      markDone(()=>go('position'));
    }
  };
  btn?.addEventListener('click', fn);
}

function doPosition() {
  setGuideContent(`
    <div class="wt-step">5 / 6</div>
    <div class="wt-label">${guideWords('Switch Position')}</div>
    <div class="wt-desc">Tap the <strong>↹ button</strong> to switch lyrics position left and right.</div>
  `, `<span class="wt-td" id="wt-td"></span><span id="wt-tl">Click <span class="wt-control-clone wt-control-icon" id="wt-position-clone"></span> <span id="wt-pc">0 / 3</span></span>`);
  setHotkeyReminderVisible(true);
  syncHotkeyGuideState();
  const cleanupControlBar = forceControlBarVisible();
  let clearTargetHighlight = () => {};
  stepCleanup = () => {
    clearTargetHighlight();
    cleanupControlBar();
    stepCleanup = null;
  };
  const btn = document.getElementById('lyrics-position-toggle');
  const clone = document.getElementById('wt-position-clone');
  if (clone) clone.textContent = (btn?.textContent || '←').trim();
  if (btn) {
    spotOnWhenReady(btn);
    clearTargetHighlight = highlightControlTarget(btn);
  }
  let done=false;
  let positionTaps = 0;
  const fn = () => {
    if (!hotkeyHeld) return;
    if (done) return;
    positionTaps += 1;
    const pc = document.getElementById('wt-pc');
    if (pc) pc.textContent = `${Math.min(positionTaps, 3)} / 3`;
    if (positionTaps < 3) return;
    done=true;
    btn?.removeEventListener('click',fn);
    clearTargetHighlight();
    cleanupControlBar();
    stepCleanup = null;
    markDone(()=>go('close'));
  };
  btn?.addEventListener('click', fn);
}


function forceCloseControlVisible() {
  const closeWindowControl = ensureDummyCloseButton();
  if (!closeWindowControl) return () => {};

  closeWindowControl.style.removeProperty('opacity');
  closeWindowControl.style.removeProperty('pointer-events');
  closeWindowControl.style.removeProperty('transition');
  closeWindowControl.setAttribute('aria-hidden', 'false');

  let active = true;
  let raf = null;
  const sync = () => {
    if (!active) return;
    closeWindowControl.classList.toggle('show', !!hotkeyHeld);
    raf = requestAnimationFrame(sync);
  };
  raf = requestAnimationFrame(sync);

  return () => {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    closeWindowControl.classList.remove('show');
    closeWindowControl.setAttribute('aria-hidden', 'true');
  };
}

function doCloseApp() {
  setGuideContent(`
    <div class="wt-step">6 / 6</div>
    <div class="wt-label">${guideWords('Close App')}</div>
    <div class="wt-desc">Click the close button to terminate the Floating Lyrics app.</div>
  `, `<span class="wt-td" id="wt-td"></span><span id="wt-tl">Click <span class="wt-control-clone wt-control-icon" id="wt-close-clone"></span></span>`);
  setHotkeyReminderVisible(true);
  syncHotkeyGuideState();
  const cleanupControlBar = forceControlBarVisible();
  const cleanupCloseControl = forceCloseControlVisible();
  let clearTargetHighlight = () => {};
  const btn = document.getElementById('close-dummy-btn');
  const labelEl = document.getElementById('close-window-label');
  const clone = document.getElementById('wt-close-clone');
  stepCleanup = () => {
    if (labelEl) delete labelEl.dataset.wtArrowHead;
    clearTargetHighlight();
    cleanupControlBar();
    cleanupCloseControl();
    stepCleanup = null;
  };
  if (clone) clone.textContent = (btn?.textContent || 'close').trim();
  if (labelEl) {
    labelEl.dataset.wtArrowHead = 'below';
  }
  if (btn || labelEl) {
    spotOnWhenReady(labelEl || btn);
  }
  if (btn) {
    clearTargetHighlight = highlightControlTarget(btn);
  }
  let done = false;
  const fn = () => {
    if (!hotkeyHeld) return;
    if (done) return;
    done = true;
    btn?.removeEventListener('click', fn);
    if (labelEl) delete labelEl.dataset.wtArrowHead;
    clearTargetHighlight();
    cleanupControlBar();
    cleanupCloseControl();
    stepCleanup = null;
    const layoutContainer = document.getElementById('layout-container');
    if (layoutContainer) {
      layoutContainer.style.display = 'none';
    }
    if (typeof window.__welcomeHideControllerUi === 'function') {
      window.__welcomeHideControllerUi();
    }
    syncSkipButtonVisibility();
    markDone(() => go('tray'));
  };
  btn?.addEventListener('click', fn);
}

function doTray() {
  heldKeys.clear();
  hotkeyHeld = false;
  setHotkeyReminderVisible(false);
  syncHotkeyGuideState();

  // Add tray-step BEFORE content injection so CSS rules apply immediately
  row.classList.add('tray-step');

  setGuideContent(`
    <div class="wt-label">${guideWords('More in the Tray')}</div>
    <div class="wt-desc">Click the <strong>tray icon</strong> in your taskbar for font weight, opacity, monitor &amp; more.</div>
    <div class="wt-auto-timer-wrap">
      <span class="wt-timer-graphic wt-tray-timer-graphic" id="wt-tray-timer" aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          <circle class="wt-timer-track" cx="16" cy="16" r="12"></circle>
          <circle class="wt-timer-progress" cx="16" cy="16" r="12"></circle>
        </svg>
      </span>
    </div>
  `);
  let finished = false;
  let autoSkipTimer = null;
  const clearCountdown = startGraphicCountdown(document.getElementById('wt-tray-timer'), TRAY_SKIP_MS);
  const finishTour = () => {
    if (finished) return;
    finished = true;
    if (autoSkipTimer) {
      clearTimeout(autoSkipTimer);
      autoSkipTimer = null;
    }
    clearCountdown();
    row.classList.remove('tray-step');
    exitWelcomeTour({ smooth: true });
  };
  stepCleanup = () => {
    if (autoSkipTimer) {
      clearTimeout(autoSkipTimer);
      autoSkipTimer = null;
    }
    clearCountdown();
    row.classList.remove('tray-step');
    stepCleanup = null;
  };
  autoSkipTimer = setTimeout(() => {
    document.getElementById('skip-welcome-btn')?.click();
  }, TRAY_SKIP_MS);

  import('./welcome-tray-scene.js').then(({ mountTrayScene }) => {
    mountTrayScene(() => {
      finishTour();
    });
  });
}

function markDone(next) {
  clearSpot();
  const d=document.getElementById('wt-td');
  const task=document.getElementById('wt-task');
  if(d) d.classList.add('done');
  if(task) task.classList.add('done');
  setTimeout(next, 700);
}

// ─── unified highlight ────────────────────────────────────────────────────────
let highlightedEl = null;

function spotOn(el) {
  clearSpot();
  if (!el) return;
  el.classList.add('wt-highlight');
  highlightedEl = el;

  // arrow from closest side of task → element center
  const updateArrow = () => {
    const task = document.getElementById('wt-task');
    if (!task || !arrowEl || !el.isConnected) {
      arrowEl?.classList.remove('visible');
      return;
    }
    if (row.classList.contains('reminder-focus') && !hotkeyHeld) {
      arrowEl.classList.remove('visible');
      return;
    }
    const r  = el.getBoundingClientRect();
    const tr = task.getBoundingClientRect();
    const targetCx = r.left + r.width / 2;
    const targetCy = r.top  + r.height / 2;
    // Pick left or right edge of task based on which is closer to target
    const fromLeft  = Math.abs(targetCx - tr.left);
    const fromRight = Math.abs(targetCx - tr.right);
    const sx = fromLeft < fromRight ? tr.left : tr.right;
    const sy = tr.top + tr.height / 2;
    // Keep the head outside the target by a fixed margin.
    const headMargin = 32;
    const arrowPlacement = el.dataset.wtArrowHead || 'above';
    const ex = targetCx;
    const ey = arrowPlacement === 'below'
      ? (targetCy + headMargin)
      : (targetCy - headMargin);

    drawOrthoArrow(arrowEl, sx, sy, ex, ey);
    arrowEl.classList.toggle('guide-focus', row.classList.contains('guide-focus') || row.classList.contains('dual-focus'));
  };

  const tick = () => {
    updateArrow();
    arrowTick = requestAnimationFrame(tick);
  };
  tick();

  spotClean = () => {
    cancelAnimationFrame(arrowTick);
    arrowTick = null;
    el.classList.remove('wt-highlight');
    arrowEl?.classList.remove('visible');
    highlightedEl = null;
    spotClean = null;
  };
}

function clearSpot() { if (spotClean) spotClean(); }

function setHotkeyReminderVisible(visible) {
  if (!hotkeyReminderEl) return;
  hotkeyReminderEl.classList.toggle('enabled', !!visible);
}

function spotOnWhenReady(el, retries = 24) {
  if (!el || retries <= 0) return;
  const r = el.getBoundingClientRect();
  const ready = r.width > 6 && r.height > 6 && r.bottom > 0 && r.right > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
  if (ready) { spotOn(el); return; }
  requestAnimationFrame(() => spotOnWhenReady(el, retries - 1));
}

function highlightControlTarget(el) {
  if (!el) return () => {};
  el.classList.add('wt-highlight');
  return () => el.classList.remove('wt-highlight');
}

function flashControlHighlights() {
  const control = document.getElementById('lyrics-width-control');
  if (!control) return;

  const els = Array.from(control.querySelectorAll('button, #lyrics-width-handle, #lyrics-width-handle-secondary'))
    .filter((el) => el && !el.disabled);
  if (!els.length) return;

  if (control) control.classList.add('show');

  els.forEach(el => {
    el.classList.remove('wt-highlight', 'wt-highlight--out');
    el.classList.add('wt-highlight');
  });

  setTimeout(() => {
    els.forEach(el => el.classList.add('wt-highlight--out'));
    setTimeout(() => {
      els.forEach(el => el.classList.remove('wt-highlight', 'wt-highlight--out'));
      if (control) control.classList.remove('show');
    }, 600);
  }, 1000);
}

function forceControlBarVisible() {
  const control = document.getElementById('lyrics-width-control');
  if (!control) return () => {};

  let active = true;
  let raf = null;
  const sync = () => {
    if (!active) return;
    control.classList.toggle('show', !!hotkeyHeld);
    raf = requestAnimationFrame(sync);
  };
  raf = requestAnimationFrame(sync);

  return () => {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    control.classList.remove('show');
  };
}


// ─── key listener — ONLY affects step 1 ──────────────────────────────────────
function listenKeys() {
  // Reset held-key state when the user tabs away — prevents keys getting "stuck"
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      heldKeys.clear();
      syncHotkeyKeycaps();
      const wasHeld = hotkeyHeld;
      hotkeyHeld = false;
      syncSkipButtonVisibility();
      if (wasHeld && isHotkeyGatedStep()) syncHotkeyGuideState();
    }
  });

  document.addEventListener('keydown', e => {
    heldKeys.add(e.code);
    syncHotkeyKeycaps();
    const wasHeld = hotkeyHeld;
    hotkeyHeld = isAllThreeHeld();
    syncSkipButtonVisibility();
    if (!isHotkeyGatedStep()) return;
    if (!wasHeld && hotkeyHeld) {
      syncHotkeyGuideState();
      if (STEPS[step] === 'shortcut' && !shortcutDone) {
        shortcutDone = true;
        flashControlHighlights();
        markDone(() => go('font-size'));
      }
    } else {
      syncHotkeyGuideState();
    }
  }, true);

  document.addEventListener('keyup', e => {
    heldKeys.delete(e.code);
    syncHotkeyKeycaps();
    const wasHeld = hotkeyHeld;
    hotkeyHeld = isAllThreeHeld();
    syncSkipButtonVisibility();
    if (!isHotkeyGatedStep()) {
      if (['AltLeft','AltRight','ShiftLeft','ShiftRight','KeyF'].includes(e.code)) {
        const control = document.getElementById('lyrics-width-control');
        if (control) control.classList.remove('show');
      }
      return;
    }
    if (wasHeld !== hotkeyHeld || !hotkeyHeld) syncHotkeyGuideState();
  }, true);
}

// init
export function initWelcomeTour() {
  boot();
  listenKeys();
  go('splash');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWelcomeTour, {once:true});
} else {
  initWelcomeTour();
}
