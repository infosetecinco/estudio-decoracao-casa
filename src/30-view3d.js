// ===== 30-view3d.js — three.js 3D view: house model, orbit & walk cameras, 2D↔3D transitions, picking/drag =====
// Lazy-loads three r170 through the import map (dynamic import from a classic script).
// World mapping (CONTRACT §1): X = x/1000, Z = y/1000, Y = up (metres). Plan rotation θ ↔ rotation.y = −θ.
// The document is never mutated: edits go through DD.ops + store.beginGesture/preview/endGesture.
(function () {
  'use strict';
  const DD = (window.DD = window.DD || {});

  // ------------------------------------------------------------------ constants
  const MM = 0.001;
  const DEG = Math.PI / 180;
  const COLORS = {
    wall: '#EFEBE3',
    capStructural: '#2E2A26',
    capPartition: '#A99F8E', // + 45° hatch (2D: #CFC6B7 fill, #8C8375 hatch)
    capHatch: '#6F675A',
    coping: '#D9D2C6', // exposed tops that are not "cut": parapet, railing base
    muro: '#E7D3C0',
    muroCap: '#CFB9A2',
    sillStone: '#E2DCD1',
    wood: '#8A5A2E',
    glass: '#CFE6F2',
    metal: '#1C1C1D',
    aluminium: '#46484B',
    slab: '#E7E2D8',
    ceiling: '#F1EEE8',
    stairStone: '#DCD5C8',
    stairBody: '#C9C1B3',
    roof: '#CDC7BC',
    coral: '#D9643A',
    sky: '#7FB0E0',
    horizon: '#DCE3E4', // also the fog colour: the ground dissolves into it before the world edge
    asphalt: '#3A3B3D',
    curb: '#BEB8AE',
    neighbour: '#CFCBC4', // context massing: cool pale clay, distinct from the warm-white house
    neighbourRoof: '#B4ADA3',
    trunk: '#6B4F37',
    leaves: '#5E8A3A',
  };
  const WALK = {
    eye: 1600, // mm above the feet
    radius: 250, // mm
    speed: 1400, // mm/s
    run: 2800, // mm/s
    stepUp: 350, // climb a surface at most this far above the feet
    headClear: 1800, // a surface / the underside of a stair part this far above the feet is overhead (walk under it)
    bodyTop: 1700, // body collision range: [feet + stepUp, feet + bodyTop]
    gravity: 9800, // mm/s²
    floorSnap: 60, // feet within this of a level → on that floor
    maxSubstep: 40, // mm per collision substep
  };
  // Spawn points per floor (plan mm) and the direction the walker faces (always towards open space).
  const SPAWNS = {
    f0: { x: 5500, y: 13900, dir: { x: 0, y: -1 } }, // Sala, inside the entrance, looking at the hall and stair
    f1: { x: 5850, y: 9250, dir: { x: -1, y: 0 } }, // top of the stair, looking along the Circulação
    f2: { x: 4400, y: 9950, dir: { x: 0, y: -1 } }, // arrival of the stair, looking across the área gourmet
  };
  const SLAB = 100; // mm, upper-floor slab under the finished floor
  const BASE_SLAB = 40; // mm, ground-floor base under the finished floor
  const ROOF_T = 120; // mm
  const PARAPET_H = 1000; // mm above the roof slab (platibanda, corte transversal)
  const RAILING_MURETA = 300; // mm, default solid base of a railing (wall.mureta overrides)
  // Stair build-up (mm): stone tread + concrete tread body, inclined flight slab.
  const STAIR_DROP = 150;
  const STAIR_SLAB_MM = 120;
  const WALL_CENTRE_OFFSET = 75; // mm, room outline → wall centre line (150 mm walls)
  const FOV_ORBIT = 45;
  const FOV_WALK = 68;
  const FLOOR_ANIM_MS = 320;
  const FLOOR_ANIM_LIFT = 1.6; // m — hidden floors slide up while fading out of view
  const CLICK_SLOP = 5; // px
  const DRAG_LABEL = 'Mover móvel (3D)';
  const MSG_LOAD_FAIL = 'Não foi possível carregar o 3D (sem internet?) — a planta 2D continua funcionando.';
  const MSG_WEBGL_FAIL = 'Não foi possível iniciar o 3D neste navegador (WebGL indisponível) — a planta 2D continua funcionando.';
  const MSG_WALK_PROMPT = 'Clique para caminhar · WASD/setas mover · Shift correr · Esc sair';

  // ================================================================== pure helpers (no three.js, no DOM)
  const P = {};

  P.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  P.easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  P.lerp = (a, b, t) => a + (b - a) * t;

  /** Camera height (m) above a plane so that the visible world height equals `visibleMM` (vertical fov). */
  P.topDownHeight = (visibleMM, fovDeg) => (visibleMM * MM) / (2 * Math.tan((fovDeg * DEG) / 2));

  /** Top-down pose matching a 2D viewport {cx, cy, scale, height}; screen-up = drawing-up (camera.up = −Z). */
  P.topDownPose = (vp, levelMM, fovDeg) => {
    if (!vp || !isFinite(vp.cx) || !isFinite(vp.cy) || !(vp.scale > 0) || !(vp.height > 0)) return null;
    const h = P.topDownHeight(vp.height / vp.scale, fovDeg);
    const x = vp.cx * MM, z = vp.cy * MM, y0 = (levelMM || 0) * MM;
    return { pos: { x, y: y0 + h, z }, target: { x, y: y0, z }, up: { x: 0, y: 0, z: -1 } };
  };

  /** Yaw (rotation.y, YXZ order) that makes a three camera look along plan direction (dx, dy). */
  P.yawFromDir = (dx, dy) => Math.atan2(-dx, -dy);
  P.dirFromYaw = (yaw) => ({ x: -Math.sin(yaw), y: -Math.cos(yaw) });

  /** Extents (mm) of the built part of a floor: structural + partition walls, falling back to all walls / the lot. */
  P.floorBounds = (doc, floorId) => {
    const dim = DD.geom && DD.geom.dimensionData ? DD.geom.dimensionData(doc, floorId) : null;
    if (dim && isFinite(dim.bbox.minX)) return dim.bbox;
    const lot = (doc.site && doc.site.lot) || { w: 9000, h: 20000 };
    return { minX: 0, minY: 0, maxX: lot.w, maxY: lot.h };
  };

  /**
   * 3D box (mm) of what the aerial view shows: every built wall (structural, partition, railing — not the boundary
   * muros, which wrap the whole lot) of the floors up to the active one (or all floors + the roof parapet), from
   * the ground to the top of the highest of those walls.
   */
  P.houseBox = (doc, floorId, allFloors) => {
    const idx = Math.max(0, doc.floors.findIndex((f) => f.id === floorId));
    const last = allFloors ? doc.floors.length - 1 : idx;
    const lv = floorLevels(doc);
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, z0: 0, z1: 0 };
    doc.walls.forEach((w) => {
      const f = lv.get(w.floor);
      if (!f || f.index > last || w.kind === 'muro') return;
      const ht = (w.thick || 0) / 2;
      b.minX = Math.min(b.minX, w.a.x - ht, w.b.x - ht);
      b.maxX = Math.max(b.maxX, w.a.x + ht, w.b.x + ht);
      b.minY = Math.min(b.minY, w.a.y - ht, w.b.y - ht);
      b.maxY = Math.max(b.maxY, w.a.y + ht, w.b.y + ht);
      b.z1 = Math.max(b.z1, f.level + (w.height || 0));
    });
    if (!isFinite(b.minX)) {
      const fb = P.floorBounds(doc, floorId);
      const f = doc.floors[idx] || { level: 0, height: 2880 };
      return { minX: fb.minX, minY: fb.minY, maxX: fb.maxX, maxY: fb.maxY, z0: 0, z1: f.level + f.height };
    }
    if (allFloors && last === doc.floors.length - 1) {
      const top = doc.floors[last];
      b.z1 = Math.max(b.z1, top.level + top.height + ROOF_T + PARAPET_H);
    }
    return b;
  };

  const AERIAL = { polar: 57 * DEG, azim: 33 * DEG, fill: 0.8, minDist: 8, maxDist: 90 };
  /**
   * Pleasant aerial 3/4 view from the street side (+y) that fits the house box of the active floor to a viewport of
   * the given aspect (both fovs): the house fills `AERIAL.fill` of the limiting dimension and is centred on screen.
   * opts: { aspect = 1.5, fov = FOV_ORBIT, allFloors = false }. Metres.
   */
  P.aerialPose = (doc, floorId, opts) => {
    const o = opts || {};
    const aspect = o.aspect > 0 ? o.aspect : 1.5;
    const tanV = Math.tan(((o.fov || FOV_ORBIT) * DEG) / 2), tanH = tanV * aspect;
    const box = P.houseBox(doc, floorId, !!o.allFloors);
    const v = { x: Math.sin(AERIAL.polar) * Math.sin(AERIAL.azim), y: Math.cos(AERIAL.polar), z: Math.sin(AERIAL.polar) * Math.cos(AERIAL.azim) };
    const f = { x: -v.x, y: -v.y, z: -v.z }; // forward
    const rl = Math.hypot(f.z, f.x);
    const r = { x: -f.z / rl, y: 0, z: f.x / rl }; // right = forward × up
    const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const corners = [];
    [box.minX, box.maxX].forEach((x) => [box.minY, box.maxY].forEach((y) => [box.z0, box.z1].forEach((z) => corners.push({ x: x * MM, y: z * MM, z: y * MM }))));
    let t = { x: ((box.minX + box.maxX) / 2) * MM, y: ((box.z0 + box.z1) / 2) * MM, z: ((box.minY + box.maxY) / 2) * MM };
    let dist = 20;
    for (let it = 0; it < 6; it++) {
      const rel = corners.map((c) => {
        const q = { x: c.x - t.x, y: c.y - t.y, z: c.z - t.z };
        return { a: dot(q, r), b: dot(q, u), c: dot(q, f) };
      });
      dist = rel.reduce((d, q) => Math.max(d, Math.abs(q.a) / (AERIAL.fill * tanH) - q.c, Math.abs(q.b) / (AERIAL.fill * tanV) - q.c), 1);
      const nx = rel.map((q) => q.a / ((dist + q.c) * tanH)), ny = rel.map((q) => q.b / ((dist + q.c) * tanV));
      const mx = (Math.min.apply(null, nx) + Math.max.apply(null, nx)) / 2;
      const my = (Math.min.apply(null, ny) + Math.max.apply(null, ny)) / 2;
      if (Math.abs(mx) < 1e-4 && Math.abs(my) < 1e-4) break;
      const sx = mx * tanH * dist, sy = my * tanV * dist; // re-centre the projected box
      t = { x: t.x + r.x * sx + u.x * sy, y: t.y + r.y * sx + u.y * sy, z: t.z + r.z * sx + u.z * sy };
    }
    dist = P.clamp(dist, AERIAL.minDist, AERIAL.maxDist);
    const pos = { x: t.x + dist * v.x, y: t.y + dist * v.y, z: t.z + dist * v.z };
    return { pos, target: t, up: { x: 0, y: 1, z: 0 } };
  };
  /** NDC extents {minX,maxX,minY,maxY} of the house box seen from a pose (for tests / diagnostics). */
  P.boxNdc = (box, pose, aspect, fovDeg) => {
    const tanV = Math.tan(((fovDeg || FOV_ORBIT) * DEG) / 2), tanH = tanV * aspect;
    const f0 = { x: pose.target.x - pose.pos.x, y: pose.target.y - pose.pos.y, z: pose.target.z - pose.pos.z };
    const fl = Math.hypot(f0.x, f0.y, f0.z);
    const f = { x: f0.x / fl, y: f0.y / fl, z: f0.z / fl };
    const rl = Math.hypot(f.z, f.x);
    const r = { x: -f.z / rl, y: 0, z: f.x / rl };
    const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
    const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    [box.minX, box.maxX].forEach((x) =>
      [box.minY, box.maxY].forEach((y) =>
        [box.z0, box.z1].forEach((z) => {
          const q = { x: x * MM - pose.pos.x, y: z * MM - pose.pos.y, z: y * MM - pose.pos.z };
          const d = q.x * f.x + q.y * f.y + q.z * f.z;
          const nx = (q.x * r.x + q.y * r.y + q.z * r.z) / (d * tanH), ny = (q.x * u.x + q.y * u.y + q.z * u.z) / (d * tanV);
          out.minX = Math.min(out.minX, nx);
          out.maxX = Math.max(out.maxX, nx);
          out.minY = Math.min(out.minY, ny);
          out.maxY = Math.max(out.maxY, ny);
        })
      )
    );
    return out;
  };

  // ------------------------------------------------------------------ interval & rectilinear polygon helpers
  /** x positions where the horizontal line y = ym crosses the edges of a closed loop. */
  function crossings(loop, ym) {
    const xs = [];
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[j], b = loop[i];
      if (a.y > ym !== b.y > ym) xs.push(a.x + ((ym - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    return xs;
  }
  /** Even–odd interior intervals of one polygon (outer + holes) on the line y = ym. */
  function polyIntervals(poly, ym) {
    let xs = crossings(poly.outer, ym);
    (poly.holes || []).forEach((h) => (xs = xs.concat(crossings(h, ym))));
    xs.sort((a, b) => a - b);
    const out = [];
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > 1e-6) out.push([xs[k], xs[k + 1]]);
    return out;
  }
  P.unionIntervals = (list) => {
    const s = list.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    s.forEach((iv) => {
      const last = out[out.length - 1];
      if (last && iv[0] <= last[1] + 1e-6) out[out.length - 1] = [last[0], Math.max(last[1], iv[1])];
      else out.push([iv[0], iv[1]]);
    });
    return out;
  };
  P.subtractIntervals = (list, cuts) =>
    cuts.reduce(
      (acc, c) =>
        acc.flatMap((iv) => {
          if (c[1] <= iv[0] || c[0] >= iv[1]) return [iv];
          const parts = [];
          if (c[0] > iv[0] + 1e-6) parts.push([iv[0], c[0]]);
          if (c[1] < iv[1] - 1e-6) parts.push([c[1], iv[1]]);
          return parts;
        }),
      list
    );

  /**
   * Decompose the union of polygons (each {outer, holes}) minus axis-aligned `cuts` into rectangles, by horizontal
   * strips. Exact for rectilinear outlines (rooms are traced on a grid). Returns [{x0,y0,x1,y1}] (mm).
   */
  P.polysToRects = (polys, cuts) => {
    const valid = polys.filter((p) => p && p.outer && p.outer.length >= 3);
    const ys = new Set();
    valid.forEach((p) => [p.outer].concat(p.holes || []).forEach((l) => l.forEach((v) => ys.add(v.y))));
    (cuts || []).forEach((c) => {
      ys.add(c.y0);
      ys.add(c.y1);
    });
    const sorted = Array.from(ys).sort((a, b) => a - b);
    const strips = [];
    for (let k = 0; k + 1 < sorted.length; k++) {
      const y0 = sorted[k], y1 = sorted[k + 1];
      if (y1 - y0 < 1e-6) continue;
      const ym = (y0 + y1) / 2;
      let ivs = P.unionIntervals(valid.flatMap((p) => polyIntervals(p, ym)));
      const cutIvs = (cuts || []).filter((c) => c.y0 < ym && c.y1 > ym).map((c) => [c.x0, c.x1]);
      ivs = P.subtractIntervals(ivs, cutIvs);
      ivs.forEach((iv) => strips.push({ x0: iv[0], y0, x1: iv[1], y1 }));
    }
    return mergeStrips(strips);
  };
  /** Merge vertically adjacent rectangles with identical x extents (fewer triangles). */
  function mergeStrips(rects) {
    const open = new Map();
    const out = [];
    rects.forEach((r) => {
      const key = r.x0.toFixed(3) + '|' + r.x1.toFixed(3);
      const prev = open.get(key);
      if (prev && Math.abs(prev.y1 - r.y0) < 1e-6) prev.y1 = r.y1; // prev is a local, freshly created rect
      else {
        const nr = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 };
        open.set(key, nr);
        out.push(nr);
      }
    });
    return out;
  }

  /** Offset a closed rectilinear loop outwards by `delta` mm (loop orientation is detected). */
  P.offsetLoop = (loop, delta) => {
    const n = loop.length;
    if (n < 3) return loop.slice();
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += loop[j].x * loop[i].y - loop[i].x * loop[j].y;
    const cw = area > 0; // clockwise on screen (y down)
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
      const n1 = outwardNormal(a, b, cw), n2 = outwardNormal(b, c, cw);
      const p1 = { x: a.x + n1.x * delta, y: a.y + n1.y * delta }, p2 = { x: b.x + n1.x * delta, y: b.y + n1.y * delta };
      const q1 = { x: b.x + n2.x * delta, y: b.y + n2.y * delta }, q2 = { x: c.x + n2.x * delta, y: c.y + n2.y * delta };
      out.push(lineHit(p1, p2, q1, q2) || { x: b.x + (n1.x + n2.x) * delta * 0.5, y: b.y + (n1.y + n2.y) * delta * 0.5 });
    }
    return out;
  };
  function outwardNormal(a, b, cw) {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
    // left normal (−dy, dx) points inside a clockwise (screen) loop
    return cw ? { x: dy, y: -dx } : { x: -dy, y: dx };
  }
  function lineHit(p1, p2, p3, p4) {
    const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (Math.abs(d) < 1e-9) return null;
    const a = p1.x * p2.y - p1.y * p2.x, b = p3.x * p4.y - p3.y * p4.x;
    return { x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d, y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d };
  }

  /**
   * Boundary of a union of axis-aligned rectangles as axis-aligned segments with the outward normal:
   * [{a:{x,y}, b:{x,y}, n:{x,y}}]. Used for roof parapets.
   */
  P.rectsOutline = (rects) => {
    const segs = [];
    outlineAxis(rects, 'y', segs);
    outlineAxis(rects, 'x', segs);
    return segs;
  };
  function outlineAxis(rects, axis, segs) {
    const o = axis === 'y' ? 'x' : 'y'; // the axis the segments run along
    const lines = new Set();
    rects.forEach((r) => {
      lines.add(r[axis + '0']);
      lines.add(r[axis + '1']);
    });
    lines.forEach((v) => {
      const before = P.unionIntervals(rects.filter((r) => r[axis + '0'] < v - 1e-6 && r[axis + '1'] >= v - 1e-6).map((r) => [r[o + '0'], r[o + '1']]));
      const after = P.unionIntervals(rects.filter((r) => r[axis + '0'] <= v + 1e-6 && r[axis + '1'] > v + 1e-6).map((r) => [r[o + '0'], r[o + '1']]));
      const push = (ivs, sign) =>
        ivs.forEach((iv) => {
          const a = axis === 'y' ? { x: iv[0], y: v } : { x: v, y: iv[0] };
          const b = axis === 'y' ? { x: iv[1], y: v } : { x: v, y: iv[1] };
          const n = axis === 'y' ? { x: 0, y: sign } : { x: sign, y: 0 };
          segs.push({ a, b, n });
        });
      push(P.subtractIntervals(before, after), 1); // covered before the line only → outside is +axis
      push(P.subtractIntervals(after, before), -1);
    });
  }

  // ------------------------------------------------------------------ openings that run past the wall top
  const isBodyWall = (w) => w.kind === 'structural' || w.kind === 'partition';
  const contCache = { walls: null, openings: null, floors: null, list: [] };
  /**
   * Openings taller than their wall (e.g. the stair windows J5 1,20×1,60 at sill 2,20 in a 2,88 m wall) continue
   * into the collinear wall of the floor above — as in the cortes, where they span the double-height stairwell.
   * → [{ opId, lowerWall, lowerFloor, upperWall, floor, t, width, height, cut:{x0,y0,x1,y1} }] (mm; t/width on the
   * upper wall, height = part above the upper floor level, cut = plan band of the lower wall to clear in the slab).
   * Cached per document identity.
   */
  P.windowContinuations = (doc) => {
    if (contCache.walls === doc.walls && contCache.openings === doc.openings && contCache.floors === doc.floors) return contCache.list;
    const lv = floorLevels(doc);
    const byId = new Map(doc.walls.map((w) => [w.id, w]));
    const list = [];
    doc.openings.forEach((op) => {
      const w = byId.get(op.wall);
      const fl = w && lv.get(w.floor);
      if (!fl || !isBodyWall(w) || fl.index + 1 >= doc.floors.length) return;
      const top = (op.sill || 0) + op.height;
      if (top <= w.height + 60) return;
      const fu = doc.floors[fl.index + 1];
      const over = fl.level + top - fu.level;
      if (over < 60) return;
      const fr = DD.geom.openingFrame(w, op);
      doc.walls.some((u) => {
        if (u.floor !== fu.id || !isBodyWall(u)) return false;
        const { d, L } = DD.geom.wallDir(u);
        if (L < 1 || Math.abs(d.x * fr.d.y - d.y * fr.d.x) > 1e-3) return false; // parallel
        const off = Math.abs((fr.c.x - u.a.x) * -d.y + (fr.c.y - u.a.y) * d.x);
        if (off > Math.max(u.thick, w.thick) / 2 + 1) return false; // collinear (within the thickness)
        const ta = (fr.start.x - u.a.x) * d.x + (fr.start.y - u.a.y) * d.y, tb = (fr.end.x - u.a.x) * d.x + (fr.end.y - u.a.y) * d.y;
        const lo = P.clamp(Math.min(ta, tb), 0, L), hi = P.clamp(Math.max(ta, tb), 0, L);
        if (hi - lo < 60) return false;
        // slab band to clear: the wall thickness, 25 mm wider than the opening on each side so the slab's end
        // faces sit inside the solid wall instead of coinciding with the window reveal (z-fighting)
        const ht = w.thick / 2, n = fr.n, dd = fr.d, e = 25;
        const sa = { x: fr.start.x - dd.x * e, y: fr.start.y - dd.y * e }, sb = { x: fr.end.x + dd.x * e, y: fr.end.y + dd.y * e };
        const xs = [sa.x + n.x * ht, sa.x - n.x * ht, sb.x + n.x * ht, sb.x - n.x * ht];
        const ys = [sa.y + n.y * ht, sa.y - n.y * ht, sb.y + n.y * ht, sb.y - n.y * ht];
        list.push({
          opId: op.id, code: op.code, lowerWall: w.id, lowerFloor: w.floor, upperWall: u.id, floor: u.floor,
          t: (lo + hi) / 2, width: hi - lo, height: Math.min(over, u.height),
          cut: { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) },
        });
        return true;
      });
    });
    Object.assign(contCache, { walls: doc.walls, openings: doc.openings, floors: doc.floors, list });
    return list;
  };

  // ------------------------------------------------------------------ walk: colliders, surfaces, stepping
  function isFlatType(type) {
    const t = DD.catalog && DD.catalog.types && DD.catalog.types[type];
    return !!(t && t.flat);
  }
  function floorLevels(doc) {
    const m = new Map();
    doc.floors.forEach((f, i) => m.set(f.id, { level: f.level, height: f.height, index: i }));
    return m;
  }

  /**
   * Solid obstacles for the walker as oriented plan boxes with an absolute vertical range (mm):
   * {cx, cy, ux, uy, hl, ht, z0, z1}. Walls are split around openings (doors pass; sills and closed gates block);
   * furniture uses its footprint unless it is flat (rugs).
   */
  P.collectColliders = (doc) => {
    const lv = floorLevels(doc);
    const out = [];
    doc.walls.forEach((w) => {
      const f = lv.get(w.floor);
      if (!f) return;
      const { d, L } = DD.geom.wallDir(w);
      const ops = DD.geom.openingsOfWall(doc, w.id);
      const box = (t0, t1, z0, z1) => {
        const tm = (t0 + t1) / 2;
        out.push({ cx: w.a.x + d.x * tm, cy: w.a.y + d.y * tm, ux: d.x, uy: d.y, hl: (t1 - t0) / 2, ht: w.thick / 2, z0: f.level + z0, z1: f.level + z1 });
      };
      if (w.kind === 'railing') {
        box(0, L, 0, w.height);
        return;
      }
      DD.geom.wallPieces(w, ops).forEach((p) => box(p.t0, p.t1, p.z0, p.z1));
      ops.forEach((o) => {
        if (o.style !== 'gate' && o.style !== 'gateSlide') return;
        box(P.clamp(o.t - o.width / 2, 0, L), P.clamp(o.t + o.width / 2, 0, L), 0, Math.min(w.height, o.height));
      });
    });
    doc.furniture.forEach((it) => {
      const f = lv.get(it.floor);
      if (!f || isFlatType(it.type)) return;
      const r = it.rot * DEG;
      const z0 = f.level + (it.elev || 0);
      out.push({ cx: it.x, cy: it.y, ux: Math.cos(r), uy: Math.sin(r), hl: it.w / 2, ht: it.d / 2, z0, z1: z0 + (it.h || 0) });
    });
    return out;
  };

  /** Colliders that intersect the walker's body when the feet are at `feet` (mm). */
  P.bodyColliders = (colliders, feet) => colliders.filter((c) => c.z1 > feet + WALK.stepUp && c.z0 < feet + WALK.bodyTop);

  /** Penetration of a circle into an oriented box → push vector {x,y} or null. */
  P.circleBoxPush = (px, py, r, b) => {
    const dx = px - b.cx, dy = py - b.cy;
    const lx = dx * b.ux + dy * b.uy, ly = -dx * b.uy + dy * b.ux;
    if (Math.abs(lx) > b.hl + r || Math.abs(ly) > b.ht + r) return null;
    const qx = P.clamp(lx, -b.hl, b.hl), qy = P.clamp(ly, -b.ht, b.ht);
    let mx = 0, my = 0;
    if (qx === lx && qy === ly) {
      // centre inside the box: leave through the nearest side
      const penX = b.hl - Math.abs(lx) + r, penY = b.ht - Math.abs(ly) + r;
      if (penX < penY) mx = Math.sign(lx || 1) * penX;
      else my = Math.sign(ly || 1) * penY;
    } else {
      const ex = lx - qx, ey = ly - qy, dist = Math.hypot(ex, ey);
      if (dist >= r) return null;
      mx = (ex / dist) * (r - dist);
      my = (ey / dist) * (r - dist);
    }
    return { x: mx * b.ux - my * b.uy, y: mx * b.uy + my * b.ux };
  };

  /** Push a circle out of all boxes (a few relaxation passes). → {x, y, hit} */
  P.resolveCircle = (x, y, r, boxes) => {
    let hit = false;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let k = 0; k < boxes.length; k++) {
        const push = P.circleBoxPush(x, y, r, boxes[k]);
        if (push) {
          x += push.x;
          y += push.y;
          moved = hit = true;
        }
      }
      if (!moved) break;
    }
    return { x, y, hit };
  };
  P.overlapsAny = (x, y, r, boxes) => boxes.some((b) => P.circleBoxPush(x, y, r - 1, b));

  /**
   * Walkable surfaces of a document: slabs of upper floors (rooms offset to the wall centre line) minus stair
   * holes, plus stairs. The ground (0) is everywhere.
   */
  P.surfaceContext = (doc) => {
    const lv = floorLevels(doc);
    const floors = doc.floors.map((f, i) => {
      if (i === 0) return { id: f.id, level: f.level, slabs: null, holes: [] };
      const rooms = DD.rooms.compute(doc, f.id).filter((r) => !r.open && r.outer);
      const holes = DD.geom.stairHoles(doc, f.id);
      const slabs = P.polysToRects(rooms.map((r) => ({ outer: P.offsetLoop(r.outer, WALL_CENTRE_OFFSET), holes: [] })), holes);
      return { id: f.id, level: f.level, slabs, holes };
    });
    const stairs = doc.stairs
      .filter((s) => lv.has(s.floor))
      .map((s) => ({ st: s, level: lv.get(s.floor).level, height: lv.get(s.floor).height }));
    return { floors, stairs };
  };
  const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

  /** Absolute heights (mm) of every walkable surface at plan point (x, y). */
  P.surfacesAt = (ctx, x, y) => {
    const out = [0];
    ctx.floors.forEach((f) => {
      if (!f.slabs) return;
      if (f.slabs.some((r) => inRect(r, x, y)) && !f.holes.some((r) => inRect(r, x, y))) out.push(f.level);
    });
    ctx.stairs.forEach((s) => {
      const h = DD.geom.stairHeightAt(s.st, s.height, x, y);
      if (h != null && h > 0) out.push(s.level + h);
    });
    return out;
  };

  /**
   * Inclined flight slabs of a U-stair (mm, relative to the stair's floor level), shared by the 3D model and the
   * walker. Each: {x0, x1 (plan x range), y0, y1 (row), top(x) (slab top line), thick (vertical thickness)}.
   * Lower slab: top line through the back-bottom corners of the lower treads, from the ground to the landing's
   * underside. Upper slab: through the back-bottom corners of the upper treads, from the landing to the stair start.
   */
  P.stairSlabs = (st, g) => {
    const T = st.tread, hw = st.width / 2;
    const k = g.riser / T;
    const land = g.landing[0];
    const landX = land.x0, landZ = land.z;
    const end = st.x + st.length;
    const thick = STAIR_SLAB_MM * Math.sqrt(1 + k * k);
    const lowerTop = (xx) => (xx - st.x) * k - STAIR_DROP;
    const upperTop = (xx) => (landX - xx) * k + landZ - STAIR_DROP;
    return [
      { flight: 0, x0: st.x + STAIR_DROP / k, x1: Math.min(end, st.x + landZ / k), y0: st.y + hw, y1: st.y + st.width, top: lowerTop, thick },
      { flight: 1, x0: st.x, x1: landX, y0: st.y, y1: st.y + hw, top: upperTop, thick },
    ];
  };
  /** Undersides (mm above the stair's floor) of every stair part above plan point (x, y): treads, landing, slabs. */
  P.stairUndersidesAt = (st, floorHeight, x, y) => {
    const f = { x0: st.x, y0: st.y, x1: st.x + st.length, y1: st.y + st.width };
    if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) return [];
    const g = DD.geom.stairGeometry(st, floorHeight);
    const out = [];
    g.treads.concat(g.landing).forEach((t) => {
      if (x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) out.push(t.z - STAIR_DROP);
    });
    P.stairSlabs(st, g).forEach((s) => {
      if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) out.push(s.top(x) - s.thick);
    });
    return out;
  };
  /** Absolute undersides (mm) of the stair structure above plan point (x, y). */
  P.ceilingsAt = (ctx, x, y) => {
    const out = [];
    ctx.stairs.forEach((s) => P.stairUndersidesAt(s.st, s.height, x, y).forEach((c) => out.push(s.level + c)));
    return out;
  };

  /**
   * Step-up rule: highest surface within reach; anything between reach and head height blocks. `ceilings` (optional,
   * absolute mm): undersides of overhead structure — the head (plus a margin, WALK.headClear) must pass below them.
   */
  P.chooseSurface = (surfaces, feet, ceilings) => {
    let z = -Infinity, blocked = false;
    surfaces.forEach((s) => {
      if (s <= feet + WALK.stepUp) z = Math.max(z, s);
      else if (s < feet + WALK.headClear) blocked = true;
    });
    const zz = isFinite(z) ? z : 0;
    if (ceilings) ceilings.forEach((c) => {
      if (c > zz + 1 && c < zz + WALK.headClear) blocked = true;
    });
    return { z: zz, blocked };
  };
  const chooseAt = (ctx, x, y, feet) => P.chooseSurface(P.surfacesAt(ctx, x, y), feet, P.ceilingsAt(ctx, x, y));

  /** Index of the floor the feet stand on. */
  P.floorIndexAt = (floors, feet) => {
    let idx = 0;
    floors.forEach((f, i) => {
      if (f.level <= feet + WALK.floorSnap) idx = i;
    });
    return idx;
  };

  /** Nearest collision-free point around (x, y) (spiral search), or the point itself. */
  P.findFreeSpot = (x, y, r, boxes) => {
    if (!P.overlapsAny(x, y, r, boxes)) return { x, y };
    for (let ring = 150; ring <= 2400; ring += 150) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const qx = x + Math.cos(a) * ring, qy = y + Math.sin(a) * ring;
        if (!P.overlapsAny(qx, qy, r, boxes)) return { x: qx, y: qy };
      }
    }
    return { x, y };
  };

  /**
   * Advance the walker by `dt` seconds. state {x, y, feet, vz} (mm, mm/s); vel {x, y} plan mm/s;
   * world {colliders, ctx, floors}. Pure: returns a NEW state including the floor index.
   */
  P.stepWalker = (state, vel, dt, world) => {
    let x = state.x, y = state.y;
    const feet0 = state.feet;
    const dist = Math.hypot(vel.x, vel.y) * dt;
    const steps = Math.max(1, Math.ceil(dist / WALK.maxSubstep));
    const sx = (vel.x * dt) / steps, sy = (vel.y * dt) / steps;
    for (let i = 0; i < steps && dist > 0; i++) {
      const moved = tryMove(x + sx, y + sy, feet0, world) || tryMove(x + sx, y, feet0, world) || tryMove(x, y + sy, feet0, world);
      if (!moved) break;
      x = moved.x;
      y = moved.y;
    }
    const target = chooseAt(world.ctx, x, y, feet0).z;
    const v = settleFeet(feet0, state.vz || 0, target, dt);
    return { x, y, feet: v.feet, vz: v.vz, floorIndex: P.floorIndexAt(world.floors, v.feet) };
  };
  function tryMove(nx, ny, feet, world) {
    const s = chooseAt(world.ctx, nx, ny, feet);
    if (s.blocked) return null;
    const body = P.bodyColliders(world.colliders, Math.max(feet, s.z));
    const res = P.resolveCircle(nx, ny, WALK.radius, body);
    if (res.hit && chooseAt(world.ctx, res.x, res.y, feet).blocked) return null;
    return { x: res.x, y: res.y };
  }
  /** Ease onto steps and small drops; fall with gravity from larger heights. */
  function settleFeet(feet, vz, target, dt) {
    const diff = target - feet;
    if (Math.abs(diff) < 1) return { feet: target, vz: 0 };
    if (diff > 0 || -diff <= WALK.stepUp) {
      const next = feet + diff * (1 - Math.exp(-dt * 16));
      return { feet: Math.abs(target - next) < 1 ? target : next, vz: 0 };
    }
    const nvz = vz + WALK.gravity * dt;
    const next = feet - nvz * dt;
    return next <= target ? { feet: target, vz: 0 } : { feet: next, vz: nvz };
  }

  /** Spawn point for a floor, nudged out of furniture and walls. → {x, y, feet, yaw} */
  P.spawnFor = (doc, floorId, colliders) => {
    const f = doc.floors.find((x) => x.id === floorId) || doc.floors[0];
    const sp = SPAWNS[f.id] || spawnFallback(doc, f.id);
    const body = P.bodyColliders(colliders, f.level);
    const free = P.findFreeSpot(sp.x, sp.y, WALK.radius + 20, body);
    return { x: free.x, y: free.y, feet: f.level, yaw: P.yawFromDir(sp.dir.x, sp.dir.y) };
  };
  function spawnFallback(doc, floorId) {
    const rooms = DD.rooms.compute(doc, floorId).filter((r) => !r.open && r.outer);
    const big = rooms.slice().sort((a, b) => b.area - a.area)[0];
    if (big) return { x: big.labelX, y: big.labelY, dir: { x: 0, y: -1 } };
    const b = P.floorBounds(doc, floorId);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, dir: { x: 0, y: -1 } };
  }

  // ================================================================== three.js runtime state
  const S = {
    THREE: null,
    OrbitControls: null,
    PointerLockControls: null,
    container: null,
    canvas: null,
    renderer: null,
    scene: null,
    camera: null,
    orbit: null,
    plc: null,
    sun: null,
    hemi: null,
    ambient: null,
    ready: false,
    loading: false,
    failed: false,
    active: false,
    raf: 0,
    lastT: 0,
    needsRender: true,
    world: null, // Group holding site + floors
    site: null,
    floors: new Map(), // floorId → { root, arch, furn, roof, sig, anim, shown }
    furniture: new Map(), // itemId → { obj, item, key, floor }
    index: { walls: new Map(), openings: new Map(), openingParts: new Map(), rooms: new Map() },
    dirty: { floors: new Set(), furniture: true, site: true, visibility: true, colliders: true, highlight: true, transient: false },
    surfDue: 0, // time of a throttled room-floor refresh during a wall drag
    cutaway: false, // during 2D↔3D transitions only floors up to the active one are shown, no roof
    atHome: false, // the orbit camera sits on the automatic home framing (re-fit on resize until the user moves it)
    warm: false, // shader programs / GPU buffers pre-compiled
    res: { mats: new Map(), textures: new Map(), tinted: new Map(), geos: new Map() },
    highlighted: [], // [{ mesh, material }] originals to restore
    outline: null, // selection box around furniture
    tween: null,
    pendingAerial: false,
    walk: null,
    press: null,
    drag: null,
    hoverPt: null,
    el: { status: null, prompt: null, cross: null },
    unsubs: [],
    ro: null,
  };

  const store = () => DD.store;
  const docNow = () => DD.store.doc;
  const uiNow = () => DD.store.ui;
  const requestRender = () => {
    S.needsRender = true;
  };

  // ------------------------------------------------------------------ materials & textures (cached, shared)
  function cached(map, key, make) {
    let v = map.get(key);
    if (v === undefined) {
      v = make();
      map.set(key, v);
    }
    return v;
  }
  function stdMat(hex, opts) {
    const key = 'std|' + hex + '|' + JSON.stringify(opts || {});
    return cached(S.res.mats, key, () => {
      const m = new S.THREE.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.85, metalness: 0 }, opts || {}));
      m.name = 'v3d:' + hex;
      return m;
    });
  }
  const MAT = {
    wall: () => stdMat(COLORS.wall, { roughness: 0.93 }),
    // Caps are the true top faces of the wall boxes: no polygon offset (it made them bleed through the faces of
    // the wall / parapet stacked on top as dark seams at grazing angles).
    capStructural: () => stdMat(COLORS.capStructural, { roughness: 0.8 }),
    capPartition: () => hatchMaterial(),
    coping: () => stdMat(COLORS.coping, { roughness: 0.7 }),
    muro: () => stdMat(COLORS.muro, { roughness: 0.95 }),
    muroCap: () => stdMat(COLORS.muroCap, { roughness: 0.8 }),
    sill: () => stdMat(COLORS.sillStone, { roughness: 0.45 }),
    wood: () => stdMat(COLORS.wood, { roughness: 0.55 }),
    metal: () => stdMat(COLORS.metal, { roughness: 0.4, metalness: 0.6 }),
    alu: () => stdMat(COLORS.aluminium, { roughness: 0.45, metalness: 0.55 }),
    glass: () =>
      stdMat(COLORS.glass, { roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.26, depthWrite: false, side: S.THREE.DoubleSide }),
    slab: () => stdMat(COLORS.slab, { roughness: 0.9 }),
    // white plaster; a little self-light stands in for the interior bounce the renderer does not compute
    ceiling: () => stdMat(COLORS.ceiling, { roughness: 0.95, emissive: COLORS.ceiling, emissiveIntensity: 0.16 }),
    stone: () => stdMat(COLORS.stairStone, { roughness: 0.5 }),
    stairBody: () => stdMat(COLORS.stairBody, { roughness: 0.9 }),
    roof: () => stdMat(COLORS.roof, { roughness: 0.95 }),
    curb: () => stdMat(COLORS.curb, { roughness: 0.9 }),
    neighbour: () => stdMat(COLORS.neighbour, { roughness: 1 }),
    neighbourRoof: () => stdMat(COLORS.neighbourRoof, { roughness: 1, flatShading: true }),
    trunk: () => stdMat(COLORS.trunk, { roughness: 0.9 }),
    leaves: () => stdMat(COLORS.leaves, { roughness: 0.9, flatShading: true }),
    white: () => stdMat('#F4F2EE', { roughness: 0.6 }),
  };

  function matInfo(id) {
    try {
      const m = DD.materials && DD.materials.get(id);
      if (m) return m;
    } catch (e) {
      console.warn('[view3d] material lookup failed', id, e);
    }
    return { id, tileMM: 600, base: '#CFC8BC', group: '' };
  }
  const ROUGHNESS = { marmore: 0.25, porcelanato: 0.4, ceramica: 0.42, ceramicaExt: 0.8, ladrilho: 0.6, cimento: 0.55, concreto: 0.85, carpete: 1, deck: 0.8, madeira: 0.55, madeiraEscura: 0.5, vinilico: 0.6 };

  /** Repeating CanvasTexture of a catalogue material; uv in metres → one canvas covers tileMM. */
  function materialTexture(id) {
    return cached(S.res.textures, 'mat|' + id, () => {
      let canvas = null;
      try {
        canvas = DD.materials && DD.materials.canvas ? DD.materials.canvas(id) : null;
      } catch (e) {
        console.warn('[view3d] texture generation failed', id, e);
      }
      if (!canvas) return null;
      const T = S.THREE;
      const tex = new T.CanvasTexture(canvas);
      const rep = 1000 / (matInfo(id).tileMM || 1000);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.repeat.set(rep, rep);
      tex.anisotropy = S.renderer.capabilities.getMaxAnisotropy();
      tex.colorSpace = T.SRGBColorSpace;
      return tex;
    });
  }
  function floorMaterial(id) {
    return cached(S.res.mats, 'floor|' + id, () => {
      const tex = materialTexture(id);
      const m = new S.THREE.MeshStandardMaterial({
        map: tex,
        color: tex ? '#FFFFFF' : matInfo(id).base,
        roughness: ROUGHNESS[id] == null ? 0.75 : ROUGHNESS[id],
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      });
      m.name = 'v3d:floor:' + id;
      return m;
    });
  }
  /**
   * Partition cap: sand fill with a 45° ink hatch (as the 2D partition poché), so non-structural walls read
   * differently from the dark structural cut and from the white wall faces. uv = wall-local metres.
   */
  function hatchMaterial() {
    return cached(S.res.mats, 'capPartition', () => {
      const T = S.THREE;
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = COLORS.capPartition;
      ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = COLORS.capHatch;
      ctx.lineWidth = 7;
      [-64, 0, 64].forEach((o) => {
        ctx.beginPath();
        ctx.moveTo(o, 64);
        ctx.lineTo(o + 64, 0);
        ctx.stroke();
      });
      const tex = new T.CanvasTexture(c);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.repeat.set(12, 12); // one hatch line every ~60 mm
      tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = S.renderer.capabilities.getMaxAnisotropy();
      const m = new T.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
      m.name = 'v3d:capPartition';
      return m;
    });
  }
  /** Coral-tinted clone of a material ('sel' | 'hov'), cached per source material. Never mutates the source. */
  function tinted(mat, level) {
    if (Array.isArray(mat)) return mat.map((m) => tinted(m, level));
    return cached(S.res.tinted, mat.uuid + '|' + level, () => {
      const m = mat.clone();
      const coral = new S.THREE.Color(COLORS.coral);
      const k = level === 'sel' ? 1 : 0.45;
      if (m.color) m.color.lerp(coral, 0.3 * k);
      if (m.emissive) {
        m.emissive.copy(coral);
        m.emissiveIntensity = 0.25 * k;
      }
      m.userData = Object.assign({}, m.userData, { shared: false, tint: level });
      return m;
    });
  }

  // ------------------------------------------------------------------ geometry builders
  // Axis-aligned box faces: corner selectors (0 = min, 1 = max) in CCW order seen from outside.
  const FACES = [
    { key: 'side', n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: (p) => [-p[2], p[1]] },
    { key: 'side', n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: (p) => [p[2], p[1]] },
    { key: 'top', n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: (p) => [p[0], -p[2]] },
    { key: 'bottom', n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: (p) => [p[0], p[2]] },
    { key: 'side', n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: (p) => [p[0], p[1]] },
    { key: 'side', n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: (p) => [-p[0], p[1]] },
  ];
  function faceMat(b, key) {
    if (key === 'top' && b.top != null) return b.top;
    if (key === 'bottom' && b.bottom != null) return b.bottom;
    return b.mat || 0;
  }

  /**
   * Merge axis-aligned boxes {x0,x1,y0,y1,z0,z1, mat, top?, bottom?, noBottom?} (metres) into ONE BufferGeometry
   * with one group per material index (planar world-scale uvs).
   */
  function boxesGeometry(boxes) {
    const byMat = new Map();
    boxes.forEach((b) => {
      if (!(b.x1 - b.x0 > 1e-5 && b.y1 - b.y0 > 1e-5 && b.z1 - b.z0 > 1e-5)) return;
      const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
      FACES.forEach((f) => {
        if (f.key === 'bottom' && b.noBottom) return;
        const mi = faceMat(b, f.key);
        const pts = f.c.map((s) => [s[0] ? hi[0] : lo[0], s[1] ? hi[1] : lo[1], s[2] ? hi[2] : lo[2]]);
        cached(byMat, mi, () => []).push({ pts, f });
      });
    });
    return quadsGeometry(byMat);
  }
  /** Upward-facing quads from plan rectangles (mm) at height y (m). uv = (X, −Z) metres. */
  function rectsTopGeometry(rects, y) {
    const f = FACES[2];
    const quads = rects.map((r) => {
      const x0 = r.x0 * MM, x1 = r.x1 * MM, z0 = r.y0 * MM, z1 = r.y1 * MM;
      return { pts: [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], f };
    });
    return quadsGeometry(new Map([[0, quads]]));
  }
  function quadsGeometry(byMat) {
    const T = S.THREE;
    const pos = [], nor = [], uv = [], idx = [];
    const geo = new T.BufferGeometry();
    Array.from(byMat.keys())
      .sort((a, b) => a - b)
      .forEach((mi) => {
        const start = idx.length;
        byMat.get(mi).forEach((q) => {
          const base = pos.length / 3;
          q.pts.forEach((p) => {
            pos.push(p[0], p[1], p[2]);
            nor.push(q.f.n[0], q.f.n[1], q.f.n[2]);
            const t = q.f.uv(p);
            uv.push(t[0], t[1]);
          });
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        });
        geo.addGroup(start, idx.length - start, mi);
      });
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
  /** Mesh with shadow flags; `mats` may be an array (groups). */
  function mesh(geo, mats, opts) {
    const m = new S.THREE.Mesh(geo, mats);
    const o = opts || {};
    m.castShadow = o.cast !== false;
    m.receiveShadow = o.receive !== false;
    if (o.userData) Object.assign(m.userData, o.userData);
    return m;
  }
  /** Shared unit geometries (never disposed by rebuilds). */
  function sharedGeo(key, make) {
    return cached(S.res.geos, key, () => {
      const g = make();
      g.userData.shared = true;
      return g;
    });
  }
  /** Dispose geometries under `obj` (materials and textures are cached / owned elsewhere). */
  function disposeTree(obj) {
    if (!obj) return;
    obj.traverse((o) => {
      if (o.isInstancedMesh && o.dispose) o.dispose();
      if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) o.geometry.dispose();
    });
    if (obj.parent) obj.parent.remove(obj);
  }
  function tagTree(obj, data) {
    obj.traverse((o) => Object.assign(o.userData, data));
    return obj;
  }

  // ================================================================== walls & openings
  // Wall-local frame (metres): origin at wall.a on the floor level, +X along the wall, +Y up, +Z = plan left
  // normal n = (−d.y, d.x). That is a pure rotation about Y by atan2(−d.y, d.x).
  const FW = 0.05; // frame member width (m)
  const OPEN_SWING = 88 * DEG;
  const OPEN_MAXAR = 24 * DEG;
  const OPEN_PIVOT = 65 * DEG;
  const LEAF_MATS = () => [MAT.wood(), MAT.metal(), MAT.glass()];

  function wallMaterials(kind) {
    if (kind === 'muro') return [MAT.muro(), MAT.muroCap(), MAT.sill()];
    return [MAT.wall(), kind === 'structural' ? MAT.capStructural() : MAT.capPartition(), MAT.sill()];
  }

  function buildWall(doc, w, floor) {
    const T = S.THREE;
    const { d, L } = DD.geom.wallDir(w);
    const g = new T.Group();
    g.name = 'wall:' + w.id;
    g.position.set(w.a.x * MM, floor.level * MM, w.a.y * MM);
    g.rotation.y = Math.atan2(-d.y, d.x);
    if (w.kind === 'railing') buildRailing(g, w, L);
    else {
      const conts = P.windowContinuations(doc);
      const ops = DD.geom.openingsOfWall(doc, w.id);
      const lowerOf = new Set(conts.filter((c) => c.lowerWall === w.id).map((c) => c.opId));
      // the upper part of a window that starts on the floor below: a hole from the floor up to its head
      const upper = conts
        .filter((c) => c.upperWall === w.id)
        .map((c) => ({ id: 'cont:' + c.opId, wall: w.id, code: c.code, type: 'window', t: c.t, width: c.width, sill: 0, height: c.height, style: 'contUpper', side: 1, hinge: 'start', of: c.opId }));
      buildWallBody(g, w, ops.concat(upper));
      ops.forEach((op) => {
        const o = buildOpening(doc, w, op, L, lowerOf.has(op.id) ? 'fixed' : null);
        if (o) {
          g.add(o);
          S.index.openings.set(op.id, o);
        }
      });
      upper.forEach((op) => {
        const o = buildOpening(doc, w, op, L, null);
        if (!o) return;
        tagTree(o, { openingId: op.of });
        g.add(o);
        S.index.openingParts.set(op.of, o);
      });
    }
    tagTree(g, { wallId: w.id });
    return g;
  }

  /** Solid / sill / lintel pieces merged into one mesh: [side, cap, sill-stone] material groups. */
  function buildWallBody(g, w, ops) {
    const H = w.height;
    const ht = (w.thick / 2) * MM;
    const muro = w.kind === 'muro';
    const boxes = [];
    DD.geom.wallPieces(w, ops).forEach((p) => {
      const reachesTop = p.z1 >= H - 0.5;
      const isSill = p.part === 'sill';
      const top = reachesTop ? 1 : isSill ? 2 : 0;
      boxes.push({ x0: p.t0 * MM, x1: p.t1 * MM, y0: p.z0 * MM, y1: p.z1 * MM, z0: -ht, z1: ht, mat: 0, top, noBottom: p.z0 < 0.5 });
      if (isSill) boxes.push({ x0: p.t0 * MM, x1: p.t1 * MM, y0: p.z1 * MM - 0.025, y1: p.z1 * MM, z0: -ht - 0.03, z1: ht + 0.03, mat: 2 });
      if (muro && reachesTop) boxes.push({ x0: p.t0 * MM, x1: p.t1 * MM, y0: H * MM, y1: H * MM + 0.04, z0: -ht - 0.025, z1: ht + 0.025, mat: 1 });
    });
    g.add(mesh(boxesGeometry(boxes), wallMaterials(w.kind)));
  }

  /** Solid base of a railing (mm): wall.mureta, absent → 300; never above the railing height. */
  P.muretaOf = (w) => P.clamp(w.mureta != null && isFinite(w.mureta) ? w.mureta : RAILING_MURETA, 0, Math.max(0, w.height || 0));

  /**
   * Guarda-corpo: solid mureta (wall.mureta; plastered, stone coping) + black metal balusters every ~110 mm between
   * a bottom and a top rail at the wall height. Without mureta (stair-void guard) it is a slim steel guard.
   */
  function buildRailing(g, w, L) {
    const T = S.THREE;
    const len = L * MM, H = w.height * MM, ht = (w.thick / 2) * MM;
    const mur = P.muretaOf(w) * MM;
    const rw = Math.min(0.028, ht * 0.8 + 0.004); // half width of the rails
    const railBoxes = [{ x0: 0.02, x1: len - 0.02, y0: H - 0.04, y1: H, z0: -rw, z1: rw }];
    if (mur > 0.005) {
      const cope = 0.03;
      g.add(mesh(boxesGeometry([
        { x0: 0, x1: len, y0: 0, y1: Math.max(0.001, mur - cope), z0: -ht, z1: ht, mat: 0, noBottom: true },
        { x0: 0, x1: len, y0: Math.max(0.001, mur - cope), y1: mur, z0: -ht - 0.012, z1: ht + 0.012, mat: 1 },
      ]), [MAT.wall(), MAT.coping()]));
    } else {
      railBoxes.push({ x0: 0.02, x1: len - 0.02, y0: 0.06, y1: 0.09, z0: -rw, z1: rw }); // bottom rail
      [0.01, len - 0.05].forEach((px) => railBoxes.push({ x0: px, x1: px + 0.04, y0: 0, y1: H, z0: -rw, z1: rw })); // end posts
    }
    g.add(mesh(boxesGeometry(railBoxes), [MAT.metal()]));
    const step = 0.11;
    const n = Math.max(0, Math.floor((len - 0.08) / step));
    const y0 = mur > 0.005 ? mur : 0.09;
    const h = H - 0.04 - y0;
    if (!n || h < 0.02) return;
    const geo = sharedGeo('baluster', () => new T.BoxGeometry(0.018, 1, 0.018));
    const inst = new T.InstancedMesh(geo, MAT.metal(), n);
    const x0 = (len - (n - 1) * step) / 2;
    const m4 = new T.Matrix4();
    for (let i = 0; i < n; i++) inst.setMatrixAt(i, m4.makeScale(1, h, 1).setPosition(x0 + i * step, y0 + h / 2, 0));
    inst.castShadow = true;
    inst.receiveShadow = false;
    g.add(inst);
  }

  /** Which side of the wall (±1 along +Z) is outside: the side without an indoor room. */
  function exteriorSign(doc, w, op) {
    try {
      const f = DD.geom.openingFrame(w, op);
      const probe = (s) => DD.rooms.at(doc, w.floor, f.c.x + f.n.x * s * 450, f.c.y + f.n.y * s * 450);
      const indoor = (r) => !!r && !r.outdoor;
      const plus = indoor(probe(1)), minus = indoor(probe(-1));
      if (plus && !minus) return -1;
      if (minus && !plus) return 1;
    } catch (e) {
      console.warn('[view3d] exterior side detection failed', op.id, e);
    }
    return op.side === -1 ? -1 : 1;
  }

  /** `styleOverride` 'fixed' = lower part of a window that continues on the floor above (fixed pane + transom). */
  function buildOpening(doc, w, op, L, styleOverride) {
    const H = w.height;
    const t0 = P.clamp(op.t - op.width / 2, 0, L), t1 = P.clamp(op.t + op.width / 2, 0, L);
    const sill = P.clamp(op.sill || 0, 0, H), top = P.clamp((op.sill || 0) + op.height, 0, H);
    if (t1 - t0 < 60 || top - sill < 60) return null;
    const o = {
      x0: t0 * MM,
      x1: t1 * MM,
      y0: sill * MM,
      y1: top * MM,
      ht: (w.thick / 2) * MM,
      side: op.side === -1 ? -1 : 1,
      hinge: op.hinge === 'end' ? 'end' : 'start',
      ext: exteriorSign(doc, w, op),
      code: op.code,
    };
    const g = new S.THREE.Group();
    g.name = 'opening:' + op.id;
    const style = styleOverride || op.style;
    const build = OPENING_BUILDERS[style] || (op.type === 'door' ? OPENING_BUILDERS.swing : OPENING_BUILDERS.fixed);
    build(g, o);
    tagTree(g, { openingId: op.id });
    return g;
  }

  // ------------------------------------------------------------------ opening parts
  function frameBoxes(o, withSill) {
    const b = [
      { x0: o.x0, x1: o.x0 + FW, y0: o.y0, y1: o.y1, z0: -o.ht, z1: o.ht },
      { x0: o.x1 - FW, x1: o.x1, y0: o.y0, y1: o.y1, z0: -o.ht, z1: o.ht },
      { x0: o.x0 + FW, x1: o.x1 - FW, y0: o.y1 - FW, y1: o.y1, z0: -o.ht, z1: o.ht },
    ];
    if (withSill) b.push({ x0: o.x0 + FW, x1: o.x1 - FW, y0: o.y0, y1: o.y0 + FW * 0.6, z0: -o.ht, z1: o.ht });
    return b;
  }
  function addFrame(g, o, withSill) {
    g.add(mesh(boxesGeometry(frameBoxes(o, withSill)), [MAT.wood()]));
  }
  /** Door leaf in local coords x 0..lw, y 0..lh, z ±lt/2. glass: 'none' | 'full' | 'top'. */
  function leafBoxes(lw, lh, lt, glass) {
    if (glass === 'none') return [{ x0: 0, x1: lw, y0: 0, y1: lh, z0: -lt / 2, z1: lt / 2 }];
    const r = Math.min(0.085, lw * 0.2);
    const gb = glass === 'top' ? lh * 0.55 : 0.18;
    const z0 = -lt / 2, z1 = lt / 2;
    return [
      { x0: 0, x1: r, y0: 0, y1: lh, z0, z1 },
      { x0: lw - r, x1: lw, y0: 0, y1: lh, z0, z1 },
      { x0: r, x1: lw - r, y0: lh - r, y1: lh, z0, z1 },
      { x0: r, x1: lw - r, y0: 0, y1: gb, z0, z1 },
      { x0: r, x1: lw - r, y0: gb, y1: lh - r, z0: -0.004, z1: 0.004, mat: 2 },
    ];
  }
  function handleBoxes(x, lt) {
    const y = 1.02, z = lt / 2;
    return [
      { x0: x - 0.012, x1: x + 0.012, y0: y - 0.03, y1: y + 0.03, z0: z, z1: z + 0.012, mat: 1 },
      { x0: x - 0.012, x1: x + 0.012, y0: y - 0.03, y1: y + 0.03, z0: -z - 0.012, z1: -z, mat: 1 },
      { x0: x - 0.11, x1: x + 0.012, y0: y - 0.01, y1: y + 0.01, z0: z + 0.012, z1: z + 0.05, mat: 1 },
      { x0: x - 0.11, x1: x + 0.012, y0: y - 0.01, y1: y + 0.01, z0: -z - 0.05, z1: -z - 0.012, mat: 1 },
    ];
  }
  function leafMesh(lw, lh, lt, glass, handleX) {
    const boxes = leafBoxes(lw, lh, lt, glass);
    const hx = handleX == null ? null : handleX;
    const withHandle = hx != null ? boxes.concat(handleBoxes(hx, lt).map((b) => (hx < lw / 2 ? mirrorX(b, hx) : b))) : boxes;
    return mesh(boxesGeometry(withHandle), LEAF_MATS());
  }
  function mirrorX(b, cx) {
    return Object.assign({}, b, { x0: 2 * cx - b.x1, x1: 2 * cx - b.x0 });
  }
  /** Hinged leaf opened `angle` towards o.side. L = {hingeX, sgn (+1 leaf extends +x), lw, lh, lt, glass}. */
  function addHingedLeaf(g, o, L) {
    const pivot = new S.THREE.Object3D();
    const zFace = o.side * Math.max(0, o.ht - L.lt / 2 - 0.008);
    pivot.position.set(L.hingeX + L.sgn * (L.lt / 2), o.y0 + 0.008, zFace);
    pivot.rotation.y = -o.side * L.sgn * L.angle;
    const m = leafMesh(L.lw, L.lh, L.lt, L.glass, L.sgn > 0 ? L.lw - 0.07 : 0.07);
    if (L.sgn < 0) m.position.x = -L.lw;
    pivot.add(m);
    g.add(pivot);
  }
  /** Window sash in local coords x 0..sw, y 0..sh, z ±st/2 (wood bars + glass). */
  function sashMesh(sw, sh, st) {
    const r = Math.min(0.045, sw * 0.2, sh * 0.2);
    const z0 = -st / 2, z1 = st / 2;
    const boxes = [
      { x0: 0, x1: r, y0: 0, y1: sh, z0, z1 },
      { x0: sw - r, x1: sw, y0: 0, y1: sh, z0, z1 },
      { x0: r, x1: sw - r, y0: 0, y1: r, z0, z1 },
      { x0: r, x1: sw - r, y0: sh - r, y1: sh, z0, z1 },
      { x0: r, x1: sw - r, y0: r, y1: sh - r, z0: -0.003, z1: 0.003, mat: 2 },
    ];
    return mesh(boxesGeometry(boxes), LEAF_MATS());
  }
  function placed(obj, x, y, z) {
    obj.position.set(x, y, z);
    return obj;
  }
  function innerOf(o) {
    return { x0: o.x0 + FW, x1: o.x1 - FW, w: o.x1 - o.x0 - 2 * FW, h: o.y1 - o.y0 - FW };
  }

  // ------------------------------------------------------------------ opening styles
  function buildSwing(g, o) {
    addFrame(g, o, false);
    const i = innerOf(o);
    const glass = o.code === 'P3' ? 'top' : 'none';
    const end = o.hinge === 'end';
    addHingedLeaf(g, o, { hingeX: end ? i.x1 : i.x0, sgn: end ? -1 : 1, lw: i.w, lh: i.h - 0.012, lt: 0.04, glass, angle: OPEN_SWING });
  }
  function buildDouble(g, o) {
    addFrame(g, o, false);
    const i = innerOf(o);
    const lw = i.w / 2, lh = i.h - 0.012;
    addHingedLeaf(g, o, { hingeX: i.x0, sgn: 1, lw, lh, lt: 0.04, glass: 'full', angle: OPEN_SWING });
    addHingedLeaf(g, o, { hingeX: i.x1, sgn: -1, lw, lh, lt: 0.04, glass: 'full', angle: OPEN_SWING });
  }
  /** One leaf running on the wall face, shown half open. */
  function buildSlide(g, o) {
    addFrame(g, o, false);
    const i = innerOf(o);
    const lw = i.w + 0.06, lh = i.h + 0.02, lt = 0.035;
    const dir = o.hinge === 'end' ? 1 : -1;
    const x0 = i.x0 - 0.03 + dir * lw * 0.5;
    const z = o.side * (o.ht + lt / 2 + 0.012);
    g.add(placed(leafMesh(lw, lh, lt, 'none', dir > 0 ? 0.07 : lw - 0.07), x0, o.y0 + 0.006, z));
    const tx0 = Math.min(o.x0, x0) - 0.02, tx1 = Math.max(o.x1, x0 + lw) + 0.02;
    const ty = o.y0 + 0.006 + lh;
    const tz0 = o.side > 0 ? o.ht : -o.ht - 0.055, tz1 = o.side > 0 ? o.ht + 0.055 : -o.ht;
    g.add(mesh(boxesGeometry([{ x0: tx0, x1: tx1, y0: ty, y1: ty + 0.045, z0: tz0, z1: tz1 }]), [MAT.wood()]));
  }
  /** Four glazed leaves on two tracks: the two middle leaves half open towards the sides. */
  function buildSlide4(g, o) {
    addFrame(g, o, true);
    const i = innerOf(o);
    const lw = i.w / 4 + 0.03, lh = i.h - FW * 0.6 - 0.01, y = o.y0 + FW * 0.6;
    const q = i.w / 4;
    const xs = [0, q - 0.015 - lw * 0.5, 2 * q - 0.015 + lw * 0.5, i.w - lw];
    const zs = [-0.024, 0.024, 0.024, -0.024];
    xs.forEach((x, k) => g.add(placed(leafMesh(lw, lh, 0.035, 'full', null), i.x0 + x, y, zs[k])));
  }
  function gateBoxes(w, h) {
    const b = [
      { x0: 0, x1: w, y0: 0.04, y1: 0.1, z0: -0.025, z1: 0.025 },
      { x0: 0, x1: w, y0: h - 0.06, y1: h, z0: -0.025, z1: 0.025 },
      { x0: 0, x1: 0.06, y0: 0.04, y1: h, z0: -0.025, z1: 0.025 },
      { x0: w - 0.06, x1: w, y0: 0.04, y1: h, z0: -0.025, z1: 0.025 },
    ];
    const pitch = 0.11, n = Math.max(0, Math.floor((w - 0.12) / pitch));
    const x0 = (w - n * pitch) / 2;
    for (let k = 0; k < n; k++) b.push({ x0: x0 + k * pitch + 0.015, x1: x0 + k * pitch + 0.095, y0: 0.1, y1: h - 0.06, z0: -0.01, z1: 0.01 });
    return b;
  }
  /** Aluminium gates are shown closed (they block the walker too). */
  function buildGate(g, o, sliding) {
    const w = o.x1 - o.x0, h = o.y1 - o.y0;
    g.add(placed(mesh(boxesGeometry(gateBoxes(w, h)), [MAT.alu()]), o.x0, o.y0, 0));
    if (sliding) g.add(mesh(boxesGeometry([{ x0: o.x0 - 0.1, x1: o.x1 + 0.1, y0: 0, y1: 0.03, z0: -0.03, z1: 0.03 }]), [MAT.alu()]));
  }
  function buildSlide2(g, o) {
    addFrame(g, o, true);
    const i = innerOf(o);
    const sw = i.w / 2 + 0.03, sh = i.h - FW * 0.6, y = o.y0 + FW * 0.6;
    g.add(placed(sashMesh(sw, sh, 0.035), i.x0, y, -0.022));
    g.add(placed(sashMesh(sw, sh, 0.035), i.x1 - sw - sw * 0.28, y, 0.022));
  }
  /** Top-hung sash tilted outwards. */
  function addMaxar(g, o, x0, sw, yTop, sh) {
    const pivot = new S.THREE.Object3D();
    pivot.position.set(x0, yTop, 0);
    pivot.rotation.x = -o.ext * OPEN_MAXAR;
    pivot.add(placed(sashMesh(sw, sh, 0.035), 0, -sh, 0));
    g.add(pivot);
  }
  function buildMaxar(g, o) {
    addFrame(g, o, true);
    const i = innerOf(o);
    const bottom = o.y0 + FW * 0.6;
    addMaxar(g, o, i.x0, i.w, o.y1 - FW, o.y1 - FW - bottom);
  }
  /** Fixed lower pane + top-hung upper sash (clamped windows keep at least the sash). */
  function buildFixedMaxar(g, o) {
    addFrame(g, o, true);
    const i = innerOf(o);
    const bottom = o.y0 + FW * 0.6, top = o.y1 - FW, h = top - bottom;
    if (h < 0.6) return addMaxar(g, o, i.x0, i.w, top, h);
    const split = bottom + h * 0.58;
    g.add(placed(sashMesh(i.w, split - bottom, 0.035), i.x0, bottom, 0));
    g.add(mesh(boxesGeometry([{ x0: i.x0, x1: i.x1, y0: split, y1: split + FW * 0.8, z0: -o.ht, z1: o.ht }]), [MAT.wood()]));
    addMaxar(g, o, i.x0, i.w, top, top - split - FW * 0.8);
  }
  function buildPivot(g, o) {
    addFrame(g, o, true);
    const i = innerOf(o);
    const bottom = o.y0 + FW * 0.6, sh = o.y1 - FW - bottom;
    const pivot = new S.THREE.Object3D();
    pivot.position.set(i.x0 + i.w / 2, bottom, 0);
    pivot.rotation.y = OPEN_PIVOT;
    pivot.add(placed(sashMesh(i.w, sh, 0.035), -i.w / 2, 0, 0));
    g.add(pivot);
  }
  function buildFixed(g, o) {
    addFrame(g, o, true);
    const i = innerOf(o);
    g.add(placed(sashMesh(i.w, i.h - FW * 0.6, 0.035), i.x0, o.y0 + FW * 0.6, 0));
  }
  /** Upper part of a window continuing from the floor below: jambs + head (no sill) and a top-hung sash. */
  function buildContUpper(g, o) {
    addFrame(g, o, false);
    const i = innerOf(o);
    const top = o.y1 - FW;
    addMaxar(g, o, i.x0, i.w, top, top - o.y0 - 0.004);
  }
  const OPENING_BUILDERS = {
    swing: buildSwing,
    double: buildDouble,
    slide: buildSlide,
    slide4: buildSlide4,
    gate: (g, o) => buildGate(g, o, false),
    gateSlide: (g, o) => buildGate(g, o, true),
    slide2: buildSlide2,
    maxar: buildMaxar,
    fixedMaxar: buildFixedMaxar,
    pivot: buildPivot,
    fixed: buildFixed,
    contUpper: buildContUpper,
  };

  // ================================================================== floors, slabs, stairs, roof
  function closedRooms(doc, floorId) {
    return DD.rooms.compute(doc, floorId).filter((r) => !r.open && r.outer && r.outer.length >= 3);
  }
  /** Finished floor of each room (world-aligned texture, one texture = tileMM), minus stair holes. */
  function buildRoomFloors(group, doc, floor, holes) {
    const y = floor.level * MM + 0.002;
    closedRooms(doc, floor.id).forEach((room) => {
      const rects = P.polysToRects([{ outer: room.outer, holes: room.holes }], holes);
      if (!rects.length) return;
      const m = mesh(rectsTopGeometry(rects, y), floorMaterial(room.material), { cast: false, userData: { roomId: room.id } });
      m.name = 'room:' + room.id;
      group.add(m);
      S.index.rooms.set(room.id, m);
    });
  }
  /** Structural slab under a floor: rooms grown to the wall centre line, minus stair holes. */
  function buildSlab(group, doc, floor, holes, thickMM) {
    const rooms = closedRooms(doc, floor.id);
    const rects = P.polysToRects(rooms.map((r) => ({ outer: P.offsetLoop(r.outer, WALL_CENTRE_OFFSET), holes: [] })), holes);
    if (!rects.length) return;
    const y1 = floor.level * MM, y0 = y1 - thickMM * MM;
    const boxes = rects.map((r) => ({ x0: r.x0 * MM, x1: r.x1 * MM, y0, y1, z0: r.y0 * MM, z1: r.y1 * MM, mat: 0, bottom: 1 }));
    const m = mesh(boxesGeometry(boxes), [MAT.slab(), MAT.ceiling()]);
    m.name = 'slab:' + floor.id;
    m.userData.occluder = true;
    group.add(m);
  }

  // ------------------------------------------------------------------ stairs (floating treads + inclined slabs)
  const TREAD_STONE = 0.04;
  const TREAD_BODY = STAIR_DROP * MM - TREAD_STONE;
  const STAIR_SLAB = STAIR_SLAB_MM * MM;

  function buildStair(group, st, floor) {
    const g = DD.geom.stairGeometry(st, floor.height);
    const lvl = floor.level * MM;
    const stones = [], bodies = [];
    g.treads.concat(g.landing).forEach((t) => {
      const top = lvl + t.z * MM;
      const x0 = t.x0 * MM, x1 = t.x1 * MM, z0 = t.y0 * MM, z1 = t.y1 * MM;
      stones.push({ x0, x1, y0: top - TREAD_STONE, y1: top, z0, z1 });
      bodies.push({ x0, x1, y0: top - TREAD_STONE - TREAD_BODY, y1: top - TREAD_STONE, z0, z1 });
    });
    const sg = new S.THREE.Group();
    sg.name = 'stair:' + st.id;
    sg.add(mesh(boxesGeometry(stones), [MAT.stone()]));
    sg.add(mesh(boxesGeometry(bodies), [MAT.stairBody()]));
    stairSlabs(st, g, lvl).forEach((s) => sg.add(s));
    stairRails(st, g, lvl).forEach((s) => sg.add(s));
    tagTree(sg, { occluder: true });
    group.add(sg);
  }
  /** An inclined slab whose top line passes through (xa, ya) → (xb, yb) (m), across rows z0..z1. */
  function inclinedBox(xa, ya, xb, yb, z0, z1, thick, mat) {
    const T = S.THREE;
    const len = Math.hypot(xb - xa, yb - ya);
    const ang = Math.atan2(yb - ya, xb - xa);
    const m = mesh(new T.BoxGeometry(len, thick, z1 - z0), mat);
    // centre = midpoint of the top line moved down by thick/2 along the slab normal
    const nx = Math.sin(ang), ny = -Math.cos(ang);
    const s = Math.sign(Math.cos(ang)) || 1;
    m.position.set((xa + xb) / 2 + nx * s * (thick / 2), (ya + yb) / 2 + ny * s * (thick / 2), (z0 + z1) / 2);
    m.rotation.z = ang;
    return m;
  }
  /** The two inclined flight slabs (shared line definitions with the walker: P.stairSlabs). */
  function stairSlabs(st, g, lvl) {
    return P.stairSlabs(st, g).map((s) =>
      inclinedBox(s.x0 * MM, lvl + s.top(s.x0) * MM, s.x1 * MM, lvl + s.top(s.x1) * MM, s.y0 * MM, s.y1 * MM, STAIR_SLAB, MAT.stairBody())
    );
  }
  /**
   * Black metal handrails 0,90 m above the nosings on the open edges: outer edge of the lower flight and of the
   * landing, inner edge of the upper flight. Works for any lowerCount/upperCount (landing = one full-width rect).
   */
  function stairRails(st, g, lvl) {
    const r = g.riser * MM, T = st.tread * MM, x = st.x * MM, y = st.y * MM, W = st.width * MM;
    const k = r / T, hRail = 0.9;
    const land = g.landing[0];
    const landX = land.x0 * MM, landZ = lvl + land.z * MM, endX = land.x1 * MM;
    const lowerTop = (xx) => lvl + (xx - x) * k + r; // nosing line of the lower flight
    const upperTop = (xx) => landZ + r + (landX - xx) * k; // nosing line of the upper flight
    const zo0 = y + W - 0.05, zo1 = y + W - 0.01; // outer edge (far row)
    const zi0 = y + W / 2 - 0.02, zi1 = y + W / 2 + 0.02; // inner edge (between the rows)
    const out = [
      inclinedBox(x, lowerTop(x) + hRail, landX, lowerTop(landX) + hRail, zo0, zo1, 0.04, MAT.metal()),
      inclinedBox(landX, upperTop(landX) + hRail, x, upperTop(x) + hRail, zi0, zi1, 0.04, MAT.metal()),
    ];
    const posts = [{ x0: landX, x1: endX - 0.02, y0: landZ + hRail - 0.04, y1: landZ + hRail, z0: zo0, z1: zo1 }]; // landing rail
    const nLow = g.treads.filter((t) => t.flight === 0).length, nUp = g.treads.filter((t) => t.flight === 1).length;
    for (let i = 0; i <= nLow; i += 2) {
      const px = Math.min(x + i * T + T * 0.5, landX - 0.03);
      posts.push({ x0: px - 0.012, x1: px + 0.012, y0: lowerTop(px) - r, y1: lowerTop(px) + hRail, z0: y + W - 0.042, z1: y + W - 0.018 });
    }
    for (let px = landX + 0.25; px < endX - 0.05; px += 0.27) {
      posts.push({ x0: px - 0.012, x1: px + 0.012, y0: landZ, y1: landZ + hRail, z0: y + W - 0.042, z1: y + W - 0.018 });
    }
    for (let j = 0; j <= nUp; j += 2) {
      const px = Math.max(landX - j * T - T * 0.5, x + 0.03);
      posts.push({ x0: px - 0.012, x1: px + 0.012, y0: upperTop(px) - r, y1: upperTop(px) + hRail, z0: y + W / 2 - 0.012, z1: y + W / 2 + 0.012 });
    }
    out.push(mesh(boxesGeometry(posts), [MAT.metal()]));
    return out;
  }

  // ------------------------------------------------------------------ roof (top floor, roofed rooms only)
  function buildRoof(doc, floor) {
    const rooms = closedRooms(doc, floor.id).filter((r) => !r.outdoor);
    if (!rooms.length) return null;
    const rects = P.polysToRects(rooms.map((r) => ({ outer: P.offsetLoop(r.outer, WALL_CENTRE_OFFSET), holes: [] })), []);
    if (!rects.length) return null;
    const y0 = (floor.level + floor.height) * MM, y1 = y0 + ROOF_T * MM;
    const g = new S.THREE.Group();
    g.name = 'roof:' + floor.id;
    const slab = rects.map((r) => ({ x0: r.x0 * MM, x1: r.x1 * MM, y0, y1, z0: r.y0 * MM, z1: r.y1 * MM, mat: 0, bottom: 1 }));
    g.add(mesh(boxesGeometry(slab), [MAT.roof(), MAT.ceiling()]));
    const half = WALL_CENTRE_OFFSET * MM;
    const top = y1 + PARAPET_H * MM;
    const parapet = P.rectsOutline(rects).map((s) => {
      const ax = Math.min(s.a.x, s.b.x) * MM, bx = Math.max(s.a.x, s.b.x) * MM;
      const az = Math.min(s.a.y, s.b.y) * MM, bz = Math.max(s.a.y, s.b.y) * MM;
      const horizontal = Math.abs(s.a.y - s.b.y) < 1e-6;
      return horizontal
        ? { x0: ax - half, x1: bx + half, y0: y0, y1: top, z0: az - half, z1: az + half, mat: 0, top: 1, noBottom: true }
        : { x0: ax - half, x1: ax + half, y0: y0, y1: top, z0: az - half, z1: bz + half, mat: 0, top: 1, noBottom: true };
    });
    g.add(mesh(boxesGeometry(parapet), [MAT.wall(), MAT.coping()])); // platibanda with a light stone coping
    tagTree(g, { occluder: true });
    return g;
  }

  /** Room floors + structural slab of one floor (rebuilt separately from the walls during wall drags). */
  function buildFloorSurfaces(doc, floor, index) {
    const g = new S.THREE.Group();
    g.name = 'surfaces:' + floor.id;
    const holes = index > 0 ? DD.geom.stairHoles(doc, floor.id) : [];
    const cuts = P.windowContinuations(doc).filter((c) => c.floor === floor.id).map((c) => c.cut);
    buildRoomFloors(g, doc, floor, holes);
    buildSlab(g, doc, floor, holes.concat(cuts), index > 0 ? SLAB : BASE_SLAB);
    return g;
  }
  function addWallGroup(arch, doc, w, floor) {
    const wg = buildWall(doc, w, floor);
    arch.userData.walls.add(wg);
    S.index.walls.set(w.id, wg);
    return wg;
  }
  /** Everything built from walls/rooms/stairs for one floor: { surfaces, walls, stairs } sub-groups. */
  function buildFloorArch(doc, floor, index) {
    const T = S.THREE;
    const arch = new T.Group();
    arch.name = 'arch:' + floor.id;
    const walls = new T.Group();
    walls.name = 'walls:' + floor.id;
    const stairs = new T.Group();
    stairs.name = 'stairs:' + floor.id;
    arch.userData.surfaces = buildFloorSurfaces(doc, floor, index);
    arch.userData.walls = walls;
    arch.add(arch.userData.surfaces, walls, stairs);
    doc.walls.forEach((w) => {
      if (w.floor === floor.id) addWallGroup(arch, doc, w, floor);
    });
    doc.stairs.forEach((st) => {
      if (st.floor === floor.id) buildStair(stairs, st, floor);
    });
    return arch;
  }

  // ================================================================== site: ground, street, neighbours, sky
  const GROUND_Y = -0.02;
  const ZONE_Y = -0.01;
  const WORLD_HALF = 400; // m — far beyond the fog: the edge of the world is never seen
  const FOG = { near: 45, far: 190, max: 360 }; // m; near/far follow the orbit distance (see updateFog)
  const SIDEWALK = 2.5; // m
  const STREET = 9; // m
  const ZONE_MATERIAL = { paving: 'calcada', driveway: 'intertravado', grass: 'grama' };

  /** Textured horizontal plane covering [x0,x1]×[z0,z1] (m) at height y. */
  function groundPlane(x0, x1, z0, z1, y, material) {
    const rect = { x0: x0 / MM, x1: x1 / MM, y0: z0 / MM, y1: z1 / MM };
    const m = mesh(rectsTopGeometry([rect], y), material, { cast: false });
    m.userData.ground = true;
    return m;
  }
  function siteMaterial(id, fallback, opts) {
    return cached(S.res.mats, 'site|' + id, () => {
      const tex = materialTexture(id);
      return new S.THREE.MeshStandardMaterial(Object.assign({ map: tex, color: tex ? '#FFFFFF' : fallback, roughness: 0.95, metalness: 0 }, opts || {}));
    });
  }
  function asphaltMaterial() {
    return cached(S.res.mats, 'site|asphalt', () => {
      const T = S.THREE;
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = COLORS.asphalt;
      ctx.fillRect(0, 0, 256, 256);
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 5000; i++) {
        const v = 40 + Math.floor(rnd() * 50);
        ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 3) + ',' + (0.35 + rnd() * 0.4) + ')';
        ctx.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
      }
      const tex = new T.CanvasTexture(c);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.repeat.set(0.5, 0.5);
      tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = S.renderer.capabilities.getMaxAnisotropy();
      return new T.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 });
    });
  }

  function buildStreet(g, lot) {
    const front = lot.h * MM;
    const xa = -WORLD_HALF, xb = WORLD_HALF;
    const walk = siteMaterial('calcada', '#B3ADA2');
    g.add(groundPlane(xa, xb, front, front + SIDEWALK, ZONE_Y, walk));
    g.add(groundPlane(xa, xb, front + SIDEWALK, front + SIDEWALK + STREET, -0.12, asphaltMaterial()));
    g.add(groundPlane(xa, xb, front + SIDEWALK + STREET, front + 2 * SIDEWALK + STREET, ZONE_Y, walk));
    const curbs = [front + SIDEWALK, front + SIDEWALK + STREET].map((z, k) => ({
      x0: xa, x1: xb, y0: -0.12, y1: ZONE_Y + 0.004, z0: k ? z : z - 0.12, z1: k ? z + 0.12 : z,
    }));
    g.add(mesh(boxesGeometry(curbs), [MAT.curb()], { cast: false }));
    const dashes = [];
    const zc = front + SIDEWALK + STREET / 2;
    for (let x = -150; x < 150; x += 4) dashes.push({ x0: x, x1: x + 2.2, y0: -0.12, y1: -0.115, z0: zc - 0.06, z1: zc + 0.06 });
    g.add(mesh(boxesGeometry(dashes), [MAT.white()], { cast: false }));
  }
  // ------------------------------------------------------------------ ground: natural lawn fading into the haze
  /** Deterministic smooth value noise in [0,1] (world metres). */
  function hash2(ix, iz) {
    let h = (ix * 374761393 + iz * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function valueNoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return P.lerp(P.lerp(a, b, sx), P.lerp(c, d, sx), sz);
  }
  const fbm = (x, z) => 0.55 * valueNoise(x / 23, z / 23) + 0.3 * valueNoise(x / 9 + 17.3, z / 9 - 4.1) + 0.15 * valueNoise(x / 3.7 - 8.2, z / 3.7 + 2.9);
  // linear-space multipliers of the (desaturated) lawn texture
  const LAWN = [1, 1, 1];
  const DRY = [1.55, 1.18, 1.25]; // dry, straw-tinted grass away from the lot
  /** Vertex colour of the ground at world (x, z) m: large-scale patches + drier grass far from the lot. */
  function groundTint(x, z, lot) {
    const dx = Math.max(0, -x, x - lot.w), dz = Math.max(0, -z, z - lot.h);
    const n = fbm(x, z);
    const dry = P.clamp(0.75 * P.clamp((Math.hypot(dx, dz) - 4) / 30, 0, 1) + (n - 0.5) * 0.7, 0, 1);
    const bright = 0.84 + 0.3 * n;
    return [0, 1, 2].map((k) => P.lerp(LAWN[k], DRY[k], dry) * bright);
  }
  /**
   * Subdivided ground over [x0,x1]×[z0,z1] (m) with vertex colours; vertices crowd near the lot (quadratic spacing)
   * so the variation is fine where the camera looks and cheap towards the horizon.
   */
  function groundGrid(x0, x1, z0, z1, y, lotM, material) {
    const T = S.THREE;
    const axis = (a0, a1, centre, n) => {
      const out = [];
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * 2 - 1;
        const v = Math.sign(u) * u * u;
        out.push(v < 0 ? centre + v * (centre - a0) : centre + v * (a1 - centre));
      }
      return out;
    };
    const xs = axis(x0, x1, P.clamp(lotM.w / 2, x0, x1), 110), zs = axis(z0, z1, P.clamp(lotM.h / 2, z0, z1), 110);
    const pos = [], uv = [], col = [], idx = [];
    zs.forEach((z) =>
      xs.forEach((x) => {
        pos.push(x, y, z);
        uv.push(x, -z);
        const c = groundTint(x, z, lotM);
        col.push(c[0], c[1], c[2]);
      })
    );
    const nx = xs.length;
    for (let j = 0; j + 1 < zs.length; j++)
      for (let i = 0; i + 1 < nx; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = mesh(geo, material, { cast: false });
    m.userData.ground = true;
    return m;
  }
  /** Lawn: the catalogue grass, desaturated (the raw texture reads lime under the ACES sun) and tinted per vertex. */
  function lawnMaterial() {
    return cached(S.res.mats, 'site|lawn', () => {
      const T = S.THREE;
      let src = null;
      try {
        src = DD.materials && DD.materials.canvas ? DD.materials.canvas('grama') : null;
      } catch (e) {
        console.warn('[view3d] grass texture failed', e);
      }
      const tex = src ? desaturatedTexture(src) : null;
      const m = new T.MeshStandardMaterial({ map: tex, color: tex ? '#FFFFFF' : '#6E8250', vertexColors: true, roughness: 0.97, metalness: 0 });
      m.name = 'v3d:lawn';
      return m;
    });
  }
  function desaturatedTexture(src) {
    const T = S.THREE;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    // mean colour of the tile: pulling every texel towards it removes the tile-sized features that make the
    // repetition visible from the aerial view; the large-scale variation comes from the ground's vertex tint
    const mean = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) mean[k] += d[i + k];
    const n = d.length / 4;
    for (let k = 0; k < 3; k++) mean[k] /= n;
    const LOCAL_CONTRAST = 0.5;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) d[i + k] = mean[k] + (d[i + k] - mean[k]) * LOCAL_CONTRAST;
      const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      d[i] = P.clamp(P.lerp(l, d[i], 0.52) * 1.02 + 6, 0, 255);
      d[i + 1] = P.clamp(P.lerp(l, d[i + 1], 0.52) + 3, 0, 255);
      d[i + 2] = P.clamp(P.lerp(l, d[i + 2], 0.52) * 0.96, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
    const tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    const rep = 1000 / 2300; // larger tile than the plan swatch: less visible repetition
    tex.repeat.set(rep, rep);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = S.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }
  function buildGround(g, lot) {
    const grass = lawnMaterial();
    const lotM = { w: lot.w * MM, h: lot.h * MM };
    const front = lotM.h, far = front + 2 * SIDEWALK + STREET;
    g.add(groundGrid(-WORLD_HALF, WORLD_HALF, -WORLD_HALF, front, GROUND_Y, lotM, grass));
    g.add(groundGrid(-WORLD_HALF, WORLD_HALF, far, WORLD_HALF, GROUND_Y, lotM, grass));
  }
  /** Surfaces drawn under the plan on the Térreo (paving, driveway). Grass zones are the ground itself. */
  function buildZones(g, site) {
    (site.zones || []).forEach((z) => {
      if (z.kind === 'grass') return;
      const id = ZONE_MATERIAL[z.kind] || 'calcada';
      const mat = siteMaterial(id, '#A9A298', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      g.add(groundPlane(z.x * MM, (z.x + z.w) * MM, z.y * MM, (z.y + z.h) * MM, ZONE_Y, mat));
    });
  }
  /**
   * Understated context: small single-storey neighbour houses with gable roofs in a pale clay tone (distinct from
   * the warm-white house, much lower than it, set back from the shared muros) and thin lot lines.
   */
  function buildNeighbours(g, lot) {
    const W = lot.w * MM, H = lot.h * MM;
    const across = H + 2 * SIDEWALK + STREET;
    // x0/x1: fraction of the lot width; z0/z1: metres; e: eave height; r: ridge rise; ridge along z unless rx
    const houses = [
      { lot: -1, x0: 0.2, x1: 0.72, z0: 5.5, z1: 12.5, e: 2.7, r: 1.3 },
      { lot: -2, x0: 0.24, x1: 0.78, z0: 6.5, z1: 13, e: 2.6, r: 1.2 },
      { lot: 1, x0: 0.28, x1: 0.8, z0: 5, z1: 12, e: 2.8, r: 1.35 },
      { lot: 2, x0: 0.2, x1: 0.74, z0: 6, z1: 12.5, e: 2.6, r: 1.25 },
    ].map((h) => ({ x0: (h.lot + h.x0) * W, x1: (h.lot + h.x1) * W, z0: h.z0, z1: h.z1, e: h.e, r: h.r, rx: false }));
    [-1, 0, 1, 2].forEach((k, i) => {
      const z0 = across + 5 + (i % 2), dz = 6.5 + (i % 3) * 0.6;
      houses.push({ x0: k * W + 1.7, x1: (k + 1) * W - 1.7, z0, z1: z0 + dz, e: 2.6 + (i % 2) * 0.2, r: 1.2, rx: true });
    });
    const bodies = houses.map((h) => ({ x0: h.x0, x1: h.x1, y0: 0, y1: h.e, z0: h.z0, z1: h.z1, noBottom: true }));
    g.add(mesh(boxesGeometry(bodies), [MAT.neighbour()], { cast: false, receive: true }));
    const roofs = gableRoofs(houses);
    g.add(mesh(roofs.roof, MAT.neighbourRoof(), { cast: false, receive: true }));
    g.add(mesh(roofs.gables, MAT.neighbour(), { cast: false, receive: true }));
    const lines = [];
    for (let k = -2; k <= 3; k++) if (k !== 0 && k !== 1) lines.push({ x0: k * W - 0.05, x1: k * W + 0.05, y0: GROUND_Y, y1: 0.35, z0: 0, z1: H });
    lines.push({ x0: -2 * W, x1: 0, y0: GROUND_Y, y1: 0.35, z0: -0.05, z1: 0.05 }, { x0: W, x1: 3 * W, y0: GROUND_Y, y1: 0.35, z0: -0.05, z1: 0.05 });
    g.add(mesh(boxesGeometry(lines), [MAT.muro()], { cast: false }));
  }
  /** Gable roofs (0,35 m overhang) over massing boxes → { roof, gables } flat-shaded geometries. */
  function gableRoofs(houses) {
    const T = S.THREE;
    const roof = [], gables = [];
    const tri = (arr, a, b, c, out) => {
      // wind so that the face normal points along `out`
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const pts = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0 ? [a, b, c] : [a, c, b];
      pts.forEach((p) => arr.push(p[0], p[1], p[2]));
    };
    const quad = (arr, a, b, c, d, out) => {
      tri(arr, a, b, c, out);
      tri(arr, a, c, d, out);
    };
    houses.forEach((h) => {
      const oh = 0.35;
      // local frame: "a" = the axis the roof slopes along, "l" = the ridge axis
      const map = h.rx ? (a, y, l) => [l, y, a] : (a, y, l) => [a, y, l];
      const a0 = h.rx ? h.z0 : h.x0, a1 = h.rx ? h.z1 : h.x1, l0 = h.rx ? h.x0 : h.z0, l1 = h.rx ? h.x1 : h.z1;
      const am = (a0 + a1) / 2, top = h.e + h.r, s = h.r / (am - a0);
      const eave = h.e - oh * s;
      const outA = (sg) => (h.rx ? [0, 1, sg] : [sg, 1, 0]);
      quad(roof, map(a0 - oh, eave, l0 - oh), map(am, top, l0 - oh), map(am, top, l1 + oh), map(a0 - oh, eave, l1 + oh), outA(-1));
      quad(roof, map(a1 + oh, eave, l0 - oh), map(am, top, l0 - oh), map(am, top, l1 + oh), map(a1 + oh, eave, l1 + oh), outA(1));
      [[l0, -1], [l1, 1]].forEach((e) => tri(gables, map(a0, h.e, e[0]), map(a1, h.e, e[0]), map(am, top, e[0]), h.rx ? [e[1], 0, 0] : [0, 0, e[1]]));
    });
    const geo = (arr) => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      return g;
    };
    return { roof: geo(roof), gables: geo(gables) };
  }
  function buildTrees(g, lot) {
    const T = S.THREE;
    const z = lot.h * MM + SIDEWALK * 0.55;
    [-5, -14, 24, 33].forEach((x, i) => {
      const s = 0.85 + (i % 3) * 0.15;
      const trunk = mesh(sharedGeo('trunk', () => new T.CylinderGeometry(0.08, 0.12, 1, 7)), MAT.trunk());
      trunk.scale.set(s, 2.6 * s, s);
      trunk.position.set(x, 1.3 * s, z);
      const crown = mesh(sharedGeo('crown', () => new T.IcosahedronGeometry(1, 1)), MAT.leaves());
      crown.scale.set(1.5 * s, 1.25 * s, 1.5 * s);
      crown.position.set(x, 3.2 * s, z);
      g.add(trunk, crown);
    });
  }
  function buildSite(doc) {
    const site = doc.site || { lot: { w: 9000, h: 20000 }, zones: [] };
    const lot = site.lot || { w: 9000, h: 20000 };
    const g = new S.THREE.Group();
    g.name = 'site';
    buildGround(g, lot);
    buildStreet(g, lot);
    buildZones(g, site);
    buildNeighbours(g, lot);
    buildTrees(g, lot);
    tagTree(g, { noPick: true, ground: true });
    return g;
  }

  /** Vertical gradient sky dome (not affected by fog). */
  function buildSky() {
    const T = S.THREE;
    const mat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new T.Color(COLORS.sky) },
        horizon: { value: new T.Color(COLORS.horizon) },
        bottom: { value: new T.Color(COLORS.horizon) }, // below the horizon = the fog colour
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;' +
        'void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.65, h), 0.8)) : mix(horizon, bottom, smoothstep(0.0, 0.08, -h));' +
        ' gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
    });
    const sky = new T.Mesh(new T.SphereGeometry(450, 32, 16), mat);
    sky.name = 'sky';
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.userData.noPick = true;
    return sky;
  }

  // ================================================================== scene graph sync (diffed against the store)
  const sameList = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

  function ensureFloorGroups(doc) {
    const T = S.THREE;
    const ids = new Set(doc.floors.map((f) => f.id));
    S.floors.forEach((fg, id) => {
      if (ids.has(id)) return;
      forgetIndex(fg.arch);
      disposeTree(fg.root);
      S.floors.delete(id);
    });
    doc.floors.forEach((f) => {
      if (S.floors.has(f.id)) return;
      const root = new T.Group();
      root.name = 'floor:' + f.id;
      const furn = new T.Group();
      furn.name = 'furniture:' + f.id;
      root.add(furn);
      S.world.add(root);
      S.floors.set(f.id, { root, arch: null, roof: null, furn, sig: null, shown: true, anim: null });
    });
  }
  /** Identity list of everything the architecture of a floor is built from. */
  function archSignature(doc, floor, index) {
    const below = index > 0 ? doc.floors[index - 1].id : null;
    const walls = doc.walls.filter((w) => w.floor === floor.id);
    const wallIds = new Set(walls.map((w) => w.id));
    return [floor, index === doc.floors.length - 1, contKey(doc, floor.id, null)]
      .concat(walls)
      .concat(doc.openings.filter((o) => wallIds.has(o.wall)))
      .concat(doc.roomSeeds.filter((s) => s.floor === floor.id))
      .concat((doc.separators || []).filter((s) => s.floor === floor.id))
      .concat(doc.stairs.filter((s) => s.floor === floor.id || s.floor === below));
  }
  /** Value key of the window continuations touching a floor (or one wall): they tie two floors together. */
  function contKey(doc, floorId, wallId) {
    return P.windowContinuations(doc)
      .filter((c) => (wallId ? c.lowerWall === wallId || c.upperWall === wallId : c.floor === floorId || c.lowerFloor === floorId))
      .map((c) => [c.opId, c.upperWall, Math.round(c.t), Math.round(c.width), Math.round(c.height)].join(':'))
      .join('|');
  }
  /** Identity list of one wall's 3D inputs (wall, its openings, continuations). */
  function wallSignature(doc, w) {
    return [w, contKey(doc, null, w.id)].concat(doc.openings.filter((o) => o.wall === w.id));
  }
  function forgetIndex(arch) {
    if (!arch) return;
    arch.traverse((o) => {
      const u = o.userData;
      if (u.wallId && S.index.walls.get(u.wallId) === o) S.index.walls.delete(u.wallId);
      if (u.openingId && S.index.openings.get(u.openingId) === o) S.index.openings.delete(u.openingId);
      if (u.openingId && S.index.openingParts.get(u.openingId) === o) S.index.openingParts.delete(u.openingId);
      if (u.roomId && S.index.rooms.get(u.roomId) === o) S.index.rooms.delete(u.roomId);
    });
  }
  /**
   * Rebuild one floor's architecture if its inputs changed. → true when something was rebuilt.
   * `transient` (a drag preview inside a gesture): only the walls that changed are rebuilt, and the room floors /
   * slab / roof at most every SURF_THROTTLE_MS; the full rebuild happens when the gesture ends (or is cancelled).
   */
  const SURF_THROTTLE_MS = 140;
  function syncFloor(doc, floor, index, transient) {
    const fg = S.floors.get(floor.id);
    const sig = archSignature(doc, floor, index);
    if (fg.arch && !fg.partial && sameList(sig, fg.sig)) return false;
    if (transient && fg.arch && fg.walls && sameList(stairsOf(doc, floor, index), fg.stairs)) return patchFloor(doc, floor, index, fg);
    forgetIndex(fg.arch);
    disposeTree(fg.arch);
    disposeTree(fg.roof);
    fg.arch = buildFloorArch(doc, floor, index);
    fg.root.add(fg.arch);
    fg.roof = index === doc.floors.length - 1 ? buildRoof(doc, floor) : null;
    if (fg.roof) fg.root.add(fg.roof);
    fg.sig = sig;
    fg.partial = false;
    fg.surfSig = surfacesSignature(doc, floor);
    fg.surfAt = performance.now();
    fg.stairs = stairsOf(doc, floor, index);
    fg.walls = new Map(doc.walls.filter((w) => w.floor === floor.id).map((w) => [w.id, wallSignature(doc, w)]));
    return true;
  }
  function stairsOf(doc, floor, index) {
    const below = index > 0 ? doc.floors[index - 1].id : null;
    return doc.stairs.filter((s) => s.floor === floor.id || s.floor === below);
  }
  function surfacesSignature(doc, floor) {
    return [doc.walls, doc.roomSeeds, doc.separators, contKey(doc, floor.id, null)];
  }
  /** Cheap per-frame update during a drag: changed walls now, room floors / slab / roof throttled. */
  function patchFloor(doc, floor, index, fg) {
    const arch = fg.arch;
    let changed = false;
    const seen = new Set();
    doc.walls.forEach((w) => {
      if (w.floor !== floor.id) return;
      seen.add(w.id);
      const sig = wallSignature(doc, w);
      if (sameList(sig, fg.walls.get(w.id))) return;
      const old = S.index.walls.get(w.id);
      if (old) {
        forgetIndex(old);
        disposeTree(old);
      }
      addWallGroup(arch, doc, w, floor);
      fg.walls.set(w.id, sig);
      changed = true;
    });
    Array.from(fg.walls.keys()).forEach((id) => {
      if (seen.has(id)) return;
      const old = S.index.walls.get(id);
      if (old) {
        forgetIndex(old);
        disposeTree(old);
      }
      fg.walls.delete(id);
      changed = true;
    });
    const surfSig = surfacesSignature(doc, floor);
    if (!sameList(surfSig, fg.surfSig)) {
      const now = performance.now();
      if (now - fg.surfAt >= SURF_THROTTLE_MS) {
        forgetIndex(arch.userData.surfaces);
        disposeTree(arch.userData.surfaces);
        arch.userData.surfaces = buildFloorSurfaces(doc, floor, index);
        arch.add(arch.userData.surfaces);
        if (fg.roof) {
          disposeTree(fg.roof);
          fg.roof = buildRoof(doc, floor);
          if (fg.roof) fg.root.add(fg.roof);
        }
        fg.surfSig = surfSig;
        fg.surfAt = now;
        changed = true;
      } else S.surfDue = Math.max(S.surfDue || 0, fg.surfAt + SURF_THROTTLE_MS);
    }
    fg.partial = true;
    return changed;
  }

  // ------------------------------------------------------------------ furniture (cached per id)
  const furnitureKey = (it) => [it.type, it.w, it.d, it.h, it.color || ''].join('|');

  function fallbackFurniture(it) {
    const T = S.THREE;
    const h = Math.max(10, it.h || 400) * MM;
    const geo = new T.BoxGeometry(Math.max(10, it.w) * MM, h, Math.max(10, it.d) * MM);
    geo.translate(0, h / 2, 0);
    const g = new T.Group();
    g.add(mesh(geo, stdMat(it.color || '#B8AE9E', { roughness: 0.7 })));
    return g;
  }
  function buildFurnitureObject(it) {
    let obj = null;
    try {
      if (DD.furniture3d && typeof DD.furniture3d.build === 'function') obj = DD.furniture3d.build(S.THREE, it);
    } catch (e) {
      console.warn('[view3d] furniture model failed, using a box', it.type, e);
    }
    if (!obj || !obj.isObject3D) obj = fallbackFurniture(it);
    const flat = isFlatType(it.type);
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !flat;
        o.receiveShadow = true;
      }
      o.userData.furnitureId = it.id;
    });
    obj.name = 'furniture:' + it.id;
    return obj;
  }
  function placeFurniture(obj, it, levelMM) {
    obj.position.set(it.x * MM, (levelMM + (it.elev || 0)) * MM, it.y * MM);
    obj.rotation.set(0, -(it.rot || 0) * DEG, 0);
  }
  function removeFurniture(id) {
    const rec = S.furniture.get(id);
    if (!rec) return;
    if (S.outline && S.outline.obj === rec.obj) removeOutline();
    disposeTree(rec.obj);
    S.furniture.delete(id);
  }
  /** Diff doc.furniture: rebuild only when type/size/colour change, otherwise update the transform. → changed? */
  function syncFurniture(doc) {
    const levels = floorLevels(doc);
    const seen = new Set();
    let rebuilt = false;
    doc.furniture.forEach((it) => {
      seen.add(it.id);
      const fg = S.floors.get(it.floor), lv = levels.get(it.floor);
      if (!fg || !lv) return;
      let rec = S.furniture.get(it.id);
      if (rec && rec.item === it && rec.level === lv.level && rec.obj.parent === fg.furn) return;
      const key = furnitureKey(it);
      if (!rec || rec.key !== key) {
        if (rec) removeFurniture(it.id);
        rec = { obj: buildFurnitureObject(it), key, item: it, level: lv.level };
        S.furniture.set(it.id, rec);
        rebuilt = true;
      }
      S.furniture.set(it.id, Object.assign({}, rec, { item: it, level: lv.level }));
      placeFurniture(rec.obj, it, lv.level);
      if (rec.obj.parent !== fg.furn) fg.furn.add(rec.obj);
    });
    Array.from(S.furniture.keys()).forEach((id) => {
      if (!seen.has(id)) {
        removeFurniture(id);
        rebuilt = true;
      }
    });
    return rebuilt;
  }

  // ------------------------------------------------------------------ floor visibility (slide + toggle)
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isWalking = () => !!S.walk && S.walk.enabled;

  /** Upper floors and the roof are shown (walk mode / 'Pavimentos superiores'), except in the transition cutaway. */
  const showsUpper = (ui) => !S.cutaway && (isWalking() || !!ui.showAllFloors);
  function floorShouldShow(doc, ui, idx) {
    if (showsUpper(ui)) return true;
    const active = doc.floors.findIndex((f) => f.id === ui.floor);
    return idx <= Math.max(0, active);
  }
  function updateVisibility(animate) {
    const doc = docNow(), ui = uiNow();
    const showFurniture = !ui.show || ui.show.furniture !== false;
    doc.floors.forEach((f, i) => {
      const fg = S.floors.get(f.id);
      if (!fg) return;
      const show = floorShouldShow(doc, ui, i);
      if (show !== fg.shown) startFloorAnim(fg, show, animate);
      fg.furn.visible = showFurniture;
      if (fg.roof) fg.roof.visible = showsUpper(ui);
    });
    requestRender();
  }
  /**
   * Cutaway for 2D↔3D transitions: the camera is top-down on the ACTIVE floor, so the floors above it and the
   * roof are hidden (instantly) while it is on; turning it off lets them slide back in.
   */
  function setCutaway(on, animate) {
    if (S.cutaway === !!on) return;
    S.cutaway = !!on;
    updateVisibility(!!animate);
  }
  function startFloorAnim(fg, show, animate) {
    fg.shown = show;
    if (!animate || reducedMotion()) {
      fg.anim = null;
      fg.root.visible = show;
      fg.root.position.y = 0;
      return;
    }
    const from = fg.root.visible ? fg.root.position.y : FLOOR_ANIM_LIFT;
    fg.root.visible = true;
    fg.anim = { from, to: show ? 0 : FLOOR_ANIM_LIFT, t0: performance.now(), show };
  }
  function stepFloorAnims(now) {
    let busy = false;
    S.floors.forEach((fg) => {
      const a = fg.anim;
      if (!a) return;
      busy = true;
      const t = P.clamp((now - a.t0) / FLOOR_ANIM_MS, 0, 1);
      fg.root.position.y = P.lerp(a.from, a.to, P.easeInOutCubic(t));
      if (t < 1) return;
      fg.anim = null;
      fg.root.visible = a.show;
      fg.root.position.y = 0;
    });
    return busy;
  }

  // ------------------------------------------------------------------ selection / hover highlight
  /** Scene objects that represent a selection ref (a window continuing on the floor above has two parts). */
  function objectsFor(ref) {
    if (!ref) return [];
    let list = [];
    if (ref.kind === 'furniture') {
      const rec = S.furniture.get(ref.id);
      list = [rec && rec.obj];
    } else if (ref.kind === 'wall') list = [S.index.walls.get(ref.id)];
    else if (ref.kind === 'opening') list = [S.index.openings.get(ref.id), S.index.openingParts.get(ref.id)];
    else if (ref.kind === 'room') list = [S.index.rooms.get(ref.id)];
    return list.filter(Boolean);
  }
  function clearHighlights() {
    for (let i = S.highlighted.length - 1; i >= 0; i--) S.highlighted[i].mesh.material = S.highlighted[i].material;
    S.highlighted = [];
    removeOutline();
  }
  function tintObject(obj, level) {
    obj.traverse((o) => {
      if (!o.isMesh || !o.material || o.userData.noTint) return;
      S.highlighted.push({ mesh: o, material: o.material });
      o.material = tinted(o.material, level);
    });
  }
  function outlineMaterial() {
    return cached(S.res.mats, 'outline', () => new S.THREE.LineBasicMaterial({ color: COLORS.coral, transparent: true, opacity: 0.95, depthTest: false }));
  }
  function addOutline(id) {
    const rec = S.furniture.get(id);
    if (!rec) return;
    const T = S.THREE, it = rec.item, pad = 0.03;
    const h = Math.max(10, it.h || 10) * MM;
    const box = new T.BoxGeometry(it.w * MM + pad, h + pad, it.d * MM + pad);
    const line = new T.LineSegments(new T.EdgesGeometry(box), outlineMaterial());
    box.dispose();
    line.position.y = h / 2;
    line.renderOrder = 10;
    line.userData.noPick = true;
    rec.obj.add(line);
    S.outline = { line, obj: rec.obj };
  }
  function removeOutline() {
    if (!S.outline) return;
    S.outline.obj.remove(S.outline.line);
    S.outline.line.geometry.dispose();
    S.outline = null;
  }
  const sameRef = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;
  function applyHighlights() {
    clearHighlights();
    const ui = uiNow();
    const sel = ui.selection, hov = S.drag ? null : ui.hover;
    if (hov && !sameRef(hov, sel)) objectsFor(hov).forEach((o) => tintObject(o, 'hov'));
    if (sel) {
      objectsFor(sel).forEach((o) => tintObject(o, 'sel'));
      if (sel.kind === 'furniture') addOutline(sel.id);
    }
    requestRender();
  }

  // ------------------------------------------------------------------ rebuild pass (once per frame, if dirty)
  function flushRebuild() {
    const doc = docNow();
    if (S.surfDue && performance.now() >= S.surfDue) {
      // throttled room-floor / slab refresh of a drag that paused between previews
      S.surfDue = 0;
      S.floors.forEach((fg, id) => {
        if (fg.partial) S.dirty.floors.add(id);
      });
      S.dirty.transient = !!(store() && store().inGesture());
    }
    const d = S.dirty;
    if (!d.site && !d.floors.size && !d.furniture && !d.visibility && !d.highlight) return;
    let changed = false;
    if (d.site) {
      disposeTree(S.site);
      S.site = buildSite(doc);
      S.world.add(S.site);
      fitSunToLot(doc);
      changed = true;
    }
    if (d.floors.size) {
      clearHighlights();
      ensureFloorGroups(doc);
      doc.floors.forEach((f, i) => {
        if (d.floors.has(f.id) && syncFloor(doc, f, i, !!d.transient)) changed = true;
      });
    }
    if (d.furniture && syncFurniture(doc)) changed = true;
    if (changed || d.floors.size || d.furniture) S.dirty.colliders = true;
    const vis = d.visibility || d.floors.size > 0;
    S.dirty = { floors: new Set(), furniture: false, site: false, visibility: false, highlight: false, transient: false, colliders: S.dirty.colliders };
    if (vis) updateVisibility(true);
    applyHighlights();
    requestRender();
  }

  // ================================================================== renderer, scene, lights
  // Summer late-afternoon sun from the street-left side, so the facade reads in the default aerial view.
  const SUN_DIR = { x: -0.55, y: 0.95, z: 0.5 };
  const LIGHT = { sun: 2.9, hemi: 1.15, hemiWalk: 1.5, ambient: 0.18, ambientWalk: 0.7 };
  // Hemisphere ground (bounce) colour: light warm grey, so downward faces (ceilings, soffits) read as plaster,
  // a touch brighter indoors where the bounce comes from pale floors and walls.
  const BOUNCE = { orbit: '#CFC6B6', walk: '#E6DED0' };

  function createRenderer() {
    const T = S.THREE;
    const r = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = T.SRGBColorSpace;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = T.PCFSoftShadowMap;
    r.domElement.className = 'v3d-canvas';
    r.domElement.setAttribute('aria-label', 'Vista 3D da casa');
    r.domElement.tabIndex = 0;
    return r;
  }
  function createLights(scene) {
    const T = S.THREE;
    S.hemi = new T.HemisphereLight('#DCEBF7', BOUNCE.orbit, LIGHT.hemi);
    S.ambient = new T.AmbientLight('#FFF4E6', LIGHT.ambient);
    const sun = new T.DirectionalLight('#FFE3C2', LIGHT.sun);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    scene.add(S.hemi, S.ambient, sun, sun.target);
    S.sun = sun;
  }
  /** Aim the sun at the lot and fit its orthographic shadow camera around it. */
  function fitSunToLot(doc) {
    const lot = (doc.site && doc.site.lot) || { w: 9000, h: 20000 };
    const cx = (lot.w * MM) / 2, cz = (lot.h * MM) / 2;
    const d = new S.THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();
    S.sun.target.position.set(cx, 3, cz);
    S.sun.position.set(cx + d.x * 45, 3 + d.y * 45, cz + d.z * 45);
    const R = (Math.hypot(lot.w, lot.h) * MM) / 2 + 5;
    const cam = S.sun.shadow.camera;
    cam.left = -R;
    cam.right = R;
    cam.top = R;
    cam.bottom = -R;
    cam.near = 5;
    cam.far = 100;
    cam.updateProjectionMatrix();
  }
  function createScene() {
    const T = S.THREE;
    const scene = new T.Scene();
    scene.fog = new T.Fog(COLORS.horizon, FOG.near, FOG.far);
    S.sky = buildSky();
    scene.add(S.sky);
    S.world = new T.Group();
    S.world.name = 'world';
    scene.add(S.world);
    createLights(scene);
    return scene;
  }
  function createOrbit() {
    const c = new S.OrbitControls(S.camera, S.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.085;
    c.minDistance = 2.5;
    c.maxDistance = 95;
    c.maxPolarAngle = 86 * DEG;
    c.screenSpacePanning = false;
    c.zoomToCursor = true;
    c.addEventListener('change', requestRender);
    c.addEventListener('start', () => {
      S.atHome = false; // the user took the camera: stop re-fitting it automatically
    });
    return c;
  }

  // ================================================================== camera poses & transitions
  const TWEEN_GRACE_MS = 250;
  const V = (o) => new S.THREE.Vector3(o.x, o.y, o.z);
  function floorOf(doc, id) {
    return doc.floors.find((f) => f.id === id) || doc.floors[0];
  }
  function applyPose(pose) {
    S.camera.position.copy(V(pose.pos));
    S.camera.up.copy(V(pose.up)).normalize();
    S.camera.lookAt(V(pose.target));
    requestRender();
  }
  function currentPose() {
    const c = S.camera;
    const dir = c.getWorldDirection(new S.THREE.Vector3());
    const target = isWalking() || !S.orbit ? c.position.clone().add(dir) : S.orbit.target.clone();
    return { pos: c.position.clone(), target, up: c.up.clone() };
  }
  function homePose() {
    return isWalking() ? walkPose() : aerialHome();
  }
  /** Put orbit controls back in charge of a (non top-down) pose. */
  function settleOrbit(target) {
    S.camera.up.set(0, 1, 0);
    if (!S.orbit) return;
    if (target) S.orbit.target.copy(V(target));
    S.orbit.enabled = !isWalking() && !S.tween;
    if (!isWalking()) S.orbit.update();
  }
  function cancelTween() {
    const tw = S.tween;
    if (!tw) return;
    S.tween = null;
    clearTimeout(tw.timer);
    if (tw.done) tw.done(false);
  }
  /**
   * Ease position/target (easeInOutCubic) and nlerp the up vector; controls are disabled meanwhile.
   * opts: { keepUp, done(ok), home (ends on the automatic framing), path: null | 'descend' | 'ascend' }.
   * The clock advances at most TWEEN_MAX_STEP_MS per frame, so a stalled frame (e.g. first-time GPU uploads)
   * slows the move down instead of making the camera jump.
   */
  const TWEEN_MAX_STEP_MS = 34;
  function tweenCamera(from, to, ms, opts) {
    cancelTween();
    const o = opts || {};
    const dur = reducedMotion() ? 1 : Math.max(1, ms);
    const tw = { from: toPlain(from), to: toPlain(to), ms: dur, elapsed: 0, last: null, keepUp: !!o.keepUp, home: !!o.home, path: o.path || null, done: o.done || null, timer: 0 };
    armTweenTimer(tw, dur + TWEEN_GRACE_MS);
    S.tween = tw;
    S.atHome = false;
    if (S.orbit) S.orbit.enabled = false;
    requestRender();
  }
  /** Safety net: animation frames are paused in hidden tabs — never leave a transition Promise pending. */
  function armTweenTimer(tw, ms) {
    clearTimeout(tw.timer);
    tw.timer = setTimeout(() => {
      if (S.tween !== tw) return;
      if (tw.last != null && performance.now() - tw.last < 200) {
        armTweenTimer(tw, Math.max(50, tw.ms - tw.elapsed + TWEEN_GRACE_MS)); // frames still running, just slow
        return;
      }
      stepTween(0, true);
      if (S.ready) render();
    }, ms);
  }
  const toPlain = (p) => ({ pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, target: { x: p.target.x, y: p.target.y, z: p.target.z }, up: { x: p.up.x, y: p.up.y, z: p.up.z } });
  const lerp3 = (a, b, t) => ({ x: P.lerp(a.x, b.x, t), y: P.lerp(a.y, b.y, t), z: P.lerp(a.z, b.z, t) });
  /** Separate horizontal / vertical easing: 'descend' glides above first then drops in; 'ascend' is the reverse. */
  function pathEasing(path, t) {
    const E = P.easeInOutCubic;
    if (path === 'descend') return { h: E(P.clamp(t / 0.6, 0, 1)), v: E(P.clamp((t - 0.3) / 0.7, 0, 1)) };
    if (path === 'ascend') return { h: E(P.clamp((t - 0.35) / 0.65, 0, 1)), v: E(P.clamp(t / 0.7, 0, 1)) };
    const e = E(t);
    return { h: e, v: e };
  }
  const lerpHV = (a, b, e) => ({ x: P.lerp(a.x, b.x, e.h), y: P.lerp(a.y, b.y, e.v), z: P.lerp(a.z, b.z, e.h) });
  function stepTween(now, force) {
    const tw = S.tween;
    if (!tw) return false;
    if (force) tw.elapsed = tw.ms;
    else {
      if (tw.last != null) tw.elapsed += P.clamp(now - tw.last, 0, TWEEN_MAX_STEP_MS);
      tw.last = now;
    }
    const t = P.clamp(tw.elapsed / tw.ms, 0, 1);
    const e = pathEasing(tw.path, t);
    const up = lerp3(tw.from.up, tw.to.up, e.v);
    const len = Math.hypot(up.x, up.y, up.z);
    applyPose({ pos: lerpHV(tw.from.pos, tw.to.pos, e), target: lerpHV(tw.from.target, tw.to.target, e), up: len > 1e-3 ? up : tw.to.up });
    if (t < 1) return true;
    S.tween = null;
    clearTimeout(tw.timer);
    if (!tw.keepUp) finishPose(tw.to);
    S.atHome = tw.home && !isWalking();
    if (tw.done) tw.done(true);
    return true;
  }
  function finishPose(pose) {
    if (isWalking()) syncWalkerCamera();
    else settleOrbit(pose.target);
  }

  /**
   * 2D → 3D: start top-down exactly on the active floor as drawn in 2D (floors above and the roof hidden), ease to
   * the home pose, then let the upper floors slide back in. Walk mode: glide above the walker, then descend
   * vertically into the (open-topped) room so the camera never passes through a slab.
   */
  function transitionFrom2D(vp, ms) {
    if (!S.ready) return Promise.resolve(false);
    resize();
    const doc = docNow();
    const floor = floorOf(doc, uiNow().floor);
    const start = P.topDownPose(vp, floor.level, S.camera.fov);
    if (!start) {
      jumpHome();
      return Promise.resolve(false);
    }
    cancelTween(); // (a pending 3D→2D tween marks pendingAerial when cancelled: clear it after)
    S.pendingAerial = false;
    setCutaway(true, false);
    flushRebuild();
    applyPose(start);
    const walking = isWalking();
    const home = homePose();
    return new Promise((resolve) =>
      tweenCamera(start, home, ms == null ? 1100 : ms, {
        path: walking ? 'descend' : null,
        home: !walking,
        done: (ok) => {
          setCutaway(false, !walking);
          resolve(ok);
        },
      })
    );
  }
  /** 3D → 2D: hide the floors above (they slide away), then ease to top-down on the active floor (walk: rise first). */
  function transitionTo2D(vp, ms) {
    if (!S.ready) return Promise.resolve(false);
    exitPointerLock();
    const floor = floorOf(docNow(), uiNow().floor);
    const end = P.topDownPose(vp, floor.level, S.camera.fov);
    if (!end) return Promise.resolve(false);
    const walking = isWalking();
    setCutaway(true, !walking);
    return new Promise((resolve) =>
      tweenCamera(currentPose(), end, ms == null ? 900 : ms, {
        keepUp: true,
        path: walking ? 'ascend' : null,
        done: (ok) => {
          S.pendingAerial = true; // the next time the 3D view shows without a transition, start from home
          resolve(ok);
        },
      })
    );
  }
  /** Home pose of the current mode, framed for the current viewport aspect. */
  function aerialHome(floorId) {
    return P.aerialPose(docNow(), floorId || uiNow().floor, { aspect: S.camera.aspect, fov: FOV_ORBIT, allFloors: !!uiNow().showAllFloors });
  }
  /** Instant reset to the home pose of the current mode. */
  function jumpHome() {
    cancelTween();
    S.pendingAerial = false;
    setCutaway(false, false);
    const pose = homePose();
    applyPose(pose);
    finishPose(pose);
    S.atHome = !isWalking();
  }
  /** Smoothly bring the camera back to the active floor (orbit) or respawn (walk). */
  function recenter() {
    if (!S.ready) return;
    if (isWalking()) {
      spawnWalker(uiNow().floor);
      return;
    }
    tweenCamera(currentPose(), aerialHome(), 650, { home: true });
  }
  /**
   * Orbit mode: when the active floor changes, re-frame the new floor if the camera was on its automatic framing,
   * otherwise glide the target to the new floor keeping the user's view angle and distance.
   */
  function glideToFloor(floorId) {
    if (!S.orbit || S.tween || S.pendingAerial) return;
    const cur = currentPose();
    const home = aerialHome(floorId);
    if (S.atHome) {
      tweenCamera(cur, home, 560, { home: true });
      return;
    }
    const next = home.target;
    const dx = next.x - cur.target.x, dy = next.y - cur.target.y, dz = next.z - cur.target.z;
    const to = { pos: { x: cur.pos.x + dx, y: cur.pos.y + dy, z: cur.pos.z + dz }, target: next, up: { x: 0, y: 1, z: 0 } };
    tweenCamera(cur, to, 520, {});
  }
  /** After a layout change (split view, window resize): keep the automatic framing fitted to the new aspect. */
  function refitHome() {
    if (!S.ready || isWalking() || S.pendingAerial) return;
    const tw = S.tween;
    if (tw && tw.home) {
      tw.to = toPlain(aerialHome());
      return;
    }
    if (!tw && S.atHome) {
      const pose = aerialHome();
      applyPose(pose);
      settleOrbit(pose.target);
    }
  }
  /** Keep the orbit camera above the ground and the target near the lot. */
  function constrainOrbit() {
    if (!S.orbit || isWalking() || S.tween) return;
    const lot = (docNow().site && docNow().site.lot) || { w: 9000, h: 20000 };
    const t = S.orbit.target;
    const cx = P.clamp(t.x, -15, lot.w * MM + 15), cz = P.clamp(t.z, -15, lot.h * MM + 25), cy = P.clamp(t.y, 0, 14);
    if (cx !== t.x || cy !== t.y || cz !== t.z) {
      const dx = cx - t.x, dy = cy - t.y, dz = cz - t.z;
      t.set(cx, cy, cz);
      S.camera.position.x += dx;
      S.camera.position.y += dy;
      S.camera.position.z += dz;
    }
    if (S.camera.position.y < 0.35) S.camera.position.y = 0.35;
  }

  function resize() {
    if (!S.ready || !S.container) return;
    const w = S.container.clientWidth, h = S.container.clientHeight;
    if (w < 2 || h < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (S.size && S.size.w === w && S.size.h === h && S.size.dpr === dpr) return;
    S.size = { w, h, dpr };
    S.renderer.setPixelRatio(dpr);
    S.renderer.setSize(w, h, false);
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    refitHome();
    requestRender();
  }

  // ================================================================== walk mode (first person)
  const MOVE_KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
  const WALK_PITCH = -4 * DEG;
  const BOB_MM = 10;

  function initWalk() {
    S.walk = { enabled: false, locked: false, x: 0, y: 0, feet: 0, vz: 0, vel: { x: 0, y: 0 }, keys: new Set(), run: false, floorId: null, world: null, worldDoc: null, bob: 0, phase: 0, spawned: false };
    const plc = new S.PointerLockControls(S.camera, S.renderer.domElement);
    plc.pointerSpeed = 0.85;
    plc.addEventListener('lock', () => {
      S.walk.locked = true;
      updateWalkUI();
    });
    plc.addEventListener('unlock', () => {
      S.walk.locked = false;
      S.walk.keys.clear();
      S.walk.run = false;
      updateWalkUI();
      requestRender();
    });
    plc.addEventListener('change', requestRender);
    S.plc = plc;
  }
  function lockPointer() {
    if (!S.plc || !isWalking() || S.walk.locked) return;
    try {
      const r = S.plc.lock();
      if (r && typeof r.catch === 'function') r.catch((e) => console.warn('[view3d] pointer lock refused', e));
    } catch (e) {
      console.warn('[view3d] pointer lock unavailable', e);
    }
  }
  function exitPointerLock() {
    if (S.plc && S.walk && S.walk.locked) S.plc.unlock();
  }

  /** Colliders + walkable surfaces, rebuilt lazily whenever the document changed. */
  function ensureWalkWorld() {
    const doc = docNow();
    if (S.walk.world && S.walk.worldDoc === doc && !S.dirty.colliders) return S.walk.world;
    S.walk.world = { colliders: P.collectColliders(doc), ctx: P.surfaceContext(doc), floors: doc.floors };
    S.walk.worldDoc = doc;
    S.dirty.colliders = false;
    return S.walk.world;
  }
  function spawnWalker(floorId) {
    const world = ensureWalkWorld();
    const sp = P.spawnFor(docNow(), floorId, world.colliders);
    const f = floorOf(docNow(), floorId);
    Object.assign(S.walk, { x: sp.x, y: sp.y, feet: sp.feet, vz: 0, vel: { x: 0, y: 0 }, floorId: f.id, bob: 0, spawned: true });
    S.camera.rotation.set(WALK_PITCH, sp.yaw, 0, 'YXZ');
    syncWalkerCamera();
  }
  function syncWalkerCamera() {
    const w = S.walk;
    S.camera.up.set(0, 1, 0);
    S.camera.position.set(w.x * MM, (w.feet + WALK.eye + w.bob) * MM, w.y * MM);
    requestRender();
  }
  /** Pose of the walker's eye (for transitions that end in walk mode). */
  function walkPose() {
    if (!S.walk.spawned) spawnWalker(uiNow().floor);
    const w = S.walk;
    const yaw = new S.THREE.Euler().setFromQuaternion(S.camera.quaternion, 'YXZ').y;
    const d = P.dirFromYaw(yaw);
    const pos = { x: w.x * MM, y: (w.feet + WALK.eye) * MM, z: w.y * MM };
    return { pos, target: { x: pos.x + d.x, y: pos.y + Math.tan(WALK_PITCH), z: pos.z + d.y }, up: { x: 0, y: 1, z: 0 } };
  }
  function walkInput() {
    const k = S.walk.keys;
    const yaw = new S.THREE.Euler().setFromQuaternion(S.camera.quaternion, 'YXZ').y;
    const f = P.dirFromYaw(yaw);
    const r = { x: -f.y, y: f.x };
    let x = 0, y = 0;
    if (k.has('f')) (x += f.x), (y += f.y);
    if (k.has('b')) (x -= f.x), (y -= f.y);
    if (k.has('r')) (x += r.x), (y += r.y);
    if (k.has('l')) (x -= r.x), (y -= r.y);
    const len = Math.hypot(x, y);
    const speed = S.walk.run ? WALK.run : WALK.speed;
    return len > 1e-6 && S.walk.locked ? { x: (x / len) * speed, y: (y / len) * speed } : { x: 0, y: 0 };
  }
  /** One frame of walking. → true while something moved (needs a render). */
  function stepWalk(dt) {
    const w = S.walk;
    if (!w.enabled || dt <= 0) return false;
    const want = walkInput();
    const k = 1 - Math.exp(-dt * 12);
    const vel = { x: P.lerp(w.vel.x, want.x, k), y: P.lerp(w.vel.y, want.y, k) };
    const speed = Math.hypot(vel.x, vel.y);
    const still = speed < 5 && !want.x && !want.y;
    const next = P.stepWalker({ x: w.x, y: w.y, feet: w.feet, vz: w.vz }, still ? { x: 0, y: 0 } : vel, dt, ensureWalkWorld());
    const moved = Math.abs(next.x - w.x) > 0.01 || Math.abs(next.y - w.y) > 0.01 || Math.abs(next.feet - w.feet) > 0.01;
    const phase = w.phase + dt * speed * 0.0055;
    const bob = still ? w.bob * (1 - k) : Math.sin(phase) * BOB_MM * Math.min(1, speed / WALK.speed);
    Object.assign(w, { x: next.x, y: next.y, feet: next.feet, vz: next.vz, vel: still ? { x: 0, y: 0 } : vel, phase, bob });
    onWalkerFloor(next.floorIndex);
    if (moved || Math.abs(bob) > 0.05) syncWalkerCamera();
    return moved;
  }
  /** Mirror the walker's floor into ui.floor (the 2D plan follows). */
  function onWalkerFloor(index) {
    const f = docNow().floors[index];
    if (!f || f.id === S.walk.floorId) return;
    S.walk.floorId = f.id;
    if (uiNow().floor !== f.id) store().setUI({ floor: f.id });
  }

  function applyCameraMode(mode) {
    if (!S.ready) return;
    const walk = mode === 'walk';
    if (walk === isWalking()) return;
    cancelTween();
    if (walk) enterWalk();
    else leaveWalk();
    updateWalkUI();
    updateVisibility(true);
  }
  function enterWalk() {
    S.orbitPose = toPlain(currentPose());
    S.orbitPoseHome = S.atHome; // an automatic framing is recomputed on return (aspect / floor may have changed)
    S.atHome = false;
    S.walk.enabled = true;
    S.orbit.enabled = false;
    S.camera.fov = FOV_WALK;
    S.camera.near = 0.05;
    S.camera.updateProjectionMatrix();
    S.ambient.intensity = LIGHT.ambientWalk;
    S.hemi.intensity = LIGHT.hemiWalk;
    S.hemi.groundColor.set(BOUNCE.walk);
    clearHover();
    spawnWalker(uiNow().floor);
  }
  function leaveWalk() {
    exitPointerLock();
    const from = currentPose();
    Object.assign(S.walk, { enabled: false, keys: new Set(), run: false });
    S.camera.fov = FOV_ORBIT;
    S.camera.near = 0.1;
    S.camera.updateProjectionMatrix();
    S.ambient.intensity = LIGHT.ambient;
    S.hemi.intensity = LIGHT.hemi;
    S.hemi.groundColor.set(BOUNCE.orbit);
    const restore = S.orbitPose && !S.pendingAerial && !S.orbitPoseHome;
    const to = restore ? S.orbitPose : aerialHome();
    S.pendingAerial = false;
    tweenCamera(from, to, 700, { home: !restore });
  }
  function updateWalkUI() {
    if (!S.container) return;
    const walk = isWalking();
    const locked = walk && S.walk.locked;
    if (S.el.prompt) S.el.prompt.hidden = !walk || locked || !S.ready;
    if (S.el.cross) S.el.cross.hidden = !locked;
    S.container.classList.toggle('v3d-walking', walk);
    S.container.classList.toggle('v3d-locked', locked);
  }
  function onWalkKey(e, down) {
    if (!isWalking() || !S.walk.locked) return;
    if (e.key === 'Shift') {
      S.walk.run = down;
      return;
    }
    const k = MOVE_KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    e.stopPropagation(); // keep tool shortcuts (W = parede…) from firing while walking
    if (down) S.walk.keys.add(k);
    else S.walk.keys.delete(k);
    if (e.shiftKey !== S.walk.run) S.walk.run = e.shiftKey;
  }

  // ================================================================== picking, hover & furniture drag (orbit mode)
  function ndc(e) {
    const r = S.canvas.getBoundingClientRect();
    return new S.THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  function visibleRoots() {
    const out = [];
    S.floors.forEach((fg) => {
      if (fg.root.visible && fg.shown) out.push(fg.root);
    });
    return out;
  }
  function visibleChain(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }
  /** Raycast the visible floors. → { ref: {kind,id}|null, point: Vector3|null } */
  function pick(e) {
    S.raycaster.setFromCamera(ndc(e), S.camera);
    const hits = S.raycaster.intersectObjects(visibleRoots(), true);
    for (let i = 0; i < hits.length; i++) {
      const o = hits[i].object, u = o.userData;
      if (u.noPick || !visibleChain(o)) continue;
      const point = hits[i].point;
      if (u.furnitureId) return { ref: { kind: 'furniture', id: u.furnitureId }, point };
      if (u.openingId) return { ref: { kind: 'opening', id: u.openingId }, point };
      if (u.wallId) return { ref: { kind: 'wall', id: u.wallId }, point };
      if (u.roomId) return { ref: { kind: 'room', id: u.roomId }, point };
      return { ref: null, point }; // slabs, stairs, roof: occlude but are not selectable
    }
    return { ref: null, point: null };
  }
  function rayToPlane(e, y) {
    const T = S.THREE;
    S.raycaster.setFromCamera(ndc(e), S.camera);
    return S.raycaster.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), new T.Vector3());
  }
  function select(ref) {
    const cur = uiNow().selection;
    if ((!ref && !cur) || sameRef(ref, cur)) return;
    store().setUI({ selection: ref });
  }
  function setHover(ref) {
    const cur = uiNow().hover;
    if ((!ref && !cur) || sameRef(ref, cur)) return;
    store().setUI({ hover: ref });
  }
  function clearHover() {
    S.hoverEvt = null;
    if (S.hoverOwned) setHover(null);
    S.hoverOwned = false;
    setCursor('');
  }
  function setCursor(c) {
    if (S.canvas && S.canvas.style.cursor !== c) S.canvas.style.cursor = c;
  }
  /** Hover is resolved at most once per frame from the latest pointer position. */
  function processHover() {
    const e = S.hoverEvt;
    if (!e || S.drag || S.press || isWalking() || S.tween) return;
    S.hoverEvt = null;
    const hit = pick(e);
    S.hoverOwned = true;
    setHover(hit.ref);
    setCursor(hit.ref ? (hit.ref.kind === 'furniture' ? 'grab' : 'pointer') : '');
  }

  function onPointerDown(e) {
    if (!S.ready || e.target !== S.canvas) return;
    if (isWalking()) {
      if (e.button === 0) lockPointer();
      return;
    }
    if (e.button !== 0 || S.tween) return;
    const hit = pick(e);
    S.press = { x: e.clientX, y: e.clientY, hit };
    if (hit.ref && hit.ref.kind === 'furniture') prepareDrag(hit.ref.id, e);
  }
  /** Arm a drag: orbit is disabled now (capture phase) so this press never rotates the view. */
  function prepareDrag(id, e) {
    const doc = docNow();
    const it = DD.ops.byId(doc, 'furniture', id);
    if (!it) return;
    const planeY = floorOf(doc, it.floor).level * MM;
    const p = rayToPlane(e, planeY);
    if (!p) return;
    S.drag = { id, planeY, offX: it.x - p.x / MM, offY: it.y - p.z / MM, rot0: it.rot || 0, started: false };
    S.orbit.enabled = false;
  }
  function onPointerMove(e) {
    if (S.drag) {
      dragMove(e);
      return;
    }
    if (!S.press && e.buttons === 0 && e.target === S.canvas && !isWalking()) {
      S.hoverEvt = e;
      requestRender();
    }
  }
  function dragMove(e) {
    const d = S.drag;
    if (!d.started) {
      if (Math.hypot(e.clientX - S.press.x, e.clientY - S.press.y) < CLICK_SLOP) return;
      d.started = true;
      store().beginGesture(DRAG_LABEL);
      select({ kind: 'furniture', id: d.id });
      setHover(null);
      setCursor('grabbing');
    }
    const doc = docNow();
    const cur = DD.ops.byId(doc, 'furniture', d.id);
    const p = rayToPlane(e, d.planeY);
    if (!cur || !p) return;
    // keep the item on the lot: a ray grazing the horizon must not throw furniture kilometres away
    const lot = (doc.site && doc.site.lot) || { w: 9000, h: 20000 };
    let prop = {
      x: P.clamp(Math.round(p.x / MM + d.offX), 0, lot.w),
      y: P.clamp(Math.round(p.z / MM + d.offY), 0, lot.h),
      rot: d.rot0,
    };
    if (uiNow().snap && !e.altKey && !isFlatType(cur.type)) {
      try {
        const s = DD.geom.snapFurniture(doc, cur.floor, cur, prop, { threshold: 150, angleTol: 30 });
        prop = { x: s.x, y: s.y, rot: s.rot };
      } catch (err) {
        console.warn('[view3d] snap failed', err);
      }
    }
    if (prop.x === cur.x && prop.y === cur.y && prop.rot === cur.rot) return;
    store().preview(DD.ops.update(doc, 'furniture', d.id, prop));
  }
  function endDrag(commit) {
    const d = S.drag;
    S.drag = null;
    if (d && d.started) {
      if (commit) store().endGesture(DRAG_LABEL);
      else store().cancelGesture();
    }
    if (S.orbit && !isWalking() && !S.tween) S.orbit.enabled = true;
    setCursor('');
    return !!(d && d.started);
  }
  function onPointerUp(e) {
    const press = S.press;
    S.press = null;
    const dragged = endDrag(true);
    if (dragged || !press || e.button !== 0) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) return;
    select(press.hit.ref);
  }
  function onPointerCancel() {
    S.press = null;
    endDrag(false);
  }
  function onKeyDown(e) {
    if (e.key === 'Escape' && S.drag) {
      e.preventDefault();
      e.stopPropagation();
      S.press = null;
      endDrag(false);
      return;
    }
    onWalkKey(e, true);
  }
  function bindInput() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      S.unsubs.push(() => target.removeEventListener(type, fn, opts));
    };
    on(S.container, 'pointerdown', onPointerDown, true); // capture: runs before OrbitControls on the canvas
    on(window, 'pointermove', onPointerMove);
    on(window, 'pointerup', onPointerUp);
    on(window, 'pointercancel', onPointerCancel);
    on(S.canvas, 'pointerleave', () => {
      if (!S.drag) clearHover();
    });
    on(window, 'keydown', onKeyDown, true);
    on(window, 'keyup', (e) => onWalkKey(e, false), true);
    on(window, 'blur', () => {
      if (S.walk) S.walk.keys.clear();
    });
    if (S.el.prompt) on(S.el.prompt, 'click', lockPointer);
  }

  // ================================================================== render loop
  /** Haze starts beyond the house whatever the zoom, and always hides the edge of the ground. */
  function updateFog() {
    const fog = S.scene.fog;
    if (!fog) return;
    const dist = !isWalking() && S.orbit ? S.camera.position.distanceTo(S.orbit.target) : 0;
    const near = Math.max(FOG.near, dist * 1.15);
    fog.near = near;
    fog.far = Math.min(FOG.max, near + (FOG.far - FOG.near));
  }
  function render() {
    S.needsRender = false;
    S.sky.position.copy(S.camera.position);
    updateFog();
    S.renderer.render(S.scene, S.camera);
  }
  function frame(now) {
    S.raf = 0;
    if (!S.active || !S.ready) return;
    S.raf = requestAnimationFrame(frame);
    const dt = S.lastT ? Math.min(0.05, Math.max(0, (now - S.lastT) / 1000)) : 0;
    S.lastT = now;
    try {
      flushRebuild();
      let busy = stepTween(now);
      busy = stepFloorAnims(now) || busy;
      if (isWalking() && !S.tween) busy = stepWalk(dt) || busy;
      else if (S.orbit && S.orbit.enabled) {
        S.orbit.update(); // emits 'change' (→ render) while moving or damping
        constrainOrbit();
      }
      processHover();
      if (busy || S.needsRender) render();
    } catch (e) {
      console.error('[view3d] frame failed', e);
    }
  }
  function startLoop() {
    if (S.raf) return;
    S.lastT = 0;
    S.raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
  }
  /** Finish a running camera tween immediately (e.g. the view is hidden mid-transition). */
  function completeTween() {
    if (S.tween) stepTween(0, true);
  }

  function setActive(on) {
    S.active = !!on;
    if (!S.ready) return;
    if (S.active) {
      resize();
      if (S.pendingAerial && !S.tween) jumpHome();
      if (S.cutaway && !S.tween) setCutaway(false, false);
      requestRender();
      startLoop();
    } else {
      stopLoop();
      completeTween();
      exitPointerLock();
      if (S.drag) endDrag(true);
    }
    updateWalkUI();
  }

  function setCameraMode(mode) {
    const m = mode === 'walk' ? 'walk' : 'orbit';
    if (DD.store && uiNow().cam3d !== m) store().setUI({ cam3d: m }); // the UI subscriber applies it
    else applyCameraMode(m);
  }

  /** Debug statistics (renderer info + object counts). */
  function stats() {
    if (!S.ready) return null;
    let meshes = 0;
    S.scene.traverse((o) => {
      if (o.isMesh) meshes++;
    });
    const r = S.renderer.info;
    return { meshes, calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, furniture: S.furniture.size };
  }

  function exportPNG() {
    if (!S.ready) return null;
    try {
      flushRebuild();
      resize();
      if (S.pendingAerial && !S.tween) jumpHome();
      render();
      return S.renderer.domElement.toDataURL('image/png');
    } catch (e) {
      console.error('[view3d] PNG export failed', e);
      return null;
    }
  }

  // ================================================================== store subscriptions
  function markAllFloors(doc) {
    doc.floors.forEach((f) => S.dirty.floors.add(f.id));
  }
  /** A 3D furniture drag whose gesture was cancelled elsewhere (undo, floor change, import) must stop at once. */
  function abortDragIfCancelled(info) {
    if (!S.drag || !info || !(info.undo || info.redo || info.replaced || info.cancel)) return;
    S.drag = null;
    S.press = null;
    if (S.orbit && !isWalking() && !S.tween) S.orbit.enabled = true;
    setCursor('');
    S.dirty.highlight = true;
  }
  function onDocChange(doc, prev, info) {
    abortDragIfCancelled(info);
    const transient = !!(info && info.transient && store().inGesture());
    const pending = S.dirty.floors.size > 0;
    S.dirty.transient = transient && (!pending || S.dirty.transient);
    if (!prev || doc.floors !== prev.floors) {
      markAllFloors(doc);
      S.dirty.furniture = true;
    }
    if (!prev || doc.site !== prev.site) S.dirty.site = true;
    const archChanged =
      !prev ||
      doc.walls !== prev.walls ||
      doc.openings !== prev.openings ||
      doc.roomSeeds !== prev.roomSeeds ||
      doc.separators !== prev.separators ||
      doc.stairs !== prev.stairs;
    if (archChanged) markAllFloors(doc); // per-floor signatures skip floors that did not change
    if (!prev || doc.furniture !== prev.furniture) S.dirty.furniture = true;
    S.dirty.colliders = true;
    requestRender();
  }
  function onUIChange(ui, prev) {
    if (ui.selection !== prev.selection || ui.hover !== prev.hover) S.dirty.highlight = true;
    if (ui.showAllFloors !== prev.showAllFloors || ui.show !== prev.show) S.dirty.visibility = true;
    if (ui.showAllFloors !== prev.showAllFloors && S.ready && S.active && S.atHome && !S.tween && !isWalking())
      tweenCamera(currentPose(), aerialHome(), 600, { home: true }); // re-frame: with or without the upper floors
    if (ui.floor !== prev.floor) onFloorChange(ui.floor);
    if (ui.cam3d !== prev.cam3d) applyCameraMode(ui.cam3d);
    requestRender();
  }
  function onFloorChange(floorId) {
    S.dirty.visibility = true;
    if (!S.ready) return;
    if (isWalking()) {
      if (floorId !== S.walk.floorId) spawnWalker(floorId);
    } else if (S.active) glideToFloor(floorId);
    else S.pendingAerial = true;
  }
  function subscribeStore() {
    S.unsubs.push(store().subscribe(onDocChange));
    S.unsubs.push(store().subscribeUI(onUIChange));
  }

  // ================================================================== DOM (status, walk prompt, crosshair)
  function makeEl(cls, text) {
    const el = document.createElement('div');
    el.className = cls;
    if (text) el.textContent = text;
    return el;
  }
  function insertBeforeOverlay(el) {
    const overlay = S.container.querySelector('#view3d-overlay');
    S.container.insertBefore(el, overlay && overlay.parentNode === S.container ? overlay : null);
  }
  function createDomUI() {
    const status = makeEl('v3d-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const prompt = document.createElement('button');
    prompt.type = 'button';
    prompt.className = 'v3d-walk-prompt';
    prompt.textContent = MSG_WALK_PROMPT;
    prompt.hidden = true;
    const cross = makeEl('v3d-crosshair');
    cross.setAttribute('aria-hidden', 'true');
    cross.hidden = true;
    [status, prompt, cross].forEach(insertBeforeOverlay);
    S.el = { status, prompt, cross };
  }
  function setStatus(kind, text) {
    const el = S.el.status;
    if (!el) return;
    el.hidden = !kind;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-loading', kind === 'loading');
    el.textContent = '';
    if (!kind) return;
    if (kind === 'loading') el.appendChild(makeEl('v3d-spinner'));
    el.appendChild(makeEl('v3d-status-text', text));
  }

  // ================================================================== init
  async function loadThree() {
    const THREE = await import('three');
    const oc = await import('three/addons/controls/OrbitControls.js');
    const pl = await import('three/addons/controls/PointerLockControls.js');
    if (!THREE || !oc.OrbitControls || !pl.PointerLockControls) throw new Error('three.js incompleto');
    S.THREE = THREE;
    S.OrbitControls = oc.OrbitControls;
    S.PointerLockControls = pl.PointerLockControls;
  }
  function setupScene() {
    const T = S.THREE;
    S.renderer = createRenderer();
    S.canvas = S.renderer.domElement;
    insertBeforeOverlay(S.canvas);
    S.scene = createScene();
    S.camera = new T.PerspectiveCamera(FOV_ORBIT, 1, 0.1, 1200);
    S.camera.rotation.order = 'YXZ';
    S.raycaster = new T.Raycaster();
    S.orbit = createOrbit();
    initWalk();
    bindInput();
    S.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
    if (S.ro) S.ro.observe(S.container);
    subscribeStore();
    const doc = docNow();
    markAllFloors(doc);
    S.dirty.site = S.dirty.furniture = S.dirty.visibility = S.dirty.highlight = true;
  }
  function failWith(msg) {
    S.failed = true;
    S.loading = false;
    S.ready = false;
    setStatus('error', msg);
  }
  async function load() {
    S.loading = true;
    setStatus('loading', 'Carregando a vista 3D…');
    try {
      await loadThree();
    } catch (e) {
      console.warn('[view3d] three.js could not be loaded', e);
      failWith(MSG_LOAD_FAIL);
      return;
    }
    try {
      setupScene();
      S.ready = true;
      resize();
      flushRebuild();
      jumpHome();
      if (uiNow().cam3d === 'walk') applyCameraMode('walk');
    } catch (e) {
      console.error('[view3d] 3D setup failed', e);
      teardown();
      failWith(MSG_WEBGL_FAIL);
      return;
    }
    S.loading = false;
    setStatus(null);
    updateWalkUI();
    if (DD.events) DD.events.emit('view3d:ready', {});
    if (S.active) setActive(true);
    scheduleWarmUp();
  }
  /**
   * Pre-compile every shader program (all floors, roof, shadow pass) and upload the GPU buffers while the user is
   * still in 2D, so the first 2D→3D transition does not stall on its first frames.
   */
  function scheduleWarmUp() {
    const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 }) : (fn) => setTimeout(fn, 200);
    idle(() => {
      if (!S.ready || S.warm) return;
      const r = S.renderer;
      const run = () => {
        if (!S.ready || S.warm) return;
        S.warm = true;
        try {
          flushRebuild();
          withEverythingVisible(() => (S.active ? r.compile(S.scene, S.camera) : render()));
        } catch (e) {
          console.warn('[view3d] shader warm-up failed', e);
        }
        requestRender();
      };
      if (typeof r.compileAsync === 'function')
        withEverythingVisible(() => r.compileAsync(S.scene, S.camera))
          .then(() => idle(run))
          .catch((e) => {
            console.warn('[view3d] async shader compile failed', e);
            run();
          });
      else run();
    });
  }
  /** Run fn with every floor, roof and furniture group visible; the previous visibility is restored afterwards. */
  function withEverythingVisible(fn) {
    const saved = [];
    const show = (o) => {
      if (!o) return;
      saved.push([o, o.visible]);
      o.visible = true;
    };
    S.floors.forEach((fg) => {
      show(fg.root);
      show(fg.roof);
      show(fg.furn);
    });
    try {
      return fn();
    } finally {
      saved.forEach((e) => {
        e[0].visible = e[1];
      });
    }
  }
  function teardown() {
    stopLoop();
    S.unsubs.splice(0).forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.warn('[view3d] unsubscribe failed', e);
      }
    });
    if (S.ro) S.ro.disconnect();
    if (S.renderer) {
      S.renderer.dispose();
      if (S.canvas && S.canvas.parentNode) S.canvas.parentNode.removeChild(S.canvas);
    }
    S.renderer = null;
    S.ready = false;
  }
  function init(containerEl) {
    if (S.container) return;
    if (!containerEl) {
      console.warn('[view3d] #view3d container not found');
      return;
    }
    S.container = containerEl;
    createDomUI();
    load().catch((e) => {
      console.error('[view3d] unexpected init failure', e);
      failWith(MSG_WEBGL_FAIL);
    });
  }

  DD.view3d = {
    init,
    isReady: () => S.ready,
    setActive,
    resize,
    setCameraMode,
    transitionFrom2D,
    transitionTo2D,
    exportPNG,
    recenter,
    /** Pure helpers (no three.js / DOM) — exposed for Node tests. */
    _pure: P,
    _stats: stats,
  };
})();
