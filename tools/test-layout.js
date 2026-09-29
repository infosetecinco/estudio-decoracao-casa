// tools/test-layout.js — validates DD.catalog.defaultLayout(doc) against the real plan geometry.
// Run: node tools/test-layout.js   (exit code 1 on any violation)
// Checks: rooms, walls, stairs, circulation keep-clear zones, door swings & approaches derived from the
// openings data (hinge / side / style), windows (nothing taller than the sill right in front of a window),
// front access of storage & appliances, chair pull-out around dining sets, car doors, overlaps, purity.
'use strict';
global.window = global;
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
require('../src/00-data.js');
require('../src/01-core.js');
require('../src/11-catalog.js');

const DD = global.DD;
const doc = DD.data.initialState();
const items = DD.catalog.defaultLayout(doc);
const failures = [];
const fail = (it, msg) => failures.push(`${it ? it.id + ' (' + it.type + ')' : '-'}: ${msg}`);

const SHRINK = 2; // mm — items may touch walls / each other, not interpenetrate
const SAMPLE_STEP = 50; // mm between sample points along the footprint edges
const GARAGE_FRONT_Y = 15000;
const DOOR_APPROACH = 600; // mm kept clear in front of every door, on both sides
const SLIDE_POCKET = 60; // mm beside the wall face along which a sliding leaf travels
const WINDOW_ZONE = 200; // mm in front of a window face where nothing may rise above the sill
const CAR_DOOR_CLEAR = 600; // mm beside both car doors
const CHAIR_PULL_OUT = 350; // mm behind the (tucked) chairs of a dining set — table edge ≥ ~0,75 m from walls
const ARC_SEGMENTS = 12;

// Circulation zones that cannot be derived from the openings [name, x0, x1, y0, y1] (stairs, corridors).
const KEEP_CLEAR = {
  f0: [
    ['Hall: circulação', 3150, 6150, 8750, 9650],
    ['Hall: pé da escada', 5250, 6150, 9550, 10350],
    ['Sala: passagem entrada → hall', 5150, 6050, 10350, 14050],
  ],
  f1: [
    ['Master: frente dos closets', 3250, 5125, 4750, 5300],
    ['Circ.: corredor', 3150, 5600, 8750, 9650],
    ['Circ.: chegada/saída da escada', 5600, 6150, 8750, 10350],
  ],
  f2: [['Gourmet: chegada da escada', 5600, 6150, 8750, 9550]],
};

// Chairs may be tucked under desks/tables (drawn as part of a working set).
const CHAIRS = new Set(['chair', 'officeChair']);
const TABLES = new Set(['desk', 'dining4', 'dining6', 'dining8', 'roundTable', 'outdoorTable', 'island', 'closetIsland']);
// Sides of a dining set where chairs are pulled out (local frame): 'y' = ±depth, 'x' = ±width.
const DINING_SIDES = { dining4: ['y'], dining6: ['y'], dining8: ['y', 'x'], roundTable: ['y', 'x'], outdoorTable: ['y', 'x'] };
// Clear depth (mm) needed in front of items that are opened or used from the front.
const FRONT_ACCESS = {
  wardrobe: 600, dresser: 550, bookshelf: 450, shelves: 450, sideboard: 450, tvUnit: 0,
  kitchenSink: 600, counter: 600, stove: 700, fridge: 700, washer: 600, tanque: 600, bbq: 700,
  toilet: 450, basin: 500,
};

// ------------------------------------------------------------------ geometry helpers
function footprint(it, shrink) {
  const hw = Math.max(1, it.w / 2 - shrink), hd = Math.max(1, it.d / 2 - shrink);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) => DD.util.localToWorld(it.x, it.y, it.rot, lx, ly));
}
/** Rectangle in the item's local frame [lx0,lx1]×[ly0,ly1] → world polygon. */
function localRect(it, lx0, lx1, ly0, ly1) {
  return [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]].map(([lx, ly]) => DD.util.localToWorld(it.x, it.y, it.rot, lx, ly));
}
function rectPoly(x0, x1, y0, y1) {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}
const along = (w, f, t, u) => ({ x: w.a.x + f.d.x * t + f.n.x * u, y: w.a.y + f.d.y * t + f.n.y * u });
/** Rectangle in a wall's frame: t along the wall from a, u along the left normal. */
function wallRect(w, f, t0, t1, u0, u1) {
  return [along(w, f, t0, u0), along(w, f, t1, u0), along(w, f, t1, u1), along(w, f, t0, u1)];
}
/** Quarter disc swept by a leaf hinged at H, closed towards O, opening to `tip` (convex polygon). */
function sector(H, O, tip) {
  const r = Math.hypot(O.x - H.x, O.y - H.y);
  const a0 = Math.atan2(O.y - H.y, O.x - H.x);
  let da = Math.atan2(tip.y - H.y, tip.x - H.x) - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da <= -Math.PI) da += 2 * Math.PI;
  const pts = [H];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const a = a0 + (da * i) / ARC_SEGMENTS;
    pts.push({ x: H.x + Math.cos(a) * r, y: H.y + Math.sin(a) * r });
  }
  return pts;
}
function project(poly, ax) {
  let min = Infinity, max = -Infinity;
  poly.forEach((p) => {
    const v = p.x * ax.x + p.y * ax.y;
    if (v < min) min = v;
    if (v > max) max = v;
  });
  return [min, max];
}
/** Separating-axis test for convex polygons: true when interiors overlap. */
function overlaps(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = { x: -(q.y - p.y), y: q.x - p.x };
      if (Math.hypot(ax.x, ax.y) < 1e-9) continue;
      const [a0, a1] = project(a, ax), [b0, b1] = project(b, ax);
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}
function edgeSamples(poly) {
  const pts = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / SAMPLE_STEP));
    for (let k = 0; k < n; k++) pts.push({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n });
  }
  return pts;
}
function zRange(it) {
  const e = it.elev || 0;
  return [e, e + it.h];
}
const isFlat = (it) => !!(DD.catalog.types[it.type] || {}).flat;
const wallsOf = (floorId) => doc.walls.filter((w) => w.floor === floorId);
const tucked = (a, b) => (CHAIRS.has(a.type) && TABLES.has(b.type)) || (CHAIRS.has(b.type) && TABLES.has(a.type));

// ------------------------------------------------------------------ zones derived from the openings
/** Door swing sectors, sliding-leaf pockets and approach rectangles on both sides of every door. */
function doorZones(floorId) {
  const zones = [];
  doc.openings.forEach((op) => {
    if (op.type !== 'door') return;
    const w = doc.walls.find((x) => x.id === op.wall);
    if (!w || w.floor !== floorId) return;
    const f = DD.geom.openingFrame(w, op);
    const h = w.thick / 2, s = op.side || 1;
    const tag = `porta ${op.code} (${op.id})`;
    const face = (p, side) => ({ x: p.x + f.n.x * side * h, y: p.y + f.n.y * side * h });
    const leaf = (hingeP, closedP, len) => {
      const H = face(hingeP, s);
      const O0 = face(closedP, s);
      const k = len / (Math.hypot(O0.x - H.x, O0.y - H.y) || 1);
      const O = { x: H.x + (O0.x - H.x) * k, y: H.y + (O0.y - H.y) * k };
      const tip = { x: H.x + f.n.x * s * len, y: H.y + f.n.y * s * len };
      return sector(H, O, tip);
    };
    if (op.style === 'swing' || op.style === 'gate') {
      const hingeEnd = op.hinge === 'end';
      zones.push([tag + ': giro da folha', leaf(hingeEnd ? f.end : f.start, hingeEnd ? f.start : f.end, op.width)]);
    } else if (op.style === 'double') {
      zones.push([tag + ': giro folha 1', leaf(f.start, f.c, op.width / 2)]);
      zones.push([tag + ': giro folha 2', leaf(f.end, f.c, op.width / 2)]);
    } else if (op.style === 'slide') {
      const t0 = op.hinge === 'end' ? f.t1 : f.t0 - op.width;
      const u0 = s * h, u1 = s * (h + SLIDE_POCKET);
      zones.push([tag + ': curso da folha de correr', wallRect(w, f, t0, t0 + op.width, Math.min(u0, u1), Math.max(u0, u1))]);
    }
    [1, -1].forEach((side) => {
      const u0 = side * h, u1 = side * (h + DOOR_APPROACH);
      zones.push([tag + ': acesso', wallRect(w, f, f.t0, f.t1, Math.min(u0, u1), Math.max(u0, u1))]);
    });
  });
  return zones;
}

/** Thin zones in front of both faces of every window, with the glazing's height band. */
function windowZones(floorId) {
  const zones = [];
  doc.openings.forEach((op) => {
    if (op.type !== 'window') return;
    const w = doc.walls.find((x) => x.id === op.wall);
    if (!w || w.floor !== floorId) return;
    const f = DD.geom.openingFrame(w, op);
    const h = w.thick / 2;
    const z0 = op.sill || 0, z1 = Math.min(w.height, z0 + op.height);
    [1, -1].forEach((side) => {
      const u0 = side * h, u1 = side * (h + WINDOW_ZONE);
      zones.push({ name: `janela ${op.code} (${op.id})`, poly: wallRect(w, f, f.t0, f.t1, Math.min(u0, u1), Math.max(u0, u1)), z0, z1 });
    });
  });
  return zones;
}

// ------------------------------------------------------------------ checks
function checkShape(it) {
  const t = DD.catalog.types[it.type];
  if (!t) return fail(it, 'unknown type');
  if (!/^f_f[0-2]_\d+$/.test(it.id)) fail(it, 'id does not follow f_<floor>_<n>');
  if (!doc.floors.some((f) => f.id === it.floor)) fail(it, 'unknown floor ' + it.floor);
  ['x', 'y', 'rot', 'w', 'd', 'h', 'elev'].forEach((k) => {
    if (typeof it[k] !== 'number' || !isFinite(it[k])) fail(it, `field ${k} is not a finite number`);
  });
  if (!(it.w > 0 && it.d > 0 && it.h > 0)) fail(it, 'non-positive size');
  if (it.color !== null) fail(it, 'default layout must leave color null (catalog default)');
}

function checkRoom(it) {
  const poly = footprint(it, SHRINK);
  const pts = edgeSamples(poly).concat([{ x: it.x, y: it.y }]);
  let roomId = null;
  for (const p of pts) {
    if (it.type === 'car' && p.y >= GARAGE_FRONT_Y - SHRINK) continue; // car nose may pass the open garage front
    const r = DD.rooms.at(doc, it.floor, p.x, p.y);
    if (!r) return fail(it, `point (${Math.round(p.x)}, ${Math.round(p.y)}) is outside every room`);
    if (roomId && r.id !== roomId) return fail(it, `spans two rooms (${roomId} / ${r.id})`);
    roomId = r.id;
  }
  return roomId;
}

function checkWalls(it) {
  const poly = footprint(it, SHRINK);
  wallsOf(it.floor).forEach((w) => {
    if (overlaps(poly, DD.geom.wallPolygon(w))) fail(it, 'crosses wall ' + w.id);
  });
}

function checkStairs(it) {
  const poly = footprint(it, SHRINK);
  const rects = doc.stairs
    .filter((s) => s.floor === it.floor)
    .map((s) => ({ x0: s.x, y0: s.y, x1: s.x + s.length, y1: s.y + s.width }))
    .concat(DD.geom.stairHoles(doc, it.floor));
  rects.forEach((r) => {
    if (overlaps(poly, rectPoly(r.x0, r.x1, r.y0, r.y1))) fail(it, 'inside a stair footprint');
  });
}

function checkKeepClear(it, doors) {
  if (isFlat(it)) return; // rugs may run under a door leaf
  const poly = footprint(it, SHRINK);
  (KEEP_CLEAR[it.floor] || []).forEach(([name, x0, x1, y0, y1]) => {
    if (overlaps(poly, rectPoly(x0, x1, y0, y1))) fail(it, 'blocks keep-clear zone "' + name + '"');
  });
  (doors[it.floor] || []).forEach(([name, zone]) => {
    if (overlaps(poly, zone)) fail(it, 'blocks ' + name);
  });
}

function checkWindows(it, windows) {
  if (isFlat(it)) return;
  const [z0, z1] = zRange(it);
  const poly = footprint(it, SHRINK);
  (windows[it.floor] || []).forEach((wz) => {
    if (z1 <= wz.z0 || z0 >= wz.z1) return; // low item under the sill, or entirely above the glazing
    if (overlaps(poly, wz.poly)) fail(it, `stands in front of ${wz.name} (top ${z1} mm > sill ${wz.z0} mm)`);
  });
}

/** Zone must be free of walls and of other solid items (tucked chairs excepted when allowTucked). */
function zoneBlocker(it, zone, list, opts) {
  const o = opts || {};
  for (const w of wallsOf(it.floor)) if (overlaps(zone, DD.geom.wallPolygon(w))) return 'wall ' + w.id;
  for (const other of list) {
    if (other === it || other.floor !== it.floor || isFlat(other)) continue;
    if (o.ignore && o.ignore(other)) continue;
    const [a0, a1] = zRange(other);
    if (a0 >= (o.maxZ || 1800) || a1 <= 0) continue; // well above head height (upper cabinets, hoods)
    if (overlaps(zone, footprint(other, SHRINK))) return other.id + ' (' + other.type + ')';
  }
  return null;
}

function checkFrontAccess(it, list) {
  const depth = FRONT_ACCESS[it.type];
  if (!depth) return;
  const hw = it.w / 2 - SHRINK, hd = it.d / 2;
  const zone = localRect(it, -hw, hw, hd + SHRINK, hd + depth);
  const who = zoneBlocker(it, zone, list, { maxZ: 1400, ignore: (o) => CHAIRS.has(o.type) && it.type === 'desk' });
  if (who) fail(it, `front access (${depth} mm) blocked by ${who}`);
}

function checkChairPullOut(it, list) {
  const sides = DINING_SIDES[it.type];
  if (!sides) return;
  const hw = it.w / 2, hd = it.d / 2, k = CHAIR_PULL_OUT, e = SHRINK;
  const bands = [];
  if (sides.includes('y')) bands.push(localRect(it, -hw + e, hw - e, -hd - k, -hd - e), localRect(it, -hw + e, hw - e, hd + e, hd + k));
  if (sides.includes('x')) bands.push(localRect(it, -hw - k, -hw - e, -hd + e, hd - e), localRect(it, hw + e, hw + k, -hd + e, hd - e));
  bands.forEach((band) => {
    const who = zoneBlocker(it, band, list, { ignore: (o) => CHAIRS.has(o.type) });
    if (who) fail(it, `chairs cannot be pulled out (${k} mm): ${who}`);
  });
}

function checkCarDoors(it, list) {
  if (it.type !== 'car') return;
  const hw = it.w / 2, hd = it.d / 2;
  const ly0 = -hd + it.d * 0.3, ly1 = hd - it.d * 0.27; // from the rear door to the front door hinges
  [
    ['direito', localRect(it, -hw - CAR_DOOR_CLEAR, -hw - SHRINK, ly0, ly1)],
    ['esquerdo', localRect(it, hw + SHRINK, hw + CAR_DOOR_CLEAR, ly0, ly1)],
  ].forEach(([side, zone]) => {
    const who = zoneBlocker(it, zone, list);
    if (who) fail(it, `car door (lado ${side}) needs ${CAR_DOOR_CLEAR} mm: ${who}`);
  });
}

function checkPairs(list) {
  const solid = list.filter((it) => !isFlat(it));
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (a.floor !== b.floor || tucked(a, b)) continue;
      const [a0, a1] = zRange(a), [b0, b1] = zRange(b);
      if (a1 <= b0 || b1 <= a0) continue; // stacked (e.g. upper cabinet over a counter)
      if (overlaps(footprint(a, SHRINK), footprint(b, SHRINK))) fail(a, 'overlaps ' + b.id + ' (' + b.type + ')');
    }
}

// ------------------------------------------------------------------ self-test of the derived zones
function checkZoneDerivation(doors) {
  const find = (floorId, id, part) => (doors[floorId] || []).find(([n]) => n.includes('(' + id + ')') && n.includes(part));
  // Térreo Lav.: hinge 'start' (jamb at y 8825), leaf swings into the lavabo (−x).
  const lav = find('f0', 'o0_p2_lav', 'giro');
  const inside = (zone, p) => overlaps(zone, rectPoly(p.x - 1, p.x + 1, p.y - 1, p.y + 1));
  if (!lav) fail(null, 'no swing zone derived for o0_p2_lav');
  else {
    if (!inside(lav[1], { x: 2350, y: 8850 })) fail(null, 'o0_p2_lav swing must reach the leaf tip at the hinge side (2350, 8850)');
    if (inside(lav[1], { x: 2350, y: 9500 })) fail(null, 'o0_p2_lav swing must not cover the latch-side corner (2350, 9500)');
    if (inside(lav[1], { x: 3300, y: 9200 })) fail(null, 'o0_p2_lav leaf must swing into the lavabo, not the hall');
  }
  const suite = find('f0', 'o0_p2_suite', 'acesso');
  if (!suite) fail(null, 'no approach zone derived for o0_p2_suite');
  if (!windowZones('f1').some((z) => z.name.includes('o1_j6_closetD'))) fail(null, 'no window zone for o1_j6_closetD');
}

// ------------------------------------------------------------------ run
if (!Array.isArray(items) || !items.length) {
  console.error('defaultLayout returned no items');
  process.exit(1);
}
const doors = {}, windows = {};
doc.floors.forEach((f) => {
  doors[f.id] = doorZones(f.id);
  windows[f.id] = windowZones(f.id);
});
checkZoneDerivation(doors);

const ids = new Set();
const perRoom = new Map();
items.forEach((it) => {
  if (ids.has(it.id)) fail(it, 'duplicate id');
  ids.add(it.id);
  checkShape(it);
  if (!DD.catalog.types[it.type]) return;
  const roomId = checkRoom(it);
  checkWalls(it);
  checkStairs(it);
  checkKeepClear(it, doors);
  checkWindows(it, windows);
  checkFrontAccess(it, items);
  checkChairPullOut(it, items);
  checkCarDoors(it, items);
  if (roomId) perRoom.set(roomId, (perRoom.get(roomId) || 0) + 1);
});
checkPairs(items);

// every floor furnished, every furnishable room has something in it
doc.floors.forEach((f) => {
  DD.rooms.compute(doc, f.id).forEach((r) => {
    if (!perRoom.get(r.id)) fail(null, `room ${r.name} (${f.id}) is empty`);
  });
});
// the laundry exists (PDF: tanque + máquina on the 2º pav.)
['washer', 'tanque'].forEach((t) => {
  if (!items.some((it) => it.type === t && it.floor === 'f2')) fail(null, `no ${t} on the 2º pavimento (área de serviço)`);
});

// purity: calling twice yields equal content but distinct objects; the doc is untouched
const again = DD.catalog.defaultLayout(doc);
if (JSON.stringify(again) !== JSON.stringify(items)) fail(null, 'defaultLayout is not deterministic');
if (again[0] === items[0]) fail(null, 'defaultLayout must return fresh objects');
if (doc.furniture.length !== 0) fail(null, 'defaultLayout mutated doc.furniture');

const counts = doc.floors.map((f) => f.id + '=' + items.filter((i) => i.floor === f.id).length).join(' ');
const nZones = doc.floors.reduce((s, f) => s + doors[f.id].length + windows[f.id].length, 0);
if (failures.length) {
  console.error(`defaultLayout: ${failures.length} violation(s)\n  ` + failures.join('\n  '));
  process.exit(1);
}
console.log(`defaultLayout OK — ${items.length} items (${counts}), ${perRoom.size} rooms furnished, ${nZones} door/window zones respected`);
