/* ASCII ocean: original sharks drawn as text on a canvas.
 * Every character sits in a tile with a 3:4 (width:height) aspect ratio.
 * No libraries, no build step.
 */
(() => {
  'use strict';

  const canvas = document.getElementById('ocean');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- look & feel knobs ---------------------------------------------------
  const TILE_UNIT_DESKTOP = 3;   // tile = 3k x 4k px  -> 9 x 12 on desktop
  const TILE_UNIT_MOBILE = 2.5;  // 7.5 x 10 on small screens
  const LEVELS = 8;              // brightness steps

  const rgb = getComputedStyle(document.documentElement)
    .getPropertyValue('--ascii-rgb').trim() || '111, 168, 180';
  const mono = getComputedStyle(document.documentElement)
    .getPropertyValue('--mono').trim() || 'monospace';
  const FILLS = Array.from({ length: LEVELS + 1 },
    (_, i) => `rgba(${rgb}, ${(i / LEVELS).toFixed(3)})`);

  // glyph table: 0..11 is a density ramp, the rest are special glyphs
  const GLYPHS = ' .,:;-=+*#%@~|)o';
  const G_WAVE = 12, G_GILL = 14, G_EYE = 15;

  // ---- state -----------------------------------------------------------------
  let W = 0, H = 0, dpr = 1, cw = 9, ch = 12, cols = 0, rows = 0;
  let charGrid = new Uint8Array(0), levelGrid = new Uint8Array(0);
  let baseLen = 300;
  let time = 0;
  const sharks = [];
  const pointer = { x: 0, y: 0, active: false };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = k => k * k * (3 - 2 * k);

  // ---- setup -------------------------------------------------------------------
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    const k = W < 640 ? TILE_UNIT_MOBILE : TILE_UNIT_DESKTOP;
    cw = 3 * k;
    ch = 4 * k;                       // 3:4 tiles, taller than wide
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / ch);

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${(ch * 0.86).toFixed(1)}px ${mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    charGrid = new Uint8Array(cols * rows);
    levelGrid = new Uint8Array(cols * rows);

    baseLen = W < 640 ? W * 0.6 : clamp(W * 0.25, 200, 460);

    const want = W < 640 ? 4 : clamp(Math.floor(W / 230), 5, 9);
    while (sharks.length < want) sharks.push(makeShark(true));
    while (sharks.length > want) sharks.pop();
  }

  function makeShark(anywhere) {
    const s = { x: 0, y: 0, baseY: 0 };
    respawn(s, anywhere);
    return s;
  }

  function respawn(s, anywhere) {
    s.dir = Math.random() < 0.5 ? -1 : 1;
    s.size = rand(0.45, 1.25);
    s.hammer = Math.random() < 0.28;
    s.seed = Math.random() * 100;
    s.phase = Math.random() * 6.28;
    s.speed = rand(26, 66) * (0.5 + s.size * 0.6);
    s.baseY = rand(0.1, 0.9) * H;
    const L = baseLen * s.size;
    s.x = anywhere ? rand(0, W) : (s.dir === 1 ? -L * 0.65 : W + L * 0.65);
    s.y = s.baseY;
  }

  // ---- shark geometry ------------------------------------------------------
  // u runs 0 (nose) -> 1 (tail tip). Returns half-width as a fraction of Wm.
  function profile(u) {
    if (u < 0 || u > 1) return 0;
    if (u < 0.28) return Math.pow(Math.sin(u / 0.28 * Math.PI / 2), 0.6);
    if (u < 0.88) return 1 - 0.88 * smooth((u - 0.28) / 0.6);
    return 0.12;
  }

  function rampGlyph(val) {
    return clamp(Math.floor(val * (GLYPHS.length - 5)), 1, 11);
  }

  function put(idx, glyph, val, layer) {
    const lvl = clamp(Math.round(LEVELS * layer * (0.5 + 0.5 * clamp(val, 0, 1))), 1, LEVELS);
    charGrid[idx] = glyph;
    levelGrid[idx] = lvl;
  }

  function drawShark(s) {
    const L = baseLen * s.size;
    const Wm = L * 0.135;                             // max half-width
    const layer = 0.45 + 0.55 * ((s.size - 0.45) / 0.8); // far = dim, near = bright
    const theta = Math.cos(time * 0.25 + s.seed) * 0.05;
    const hx = s.dir * Math.cos(theta), hy = Math.sin(theta); // heading
    const nx = -hy, ny = hx;                                  // perpendicular

    const R = L * 0.62 + Wm * 2.2;
    const c0 = Math.max(0, Math.floor((s.x - R) / cw));
    const c1 = Math.min(cols - 1, Math.floor((s.x + R) / cw));
    const r0 = Math.max(0, Math.floor((s.y - R) / ch));
    const r1 = Math.min(rows - 1, Math.floor((s.y + R) / ch));

    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ch - s.y;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - s.x;
        const a = dx * hx + dy * hy;       // distance towards the nose
        const b = dx * nx + dy * ny;
        const u = (L / 2 - a) / L;
        if (u < 0 || u > 1) continue;
        const v = -s.dir * b;              // + is up (towards the back)

        // tail swings more the further back you go
        const off = Wm * 0.75 * Math.sin(s.phase - u * 5.2) * (0.1 + 1.3 * u * u);
        const w = v - off;

        const prof = profile(u);
        const hw = Wm * prof;
        let glyph = -1, val = 0;

        // ---- head (hammerhead gets a wide bar instead of a pointed nose)
        if (s.hammer && u < 0.11) {
          if (u > 0.02 && Math.abs(w) < Wm * 1.65) {
            glyph = rampGlyph(0.62); val = 0.62;
            if (Math.abs(u - 0.06) < 0.025 && Math.abs(Math.abs(w) - Wm * 1.5) < ch * 0.7) {
              glyph = G_EYE; val = 1;
            }
          }
        }
        // ---- body
        else if (u < 0.9 && Math.abs(w) < hw) {
          const rr = w / Math.max(hw, 1e-3);
          val = 0.62 + 0.3 * rr + (Math.abs(rr) > 0.82 ? 0.12 : 0);
          glyph = rampGlyph(val);
          // gills
          if (u > 0.22 && u < 0.29 && Math.abs(rr) < 0.65 &&
              Math.floor((u - 0.22) / 0.025) % 2 === 0) {
            glyph = G_GILL; val = 0.85;
          }
          // eye (ordinary sharks)
          if (!s.hammer && Math.abs(u * L - L * 0.08) < cw * 0.6 &&
              Math.abs(w - Wm * 0.25 * prof) < ch * 0.6) {
            glyph = G_EYE; val = 1;
          }
        }

        // ---- fins (only where the body didn't claim the cell)
        if (glyph < 0) {
          // dorsal
          if (u > 0.36 && u < 0.52) {
            const tt = (u - 0.36) / 0.16;
            const h = Wm * 1.5 * (1 - tt) * Math.min(1, tt / 0.15 + 0.15);
            if (w >= hw * 0.7 && w < hw + h) { glyph = rampGlyph(0.5); val = 0.55; }
          }
          // pectoral
          if (glyph < 0 && u > 0.30 && u < 0.46) {
            const tt = (u - 0.30) / 0.16;
            const h = Wm * 1.4 * (1 - tt) * Math.min(1, tt / 0.12 + 0.1);
            if (w <= -hw * 0.7 && w > -(hw + h)) { glyph = rampGlyph(0.45); val = 0.5; }
          }
          // caudal (forked tail)
          if (glyph < 0 && u >= 0.86) {
            const t = (u - 0.86) / 0.14;
            const up = Wm * (0.12 + 1.5 * t);
            const lo = Wm * (0.12 + 1.0 * t);
            const notch = Wm * 0.6 * t;
            const aw = Math.abs(w);
            if (aw >= notch && (w >= 0 ? w < up : -w < lo)) {
              glyph = rampGlyph(0.55); val = 0.6;
            }
          }
        }

        if (glyph >= 0) put(r * cols + c, glyph, val, layer);
      }
    }
  }

  // ---- water -----------------------------------------------------------------
  function drawWater() {
    for (let r = 0; r < rows; r++) {
      const rowBase = r * cols;
      const sr = Math.sin(r * 0.15 + time * 0.3) * 1.6;
      const r2 = r * 0.21 - time * 0.4;
      for (let c = 0; c < cols; c++) {
        const idx = rowBase + c;
        if (levelGrid[idx] !== 0) continue;
        const n = Math.sin(c * 0.09 + time * 0.55 + sr) + Math.sin(r2 + c * 0.035);
        if (n > 1.6) {
          if (n > 1.85)     { charGrid[idx] = G_WAVE; levelGrid[idx] = 2; }
          else              { charGrid[idx] = 1;      levelGrid[idx] = 1; }
        }
      }
    }

    // ripples around the cursor / finger
    if (pointer.active) {
      const RAD = 110;
      const c0 = Math.max(0, Math.floor((pointer.x - RAD) / cw));
      const c1 = Math.min(cols - 1, Math.floor((pointer.x + RAD) / cw));
      const r0 = Math.max(0, Math.floor((pointer.y - RAD) / ch));
      const r1 = Math.min(rows - 1, Math.floor((pointer.y + RAD) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const idx = r * cols + c;
          if (levelGrid[idx] > 3) continue;
          const dx = (c + 0.5) * cw - pointer.x;
          const dy = (r + 0.5) * ch - pointer.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > RAD) continue;
          const ring = Math.sin(d * 0.12 - time * 6);
          if (ring > 0.35) {
            charGrid[idx] = ring > 0.75 ? G_WAVE : 5;
            levelGrid[idx] = clamp(Math.round(5 * (1 - d / RAD)) + 1, 1, 5);
          }
        }
      }
    }
  }

  // ---- frame ---------------------------------------------------------------------
  function update(dt) {
    for (const s of sharks) {
      s.x += s.dir * s.speed * dt;
      s.phase += dt * (2.4 + s.speed * 0.05);

      if (pointer.active) {         // sharks gently dodge the cursor
        const dx = s.x - pointer.x, dy = s.y - pointer.y;
        const R = 160 + baseLen * s.size * 0.3;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1;
          s.baseY += (dy / d) * 70 * dt;
        }
      }
      s.baseY = clamp(s.baseY, H * 0.06, H * 0.94);
      s.y = s.baseY + Math.sin(time * 0.25 + s.seed) * H * 0.025;

      const L = baseLen * s.size;
      if ((s.dir === 1 && s.x - L * 0.65 > W) || (s.dir === -1 && s.x + L * 0.65 < 0)) {
        respawn(s, false);
      }
    }
  }

  function render() {
    charGrid.fill(0);
    levelGrid.fill(0);

    // far sharks first so near ones sit on top
    const order = sharks.slice().sort((a, b) => a.size - b.size);
    for (const s of order) drawShark(s);
    drawWater();

    ctx.clearRect(0, 0, W, H);
    for (let lvl = 1; lvl <= LEVELS; lvl++) {
      ctx.fillStyle = FILLS[lvl];
      for (let r = 0; r < rows; r++) {
        const y = r * ch + ch / 2;
        const rowBase = r * cols;
        for (let c = 0; c < cols; c++) {
          const idx = rowBase + c;
          if (levelGrid[idx] === lvl) {
            ctx.fillText(GLYPHS[charGrid[idx]], c * cw + cw / 2, y);
          }
        }
      }
    }
  }

  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    time += dt;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---- input ---------------------------------------------------------------------
  window.addEventListener('pointermove', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
  }, { passive: true });
  window.addEventListener('pointerdown', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
  }, { passive: true });
  window.addEventListener('pointerup', e => {
    if (e.pointerType !== 'mouse') pointer.active = false;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.active = false; });
  window.addEventListener('blur', () => { pointer.active = false; });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (reduceMotion) render();
    }, 100);
  });

  // ---- go ------------------------------------------------------------------------
  resize();
  if (reduceMotion) {
    time = 3;          // one calm still frame, no animation loop
    render();
  } else {
    requestAnimationFrame(frame);
  }
})();
