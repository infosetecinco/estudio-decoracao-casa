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
process.exit(bad ? 1 : 0);
