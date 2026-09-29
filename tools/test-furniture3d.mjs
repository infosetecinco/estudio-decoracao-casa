// Node test for src/12-furniture3d.js — run: node tools/test-furniture3d.mjs
// Needs three@0.170.0 in tools/.three (npm install three@0.170.0 --prefix tools/.three).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const threePath = path.join(here, '.three', 'node_modules', 'three', 'build', 'three.module.js');
if (!fs.existsSync(threePath)) {
  console.error('three.js não encontrado em ' + threePath + ' — rode: npm install three@0.170.0 --prefix tools/.three');
  process.exit(2);
}
const THREE = await import(pathToFileURL(threePath).href);

globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(here, '..', 'src', '12-furniture3d.js'), 'utf8'), { filename: '12-furniture3d.js' });
const DD = globalThis.DD;
const F = DD.furniture3d;
const TYPES = F._internal.FALLBACK_TYPES;

const TOL = 0.03; // m
// Parts allowed above the nominal height (m): faucets on sink/vanity.
const HEIGHT_ALLOWANCE = { kitchenSink: 0.3, basin: 0.2 };
const TRI_BUDGET = (type) => (type === 'car' ? 6000 : 3000);
const SCALES = [
  { name: '1x', k: [1, 1, 1] },
  { name: '2x', k: [2, 2, 2] },
  { name: '0.5x', k: [0.5, 0.5, 0.5] },
  { name: 'mixed', k: [1.6, 0.7, 1.2] },
];

let failures = 0;
let checks = 0;
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error('  FAIL ' + msg);
  }
}

function triangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return n;
}
function hasNaN(root) {
  let bad = false;
  root.traverse((o) => {
    if (o.isMesh && o.geometry.attributes.position.array.some((v) => !isFinite(v))) bad = true;
  });
  return bad;
}
const centre = (p) => [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2];

function checkItem(type, item, label) {
  let root;
  try {
    root = F.build(THREE, item);
  } catch (e) {
    check(false, `${label}: exceção ${e.stack}`);
    return null;
  }
  const w = item.w / 1000, d = item.d / 1000, h = item.h / 1000;
  const box = new THREE.Box3().setFromObject(root);
  check(root.name === type, `${label}: root.name ${root.name}`);
  check(root.userData.furnitureId === item.id, `${label}: root furnitureId`);
  check(Math.abs(box.min.y) < 0.005, `${label}: min y ${box.min.y.toFixed(4)}`);
  check(box.min.x >= -w / 2 - TOL && box.max.x <= w / 2 + TOL, `${label}: x [${box.min.x.toFixed(3)}, ${box.max.x.toFixed(3)}] vs ±${(w / 2).toFixed(3)}`);
  check(box.min.z >= -d / 2 - TOL && box.max.z <= d / 2 + TOL, `${label}: z [${box.min.z.toFixed(3)}, ${box.max.z.toFixed(3)}] vs ±${(d / 2).toFixed(3)}`);
  const allow = (HEIGHT_ALLOWANCE[type] || 0) + TOL;
  check(box.max.y <= h + allow, `${label}: max y ${box.max.y.toFixed(3)} > h ${h.toFixed(3)}`);
  check(box.max.y >= h * 0.8 || h < 0.05, `${label}: model too short (${box.max.y.toFixed(3)} for h ${h.toFixed(3)})`);
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    check(o.userData.furnitureId === item.id, `${label}: mesh sem furnitureId`);
    check(o.castShadow && o.receiveShadow, `${label}: sombras`);
    check(o.material.userData.shared === true, `${label}: material não compartilhado`);
  });
  check(meshes > 0, `${label}: sem malhas`);
  const tris = triangles(root);
  check(tris <= TRI_BUDGET(type), `${label}: ${tris} triângulos > ${TRI_BUDGET(type)}`);
  check(!hasNaN(root), `${label}: NaN nas posições`);
  return { root, tris, meshes };
}

function orientationChecks() {
  const parts = (type) => F.build(THREE, { id: 'o_' + type, type, ...TYPES[type] }).userData.parts;
  const back = ['sofa3', 'sofa2', 'sofaL', 'armchair', 'outdoorSofa', 'chair', 'officeChair', 'lounger'];
  for (const t of back) {
    const p = parts(t).backrest;
    check(!!p, `${t}: part backrest ausente`);
    if (p) check(centre(p)[2] < 0, `${t}: encosto não está em -Z (${centre(p)[2].toFixed(3)})`);
  }
  const car = parts('car');
  check(car.headlight && car.headlight.min[2] > 0, 'car: faróis devem estar em +Z');
  check(car.taillight && car.taillight.max[2] < 0, 'car: lanternas devem estar em -Z');
  check(car.grille && car.grille.min[2] > 0, 'car: grade em +Z');
  const tv = parts('tvUnit');
  check(tv.screen && tv.tv && tv.screen.max[2] > tv.tv.max[2], 'tvUnit: tela deve ficar na face +Z da TV');
  for (const t of ['bedQueen', 'bedDouble', 'bedSingle']) {
    const p = parts(t);
    check(p.headboard && centre(p.headboard)[2] < -0.8, `${t}: cabeceira em -Z`);
    check(p.pillow && centre(p.pillow)[2] < 0, `${t}: travesseiros junto à cabeceira`);
  }
  const wc = parts('toilet');
  check(wc.tank && wc.bowl && centre(wc.tank)[2] < centre(wc.bowl)[2], 'toilet: caixa atrás, bacia para +Z');
  const fridge = parts('fridge');
  check(fridge.door && fridge.door.max[2] > 0.25, 'fridge: portas em +Z');
  const bike = parts('bike');
  check(bike.handlebar && centre(bike.handlebar)[2] > 0 && centre(bike.saddle)[2] < centre(bike.handlebar)[2], 'bike: guidão à frente (+Z)');
  const shower = parts('shower');
  check(shower.showerHead && centre(shower.showerHead)[1] > 1.5, 'shower: chuveiro no alto');
}

function colourAndFallbackChecks() {
  const a = F.build(THREE, { id: 'c1', type: 'sofa3', w: 2100, d: 900, h: 850, color: '#123456' });
  let found = false;
  a.traverse((o) => {
    if (o.isMesh && o.material.color.getHexString() === '123456') found = true;
  });
  check(found, 'item.color deve sobrescrever a cor principal');
  DD.catalog = { types: { sofa3: { name: 'Sofá', w: 2000, d: 900, h: 800, color: '#654321' } } };
  const b = F.build(THREE, { id: 'c2', type: 'sofa3' });
  let catColour = false;
  b.traverse((o) => {
    if (o.isMesh && o.material.color.getHexString() === '654321') catColour = true;
  });
  check(catColour, 'cor do catálogo deve ser usada quando item.color é nulo');
  const bb = new THREE.Box3().setFromObject(b);
  check(Math.abs(bb.max.x - bb.min.x - 2.0) < TOL, 'dimensões do catálogo usadas quando item.w falta');
  delete DD.catalog;
  const m1 = new Set(), m2 = new Set();
  F.build(THREE, { id: 's1', type: 'chair', w: 450, d: 520, h: 850 }).traverse((o) => o.isMesh && m1.add(o.material));
  F.build(THREE, { id: 's2', type: 'chair', w: 450, d: 520, h: 850 }).traverse((o) => o.isMesh && m2.add(o.material));
  check([...m1].every((m) => m2.has(m)), 'materiais devem ser reutilizados entre itens iguais');
  const unk = F.build(THREE, { id: 'u', type: 'naoExiste', w: 700, d: 300, h: 1200, color: '#AA0000' });
  const ub = new THREE.Box3().setFromObject(unk);
  check(Math.abs(ub.max.x - 0.35) < 0.002 && Math.abs(ub.max.y - 1.2) < 0.002 && Math.abs(ub.min.z + 0.15) < 0.002, 'tipo desconhecido → caixa do tamanho do item');
  let threw = false;
  try {
    F.build(THREE, { id: 'bad', type: 'sofa3', w: -5, d: NaN, h: 'x', color: 'azul' });
    F.build(THREE, null);
  } catch (e) {
    threw = true;
  }
  check(!threw, 'valores inválidos não devem lançar exceção');
  let threwNoThree = false;
  try {
    F.build(null, { type: 'sofa3' });
  } catch (e) {
    threwNoThree = e instanceof TypeError;
  }
  check(threwNoThree, 'sem THREE → TypeError');
  check(F._internal.tone('#808080', 1) === '#ffffff' && F._internal.tone('#808080', -1) === '#000000', 'tone()');
  check(F._internal.normalizeHex('#AbC') === '#aabbcc' && F._internal.normalizeHex('red') === null, 'normalizeHex()');
}

const t0 = Date.now();
const report = [];
for (const type of Object.keys(TYPES)) {
  const def = TYPES[type];
  for (const s of SCALES) {
    const item = { id: `it_${type}_${s.name}`, type, x: 0, y: 0, rot: 0, w: def.w * s.k[0], d: def.d * s.k[1], h: def.h * s.k[2], elev: 0, color: null };
    const r = checkItem(type, item, `${type} ${s.name}`);
    if (r && s.name === '1x') report.push(`${type.padEnd(13)} tris=${String(r.tris).padStart(5)} meshes=${r.meshes}`);
  }
}
check(F.types.length === Object.keys(TYPES).length, 'todos os tipos têm construtor dedicado');
orientationChecks();
colourAndFallbackChecks();
console.log(report.join('\n'));
console.log(`\n${checks - failures}/${checks} verificações OK em ${Date.now() - t0} ms`);
process.exit(failures ? 1 : 0);
