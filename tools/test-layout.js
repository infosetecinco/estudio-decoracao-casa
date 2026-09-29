// tools/test-layout.js — validates DD.catalog.defaultLayout(doc) against the real plan geometry.
// Run: node tools/test-layout.js   (exit code 1 on any violation)
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

// Keep-clear zones [x0, x1, y0, y1] per floor (door swings, thresholds, circulation, stair approaches).
const KEEP_CLEAR = {
  f0: [
    ['Cozinha: porta P1 fundos', 3225, 4025, 3000, 3800],
    ['Cozinha: correr P6 despensa', 3550, 4150, 3775, 4575],
    ['Cozinha: porta P1 sala', 3225, 4025, 7800, 8600],
    ['Desp.: entrada', 4300, 4900, 3775, 4575],
    ['Suíte: porta P2', 6575, 7275, 3900, 4600],
    ['Quarto: porta P1', 6425, 7225, 7800, 8600],
    ['Lav.: porta P2', 2300, 3000, 8825, 9525],
    ['Sala: porta de entrada P3', 5128, 5928, 14050, 14850],
    ['Hall: porta da garagem', 3250, 4050, 9550, 10350],
    ['Garagem: porta para o hall', 3250, 4050, 10500, 11300],
    ['Hall: circulação', 3150, 6150, 8750, 9650],
    ['Hall: pé da escada', 5250, 6150, 9550, 10350],
    ['Sala: passagem entrada → hall', 5150, 6050, 10350, 14050],
  ],
  f1: [
    ['Closet E: porta P6', 3250, 4050, 3900, 4600],
    ['Closet D: porta P2', 4425, 5125, 3900, 4600],
    ['Master: frente dos closets', 3250, 5125, 4750, 5300],
    ['Master: acesso à suíte', 3150, 3700, 4850, 5550],
    ['Master: porta P2', 3275, 3975, 7900, 8600],
    ['Suíte: porta P2', 2300, 3000, 4850, 5550],
    ['Banhº: porta P2', 2300, 3000, 9525, 10225],
    ['Circ.: corredor', 3150, 5600, 8750, 9650],
    ['Circ.: acesso ao banho', 3150, 3700, 9525, 10225],
    ['Circ.: acesso quarto 1', 3325, 4025, 9650, 10350],
    ['Circ.: acesso quarto 2', 4425, 5125, 9650, 10350],
    ['Circ.: chegada/saída da escada', 5600, 6150, 8750, 10350],
    ['Quarto 1: porta P2', 3325, 4025, 10500, 11200],
    ['Quarto 1: porta balcão P5', 1700, 3300, 14050, 14850],
    ['Quarto 2: porta P2', 4425, 5125, 10500, 11200],
    ['Quarto 2: porta balcão P5', 5150, 6750, 14050, 14850],
    ['Varanda: folhas P5 quarto 1', 1700, 3300, 15000, 15800],
    ['Varanda: folhas P5 quarto 2', 5150, 6750, 15000, 15800],
  ],
  f2: [
    ['Lav.: porta P2', 2300, 3000, 8775, 9475],
    ['Gourmet: acesso ao lavabo', 3150, 3700, 8775, 9475],
    ['Gourmet: porta P4', 3250, 5250, 9650, 10350],
    ['Terraço: porta P4', 3250, 5250, 10500, 11300],
    ['Gourmet: chegada da escada', 5600, 6150, 8750, 9550],
  ],
};

// Chairs may be tucked under desks/tables (drawn as part of a working set).
const CHAIRS = new Set(['chair', 'officeChair']);
const TABLES = new Set(['desk', 'dining4', 'dining6', 'dining8', 'roundTable', 'outdoorTable', 'island', 'closetIsland']);

// ------------------------------------------------------------------ geometry helpers
function footprint(it, shrink) {
  const hw = Math.max(1, it.w / 2 - shrink), hd = Math.max(1, it.d / 2 - shrink);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) => DD.util.localToWorld(it.x, it.y, it.rot, lx, ly));
}
function rectPoly(x0, x1, y0, y1) {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
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
  doc.walls
    .filter((w) => w.floor === it.floor)
    .forEach((w) => {
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

function checkKeepClear(it) {
  const poly = footprint(it, SHRINK);
  (KEEP_CLEAR[it.floor] || []).forEach(([name, x0, x1, y0, y1]) => {
    if (overlaps(poly, rectPoly(x0, x1, y0, y1))) fail(it, 'blocks keep-clear zone "' + name + '"');
  });
}

function checkPairs(list) {
  const solid = list.filter((it) => !DD.catalog.types[it.type].flat);
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (a.floor !== b.floor) continue;
      const tucked = (CHAIRS.has(a.type) && TABLES.has(b.type)) || (CHAIRS.has(b.type) && TABLES.has(a.type));
      if (tucked) continue;
      const [a0, a1] = zRange(a), [b0, b1] = zRange(b);
      if (a1 <= b0 || b1 <= a0) continue; // stacked (e.g. upper cabinet over a counter)
      if (overlaps(footprint(a, SHRINK), footprint(b, SHRINK))) fail(a, 'overlaps ' + b.id + ' (' + b.type + ')');
    }
}

// ------------------------------------------------------------------ run
if (!Array.isArray(items) || !items.length) {
  console.error('defaultLayout returned no items');
  process.exit(1);
}
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
  checkKeepClear(it);
  if (roomId) perRoom.set(roomId, (perRoom.get(roomId) || 0) + 1);
});
checkPairs(items);

// every floor furnished, every furnishable room has something in it
doc.floors.forEach((f) => {
  DD.rooms.compute(doc, f.id).forEach((r) => {
    if (!perRoom.get(r.id)) fail(null, `room ${r.name} (${f.id}) is empty`);
  });
});

// purity: calling twice yields equal content but distinct objects; the doc is untouched
const again = DD.catalog.defaultLayout(doc);
if (JSON.stringify(again) !== JSON.stringify(items)) fail(null, 'defaultLayout is not deterministic');
if (again[0] === items[0]) fail(null, 'defaultLayout must return fresh objects');
if (doc.furniture.length !== 0) fail(null, 'defaultLayout mutated doc.furniture');

const counts = doc.floors.map((f) => f.id + '=' + items.filter((i) => i.floor === f.id).length).join(' ');
if (failures.length) {
  console.error(`defaultLayout: ${failures.length} violation(s)\n  ` + failures.join('\n  '));
  process.exit(1);
}
console.log(`defaultLayout OK — ${items.length} items (${counts}), ${perRoom.size} rooms furnished`);
