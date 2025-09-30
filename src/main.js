import { OthelloApp } from './ui.js';
import { initBgFX } from './bgfx.js';

// Fit engine: tune --cell-size to fit viewport; fall back to scaling
function fitLayout() {
  const app = document.querySelector('.app');
  if (!app) return;

  const doc = document.documentElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Helper: measure natural size with current vars
  const measure = () => {
    const rect = app.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  };

  // Disable scaling during search
  doc.style.setProperty('--app-scale', '1');

  // Binary search the largest cell size that still keeps app within viewport
  let lo = 26;  // px, minimum cell size
  let hi = 160; // px, upper bound for large screens
  let best = lo;

  // Ensure app has no transform interfering with measurement
  const prevTransform = app.style.transform;
  app.style.transform = 'none';

  for (let i = 0; i < 18; i++) {
    const mid = Math.floor((lo + hi) / 2);
    doc.style.setProperty('--cell-size', mid + 'px');
    // Force reflow
    void app.offsetWidth;
    const { w, h } = measure();
    if (w <= vw && h <= vh) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Apply the best size
  doc.style.setProperty('--cell-size', best + 'px');
  void app.offsetWidth;
  const { w: bw, h: bh } = measure();

  // If still overflowing due to header/panels, scale uniformly as last resort
  if (bw > vw || bh > vh) {
    const scale = Math.min(1, vw / bw, vh / bh);
    doc.style.setProperty('--app-scale', String(scale));
  } else {
    doc.style.setProperty('--app-scale', '1');
  }

  // Restore any inline transform (should be none after using CSS var)
  app.style.transform = prevTransform || '';
}

// Bootstrap the app (guard against double init)
window.addEventListener('DOMContentLoaded', () => {
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
});

// Also run after full load to account for fonts/layout shifts
window.addEventListener('load', () => window.requestFit && window.requestFit());
