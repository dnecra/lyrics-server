// welcome-tray-scene.js

const DRAWER_COLS       = 5;
const DRAWER_SLOT_SIZE  = 28;   // px
const DRAWER_GAP        = 6;    // px
const DRAWER_PADDING    = 10;   // px
const DRAWER_TOTAL_SLOTS = 15;  // 5×3
const APP_SLOT_INDEX    = 13;   // 0-based, slot #14 = row 2 col 3

export function mountTrayScene(onDone) {
  // Ensure stylesheet is loaded BEFORE injecting any HTML — prevents raw text flash
  function whenCssReady(cb) {
    const existing = document.getElementById('wt-tray-scene-css');
    if (existing) {
      if (existing.sheet) { cb(); return; }
      existing.addEventListener('load', cb, { once: true });
      return;
    }
    const link = document.createElement('link');
    link.id   = 'wt-tray-scene-css';
    link.rel  = 'stylesheet';
    link.href = '/welcome/welcome-tray-scene.css';
    link.addEventListener('load',  cb, { once: true });
    link.addEventListener('error', cb, { once: true }); // fallback if cached
    document.head.appendChild(link);
  }

  whenCssReady(() => {
    const scene = document.createElement('div');
    scene.id = 'wt-tray-scene';
    scene.innerHTML = buildSceneHTML();
    document.body.appendChild(scene);
    startScene(scene, onDone);
  });
}

export function mountTrayMenu({ container = document.body, anchorEl, onDone } = {}) {
  function whenCssReady(cb) {
    const existing = document.getElementById('wt-tray-scene-css');
    if (existing) {
      if (existing.sheet) { cb(); return; }
      existing.addEventListener('load', cb, { once: true });
      return;
    }
    const link = document.createElement('link');
    link.id = 'wt-tray-scene-css';
    link.rel = 'stylesheet';
    link.href = '/welcome/welcome-tray-scene.css';
    link.addEventListener('load', cb, { once: true });
    link.addEventListener('error', cb, { once: true });
    document.head.appendChild(link);
  }

  whenCssReady(() => {
    if (!container || !anchorEl) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'wt-ts-menu-host';
    wrapper.innerHTML = buildMenuHTML();
    const menu = wrapper.querySelector('#wt-ts-menu');
    if (!menu) return;

    container.appendChild(menu);

    const alignToAnchor = () => {
      const anchorRect = anchorEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const gap = 20;
      const nextRight = Math.max(
        8,
        containerRect.right - anchorRect.right
      );
      const nextBottom = Math.max(
        8,
        containerRect.bottom - anchorRect.top + gap
      );

      menu.style.left = 'auto';
      menu.style.top = 'auto';
      menu.style.right = `${Math.round(nextRight)}px`;
      menu.style.bottom = `${Math.round(nextBottom)}px`;
    };

    const dismiss = () => {
      window.removeEventListener('resize', alignToAnchor);
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      menu.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
      menu.style.opacity = '0';
      menu.style.transform = 'translateY(5px) scale(0.98)';
      setTimeout(() => {
        menu.remove();
        if (window.__wtDismissTrayMenu === dismiss) delete window.__wtDismissTrayMenu;
        onDone?.();
      }, 180);
    };

    const handleOutsidePointerDown = (event) => {
      if (menu.contains(event.target) || anchorEl.contains(event.target)) return;
      dismiss();
    };

    window.__wtDismissTrayMenu = dismiss;
    alignToAnchor();
    requestAnimationFrame(() => {
      alignToAnchor();
      menu.classList.add('visible');
      startMenuAnimation(menu);
    });

    window.addEventListener('resize', alignToAnchor);
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
  });
}

// ── Build scene HTML ─────────────────────────────────────────────────────────

function buildDrawerHTML() {
  let slots = '';
  for (let i = 0; i < DRAWER_TOTAL_SLOTS; i++) {
    if (i === APP_SLOT_INDEX) {
      slots += `<div class="wt-ts-slot app-icon" title="Floating Lyrics">
        <img
          src="/icons/icon-serverless.ico"
          alt="app icon"
          style="width:100%;height:100%;display:block;object-fit:contain;"
        >
      </div>`;
    } else if (i < DRAWER_TOTAL_SLOTS - 1) {
      // filled placeholder slots
      slots += `<div class="wt-ts-slot"><div class="wt-ts-slot-dot"></div></div>`;
    } else {
      // last slot — truly empty
      slots += `<div class="wt-ts-slot"></div>`;
    }
  }
  return `<div id="wt-ts-drawer">${slots}</div>`;
}

function buildMenuHTML() {
  const chk = (label, checked = false) =>
    `<div class="wt-tm-item${checked ? ' checked' : ''}" data-toggle>
      <span class="wt-tm-check-col">&#10003;</span>
      <span class="wt-tm-label">${label}</span>
    </div>`;

  const radio = (label, group, active = false) =>
    `<div class="wt-tm-item${active ? ' active' : ''}" data-group="${group}">
      <span class="wt-tm-check-col">&#10003;</span>
      <span class="wt-tm-label">${label}</span>
    </div>`;

  const plain = (label) =>
    `<div class="wt-tm-item">
      <span class="wt-tm-check-col"></span>
      <span class="wt-tm-label">${label}</span>
    </div>`;

  const sep = (label = '') => `<div class="wt-tm-sep">${label}</div>`;
  const div = () => `<div class="wt-tm-divider"></div>`;

  return `
    <div id="wt-ts-menu">
      <div class="wt-tm">
        ${chk('Mini-window mode', false)}

        ${sep('Actions')}
        ${radio('Monitor 1', 'monitor', true)}
        ${div()}
        ${chk('Always On Top', true)}
        ${chk('Disable hide on hover')}
        ${div()}
        ${chk('Fancy Animation', true)}
        ${chk('Blur', true)}
        ${div()}
        ${plain('Pause Lyrics')}
        ${plain('Open Guide')}
        ${plain('Restart App')}
        ${div()}
        ${plain('Quit')}

        <div class="wt-tm-footer">Made with &#9829; by Necra</div>
      </div>
    </div>
  `;
}

function buildSceneHTML() {
  return `
    ${buildDrawerHTML()}

    <div id="wt-ts-icon-dot" title="Floating Lyrics tray icon">
      <img
        src="/icons/icon-serverless.ico"
        alt="app icon"
        style="width:100%;height:100%;display:block;object-fit:contain;"
      >
    </div>

    <div id="wt-ts-ripple"></div>

    ${buildMenuHTML()}
  `;
}

// ── Start scene ──────────────────────────────────────────────────────────────

function startScene(scene, onDone) {
  const drawer  = scene.querySelector('#wt-ts-drawer');
  const iconDot = scene.querySelector('#wt-ts-icon-dot');
  const ripple  = scene.querySelector('#wt-ts-ripple');
  const menu    = scene.querySelector('#wt-ts-menu');
  const appSlot = drawer.querySelector('.app-icon');

  // Position icon dot and menu relative to the app slot in the drawer
  function alignToSlot() {
    const r           = appSlot.getBoundingClientRect();
    const slotBottom  = window.innerHeight - r.bottom;
    const slotRight   = window.innerWidth  - r.right;

    // Icon dot sits exactly over the app slot
    iconDot.style.bottom = slotBottom + 'px';
    iconDot.style.right  = slotRight  + 'px';
    iconDot.style.width  = r.width    + 'px';
    iconDot.style.height = r.height   + 'px';

    // Menu anchors above the slot: bottom = slot bottom + slot height + 4px gap
    menu.style.bottom = (slotBottom + r.height + 4) + 'px';
    menu.style.right  = slotRight + 'px';
  }

  // Position drawer bottom-right: slot 14 aligns with the real icon position
  // Bottom edge of drawer is 8px from screen bottom edge.
  // col from right = 1  → drawer right = 180 - 1*(28+6) = 146px
  drawer.style.bottom = '8px';
  drawer.style.right  = '146px';

  // ── Sequence: drawer → icon dot → ripple → menu ──

  // Step 1: drawer slides in
  setTimeout(() => {
    drawer.classList.add('visible');
    requestAnimationFrame(() => requestAnimationFrame(alignToSlot));
  }, 200);

  // Step 2: icon dot appears over the slot
  setTimeout(() => {
    alignToSlot();
    iconDot.classList.add('visible');
  }, 650);

  // Step 3: ripple expands from icon dot
  const RIPPLE_DURATION = 1400;
  let rippleStart = null;
  let rippleRAF   = null;

  function tickRipple(ts) {
    if (!ripple.isConnected) return;
    if (rippleStart === null) rippleStart = ts;
    const progress = Math.min((ts - rippleStart) / RIPPLE_DURATION, 1);

    const ir  = iconDot.getBoundingClientRect();
    const icx = ir.left + ir.width  / 2;
    const icy = ir.top  + ir.height / 2;

    const maxDim = Math.hypot(window.innerWidth, window.innerHeight);
    const t      = 1 - Math.pow(1 - progress, 3);
    const dim    = maxDim * t + Math.max(ir.width, ir.height) * (1 - t);

    ripple.style.width   = dim + 'px';
    ripple.style.height  = dim + 'px';
    ripple.style.left    = (icx - dim / 2) + 'px';
    ripple.style.top     = (icy - dim / 2) + 'px';

    let opacity;
    if      (progress < 0.15) opacity = progress / 0.15;
    else if (progress < 0.75) opacity = 1;
    else                       opacity = 1 - (progress - 0.75) / 0.25;
    ripple.style.opacity = Math.max(0, opacity).toFixed(3);

    if (progress < 1) rippleRAF = requestAnimationFrame(tickRipple);
    else ripple.style.opacity = '0';
  }

  setTimeout(() => {
    rippleRAF = requestAnimationFrame(tickRipple);
  }, 800);

  // Step 4: menu appears above the slot
  setTimeout(() => {
    alignToSlot();
    menu.classList.add('visible');
    startMenuAnimation(menu);
  }, 1100);

  // ── Dismiss ──
  window.__wtDismissTrayScene = () => {
    if (rippleRAF) { cancelAnimationFrame(rippleRAF); rippleRAF = null; }
    scene.style.transition = 'opacity 0.3s ease';
    scene.style.opacity    = '0';
    setTimeout(() => {
      scene.remove();
      delete window.__wtDismissTrayScene;
      onDone?.();
    }, 300);
  };
}

// ── Menu animation ───────────────────────────────────────────────────────────

function startMenuAnimation(menu) {
  const items       = Array.from(menu.querySelectorAll('.wt-tm > *'));
  const total       = items.length;
  const stepDelay   = 0.038;
  const baseDuration = 0.5;

  items.forEach((el, i) => {
    const delay = (total - 1 - i) * stepDelay;
    el.style.animationDelay = delay + 's';
    const glowAt = (delay + baseDuration * 0.72) * 1000;
    if (!el.classList.contains('wt-tm-sep') &&
        !el.classList.contains('wt-tm-divider') &&
        !el.classList.contains('wt-tm-footer')) {
      setTimeout(() => el.classList.add('glowed'), glowAt);
    }
  });

  menu.querySelectorAll('.wt-tm-item[data-toggle]').forEach(el =>
    el.addEventListener('click', () => el.classList.toggle('checked'))
  );

  menu.querySelectorAll('.wt-tm-item[data-group]').forEach(el =>
    el.addEventListener('click', () => {
      const g = el.dataset.group;
      menu.querySelectorAll(`.wt-tm-item[data-group="${g}"]`).forEach(i => i.classList.remove('active'));
      el.classList.add('active');
    })
  );
}
