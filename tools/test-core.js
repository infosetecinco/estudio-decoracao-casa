global.window = global; global.localStorage = { getItem(){return null}, setItem(){}, removeItem(){} };
require('../src/00-data.js'); require('../src/01-core.js');
const DD = global.DD; const doc = DD.data.initialState();
let bad = 0;
for (const f of doc.floors) {
  const t0 = Date.now(); const rooms = DD.rooms.compute(doc, f.id); const ms = Date.now() - t0;
  console.log(`== ${f.name} (${ms} ms)`);
  for (const r of rooms) {
    const ok = r.planArea == null ? '' : (Math.abs(r.area - r.planArea) < 0.006 ? 'OK' : 'MISMATCH plan ' + r.planArea);
    if (ok.startsWith('MISMATCH') || r.open) bad++;
    console.log(`  ${r.name.padEnd(22)} ${r.area.toFixed(3).padStart(8)} m²  verts=${r.outer ? r.outer.length : 0} holes=${r.holes.length} open=${r.open} ${ok}`);
  }
}
// demolish test
const d2 = DD.ops.demolishWall(doc, 'w0_cozQuarto');
console.log('demolish partition err=', d2.error, DD.rooms.compute(d2.doc, 'f0').map(r => r.name + ' ' + r.area.toFixed(2)).join(' | '));
console.log('demolish structural err=', DD.ops.demolishWall(doc, 'w0_back').error);
// snapping test: sofa-like 2000x900 near sala right wall
const snap = DD.geom.snapFurniture(doc, 'f0', { w: 2000, d: 900 }, { x: 8300, y: 12000, rot: 80 }, { threshold: 200 });
console.log('snap', JSON.stringify(snap));
console.log('dims f0', JSON.stringify(DD.geom.dimensionData(doc, 'f0').xs));
console.log('stair', JSON.stringify(DD.geom.stairGeometry(doc.stairs[0], 2880).treads.map(t => [t.n, t.x0, t.x1, Math.round(t.z)])));

// moveWall regression: moving the kitchen/quarto partition must not open the 3-wall junction
{
  const moved = DD.ops.moveWall(doc, 'w0_cozQuarto', 500, 0);
  const rooms = DD.rooms.compute(moved, 'f0');
  const names = rooms.map(r => r.name + ' ' + r.area.toFixed(2)).join(' | ');
  const merged = rooms.some(r => r.name.includes('+') || r.open);
  console.log('moveWall cozQuarto +500:', names);
  if (merged) { console.log('MOVEWALL FAIL'); bad++; }
  const coz = rooms.find(r => r.name === 'Cozinha'), q = rooms.find(r => r.name === 'Quarto');
  if (!(Math.abs(coz.area - (14.0 + 0.5*3.85)) < 0.02) || !(Math.abs(q.area - (11.74 - 0.5*3.85)) < 0.02)) { console.log('MOVEWALL AREA FAIL', coz.area, q.area); bad++; }
}

// ---- regression tests added after QA ----
function check(name, cond, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!cond) bad++; }
{ // split room by a new wall -> the other half gets its own seed and the floor total is preserved
  const before = DD.rooms.totalArea(doc, 'f0');
  const r = DD.ops.addWall(doc, 'f0', { x: 4300, y: 12510 }, { x: 8850, y: 12510 }, 100);
  const rooms = DD.rooms.compute(r.doc, 'f0');
  const sala2 = rooms.find(x => x.name === 'Sala 2');
  const after = DD.rooms.totalArea(r.doc, 'f0');
  check('split reseed creates "Sala 2"', !!sala2 && sala2.material === 'porcelanato', sala2 && sala2.area.toFixed(2));
  check('split keeps floor total (minus the wall)', Math.abs(before - after - 4.55 * 0.1) < 0.02, before.toFixed(2) + ' -> ' + after.toFixed(2));
}
{ // moving a partition never changes structural walls; openings of stretched partitions keep world position
  const moved = DD.ops.moveWall(doc, 'w1_closetBottom', 0, 300);
  const sb0 = DD.ops.byId(doc, 'walls', 'w1_suiteBanho'), sb1 = DD.ops.byId(moved, 'walls', 'w1_suiteBanho');
  check('structural wall untouched by moveWall', JSON.stringify(sb0) === JSON.stringify(sb1));
  const div1 = DD.ops.byId(moved, 'walls', 'w1_closetDiv');
  check('partition stretched to follow', div1.b.y === 4975, JSON.stringify(div1.b));
}
{ // store: undo/redo during a gesture
  const st = DD.createStore(doc, DD.defaultUI());
  const d1 = DD.ops.update(doc, 'furniture', doc.furniture[0] ? doc.furniture[0].id : 'x', { color: '#112233' });
  st.commit(d1, 'Editar cor');
  st.beginGesture('Mover');
  st.preview(DD.ops.update(st.doc, 'measures', 'none', {}));
  st.preview(Object.assign({}, st.doc, { measures: [{ id: 'm1', floor: 'f0', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }] }));
  st.undo();
  check('undo during gesture only cancels the gesture', st.doc === d1 && !st.inGesture() && st.undoLabel() === 'Editar cor');
  st.undo(); st.beginGesture('Mover'); st.preview(Object.assign({}, st.doc, { measures: [] }));
  st.redo();
  check('redo during gesture closes the gesture', !st.inGesture());
  let seenPrev = null;
  st.subscribe((d, prev, info) => { if (info.gestureEnd) seenPrev = prev; });
  const start = st.doc; st.beginGesture('G'); st.preview(Object.assign({}, st.doc, { measures: [] })); st.endGesture('G');
  check('endGesture notifies with the pre-gesture doc as prev', seenPrev === start);
}
{ // import validation
  const V = DD.persist.validate;
  const base = () => JSON.parse(JSON.stringify(doc));
  check('valid doc accepted', !!V(base()));
  let b = base(); b.floors = [{}]; check('floor without id rejected', V(b) === null);
  b = base(); b.floors = []; check('no floors rejected', V(b) === null);
  b = base(); b.furniture = [{ id: 'f1', floor: 'f0', type: 'sofa3', x: 5000, y: 12000, w: 2100, d: 900, rot: 'x', h: null }]; const v = V(b);
  check('bad optional furniture fields defaulted', v && v.furniture[0].rot === 0 && v.furniture[0].h > 0);
  b = base(); b.openings.push({ id: 'o_bad', wall: 'nope', type: 'door', t: 1, width: 700, height: 2100 }); const v2 = V(b);
  check('opening on a missing wall dropped', v2 && !v2.openings.some(o => o.id === 'o_bad') && DD.persist.lastDropped === 1);
  b = base(); b.walls = b.walls.map(w => Object.assign({}, w, { floor: 'zzz' })); check('mass-broken file rejected', V(b) === null);
  b = base(); b.roomSeeds[0].name = '<img src=x onerror=alert(1)>'; check('names kept as plain text (escaped at render)', V(b).roomSeeds[0].name.startsWith('<img'));
}
{ // stair per the drawing: 16 risers of 18 cm, landing at 1,44 m
  const g = DD.geom.stairGeometry(doc.stairs[0], 2880);
  check('stair riser 180 mm x16', Math.abs(g.riser - 180) < 1e-9 && g.risers === 16);
  check('landing at 1,44 m', g.landing[0].z === 1440 && g.landingLabel.n === 8);
  check('tread 15 at 2,70 m next to arrival', g.treads.find(t => t.n === 15).z === 2700);
}
{ // per-facade dimension chains follow the approved drawing
  const D0 = DD.geom.dimensionData(doc, 'f0');
  const seg = a => a.map((v, i) => i ? ((v - a[i - 1]) / 1000).toFixed(2) : null).filter(Boolean).join('|');
  check('Térreo bottom chain 0,15|4,00|0,15|4,55|0,15', seg(D0.bottom) === '0.15|4.00|0.15|4.55|0.15', seg(D0.bottom));
  check('Térreo right chain has 1,60|0,15|3,85|0,15|6,10', seg(D0.right).includes('1.60|0.15|3.85|0.15|6.10'), seg(D0.right));
  const D2 = DD.geom.dimensionData(doc, 'f2');
  check('2º pav chains wrap the terrace', D2.bbox.maxY >= 15000, JSON.stringify(D2.bbox));
}
process.exit(bad ? 1 : 0);
