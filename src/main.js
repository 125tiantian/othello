import { OthelloApp } from './ui.js';
import { initBgFX } from './bgfx.js';

function px(n) {
  return Math.max(0, parseFloat(n) || 0);
}

function computeAvailable() {
  const app = document.querySelector('.app');
  const arena = document.querySelector('.arena');
  const sidebar = document.querySelector('.sidebar');
  const topBar = document.querySelector('.top-bar');
  const footer = document.querySelector('.footer');
  if (!app || !arena) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const csApp = getComputedStyle(app);
  const padY = px(csApp.paddingTop) + px(csApp.paddingBottom);
  const rowGap = px(csApp.rowGap || csApp.gap);

  const topH = topBar ? topBar.getBoundingClientRect().height : 0;
  const footH = footer ? footer.getBoundingClientRect().height : 0;
  const arenaMaxH = Math.max(0, vh - padY - topH - footH - rowGap * 2);

  const arenaRect = arena.getBoundingClientRect();
  let boardMaxW = arenaRect.width;
  const csArena = getComputedStyle(arena);
  const cols = (csArena.gridTemplateColumns || '').trim().split(/\s+/);
  const twoCols = cols.length >= 2;
  if (twoCols && sidebar) {
    const sbr = sidebar.getBoundingClientRect();
    const colGap = px(csArena.columnGap || csArena.gap);
    boardMaxW = Math.max(0, arenaRect.width - sbr.width - colGap);
  }

  return { vw, vh, boardMaxW, boardMaxH: arenaMaxH };
}

// Fit engine: align with file:// fallback so both contexts share identical sizing
function fitLayout() {
  const app = document.querySelector('.app');
  if (!app) return;

  const doc = document.documentElement;
  const prevTransform = app.style.transform;
  const prevScale = doc.style.getPropertyValue('--app-scale');

  app.style.transform = 'none';
  doc.style.setProperty('--app-scale', '1');

  const avail = computeAvailable();
  if (!avail) {
    app.style.transform = prevTransform || '';
    if (prevScale) {
      doc.style.setProperty('--app-scale', prevScale);
    } else {
      doc.style.removeProperty('--app-scale');
    }
    return;
  }

  const unit = 8 + 7 * 0.045 + 2 * 0.1;
  const borderPx = 24;
  const pxW = (avail.boardMaxW - borderPx) / unit;
  const pxH = (avail.boardMaxH - borderPx) / unit;
  const cell = Math.floor(Math.max(16, Math.min(pxW, pxH)));

  doc.style.setProperty('--cell-size', `${cell}px`);

  const rect = app.getBoundingClientRect();
  let scale = 1;
  if (rect.width > avail.vw || rect.height > avail.vh) {
    scale = Math.min(1, avail.vw / rect.width, avail.vh / rect.height);
  }
  doc.style.setProperty('--app-scale', String(scale));

  app.style.transform = prevTransform || '';
}

function bootstrap() {
  if (window.__OTHELLO_BOOTSTRAPPED__) return;
  window.__OTHELLO_BOOTSTRAPPED__ = true;
  new OthelloApp();
  // Ambient background FX
  try { initBgFX(); } catch (_) {}
  // Expose a debounced requestFit for UI updates
  let raf = 0;
  window.requestFit = () => {
    if (window.__suppressFit) return; // 动画期间暂缓测量
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!window.__suppressFit) fitLayout();
      raf = 0;
    });
  };
  // Initial fit and on resize
  window.requestFit();
  window.addEventListener('resize', () => {
    window.requestFit();
  });

  // Observe content changes to keep scaling accurate
  const appEl = document.querySelector('.app');
  if (appEl && 'MutationObserver' in window) {
    const mo = new MutationObserver(() => {
      window.requestFit();
    });
    mo.observe(appEl, { childList: true, subtree: true, characterData: true });
  }
}

// Bootstrap immediately if DOM 已经就绪，否则等待 DOMContentLoaded
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}

// Also run after full load to account for fonts/layout shifts
window.addEventListener('load', () => window.requestFit && window.requestFit());
