// ===== 10-materials.js — procedural floor materials (DD.materials) =====
// Every texture is a 512×512 canvas generated from pure pixel math (seeded PRNG, periodic lattice noise,
// wrapped stamps, tile/plank grids whose period divides the canvas), so it is deterministic and tiles
// seamlessly both as a 2D canvas pattern and as a three.js RepeatWrapping texture.
// One canvas covers `tileMM × tileMM` millimetres of floor.
(function () {
  'use strict';
  const DD = (window.DD = window.DD || {});

  const SIZE = 512; // must stay a power of two (coordinates wrap with `& MASK`)
  const MASK = SIZE - 1;
  const TAU = Math.PI * 2;

  // ================================================================== math primitives (pure, tested in Node)
  /** Seeded PRNG → function returning floats in [0,1). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** FNV-1a string hash → uint32 (stable material seeds). */
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  /** Stateless integer hash of (x, y, seed) → [0,1). */
  function hash2(x, y, seed) {
    let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= Math.imul(y | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const fade = (t) => t * t * (3 - 2 * t);
  function smoothstep(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  }
  function modPos(a, n) {
    const r = a % n;
    return r < 0 ? r + n : r;
  }

  // ------------------------------------------------------------------ periodic value noise
  /** Random lattice of px × py values; sampling wraps, so noise built on it has period (px, py) lattice units. */
  function makeLattice(px, py, seed) {
    const v = new Float32Array(px * py);
    for (let j = 0; j < py; j++) for (let i = 0; i < px; i++) v[j * px + i] = hash2(i, j, seed);
    return { px, py, v };
  }
  /** Smooth value noise at lattice coordinates (gx, gy); exactly periodic in (L.px, L.py). */
  function sampleLattice(L, gx, gy) {
    const fx = Math.floor(gx), fy = Math.floor(gy);
    const tx = fade(gx - fx), ty = fade(gy - fy);
    const i0 = modPos(fx, L.px), j0 = modPos(fy, L.py);
    const i1 = i0 + 1 === L.px ? 0 : i0 + 1, j1 = j0 + 1 === L.py ? 0 : j0 + 1;
    const r0 = j0 * L.px, r1 = j1 * L.px;
    const top = L.v[r0 + i0] + (L.v[r0 + i1] - L.v[r0 + i0]) * tx;
    const bot = L.v[r1 + i0] + (L.v[r1 + i1] - L.v[r1 + i0]) * tx;
    return top + (bot - top) * ty;
  }
  /**
   * Fractal (fBm) noise whose every octave has an integer number of lattice cells across the canvas, so it is
   * periodic with period SIZE pixels. o = { px, py=px, octaves=5, gain=0.5, seed }. Anisotropic when px ≠ py.
   */
  function makeFbm(o) {
    const layers = [];
    const gain = o.gain == null ? 0.5 : o.gain;
    let amp = 1, norm = 0;
    for (let i = 0; i < (o.octaves || 5); i++) {
      const px = Math.min(o.px << i, SIZE / 2), py = Math.min((o.py || o.px) << i, SIZE / 2);
      layers.push({ L: makeLattice(px, py, ((o.seed | 0) + i * 7919) | 0), amp });
      norm += amp;
      amp *= gain;
    }
    return { layers, norm };
  }
  /** fBm value at canvas pixel coordinates (x, y), in [0,1]. Period SIZE in both axes. */
  function fbmAt(F, x, y) {
    let s = 0;
    for (let i = 0; i < F.layers.length; i++) {
      const { L, amp } = F.layers[i];
      s += amp * sampleLattice(L, (x * L.px) / SIZE, (y * L.py) / SIZE);
    }
    return s / F.norm;
  }
  /** Whole-canvas fBm field sampled at pixel centres: out[y*SIZE+x] === fbmAt(F, x+0.5, y+0.5). */
  function fbmField(o) {
    const F = makeFbm(o);
    const out = new Float32Array(SIZE * SIZE);
    F.layers.forEach(({ L, amp }) => addOctave(out, L, amp / F.norm));
    return out;
  }
  /**
   * Add one octave to `out`. Per row, the lattice is first interpolated vertically (px values), then each run of
   * pixels inside one lattice cell only needs a single horizontal lerp — the hot loop of every generator.
   */
  function addOctave(out, L, amp) {
    const px = L.px, v = L.v;
    const TX = new Float32Array(SIZE), cellStart = new Int32Array(px + 1), col = new Float32Array(px + 1);
    for (let x = 0, cell = -1; x < SIZE; x++) {
      const g = ((x + 0.5) * px) / SIZE, f = Math.floor(g);
      TX[x] = fade(g - f);
      while (cell < f) cellStart[++cell] = x;
    }
    cellStart[px] = SIZE;
    for (let y = 0; y < SIZE; y++) {
      const g = ((y + 0.5) * L.py) / SIZE, f = Math.floor(g), ty = fade(g - f);
      const r0 = (f % L.py) * px, r1 = ((f + 1) % L.py) * px, row = y * SIZE;
      for (let i = 0; i < px; i++) col[i] = v[r0 + i] + (v[r1 + i] - v[r0 + i]) * ty;
      col[px] = col[0]; // wrap
      for (let i = 0; i < px; i++) {
        const a = col[i], d = col[i + 1] - a;
        for (let x = cellStart[i], end = cellStart[i + 1]; x < end; x++) out[row + x] += amp * (a + d * TX[x]);
      }
    }
  }
  /** Sample a periodic field at integer pixel coords (wrapping). */
  const at = (field, x, y) => field[(y & MASK) * SIZE + (x & MASK)];

  // ================================================================== pixel buffer helpers
  // Images are Float32Array(SIZE*SIZE*3) in sRGB 0..255. Surface callbacks write the current colour into C.
  const C = new Float32Array(3);
  const newImage = () => new Float32Array(SIZE * SIZE * 3);
  function setC(col, f) {
    C[0] = col[0] * f;
    C[1] = col[1] * f;
    C[2] = col[2] * f;
  }
  function mixC(col, t) {
    if (t <= 0) return;
    C[0] += (col[0] - C[0]) * t;
    C[1] += (col[1] - C[1]) * t;
    C[2] += (col[2] - C[2]) * t;
  }
  function scaleC(f) {
    C[0] *= f;
    C[1] *= f;
    C[2] *= f;
  }
  /** Warm (+) / cool (−) colour shift. */
  function tintC(t) {
    C[0] *= 1 + t;
    C[2] *= 1 - t;
  }
  function storeC(img, x, y) {
    const k = (y * SIZE + x) * 3;
    img[k] = C[0];
    img[k + 1] = C[1];
    img[k + 2] = C[2];
  }
  /** Alpha-blend a colour into one pixel (wrapping coordinates). */
  function blendPx(img, x, y, col, a) {
    const k = ((y & MASK) * SIZE + (x & MASK)) * 3;
    img[k] += (col[0] - img[k]) * a;
    img[k + 1] += (col[1] - img[k + 1]) * a;
    img[k + 2] += (col[2] - img[k + 2]) * a;
  }
  /** Antialiased sub-pixel splat (bilinear weights), wrapping at the canvas edges. */
  function splat(img, fx, fy, col, a) {
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    blendPx(img, x0, y0, col, a * (1 - tx) * (1 - ty));
    blendPx(img, x0 + 1, y0, col, a * tx * (1 - ty));
    blendPx(img, x0, y0 + 1, col, a * (1 - tx) * ty);
    blendPx(img, x0 + 1, y0 + 1, col, a * tx * ty);
  }
  function toRGBA(img) {
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let p = 0, k = 0; p < out.length; p += 4, k += 3) {
      out[p] = img[k];
      out[p + 1] = img[k + 1];
      out[p + 2] = img[k + 2];
      out[p + 3] = 255;
    }
    return out;
  }

  // ================================================================== joints, tiles and planks
  function bevelTerm(e, w) {
    if (e >= w) return 0;
    const t = 1 - (e < 0 ? 0 : e) / w;
    return t * t;
  }
  /**
   * Edge treatment shared by tiles, planks and pavers. dl/dr/dt/db = distance (px) from the pixel centre to the
   * left/right/top/bottom joint centre line. Light comes from the top-left: the bevel on the left/top edges of a
   * piece catches light, the right/bottom ones fall in shade. Then the joint (grout/gap) is blended with an
   * antialiased coverage. e = { half, bevel, depth, joint:[r,g,b], grain, seed }.
   */
  function applyEdges(dl, dr, dt, db, e, x, y) {
    const h = e.half;
    if (e.bevel > 0) {
      const s =
        bevelTerm(dl - h, e.bevel) * 0.6 + bevelTerm(dt - h, e.bevel) - bevelTerm(dr - h, e.bevel) * 0.6 - bevelTerm(db - h, e.bevel);
      scaleC(1 + s * e.depth);
    }
    const d = Math.min(dl, dr, dt, db);
    const g = clamp01(h + 0.5 - d);
    if (g <= 0) return;
    const n = 1 + (hash2(x, y, e.seed | 0) - 0.5) * (e.grain || 0);
    const ao = 1 - 0.18 * clamp01(d / (h + 0.5)); // grout is a little darker where it meets the piece
    C[0] += (e.joint[0] * n * ao - C[0]) * g;
    C[1] += (e.joint[1] * n * ao - C[1]) * g;
    C[2] += (e.joint[2] * n * ao - C[2]) * g;
  }
  /** Per-tile random attributes (tone, tint, sampling offsets for per-tile noise). */
  function tileTable(nx, ny, seed) {
    const out = [];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        out.push({
          tone: hash2(i, j, seed) - 0.5,
          tint: hash2(i, j, seed + 1) - 0.5,
          ox: (hash2(i, j, seed + 2) * SIZE) | 0,
          oy: (hash2(i, j, seed + 3) * SIZE) | 0,
          variant: (hash2(i, j, seed + 4) * 4) | 0,
        });
    return out;
  }
  /**
   * Regular grid of nx × ny tiles covering the canvas (joints on the canvas border too, so it wraps).
   * cfg.surface(x, y, tile, lx, ly, tw, th) writes the tile colour into C.
   */
  function renderTiles(img, cfg) {
    const tw = SIZE / cfg.nx, th = SIZE / cfg.ny;
    const tiles = tileTable(cfg.nx, cfg.ny, cfg.seed), edge = edgeSpec(cfg.edge, cfg.seed);
    for (let y = 0; y < SIZE; y++) {
      const cy = y + 0.5, tj = Math.floor(cy / th), ly = cy - tj * th;
      for (let x = 0; x < SIZE; x++) {
        const cx = x + 0.5, ti = Math.floor(cx / tw), lx = cx - ti * tw;
        cfg.surface(x, y, tiles[tj * cfg.nx + ti], lx, ly, tw, th);
        applyEdges(lx, tw - lx, ly, th - ly, edge, x, y);
        storeC(img, x, y);
      }
    }
  }

  // ------------------------------------------------------------------ plank rows (wood, vinyl, deck)
  function circularGap(a, b) {
    const d = Math.abs(a - b) % SIZE;
    return Math.min(d, SIZE - d);
  }
  function staggerOK(joints, other, minGap) {
    if (!other) return true;
    return joints.every((a) => other.every((b) => circularGap(a, b) >= minGap));
  }
  /** Default joint picker: 1 or 2 end joints per row (every row needs ≥ 1 so plank-local coords wrap cleanly). */
  function randomJoints(cfg, rng) {
    const first = rng() * SIZE;
    if (rng() >= cfg.twoJointProb) return [first];
    return [first, modPos(first + SIZE * (0.36 + rng() * 0.28), SIZE)];
  }
  /** Build a row: sorted joints, per-pixel segment lookup and segment lengths. */
  function makeRow(joints) {
    const starts = joints.map((j) => modPos(j, SIZE)).sort((a, b) => a - b);
    const n = starts.length;
    const seg = new Uint8Array(SIZE);
    for (let x = 0; x < SIZE; x++) {
      let s = n - 1; // before the first joint = tail of the last plank (it wraps around the edge)
      for (let i = 0; i < n; i++) if (starts[i] <= x + 0.5) s = i;
      seg[x] = s;
    }
    const lens = starts.map((s, i) => (i + 1 < n ? starts[i + 1] : starts[0] + SIZE) - s);
    return { starts, lens, seg };
  }
  /** Lay out `cfg.rows` rows with staggered end joints (also between the last and the first row). */
  function layoutRows(cfg, rng) {
    const rows = [];
    for (let r = 0; r < cfg.rows; r++) {
      const prev = r > 0 ? rows[r - 1].starts : null;
      const first = r === cfg.rows - 1 && r > 0 ? rows[0].starts : null;
      let joints = null;
      for (let attempt = 0; attempt < 80 && !joints; attempt++) {
        const cand = (cfg.pickJoints || randomJoints)(cfg, rng, r);
        if (staggerOK(cand, prev, cfg.minStagger) && staggerOK(cand, first, cfg.minStagger)) joints = cand;
      }
      rows.push(makeRow(joints || (cfg.pickJoints || randomJoints)(cfg, rng, r)));
    }
    return rows;
  }
  /** Render every pixel with its plank: surface(x, y, plank, lx (along), ly (across), len, rowH, row) writes C. */
  function renderPlanks(img, rows, edge, surface) {
    const rowH = SIZE / rows.length;
    for (let y = 0; y < SIZE; y++) {
      const cy = y + 0.5, r = Math.floor(cy / rowH), ly = cy - r * rowH, row = rows[r];
      for (let x = 0; x < SIZE; x++) {
        const s = row.seg[x], len = row.lens[s], lx = modPos(x + 0.5 - row.starts[s], SIZE);
        surface(x, y, row.planks[s], lx, ly, len, rowH, row);
        applyEdges(lx, len - lx, ly, rowH - ly, edge, x, y);
        storeC(img, x, y);
      }
    }
  }

  // ------------------------------------------------------------------ wood figure
  /** Random growth-ring geometry of one plank (flat-sawn "cathedral" or straight rift grain, optional knot). */
  function makePlank(P, rng, len, rowH) {
    const cathedral = rng() < P.cathedral;
    const [f0, f1] = P.freq;
    const plank = {
      id: (rng() * 1e9) | 0,
      tone: (rng() - 0.5) * 2 * P.toneVar,
      tint: (rng() - 0.5) * 2 * P.tintVar,
      freq: f0 + (f1 - f0) * rng(),
      pith: cathedral ? rowH * (0.15 + rng() * 0.7) : rowH * (rng() < 0.5 ? -3 - rng() * 4 : 4 + rng() * 4),
      depth: cathedral ? 4 + rng() * 22 : rng() * 6,
      taper: cathedral ? (rng() < 0.5 ? -1 : 1) * (0.03 + rng() * 0.06) : (rng() - 0.5) * 0.01,
      ox: (rng() * SIZE) | 0,
      oy: (rng() * SIZE) | 0,
      knot: null,
    };
    if (len > rowH * 2.5 && rng() < P.knotChance) {
      const r = rowH * (0.05 + rng() * 0.07);
      plank.knot = { x: len * (0.15 + rng() * 0.7), y: rowH * (0.3 + rng() * 0.4), r, r2: r * r };
    }
    return plank;
  }
  /** Wood colour of a plank pixel into C. F = shared fields { warp, streak, figure }. */
  function woodColor(P, F, seed, x, y, pk, lx, ly) {
    const k = ((y + pk.oy) & MASK) * SIZE + ((x + pk.ox) & MASK);
    const dz = pk.depth + pk.taper * lx, dy = ly - pk.pith, fig = F.figure[k] - 0.5;
    let rho = Math.sqrt(dy * dy + dz * dz) + (F.warp[k] - 0.5) * P.warpAmp;
    let knot = 0;
    if (pk.knot) {
      const kx = (lx - pk.knot.x) * 0.45, ky = ly - pk.knot.y, d2 = kx * kx + ky * ky;
      rho += (P.knotSwirl * pk.knot.r2) / (d2 + pk.knot.r2); // rings bend around the knot
      knot = smoothstep(pk.knot.r2 * 1.3, pk.knot.r2 * 0.35, d2);
    }
    // irregular ring spacing and per-ring strength: earlywood fades into a darker latewood band
    const ring = rho * pk.freq + fig * P.ringJitter, ri = Math.floor(ring), g = ring - ri;
    const late = smoothstep(0.3, 0.97, g) * (0.45 + 0.55 * hash2(ri, pk.id, seed));
    let t = P.t0 + pk.tone + late * late * P.ringC + (F.streak[k] - 0.5) * P.streakC + fig * P.figC;
    if (P.pores && hash2(x >> 2, y, seed) > 0.93) t += P.pores; // open pores: short dark dashes along the grain
    t = clamp01(t);
    C[0] = P.light[0] + (P.dark[0] - P.light[0]) * t;
    C[1] = P.light[1] + (P.dark[1] - P.light[1]) * t;
    C[2] = P.light[2] + (P.dark[2] - P.light[2]) * t;
    tintC(pk.tint);
    if (knot > 0) mixC(P.knotColor, knot * (0.75 + 0.25 * Math.sin(Math.sqrt(dy * dy + 1) * 0.9)));
  }
  function woodFields(seed) {
    return {
      warp: fbmField({ px: 2, py: 16, octaves: 4, gain: 0.5, seed: seed + 11 }),
      streak: fbmField({ px: 1, py: 64, octaves: 3, gain: 0.65, seed: seed + 23 }),
      figure: fbmField({ px: 4, py: 8, octaves: 3, gain: 0.5, seed: seed + 37 }),
    };
  }
  /** Generic plank floor. P = palette & layout params (see WOOD_* below). extra(x,y,pk,lx,ly,len,rowH,row) optional. */
  function genPlanks(img, seed, P, extra) {
    const rng = mulberry32(seed);
    const rowH = SIZE / P.rows;
    const rows = layoutRows(P, rng).map((row) => {
      const withPlanks = { starts: row.starts, lens: row.lens, seg: row.seg, planks: row.lens.map((len) => makePlank(P, rng, len, rowH)) };
      return P.decorateRow ? P.decorateRow(withPlanks) : withPlanks;
    });
    const F = woodFields(seed);
    renderPlanks(img, rows, edgeSpec(P.edge, seed), (x, y, pk, lx, ly, len, rh, row) => {
      woodColor(P, F, seed, x, y, pk, lx, ly);
      if (extra) extra(x, y, pk, lx, ly, len, rh, row);
    });
  }

  // Hot-loop configs are always built by these literal factories: objects made with Object.assign/spread get a
  // slower property layout in V8 (measured ~2× slower wood generation), and one shared shape keeps call sites
  // monomorphic across materials.
  function edgeSpec(e, seed) {
    return { half: e.half, bevel: e.bevel, depth: e.depth, joint: e.joint, grain: e.grain || 0, seed: seed | 0 };
  }
  const WOOD_DEFAULTS = {
    rows: 10, twoJointProb: 0.45, minStagger: 95, cathedral: 0.6,
    light: [222, 190, 147], dark: [146, 104, 64], knotColor: [86, 56, 32],
    t0: 0.24, ringC: 0.5, streakC: 0.55, figC: 0.4, warpAmp: 9, ringJitter: 1.6, knotSwirl: 7, freq: [1 / 7.5, 1 / 4.2],
    toneVar: 0.12, tintVar: 0.03, knotChance: 0.32, pores: 0.07,
    edge: { half: 0.4, bevel: 1.3, depth: 0.2, joint: [84, 60, 38], grain: 0.1 },
    pickJoints: null, // (cfg, rng, rowIndex) → joint x positions; default: randomJoints
    decorateRow: null, // (row) → new row with extra per-row data
  };
  function woodParams(over) {
    const o = Object.assign({}, WOOD_DEFAULTS, over);
    return {
      rows: o.rows, twoJointProb: o.twoJointProb, minStagger: o.minStagger, cathedral: o.cathedral,
      light: o.light, dark: o.dark, knotColor: o.knotColor,
      t0: o.t0, ringC: o.ringC, streakC: o.streakC, figC: o.figC, warpAmp: o.warpAmp, ringJitter: o.ringJitter,
      knotSwirl: o.knotSwirl, freq: o.freq, toneVar: o.toneVar, tintVar: o.tintVar, knotChance: o.knotChance, pores: o.pores,
      edge: o.edge, pickJoints: o.pickJoints, decorateRow: o.decorateRow,
    };
  }
  const WOOD_OAK = woodParams({});
  const WOOD_WALNUT = woodParams({
    light: [146, 102, 70], dark: [52, 32, 22], knotColor: [30, 19, 13], cathedral: 0.7,
    t0: 0.3, ringC: 0.46, streakC: 0.75, figC: 0.6, warpAmp: 13, ringJitter: 2.4, freq: [1 / 10, 1 / 5.5],
    toneVar: 0.13, tintVar: 0.035, knotChance: 0.14, pores: 0.05,
    edge: { half: 0.4, bevel: 1.3, depth: 0.24, joint: [30, 20, 14], grain: 0.1 },
  });
  const WOOD_VINYL = woodParams({
    rows: 10, twoJointProb: 0.65, minStagger: 80,
    light: [216, 204, 186], dark: [168, 150, 126], knotColor: [138, 116, 92],
    t0: 0.26, ringC: 0.36, streakC: 0.4, figC: 0.25, warpAmp: 7, ringJitter: 1.2,
    toneVar: 0.06, tintVar: 0.015, knotChance: 0.08, pores: 0.02,
    edge: { half: 0.35, bevel: 1.4, depth: 0.14, joint: [128, 114, 98], grain: 0.08 },
  });
  const DECK_JOISTS = 3;
  const DECK_JOIST_X = Array.from({ length: DECK_JOISTS }, (_, j) => ((j + 0.5) * SIZE) / DECK_JOISTS);
  const WOOD_DECK = woodParams({
    rows: 8, minStagger: 100, cathedral: 0.35,
    light: [164, 108, 72], dark: [96, 56, 34], knotColor: [58, 34, 20],
    t0: 0.3, ringC: 0.32, streakC: 0.85, figC: 0.45, warpAmp: 5, ringJitter: 1.2, freq: [1 / 6, 1 / 3.5],
    toneVar: 0.15, tintVar: 0.05, knotChance: 0.06, pores: 0.05,
    edge: { half: 1.3, bevel: 2.6, depth: 0.34, joint: [30, 22, 17], grain: 0.3 },
    // board ends always land on a joist; each row remembers at which joists its boards end
    pickJoints: (cfg, rng) => [DECK_JOIST_X[Math.floor(rng() * DECK_JOISTS)]],
    decorateRow: (row) => ({
      starts: row.starts, lens: row.lens, seg: row.seg, planks: row.planks,
      joistEnds: DECK_JOIST_X.map((X) => row.starts.some((s) => circularGap(s, X) < 1)),
    }),
  });

  // ================================================================== material generators
  // Each gen(img, seed) fills the Float32 RGB buffer. Keep them fast (< 40 ms) and fully periodic.

  /** Porcelanato 60×60, retificado, cinza claro quente — 2×2 tiles (1,20 m). */
  function genPorcelanato(img, seed) {
    const cloud = fbmField({ px: 3, octaves: 5, gain: 0.55, seed });
    const veil = fbmField({ px: 24, octaves: 3, gain: 0.6, seed: seed + 1 });
    const base = [215, 209, 200];
    renderTiles(img, {
      nx: 2, ny: 2, seed,
      edge: { half: 0.55, bevel: 1.6, depth: 0.1, joint: [176, 171, 163], grain: 0.12 },
      surface(x, y, t) {
        const f = 1 + t.tone * 0.035 + (at(cloud, x + t.ox, y + t.oy) - 0.5) * 0.09 + (at(veil, x + t.ox, y + t.oy) - 0.5) * 0.07 +
          (hash2(x, y, seed + 3) - 0.5) * 0.025;
        setC(base, f);
        tintC(t.tint * 0.02);
      },
    });
  }

  /** Mármore Calacatta 80×80 — soft branching grey/gold veins, each tile cut from a different part of the slab. */
  function genMarmore(img, seed) {
    const { vein, halo } = marbleVeins(seed);
    const cloud = fbmField({ px: 3, octaves: 3, gain: 0.55, seed: seed + 5 });
    const base = [241, 238, 233], gold = [201, 180, 142], grey = [112, 108, 104];
    renderTiles(img, {
      nx: 2, ny: 2, seed,
      edge: { half: 0.45, bevel: 1.2, depth: 0.06, joint: [206, 201, 193], grain: 0.08 },
      surface(x, y, t) {
        let sx = x + t.ox, sy = y + t.oy; // each tile samples the slab at another spot / orientation
        if (t.variant & 1) [sx, sy] = [sy, sx];
        if (t.variant & 2) sx = MASK - sx;
        const k = (sy & MASK) * SIZE + (sx & MASK);
        setC(base, 1 + t.tone * 0.025 + (cloud[k] - 0.5) * 0.09);
        mixC(gold, halo[k] * 0.3);
        mixC(grey, vein[k] * 0.8);
      },
    });
  }
  /** Periodic vein fields: zero crossings of warped sines with integer frequencies (so they wrap). */
  function marbleVeins(seed) {
    const W1 = fbmField({ px: 2, octaves: 4, gain: 0.5, seed: seed + 1 });
    const W2 = fbmField({ px: 3, octaves: 3, gain: 0.5, seed: seed + 2 });
    const M = fbmField({ px: 2, octaves: 2, gain: 0.5, seed: seed + 3 });
    const vein = new Float32Array(SIZE * SIZE), halo = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      const v = (y + 0.5) / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const k = y * SIZE + x, u = (x + 0.5) / SIZE, w1 = W1[k], w2 = W2[k], m = M[k];
        // main veins: broad soft body + darker core, fading in and out along their length
        const s1 = Math.abs(Math.sin(TAU * (u + 2 * v + 1.7 * w1 + 0.25 * w2)));
        const main = smoothstep(0.34, 0.58, m);
        // secondary veins branch off where the warp field is high; hairlines everywhere, faint
        const s2 = Math.abs(Math.sin(TAU * (3 * u - v + 1.4 * w2 + 0.8 * w1)));
        const branch = smoothstep(0.5, 0.64, w1 + (m - 0.5) * 0.6);
        const s3 = Math.abs(Math.sin(TAU * (2 * u + 5 * v + 1.2 * w1 + 0.4 * w2)));
        const body = veinLine(s1, 0.16) * 0.42 + veinLine(s1, 0.045) * 0.58;
        vein[k] = Math.max(body * main, veinLine(s2, 0.035) * 0.45 * branch, veinLine(s3, 0.022) * 0.12);
        halo[k] = veinLine(s1, 0.34) * main + veinLine(s2, 0.12) * 0.3 * branch;
      }
    }
    return { vein, halo };
  }
  /** Soft line profile from |sin| (≈ distance to the vein centre in phase units). */
  function veinLine(s, w) {
    return s >= w ? 0 : fade(1 - s / w);
  }

  /** Cerâmica 45×45 branco-bege (banheiros) — 4×4 tiles (1,80 m), cushioned edges. */
  function genCeramica(img, seed) {
    const cloud = fbmField({ px: 4, octaves: 5, gain: 0.5, seed });
    const base = [234, 229, 220];
    renderTiles(img, {
      nx: 4, ny: 4, seed,
      edge: { half: 0.55, bevel: 2.2, depth: 0.12, joint: [192, 186, 176], grain: 0.12 },
      surface(x, y, t) {
        setC(base, 1 + t.tone * 0.03 + (at(cloud, x + t.ox, y + t.oy) - 0.5) * 0.07 + (hash2(x, y, seed + 9) - 0.5) * 0.02);
        tintC(t.tint * 0.025);
      },
    });
  }

  /** Cerâmica antiderrapante 45×45 — sandy terracotta, gritty surface, wider grout — 4×4 tiles (1,80 m). */
  function genCeramicaExt(img, seed) {
    const cloud = fbmField({ px: 4, octaves: 5, gain: 0.55, seed });
    const base = [192, 146, 110];
    renderTiles(img, {
      nx: 4, ny: 4, seed,
      edge: { half: 0.85, bevel: 2.6, depth: 0.2, joint: [126, 114, 102], grain: 0.2 },
      surface(x, y, t) {
        const grit = hash2(x, y, seed + 5);
        let f = 1 + t.tone * 0.1 + (at(cloud, x + t.ox, y + t.oy) - 0.5) * 0.16 + (grit - 0.5) * 0.14;
        if (grit > 0.985) f -= 0.18; // dark grains
        else if (grit < 0.012) f += 0.12; // quartz-like light grains
        setC(base, f);
        tintC(t.tint * 0.06);
      },
    });
  }

  /** Ladrilho hidráulico 20×20 — cement tile with a rosette formed across 4 tiles — 4×4 tiles (0,80 m). */
  function genLadrilho(img, seed) {
    const mottle = fbmField({ px: 8, octaves: 4, gain: 0.55, seed });
    const wear = fbmField({ px: 3, octaves: 4, gain: 0.5, seed: seed + 1 });
    const cream = [228, 216, 192], terra = [168, 96, 72], teal = [58, 112, 110], worn = [204, 196, 182];
    renderTiles(img, {
      nx: 4, ny: 4, seed,
      edge: { half: 0.5, bevel: 1.4, depth: 0.08, joint: [170, 163, 150], grain: 0.15 },
      surface(x, y, t, lx, ly, tw) {
        hydraulicMotif((lx / tw) * 2 - 1, (ly / tw) * 2 - 1, tw / 2, cream, terra, teal);
        const k = y * SIZE + x;
        scaleC(1 + (mottle[k] - 0.5) * 0.14 + (hash2(x, y, seed + 7) - 0.5) * 0.06 + t.tone * 0.04);
        mixC(worn, smoothstep(0.62, 0.76, wear[k]) * 0.2);
      },
    });
  }
  /** Motif in tile coords u,v ∈ [-1,1]; `ppu` = pixels per unit for antialiasing. Writes C. */
  function hydraulicMotif(u, v, ppu, cream, terra, teal) {
    const au = Math.abs(u), av = Math.abs(v);
    setC(cream, 1);
    // lozenges centred on the edge midpoints (completed by the neighbouring tile)
    const loz = Math.min(au + (1 - av) * 1.6 - 0.28, av + (1 - au) * 1.6 - 0.28) / 1.887;
    mixC(teal, coverage(loz, ppu));
    // quarter circles in the corners → full rosettes where 4 tiles meet
    const cu = 1 - au, cv = 1 - av, dc = Math.sqrt(cu * cu + cv * cv);
    mixC(teal, coverage(dc - 0.62, ppu));
    mixC(cream, coverage(dc - 0.53, ppu));
    mixC(terra, coverage(dc - 0.44, ppu));
    mixC(cream, coverage(dc - 0.21, ppu));
    mixC(teal, coverage(dc - 0.12, ppu));
    // 8-point star (square ∪ diamond) in the centre
    const sq = Math.max(au, av), di = (au + av) / Math.SQRT2, dm = Math.sqrt(u * u + v * v);
    mixC(terra, coverage(Math.min(sq, di) - 0.4, ppu));
    mixC(cream, coverage(Math.min(sq, di) - 0.31, ppu));
    mixC(teal, coverage(dm - 0.16, ppu));
    mixC(cream, coverage(dm - 0.065, ppu));
  }
  /** Antialiased coverage of a signed distance (units) at `ppu` pixels per unit. */
  function coverage(sd, ppu) {
    return clamp01(0.5 - sd * ppu);
  }

  /** Cimento queimado — continuous burnished cement, cloudy mottling, trowel arcs, pinholes (2,40 m). */
  function genCimento(img, seed) {
    const cloud = fbmField({ px: 2, octaves: 6, gain: 0.55, seed });
    const mott = fbmField({ px: 8, octaves: 4, gain: 0.5, seed: seed + 1 });
    const trowel = trowelField(seed + 2, { count: 110, radius: [70, 220], width: [18, 42], amp: 0.024 });
    const base = [170, 167, 160];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const k = y * SIZE + x, c = cloud[k];
        let f = 1 + (c - 0.5) * 0.3 + (mott[k] - 0.5) * 0.12 + trowel[k] - smoothstep(0.56, 0.72, c) * 0.06;
        const pin = hash2(x, y, seed + 3);
        if (pin > 0.9965) f -= 0.22;
        f += (pin - 0.5) * 0.02;
        setC(base, f);
        tintC((mott[k] - 0.5) * 0.04);
        storeC(img, x, y);
      }
  }
  /**
   * Sum of trowel arcs (burnished band with a slightly darker outer lip), stamped with wrap-around.
   * o = { count, radius:[min,max], width:[min,max], amp } (px / brightness fraction).
   */
  function trowelField(seed, o) {
    const field = new Float32Array(SIZE * SIZE);
    const rng = mulberry32(seed);
    const pick = (r) => r[0] + rng() * (r[1] - r[0]);
    for (let i = 0; i < o.count; i++) {
      stampArc(field, {
        cx: rng() * SIZE, cy: rng() * SIZE, R: pick(o.radius),
        a0: rng() * TAU, sweep: 0.5 + rng() * 0.8,
        w: pick(o.width), amp: o.amp * (0.4 + rng() * 0.6) * (rng() < 0.35 ? -1 : 1),
      });
    }
    return field;
  }
  function stampArc(field, a) {
    const mid = a.a0 + a.sweep / 2, mx = Math.cos(mid), my = Math.sin(mid), cosHalf = Math.cos(a.sweep / 2);
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let i = 0; i <= 12; i++) {
      const ang = a.a0 + (a.sweep * i) / 12, px = a.cx + Math.cos(ang) * a.R, py = a.cy + Math.sin(ang) * a.R;
      bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py);
    }
    const hw = a.w / 2;
    for (let y = Math.floor(by0 - hw); y <= Math.ceil(by1 + hw); y++)
      for (let x = Math.floor(bx0 - hw); x <= Math.ceil(bx1 + hw); x++) {
        const dx = x + 0.5 - a.cx, dy = y + 0.5 - a.cy, d = Math.sqrt(dx * dx + dy * dy);
        const across = (d - a.R) / hw;
        if (across <= -1 || across >= 1 || d < 1e-6) continue;
        const cosA = (dx * mx + dy * my) / d;
        if (cosA <= cosHalf) continue;
        const taper = smoothstep(0, 0.45, (cosA - cosHalf) / (1 - cosHalf));
        const profile = (1 - across * across) * (1 - across * across) - 0.35 * smoothstep(0.6, 0.95, across);
        field[(y & MASK) * SIZE + (x & MASK)] += a.amp * taper * profile;
      }
  }

  /** Concreto desempenado (garagem) — speckled aggregate, stains, saw-cut joints every 1,50 m (3,00 m). */
  function genConcreto(img, seed) {
    const cloud = fbmField({ px: 2, octaves: 6, gain: 0.55, seed });
    const stain = fbmField({ px: 4, octaves: 4, gain: 0.55, seed: seed + 1 });
    const swirl = trowelField(seed + 2, { count: 50, radius: [90, 220], width: [14, 30], amp: 0.018 });
    const base = [154, 152, 147];
    renderTiles(img, {
      nx: 2, ny: 2, seed,
      edge: { half: 0.75, bevel: 0.9, depth: 0.14, joint: [70, 68, 65], grain: 0.35 },
      surface(x, y) {
        const k = y * SIZE + x, h = hash2(x, y, seed + 4), stone = hash2(x >> 1, y >> 1, seed + 5);
        let f = 1 + (cloud[k] - 0.5) * 0.18 + (h - 0.5) * 0.08 + swirl[k] - smoothstep(0.58, 0.8, stain[k]) * 0.045;
        if (stone > 0.993) f += 0.08;
        else if (stone < 0.005) f -= 0.1;
        setC(base, f);
        tintC((stain[k] - 0.5) * 0.03);
      },
    });
  }

  /** Carpete buclê — fine fibre noise, loop rows, heather flecks (0,80 m). */
  function genCarpete(img, seed) {
    const cloud = fbmField({ px: 4, octaves: 4, gain: 0.5, seed });
    const base = [150, 140, 128];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const h = hash2(x, y, seed + 1), loops = Math.sin((TAU * x) / 4) * Math.sin((TAU * (y + (x >> 2 & 1) * 2)) / 4);
        let f = 1 + (h - 0.5) * 0.2 + (cloud[y * SIZE + x] - 0.5) * 0.1 + loops * 0.035;
        if (h > 0.975) f += 0.12; // heather fleck
        setC(base, f);
        storeC(img, x, y);
      }
  }

  /** Deck de madeira — boards 14 cm + 5 mm gaps, ends on joists, stainless screws, weathering (1,16 m). */
  function genDeck(img, seed) {
    const weather = fbmField({ px: 1, py: 8, octaves: 4, gain: 0.55, seed: seed + 91 });
    const silver = [128, 118, 106];
    genPlanks(img, seed, WOOD_DECK, (x, y, pk, lx, ly, len, rowH, row) => {
      mixC(silver, smoothstep(0.55, 0.75, weather[y * SIZE + x]) * 0.25);
      // joist centres sit mid-cell, never within 10 px of the canvas edge → no wrap needed here
      const j = Math.floor(((x + 0.5) * DECK_JOISTS) / SIZE);
      const dx = x + 0.5 - DECK_JOIST_X[j];
      if (dx < -10 || dx > 10) return;
      const sx = row.joistEnds[j] ? (dx < 0 ? -5 : 5) : 0; // board ends get their screws either side of the joint
      drawScrew(dx - sx, ly - rowH * 0.28);
      drawScrew(dx - sx, ly - rowH * 0.7);
    });
  }
  function drawScrew(dx, dy) {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 2.8) return;
    scaleC(1 - 0.28 * smoothstep(2.8, 1.8, d)); // countersink
    if (d < 1.7) {
      const lit = 1 + (-dx - dy) * 0.12;
      C[0] = 96 * lit;
      C[1] = 92 * lit;
      C[2] = 88 * lit;
    }
  }

  /** Grama esmeralda — patchy base, thousands of wrapped blade strokes (1,20 m). */
  function genGrama(img, seed) {
    const patch = fbmField({ px: 2, octaves: 5, gain: 0.55, seed });
    const soil = [48, 72, 32], lush = [76, 118, 46];
    for (let k = 0, p = 0; p < SIZE * SIZE; p++, k += 3) {
      const t = patch[p];
      img[k] = soil[0] + (lush[0] - soil[0]) * t;
      img[k + 1] = soil[1] + (lush[1] - soil[1]) * t;
      img[k + 2] = soil[2] + (lush[2] - soil[2]) * t;
    }
    const rng = mulberry32(seed + 1);
    for (let i = 0; i < 16000; i++) drawBlade(img, rng, patch);
  }
  const BLADE_DARK = [66, 108, 40], BLADE_LIGHT = [118, 160, 64], BLADE_DRY = [156, 152, 88];
  function drawBlade(img, rng, patch) {
    const x0 = rng() * SIZE, y0 = rng() * SIZE, ang = rng() * TAU, len = 5 + rng() * 9, bend = (rng() - 0.5) * 0.08;
    const p = at(patch, x0 | 0, y0 | 0), shade = rng();
    const dry = rng() < smoothstep(0.55, 0.75, p) * 0.35;
    const col = [0, 0, 0];
    const steps = Math.ceil(len * 2);
    let a = ang, x = x0, y = y0;
    for (let s = 0; s <= steps; s++) {
      const tip = s / steps, light = clamp01(shade * 0.7 + tip * 0.45 + (p - 0.5));
      const src = dry ? BLADE_DRY : BLADE_DARK;
      for (let c = 0; c < 3; c++) col[c] = src[c] + (BLADE_LIGHT[c] - src[c]) * (dry ? tip * 0.3 : light);
      splat(img, x, y, col, 0.85 * (1 - tip * 0.5));
      a += bend;
      x += Math.cos(a) * 0.5;
      y += Math.sin(a) * 0.5;
    }
  }

  /** Calçada — placas de concreto 40×40, washed fine aggregate — 4×4 plates (1,60 m). */
  function genCalcada(img, seed) {
    const cloud = fbmField({ px: 4, octaves: 5, gain: 0.55, seed });
    const base = [184, 178, 167];
    renderTiles(img, {
      nx: 4, ny: 4, seed,
      edge: { half: 1.1, bevel: 2.2, depth: 0.2, joint: [104, 98, 90], grain: 0.3 },
      surface(x, y, t) {
        const h = hash2(x, y, seed + 2), stone = hash2(x >> 1, y >> 1, seed + 3);
        let f = 1 + t.tone * 0.06 + (at(cloud, x + t.ox, y + t.oy) - 0.5) * 0.16 + (h - 0.5) * 0.12;
        if (stone > 0.975) f -= 0.1;
        setC(base, f);
        tintC(t.tint * 0.012);
      },
    });
  }

  // ------------------------------------------------------------------ interlocking pavers (herringbone)
  const HB_N = 4; // herringbone period in cells
  const DIR = { R: 0, L: 1, D: 2, U: 3 };
  /**
   * 90° herringbone of 1×2 bricks: brick pair {H at (0,0)-(1,0), V at (0,1)-(0,2)} repeated by the lattice
   * m·(1,1) + n·(2,−2), which contains (4,0) and (0,4) → a 4×4-cell periodic map of partner directions.
   */
  function buildHerringbone() {
    const partner = new Int8Array(HB_N * HB_N).fill(-1);
    const seen = new Set();
    const place = (cells, dirs) => {
      const wrapped = cells.map(([cx, cy]) => [modPos(cx, HB_N), modPos(cy, HB_N)]);
      const key = wrapped.map((c) => c.join(',')).join('|') + dirs.join('');
      if (seen.has(key)) return;
      seen.add(key);
      wrapped.forEach(([cx, cy], i) => {
        const idx = cy * HB_N + cx;
        if (partner[idx] !== -1) throw new Error('herringbone overlap at ' + cx + ',' + cy);
        partner[idx] = dirs[i];
      });
    };
    for (let m = 0; m < HB_N; m++)
      for (let n = 0; n < HB_N; n++) {
        const ox = m + 2 * n, oy = m - 2 * n;
        place([[ox, oy], [ox + 1, oy]], [DIR.R, DIR.L]);
        place([[ox, oy + 1], [ox, oy + 2]], [DIR.D, DIR.U]);
      }
    return partner;
  }
  let herringbone = null;
  /** Piso intertravado — concrete pavers 10×20 in herringbone, chamfered edges, sand joints (3,20 m). */
  function genIntertravado(img, seed) {
    herringbone = herringbone || buildHerringbone();
    const cell = 16, cells = SIZE / cell; // 100 mm per cell
    const cloud = fbmField({ px: 4, octaves: 5, gain: 0.55, seed });
    const base = [150, 146, 140];
    const edge = edgeSpec({ half: 0.6, bevel: 2.4, depth: 0.3, joint: [178, 162, 130], grain: 0.35 }, seed);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const ci = x >> 4, cj = y >> 4, dir = herringbone[(cj % HB_N) * HB_N + (ci % HB_N)];
        const ax = (dir === DIR.L ? ci - 1 : ci) & (cells - 1), ay = (dir === DIR.U ? cj - 1 : cj) & (cells - 1);
        const tone = hash2(ax, ay, seed) - 0.5, ox = (hash2(ax, ay, seed + 1) * SIZE) | 0;
        const fx = (x & 15) + 0.5, fy = (y & 15) + 0.5, h = hash2(x, y, seed + 2);
        setC(base, 1 + tone * 0.09 + (at(cloud, x + ox, y + ox) - 0.5) * 0.14 + (h - 0.5) * 0.1);
        tintC(tone * 0.025);
        applyEdges(
          fx + (dir === DIR.L ? cell : 0), cell - fx + (dir === DIR.R ? cell : 0),
          fy + (dir === DIR.U ? cell : 0), cell - fy + (dir === DIR.D ? cell : 0), edge, x, y
        );
        storeC(img, x, y);
      }
  }

  // ================================================================== registry
  const GROUP = { cer: 'Cerâmicos', mad: 'Madeiras', ped: 'Pedras e cimentícios', tex: 'Têxteis', ext: 'Externos' };
  // base = measured average colour of the generated texture (verified by tools/test-materials.js).
  const DEFS = [
    { id: 'porcelanato', name: 'Porcelanato 60×60', group: GROUP.cer, tileMM: 1200, base: '#d9d2c8', desc: 'Retificado, cinza claro quente, rejunte fino', gen: genPorcelanato },
    { id: 'ceramica', name: 'Cerâmica 45×45', group: GROUP.cer, tileMM: 1800, base: '#e8e4db', desc: 'Branco-bege acetinado, ideal para banheiros', gen: genCeramica },
    { id: 'madeira', name: 'Carvalho natural', group: GROUP.mad, tileMM: 1900, base: '#c19f76', desc: 'Tábuas de 19 cm com juntas desencontradas', gen: (img, s) => genPlanks(img, s, WOOD_OAK), swatchFrac: 0.6 },
    { id: 'madeiraEscura', name: 'Nogueira', group: GROUP.mad, tileMM: 1900, base: '#6f4b33', desc: 'Tábuas de 19 cm em tom escuro', gen: (img, s) => genPlanks(img, s, WOOD_WALNUT), swatchFrac: 0.6 },
    { id: 'vinilico', name: 'Vinílico claro', group: GROUP.mad, tileMM: 1800, base: '#c9baa6', desc: 'Réguas de 18 cm, padrão carvalho claro', gen: (img, s) => genPlanks(img, s, WOOD_VINYL), swatchFrac: 0.6 },
    { id: 'marmore', name: 'Mármore Calacatta 80×80', group: GROUP.ped, tileMM: 1600, base: '#eeebe6', desc: 'Branco com veios cinza e dourados', gen: genMarmore },
    { id: 'ladrilho', name: 'Ladrilho hidráulico 20×20', group: GROUP.ped, tileMM: 800, base: '#beb19c', desc: 'Cimento pigmentado, terracota, verde-petróleo e creme', gen: genLadrilho, swatchFrac: 0.5 },
    { id: 'cimento', name: 'Cimento queimado', group: GROUP.ped, tileMM: 2400, base: '#a7a49d', desc: 'Contínuo, mesclado, com marcas de desempeno', gen: genCimento },
    { id: 'concreto', name: 'Concreto desempenado', group: GROUP.ped, tileMM: 3000, base: '#9b9994', desc: 'Juntas serradas a cada 1,50 m', gen: genConcreto },
    { id: 'carpete', name: 'Carpete buclê', group: GROUP.tex, tileMM: 800, base: '#978d81', desc: 'Fibra fina, bege acinzentado', gen: genCarpete, swatchFrac: 0.35 },
    { id: 'ceramicaExt', name: 'Cerâmica antiderrapante 45×45', group: GROUP.ext, tileMM: 1800, base: '#be916d', desc: 'Áreas externas, acabamento áspero', gen: genCeramicaExt },
    { id: 'deck', name: 'Deck de madeira', group: GROUP.ext, tileMM: 1160, base: '#86583b', desc: 'Réguas de 14 cm com parafusos aparentes', gen: genDeck, swatchFrac: 0.6 },
    { id: 'grama', name: 'Grama esmeralda', group: GROUP.ext, tileMM: 1200, base: '#547831', desc: 'Gramado', gen: genGrama, site: true, swatchFrac: 0.5 },
    { id: 'calcada', name: 'Calçada de concreto 40×40', group: GROUP.ext, tileMM: 1600, base: '#b3ada2', desc: 'Placas de concreto com juntas', gen: genCalcada, site: true },
    { id: 'intertravado', name: 'Piso intertravado', group: GROUP.ext, tileMM: 3200, base: '#99938b', desc: 'Paver 10×20 em espinha de peixe', gen: genIntertravado, site: true, swatchFrac: 0.5 },
  ];
  const FALLBACK_ID = 'porcelanato';
  const BY_ID = new Map(DEFS.map((d) => [d.id, d]));

  function publicEntry(d) {
    const e = { id: d.id, name: d.name, group: d.group, tileMM: d.tileMM, base: d.base, desc: d.desc };
    if (d.site) e.site = true;
    return Object.freeze(e);
  }
  const LIST = Object.freeze(DEFS.map(publicEntry));
  const LIST_BY_ID = new Map(LIST.map((e) => [e.id, e]));
  const resolveDef = (id) => BY_ID.get(id) || BY_ID.get(FALLBACK_ID);

  /** Pure generation (no DOM): RGBA bytes of the 512×512 texture. Deterministic per material id. */
  function generate(id) {
    const def = resolveDef(id);
    const img = newImage();
    def.gen(img, hashString('dd-material:' + def.id));
    return toRGBA(img);
  }

  // ================================================================== DOM layer (canvas, swatches)
  const canvasCache = new Map();
  const swatchCache = new Map();

  function createCanvas(size) {
    if (typeof document === 'undefined') throw new Error('DD.materials: canvas indisponível fora do navegador.');
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
  }
  function paintRGBA(c, rgba) {
    const ctx = c.getContext('2d');
    const data = ctx.createImageData(SIZE, SIZE);
    data.data.set(rgba);
    ctx.putImageData(data, 0, 0);
  }
  function paintFlat(c, hex) {
    const ctx = c.getContext('2d');
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  /** Cached, seamless 512×512 canvas of a material (falls back to porcelanato for unknown ids). */
  function canvas(id) {
    const def = resolveDef(id);
    const cached = canvasCache.get(def.id);
    if (cached) return cached;
    const c = createCanvas(SIZE);
    try {
      paintRGBA(c, generate(def.id));
    } catch (err) {
      console.error('[DD.materials] falha ao gerar a textura "' + def.id + '"', err);
      paintFlat(c, def.base);
    }
    canvasCache.set(def.id, c);
    return c;
  }
  /** Downscale by successive halving (crisp swatches in every browser), from a crop of `crop` px. */
  function downscale(src, crop, size) {
    let cur = src, curSize = crop;
    while (curSize / 2 >= size * 1.5) {
      const next = createCanvas(Math.round(curSize / 2));
      const ctx = next.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, 0, 0, curSize, curSize, 0, 0, next.width, next.height);
      cur = next;
      curSize = next.width;
    }
    const out = createCanvas(size);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, curSize, curSize, 0, 0, size, size);
    return out;
  }
  /** Square preview dataURL for UI pickers (cached per id and size). */
  function swatch(id, px) {
    const def = resolveDef(id);
    const size = Math.max(8, Math.min(SIZE, Math.round(Number(px) || 64)));
    const key = def.id + '|' + size;
    const cached = swatchCache.get(key);
    if (cached) return cached;
    let url = '';
    try {
      url = downscale(canvas(def.id), Math.round(SIZE * (def.swatchFrac || 1)), size).toDataURL('image/png');
    } catch (err) {
      console.error('[DD.materials] falha ao gerar a amostra "' + def.id + '"', err);
      const c = createCanvas(size);
      paintFlat(c, def.base);
      url = c.toDataURL('image/png');
    }
    swatchCache.set(key, url);
    return url;
  }
  /**
   * Optional: generate textures during idle time so the first 3D build / paint is instant.
   * Returns a cancel function. Safe to call more than once.
   */
  function prewarm(ids) {
    const queue = (ids || DEFS.map((d) => d.id)).filter((id) => !canvasCache.has(resolveDef(id).id));
    let cancelled = false;
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 16);
    const step = () => {
      if (cancelled || !queue.length) return;
      canvas(queue.shift());
      idle(step);
    };
    idle(step);
    return () => {
      cancelled = true;
    };
  }

  DD.materials = {
    list: LIST,
    get: (id) => LIST_BY_ID.get(id) || LIST_BY_ID.get(FALLBACK_ID),
    canvas,
    swatch,
    prewarm,
    SIZE,
    // pure internals exposed for tests / previews (no DOM needed)
    _internal: { mulberry32, hashString, hash2, makeLattice, sampleLattice, makeFbm, fbmAt, fbmField, buildHerringbone, generate },
  };
})();
