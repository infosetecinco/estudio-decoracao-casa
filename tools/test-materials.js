// Tests for src/10-materials.js (pure pattern math + generated pixels; no canvas needed).
// Usage: node tools/test-materials.js            (add --no-perf to skip the timing assertions)
global.window = global;
require('../src/10-materials.js');

const M = global.DD.materials;
const I = M._internal;
const SIZE = M.SIZE;
const PERF = !process.argv.includes('--no-perf');
const PERF_BUDGET_MS = 40;

let failures = 0;
let passes = 0;
function check(cond, msg) {
  if (cond) passes++;
  else {
    failures++;
    console.error('  FAIL ' + msg);
  }
}
function section(name, fn) {
  console.log('== ' + name);
  try {
    fn();
  } catch (e) {
    failures++;
    console.error('  FAIL (threw) ' + (e && e.stack ? e.stack : e));
  }
}

const ROOM_IDS = ['porcelanato', 'marmore', 'madeira', 'madeiraEscura', 'vinilico', 'ceramica', 'ceramicaExt', 'ladrilho', 'cimento', 'concreto', 'carpete', 'deck'];
const SITE_IDS = ['grama', 'calcada', 'intertravado'];
const GROUPS = ['Cerâmicos', 'Madeiras', 'Pedras e cimentícios', 'Têxteis', 'Externos'];

section('list integrity', () => {
  const ids = M.list.map((e) => e.id);
  ROOM_IDS.concat(SITE_IDS).forEach((id) => check(ids.includes(id), 'missing material ' + id));
  check(new Set(ids).size === ids.length, 'ids must be unique');
  M.list.forEach((e) => {
    check(typeof e.name === 'string' && e.name.trim().length > 0, e.id + ': name');
    check(GROUPS.includes(e.group), e.id + ': group "' + e.group + '"');
    check(Number.isFinite(e.tileMM) && e.tileMM > 0, e.id + ': tileMM > 0');
    check(/^#[0-9a-f]{6}$/i.test(e.base), e.id + ': base is #rrggbb');
    check(SITE_IDS.includes(e.id) ? e.site === true : e.site === undefined, e.id + ': site flag');
    check(Object.isFrozen(e), e.id + ': entry frozen');
  });
  check(Object.isFrozen(M.list), 'list frozen');
});

section('get()', () => {
  check(M.get('madeira').id === 'madeira', 'get known id');
  check(M.get('nao-existe').id === 'porcelanato', 'unknown id falls back to porcelanato');
  check(M.get(undefined).id === 'porcelanato', 'undefined falls back to porcelanato');
});

section('PRNG & hash', () => {
  const a = I.mulberry32(42), b = I.mulberry32(42), c = I.mulberry32(43);
  const sa = Array.from({ length: 100 }, a), sb = Array.from({ length: 100 }, b), sc = Array.from({ length: 100 }, c);
  check(sa.every((v, i) => v === sb[i]), 'same seed → same sequence');
  check(sa.some((v, i) => v !== sc[i]), 'different seed → different sequence');
  check(sa.every((v) => v >= 0 && v < 1), 'values in [0,1)');
  const mean = sa.concat(Array.from({ length: 900 }, a)).reduce((s, v) => s + v, 0) / 1000;
  check(Math.abs(mean - 0.5) < 0.05, 'PRNG roughly uniform (mean ' + mean.toFixed(3) + ')');
  check(I.hash2(3, 7, 1) === I.hash2(3, 7, 1), 'hash deterministic');
  let lo = 1, hi = 0;
  for (let i = 0; i < 5000; i++) {
    const h = I.hash2(i % 97, (i / 97) | 0, 5);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  check(lo >= 0 && hi < 1 && hi - lo > 0.98, 'hash covers [0,1)');
  check(I.hashString('madeira') !== I.hashString('marmore'), 'string hash distinguishes ids');
});

section('noise seamlessness (periodicity)', () => {
  const rng = I.mulberry32(7);
  const L = I.makeLattice(6, 10, 99);
  let maxLat = 0;
  for (let i = 0; i < 500; i++) {
    const gx = rng() * 40 - 20, gy = rng() * 40 - 20;
    const v = I.sampleLattice(L, gx, gy);
    maxLat = Math.max(maxLat, Math.abs(v - I.sampleLattice(L, gx + 6, gy)), Math.abs(v - I.sampleLattice(L, gx, gy + 10)), Math.abs(v - I.sampleLattice(L, gx - 12, gy - 30)));
  }
  check(maxLat < 1e-9, 'lattice noise periodic in (px,py): max diff ' + maxLat);

  const F = I.makeFbm({ px: 3, py: 5, octaves: 6, gain: 0.55, seed: 1234 });
  let maxF = 0;
  for (let i = 0; i < 500; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, v = I.fbmAt(F, x, y);
    maxF = Math.max(maxF, Math.abs(v - I.fbmAt(F, x + SIZE, y)), Math.abs(v - I.fbmAt(F, x, y + SIZE)), Math.abs(v - I.fbmAt(F, x - SIZE, y - 2 * SIZE)));
  }
  check(maxF < 1e-9, 'fBm periodic with SIZE px in both axes: max diff ' + maxF);

  // the fast whole-canvas field must equal the point sampler at pixel centres
  const opts = { px: 3, py: 12, octaves: 5, gain: 0.5, seed: 77 };
  const field = I.fbmField(opts), F2 = I.makeFbm(opts);
  let maxField = 0;
  for (let i = 0; i < 2000; i++) {
    const x = (rng() * SIZE) | 0, y = (rng() * SIZE) | 0;
    maxField = Math.max(maxField, Math.abs(field[y * SIZE + x] - I.fbmAt(F2, x + 0.5, y + 0.5)));
  }
  check(maxField < 1e-5, 'fbmField matches fbmAt: max diff ' + maxField);

  // continuity across the wrap: the step from the last column to the first is an ordinary neighbour step
  const steps = [];
  for (let y = 0; y < SIZE; y += 8) for (let x = 0; x < SIZE - 1; x++) steps.push(Math.abs(field[y * SIZE + x + 1] - field[y * SIZE + x]));
  const maxStep = Math.max(...steps);
  let wrapStep = 0;
  for (let y = 0; y < SIZE; y++) wrapStep = Math.max(wrapStep, Math.abs(field[y * SIZE] - field[y * SIZE + SIZE - 1]));
  check(wrapStep <= maxStep * 1.05, 'fbmField wraps smoothly (wrap ' + wrapStep.toFixed(4) + ' vs max interior ' + maxStep.toFixed(4) + ')');
});

section('herringbone map', () => {
  const P = I.buildHerringbone();
  const N = 4, delta = [[1, 0], [-1, 0], [0, 1], [0, -1]], opposite = [1, 0, 3, 2];
  check(P.length === N * N && P.every((d) => d >= 0 && d <= 3), 'every cell belongs to a brick');
  let consistent = true;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const d = P[y * N + x], [dx, dy] = delta[d];
      const px = (x + dx + N) % N, py = (y + dy + N) % N;
      if (P[py * N + px] !== opposite[d]) consistent = false;
    }
  check(consistent, 'partner cells point back at each other (1×2 bricks)');
  const horiz = Array.from(P).filter((d) => d <= 1).length;
  check(horiz === 8, 'half horizontal, half vertical bricks (' + horiz + '/16 horizontal cells)');
});

/** Mean absolute RGB difference between column a and column b (or rows when `rows`). */
function lineDiff(px, a, b, rows) {
  let s = 0;
  for (let i = 0; i < SIZE; i++) {
    const p = rows ? (a * SIZE + i) * 4 : (i * SIZE + a) * 4;
    const q = rows ? (b * SIZE + i) * 4 : (i * SIZE + b) * 4;
    s += Math.abs(px[p] - px[q]) + Math.abs(px[p + 1] - px[q + 1]) + Math.abs(px[p + 2] - px[q + 2]);
  }
  return s / SIZE;
}
function seamStats(px, rows) {
  const interior = [];
  for (let i = 0; i < SIZE - 1; i++) interior.push(lineDiff(px, i, i + 1, rows));
  const sorted = interior.slice().sort((a, b) => a - b);
  return { wrap: lineDiff(px, SIZE - 1, 0, rows), max: sorted[sorted.length - 1], median: sorted[sorted.length >> 1] };
}
function hexOf(px) {
  let r = 0, g = 0, b = 0;
  for (let k = 0; k < px.length; k += 4) {
    r += px[k];
    g += px[k + 1];
    b += px[k + 2];
  }
  const n = px.length / 4;
  return [r, g, b].map((v) => Math.round(v / n));
}
const CONTINUOUS = ['cimento', 'carpete', 'grama']; // no joint on the canvas border: the wrap must look like any interior step

section('seam detector negative control', () => {
  // the same fBm sampled with a period that does NOT match the canvas must be flagged
  const F = I.makeFbm({ px: 3, octaves: 5, gain: 0.55, seed: 5 });
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const v = 255 * I.fbmAt(F, x * 1.37, y * 1.37), k = (y * SIZE + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = v;
      px[k + 3] = 255;
    }
  const s = seamStats(px, false);
  check(s.wrap > Math.max(s.median * 3, 2), 'non-periodic noise is detected as a seam (wrap ' + s.wrap.toFixed(2) + ', median ' + s.median.toFixed(2) + ')');
});

section('generated textures', () => {
  M.list.forEach((e) => {
    const times = [];
    let px = null;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      px = I.generate(e.id);
      times.push(performance.now() - t0);
    }
    const again = I.generate(e.id);
    check(px.length === SIZE * SIZE * 4, e.id + ': 512×512 RGBA');
    check(px.every((v, i) => v === again[i]), e.id + ': deterministic');
    let opaque = true;
    for (let k = 3; k < px.length; k += 4) if (px[k] !== 255) opaque = false;
    check(opaque, e.id + ': opaque');

    const sx = seamStats(px, false), sy = seamStats(px, true);
    const limitX = CONTINUOUS.includes(e.id) ? Math.max(sx.median * 3, 2) : sx.max * 1.05;
    const limitY = CONTINUOUS.includes(e.id) ? Math.max(sy.median * 3, 2) : sy.max * 1.05;
    check(sx.wrap <= limitX, e.id + ': seamless horizontally (wrap ' + sx.wrap.toFixed(2) + ' limit ' + limitX.toFixed(2) + ')');
    check(sy.wrap <= limitY, e.id + ': seamless vertically (wrap ' + sy.wrap.toFixed(2) + ' limit ' + limitY.toFixed(2) + ')');

    const avg = hexOf(px), base = [1, 3, 5].map((i) => parseInt(e.base.slice(i, i + 2), 16));
    const dev = Math.max(...avg.map((v, i) => Math.abs(v - base[i])));
    check(dev <= 8, e.id + ': base ' + e.base + ' ≈ average rgb(' + avg.join(',') + ') (Δ ' + dev + ')');

    const best = Math.min(...times);
    if (PERF) check(best < PERF_BUDGET_MS, e.id + ': generation ' + best.toFixed(1) + ' ms < ' + PERF_BUDGET_MS + ' ms');
    console.log('  ' + e.id.padEnd(14) + ' ' + best.toFixed(1).padStart(5) + ' ms  seam x ' + sx.wrap.toFixed(1) + '/' + sx.max.toFixed(1) + '  y ' + sy.wrap.toFixed(1) + '/' + sy.max.toFixed(1) + '  avg rgb(' + avg.join(',') + ')');
  });
});

section('DOM layer without a document', () => {
  let threw = false;
  try {
    M.canvas('madeira');
  } catch (e) {
    threw = /navegador/.test(String(e.message));
  }
  check(threw, 'canvas() explains that it needs a browser when document is missing');
});

console.log((failures ? 'FAILED' : 'OK') + ' — ' + passes + ' checks passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
