// tools/test-view3d.js — pure helpers of DD.view3d (no three.js / DOM): camera math, rectilinear decomposition,
// collision, walkable surfaces, stairs climbing, spawn logic.
// Run: node tools/test-view3d.js   (exit code 1 on failure)
'use strict';
global.window = global;
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
require('../src/00-data.js');
require('../src/01-core.js');
require('../src/11-catalog.js');
require('../src/30-view3d.js');

const DD = global.DD;
const P = DD.view3d._pure;
const failures = [];
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(name + ': ' + e.message);
  }
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function near(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= (tol == null ? 1e-6 : tol))) throw new Error((msg || 'near') + ': ' + a + ' vs ' + b);
}
const rectArea = (rects) => rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0) / 1e6;

const doc = DD.data.initialState();
doc.furniture = DD.catalog.defaultLayout(doc);

// ------------------------------------------------------------------ public API shape
test('public API matches the contract', () => {
  ['init', 'isReady', 'setActive', 'resize', 'setCameraMode', 'transitionFrom2D', 'transitionTo2D', 'exportPNG'].forEach((k) =>
    ok(typeof DD.view3d[k] === 'function', 'missing ' + k)
  );
  ok(DD.view3d.isReady() === false, 'not ready without three.js');
});
test('transitions resolve (false) when 3D is not loaded', () => {
  ok(DD.view3d.transitionFrom2D({ cx: 0, cy: 0, scale: 1, width: 10, height: 10 }) instanceof Promise);
  ok(DD.view3d.transitionTo2D({ cx: 0, cy: 0, scale: 1, width: 10, height: 10 }) instanceof Promise);
  ok(DD.view3d.exportPNG() === null);
});

// ------------------------------------------------------------------ camera math
test('top-down height: visible world height equals viewport height / scale', () => {
  const h = P.topDownHeight(10000, 45);
  near(h, 10 / (2 * Math.tan((22.5 * Math.PI) / 180)), 1e-9);
  near(2 * h * Math.tan((22.5 * Math.PI) / 180), 10, 1e-9, 'visible metres');
});
test('top-down pose is centred on the 2D viewport, above the floor level, with up = -Z', () => {
  const vp = { cx: 4500, cy: 9000, scale: 0.05, width: 800, height: 600 };
  const pose = P.topDownPose(vp, 2880, 45);
  near(pose.pos.x, 4.5);
  near(pose.pos.z, 9);
  near(pose.target.y, 2.88);
  near(pose.pos.y - 2.88, P.topDownHeight(600 / 0.05, 45), 1e-9);
  ok(pose.up.z === -1 && pose.up.y === 0, 'screen-up must be drawing-up (-Z)');
  ok(P.topDownPose({ cx: NaN, cy: 0, scale: 1, height: 1 }, 0, 45) === null, 'invalid viewport');
  ok(P.topDownPose({ cx: 0, cy: 0, scale: 0, height: 1 }, 0, 45) === null, 'zero scale');
});
test('yaw ↔ plan direction round-trip (three camera looks down -Z)', () => {
  [[0, -1], [1, 0], [0, 1], [-1, 0], [Math.SQRT1_2, Math.SQRT1_2]].forEach(([x, y]) => {
    const d = P.dirFromYaw(P.yawFromDir(x, y));
    near(d.x, x, 1e-9, 'dx');
    near(d.y, y, 1e-9, 'dy');
  });
  near(P.yawFromDir(0, -1), 0, 1e-12, 'facing -y is yaw 0');
  near(P.yawFromDir(1, 0), -Math.PI / 2, 1e-12, 'facing +x is yaw -90°');
});
test('aerial pose looks at the active floor from the street side, above it', () => {
  const pose = P.aerialPose(doc, 'f1');
  ok(pose.pos.z > pose.target.z, 'camera on the street side (+Z)');
  ok(pose.pos.y > pose.target.y + 5, 'camera well above the target');
  near(pose.target.y, 2.88 + 0.9, 1e-9, 'target at the floor level');
  const b = P.floorBounds(doc, 'f1');
  near(pose.target.x, ((b.minX + b.maxX) / 2) / 1000, 1e-9);
});
test('easeInOutCubic endpoints and symmetry', () => {
  near(P.easeInOutCubic(0), 0);
  near(P.easeInOutCubic(1), 1);
  near(P.easeInOutCubic(0.5), 0.5);
  near(P.easeInOutCubic(0.25) + P.easeInOutCubic(0.75), 1, 1e-12);
});

// ------------------------------------------------------------------ rectilinear decomposition
test('room rectangles reproduce every closed room area', () => {
  doc.floors.forEach((f) => {
    DD.rooms.compute(doc, f.id).forEach((r) => {
      if (r.open) return;
      near(rectArea(P.polysToRects([{ outer: r.outer, holes: r.holes }], [])), r.area, 1e-6, r.name);
    });
  });
});
test('stair hole touching the room outline is subtracted exactly (Circulação 9,12 − 4,32 m²)', () => {
  const circ = DD.rooms.byId(doc, 'f1', 'room:r1_circ');
  const holes = DD.geom.stairHoles(doc, 'f1');
  near(rectArea(P.polysToRects([{ outer: circ.outer, holes: circ.holes }], holes)), 9.12 - 4.32, 1e-6);
});
test('union of overlapping polygons counts overlap once', () => {
  const sq = (x0, y0, s) => ({ outer: [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }] });
  near(rectArea(P.polysToRects([sq(0, 0, 2000), sq(1000, 1000, 2000)], [])), 7, 1e-9);
});
test('offsetLoop grows a clockwise and a counter-clockwise rectangle outwards', () => {
  const cw = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }];
  const grown = P.offsetLoop(cw, 75);
  near(Math.min(...grown.map((p) => p.x)), -75);
  near(Math.max(...grown.map((p) => p.y)), 575);
  const ccw = cw.slice().reverse();
  near(Math.max(...P.offsetLoop(ccw, 75).map((p) => p.x)), 1075);
});
test('offset rooms meet at wall centre lines (f1 slab has no slots under 150 mm walls)', () => {
  const rooms = DD.rooms.compute(doc, 'f1').filter((r) => !r.open);
  const rects = P.polysToRects(rooms.map((r) => ({ outer: P.offsetLoop(r.outer, 75) })), []);
  const inside = (x, y) => rects.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
  ok(inside(4225, 12000), 'under partition between Quarto 1 and Quarto 2');
  ok(inside(3075, 6000), 'under structural wall Suíte/Master');
});
test('rectsOutline returns the union perimeter only', () => {
  const rects = [{ x0: 0, y0: 0, x1: 2000, y1: 1000 }, { x0: 2000, y0: 0, x1: 3000, y1: 2000 }];
  const len = P.rectsOutline(rects).reduce((s, g) => s + Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), 0);
  near(len, 2 * (3000 + 2000), 1e-6);
  P.rectsOutline(rects).forEach((g) => ok(Math.abs(g.n.x) + Math.abs(g.n.y) === 1, 'unit axis normal'));
});

// ------------------------------------------------------------------ collision
test('circle pushed out of a box (outside contact and centre inside)', () => {
  const box = { cx: 0, cy: 0, ux: 1, uy: 0, hl: 500, ht: 100, z0: 0, z1: 2800 };
  const a = P.resolveCircle(0, 250, 250, [box]);
  near(a.y, 350, 1e-6, 'pushed to touch the face');
  const b = P.resolveCircle(0, 40, 250, [box]);
  near(b.y, 350, 1e-6, 'centre inside leaves through the nearest side');
  const c = P.resolveCircle(0, 600, 250, [box]);
  ok(!c.hit, 'far circle untouched');
  const rot = { cx: 0, cy: 0, ux: 0, uy: 1, hl: 500, ht: 100, z0: 0, z1: 2800 }; // rotated 90°
  near(P.resolveCircle(300, 0, 250, [rot]).x, 350, 1e-6, 'oriented box');
});
const colliders = P.collectColliders(doc);
const bodyAt = (feet) => P.bodyColliders(colliders, feet);
test('door openings are passable, sills and gates block', () => {
  const body = bodyAt(0);
  ok(!P.overlapsAny(5527, 14925, 250, body), 'front door P3 of the Sala is passable');
  ok(P.overlapsAny(7750, 14925, 250, body), 'window J4 (sill 600) blocks');
  ok(P.overlapsAny(2400, 19925, 250, body), 'car gate (closed) blocks');
});
test('upper floor walls do not block the ground floor walker', () => {
  const w1 = colliders.filter((c) => c.z0 >= 2880);
  ok(w1.length > 0, 'f1 colliders exist');
  ok(P.bodyColliders(w1, 0).length === 0, 'f1 walls are above the Térreo body range');
});

// ------------------------------------------------------------------ surfaces & stairs
const ctx = P.surfaceContext(doc);
test('surfaces: ground, slabs and stair holes', () => {
  ok(P.surfacesAt(ctx, 5000, 12000).indexOf(2880) >= 0, 'f1 slab above the Sala');
  ok(P.surfacesAt(ctx, 5000, 18000).length === 1, 'front yard: ground only');
  const hole = P.surfacesAt(ctx, 7000, 10000);
  ok(hole.indexOf(2880) < 0, 'no f1 slab inside the stair hole');
});
test('step-up rule: climb, block, walk under', () => {
  ok(P.chooseSurface([0, 169], 0).z === 169 && !P.chooseSurface([0, 169], 0).blocked, 'climb one riser');
  ok(P.chooseSurface([0, 1524], 0).blocked, 'landing edge blocks');
  const under = P.chooseSurface([0, 2202], 0);
  ok(under.z === 0 && !under.blocked, 'walk under a high tread');
});
function walk(state, dir, dist, speed) {
  const world = { colliders, ctx, floors: doc.floors };
  const v = { x: dir.x * (speed || 1400), y: dir.y * (speed || 1400) };
  const dt = 1 / 60;
  let s = Object.assign({ vz: 0 }, state);
  const steps = Math.ceil(dist / ((speed || 1400) * dt));
  for (let i = 0; i < steps; i++) s = P.stepWalker(s, v, dt, world);
  for (let i = 0; i < 60; i++) s = P.stepWalker(s, { x: 0, y: 0 }, dt, world); // settle
  return s;
}
test('walker climbs the U-stair from the Térreo to the 1º Pavimento', () => {
  let s = { x: 5700, y: 9950, feet: 0 };
  s = walk(s, { x: 1, y: 0 }, 2900); // up the lower flight onto the landing
  ok(s.feet > 1400, 'reached the landing (feet ' + Math.round(s.feet) + ')');
  s = walk(s, { x: 0, y: -1 }, 800); // across the landing to the near row
  s = walk(s, { x: -1, y: 0 }, 2900); // up the upper flight onto the 1º Pavimento
  near(s.feet, 2880, 1, 'feet on the 1º Pavimento');
  ok(s.floorIndex === 1, 'floor index switched to f1');
  ok(s.x < 6150, 'left the stair into the Circulação');
});
test('walker descends back to the Térreo', () => {
  let s = { x: 5000, y: 9150, feet: 2880 };
  s = walk(s, { x: 1, y: 0 }, 2900);
  s = walk(s, { x: 0, y: 1 }, 800);
  s = walk(s, { x: -1, y: 0 }, 3000);
  near(s.feet, 0, 1, 'feet back on the ground floor');
  ok(s.floorIndex === 0, 'floor index back to f0');
});
test('Térreo: walk under the upper flight into the Quarto door', () => {
  const s = walk({ x: 6825, y: 9300, feet: 0 }, { x: 0, y: -1 }, 1200);
  ok(s.y < 8500, 'went through the door under the stair (y ' + Math.round(s.y) + ')');
  near(s.feet, 0, 1);
});
test('Térreo: low headroom under the landing blocks', () => {
  const s = walk({ x: 7300, y: 9150, feet: 0 }, { x: 1, y: 0 }, 1500);
  ok(s.x < 7800, 'stopped before the landing (x ' + Math.round(s.x) + ')');
});
test('walls stop the walker', () => {
  const s = walk({ x: 5500, y: 14000, feet: 0 }, { x: 1, y: 0 }, 5000);
  ok(s.x <= 8925 - 75 - 250 + 1, 'stopped by the right wall (x ' + Math.round(s.x) + ')');
});

// ------------------------------------------------------------------ spawn
test('spawn points per floor are collision free and face the requested direction', () => {
  [['f0', 0, 0], ['f1', 2880, -Math.PI / 2], ['f2', 5760, 0]].forEach(([fid, level, yaw]) => {
    const sp = P.spawnFor(doc, fid, colliders);
    near(sp.feet, level, 1e-9, fid + ' level');
    near(sp.yaw, yaw, 1e-9, fid + ' yaw');
    ok(!P.overlapsAny(sp.x, sp.y, 250, P.bodyColliders(colliders, level)), fid + ' spawn free');
  });
});
test('spawn is nudged out of furniture placed on it', () => {
  const sofa = { id: 'blocker', floor: 'f0', type: 'sofa3', x: 5500, y: 13900, rot: 0, w: 2100, d: 900, h: 850, elev: 0, color: null };
  const d2 = DD.ops.add(doc, 'furniture', sofa);
  const cols = P.collectColliders(d2);
  const sp = P.spawnFor(d2, 'f0', cols);
  ok(Math.hypot(sp.x - 5500, sp.y - 13900) > 300, 'moved away');
  ok(!P.overlapsAny(sp.x, sp.y, 250, P.bodyColliders(cols, 0)), 'free spot');
});

if (failures.length) {
  console.error('FAIL (' + failures.length + '):\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('test-view3d: ' + passed + ' tests passed');
