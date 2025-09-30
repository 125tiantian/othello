// Background FX: particle network + soft merging blobs
// - Low/medium motion, theme-aware, throttled for perf
// - Respects prefers-reduced-motion and page visibility

export function initBgFX() {
  const root = document.querySelector('.decor-othello');
  if (!root) return () => {};

  const mReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mReduce.matches) return () => {};

  // Create canvas layer
  const canvas = document.createElement('canvas');
  canvas.className = 'bgfx';
  canvas.setAttribute('aria-hidden', 'true');
  root.insertBefore(canvas, root.firstChild);

  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return () => {};

  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let vw = 0, vh = 0;
  let running = true;
  let raf = 0;
  let last = 0;

  // Theme colors (light/dark)
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  const palette = () => {
    const dark = mqDark.matches;
    return dark
      ? {
          nodeRGB: '160,210,255', nodeAlpha: 0.55,
          linkRGB: '120,190,255', linkAlpha: 0.65,
          blobRGB: '90,170,255',  blobAlpha: 0.10,
        }
      : {
          nodeRGB: '40,70,110',   nodeAlpha: 0.45,
          linkRGB: '60,110,170',  linkAlpha: 0.55,
          blobRGB: '120,200,255', blobAlpha: 0.10,
        };
  };

  // Entities
  let particles = [];
  let blobs = [];

  function seed() {
    const area = vw * vh;
    const target = clamp(36, Math.floor(area / 28000), 110);
    const speed = Math.max(0.02, Math.min(0.16, Math.sqrt(area) / 14000));
    particles = new Array(target).fill(0).map(() => ({
      x: Math.random() * vw,
      y: Math.random() * vh,
      vx: (Math.random() * 2 - 1) * speed * (0.6 + Math.random() * 0.8),
      vy: (Math.random() * 2 - 1) * speed * (0.6 + Math.random() * 0.8),
      r: 1 + Math.random() * 1.2,
    }));

    const minSide = Math.min(vw, vh);
    const bCount = clamp(2, Math.floor(minSide / 600), 4);
    const br = clamp(60, Math.floor(minSide * 0.18), 160);
    const bs = Math.max(0.006, Math.min(0.045, minSide / 30000));
    blobs = new Array(bCount).fill(0).map(() => ({
      x: Math.random() * vw,
      y: Math.random() * vh,
      r: br * (0.8 + Math.random() * 0.6),
      vx: (Math.random() * 2 - 1) * bs,
      vy: (Math.random() * 2 - 1) * bs,
    }));
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = root.getBoundingClientRect();
    vw = Math.max(1, Math.floor(rect.width));
    vh = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function clamp(a, b, c) { return Math.max(a, Math.min(b, c)); }

  function step(dt) {
    // update
    const maxX = vw, maxY = vh;
    for (let p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // soft wrap
      if (p.x < -20) p.x = maxX + 20; else if (p.x > maxX + 20) p.x = -20;
      if (p.y < -20) p.y = maxY + 20; else if (p.y > maxY + 20) p.y = -20;
    }
    for (let b of blobs) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -b.r) { b.x = -b.x; b.vx *= -1; }
      if (b.y < -b.r) { b.y = -b.y; b.vy *= -1; }
      if (b.x > maxX + b.r) { b.x = maxX - (b.x - maxX); b.vx *= -1; }
      if (b.y > maxY + b.r) { b.y = maxY - (b.y - maxY); b.vy *= -1; }
    }
  }

  function draw() {
    const pal = palette();
    ctx.clearRect(0, 0, vw, vh);

    // Blobs first (soft additive for merging feel)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, b.r * 0.2, b.x, b.y, b.r);
      g.addColorStop(0, `rgba(${pal.blobRGB}, ${pal.blobAlpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Particle links
    const maxD = Math.min(180, Math.max(90, Math.min(vw, vh) * 0.22));
    ctx.lineWidth = Math.max(0.4, 0.8 / dpr);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxD * maxD) continue;
        const d = Math.sqrt(d2);
        const a = 1 - d / maxD;
        ctx.save();
        ctx.strokeStyle = `rgb(${pal.linkRGB})`;
        ctx.globalAlpha = pal.linkAlpha * (0.25 + a * 0.55);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Particle dots
    ctx.fillStyle = `rgba(${pal.nodeRGB}, ${pal.nodeAlpha})`;
    for (let p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop(ts) {
    if (!running) return;
    if (!last) last = ts;
    const dtMs = ts - last;
    // throttle ~28–32 fps
    if (dtMs < 32) { raf = requestAnimationFrame(loop); return; }
    const dt = Math.min(66, dtMs) * 0.13; // motion scale (medium pace)
    step(dt);
    draw();
    last = ts;
    raf = requestAnimationFrame(loop);
  }

  // Wire events
  const onVis = () => {
    if (document.hidden) {
      running = false; if (raf) cancelAnimationFrame(raf); raf = 0; last = 0;
    } else {
      running = true; raf = requestAnimationFrame(loop);
    }
  };
  const onColor = () => { /* redraw next frame with new palette */ };

  resize();
  raf = requestAnimationFrame(loop);

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVis);
  mqDark.addEventListener?.('change', onColor);

  // cleanup
  return () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVis);
    mqDark.removeEventListener?.('change', onColor);
    canvas.remove();
  };
}
