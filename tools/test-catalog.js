// tools/test-catalog.js — DD.catalog types, draw2d robustness and thumbnail caching (Node, mock canvas).
// Run: node tools/test-catalog.js   (exit code 1 on failure)
'use strict';
global.window = global;
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
require('../src/00-data.js');
require('../src/01-core.js');
require('../src/11-catalog.js');

const DD = global.DD;
const cat = DD.catalog;
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// ------------------------------------------------------------------ mock 2D context
/** Records calls; flags non-finite numeric arguments and unbalanced save/restore. */
function mockContext() {
  const log = { calls: 0, bad: [], depth: 0, maxDepth: 0, alphaSeen: [], strokes: 0, fills: 0 };
  let alpha = 1;
  const stack = [];
  const numeric = (name) =>
    function () {
      log.calls++;
      for (let i = 0; i < arguments.length; i++) {
        const a = arguments[i];
        if (typeof a === 'number' && !isFinite(a)) log.bad.push(name + '#' + i + '=' + a);
      }
    };
  const ctx = {
    log,
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(v) {
      if (!isFinite(v)) log.bad.push('globalAlpha=' + v);
      alpha = v;
      log.alphaSeen.push(v);
    },
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: 'start', textBaseline: 'alphabetic',
    save() {
      stack.push(alpha);
      log.depth++;
      log.maxDepth = Math.max(log.maxDepth, log.depth);
    },
    restore() {
      if (stack.length) alpha = stack.pop();
      log.depth--;
    },
    fill() {
      log.fills++;
    },
    stroke() {
      log.strokes++;
      if (!(this.lineWidth > 0) || !isFinite(this.lineWidth)) log.bad.push('lineWidth=' + this.lineWidth);
    },
    setLineDash(arr) {
      if (!Array.isArray(arr) || arr.some((v) => !isFinite(v))) log.bad.push('dash=' + arr);
    },
    measureText: (s) => ({ width: String(s).length * 10 }),
  };
  ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'quadraticCurveTo', 'bezierCurveTo',
    'translate', 'rotate', 'scale', 'setTransform', 'fillText', 'strokeText', 'clearRect', 'fillRect'].forEach((n) => {
    ctx[n] = numeric(n);
  });
  return ctx;
}

// ------------------------------------------------------------------ types & categories
const catIds = new Set(cat.categories.map((c) => c.id));
check(cat.categories.length === 7, 'expected 7 categories');
const typeIds = Object.keys(cat.types);
check(typeIds.length === 45, 'expected 45 types, got ' + typeIds.length);
typeIds.forEach((id) => {
  const t = cat.types[id];
  check(typeof t.name === 'string' && t.name.length > 1, id + ': name');
  check(catIds.has(t.category), id + ': category ' + t.category);
  check(t.w > 0 && t.d > 0 && t.h > 0, id + ': size');
  check(/^#[0-9A-F]{6}$/i.test(t.color), id + ': colour');
  check(typeof t.elev === 'number', id + ': elev');
});
['kitchenSink', 'toilet', 'basin', 'shower', 'bathtub'].forEach((id) => check(cat.types[id].fixture === true, id + ' fixture'));
check(cat.types.rug.flat === true, 'rug flat');
check(cat.types.upperCabinet.elev === 1500, 'upperCabinet elev');
check(Object.isFrozen(cat.types) && Object.isFrozen(cat.types.sofa3), 'types must be frozen');

// ------------------------------------------------------------------ draw2d on every type and odd sizes
const SIZES = [null, [300, 300], [4000, 250], [250, 4000], [60, 60], [3000, 3000]];
typeIds.forEach((id) => {
  const t = cat.types[id];
  SIZES.forEach((sz) => {
    [{ px: 10 }, { px: 0.5, ghost: true, hovered: true }, { px: 25, selected: true, color: '#123456' }].forEach((o) => {
      const ctx = mockContext();
      const item = { id: 'x', type: id, w: sz ? sz[0] : t.w, d: sz ? sz[1] : t.d, h: t.h, color: null };
      try {
        cat.draw2d(ctx, item, o);
      } catch (e) {
        failures.push(`${id} ${sz || 'default'} threw: ${e.message}`);
        return;
      }
      const tag = `${id} ${sz ? sz.join('x') : 'default'} px=${o.px}`;
      check(ctx.log.bad.length === 0, tag + ' non-finite args: ' + ctx.log.bad.slice(0, 3).join(', '));
      check(ctx.log.depth === 0, tag + ' unbalanced save/restore');
      check(ctx.log.strokes > 0 && ctx.log.fills > 0, tag + ' drew nothing');
      if (o.ghost) check(ctx.log.alphaSeen.some((a) => Math.abs(a - 0.4) < 1e-9), tag + ' ghost alpha 0.4 not applied');
    });
  });
});

// unknown type, broken inputs and a throwing canvas never throw
[
  { type: 'naoExiste', w: 800, d: 600 },
  { type: 'naoExiste' },
  { type: 'sofa3', w: NaN, d: -5 },
  { type: 'sofa3', w: 2000, d: 900, color: 'not-a-colour' },
  { type: undefined },
].forEach((item, i) => {
  const ctx = mockContext();
  try {
    cat.draw2d(ctx, item, { px: 5 });
    check(ctx.log.bad.length === 0, 'robustness case ' + i + ' produced non-finite args');
    check(ctx.log.depth === 0, 'robustness case ' + i + ' unbalanced');
  } catch (e) {
    failures.push('robustness case ' + i + ' threw: ' + e.message);
  }
});
try {
  cat.draw2d(null, { type: 'sofa3' }, {});
  cat.draw2d(mockContext(), null, {});
  const hostile = mockContext();
  let n = 0;
  hostile.arcTo = () => {
    if (++n === 3) throw new Error('canvas lost');
  };
  const warn = console.warn;
  console.warn = () => {};
  cat.draw2d(hostile, { type: 'sofa3', w: 2100, d: 900 }, { px: 3 });
  console.warn = warn;
  check(hostile.log.depth === 0, 'hostile canvas left unbalanced save/restore');
} catch (e) {
  failures.push('draw2d threw on hostile input: ' + e.message);
}

// ------------------------------------------------------------------ thumbnail
check(cat.thumbnail('sofa3', 72) === '', 'thumbnail must return "" without document');
let created = 0;
global.document = {
  createElement(tag) {
    created++;
    const ctx = mockContext();
    return { tagName: tag, width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,MOCK' + created };
  },
};
const a = cat.thumbnail('car', 72);
const b = cat.thumbnail('car', 72);
const c = cat.thumbnail('car', 48);
check(a.startsWith('data:image/png'), 'thumbnail dataURL');
check(a === b && created === 2, 'thumbnail must be cached per (type, size)');
check(c !== a, 'thumbnail cache keyed by size');
check(cat.thumbnail('naoExiste').startsWith('data:image/png'), 'thumbnail of unknown type falls back');
delete global.document;

if (failures.length) {
  console.error(`catalog: ${failures.length} failure(s)\n  ` + failures.slice(0, 40).join('\n  '));
  process.exit(1);
}
console.log(`catalog OK — ${typeIds.length} types × ${SIZES.length} sizes × 3 modes drawn cleanly; thumbnails cached`);
