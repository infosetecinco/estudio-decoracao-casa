// Tests for src/20-plan2d.js: pure geometry helpers, renderer smoke test (mock 2D context) and end-to-end pointer
// interactions against a DOM shim. Run: node tools/test-plan2d.js
'use strict';

// ------------------------------------------------------------------ environment shim
const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.map(String).join(' '));

global.window = global;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.devicePixelRatio = 1;

let rafQueue = [];
global.requestAnimationFrame = (cb) => (rafQueue.push(cb), rafQueue.length);
function flush(max = 20) {
  for (let i = 0; i < max && rafQueue.length; i++) {
    const q = rafQueue;
    rafQueue = [];
    q.forEach((cb) => cb(now));
  }
}
let now = 1000;

class Path2DMock {
  constructor() { this.ops = 0; }
  moveTo() { this.ops++; } lineTo() { this.ops++; } closePath() {} rect() { this.ops++; } arc() {}
}
global.Path2D = Path2DMock;
global.DOMMatrix = class { scaleSelf() { return this; } };

function makeCtx(canvas) {
  const calls = {};
  const state = { canvas };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'createPattern') return () => ({ setTransform() {} });
      if (k === '__calls') return calls;
      return (...args) => {
        calls[k] = (calls[k] || 0) + 1;
        for (const a of args) if (typeof a === 'number' && !isFinite(a)) throw new Error('non-finite arg to ' + String(k));
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas(w, h) {
  const listeners = {};
  const c = {
    width: w, height: h, style: {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute() {},
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return true; },
    getBoundingClientRect() { return { left: 0, top: 0, width: parent.clientWidth, height: parent.clientHeight, right: parent.clientWidth, bottom: parent.clientHeight }; },
    toDataURL() { return 'data:image/png;base64,TEST'; },
    fire(type, ev) { (listeners[type] || []).forEach((fn) => fn(ev)); },
  };
  const parent = { clientWidth: w, clientHeight: h, style: {} };
  c.parentElement = parent;
  c.getContext = () => (c._ctx = c._ctx || makeCtx(c));
  return c;
}
const winListeners = {};
global.addEventListener = (type, fn) => (winListeners[type] = winListeners[type] || []).push(fn);
global.removeEventListener = () => {};
global.document = { createElement: () => makeCanvas(10, 10), readyState: 'complete' };
global.getComputedStyle = () => ({ position: 'relative' });
let resizeCb = null;
global.ResizeObserver = class { constructor(cb) { resizeCb = cb; } observe() {} disconnect() {} };

require('../src/00-data.js');
require('../src/01-core.js');
const DD = global.DD;

// stubs for modules owned by other agents
const drawn = [];
DD.catalog = {
  types: {
    sofa: { name: 'Sofá', category: 'sala', w: 2000, d: 900, h: 800, elev: 0, color: '#9A8F80' },
    cama: { name: 'Cama', category: 'quarto', w: 1600, d: 2000, h: 500, elev: 0, color: '#C9B89F' },
    tapete: { name: 'Tapete', category: 'sala', w: 2000, d: 1400, h: 10, elev: 0, color: '#B0A48F', flat: true },
  },
  draw2d(ctx, item) { drawn.push(item.id); },
};
DD.materials = {
  get: (id) => ({ id, name: id === 'madeira' ? 'Madeira carvalho' : id, tileMM: 600, base: '#ccc' }),
  canvas: () => ({ width: 512, height: 512 }),
};
require('../src/20-plan2d.js');
const P = DD.plan2d, T = P._test;
T.setClock(() => now);

// ------------------------------------------------------------------ tiny test runner
let failed = 0, passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '\n   ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n   ') : e));
  }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > (tol || 1e-6)) throw new Error((msg || 'near') + ': expected ' + b + ' ± ' + (tol || 1e-6) + ', got ' + a); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

const baseDoc = DD.data.initialState();
const U = DD.util;

// ------------------------------------------------------------------ pure helpers
test('zoomAround keeps the anchor world point fixed', () => {
  const v = { cx: 4500, cy: 9000, scale: 0.05, width: 800, height: 600 };
  const n = T.zoomAround(v, 2, 200, 150);
  const before = { x: (200 - 400) / 0.05 + 4500, y: (150 - 300) / 0.05 + 9000 };
  const after = { x: (200 - 400) / n.scale + n.cx, y: (150 - 300) / n.scale + n.cy };
  near(after.x, before.x, 1e-6);
  near(after.y, before.y, 1e-6);
  eq(n.scale, 0.1);
  eq(T.zoomAround(v, 1000, 0, 0).scale, 1.2, 'clamped max');
  eq(T.zoomAround(v, 1e-6, 0, 0).scale, 0.02, 'clamped min');
});
test('fitRect / floorBox frame the building', () => {
  const b = T.floorBox(baseDoc, 'f0', true);
  eq(b.minX, 0); eq(b.maxX, 9000); eq(b.minY, 2850); eq(b.maxY, 16200);
  const all = T.floorBox(baseDoc, 'f0', false);
  eq(all.maxY, 20000, 'muros included');
  const f = T.fitRect(b, 1000, 800, 80);
  near(f.cx, 4500, 1e-9);
  near(f.scale, Math.min(840 / 9000, 640 / 13350), 1e-9);
});
test('resizeFromHandle keeps the opposite side fixed (rot 0 and rot 90)', () => {
  const it = { x: 5000, y: 5000, w: 2000, d: 900, rot: 0 };
  const r = T.resizeFromHandle(it, 1, 0, 6500, 5000); // drag right edge 500 mm out
  eq(r.w, 2500); eq(r.d, 900); eq(r.x, 5250); eq(r.y, 5000);
  const it90 = { x: 5000, y: 5000, w: 2000, d: 900, rot: 90 };
  // corner (+1,+1) in local frame; opposite corner (-1,-1) must not move
  const opp = U.localToWorld(it90.x, it90.y, 90, -1000, -450);
  const target = U.localToWorld(it90.x, it90.y, 90, 1300, 650);
  const r2 = T.resizeFromHandle(it90, 1, 1, target.x, target.y);
  eq(r2.w, 2300); eq(r2.d, 1100);
  const opp2 = U.localToWorld(r2.x, r2.y, 90, -r2.w / 2, -r2.d / 2);
  near(opp2.x, opp.x, 1); near(opp2.y, opp.y, 1);
  const tiny = T.resizeFromHandle(it, -1, 0, 7000, 5000);
  eq(tiny.w, 100, 'min size');
  eq(T.resizeFromHandle(it, 1, 0, 6004, 5000).w, 2000, '10 mm steps');
});
test('rotationFromPointer: knob in front (local +y)', () => {
  const it = { x: 0, y: 0, w: 1000, d: 500, rot: 0 };
  eq(T.rotationFromPointer(it, 0, 1000, false), 0);
  eq(T.rotationFromPointer(it, -1000, 0, false), 90);
  eq(T.rotationFromPointer(it, 0, -1000, false), 180);
  eq(T.rotationFromPointer(it, 1000, 0, false), 270);
  eq(T.rotationFromPointer(it, -1000, 1000 * Math.tan(U.rad(80)), false), 15, '15° steps');
  eq(T.rotationFromPointer(it, -1000, 1000 * Math.tan(U.rad(80)), true), 10, 'free');
  // the knob of an item rotated by r sits where rotationFromPointer returns r
  const h = T.furnitureHandles({ x: 100, y: 200, w: 1000, d: 500, rot: 135 }, 10);
  eq(T.rotationFromPointer({ x: 100, y: 200 }, h.rotate.x, h.rotate.y, false), 135);
});
test('furniture handles & cursors', () => {
  const it = { x: 0, y: 0, w: 1000, d: 500, rot: 0 };
  eq(T.furnitureHandles(it, 10).resize.length, 8);
  eq(T.furnitureHandles(it, 100).resize.length, 4, 'compact when small on screen');
  const h = T.hitFurnitureHandle(it, { x: 500, y: 250 }, 10);
  eq(h.type, 'resize'); eq(h.sx, 1); eq(h.sy, 1);
  eq(T.hitFurnitureHandle(it, { x: 0, y: 250 + 280 }, 10).type, 'rotate');
  eq(T.hitFurnitureHandle(it, { x: 0, y: 0 }, 10), null);
  eq(T.handleCursor(1, 0, 0), 'ew-resize');
  eq(T.handleCursor(1, 0, 90), 'ns-resize');
  eq(T.handleCursor(1, 1, 0), 'nwse-resize');
  eq(T.handleCursor(1, -1, 0), 'nesw-resize');
});
test('hitTestSelect priority: furniture > opening > wall > room', () => {
  const doc = Object.assign({}, baseDoc, {
    furniture: [
      { id: 'rug', floor: 'f0', type: 'tapete', x: 6500, y: 12500, rot: 0, w: 2000, d: 1400, h: 10 },
      { id: 'sofa', floor: 'f0', type: 'sofa', x: 6500, y: 12000, rot: 0, w: 2000, d: 900, h: 800 },
    ],
  });
  const px = 10;
  eq(T.hitTestSelect(doc, 'f0', { x: 6500, y: 12100 }, px).id, 'sofa', 'solid over rug');
  eq(T.hitTestSelect(doc, 'f0', { x: 6500, y: 13100 }, px).id, 'rug');
  // P1 on w0_cozBottom (y=8675, from x=1500) at t=2125 → x=3625
  const hitOp = T.hitTestSelect(doc, 'f0', { x: 3625, y: 8675 }, px);
  eq(hitOp.kind, 'opening'); eq(hitOp.id, 'o0_p1_coz');
  const hitW = T.hitTestSelect(doc, 'f0', { x: 4225, y: 6000 }, px);
  eq(hitW.kind, 'wall'); eq(hitW.id, 'w0_cozQuarto');
  const hitR = T.hitTestSelect(doc, 'f0', { x: 2900, y: 6200 }, px);
  eq(hitR.kind, 'room'); eq(hitR.id, 'room:r0_cozinha');
  eq(T.hitTestSelect(doc, 'f0', { x: 20000, y: 6200 }, px), null);
  const withSel = T.hitTestSelect(doc, 'f0', { x: 7500, y: 12450 }, px, { selection: { kind: 'furniture', id: 'sofa' } });
  eq(withSel.kind, 'handle');
  const end = T.hitTestSelect(doc, 'f0', { x: 4226, y: 8674 }, px, { selection: { kind: 'wall', id: 'w0_cozQuarto' } });
  eq(end.kind, 'wallEnd'); eq(end.end, 'b');
  eq(T.hitTestSelect(doc, 'f0', { x: 6500, y: 12000 }, px, { showFurniture: false }).kind, 'room', 'furniture hidden');
});
test('snapWallPoint: endpoints, ortho, faces, grid', () => {
  const tol = 100;
  const e = T.snapWallPoint(baseDoc, 'f0', { x: 4240, y: 4690 }, { tol, grid: 50 });
  eq(e.kind, 'end'); eq(e.x, 4225); eq(e.y, 4675);
  const g = T.snapWallPoint(baseDoc, 'f0', { x: 2512, y: 6033 }, { tol, grid: 50 });
  eq(g.kind, 'grid'); eq(g.x, 2500); eq(g.y, 6050);
  const o = T.snapWallPoint(baseDoc, 'f0', { x: 3000, y: 6100 }, { anchor: { x: 2000, y: 6000 }, ortho: 'force', tol, grid: 50 });
  eq(o.y, 6000, 'horizontal constraint'); eq(o.axis, 'h');
  // ortho towards the kitchen/quarto partition (x=4225, 150 thick → faces 4150/4300) → face hit on the axis
  const f = T.snapWallPoint(baseDoc, 'f0', { x: 4160, y: 6130 }, { anchor: { x: 2000, y: 6000 }, ortho: 'force', tol, grid: 50 });
  eq(f.kind, 'face'); eq(f.x, 4150); eq(f.y, 6000);
  const c = T.snapWallPoint(baseDoc, 'f0', { x: 4215, y: 6130 }, { anchor: { x: 2000, y: 6000 }, ortho: 'force', tol, grid: 50 });
  eq(c.x, 4225, 'centre line');
  const near = T.snapWallPoint(baseDoc, 'f0', { x: 3000, y: 6300 }, { anchor: { x: 2000, y: 6000 }, ortho: 'near', tol: 1, grid: 10 });
  eq(near.axis, null, '17° is not near-orthogonal');
  const ex = T.snapWallPoint(baseDoc, 'f0', { x: 4240, y: 4690 }, { tol, grid: 50, excludeWall: 'w0_cozQuarto' });
  eq(ex.kind, 'end', 'other wall ends still snap');
  const free = T.snapWallPoint(baseDoc, 'f0', { x: 2512.4, y: 6033.6 }, { tol: 0, grid: 0 });
  eq(free.kind, 'free'); eq(free.x, 2512); eq(free.y, 6034);
});
test('solidIntervals & cut plane', () => {
  const s = T.solidIntervals(6000, [{ t0: 2000, t1: 2800 }, { t0: 500, t1: 1100 }, { t0: 5800, t1: 6200 }]);
  eq(JSON.stringify(s), JSON.stringify([[0, 500], [1100, 2000], [2800, 5800]]));
  ok(T.cutsWall({ type: 'door', sill: 0 }));
  ok(T.cutsWall({ type: 'window', sill: 1100 }));
  ok(!T.cutsWall({ type: 'window', sill: 1800 }), 'high window above the cut plane');
});
test('openingRange respects wall ends, walls at its joints and neighbours', () => {
  const w = DD.ops.byId(baseDoc, 'walls', 'w0_back'); // L = 6000, openings at 2125 (P1 800), 3170 (J1 600), 4450 (J1 600)
  const op = DD.ops.byId(baseDoc, 'openings', 'o0_j1_desp');
  const r = T.openingRange(baseDoc, op, w);
  // partitions butting into w0_back: w0_cozDesp x 4150–4300 (s 2650–2800), w0_despSuiteDiv x 5400–5550 (s 3900–4050)
  eq(r.lo, 2800 + 300); eq(r.hi, 3900 - 300);
  // P2 on w0_despSuite (a = joint with w0_cozDesp/w0_cozQuarto, 150 thick): jamb stops at the inner face x = 4300
  const ds = DD.ops.byId(baseDoc, 'walls', 'w0_despSuite');
  const p2 = DD.ops.byId(baseDoc, 'openings', 'o0_p2_suite');
  eq(T.openingRange(baseDoc, Object.assign({}, p2, { t: 500 }), ds).lo, 75 + 350, 'clear of the crossing wall');
  eq(T.openingRange(baseDoc, p2, ds).hi, 3125 - 350, 'clear of w0_right at the b end');
  const obs = T.wallObstacles(baseDoc, ds).map((o) => o.map(Math.round).join('-')).sort();
  ok(obs.indexOf('0-75') >= 0 && obs.indexOf('1175-1325') >= 0 && obs.indexOf('3125-3200') >= 0, JSON.stringify(obs));
});
test('jointOpeningClash: a partition end may not butt into a door or window of another wall', () => {
  // w0_right (x 7425, from y 2850) has J2 at t 3000 ± 1000 → y 4850–6850
  eq(T.jointOpeningClash(baseDoc, 'f0', { x: 7425, y: 4675 }, 150, 'w0_despSuite'), null);
  eq(T.jointOpeningClash(baseDoc, 'f0', { x: 7425, y: 4975 }, 150, 'w0_despSuite').id, 'o0_j2_quarto');
  eq(T.jointOpeningClash(baseDoc, 'f0', { x: 7425, y: 4775 }, 150, 'w0_despSuite'), null, 'touching the jamb is fine');
  eq(T.jointOpeningClash(baseDoc, 'f0', { x: 6000, y: 6000 }, 150, 'x'), null, 'free end');
});
test('retargetOpenings keeps openings fixed in world space when wall.a moves', () => {
  const w = DD.ops.byId(baseDoc, 'walls', 'w0_cozDesp'); // x=4225, y 2925→4675, P6 at t=1250
  const nw = Object.assign({}, w, { a: { x: 4225, y: 3225 } });
  const d2 = T.retargetOpenings(DD.ops.update(baseDoc, 'walls', w.id, { a: nw.a }), w, nw);
  eq(DD.ops.byId(d2, 'openings', 'o0_p6_desp').t, 950);
  ok(DD.ops.byId(baseDoc, 'openings', 'o0_p6_desp').t === 1250, 'input doc untouched');
});
test('layoutChainLabels staggers tiny segments and hides impossible ones', () => {
  const lv = T.layoutChainLabels([0, 100, 108, 200, 201], [24, 24, 24, 24], 6);
  eq(JSON.stringify(lv), JSON.stringify([0, 1, 0, -1]));
  const lv2 = T.layoutChainLabels([0, 10, 20, 30, 40], [24, 24, 24, 24], 6);
  eq(JSON.stringify(lv2), JSON.stringify([1, 2, -1, 1]), 'overlapping staggered labels are hidden');
});
test('scale bar & labels', () => {
  eq(T.niceScaleBar(0.1).mm, 1000);
  eq(T.niceScaleBar(1.2).mm, 100);
  eq(T.niceScaleBar(0.02).mm, 5000);
  eq(T.scaleLabel(500), '0,5 m'); eq(T.scaleLabel(2000), '2 m');
  const lines = T.roomLabelLines({ name: 'Sala', area: 29.595, planArea: 29.6, open: false }, true, true);
  eq(lines.length, 2, 'rounded area matches plan → no "(projeto)"');
  const lines2 = T.roomLabelLines({ name: 'Sala', area: 26.33, planArea: 29.6, open: false }, true, true);
  eq(lines2[1].text, 'A=26,33 m²'); eq(lines2[2].text, '(projeto 29,60)');
});
test('stairsForFloor: S on T; S + D (label only) on 1º like the PDF; D on 2º', () => {
  const tag = (s) => s.st.id + ':' + s.mode + (s.labelOnly ? '*' : '');
  eq(T.stairsForFloor(baseDoc, 0).map(tag).join(), 'st0:up');
  eq(T.stairsForFloor(baseDoc, 1).map(tag).join(), 'st1:up,st0:down*');
  eq(T.stairsForFloor(baseDoc, 2).map(tag).join(), 'st1:down');
});
test('opening tag side: windows outside, doors opposite the swing', () => {
  const back = DD.ops.byId(baseDoc, 'walls', 'w0_back');
  eq(T.tagSideOf(baseDoc, 'f0', back, DD.ops.byId(baseDoc, 'openings', 'o0_j1_desp')), -1, 'J1 tag outside (−y)');
  const left = DD.ops.byId(baseDoc, 'walls', 'w0_left');
  eq(T.tagSideOf(baseDoc, 'f0', left, DD.ops.byId(baseDoc, 'openings', 'o0_j2_coz')), 1, 'J2 tag outside (−x = +n)');
  const lav = DD.ops.byId(baseDoc, 'walls', 'w0_lavBottom');
  eq(T.tagSideOf(baseDoc, 'f0', lav, DD.ops.byId(baseDoc, 'openings', 'o0_p1_garagem')), 1);
});
test('sideRays measure clearances to walls', () => {
  const it = { x: 6000, y: 12000, w: 2000, d: 900, rot: 0 }; // Sala: x 4300–8850 y 10350(10500)–14850
  const rays = T.sideRays(baseDoc, 'f0', it);
  eq(rays.length, 4);
  const right = rays.find((r) => r.a.x === 7000);
  near(right.dist, 8850 - 7000, 1);
  const left = rays.find((r) => r.a.x === 5000);
  near(left.dist, 5000 - 4300, 1);
});
test('backToWallRotation picks the rotation with the back on the nearest face', () => {
  eq(T.backToWallRotation(baseDoc, 'f0', { x: 8500, y: 12000 }, 800), 90, 'right wall');
  eq(T.backToWallRotation(baseDoc, 'f0', { x: 6000, y: 14600 }, 800), 180, 'front wall');
  eq(T.backToWallRotation(baseDoc, 'f0', { x: 6000, y: 12500 }, 800), null, 'room centre');
});

test('snapWallPoint (measure): visible room corners, never corners buried in joints', () => {
  const snap = (x, y, tol) => T.snapWallPoint(baseDoc, 'f0', { x, y }, { tol, grid: 0, visibleOnly: true });
  const eqPt = (r, x, y, msg) => { eq(r.x, x, msg + ' x'); eq(r.y, y, msg + ' y'); };
  eqPt(snap(4340, 4790, 205), 4300, 4750, 'Quarto top-left (T joint of two partitions)');
  eqPt(snap(7320, 4800, 205), 7350, 4750, 'Quarto top-right');
  eqPt(snap(1642, 3008, 205), 1650, 3000, 'Cozinha top-left');
  eqPt(snap(7330, 8590, 205), 7350, 8600, 'Quarto bottom-right');
  eqPt(snap(4308, 4745, 25), 4300, 4750, 'exact corner available when zoomed in');
  eqPt(snap(1510, 2860, 100), 1500, 2850, 'outer building corner');
  const pts = T.floorSnapPoints(baseDoc, 'f0');
  ok(!pts.some((p) => p.kind === 'corner' && p.x === 4225 && p.y === 4750), 'polygon corner inside w0_cozQuarto dropped');
  ok(!pts.some((p) => p.kind === 'corner' && p.x === 1500 && p.y === 3000), 'point on a straight face is not a corner');
  ok(pts.some((p) => p.kind === 'corner' && p.x === 3225 && p.y === 8750), 'door jamb corner (P1 cozinha)');
  const e = T.snapWallPoint(baseDoc, 'f0', { x: 4240, y: 4690 }, { tol: 100, grid: 50 });
  eq(e.kind, 'end', 'the wall tool still snaps to joint centres');
  const b = T.snapWallPoint(baseDoc, 'f0', { x: -9000, y: 30000 }, { tol: 0, grid: 50, bounds: T.wallToolBounds(baseDoc) });
  eq(b.x, -5000); eq(b.y, 25000);
});
test('hitTestSelect follows the draw order: measures > walls/openings (exact) > furniture > tolerant hits', () => {
  const doc = Object.assign({}, baseDoc, {
    furniture: [
      { id: 'cab', floor: 'f0', type: 'sofa', x: 4800, y: 6000, rot: 90, w: 1000, d: 900, h: 800 }, // flush with the partition face x=4300
      { id: 'rug', floor: 'f0', type: 'tapete', x: 6500, y: 11000, rot: 0, w: 2000, d: 1400, h: 10 },
    ],
    measures: [{ id: 'm1', floor: 'f0', a: { x: 5000, y: 11000 }, b: { x: 8000, y: 11000 } }],
  });
  const px = 20.5; // fit zoom (0.0487 px/mm)
  eq(T.hitTestSelect(doc, 'f0', { x: 4225, y: 6000 }, px).id, 'w0_cozQuarto', 'wall poché over a cabinet');
  eq(T.hitTestSelect(doc, 'f0', { x: 4310, y: 6000 }, px).id, 'cab', 'just inside the room: the cabinet');
  eq(T.hitTestSelect(doc, 'f0', { x: 6500, y: 11000 }, px).kind, 'measure', 'measure over a rug');
  const label = T.hitTestSelect(doc, 'f0', { x: 6500, y: 11000 - 13 * px }, px);
  eq(label.kind, 'measure', 'measure label pill');
  eq(T.hitTestSelect(doc, 'f0', { x: 6500, y: 11500 }, px).id, 'rug');
});
test('fitLabelText wraps long room names to two lines and ellipsizes the rest', () => {
  const m = (s) => s.length * 7;
  eq(JSON.stringify(T.fitLabelText(m, 'Sala', 100, 2)), JSON.stringify(['Sala']));
  eq(JSON.stringify(T.fitLabelText(m, 'Quarto de hóspedes', 100, 2)), JSON.stringify(['Quarto de', 'hóspedes']));
  const long = T.fitLabelText(m, 'Quarto de hóspedes com closet e escritório integrado', 100, 2);
  eq(long.length, 2);
  ok(long.every((l) => m(l) <= 100), JSON.stringify(long));
  ok(/…$/.test(long[1]), 'ellipsized');
  eq(T.fitLabelText(m, 'Superlongonomesemespaços', 70, 1)[0], 'Superlong…');
});
test('findLabelSpot: nearest clear spot inside the room, seed when nothing fits', () => {
  const room = { labelX: 5000, labelY: 5000, outer: [{ x: 3000, y: 3000 }, { x: 7000, y: 3000 }, { x: 7000, y: 7000 }, { x: 3000, y: 7000 }], holes: [], bbox: { minX: 3000, minY: 3000, maxX: 7000, maxY: 7000 } };
  const clear = T.findLabelSpot(room, { x: 5000, y: 5000 }, 800, 400, []);
  eq(clear.x, 5000); eq(clear.y, 5000);
  const bed = { minX: 4000, minY: 4200, maxX: 6000, maxY: 6400 };
  const s = T.findLabelSpot(room, { x: 5000, y: 5000 }, 800, 400, [bed]);
  ok(s && T.labelBoxFree(room, s, 800, 400, [bed]), 'free');
  ok(Math.abs(s.y - 5000) <= 1700, 'stays close ' + JSON.stringify(s));
  eq(T.findLabelSpot(room, { x: 5000, y: 5000 }, 5000, 400, []), null, 'label wider than the room');
});
test('export title does not claim a print scale; footer fits the schedule', () => {
  eq(T.stripScaleClaim('Planta aprovada 01/01 (esc. 1:100)'), 'Planta aprovada 01/01');
  eq(T.stripScaleClaim('Levantamento — escala 1:50'), 'Levantamento —');
  const l = T.exportFooterLayout(1092, 9);
  ok(l.cols >= 3 && l.rows >= 4 && l.rows * l.cols >= 9, JSON.stringify(l));
  const box = T.exportBox(baseDoc, 'f0');
  eq(box.maxY, 16200, 'the export stops at the building, not the street');
});
test('dimension chains wrap the terrace on the 2º pav', () => {
  const dd = DD.geom.dimensionData(baseDoc, 'f2');
  const e = T.dimensionEdges(baseDoc, 'f2', dd);
  ok(e.maxY >= 15000, 'bottom edge below the terrace muros ' + e.maxY);
});

// ------------------------------------------------------------------ renderer smoke tests
test('drawScene renders every floor (screen + export) without layer errors', () => {
  const doc = Object.assign({}, baseDoc, {
    furniture: [{ id: 'sofa', floor: 'f0', type: 'sofa', x: 6500, y: 12000, rot: 0, w: 2000, d: 900, h: 800 }],
    measures: [{ id: 'm1', floor: 'f0', a: { x: 4300, y: 11000 }, b: { x: 8850, y: 11000 } }],
  });
  const cv = makeCanvas(1200, 900);
  const ctx = cv.getContext('2d');
  ['f0', 'f1', 'f2'].forEach((floor) => {
    [0.02, 0.08, 0.6].forEach((scale) => {
      const ui = Object.assign(DD.defaultUI(), { floor, selection: { kind: 'furniture', id: 'sofa' } });
      const rc = T.makeRC(ctx, { cx: 4500, cy: 9500, scale, width: 1200, height: 900 }, 2, doc, ui, { interactive: true });
      T.drawScene(rc);
      const rcx = T.makeRC(ctx, { cx: 4500, cy: 9500, scale: 0.1, width: 1200, height: 900 }, 2, doc, ui, { exporting: true, footer: 104, show: { dims: true, grid: false } });
      T.drawScene(rcx);
    });
  });
  const layerErrors = warnings.filter((w) => /layer|opening:|render/.test(w));
  eq(layerErrors.length, 0, 'layer errors: ' + layerErrors.join(' | '));
  ok(ctx.__calls.fill > 50 && ctx.__calls.fillText > 50, 'something was drawn');
  ok(drawn.indexOf('sofa') >= 0, 'catalog.draw2d called');
});

// ------------------------------------------------------------------ end-to-end interactions
const events = [];
DD.events.on('toast', (t) => events.push(['toast', t.kind, t.msg]));
DD.events.on('plan2d:viewport', () => events.push(['viewport']));
DD.events.on('plan2d:cursor', (c) => events.push(['cursor', c.x, c.y]));

const doc0 = Object.assign({}, baseDoc, {
  furniture: [{ id: 'sofa', floor: 'f0', type: 'sofa', x: 6500, y: 12000, rot: 0, w: 2000, d: 900, h: 800, elev: 0, color: null }],
});
DD.store = DD.createStore(doc0, DD.defaultUI());
const canvas = makeCanvas(1000, 800);
P.init(canvas);
flush();
const S = T.state();

let pid = 1;
function pev(x, y, extra) {
  return Object.assign({ pointerId: pid, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, shiftKey: false, altKey: false, cancelable: true, preventDefault() {} }, extra || {});
}
function at(wx, wy) { return P.worldToScreen(wx, wy); }
function down(w, extra) { const s = at(w.x, w.y); canvas.fire('pointerdown', pev(s.x, s.y, extra)); flush(); }
function move(w, extra) { const s = at(w.x, w.y); canvas.fire('pointermove', pev(s.x, s.y, extra)); flush(); }
function up(w, extra) { const s = at(w.x, w.y); canvas.fire('pointerup', pev(s.x, s.y, Object.assign({ buttons: 0 }, extra))); flush(); }
function click(w, extra) { down(w, extra); up(w, extra); }
const st = () => DD.store;
const setTool = (tool) => { st().setUI({ tool }); flush(); };
/** End-to-end test with a clean document, history and UI so one failure cannot cascade. */
function e2e(name, fn) {
  test(name, () => {
    st().replace(doc0, 'reset', { clearHistory: true });
    st().setUI({ tool: 'select', selection: null, floor: 'f0' });
    flush();
    fn();
  });
}

e2e('init fits the Térreo building and emits viewport', () => {
  const v = P.getViewport();
  ok(v.width === 1000 && v.height === 800);
  ok(v.scale > 0.04 && v.scale < 0.06, 'scale ' + v.scale);
  near(v.cx, 4500, 1);
  ok(events.some((e) => e[0] === 'viewport'));
  const w = P.screenToWorld(500, 400);
  near(w.x, v.cx, 1e-6); near(w.y, v.cy, 1e-6);
});
e2e('select: click furniture selects it; hover mirrors to ui.hover and cursor emits', () => {
  click({ x: 6500, y: 12000 });
  eq(JSON.stringify(st().ui.selection), JSON.stringify({ kind: 'furniture', id: 'sofa' }));
  move({ x: 6400, y: 12000 }, { buttons: 0 });
  ok(events.some((e) => e[0] === 'cursor'));
  eq(S.hover && S.hover.id, 'sofa');
});
e2e('select: drag furniture snaps flush to the right wall as one undo step', () => {
  down({ x: 6500, y: 12000 });
  move({ x: 7000, y: 12000 });
  move({ x: 7930, y: 12000 });
  ok(S.feedback && S.feedback.faces.length >= 1, 'snapped face highlighted');
  ok(S.feedback.rays.length >= 1, 'clearance rays');
  up({ x: 7930, y: 12000 });
  const it = DD.ops.byId(st().doc, 'furniture', 'sofa');
  eq(it.rot, 0); eq(it.x, 8850 - 1000);
  eq(st().undoLabel(), 'Mover Sofá');
  st().undo();
  eq(DD.ops.byId(st().doc, 'furniture', 'sofa').x, 6500);
});
e2e('select: Alt disables snapping', () => {
  down({ x: 6500, y: 12000 });
  move({ x: 8350, y: 12000 }, { altKey: true });
  up({ x: 8350, y: 12000 }, { altKey: true });
  const it = DD.ops.byId(st().doc, 'furniture', 'sofa');
  eq(it.rot, 0); near(it.x, 8350, 25);
  st().undo();
});
e2e('select: resize from a corner handle and rotate with the knob', () => {
  st().setUI({ selection: { kind: 'furniture', id: 'sofa' } });
  down({ x: 7500, y: 12450 }); // (+1,+1) corner
  move({ x: 7700, y: 12550 });
  move({ x: 7800, y: 12650 });
  up({ x: 7800, y: 12650 });
  let it = DD.ops.byId(st().doc, 'furniture', 'sofa');
  eq(it.w, 2300); eq(it.d, 1100); eq(st().undoLabel(), 'Redimensionar Sofá');
  near(it.x - it.w / 2, 5500, 1, 'left edge fixed'); near(it.y - it.d / 2, 11550, 1, 'back edge fixed');
  st().undo();
  const h = T.furnitureHandles(DD.ops.byId(st().doc, 'furniture', 'sofa'), 1 / P.getViewport().scale);
  down({ x: h.rotate.x, y: h.rotate.y });
  move({ x: 5000, y: 12000 });
  up({ x: 5000, y: 12000 });
  it = DD.ops.byId(st().doc, 'furniture', 'sofa');
  eq(it.rot, 90); eq(st().undoLabel(), 'Girar Sofá');
  st().undo();
});
e2e('select: structural wall is locked (toast once), partition moves perpendicular with joints kept', () => {
  events.length = 0;
  down({ x: 1575, y: 7500 }); // w0_left, structural (no opening there)
  move({ x: 1900, y: 7500 });
  move({ x: 2100, y: 7500 });
  up({ x: 2100, y: 7500 });
  eq(events.filter((e) => e[0] === 'toast' && e[2] === 'Parede estrutural — bloqueada').length, 1);
  eq(DD.ops.byId(st().doc, 'walls', 'w0_left').a.x, 1575);
  const docBefore = st().doc;
  events.length = 0;
  down({ x: 5475, y: 3800 }); // w0_despSuiteDiv partition (vertical, between Desp. and Suíte)
  move({ x: 5540, y: 3800 });
  move({ x: 5578, y: 3900 });
  ok(S.feedback && /Deslocamento 0,10 m/.test(S.feedback.label.text), 'offset label ' + (S.feedback && S.feedback.label.text));
  ok(S.feedback.rays.length === 2, 'distances to both neighbours');
  // 200 mm would put the joint with w0_back into window J1 of the Suíte (x 5650–6250): clamped, warned once
  move({ x: 5678, y: 3900 });
  move({ x: 5700, y: 3900 });
  eq(DD.ops.byId(st().doc, 'walls', 'w0_despSuiteDiv').a.x, 5575, 'clamped before the window');
  eq(events.filter((e) => e[0] === 'toast' && /abertura J1/.test(e[2])).length, 1, 'one warning');
  up({ x: 5700, y: 3900 });
  const w = DD.ops.byId(st().doc, 'walls', 'w0_despSuiteDiv');
  eq(w.a.x, 5575); eq(w.b.x, 5575);
  eq(st().undoLabel(), 'Mover parede');
  ok(!st().inGesture(), 'gesture closed');
  ok(DD.ops.byId(docBefore, 'walls', 'w0_despSuiteDiv').a.x === 5475, 'previous doc not mutated');
  const desp = DD.rooms.compute(st().doc, 'f0').find((r) => r.name === 'Desp.');
  near(desp.area, 1.76 + 0.1 * 1.6, 0.005);
  st().undo();
  eq(DD.ops.byId(st().doc, 'walls', 'w0_despSuiteDiv').a.x, 5475, 'one undo step');
});
e2e('select: partition endpoint drag (snaps, openings keep world position)', () => {
  click({ x: 4225, y: 3500 }); // select w0_cozDesp
  eq(st().ui.selection.id, 'w0_cozDesp');
  down({ x: 4225, y: 2925 }); // end 'a'
  move({ x: 4225, y: 3100 });
  move({ x: 4230, y: 3230 });
  up({ x: 4230, y: 3230 });
  const w = DD.ops.byId(st().doc, 'walls', 'w0_cozDesp');
  eq(w.a.x, 4225, 'ortho near'); eq(w.a.y, 3230);
  eq(DD.ops.byId(st().doc, 'openings', 'o0_p6_desp').t, 1250 - 305);
  eq(st().undoLabel(), 'Ajustar parede');
  st().undo();
});
e2e('select: opening on a partition drags along its wall (clamped)', () => {
  // P6 on w0_cozDesp: centre (4225, 4175)
  down({ x: 4225, y: 4175 });
  move({ x: 4225, y: 3900 });
  move({ x: 4225, y: 2000 });
  up({ x: 4225, y: 2000 });
  eq(DD.ops.byId(st().doc, 'openings', 'o0_p6_desp').t, 475, 'clamped clear of w0_back (75 mm) + half width');
  eq(st().undoLabel(), 'Mover P6');
  st().undo();
});
e2e('select: click empty outside rooms clears, click a room selects it', () => {
  click({ x: 2900, y: 6200 });
  eq(st().ui.selection.id, 'room:r0_cozinha');
  click({ x: 30000, y: 30000 });
  eq(st().ui.selection, null);
});
e2e('measure tool: click-click commits, Esc cancels', () => {
  setTool('measure');
  click({ x: 1650, y: 5000 });
  move({ x: 4150, y: 5003 }, { buttons: 0 });
  click({ x: 4150, y: 5003 }, { buttons: 0 });
  const ms = st().doc.measures;
  eq(ms.length, 1); eq(st().undoLabel(), 'Medição');
  ok(Math.abs(U.dist(ms[0].a, ms[0].b) - 2500) < 10, 'length ' + U.dist(ms[0].a, ms[0].b));
  click({ x: 2000, y: 7000 });
  ok(S.measure);
  P.cancel();
  eq(S.measure, null);
  st().undo();
});
e2e('wall tool: chained orthogonal partitions, Esc ends the chain', () => {
  setTool('wall');
  const n0 = st().doc.walls.length;
  click({ x: 5000, y: 11000 });
  move({ x: 6012, y: 11090 }, { buttons: 0 });
  click({ x: 6012, y: 11090 });
  move({ x: 6000, y: 12020 }, { buttons: 0 });
  click({ x: 6000, y: 12020 });
  const walls = st().doc.walls.slice(n0);
  eq(walls.length, 2);
  eq(JSON.stringify([walls[0].a, walls[0].b]), JSON.stringify([{ x: 5000, y: 11000 }, { x: 6000, y: 11000 }]));
  eq(JSON.stringify(walls[1].b), JSON.stringify({ x: 6000, y: 12000 }));
  eq(walls[0].kind, 'partition'); eq(walls[0].thick, 100);
  eq(st().undoLabel(), 'Nova parede');
  window.dispatch && 0;
  (winListeners.keydown || []).forEach((fn) => fn({ key: 'Escape', code: 'Escape', target: {}, preventDefault() {} }));
  eq(S.wallDraw, null);
  st().undo();
  st().undo();
});
e2e('demolish tool: partition fades then merges rooms; structural refused', () => {
  setTool('demolish');
  events.length = 0;
  click({ x: 1575, y: 7500 });
  ok(events.some((e) => e[0] === 'toast' && e[1] === 'warn' && /não pode ser demolida/.test(e[2])));
  click({ x: 4225, y: 6500 }); // w0_cozQuarto
  ok(DD.ops.byId(st().doc, 'walls', 'w0_cozQuarto'), 'still there during the fade');
  now += 300;
  flush();
  eq(DD.ops.byId(st().doc, 'walls', 'w0_cozQuarto'), null);
  eq(st().undoLabel(), 'Demolir parede');
  ok(events.some((e) => e[0] === 'toast' && e[1] === 'ok' && /Cozinha \+ Quarto/.test(e[2])), JSON.stringify(events));
  st().undo();
});
e2e('paint tool: applies ui.paintMaterial to the clicked room', () => {
  setTool('paint');
  st().setUI({ paintMaterial: 'madeira' });
  click({ x: 2900, y: 6200 });
  eq(st().doc.roomSeeds.find((s) => s.id === 'r0_cozinha').material, 'madeira');
  eq(st().undoLabel(), 'Piso: Madeira carvalho em Cozinha');
  st().undo();
});
e2e('pan: middle drag and pan tool move the view; wheel zooms around the cursor', () => {
  setTool('select');
  const v0 = P.getViewport();
  canvas.fire('pointerdown', pev(500, 400, { button: 1, buttons: 4 }));
  canvas.fire('pointermove', pev(600, 450, { buttons: 4 }));
  flush();
  canvas.fire('pointerup', pev(600, 450, { button: 1, buttons: 0 }));
  flush();
  const v1 = P.getViewport();
  near(v1.cx, v0.cx - 100 / v0.scale, 1e-6);
  near(v1.cy, v0.cy - 50 / v0.scale, 1e-6);
  const anchor = P.screenToWorld(300, 200);
  canvas.fire('wheel', { deltaY: -300, deltaMode: 0, clientX: 300, clientY: 200, ctrlKey: false, preventDefault() {} });
  flush(80);
  const v2 = P.getViewport();
  ok(v2.scale > v1.scale * 1.4, 'zoomed in ' + v2.scale / v1.scale);
  const a2 = P.screenToWorld(300, 200);
  near(a2.x, anchor.x, 0.5); near(a2.y, anchor.y, 0.5);
  P.fit();
  near(P.getViewport().scale, v0.scale, 1e-9);
});
e2e('cancel() mid-drag restores the document', () => {
  const before = st().doc;
  down({ x: 6500, y: 12000 });
  move({ x: 7200, y: 12500 });
  ok(st().doc !== before);
  ok(P.cancel());
  eq(st().doc, before);
  up({ x: 7200, y: 12500 });
  eq(st().doc, before);
});
e2e('addFurnitureAt drops at the pointer, back-to-wall near a wall, selects it', () => {
  const s = at(8500, 13000);
  const id = P.addFurnitureAt('cama', s.x, s.y);
  const it = DD.ops.byId(st().doc, 'furniture', id);
  eq(it.rot, 90); eq(it.x, 8850 - 1000);
  eq(st().undoLabel(), 'Adicionar Cama');
  eq(st().ui.selection.id, id);
  eq(P.addFurnitureAt('naoExiste', s.x, s.y), null);
  st().undo();
});
e2e('exportPNG renders offscreen and returns a data URL', () => {
  const url = P.exportPNG({ scale: 2 });
  ok(/^data:image\/png/.test(url));
  st().setUI({ floor: 'f2' });
  ok(/^data:image\/png/.test(P.exportPNG()));
  st().setUI({ floor: 'f0' });
});
e2e('floor change cancels in-progress tools; touch pinch zooms', () => {
  setTool('measure');
  click({ x: 2000, y: 6000 });
  ok(S.measure);
  st().setUI({ floor: 'f1' });
  eq(S.measure, null);
  setTool('select');
  const v0 = P.getViewport();
  canvas.fire('pointerdown', pev(400, 400, { pointerId: 11, pointerType: 'touch' }));
  canvas.fire('pointerdown', pev(600, 400, { pointerId: 12, pointerType: 'touch' }));
  canvas.fire('pointermove', pev(700, 400, { pointerId: 12, pointerType: 'touch' }));
  canvas.fire('pointermove', pev(300, 400, { pointerId: 11, pointerType: 'touch' }));
  flush();
  near(P.getViewport().scale, v0.scale * 2, 1e-9);
  canvas.fire('pointerup', pev(300, 400, { pointerId: 11, pointerType: 'touch', buttons: 0 }));
  canvas.fire('pointerup', pev(700, 400, { pointerId: 12, pointerType: 'touch', buttons: 0 }));
  flush();
  eq(S.pinch, null);
});

e2e('wall tool splitting the Sala keeps both halves as rooms (Sala + Sala 2, same floor)', () => {
  setTool('wall');
  click({ x: 4310, y: 12510 });
  move({ x: 8840, y: 12650 }, { buttons: 0 });
  click({ x: 8840, y: 12650 });
  P.cancel();
  const rooms = DD.rooms.compute(st().doc, 'f0').filter((r) => !r.open);
  const s2 = rooms.find((r) => r.name === 'Sala 2');
  ok(s2 && s2.area > 9, 'new room ' + rooms.map((r) => r.name + ' ' + r.area.toFixed(2)).join(', '));
  eq(s2.material, 'porcelanato');
  near(DD.rooms.totalArea(st().doc, 'f0'), DD.rooms.totalArea(doc0, 'f0') - 4.55 * 0.1, 0.02);
  st().undo();
  eq(st().doc.roomSeeds.length, doc0.roomSeeds.length);
});
e2e('partition endpoint drag that closes a room reseeds it in the same undo step', () => {
  setTool('wall');
  click({ x: 4225, y: 12500 });
  move({ x: 7000, y: 12500 }, { buttons: 0 });
  click({ x: 7000, y: 12500 });
  P.cancel();
  const nw = st().doc.walls[st().doc.walls.length - 1];
  const seeds0 = st().doc.roomSeeds.length;
  setTool('select');
  st().setUI({ selection: { kind: 'wall', id: nw.id } });
  down({ x: 7000, y: 12500 });
  move({ x: 8000, y: 12500 });
  move({ x: 8925, y: 12500 });
  up({ x: 8925, y: 12500 });
  ok(!st().inGesture(), 'gesture closed');
  eq(st().undoLabel(), 'Ajustar parede');
  eq(st().doc.roomSeeds.length, seeds0 + 1, 'one new seed');
  ok(DD.rooms.compute(st().doc, 'f0').some((r) => r.name === 'Sala 2' && !r.open), 'Sala 2 exists');
  st().undo();
  eq(st().doc.roomSeeds.length, seeds0, 'undo removes wall change and seed together');
});
e2e('undo during a drag cancels the gesture and drops the local drag', () => {
  const before = st().doc;
  down({ x: 6500, y: 12000 });
  move({ x: 7000, y: 12300 });
  ok(st().inGesture());
  st().undo();
  ok(!st().inGesture(), 'store gesture closed');
  eq(st().doc, before);
  eq(S.drag, null, 'local drag dropped');
  move({ x: 7200, y: 12400 });
  up({ x: 7200, y: 12400 });
  eq(st().doc, before, 'later moves do nothing');
});
e2e('new measures are selected; measures over furniture stay selectable', () => {
  setTool('measure');
  click({ x: 5000, y: 12000 });
  move({ x: 7600, y: 12000 }, { buttons: 0 });
  click({ x: 7600, y: 12000 });
  const m = st().doc.measures[0];
  eq(JSON.stringify(st().ui.selection), JSON.stringify({ kind: 'measure', id: m.id }));
  setTool('select');
  st().setUI({ selection: null });
  click({ x: 6500, y: 12000 }); // over the sofa
  eq(st().ui.selection && st().ui.selection.kind, 'measure');
  st().undo();
});
e2e('opening tags avoid the stair and each other; landing "8" and 1º pav "D" drawn', () => {
  const ctx = canvas.getContext('2d');
  ['f0', 'f1', 'f2'].forEach((floor) => {
    [0.05, 0.1, 0.25].forEach((scale) => {
      const ui = Object.assign(DD.defaultUI(), { floor });
      const rc = T.makeRC(ctx, { cx: 5500, cy: 9000, scale, width: 1400, height: 1000 }, 1, st().doc, ui, { interactive: true });
      T.drawScene(rc);
      const tags = rc.placed.filter((b) => b.kind === 'tag');
      const stairs = rc.placed.filter((b) => b.kind === 'stair' || b.kind === 'letter');
      const hit = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
      tags.forEach((t, i) => {
        stairs.forEach((s) => ok(!hit(t, s), floor + '@' + scale + ' tag ' + t.id + ' on the stair'));
        tags.slice(i + 1).forEach((u) => ok(!hit(t, u), floor + '@' + scale + ' tags ' + t.id + '/' + u.id + ' overlap'));
      });
      if (floor === 'f1') eq(rc.placed.filter((b) => b.kind === 'letter').map((b) => b.id).join(), 'up,down', 'S and D on the 1º pav');
    });
  });
});
e2e('room labels avoid furniture and wrap long names', () => {
  const ctx = canvas.getContext('2d');
  const doc = DD.ops.update(st().doc, 'roomSeeds', 'r0_desp', { name: 'Despensa e lavanderia de serviço' });
  const bed = { id: 'bed', floor: 'f0', type: 'cama', x: 5825, y: 6700, rot: 0, w: 1600, d: 2000, h: 500, elev: 0, color: null };
  const doc2 = Object.assign({}, doc, { furniture: doc.furniture.concat([bed]) });
  const v = { cx: 5000, cy: 6000, scale: 0.12, width: 1400, height: 1000 };
  const rc = T.makeRC(ctx, v, 1, doc2, Object.assign(DD.defaultUI(), { floor: 'f0' }), { interactive: true });
  T.drawScene(rc);
  const q = rc.placed.find((b) => b.kind === 'room' && b.id === 'room:r0_quarto');
  const bs = { x0: (bed.x - 800 - v.cx) * v.scale + 700, x1: (bed.x + 800 - v.cx) * v.scale + 700, y0: (bed.y - 1000 - v.cy) * v.scale + 500, y1: (bed.y + 1000 - v.cy) * v.scale + 500 };
  ok(q && !(q.x0 < bs.x1 && bs.x0 < q.x1 && q.y0 < bs.y1 && bs.y0 < q.y1), 'Quarto label off the bed ' + JSON.stringify(q));
  const desp = rc.placed.find((b) => b.kind === 'room' && b.id === 'room:r0_desp');
  ok(desp.x1 - desp.x0 <= 1100 * v.scale + 1, 'label no wider than the room: ' + (desp.x1 - desp.x0));
  ok(desp.lines.length >= 3, 'name wrapped: ' + JSON.stringify(desp.lines));
});
e2e('exportPNG crops to the building and caps the image size', () => {
  const made = [];
  const orig = document.createElement;
  document.createElement = () => {
    const c = makeCanvas(10, 10);
    made.push(c);
    return c;
  };
  try {
    P.exportPNG({ scale: 2 });
    P.exportPNG({ scale: 6 });
  } finally {
    document.createElement = orig;
  }
  const [a, b] = made;
  ok(a.width <= 4000 && a.height <= 4000 && b.width <= 4000 && b.height <= 4000, [a.width, a.height, b.width, b.height].join('×'));
  ok(a.height < 4000 && a.width > 1500, 'about 2× the building: ' + a.width + '×' + a.height);
});

e2e('overlay states render without errors (tool previews, hovers, drag feedback, locks)', () => {
  const S2 = T.state();
  const ctx = canvas.getContext('2d');
  const render = (ui) => T.drawScene(T.makeRC(ctx, P.getViewport(), 1, st().doc, Object.assign(DD.defaultUI(), ui), { interactive: true }));
  S2.pointerInside = true;
  S2.cursorWorld = { x: 3000, y: 6000 };
  S2.hover = { kind: 'wall', id: 'w0_cozQuarto' };
  render({ tool: 'demolish' });
  S2.hover = { kind: 'wall', id: 'w0_left' };
  render({ tool: 'demolish' });
  S2.hover = { kind: 'room', id: 'room:r0_cozinha' };
  render({ tool: 'paint', paintMaterial: 'madeira' });
  S2.hover = { kind: 'handle', id: 'sofa', handle: { type: 'rotate' } };
  render({ tool: 'select', selection: { kind: 'furniture', id: 'sofa' } });
  render({ tool: 'select', selection: { kind: 'wall', id: 'w0_left' } });
  render({ tool: 'select', selection: { kind: 'wall', id: 'w0_cozDesp' } });
  render({ tool: 'select', selection: { kind: 'opening', id: 'o0_p6_desp' } });
  render({ tool: 'select', selection: { kind: 'room', id: 'room:r0_sala' }, show: { dims: false, furniture: false, areas: false, grid: false, labels: false, structure: false } });
  S2.hover = null;
  S2.measure = { a: { x: 2000, y: 6000 }, cur: { x: 3500, y: 6000 } };
  S2.snapHint = { x: 3500, y: 6000, kind: 'face' };
  render({ tool: 'measure' });
  S2.measure = null;
  S2.wallDraw = { a: { x: 5000, y: 11000 }, cur: { x: 6000, y: 11000 } };
  S2.snapHint = { x: 6000, y: 11000, kind: 'end' };
  render({ tool: 'wall' });
  S2.wallDraw = null;
  S2.snapHint = null;
  S2.feedback = {
    faces: [{ a: { x: 8850, y: 10500 }, b: { x: 8850, y: 14850 } }],
    rays: [{ a: { x: 5000, y: 12000 }, b: { x: 4300, y: 12000 }, dist: 700 }],
    ghostWall: DD.geom.wallPolygon(DD.ops.byId(st().doc, 'walls', 'w0_cozDesp')),
    alongDims: [{ a: { x: 4225, y: 2925 }, b: { x: 4225, y: 3775 } }],
    label: { at: { x: 4225, y: 3800 }, text: 'Deslocamento 0,20 m' },
    snapPoint: { x: 4225, y: 4675, kind: 'end' },
  };
  render({ tool: 'select' });
  S2.feedback = null;
  S2.fades = [{ wallId: 'w0_cozQuarto', floor: 'f0', t0: now }];
  render({ tool: 'demolish' });
  S2.fades = [];
  S2.pointerInside = false;
  const errs = warnings.filter((w) => /layer|opening:|render/.test(w));
  eq(errs.length, 0, errs.join(' | '));
});

console.warn = origWarn;
const unexpected = warnings.filter((w) => !/draw2d|catalog/.test(w));
if (unexpected.length) {
  failed++;
  console.log('Unexpected warnings:\n  ' + unexpected.join('\n  '));
}
console.log(`plan2d: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
