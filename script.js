/* Calm ASCII pond: koi made of filled letter tiles.
 * Every tile has a 3:4 (width:height) aspect ratio.
 * No libraries, no build step, no mouse interaction.
 */
(() => {
  'use strict';

  const canvas = document.getElementById('pond');
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- knobs ---------------------------------------------------------------
  const TILE_UNIT_DESKTOP = 3;      // tile = 3k x 4k px  -> 9 x 12
  const TILE_UNIT_MOBILE = 2.5;     // 7.5 x 10
  const SPEED = [14, 24];           // px per second (slow and calm)
  const TURN_RATE = 0.2;            // max radians per second
  const LETTERS = 'SXSX%8tSX8%#S';

  const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  const THEMES = {
    dark: {
      ink: '232,230,227',
      gray: [58, 176],
      grayLetter: 46,                      // letters are this much lighter than the tile
      orange: [[214, 122, 54], [196, 100, 44], [226, 148, 74]],
      orangeLetter: 44,
      edge: [58, 55, 52],
      eye: [20, 19, 18],
      eyeLetter: [235, 232, 228]
    },
    light: {
      ink: '29,28,27',
      gray: [92, 184],
      grayLetter: -66,                     // letters are darker than the tile
      orange: [[206, 118, 62], [188, 98, 50], [220, 140, 84]],
      orangeLetter: -78,
      edge: [184, 181, 176],
      eye: [44, 42, 40],
      eyeLetter: [240, 237, 232]
    }
  };

  // ---- helpers -------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = k => k * k * (3 - 2 * k);
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const rgba = (r, g, b, a) =>
    `rgba(${r < 0 ? 0 : r > 255 ? 255 : r | 0},${g < 0 ? 0 : g > 255 ? 255 : g | 0},` +
    `${b < 0 ? 0 : b > 255 ? 255 : b | 0},${a.toFixed(2)})`;

  // ---- state ---------------------------------------------------------------
  const KIND_BODY = 0, KIND_FIN = 1, KIND_EYE = 2;

  let W = 0, H = 0, dpr = 1, cw = 9, ch = 12, cols = 0, rows = 0;
  let cov, sc, ff, lat, fid, kind, touched, touchedN = 0;
  let ambient = [];
  const fishes = [];
  const ripples = [];
  let nextRipple = 2;
  let time = 0;
  let textRect = null;   // where the text sits, so fish can fade out behind it

  let theme = 'dark';
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch (e) { /* storage blocked: stay on dark */ }
  let pal = THEMES[theme];
  root.dataset.theme = theme;

  // ---- setup ---------------------------------------------------------------
  function setFont() {
    ctx.font = `${(cw * 1.15).toFixed(1)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }

  function measureText() {
    const rects = [];
    for (const sel of ['.content', '.nav']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      rects.push({ l: b.left - 28, t: b.top - 22, r: b.right + 28, b: b.bottom + 22 });
    }
    textRect = rects.length ? rects : null;
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    const k = W < 640 ? TILE_UNIT_MOBILE : TILE_UNIT_DESKTOP;
    cw = 3 * k;
    ch = 4 * k;                              // 3:4 tiles, taller than wide
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / ch);

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    setFont();

    root.style.setProperty('--cw', cw + 'px');
    root.style.setProperty('--ch', ch + 'px');
    measureText();

    const n = cols * rows;
    cov = new Float32Array(n);
    sc = new Float32Array(n);
    ff = new Float32Array(n);
    lat = new Float32Array(n);
    fid = new Uint8Array(n);
    kind = new Uint8Array(n);
    touched = new Int32Array(n);
    touchedN = 0;

    // sparse, very faint ambient marks that twinkle slowly
    ambient = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const h = hash(c + 11, r + 29);
        if (h < 0.006) ambient.push({ c, r, g: '-', base: 0.10, ph: h * 900 });
        else if (h < 0.016) ambient.push({ c, r, g: '.', base: 0.14, ph: h * 900 });
      }
    }

    const want = W < 640 ? 3 : clamp(Math.floor(W / 230), 4, 6);
    if (fishes.length !== want) {
      fishes.length = 0;
      for (let i = 0; i < want; i++) fishes.push(makeFish(i, want));
      warmup(16);
    }
  }

  // ---- koi -------------------------------------------------------------------
  function makeFish(i, total) {
    const size = rand(0.78, 1.15) * (W < 640 ? 0.85 : 1);
    const types = ['koi', 'gray', 'koi', 'ember', 'koi', 'gray'];
    const type = types[i % types.length];
    const sp = cw * 0.8;
    const N = Math.round(50 * size);
    const s = {
      type, size,
      R: cw * 3.1 * size,
      N, sp,
      x: rand(0.1, 0.9) * W,
      y: clamp(((i + 0.5) / total + rand(-0.08, 0.08)), 0.05, 0.95) * H,
      a: rand(0, Math.PI * 2),
      speed: rand(SPEED[0], SPEED[1]),
      turnRate: TURN_RATE * rand(0.7, 1),
      s1: rand(0, 100), s2: rand(0, 100),
      seed: rand(0, 100), seed2: rand(0, 100),
      t: rand(0, 100), und: rand(0, 6.28),
      dim: rand(0.72, 1),
      thr: type === 'gray' ? 99 : type === 'ember' ? rand(-0.15, 0.1) : rand(0.3, 0.5),
      pts: [], q: []
    };
    for (let k = 0; k < N; k++) {
      s.pts.push({ x: s.x - Math.cos(s.a) * sp * k, y: s.y - Math.sin(s.a) * sp * k });
      s.q.push({ x: 0, y: 0, nx: 0, ny: 0, tx: 0, ty: 0, r: 0, f: 0 });
    }
    // draw the dimmer fish first so brighter ones sit on top
    return s;
  }

  function updateFish(s, dt) {
    s.t += dt;
    let turn = (Math.sin(s.t * 0.11 + s.s1) * 0.55 + Math.sin(s.t * 0.043 + s.s2) * 0.45) * s.turnRate;

    const m = 40;
    if (s.x < -m || s.x > W + m || s.y < -m || s.y > H + m) {
      const want = Math.atan2(H / 2 - s.y, W / 2 - s.x);
      let d = want - s.a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn += clamp(d, -1, 1) * 0.5;
    }
    s.a += turn * dt;
    s.x += Math.cos(s.a) * s.speed * dt;
    s.y += Math.sin(s.a) * s.speed * dt;

    const p = s.pts;
    p[0].x = s.x; p[0].y = s.y;
    for (let i = 1; i < s.N; i++) {            // each segment follows the one in front
      const dx = p[i - 1].x - p[i].x, dy = p[i - 1].y - p[i].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      p[i].x = p[i - 1].x - dx / d * s.sp;
      p[i].y = p[i - 1].y - dy / d * s.sp;
    }
    s.und += dt * 0.9;                          // slow tail sway
  }

  // body thickness along the fish, f = 0 (nose) .. 1 (tail)
  function profile(f) {
    if (f < 0.08) return 0.55 + 0.45 * Math.sin(f / 0.08 * Math.PI / 2);
    if (f < 0.42) return 1;
    if (f < 0.9) return 1 - 0.72 * smooth((f - 0.42) / 0.48);
    return 0.28;
  }

  function orangeAt(s, f, l) {
    const v = Math.sin(f * 11 + s.seed) * 0.55 +
              Math.sin(f * 4.1 + l * 2.4 + s.seed2) * 0.5 +
              Math.sin(f * 23 - l * 3.0 + s.seed) * 0.18;
    return v > s.thr;
  }

  function warmup(seconds) {
    const step = 0.1;
    for (let t = 0; t < seconds; t += step) for (const s of fishes) updateFish(s, step);
  }

  // ---- rasterising onto the tile grid -----------------------------------
  function stamp(cx, cy, rad, f, nx, ny, id, k, onlyEmpty) {
    const reach = rad + cw;
    const c0 = Math.max(0, Math.floor((cx - reach) / cw));
    const c1 = Math.min(cols - 1, Math.floor((cx + reach) / cw));
    const r0 = Math.max(0, Math.floor((cy - reach) / ch));
    const r1 = Math.min(rows - 1, Math.floor((cy + reach) / ch));
    const halo = cw * 0.9;
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ch - cy;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - cx;
        const d = Math.sqrt(dx * dx + dy * dy) - rad;
        if (d > halo) continue;
        const cv = d <= 0 ? 1 : (1 - d / halo) * 0.5;
        const idx = r * cols + c;
        const old = cov[idx];
        if (onlyEmpty && old >= 0.5) continue;
        const sn = d / rad;
        let take;
        if (old === 0) take = true;
        else if (fid[idx] !== id) take = cv > 0.45;
        else take = cv > old + 1e-4 || (cv === 1 && old === 1 && sn < sc[idx]);
        if (!take) continue;
        if (old === 0) touched[touchedN++] = idx;
        cov[idx] = cv; sc[idx] = sn; ff[idx] = f;
        lat[idx] = clamp((dx * nx + dy * ny) / rad, -1, 1);
        fid[idx] = id; kind[idx] = k;
      }
    }
  }

  function clearField() {
    for (let k = 0; k < touchedN; k++) {
      const idx = touched[k];
      cov[idx] = 0; fid[idx] = 0; kind[idx] = 0;
    }
    touchedN = 0;
  }

  function stampFish(s, id) {
    const N = s.N, p = s.pts, q = s.q;
    const amp = s.R * 0.28;
    for (let i = 0; i < N; i++) {
      const a = p[Math.max(i - 1, 0)], b = p[Math.min(i + 1, N - 1)];
      let tx = a.x - b.x, ty = a.y - b.y;
      const len = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= len; ty /= len;
      const nx = -ty, ny = tx;
      const f = i / (N - 1);
      const u = amp * Math.sin(s.und - i * 0.28) * (0.12 + f * f * 1.1);
      const o = q[i];
      o.x = p[i].x + nx * u; o.y = p[i].y + ny * u;
      o.nx = nx; o.ny = ny; o.tx = tx; o.ty = ty;
      o.f = f; o.r = s.R * profile(f);
    }

    // body
    for (let i = 0; i < N; i++) {
      const o = q[i];
      stamp(o.x, o.y, o.r, o.f, o.nx, o.ny, id, KIND_BODY, false);
    }

    // tail fin: two lobes that spread apart towards the tip
    for (let i = Math.floor(N * 0.84); i < N; i++) {
      const o = q[i];
      const t = (o.f - 0.84) / 0.16;
      const off = s.R * (0.15 + 1.05 * t);
      const rad = s.R * 0.2 * (0.8 + 0.5 * t);
      stamp(o.x + o.nx * off, o.y + o.ny * off, rad, o.f, o.nx, o.ny, id, KIND_FIN, true);
      stamp(o.x - o.nx * off, o.y - o.ny * off, rad, o.f, o.nx, o.ny, id, KIND_FIN, true);
    }

    // pectoral fins
    const i0 = Math.round(N * 0.2);
    for (let j = 0; j < 5; j++) {
      const o = q[Math.min(N - 1, i0 + j)];
      const sway = 1 + 0.15 * Math.sin(s.und * 1.5 + j);
      const off = s.R * (0.95 + 0.45 * j) * sway;
      const rad = s.R * 0.34 * (1 - 0.13 * j);
      stamp(o.x + o.nx * off, o.y + o.ny * off, rad, o.f, o.nx, o.ny, id, KIND_FIN, true);
      stamp(o.x - o.nx * off, o.y - o.ny * off, rad, o.f, o.nx, o.ny, id, KIND_FIN, true);
    }

    // eyes
    const e = q[2];
    for (const side of [-1, 1]) {
      const ex = e.x + e.nx * side * e.r * 0.55 + e.tx * e.r * 0.1;
      const ey = e.y + e.ny * side * e.r * 0.55 + e.ty * e.r * 0.1;
      const c = Math.floor(ex / cw), r = Math.floor(ey / ch);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const idx = r * cols + c;
      if (fid[idx] === id && cov[idx] >= 1) kind[idx] = KIND_EYE;
    }
  }

  // ---- ripples (faint rings that appear on their own) ----------------------
  function updateRipples(dt) {
    nextRipple -= dt;
    if (nextRipple <= 0) {
      ripples.push({
        x: rand(0.1, 0.9) * W, y: rand(0.1, 0.9) * H,
        age: 0, life: rand(9, 13), maxR: rand(90, 150)
      });
      nextRipple = rand(5, 9);
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age > ripples[i].life) ripples.splice(i, 1);
    }
  }

  // ---- drawing -------------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const ink = pal.ink.split(',').map(Number);

    // ambient marks
    for (const a of ambient) {
      if (cov[a.r * cols + a.c] !== 0) continue;
      const al = a.base * (0.55 + 0.45 * Math.sin(time * 0.35 + a.ph));
      ctx.fillStyle = rgba(ink[0], ink[1], ink[2], al);
      ctx.fillText(a.g, a.c * cw + cw / 2, a.r * ch + ch / 2);
    }

    // ripples
    for (const rp of ripples) {
      const p = rp.age / rp.life;
      const R = rp.maxR * (1 - (1 - p) * (1 - p));
      const fade = Math.min(1, p * 6) * (1 - p);
      const al = 0.2 * fade;
      if (al < 0.01) continue;
      const reach = R + cw * 2;
      const c0 = Math.max(0, Math.floor((rp.x - reach) / cw));
      const c1 = Math.min(cols - 1, Math.floor((rp.x + reach) / cw));
      const r0 = Math.max(0, Math.floor((rp.y - reach) / ch));
      const r1 = Math.min(rows - 1, Math.floor((rp.y + reach) / ch));
      ctx.fillStyle = rgba(ink[0], ink[1], ink[2], al);
      for (let r = r0; r <= r1; r++) {
        const dy = (r + 0.5) * ch - rp.y;
        for (let c = c0; c <= c1; c++) {
          if (cov[r * cols + c] !== 0) continue;
          const dx = (c + 0.5) * cw - rp.x;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (Math.abs(d - R) > cw * 0.65) continue;
          let g;
          if (Math.abs(dy) < Math.abs(dx) * 0.38) g = '|';
          else if (Math.abs(dx) < Math.abs(dy) * 0.38) g = '-';
          else g = dx * dy > 0 ? '/' : '\\';
          ctx.fillText(g, c * cw + cw / 2, r * ch + ch / 2);
        }
      }
    }

    // koi tiles
    const gLo = pal.gray[0], gHi = pal.gray[1];
    for (let k = 0; k < touchedN; k++) {
      const idx = touched[k];
      const c = idx % cols, r = (idx / cols) | 0;
      const s = fishes[fid[idx] - 1];
      const cv = cov[idx];
      const h = hash(c, r), h2 = hash(c + 977, r + 131), h3 = hash(c + 31, r + 57);
      const x = c * cw, y = r * ch;

      // dim tiles that sit behind the text
      let fade = 1;
      if (textRect) {
        const px = x + cw / 2, py = y + ch / 2;
        let m = 1;
        for (const tr of textRect) {
          const ex = Math.max(tr.l - px, 0, px - tr.r);
          const ey = Math.max(tr.t - py, 0, py - tr.b);
          m = Math.min(m, Math.sqrt(ex * ex + ey * ey) / 80);
        }
        fade = 0.1 + 0.9 * m * m;
      }

      let tile, letterCol, a, ch_;
      if (kind[idx] === KIND_EYE) {
        tile = rgba(pal.eye[0], pal.eye[1], pal.eye[2], s.dim * fade);
        letterCol = rgba(pal.eyeLetter[0], pal.eyeLetter[1], pal.eyeLetter[2], 0.9 * fade);
        ch_ = 'o';
      } else if (cv < 1) {
        a = cv * 0.9 * s.dim * fade;
        const e = pal.edge;
        tile = rgba(e[0], e[1], e[2], a);
        letterCol = rgba(e[0] + pal.grayLetter * 0.6, e[1] + pal.grayLetter * 0.6, e[2] + pal.grayLetter * 0.6, a);
        ch_ = LETTERS[(h3 * LETTERS.length) | 0];
      } else {
        const l = lat[idx], f = ff[idx];
        a = s.dim * fade * (kind[idx] === KIND_FIN ? 0.85 : 1);
        let tr, tg, tb, lift;
        if (s.thr < 5 && orangeAt(s, f, l)) {
          const o = pal.orange[(h * 3) | 0];
          const sh = 0.88 + 0.24 * h2;
          tr = o[0] * sh; tg = o[1] * sh; tb = o[2] * sh;
          lift = pal.orangeLetter;
        } else {
          const t = clamp(0.5 + 0.28 * (1 - Math.abs(l)) + 0.55 * (h - 0.5) - (Math.abs(l) > 0.8 ? 0.25 : 0), 0, 1);
          const g = gLo + (gHi - gLo) * t;
          tr = g + 4; tg = g + 1; tb = g - 3;
          lift = pal.grayLetter;
        }
        tile = rgba(tr, tg, tb, a);
        letterCol = rgba(tr + lift, tg + lift, tb + lift, a);
        ch_ = LETTERS[(h3 * LETTERS.length) | 0];
      }

      ctx.fillStyle = tile;
      ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      ctx.fillStyle = letterCol;
      ctx.fillText(ch_, x + cw / 2, y + ch / 2 + 0.5);
    }
  }

  function render() {
    clearField();
    const order = fishes.map((s, i) => [s, i + 1]).sort((a, b) => a[0].dim - b[0].dim);
    for (const [s, id] of order) stampFish(s, id);
    draw();
  }

  // ---- loop ----------------------------------------------------------------
  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    time += dt;
    for (const s of fishes) updateFish(s, dt);
    updateRipples(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---- theme toggle --------------------------------------------------------
  function applyTheme(t) {
    theme = t;
    pal = THEMES[t];
    root.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (e) { /* ignore */ }
    if (reduceMotion) render();
  }
  const btn = document.getElementById('theme');
  if (btn) btn.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (reduceMotion) render();
    }, 120);
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { setFont(); measureText(); if (reduceMotion) render(); });
  }

  // ---- go ------------------------------------------------------------------
  resize();
  if (reduceMotion) {
    time = 3;            // one calm still frame, no animation loop
    render();
  } else {
    requestAnimationFrame(frame);
  }
})();
