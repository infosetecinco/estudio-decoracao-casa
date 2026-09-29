// Unit tests for the pure helpers of src/40-ui.js (no DOM). Run: node tools/test-ui.js
'use strict';
global.window = global;
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
// Loading the module must not touch the DOM: `document` is intentionally undefined here.
require('../src/00-data.js');
require('../src/01-core.js');
require('../src/40-ui.js');

const assert = require('assert');
const DD = global.DD;
const U = DD.ui.util;
let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(name + '\n    ' + (err && err.message));
  }
}

test('public API shape', () => {
  ['init', 'ready', 'setView', 'showToast'].forEach((k) => assert.strictEqual(typeof DD.ui[k], 'function', k));
});

test('parseDecimal accepts comma, dot and units', () => {
  assert.strictEqual(U.parseDecimal('4,25'), 4.25);
  assert.strictEqual(U.parseDecimal(' 4.25 m'), 4.25);
  assert.strictEqual(U.parseDecimal('1.200,5'), 1200.5);
  assert.strictEqual(U.parseDecimal('90°'), 90);
  assert.strictEqual(U.parseDecimal('-12'), -12);
  assert.ok(Number.isNaN(U.parseDecimal('')));
  assert.ok(Number.isNaN(U.parseDecimal('abc')));
  assert.ok(Number.isNaN(U.parseDecimal('1,2,3')));
  assert.ok(Number.isNaN(U.parseDecimal(null)));
});

test('parseMM reads pt-BR thousands and rounds', () => {
  assert.strictEqual(U.parseMM('1200'), 1200);
  assert.strictEqual(U.parseMM('1.200'), 1200);
  assert.strictEqual(U.parseMM('1 200 mm'), 1200);
  assert.strictEqual(U.parseMM('850,6'), 851);
  assert.strictEqual(U.parseMM('12.5'), 13);
  assert.ok(Number.isNaN(U.parseMM('x')));
});

test('parseMeters / parseDegrees', () => {
  assert.strictEqual(U.parseMeters('4,25'), 4250);
  assert.strictEqual(U.parseMeters('0.5'), 500);
  assert.strictEqual(U.parseDegrees('-90'), 270);
  assert.strictEqual(U.parseDegrees('450'), 90);
  assert.strictEqual(U.parseDegrees('359,96'), 0);
  assert.strictEqual(U.parseDegrees('12,34'), 12.3);
});

const item = { id: 'f1', type: 'sofa3', x: 4000, y: 6000, rot: 90, w: 2100, d: 900, h: 850, elev: 0 };
const lot = { w: 9000, h: 20000 };

test('furnitureEdit: valid patch', () => {
  assert.deepStrictEqual(U.furnitureEdit(item, 'w', '1800', lot), { patch: { w: 1800 } });
  assert.deepStrictEqual(U.furnitureEdit(item, 'x', '4,25', lot), { patch: { x: 4250 } });
  assert.deepStrictEqual(U.furnitureEdit(item, 'rot', '-90', lot), { patch: { rot: 270 } });
  assert.deepStrictEqual(U.furnitureEdit(item, 'elev', '400', lot), { patch: { elev: 400 } });
});

test('furnitureEdit: range limits 100–6000 mm', () => {
  assert.ok(U.furnitureEdit(item, 'w', '99', lot).error.indexOf('100') >= 0);
  assert.ok(U.furnitureEdit(item, 'd', '6001', lot).error.indexOf('6.000') >= 0);
  assert.ok(U.furnitureEdit(item, 'h', '6000', lot).patch);
  assert.ok(U.furnitureEdit(item, 'h', '100', lot).patch);
  assert.ok(U.furnitureEdit(item, 'x', '9,5', lot).error.indexOf('9,00 m') >= 0);
  assert.ok(U.furnitureEdit(item, 'elev', '-1', lot).error);
  assert.ok(U.furnitureEdit(item, 'w', 'abc', lot).error.indexOf('inválido') >= 0);
  assert.ok(U.furnitureEdit(item, 'nope', '1', lot).error);
});

test('furnitureEdit: unchanged value is a no-op', () => {
  assert.deepStrictEqual(U.furnitureEdit(item, 'w', '2100', lot), { noop: true });
  assert.deepStrictEqual(U.furnitureEdit(item, 'rot', '450', lot), { noop: true });
  assert.deepStrictEqual(U.furnitureEdit(item, 'x', '4,00', lot), { noop: true });
  assert.deepStrictEqual(U.furnitureEdit({ ...item, elev: undefined }, 'elev', '0', lot), { noop: true });
});

test('furnitureEdit never mutates the item', () => {
  const frozen = Object.freeze({ ...item });
  U.furnitureEdit(frozen, 'w', '1500', lot);
  assert.strictEqual(frozen.w, 2100);
});

test('thicknessEdit: 70–250 mm', () => {
  const wall = { thick: 100 };
  assert.deepStrictEqual(U.thicknessEdit(wall, '120'), { patch: { thick: 120 } });
  assert.deepStrictEqual(U.thicknessEdit(wall, '100'), { noop: true });
  assert.ok(U.thicknessEdit(wall, '60').error);
  assert.ok(U.thicknessEdit(wall, '251').error);
});

test('openingWidthEdit keeps the opening inside the wall and clear of siblings', () => {
  const op = { id: 'o1', t: 500, width: 700 };
  const res = U.openingWidthEdit(op, 3000, '900', [op]);
  assert.deepStrictEqual(res, { patch: { width: 900, t: 500 } });
  const near = U.openingWidthEdit({ id: 'o1', t: 400, width: 700 }, 3000, '1000', []);
  assert.strictEqual(near.patch.t, 500); // pushed inside the wall
  assert.ok(U.openingWidthEdit(op, 3000, '300', [op]).error);
  assert.ok(U.openingWidthEdit(op, 3000, '3200', [op]).error);
  const sib = { id: 'o2', t: 1300, width: 800 };
  assert.ok(U.openingWidthEdit(op, 3000, '1200', [op, sib]).error.indexOf('sobreposta') >= 0);
  assert.deepStrictEqual(U.openingWidthEdit(op, 3000, '700', [op]), { noop: true });
});

test('findFreeT prefers the middle and avoids openings', () => {
  assert.strictEqual(U.findFreeT(3000, [], 700), 1500);
  // middle occupied → nearest free gap
  const t = U.findFreeT(4000, [{ t: 2000, width: 1000 }], 700);
  assert.ok(t != null);
  assert.ok(Math.abs(t - 2000) >= 500 + 100 + 350 - 1, 'clear of the existing opening: ' + t);
  assert.ok(t - 350 >= 100 && t + 350 <= 3900, 'inside wall margins: ' + t);
  // no room at all
  assert.strictEqual(U.findFreeT(800, [], 700), null);
  assert.strictEqual(U.findFreeT(2000, [{ t: 1000, width: 1600 }], 700), null);
});

test('findFreeT on a real partition (Térreo cozinha/quarto) with DD.ops.addOpening', () => {
  const doc = DD.data.initialState();
  const w = DD.ops.byId(doc, 'walls', 'w0_cozQuarto');
  const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const t = U.findFreeT(L, doc.openings.filter((o) => o.wall === w.id), 700);
  const res = DD.ops.addOpening(doc, w.id, 'P2', t);
  assert.ok(res.opening);
  assert.strictEqual(res.opening.t, t);
  assert.notStrictEqual(res.doc, doc);
  assert.strictEqual(doc.openings.length + 1, res.doc.openings.length);
});

test('slug / floor tab labels', () => {
  assert.strictEqual(U.slug('Térreo'), 'terreo');
  assert.strictEqual(U.slug('1º Pavimento'), '1-pavimento');
  assert.strictEqual(U.slug('  '), 'pavimento');
  const floors = DD.data.initialState().floors.map(U.floorTabLabel);
  assert.deepStrictEqual(floors, ['Térreo', '1º Pav.', '2º Pav.']);
});

test('formatCursor / zoomPercent / fmtTime / normHex', () => {
  assert.strictEqual(U.formatCursor({ x: 4250, y: 7800 }), 'x 4,25 · y 7,80 m');
  assert.strictEqual(U.formatCursor(null), 'x —  · y —');
  assert.strictEqual(U.zoomPercent(96 / 25.4 / 100), 100);
  assert.strictEqual(U.zoomPercent(0), null);
  assert.strictEqual(U.fmtTime(new Date(2026, 8, 29, 9, 5)), '09:05');
  assert.strictEqual(U.fmtTime('invalid'), '');
  assert.strictEqual(U.normHex('#abc'), '#AABBCC');
  assert.strictEqual(U.normHex('#d9643a'), '#D9643A');
  assert.strictEqual(U.normHex('red'), null);
  assert.strictEqual(U.normHex(null), null);
});

test('isTypingTarget', () => {
  assert.strictEqual(U.isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.strictEqual(U.isTypingTarget({ tagName: 'INPUT', type: 'search' }), true);
  assert.strictEqual(U.isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.strictEqual(U.isTypingTarget({ tagName: 'INPUT', type: 'color' }), false);
  assert.strictEqual(U.isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.strictEqual(U.isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.strictEqual(U.isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.strictEqual(U.isTypingTarget(null), false);
});

const key = (k, mods) => Object.assign({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, mods || {});
test('keyToAction: tools', () => {
  const map = { v: 'select', m: 'measure', w: 'wall', d: 'demolish', f: 'paint', h: 'pan' };
  Object.keys(map).forEach((k) => {
    assert.deepStrictEqual(U.keyToAction(key(k)), { type: 'tool', tool: map[k] });
    assert.deepStrictEqual(U.keyToAction(key(k.toUpperCase())), { type: 'tool', tool: map[k] }, 'caps lock ' + k);
  });
});

test('keyToAction: editing shortcuts', () => {
  assert.deepStrictEqual(U.keyToAction(key('z', { ctrlKey: true })), { type: 'undo' });
  assert.deepStrictEqual(U.keyToAction(key('Z', { ctrlKey: true, shiftKey: true })), { type: 'redo' });
  assert.deepStrictEqual(U.keyToAction(key('z', { metaKey: true, shiftKey: true })), { type: 'redo' });
  assert.deepStrictEqual(U.keyToAction(key('y', { ctrlKey: true })), { type: 'redo' });
  assert.deepStrictEqual(U.keyToAction(key('s', { ctrlKey: true })), { type: 'save' });
  assert.deepStrictEqual(U.keyToAction(key('d', { ctrlKey: true })), { type: 'duplicate' });
  assert.deepStrictEqual(U.keyToAction(key('Delete')), { type: 'delete' });
  assert.deepStrictEqual(U.keyToAction(key('Backspace')), { type: 'delete' });
  assert.deepStrictEqual(U.keyToAction(key('Escape')), { type: 'escape' });
  assert.deepStrictEqual(U.keyToAction(key('r')), { type: 'rotate', delta: 90 });
  assert.deepStrictEqual(U.keyToAction(key('R', { shiftKey: true })), { type: 'rotate', delta: -90 });
  assert.deepStrictEqual(U.keyToAction(key('ArrowLeft')), { type: 'nudge', dx: -10, dy: 0 });
  assert.deepStrictEqual(U.keyToAction(key('ArrowDown', { shiftKey: true })), { type: 'nudge', dx: 0, dy: 100 });
  assert.strictEqual(U.keyToAction(key('c', { ctrlKey: true })), null);
  assert.strictEqual(U.keyToAction(key('z', { ctrlKey: true, altKey: true })), null);
});

test('keyToAction: view shortcuts', () => {
  assert.deepStrictEqual(U.keyToAction(key('1')), { type: 'floor', index: 0 });
  assert.deepStrictEqual(U.keyToAction(key('3')), { type: 'floor', index: 2 });
  assert.deepStrictEqual(U.keyToAction(key('q')), { type: 'view', mode: 'toggle' });
  assert.deepStrictEqual(U.keyToAction(key('Q', { shiftKey: true })), { type: 'view', mode: 'split' });
  assert.deepStrictEqual(U.keyToAction(key('0')), { type: 'fit' });
  assert.strictEqual(U.keyToAction(key('+')).type, 'zoom');
  assert.ok(U.keyToAction(key('-')).factor < 1);
  assert.deepStrictEqual(U.keyToAction(key('g')), { type: 'grid' });
  assert.deepStrictEqual(U.keyToAction(key('?', { shiftKey: true })), { type: 'shortcuts' });
  assert.strictEqual(U.keyToAction(key('x')), null);
  assert.strictEqual(U.keyToAction(key('v', { altKey: true })), null);
});

test('keyToAction: first-person camera owns letters and arrows', () => {
  const ctx = { walkMode: true };
  assert.strictEqual(U.keyToAction(key('w'), ctx), null);
  assert.strictEqual(U.keyToAction(key('d'), ctx), null);
  assert.strictEqual(U.keyToAction(key('ArrowUp'), ctx), null);
  assert.strictEqual(U.keyToAction(key(' '), ctx), null);
  assert.deepStrictEqual(U.keyToAction(key('q'), ctx), { type: 'view', mode: 'toggle' });
  assert.deepStrictEqual(U.keyToAction(key('2'), ctx), { type: 'floor', index: 1 });
  assert.deepStrictEqual(U.keyToAction(key('z', { ctrlKey: true }), ctx), { type: 'undo' });
  assert.deepStrictEqual(U.keyToAction(key('Escape'), ctx), { type: 'escape' });
});

test('nextView', () => {
  assert.strictEqual(U.nextView('2d', 'toggle'), '3d');
  assert.strictEqual(U.nextView('3d', 'toggle'), '2d');
  assert.strictEqual(U.nextView('split', 'toggle'), '3d');
  assert.strictEqual(U.nextView('2d', 'split'), 'split');
  assert.strictEqual(U.nextView('split', 'split'), '2d');
});

test('nudgeDelta', () => {
  assert.deepStrictEqual(U.nudgeDelta('ArrowRight', false), { dx: 10, dy: 0 });
  assert.deepStrictEqual(U.nudgeDelta('ArrowUp', true), { dx: 0, dy: -100 });
  assert.strictEqual(U.nudgeDelta('a', false), null);
});

if (failures.length) {
  console.error(`test-ui: ${failures.length} falha(s), ${passed} ok\n  - ` + failures.join('\n  - '));
  process.exit(1);
}
console.log(`test-ui: ${passed} testes ok`);
