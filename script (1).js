/* ASCII pond: koi made of filled letter tiles (1:1 tiles).
 * Fish swim with a tail-beat cycle (burst and glide), pick their own
 * targets and can turn all the way round. A faint trail follows the cursor.
 * No libraries, no build step.
 */
(() => {
  'use strict';

  const canvas = document.getElementById('pond');
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- knobs ---------------------------------------------------------------
  const TILE_DESKTOP = 11;           // square tiles, in px
  const TILE_MOBILE = 9;
  const CRUISE = [48, 74];           // top swimming speed, px per second
  const TURN = [0.8, 1.1];           // max turning speed, radians per second
  const BEAT = [0.55, 0.75];         // tail beats per second
  const TRAIL_LIFE = 1.5;            // seconds the cursor trail lingers

  const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const LETTERS = 'SXSX%8tSX8%X';
  const TAIL_LETTERS = '..:.:;.';

  const THEMES = {
    dark: {
      ink: '232,230,227',
      gray: [118, 188], grayLetter: 34, fleck: 0.62,
      orange: [[208, 116, 50], [194, 98, 42], [224, 140, 70]], orangeLetter: 46,
      tail: [56, 54, 52], tailLetter: 38, tailOrange: [116, 62, 30],
      edge: [52, 50, 48], edgeLetter: 30,
      eye: [18, 17, 16], eyeLetter: [238, 235, 230]
    },
    light: {
      ink: '29,28,27',
      gray: [84, 166], grayLetter: -58, fleck: 0.72,
      orange: [[204, 116, 60], [186, 96, 48], [218, 138, 82]], orangeLetter: -78,
      tail: [204, 201, 196], tailLetter: -42, tailOrange: [226, 178, 140],
      edge: [212, 209, 204], edgeLetter: -30,
      eye: [40, 38, 36], eyeLetter: [240, 237, 232]
    }
  };

  // ---- helpers -------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = k => k * k * (3 - 2 * k);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const c255 = v => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  const rgba = (r, g, b, a) => `rgba(${c255(r)},${c255(g)},${c255(b)},${a.toFixed(2)})`;

  // ---- state ---------------------------------------------------------------
  const KIND_BODY = 0, KIND_FIN = 1, KIND_EYE = 2;

  let W = 0, H = 0, dpr = 1, cw = 11, ch = 11, cols = 0, rows = 0;
  let cov, sc, ff, lat, fid, kind, touched, touchedN = 0;
  let ambient = [];
  const fishes = [];
  const ripples = [];
  const trail = [];
  let nextRipple = 2;
  let time = 0;
  let textRects = null;
  let lastTC = -1, lastTR = -1;

  let theme = 'dark';
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch (e) { /* storage blocked: stay on dark */ }
  let pal = THEMES[theme];
  root.dataset.theme = theme;

  // ---- setup ---------------------------------------------------------------
  function setFont() {
    ctx.font = `${cw.toFixed(1)}px ${MONO}`;
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
    textRects = rects.length ? rects : null;
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    cw = ch = W < 640 ? TILE_MOBILE : TILE_DESKTOP;   // 1:1 tiles
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / ch);

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    setFont();
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

    ambient = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const h = hash(c + 11, r + 29);
        if (h < 0.005) ambient.push({ c, r, g: '-', base: 0.10, ph: h * 900 });
        else if (h < 0.014) ambient.push({ c, r, g: '.', base: 0.14, ph: h * 900 });
      }
    }

    const want = W < 640 ? 3 : clamp(Math.floor(W / 250), 4, 6);
    if (fishes.length !== want) {
      fishes.length = 0;
      for (let i = 0; i < want; i++) fishes.push(makeFish(i, want));
      warmup(14);
    }
  }

  // ---- koi -----------------------------------------------------------------
  function makeFish(i, total) {
    const size = rand(0.85, 1.2) * (W < 640 ? 0.82 : 1);
    const sp = cw * 0.75;
    const N = Math.round(52 * size);
    const s = {
      size, N, sp,
      R: cw * 3.3 * size,                       // body half-width: chunky, ~6-7 tiles across
      x: rand(0.1, 0.9) * W,
      y: clamp((i + 0.5) / total + rand(-0.08, 0.08), 0.06, 0.94) * H,
      a: rand(0, TAU),
      v: 30,
      cruise: rand(CRUISE[0], CRUISE[1]),
      omega: rand(TURN[0], TURN[1]),
      freq: rand(BEAT[0], BEAT[1]),
      bp: rand(0, TAU),                         // tail-beat phase
      tx: 0, ty: 0, retarget: 0,
      seed: rand(0, 100), seed2: rand(0, 100),
      dim: rand(0.78, 1),
      thr: rand(-0.25, 0.42),                   // lower = more orange
      pts: [], q: []
    };
    for (let k = 0; k < N; k++) {
      s.pts.push({ x: s.x - Math.cos(s.a) * sp * k, y: s.y - Math.sin(s.a) * sp * k });
      s.q.push({ x: 0, y: 0, nx: 0, ny: 0, tx: 0, ty: 0, r: 0, f: 0 });
    }
    pickTarget(s, false);
    return s;
  }

  function pickTarget(s, outside) {
    if (outside) {
      s.tx = rand(0.25, 0.75) * W; s.ty = rand(0.25, 0.75) * H;
      s.retarget = rand(4, 8);
      return;
    }
    // try several spots and head for the one furthest from the other fish
    let best = null, bestScore = -1;
    for (let k = 0; k < 14; k++) {
      // mostly gentle changes of direction, sometimes a full U-turn
      let rel = rand(-1, 1);
      rel = Math.sign(rel) * Math.pow(Math.abs(rel), 1.5) * Math.PI;
      const ang = s.a + rel;
      const dist = rand(220, 560);
      const tx = s.x + Math.cos(ang) * dist, ty = s.y + Math.sin(ang) * dist;
      if (tx < W * 0.02 || tx > W * 0.98 || ty < H * 0.03 || ty > H * 0.97) continue;
      let nearest = 600;
      for (const o of fishes) {
        if (o === s) continue;
        nearest = Math.min(nearest, Math.hypot(tx - o.x, ty - o.y));
      }
      const score = nearest + rand(0, 140);
      if (score > bestScore) { bestScore = score; best = { tx, ty }; }
    }
    if (best) { s.tx = best.tx; s.ty = best.ty; }
    else { s.tx = rand(0.2, 0.8) * W; s.ty = rand(0.2, 0.8) * H; }
    s.retarget = rand(5, 10);
  }

  function updateFish(s, dt) {
    s.retarget -= dt;
    const outside = s.x < -W * 0.06 || s.x > W * 1.06 || s.y < -H * 0.06 || s.y > H * 1.06;
    const distT = Math.hypot(s.tx - s.x, s.ty - s.y);
    if (s.retarget <= 0 || distT < 70 || outside) pickTarget(s, outside);

    // steer towards the target, and away from any fish that get too close
    let vx = s.tx - s.x, vy = s.ty - s.y;
    const vl = Math.hypot(vx, vy) || 1;
    vx /= vl; vy /= vl;
    const range = s.R * 5;
    for (const o of fishes) {
      if (o === s) continue;
      const dx = s.x - o.x, dy = s.y - o.y;
      const dd = Math.hypot(dx, dy);
      if (dd < range && dd > 0.01) {
        const w = (1 - dd / range) * 1.6;
        vx += dx / dd * w; vy += dy / dd * w;
      }
    }
    const d = wrap(Math.atan2(vy, vx) - s.a);

    // the tail stroke drives the turn; the turning circle never gets tighter
    // than the fish's own body, so bends stay smooth instead of folding
    const stroke = 0.5 + 0.5 * Math.sin(2 * s.bp - 1.57);       // 0..1, two kicks per tail cycle
    const omegaMax = Math.max(0.3, Math.min(s.omega, s.v / (s.R * 1.5)));
    const omega = omegaMax * (0.6 + 0.4 * stroke) * (outside ? 1.4 : 1);
    s.a += clamp(d, -omega * dt, omega * dt);

    // burst and glide; ease off through sharp turns
    const turnPen = 1 - 0.3 * Math.min(1, Math.abs(d) / 1.4);
    const vT = s.cruise * (0.4 + 0.6 * Math.pow(stroke, 1.2)) * turnPen;
    s.v += (vT - s.v) * Math.min(1, dt * 3);
    s.x += Math.cos(s.a) * s.v * dt;
    s.y += Math.sin(s.a) * s.v * dt;

    s.bp += dt * TAU * s.freq * (0.75 + 0.5 * s.v / s.cruise);

    // the body follows the head, one segment at a time
    const p = s.pts;
    p[0].x = s.x; p[0].y = s.y;
    for (let i = 1; i < s.N; i++) {
      const dx = p[i - 1].x - p[i].x, dy = p[i - 1].y - p[i].y;
      const dd = Math.sqrt(dx * dx + dy * dy) || 1;
      p[i].x = p[i - 1].x - dx / dd * s.sp;
      p[i].y = p[i - 1].y - dy / dd * s.sp;
    }
  }

  // body half-width along the fish, f = 0 (nose) .. 1 (tail tip)
  function profile(f) {
    if (f < 0.07) return 0.6 + 0.4 * Math.sin(f / 0.07 * Math.PI / 2);
    if (f < 0.36) return 1;
    if (f < 0.74) return 1 - 0.68 * smooth((f - 0.36) / 0.38);
    if (f < 0.82) return 0.32;
    return 0.32 + 0.6 * smooth((f - 0.82) / 0.18);              // tail fan
  }

  function orangeAt(s, f, l) {
    const v = Math.sin(f * 9 + s.seed) * 0.6 +
              Math.sin(f * 3.3 - l * 1.8 + s.seed2) * 0.55 +
              Math.sin(f * 19 - l * 2.6 + s.seed) * 0.2;
    return v > s.thr;
  }

  function warmup(seconds) {
    const step = 0.1;
    for (let t = 0; t < seconds; t += step) for (const s of fishes) updateFish(s, step);
  }

  // ---- rasterising onto the tile grid --------------------------------------
  function stamp(cx, cy, rad, f, nx, ny, id, k, onlyEmpty) {
    const halo = cw * 1.0;
    const reach = rad + halo;
    const c0 = Math.max(0, Math.floor((cx - reach) / cw));
    const c1 = Math.min(cols - 1, Math.floor((cx + reach) / cw));
    const r0 = Math.max(0, Math.floor((cy - reach) / ch));
    const r1 = Math.min(rows - 1, Math.floor((cy + reach) / ch));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ch - cy;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - cx;
        const d = Math.sqrt(dx * dx + dy * dy) - rad;
        if (d > halo) continue;
        const cv = d <= 0 ? 1 : (1 - d / halo) * 0.55;
        if (cv < 0.12) continue;
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
    const stroke = 0.5 + 0.5 * Math.sin(2 * s.bp - 1.57);
    const ampT = s.R * 0.62 * (0.8 + 0.2 * stroke);

    for (let i = 0; i < N; i++) {
      const a = p[Math.max(i - 1, 0)], b = p[Math.min(i + 1, N - 1)];
      let tx = a.x - b.x, ty = a.y - b.y;
      const len = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= len; ty /= len;
      const nx = -ty, ny = tx;
      const f = i / (N - 1);
      // the swimming wave grows towards the tail
      const u = ampT * (0.08 + 0.92 * Math.pow(f, 1.7)) * Math.sin(s.bp - 4.4 * f);
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

    // pectoral fins: swept back and out from just behind the head
    const i0 = Math.round(N * 0.17);
    for (let j = 0; j < 5; j++) {
      const o = q[Math.min(N - 1, i0 + j * 2)];
      const sway = 1 + 0.18 * Math.sin(s.bp + j * 0.6);
      const off = s.R * (0.88 + 0.3 * j) * sway;
      const rad = s.R * 0.3 * (1 - 0.12 * j);
      stamp(o.x + o.nx * off, o.y + o.ny * off, rad, o.f, o.nx, o.ny, id, KIND_FIN, true);
      stamp(o.x - o.nx * off, o.y - o.ny * off, rad, o.f, o.nx, o.ny, id, KIND_FIN, true);
    }
    // smaller pelvic fins
    const i1 = Math.round(N * 0.46);
    for (let j = 0; j < 3; j++) {
      const o = q[Math.min(N - 1, i1 + j * 2)];
      const sway = 1 + 0.2 * Math.sin(s.bp + 1.5 + j * 0.6);
      const off = s.R * (0.85 + 0.25 * j) * sway;
      const rad = s.R * 0.22 * (1 - 0.15 * j);
      stamp(o.x + o.nx * off, o.y + o.ny * off, rad, o.f, o.nx, o.ny, id, KIND_FIN, true);
      stamp(o.x - o.nx * off, o.y - o.ny * off, rad, o.f, o.nx, o.ny, id, KIND_FIN, true);
    }

    // eyes
    const e = q[Math.max(1, Math.round(N * 0.075))];
    for (const side of [-1, 1]) {
      const ex = e.x + e.nx * side * e.r * 0.6 + e.tx * e.r * 0.1;
      const ey = e.y + e.ny * side * e.r * 0.6 + e.ty * e.r * 0.1;
      const c = Math.floor(ex / cw), r = Math.floor(ey / ch);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const idx = r * cols + c;
      if (fid[idx] === id && cov[idx] >= 1) kind[idx] = KIND_EYE;
    }
  }

  // ---- ripples and cursor trail ------------------------------------------
  function updateRipples(dt) {
    nextRipple -= dt;
    if (nextRipple <= 0) {
      ripples.push({
        x: rand(0.1, 0.9) * W, y: rand(0.1, 0.9) * H,
        age: 0, life: rand(9, 13), maxR: rand(90, 160)
      });
      nextRipple = rand(5, 9);
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age > ripples[i].life) ripples.splice(i, 1);
    }
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].age += dt;
      if (trail[i].age > TRAIL_LIFE) trail.splice(i, 1);
    }
  }

  function addTrail(c, r) {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    trail.push({ c, r, age: 0, g: hash(c, r) < 0.5 ? '.' : ':' });
    if (trail.length > 160) trail.shift();
  }

  function ringGlyph(dx, dy) {
    if (Math.abs(dy) < Math.abs(dx) * 0.38) return '|';
    if (Math.abs(dx) < Math.abs(dy) * 0.38) return '-';
    return dx * dy > 0 ? '/' : '\\';
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
      ctx.fillText(a.g, a.c * cw + cw / 2, a.r * ch + ch / 2 + 0.5);
    }

    // faint rings on the water
    for (const rp of ripples) {
      const p = rp.age / rp.life;
      const R = rp.maxR * (1 - (1 - p) * (1 - p));
      const al = 0.2 * Math.min(1, p * 6) * (1 - p);
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
          if (Math.abs(Math.sqrt(dx * dx + dy * dy) - R) > cw * 0.65) continue;
          ctx.fillText(ringGlyph(dx, dy), c * cw + cw / 2, r * ch + ch / 2 + 0.5);
        }
      }
    }

    // barely-there cursor trail
    for (const t of trail) {
      const idx = t.r * cols + t.c;
      if (cov[idx] !== 0) continue;
      const k = 1 - t.age / TRAIL_LIFE;
      const k2 = k * k;
      const x = t.c * cw, y = t.r * ch;
      ctx.fillStyle = rgba(ink[0], ink[1], ink[2], 0.05 * k2);
      ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      ctx.fillStyle = rgba(ink[0], ink[1], ink[2], 0.22 * k2);
      ctx.fillText(t.g, x + cw / 2, y + ch / 2 + 0.5);
    }

    // little splash marks at each fish's nose while it swims
    for (const s of fishes) {
      const speedK = clamp(s.v / s.cruise, 0.3, 1);
      for (const ang of [-1.0, -0.6, 0.6, 1.0]) {
        const phi = s.a + ang;
        const rr = s.R * (1.65 + 0.12 * Math.sin(time * 2 + ang * 5));
        const px = s.x + Math.cos(phi) * rr, py = s.y + Math.sin(phi) * rr;
        const c = Math.floor(px / cw), r = Math.floor(py / ch);
        if (c < 0 || c >= cols || r < 0 || r >= rows || cov[r * cols + c] !== 0) continue;
        ctx.fillStyle = rgba(ink[0], ink[1], ink[2], 0.3 * speedK * s.dim);
        ctx.fillText(ringGlyph(Math.cos(phi), Math.sin(phi)), c * cw + cw / 2, r * ch + ch / 2 + 0.5);
      }
    }

    // koi tiles
    const gLo = pal.gray[0], gHi = pal.gray[1];
    for (let k = 0; k < touchedN; k++) {
      const idx = touched[k];
      const c = idx % cols, r = (idx / cols) | 0;
      const s = fishes[fid[idx] - 1];
      const cv = cov[idx], f = ff[idx], l = lat[idx], kd = kind[idx];
      const h = hash(c, r), h2 = hash(c + 977, r + 131), h3 = hash(c + 31, r + 57);
      const x = c * cw, y = r * ch;

      // dim tiles that sit behind the text
      let fade = 1;
      if (textRects) {
        const px = x + cw / 2, py = y + ch / 2;
        let m = 1;
        for (const tr of textRects) {
          const ex = Math.max(tr.l - px, 0, px - tr.r);
          const ey = Math.max(tr.t - py, 0, py - tr.b);
          m = Math.min(m, Math.sqrt(ex * ex + ey * ey) / 80);
        }
        fade = 0.1 + 0.9 * m * m;
      }

      let tile, letterCol, glyph;
      if (kd === KIND_EYE) {
        tile = rgba(pal.eye[0], pal.eye[1], pal.eye[2], s.dim * fade);
        letterCol = rgba(pal.eyeLetter[0], pal.eyeLetter[1], pal.eyeLetter[2], 0.9 * fade);
        glyph = 'o';
      } else if (kd === KIND_FIN) {
        const a = 0.8 * s.dim * fade, v = 1 + 0.4 * (h - 0.5);
        const t = pal.tail;
        tile = rgba(t[0] * v, t[1] * v, t[2] * v, a);
        letterCol = rgba(t[0] * v + pal.tailLetter, t[1] * v + pal.tailLetter, t[2] * v + pal.tailLetter, a);
        glyph = TAIL_LETTERS[(h3 * TAIL_LETTERS.length) | 0];
      } else if (cv < 1) {
        const a = cv * 0.9 * s.dim * fade, e = pal.edge;
        tile = rgba(e[0], e[1], e[2], a);
        letterCol = rgba(e[0] + pal.edgeLetter, e[1] + pal.edgeLetter, e[2] + pal.edgeLetter, a);
        glyph = TAIL_LETTERS[(h3 * TAIL_LETTERS.length) | 0];
      } else {
        // bright front half, dark dotted tail (dithered where they meet)
        const td = smooth(clamp((f - 0.62) / 0.22, 0, 1));
        const isTail = td >= 1 || td > h2;
        const orange = s.thr < 5 && orangeAt(s, f, l);
        if (isTail) {
          const a = 0.9 * s.dim * fade, v = 1 + 0.4 * (h - 0.5);
          const t = orange ? pal.tailOrange : pal.tail;
          tile = rgba(t[0] * v, t[1] * v, t[2] * v, a);
          letterCol = rgba(t[0] * v + pal.tailLetter, t[1] * v + pal.tailLetter, t[2] * v + pal.tailLetter, a);
          glyph = TAIL_LETTERS[(h3 * TAIL_LETTERS.length) | 0];
        } else {
          const a = s.dim * fade;
          let tr, tg, tb, lift;
          if (orange) {
            const o = pal.orange[(h * 3) | 0];
            const sh = 0.88 + 0.24 * h2;
            tr = o[0] * sh; tg = o[1] * sh; tb = o[2] * sh;
            lift = pal.orangeLetter;
          } else {
            const t = clamp(0.55 + 0.25 * (1 - Math.abs(l)) + 0.5 * (h - 0.5) - (Math.abs(l) > 0.85 ? 0.2 : 0), 0, 1);
            let g = gLo + (gHi - gLo) * t;
            if (h < 0.12) g *= pal.fleck;               // the odd darker tile
            tr = g + 4; tg = g + 1; tb = g - 3;
            lift = pal.grayLetter;
          }
          tile = rgba(tr, tg, tb, a);
          letterCol = rgba(tr + lift, tg + lift, tb + lift, a);
          glyph = LETTERS[(h3 * LETTERS.length) | 0];
        }
      }

      ctx.fillStyle = tile;
      ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      ctx.fillStyle = letterCol;
      ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 0.5);
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

  // ---- input ---------------------------------------------------------------
  if (!reduceMotion) {
    window.addEventListener('pointermove', e => {
      const c = Math.floor(e.clientX / cw), r = Math.floor(e.clientY / ch);
      if (c === lastTC && r === lastTR) return;
      if (lastTC >= 0) {                       // fill the gap if the cursor moved fast
        const n = Math.max(Math.abs(c - lastTC), Math.abs(r - lastTR));
        for (let i = 1; i < n; i++) {
          addTrail(Math.round(lastTC + (c - lastTC) * i / n), Math.round(lastTR + (r - lastTR) * i / n));
        }
      }
      addTrail(c, r);
      lastTC = c; lastTR = r;
    }, { passive: true });
    const stop = () => { lastTC = -1; lastTR = -1; };
    document.addEventListener('pointerleave', stop);
    window.addEventListener('blur', stop);
  }

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
