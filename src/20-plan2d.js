// ===== 20-plan2d.js — 2D plan editor: drafting-style canvas renderer, editing tools, snapping, PNG export =====
// World units are millimetres (+x right, +y down). A view maps world → CSS pixels with a uniform `scale`
// (CSS px per mm) centred on (cx, cy). Every layer is drawn by `drawScene(rc)`, so the on-screen editor and the
// PNG export share one renderer. The store document is never mutated: edits go through DD.ops + DD.store.
(function () {
  'use strict';
  const DD = window.DD;
  const U = DD.util; // core namespaces (00/01) are loaded before this module
  const G = DD.geom;
  const OPS = DD.ops;

  // ================================================================== constants
  const COL = {
    paper: '#F3EFE6',
    paperExport: '#FFFFFF',
    gridMinor: '#E7E1D5',
    gridMajor: '#DAD2C3',
    ink: '#1F1D1A',
    structural: '#2E2A26',
    structuralMuted: '#7A7268',
    partition: '#CFC6B7',
    partitionHatch: '#8C8375',
    muro: '#9C9385',
    muroHatch: '#6E655A',
    dimLine: '#6E655A',
    dimText: '#3A342D',
    muted: '#8C8375',
    roomOutline: '#8C8375',
    coral: '#D9643A',
    teal: '#1F8A8A',
    stairFill: '#FAF7F1',
    street: '#D8D1C4',
    curb: '#A69D8F',
    onDark: 'rgba(243,239,230,0.9)',
  };
  const FONT_UI = '"Space Grotesk", "Segoe UI", system-ui, sans-serif';
  const FONT_MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';

  const MIN_SCALE = 0.02; // css px per mm
  const MAX_SCALE = 1.2;
  const CUT_PLANE_MM = 1500; // windows with a sill at/above this are drawn dashed (above the cut)
  const DRAG_START_PX = 4;
  const DRAG_START_TOUCH_PX = 8;
  const HIT_PX = 4;
  const SNAP_FURNITURE_PX = 14;
  const SNAP_POINT_PX = 10;
  const DROP_SNAP_MM = 300;
  const HANDLE_PX = 9;
  const ROT_HANDLE_OFFSET_PX = 28;
  const COMPACT_HANDLES_PX = 28;
  const MIN_FURNITURE_MM = 100;
  const RESIZE_STEP_MM = 10;
  const ROT_STEP_DEG = 15;
  const NEW_WALL_THICK_MM = 100;
  const WALL_GRID_MM = 50;
  const WALL_MOVE_STEP_MM = 10;
  const MIN_WALL_MM = 100;
  const ORTHO_NEAR_DEG = 8;
  const RAY_MAX_MM = 15000;
  const DEMOLISH_FADE_MS = 250;
  const HOVER_SYNC_MS = 80;
  const DIM_OFFSET_PX = 34;
  const DIM_OVERALL_PX = 66;
  const DIM_EXT_GAP_PX = 8;
  const TAG_MIN_SCALE = 0.03;
  const TAG_GAP_PX = 16;
  const ROOM_FILL_ALPHA = 0.6;
  const SIDEWALK_MM = 2000;
  const ROAD_MM = 7000;
  const STREET_SPAN_MM = 7000; // street band extends this far left/right of the lot
  const STREET_NAME_AT = 0.22; // street name position across the road band (0 = kerb)
  const EXPORT_PX_PER_MM = 0.1; // 1 px per 10 mm
  const EXPORT_MARGIN_PX = 96;
  const EXPORT_FOOTER_PX = 104;
  const WHEEL_ZOOM_K = 0.0015;
  const ZOOM_EASE = 0.3;
  const FIT_ANIM_MS = 320;
  const SITE_MATERIAL = { grass: 'grama', paving: 'calcada', driveway: 'intertravado' };
  const SITE_ALPHA = { grass: 0.32, paving: 0.5, driveway: 0.5 };
  const WALL_LEGEND = [
    { kind: 'structural', label: 'Parede estrutural' },
    { kind: 'partition', label: 'Vedação (não estrutural)' },
    { kind: 'muro', label: 'Muro de divisa' },
    { kind: 'railing', label: 'Guarda-corpo / mureta' },
  ];
  const LOCK_MSG = {
    structural: 'Parede estrutural — bloqueada',
    muro: 'Muro de divisa — bloqueado',
    railing: 'Guarda-corpo — bloqueado',
  };
  const HANDLE_DIRS = [
    [-1, -1], [1, -1], [1, 1], [-1, 1], // corners first: they win when handles overlap
    [0, -1], [1, 0], [0, 1], [-1, 0],
  ];
  const PAINT_CURSOR =
    'url("data:image/svg+xml,' +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
        "<path d='M10 3l9 9-7 7-9-9z' fill='#F3EFE6' stroke='#1F1D1A' stroke-width='1.6' stroke-linejoin='round'/>" +
        "<path d='M3.5 10h15' stroke='#1F1D1A' stroke-width='1.2'/>" +
        "<path d='M3 17c0 0 -2 2.6 -2 3.9a2 2 0 0 0 4 0c0-1.3-2-3.9-2-3.9z' fill='#1F8A8A' stroke='#fff' stroke-width='.8'/>" +
        '</svg>'
    ) +
    '") 2 21, crosshair';

  // ================================================================== module state
  const S = {
    canvas: null,
    ctx: null,
    parent: null,
    dpr: 1,
    view: { cx: 4500, cy: 10000, scale: 0.05, width: 0, height: 0 },
    hasFit: false,
    dirty: true,
    raf: 0,
    drag: null, // active pointer interaction (see DRAGS)
    pendingMove: null, // latest pointermove, processed once per animation frame
    lastEvent: null,
    touches: new Map(),
    pinch: null,
    pointerInside: false,
    spaceDown: false,
    hover: null, // local hover {kind,id,...}
    hoverTimer: 0,
    lastHoverSync: 0,
    snapHint: null, // snapped point shown as a teal ring (measure / wall tools)
    measure: null, // { a, cur } measure in progress
    wallDraw: null, // { a, cur } wall chain in progress
    fades: [], // demolition fade-outs { wallId, floor, t0 }
    viewAnim: null,
    zoomAnim: null,
    feedback: null, // drag feedback: snapped faces, distance rays, labels
    cursor: '',
    cursorWorld: null,
    cursorDirty: false,
    viewportDirty: false,
    unsubs: [],
  };
  let clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const warned = new Set();
  function warnOnce(key, err) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn('[plan2d] ' + key, err);
  }
  const store = () => DD.store;

  // ================================================================== pure helpers: view math
  const clampScale = (s) => U.clamp(s, MIN_SCALE, MAX_SCALE);
  const w2sX = (v, x) => (x - v.cx) * v.scale + v.width / 2;
  const w2sY = (v, y) => (y - v.cy) * v.scale + v.height / 2;
  const w2s = (v, p) => ({ x: w2sX(v, p.x), y: w2sY(v, p.y) });
  const s2w = (v, sx, sy) => ({ x: (sx - v.width / 2) / v.scale + v.cx, y: (sy - v.height / 2) / v.scale + v.cy });

  /** New {cx,cy,scale} after zooming by `factor` while keeping the world point under (sx,sy) fixed. */
  function zoomAround(v, factor, sx, sy) {
    const anchor = s2w(v, sx, sy);
    const scale = clampScale(v.scale * factor);
    return { cx: anchor.x - (sx - v.width / 2) / scale, cy: anchor.y - (sy - v.height / 2) / scale, scale };
  }
  /** View that fits `box` into width × height leaving `padPx` on every side. */
  function fitRect(box, width, height, padPx) {
    const bw = Math.max(1, box.maxX - box.minX);
    const bh = Math.max(1, box.maxY - box.minY);
    const availW = Math.max(40, width - 2 * padPx);
    const availH = Math.max(40, height - 2 * padPx);
    return {
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2,
      scale: clampScale(Math.min(availW / bw, availH / bh)),
    };
  }
  function emptyBox() {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }
  function growBox(b, x, y) {
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  }
  function intersectBox(a, b) {
    const r = { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) };
    return r.minX < r.maxX && r.minY < r.maxY ? r : null;
  }
  const BUILDING_KINDS = { structural: true, partition: true };
  /**
   * Bounding box of a floor: walls and stairs. With `buildingOnly`, only structural + partition walls plus the
   * closed rooms (so terraces count but the garden does not). Falls back to every wall, then to the lot.
   */
  function floorBox(doc, floorId, buildingOnly) {
    const b = emptyBox();
    doc.walls.forEach((w) => {
      if (w.floor === floorId && (!buildingOnly || BUILDING_KINDS[w.kind])) G.wallPolygon(w).forEach((p) => growBox(b, p.x, p.y));
    });
    if (buildingOnly && !isFinite(b.minX)) return floorBox(doc, floorId, false);
    if (buildingOnly) {
      safeRooms(doc, floorId).forEach((r) => {
        if (r.open || !r.bbox) return;
        growBox(b, r.bbox.minX, r.bbox.minY);
        growBox(b, r.bbox.maxX, r.bbox.maxY);
      });
    }
    doc.stairs.forEach((s) => {
      if (s.floor !== floorId) return;
      growBox(b, s.x, s.y);
      growBox(b, s.x + s.length, s.y + s.width);
    });
    if (isFinite(b.minX)) return b;
    const lot = (doc.site && doc.site.lot) || { w: 9000, h: 20000 };
    return { minX: 0, minY: 0, maxX: lot.w, maxY: lot.h };
  }

  // ================================================================== pure helpers: furniture handles
  /** Resize handles (+ rotation knob in front of the item) in world coordinates. `px` = mm per css px. */
  function furnitureHandles(it, px) {
    const rot = it.rot || 0;
    const compact = Math.min(it.w, it.d) / px < COMPACT_HANDLES_PX;
    const dirs = compact ? HANDLE_DIRS.slice(0, 4) : HANDLE_DIRS;
    const resize = dirs.map(([sx, sy]) => {
      const p = U.localToWorld(it.x, it.y, rot, (sx * it.w) / 2, (sy * it.d) / 2);
      return { sx, sy, x: p.x, y: p.y };
    });
    const stem = U.localToWorld(it.x, it.y, rot, 0, it.d / 2);
    const knob = U.localToWorld(it.x, it.y, rot, 0, it.d / 2 + ROT_HANDLE_OFFSET_PX * px);
    return { resize, rotate: { x: knob.x, y: knob.y, stemX: stem.x, stemY: stem.y } };
  }
  function hitFurnitureHandle(it, p, px) {
    const h = furnitureHandles(it, px);
    const tol = (HANDLE_PX / 2 + 3) * px;
    if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) <= tol + 2 * px) return { type: 'rotate' };
    for (const r of h.resize) {
      if (Math.abs(p.x - r.x) <= tol && Math.abs(p.y - r.y) <= tol) return { type: 'resize', sx: r.sx, sy: r.sy };
    }
    return null;
  }
  /** Resize from handle (sx,sy) ∈ {-1,0,1}² dragged to world (wx,wy); the opposite side stays fixed. */
  function resizeFromHandle(it, sx, sy, wx, wy, opts) {
    const step = (opts && opts.step) || RESIZE_STEP_MM;
    const min = (opts && opts.min) || MIN_FURNITURE_MM;
    const rot = it.rot || 0;
    const p = U.worldToLocal(it.x, it.y, rot, wx, wy);
    let w = it.w, d = it.d, lcx = 0, lcy = 0;
    if (sx) {
      const anchor = (-sx * it.w) / 2;
      w = Math.max(min, Math.round((sx * (p.x - anchor)) / step) * step);
      lcx = anchor + (sx * w) / 2;
    }
    if (sy) {
      const anchor = (-sy * it.d) / 2;
      d = Math.max(min, Math.round((sy * (p.y - anchor)) / step) * step);
      lcy = anchor + (sy * d) / 2;
    }
    const c = U.localToWorld(it.x, it.y, rot, lcx, lcy);
    return { x: Math.round(c.x), y: Math.round(c.y), w, d };
  }
  /** Rotation that points the item's front (local +y, where the knob sits) at the pointer. */
  function rotationFromPointer(it, wx, wy, free) {
    const a = U.deg(Math.atan2(wy - it.y, wx - it.x)) - 90;
    return U.normDeg(free ? Math.round(a) : Math.round(a / ROT_STEP_DEG) * ROT_STEP_DEG);
  }
  /** CSS resize cursor for a handle direction on an item rotated by `rot`. */
  function handleCursor(sx, sy, rot) {
    const r = U.rad(rot || 0);
    const dx = sx * Math.cos(r) - sy * Math.sin(r);
    const dy = sx * Math.sin(r) + sy * Math.cos(r);
    const a = ((U.deg(Math.atan2(dy, dx)) % 180) + 180) % 180;
    if (a < 22.5 || a >= 157.5) return 'ew-resize';
    if (a < 67.5) return 'nwse-resize';
    if (a < 112.5) return 'ns-resize';
    return 'nesw-resize';
  }

  // ================================================================== pure helpers: hit testing
  function catalogDef(type) {
    try {
      return (DD.catalog && DD.catalog.types && DD.catalog.types[type]) || null;
    } catch (e) {
      return null;
    }
  }
  const isFlat = (it) => !!(catalogDef(it.type) || {}).flat;
  const furnitureName = (it) => (catalogDef(it.type) || {}).name || it.type;

  function pointInFurniture(it, p, tol) {
    const l = U.worldToLocal(it.x, it.y, it.rot || 0, p.x, p.y);
    return Math.abs(l.x) <= it.w / 2 + tol && Math.abs(l.y) <= it.d / 2 + tol;
  }
  /** Topmost furniture at p: non-flat items (last drawn first), then flat ones (rugs). */
  function hitFurniture(doc, floorId, p, tol) {
    const items = doc.furniture.filter((it) => it.floor === floorId);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (isFlat(it) !== (pass === 1)) continue;
        if (pointInFurniture(it, p, tol)) return it;
      }
    }
    return null;
  }
  function wallMapOf(doc, floorId) {
    const m = new Map();
    doc.walls.forEach((w) => {
      if (w.floor === floorId) m.set(w.id, w);
    });
    return m;
  }
  function hitOpening(doc, floorId, p, tol) {
    const walls = wallMapOf(doc, floorId);
    for (const op of doc.openings) {
      const w = walls.get(op.wall);
      if (!w) continue;
      const { d, n } = G.wallDir(w);
      const rx = p.x - w.a.x, ry = p.y - w.a.y;
      const s = rx * d.x + ry * d.y, u = rx * n.x + ry * n.y;
      if (Math.abs(s - op.t) <= op.width / 2 + tol && Math.abs(u) <= w.thick / 2 + tol) return op;
    }
    return null;
  }
  /** Wall under p (closest centre line wins when several overlap at a joint). */
  function hitWall(doc, floorId, p, tol) {
    let best = null, bestGap = Infinity;
    doc.walls.forEach((w) => {
      if (w.floor !== floorId) return;
      const gap = U.segDist(p, w.a, w.b).d - w.thick / 2;
      if (gap <= tol && gap < bestGap) {
        best = w;
        bestGap = gap;
      }
    });
    return best;
  }
  function hitMeasure(doc, floorId, p, tol) {
    const ms = (doc.measures || []).filter((m) => m.floor === floorId);
    for (let i = ms.length - 1; i >= 0; i--) if (U.segDist(p, ms[i].a, ms[i].b).d <= tol) return ms[i];
    return null;
  }
  function hitWallEnd(w, p, tol) {
    if (Math.hypot(p.x - w.a.x, p.y - w.a.y) <= tol) return 'a';
    if (Math.hypot(p.x - w.b.x, p.y - w.b.y) <= tol) return 'b';
    return null;
  }
  function safeRoomAt(doc, floorId, x, y) {
    try {
      return DD.rooms.at(doc, floorId, x, y);
    } catch (e) {
      warnOnce('rooms.at', e);
      return null;
    }
  }
  /**
   * Select-tool hit test, in priority order: handles of the selected item, endpoints of the selected partition,
   * furniture (topmost non-flat, then flat), openings, walls, measures, rooms.
   * → { kind: 'handle'|'wallEnd'|'furniture'|'opening'|'wall'|'measure'|'room', id, handle?, end? } | null
   */
  function hitTestSelect(doc, floorId, p, px, opts) {
    const o = opts || {};
    const tol = HIT_PX * px;
    const sel = o.selection;
    const showFurniture = o.showFurniture !== false;
    if (sel && sel.kind === 'furniture' && showFurniture) {
      const it = OPS.byId(doc, 'furniture', sel.id);
      const h = it && it.floor === floorId ? hitFurnitureHandle(it, p, px) : null;
      if (h) return { kind: 'handle', id: it.id, handle: h };
    }
    if (sel && sel.kind === 'wall') {
      const w = OPS.byId(doc, 'walls', sel.id);
      const end = w && w.floor === floorId && OPS.isEditableWall(w) ? hitWallEnd(w, p, (HANDLE_PX / 2 + 3) * px) : null;
      if (end) return { kind: 'wallEnd', id: w.id, end };
    }
    const it = showFurniture ? hitFurniture(doc, floorId, p, tol) : null;
    if (it) return { kind: 'furniture', id: it.id };
    const op = hitOpening(doc, floorId, p, tol);
    if (op) return { kind: 'opening', id: op.id };
    const w = hitWall(doc, floorId, p, tol);
    if (w) return { kind: 'wall', id: w.id };
    const m = hitMeasure(doc, floorId, p, 5 * px);
    if (m) return { kind: 'measure', id: m.id };
    const r = safeRoomAt(doc, floorId, p.x, p.y);
    if (r) return { kind: 'room', id: r.id };
    return null;
  }
  function refOf(h) {
    if (!h) return null;
    if (h.kind === 'handle') return { kind: 'furniture', id: h.id };
    if (h.kind === 'wallEnd') return { kind: 'wall', id: h.id };
    return { kind: h.kind, id: h.id };
  }
  const sameRef = (a, b) => (!a && !b) || (!!a && !!b && a.kind === b.kind && a.id === b.id);
  const sameHover = (a, b) =>
    sameRef(a, b) &&
    (!a || ((a.end || null) === (b.end || null) && JSON.stringify(a.handle || null) === JSON.stringify(b.handle || null)));

  // ================================================================== pure helpers: walls & openings
  const cutsWall = (op) => op.type === 'door' || (op.sill || 0) < CUT_PLANE_MM;
  /** Solid [t0,t1] intervals of a wall of length L once the cut openings are removed. */
  function solidIntervals(L, cuts) {
    const out = [];
    let cur = 0;
    cuts
      .map((c) => [U.clamp(c.t0, 0, L), U.clamp(c.t1, 0, L)])
      .sort((a, b) => a[0] - b[0])
      .forEach(([s, e]) => {
        if (s > cur + 0.5) out.push([cur, s]);
        cur = Math.max(cur, e);
      });
    if (L > cur + 0.5) out.push([cur, L]);
    return out;
  }
  /** Rectangle of the wall between t0 and t1 (optionally grown by `extra` mm on each face). */
  function pieceQuad(w, t0, t1, extra) {
    const { d, n } = G.wallDir(w);
    const h = w.thick / 2 + (extra || 0);
    const p0 = { x: w.a.x + d.x * t0, y: w.a.y + d.y * t0 };
    const p1 = { x: w.a.x + d.x * t1, y: w.a.y + d.y * t1 };
    return [
      { x: p0.x + n.x * h, y: p0.y + n.y * h },
      { x: p1.x + n.x * h, y: p1.y + n.y * h },
      { x: p1.x - n.x * h, y: p1.y - n.y * h },
      { x: p0.x - n.x * h, y: p0.y - n.y * h },
    ];
  }
  /** Allowed range of an opening's centre `t` on its wall (wall ends and neighbouring openings). */
  function openingRange(doc, op, w) {
    const L = G.wallDir(w).L;
    let lo = op.width / 2, hi = L - op.width / 2;
    doc.openings.forEach((o) => {
      if (o.wall !== op.wall || o.id === op.id) return;
      if (o.t < op.t) lo = Math.max(lo, o.t + o.width / 2 + op.width / 2);
      else hi = Math.min(hi, o.t - o.width / 2 - op.width / 2);
    });
    return { lo, hi };
  }
  /** After an endpoint edit, keep each opening of the wall at the same world position (clamped to the wall). */
  function retargetOpenings(doc, oldWall, newWall) {
    const od = G.wallDir(oldWall), nd = G.wallDir(newWall);
    let changed = false;
    const openings = doc.openings.map((op) => {
      if (op.wall !== oldWall.id) return op;
      const c = { x: oldWall.a.x + od.d.x * op.t, y: oldWall.a.y + od.d.y * op.t };
      let t = (c.x - newWall.a.x) * nd.d.x + (c.y - newWall.a.y) * nd.d.y;
      const lo = op.width / 2, hi = nd.L - op.width / 2;
      t = Math.round(hi >= lo ? U.clamp(t, lo, hi) : nd.L / 2);
      if (t === op.t) return op;
      changed = true;
      return Object.assign({}, op, { t });
    });
    return changed ? Object.assign({}, doc, { openings }) : doc;
  }

  // ================================================================== pure helpers: point snapping (walls, measures)
  function chooseAxis(anchor, raw, mode) {
    if (!anchor || !mode || mode === 'off') return null;
    const dx = raw.x - anchor.x, dy = raw.y - anchor.y;
    if (mode === 'near') {
      const ang = U.deg(Math.atan2(Math.abs(dy), Math.abs(dx)));
      if (ang > ORTHO_NEAR_DEG && ang < 90 - ORTHO_NEAR_DEG) return null;
    }
    return Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  }
  function projectToAxis(q, anchor, axis) {
    if (axis === 'h') return { x: q.x, y: anchor.y };
    if (axis === 'v') return { x: anchor.x, y: q.y };
    return { x: q.x, y: q.y };
  }
  function wallSnapCandidates(w) {
    const pts = [{ x: w.a.x, y: w.a.y, kind: 'end' }, { x: w.b.x, y: w.b.y, kind: 'end' }];
    G.wallPolygon(w).forEach((p) => pts.push({ x: p.x, y: p.y, kind: 'corner' }));
    return pts;
  }
  function nearestSnapPoint(walls, p, anchor, axis, tol) {
    let best = null, bestD = tol;
    walls.forEach((w) =>
      wallSnapCandidates(w).forEach((q) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD || (d === bestD && best && best.kind === 'corner' && q.kind === 'end')) {
          bestD = d;
          best = Object.assign(projectToAxis(q, anchor, axis), { kind: q.kind });
        }
      })
    );
    return best;
  }
  function axisHit(seg, anchor, axis) {
    const k = axis === 'h' ? 'y' : 'x', o = axis === 'h' ? 'x' : 'y';
    const c = anchor[k];
    const da = seg.a[k] - c, db = seg.b[k] - c;
    if (da * db > 0 || Math.abs(seg.b[k] - seg.a[k]) < 1e-9) return null;
    const t = (c - seg.a[k]) / (seg.b[k] - seg.a[k]);
    const out = {};
    out[k] = c;
    out[o] = seg.a[o] + t * (seg.b[o] - seg.a[o]);
    return out;
  }
  /** Nearest point on any wall centre line or face (along the constraint axis when there is one). */
  function nearestFacePoint(walls, p, anchor, axis, tol) {
    let best = null, bestD = tol;
    walls.forEach((w) => {
      const lines = [{ a: w.a, b: w.b }].concat(G.wallFaces(w));
      lines.forEach((seg) => {
        const q = axis ? axisHit(seg, anchor, axis) : U.segDist(p, seg.a, seg.b).q;
        if (!q) return;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = { x: q.x, y: q.y, kind: 'face' };
        }
      });
    });
    return best;
  }
  function gridPoint(p, anchor, axis, grid) {
    if (!grid) return { x: Math.round(p.x), y: Math.round(p.y), kind: 'free' };
    const r = (v) => Math.round(v / grid) * grid;
    if (axis === 'h') return { x: r(p.x), y: anchor.y, kind: 'grid' };
    if (axis === 'v') return { x: anchor.x, y: r(p.y), kind: 'grid' };
    return { x: r(p.x), y: r(p.y), kind: 'grid' };
  }
  /**
   * Snap a point for wall drawing, wall endpoint editing and measuring.
   * opts: { anchor, ortho: 'force'|'near'|'off', tol (mm), grid (mm; 0 = none), excludeWall }
   * Priority: wall endpoints/corners → wall faces & centre lines → grid. Result: {x, y, kind, axis}.
   */
  function snapWallPoint(doc, floorId, raw, opts) {
    const o = opts || {};
    const anchor = o.anchor || null;
    const axis = chooseAxis(anchor, raw, o.ortho);
    const p = axis ? projectToAxis(raw, anchor, axis) : raw;
    const walls = doc.walls.filter((w) => w.floor === floorId && w.id !== o.excludeWall);
    const tol = o.tol || 0;
    const hit = nearestSnapPoint(walls, p, anchor, axis, tol) || nearestFacePoint(walls, p, anchor, axis, tol);
    const res = hit || gridPoint(p, anchor, axis, o.grid);
    return { x: Math.round(res.x), y: Math.round(res.y), kind: res.kind, axis };
  }

  // ================================================================== pure helpers: dimensions, stairs, labels
  /**
   * Label placement for a dimension chain. sv = screen positions of the breakpoints, widths = label widths.
   * Level 0 = centred on its segment; 1/2 = staggered outside/inside rows for segments too short; -1 = hidden.
   */
  function layoutChainLabels(sv, widths, pad) {
    const levels = [];
    const lastEnd = { 1: -Infinity, 2: -Infinity };
    let alt = 1;
    for (let i = 0; i < sv.length - 1; i++) {
      const seg = sv[i + 1] - sv[i];
      const wdt = widths[i];
      if (seg < 3) {
        levels.push(-1);
        continue;
      }
      if (wdt + pad <= seg) {
        levels.push(0);
        alt = 1;
        continue;
      }
      const mid = (sv[i] + sv[i + 1]) / 2;
      const start = mid - wdt / 2;
      let lvl = alt;
      if (start < lastEnd[lvl] + 3) lvl = lvl === 1 ? 2 : 1;
      if (start < lastEnd[lvl] + 3) {
        levels.push(-1);
        continue;
      }
      lastEnd[lvl] = mid + wdt / 2;
      levels.push(lvl);
      alt = lvl === 1 ? 2 : 1;
    }
    return levels;
  }
  /** A round scale-bar length whose screen size is at least 70 px. */
  function niceScaleBar(scale) {
    const cands = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
    for (const mm of cands) if (mm * scale >= 70) return { mm, px: mm * scale };
    return { mm: 50000, px: 50000 * scale };
  }
  function scaleLabel(mm) {
    const m = mm / 1000;
    return String(m).replace('.', ',') + ' m';
  }
  const rectOfStair = (s) => ({ x0: s.x, y0: s.y, x1: s.x + s.length, y1: s.y + s.width });
  const rectsOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  /** Stairs to draw on floor index `idx`: rising from it ('up'), else arriving from the floor below ('down'). */
  function stairsForFloor(doc, idx) {
    const floor = doc.floors[idx];
    if (!floor) return [];
    const rising = doc.stairs.filter((s) => s.floor === floor.id);
    const below = idx > 0 ? doc.floors[idx - 1] : null;
    const arriving = below
      ? doc.stairs.filter((s) => s.floor === below.id && !rising.some((r) => rectsOverlap(rectOfStair(r), rectOfStair(s))))
      : [];
    return rising
      .map((st) => ({ st, mode: 'up', h: floor.height }))
      .concat(arriving.map((st) => ({ st, mode: 'down', h: below.height })));
  }
  function roomLabelLines(r, showName, showArea) {
    const lines = [];
    if (showName) lines.push({ text: r.open ? r.name + ' (aberto)' : r.name, kind: 'name' });
    if (showArea && !r.open) {
      lines.push({ text: 'A=' + U.fmtArea(r.area), kind: 'area' });
      if (r.planArea != null && Math.abs(r.area - r.planArea) > 0.01)
        lines.push({ text: '(projeto ' + r.planArea.toFixed(2).replace('.', ',') + ')', kind: 'plan' });
    }
    return lines;
  }
  /** Side (+1 = wall's left normal) where an opening's tag goes: opposite the swing for doors, outside for windows. */
  function tagSideOf(doc, floorId, w, op) {
    if (op.type === 'door') return -(op.side || 1);
    const f = G.openingFrame(w, op);
    const probe = w.thick / 2 + 300;
    const pos = safeRoomAt(doc, floorId, f.c.x + f.n.x * probe, f.c.y + f.n.y * probe);
    const neg = safeRoomAt(doc, floorId, f.c.x - f.n.x * probe, f.c.y - f.n.y * probe);
    const posIn = !!pos && !pos.outdoor, negIn = !!neg && !neg.outdoor;
    if (posIn && !negIn) return -1;
    if (negIn && !posIn) return 1;
    return op.side || 1;
  }
  /** Distances from an item's four sides to the nearest wall along each side's outward normal. */
  function sideRays(doc, floorId, it) {
    const out = [];
    [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([lx, ly]) => {
      const ext = lx ? it.w / 2 : it.d / 2;
      const o = U.localToWorld(it.x, it.y, it.rot || 0, lx * ext, ly * ext);
      const dir = U.localToWorld(0, 0, it.rot || 0, lx, ly);
      const r = G.raycastWalls(doc, floorId, o, dir, RAY_MAX_MM);
      if (isFinite(r.dist) && r.dist > 5 && r.dist < RAY_MAX_MM)
        out.push({ a: o, b: { x: o.x + dir.x * r.dist, y: o.y + dir.y * r.dist }, dist: r.dist });
    });
    return out;
  }
  /** Wall faces matching the snaps returned by DD.geom.snapFurniture. */
  function snapFaces(doc, snaps) {
    const out = [];
    (snaps || []).forEach((s) => {
      const w = OPS.byId(doc, 'walls', s.wall);
      if (!w) return;
      const f = G.wallFaces(w).find((fc) => fc.n.x * s.n.x + fc.n.y * s.n.y > 0.99);
      if (f) out.push({ a: f.a, b: f.b });
    });
    return out;
  }
  /**
   * Nearest wall face in front of p within `maxGap` → { rot, face, dist }, where `rot` puts an item's back
   * (local −y) against that face; null when no face is close enough.
   */
  function backToWallPlacement(doc, floorId, p, maxGap) {
    let best = null, bestD = maxGap;
    doc.walls.forEach((w) => {
      if (w.floor !== floorId || w.kind === 'railing') return;
      G.wallFaces(w).forEach((f) => {
        const sd = U.segDist(p, f.a, f.b);
        const side = (p.x - f.a.x) * f.n.x + (p.y - f.a.y) * f.n.y;
        if (side > 0 && sd.d < bestD) {
          bestD = sd.d;
          best = { face: f, dist: side };
        }
      });
    });
    if (!best) return null;
    const n = best.face.n;
    return { rot: U.normDeg(U.deg(Math.atan2(n.x, -n.y)) + 180), face: best.face, dist: best.dist };
  }
  const backToWallRotation = (doc, floorId, p, maxGap) => {
    const r = backToWallPlacement(doc, floorId, p, maxGap);
    return r ? r.rot : null;
  };

  // ================================================================== caches
  const roomPathCache = new WeakMap();
  const stairGeoCache = new WeakMap();
  const tagSideCache = new WeakMap();
  const patternCache = new WeakMap(); // ctx → Map(materialId → CanvasPattern)
  let wallGeoCache = null;
  let dimCache = null;

  function safeRooms(doc, floorId) {
    try {
      return DD.rooms.compute(doc, floorId);
    } catch (e) {
      warnOnce('rooms.compute', e);
      return [];
    }
  }
  function roomPath(r) {
    let p = roomPathCache.get(r);
    if (p) return p;
    p = new Path2D();
    [r.outer].concat(r.holes || []).forEach((loop) => {
      if (!loop || !loop.length) return;
      p.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i++) p.lineTo(loop[i].x, loop[i].y);
      p.closePath();
    });
    roomPathCache.set(r, p);
    return p;
  }
  function stairGeo(st, h) {
    const c = stairGeoCache.get(st);
    if (c && c.h === h) return c.g;
    const g = G.stairGeometry(st, h);
    stairGeoCache.set(st, { h, g });
    return g;
  }
  function dimensionData(doc, floorId) {
    if (dimCache && dimCache.walls === doc.walls && dimCache.floorId === floorId) return dimCache.data;
    let data = null;
    try {
      data = G.dimensionData(doc, floorId);
    } catch (e) {
      warnOnce('dimensionData', e);
    }
    dimCache = { walls: doc.walls, floorId, data };
    return data;
  }
  function tagSide(doc, floorId, w, op) {
    const c = tagSideCache.get(op);
    if (c && c.walls === doc.walls && c.seeds === doc.roomSeeds) return c.side;
    const side = tagSideOf(doc, floorId, w, op);
    tagSideCache.set(op, { walls: doc.walls, seeds: doc.roomSeeds, side });
    return side;
  }
  function materialEntry(id) {
    try {
      return (DD.materials && DD.materials.get(id)) || null;
    } catch (e) {
      return null;
    }
  }
  const materialName = (id) => (materialEntry(id) || {}).name || id;
  function materialColor(id) {
    const m = materialEntry(id);
    return (m && m.base) || '#E4DCCB';
  }
  /** World-scaled repeating pattern for a material (one 512 px tile covers tileMM mm). */
  function materialPattern(ctx, id) {
    let m = patternCache.get(ctx);
    if (!m) {
      m = new Map();
      patternCache.set(ctx, m);
    }
    if (m.has(id)) return m.get(id);
    let pat = null;
    try {
      const cv = DD.materials && DD.materials.canvas(id);
      if (!cv) return null; // not ready yet: try again next frame
      pat = ctx.createPattern(cv, 'repeat');
      const tile = (materialEntry(id) || {}).tileMM || 600;
      if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined')
        pat.setTransform(new DOMMatrix().scaleSelf(tile / (cv.width || 512), tile / (cv.height || 512)));
    } catch (e) {
      warnOnce('pattern:' + id, e);
      pat = null;
    }
    m.set(id, pat);
    return pat;
  }

  /** Cut-plane geometry of a floor's walls, grouped by kind (Path2D in world units). Cached by identity. */
  function wallGeometry(doc, floorId, fadeKey) {
    const c = wallGeoCache;
    if (c && c.walls === doc.walls && c.openings === doc.openings && c.floorId === floorId && c.fadeKey === fadeKey) return c.geo;
    const geo = buildWallGeometry(doc, floorId, new Set(fadeKey ? fadeKey.split('|') : []));
    wallGeoCache = { walls: doc.walls, openings: doc.openings, floorId, fadeKey, geo };
    return geo;
  }
  function newKindGeo() {
    return { path: new Path2D(), bbox: emptyBox(), count: 0 };
  }
  function addQuad(path, q) {
    path.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) path.lineTo(q[i].x, q[i].y);
    path.closePath();
  }
  function buildWallGeometry(doc, floorId, fadeSet) {
    const kinds = { structural: newKindGeo(), partition: newKindGeo(), muro: newKindGeo() };
    const railings = [], fading = [], wallMap = new Map(), cuts = new Map();
    doc.openings.forEach((op) => {
      if (!cutsWall(op)) return;
      const list = cuts.get(op.wall) || [];
      list.push({ t0: op.t - op.width / 2, t1: op.t + op.width / 2 });
      cuts.set(op.wall, list);
    });
    doc.walls.forEach((w) => {
      if (w.floor !== floorId) return;
      wallMap.set(w.id, w);
      const quads = solidIntervals(G.wallDir(w).L, cuts.get(w.id) || []).map(([t0, t1]) => pieceQuad(w, t0, t1));
      if (fadeSet.has(w.id)) {
        const path = new Path2D();
        quads.forEach((q) => addQuad(path, q));
        fading.push({ wallId: w.id, path });
      } else if (w.kind === 'railing') {
        railings.push({ w, quads });
      } else {
        const k = kinds[w.kind] || kinds.partition;
        quads.forEach((q) => {
          addQuad(k.path, q);
          q.forEach((p) => growBox(k.bbox, p.x, p.y));
          k.count++;
        });
      }
    });
    return { kinds, railings, fading, wallMap };
  }

  // ================================================================== render context & primitives
  function makeRC(ctx, view, dpr, doc, ui, opts) {
    const o = opts || {};
    let idx = doc.floors.findIndex((f) => f.id === ui.floor);
    if (idx < 0) idx = 0;
    const show = Object.assign({ dims: true, furniture: true, areas: true, grid: true, labels: true, structure: true }, ui.show, o.show);
    return {
      ctx, v: view, dpr, px: 1 / view.scale, doc, ui,
      floorIdx: idx, floor: doc.floors[idx], floorId: doc.floors[idx] ? doc.floors[idx].id : ui.floor,
      isGround: idx === 0, show,
      exporting: !!o.exporting, interactive: !!o.interactive, background: o.background !== false,
      paper: o.exporting ? COL.paperExport : COL.paper, footer: o.footer || 0,
    };
  }
  function toWorldSpace(rc) {
    const v = rc.v, k = rc.dpr * v.scale;
    rc.ctx.setTransform(k, 0, 0, k, rc.dpr * (v.width / 2 - v.cx * v.scale), rc.dpr * (v.height / 2 - v.cy * v.scale));
  }
  function toScreenSpace(rc) {
    rc.ctx.setTransform(rc.dpr, 0, 0, rc.dpr, 0, 0);
  }
  function visibleWorldBox(rc) {
    const a = s2w(rc.v, 0, 0), b = s2w(rc.v, rc.v.width, rc.v.height);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
  function polyPath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }
  function strokeLine(ctx, a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const offsetPt = (p, n, k) => ({ x: p.x + n.x * k, y: p.y + n.y * k });
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function haloText(ctx, text, x, y, fill, halo) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }
  /** Small rounded label centred on (x,y). */
  function drawPill(ctx, text, x, y, o) {
    const opt = o || {};
    ctx.font = opt.font || '600 10.5px ' + FONT_MONO;
    const w = ctx.measureText(text).width + 12, h = opt.h || 18;
    roundRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = opt.bg || 'rgba(251,249,244,0.94)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = opt.border || COL.teal;
    ctx.stroke();
    ctx.fillStyle = opt.fg || COL.teal;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }
  function hatch(ctx, box, sp, color, lw) {
    if (!box) return;
    const k0 = Math.floor((box.minX + box.minY) / sp), k1 = Math.ceil((box.maxX + box.maxY) / sp);
    if (k1 - k0 > 4000) return;
    ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      const c = k * sp;
      ctx.moveTo(c - box.minY, box.minY);
      ctx.lineTo(c - box.maxY, box.maxY);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  function arrowHead(ctx, tip, dir, size) {
    const n = { x: -dir.y, y: dir.x };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - dir.x * size + n.x * size * 0.45, tip.y - dir.y * size + n.y * size * 0.45);
    ctx.lineTo(tip.x - dir.x * size - n.x * size * 0.45, tip.y - dir.y * size - n.y * size * 0.45);
    ctx.closePath();
    ctx.fill();
  }
  function unit(a, b) {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  }

  // ================================================================== scene
  function layer(name, rc, fn) {
    const ctx = rc.ctx;
    ctx.save();
    try {
      fn(rc);
    } catch (e) {
      warnOnce('layer ' + name, e);
    }
    ctx.restore();
  }
  /** Draws the whole plan for rc (screen or export). */
  function drawScene(rc) {
    const ctx = rc.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (rc.background) {
      ctx.fillStyle = rc.paper;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    const world = (name, fn) => layer(name, rc, (r) => (toWorldSpace(r), fn(r)));
    const screen = (name, fn) => layer(name, rc, (r) => (toScreenSpace(r), fn(r)));
    if (rc.isGround) world('site', drawSiteGround);
    if (rc.show.grid && !rc.exporting) world('grid', drawGrid);
    world('ghost', drawGhostBelow);
    world('rooms', drawRooms);
    world('stairs', drawStairs);
    world('separators', drawSeparators);
    if (rc.show.furniture) world('furniture', drawFurniture);
    world('walls', drawWalls);
    world('openings', drawOpenings);
    if (rc.isGround) screen('site labels', drawSiteLabels);
    screen('stair labels', drawStairLabels);
    if (rc.show.dims) screen('dimensions', drawDimensions);
    screen('measures', drawMeasures);
    screen('room labels', drawRoomLabels);
    if (rc.show.labels) screen('tags', drawOpeningTags);
    if (rc.interactive) layer('overlays', rc, drawOverlays);
    screen('corner', drawCornerWidgets);
    ctx.restore();
  }

  // ------------------------------------------------------------------ site, grid, ghost
  function drawSiteGround(rc) {
    const site = rc.doc.site;
    if (!site || !site.lot) return;
    const { ctx, px } = rc;
    const lot = site.lot;
    const x0 = -STREET_SPAN_MM, x1 = lot.w + STREET_SPAN_MM;
    fillWithMaterial(rc, 'calcada', 0.4, () => ctx.rect(x0, lot.h, x1 - x0, SIDEWALK_MM));
    ctx.fillStyle = COL.street;
    ctx.fillRect(x0, lot.h + SIDEWALK_MM, x1 - x0, ROAD_MM);
    ctx.strokeStyle = COL.curb;
    ctx.lineWidth = 1.2 * px;
    strokeLine(ctx, { x: x0, y: lot.h + SIDEWALK_MM }, { x: x1, y: lot.h + SIDEWALK_MM });
    ctx.setLineDash([2400, 1600]);
    ctx.strokeStyle = 'rgba(250,247,240,0.9)';
    ctx.lineWidth = Math.max(100, 1.5 * px);
    const my = lot.h + SIDEWALK_MM + ROAD_MM / 2;
    strokeLine(ctx, { x: x0, y: my }, { x: x1, y: my });
    ctx.setLineDash([]);
    (site.zones || []).forEach((z) => {
      const mat = SITE_MATERIAL[z.kind] || 'grama';
      fillWithMaterial(rc, mat, SITE_ALPHA[z.kind] || 0.4, () => ctx.rect(z.x, z.y, z.w, z.h));
    });
    ctx.setLineDash([14 * px, 4 * px, 2 * px, 4 * px]);
    ctx.strokeStyle = COL.ink;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.2 * px;
    ctx.strokeRect(0, 0, lot.w, lot.h);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  function fillWithMaterial(rc, mat, alpha, pathFn) {
    const ctx = rc.ctx;
    ctx.beginPath();
    pathFn();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = materialPattern(ctx, mat) || materialColor(mat);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawGrid(rc) {
    const s = rc.v.scale, vb = visibleWorldBox(rc);
    const minorPx = 100 * s, majorPx = 1000 * s;
    if (minorPx >= 6) gridLines(rc, vb, 100, COL.gridMinor, U.clamp((minorPx - 6) / 10, 0, 1), 10);
    if (majorPx >= 6) gridLines(rc, vb, 1000, COL.gridMajor, U.clamp((majorPx - 6) / 14, 0.25, 1), 0);
  }
  function gridLines(rc, vb, step, color, alpha, skipEvery) {
    const ctx = rc.ctx;
    ctx.beginPath();
    for (let i = Math.ceil(vb.minX / step); i * step <= vb.maxX; i++) {
      if (skipEvery && i % skipEvery === 0) continue;
      ctx.moveTo(i * step, vb.minY);
      ctx.lineTo(i * step, vb.maxY);
    }
    for (let j = Math.ceil(vb.minY / step); j * step <= vb.maxY; j++) {
      if (skipEvery && j % skipEvery === 0) continue;
      ctx.moveTo(vb.minX, j * step);
      ctx.lineTo(vb.maxX, j * step);
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = rc.px;
    ctx.stroke();
  }
  function drawGhostBelow(rc) {
    if (rc.floorIdx <= 0) return;
    const below = rc.doc.floors[rc.floorIdx - 1];
    const ctx = rc.ctx;
    ctx.beginPath();
    rc.doc.walls.forEach((w) => {
      if (w.floor !== below.id) return;
      const q = G.wallPolygon(w);
      ctx.moveTo(q[0].x, q[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
      ctx.closePath();
    });
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = rc.px;
    ctx.stroke();
  }

  // ------------------------------------------------------------------ rooms, stairs, separators
  function drawRooms(rc) {
    const { ctx, px } = rc;
    safeRooms(rc.doc, rc.floorId).forEach((r) => {
      if (r.open || !r.outer) return;
      const path = roomPath(r);
      ctx.globalAlpha = 1;
      ctx.fillStyle = rc.paper; // opaque underlay so the site texture never shows through a room
      ctx.fill(path, 'evenodd');
      ctx.globalAlpha = ROOM_FILL_ALPHA;
      ctx.fillStyle = materialPattern(ctx, r.material) || materialColor(r.material);
      ctx.fill(path, 'evenodd');
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = COL.roomOutline;
      ctx.lineWidth = px;
      ctx.stroke(path);
    });
    ctx.globalAlpha = 1;
  }
  function drawStairs(rc) {
    stairsForFloor(rc.doc, rc.floorIdx).forEach((entry) => drawStair(rc, entry));
  }
  function drawStair(rc, entry) {
    const { ctx, px } = rc;
    const st = entry.st, g = stairGeo(st, entry.h), fp = g.footprint;
    ctx.fillStyle = COL.stairFill;
    ctx.fillRect(fp.x0, fp.y0, fp.x1 - fp.x0, fp.y1 - fp.y0);
    const breakN = entry.mode === 'up' ? st.lowerCount + Math.ceil(st.upperCount / 2) : Infinity;
    const solid = new Path2D(), dashed = new Path2D();
    g.landing.forEach((l) => solid.rect(l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0));
    g.treads.forEach((t) => (t.n > breakN ? dashed : solid).rect(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0));
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 0.8 * px;
    ctx.stroke(solid);
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.globalAlpha = 0.65;
    ctx.stroke(dashed);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.2 * px;
    ctx.strokeRect(fp.x0, fp.y0, fp.x1 - fp.x0, fp.y1 - fp.y0);
    if (entry.mode === 'up') drawStairBreak(rc, st, g, breakN);
    drawWalkline(rc, g, entry.mode);
  }
  function drawStairBreak(rc, st, g, breakN) {
    const t = g.treads.find((tr) => tr.n === breakN);
    if (!t) return;
    const { ctx, px } = rc;
    const P = { x: t.x0 + 110, y: st.y - 40 }, Q = { x: t.x0 - 110, y: st.y + st.width / 2 };
    const u = unit(P, Q), n = { x: -u.y, y: u.x };
    const M = { x: (P.x + Q.x) / 2, y: (P.y + Q.y) / 2 };
    const pts = [P, offsetPt(M, u, -45), offsetPt(offsetPt(M, u, -15), n, 70), offsetPt(offsetPt(M, u, 15), n, -70), offsetPt(M, u, 45), Q];
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = rc.paper;
    ctx.lineWidth = 4 * px;
    ctx.stroke();
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1 * px;
    ctx.stroke();
  }
  function drawWalkline(rc, g, mode) {
    const { ctx, px } = rc;
    const pts = mode === 'down' ? g.walkline.slice().reverse() : g.walkline;
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 0.9 * px;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 3.5 * px, 0, Math.PI * 2);
    ctx.stroke();
    const last = pts[pts.length - 1];
    ctx.fillStyle = COL.ink;
    arrowHead(ctx, last, unit(pts[pts.length - 2], last), 9 * px);
  }
  function drawSeparators(rc) {
    const { ctx, px } = rc;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeStyle = COL.ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.8 * px;
    (rc.doc.separators || []).forEach((s) => {
      if (s.floor === rc.floorId) strokeLine(ctx, s.a, s.b);
    });
  }

  // ------------------------------------------------------------------ furniture
  function drawFurniture(rc) {
    const doc = rc.doc, ui = rc.ui;
    const items = doc.furniture.filter((it) => it.floor === rc.floorId);
    const ordered = items.filter(isFlat).concat(items.filter((it) => !isFlat(it)));
    const sel = rc.interactive ? ui.selection : null;
    const hov = rc.interactive ? refOf(effectiveHover()) : null;
    const d = rc.interactive ? S.drag : null;
    if (d && d.phase === 'active' && d.startItem && d.type !== 'furnResize') {
      rc.ctx.globalAlpha = 0.28;
      drawFurnitureItem(rc, d.startItem, { ghost: true });
      rc.ctx.globalAlpha = 1;
    }
    ordered.forEach((it) =>
      drawFurnitureItem(rc, it, {
        selected: !!sel && sel.kind === 'furniture' && sel.id === it.id,
        hovered: !!hov && hov.kind === 'furniture' && hov.id === it.id,
      })
    );
  }
  function drawFurnitureItem(rc, it, flags) {
    const ctx = rc.ctx;
    const def = catalogDef(it.type);
    const o = {
      px: rc.px,
      selected: !!flags.selected,
      hovered: !!flags.hovered,
      ghost: !!flags.ghost,
      color: it.color || (def && def.color) || '#B9AE9C',
    };
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(U.rad(it.rot || 0));
    try {
      if (!DD.catalog || typeof DD.catalog.draw2d !== 'function') throw new Error('catalog indisponível');
      DD.catalog.draw2d(ctx, it, o);
    } catch (e) {
      warnOnce('draw2d:' + it.type, e);
      drawFallbackFurniture(ctx, it, o);
    }
    ctx.restore();
  }
  function drawFallbackFurniture(ctx, it, o) {
    ctx.setLineDash([]);
    ctx.globalAlpha = o.ghost ? 0.3 : 1;
    ctx.fillStyle = o.color;
    ctx.fillRect(-it.w / 2, -it.d / 2, it.w, it.d);
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1.2 * o.px;
    ctx.strokeRect(-it.w / 2, -it.d / 2, it.w, it.d);
    ctx.lineWidth = 2.2 * o.px;
    strokeLine(ctx, { x: -it.w / 2, y: it.d / 2 }, { x: it.w / 2, y: it.d / 2 }); // front edge
  }

  // ------------------------------------------------------------------ walls
  const fadingKey = (rc) =>
    rc.exporting ? '' : S.fades.filter((f) => f.floor === rc.floorId).map((f) => f.wallId).join('|');

  function drawWalls(rc) {
    const geo = wallGeometry(rc.doc, rc.floorId, fadingKey(rc));
    const px = rc.px;
    rc.ctx.lineJoin = 'miter';
    drawWallKind(rc, geo.kinds.muro, COL.muro, { hatch: Math.max(160, 9 * px), hatchColor: COL.muroHatch, outline: true });
    drawWallKind(rc, geo.kinds.partition, COL.partition, { hatch: Math.max(45, 5 * px), hatchColor: COL.partitionHatch, outline: true });
    drawRailings(rc, geo.railings);
    const structural = rc.show.structure === false ? COL.structuralMuted : COL.structural;
    drawWallKind(rc, geo.kinds.structural, structural, { outline: false });
    drawFadingWalls(rc, geo.fading);
  }
  function drawWallKind(rc, k, fill, o) {
    if (!k.count) return;
    const { ctx, px } = rc;
    // union outline trick: stroke every piece, then fill on top → only the silhouette of the union stays visible
    if (o.outline) {
      ctx.strokeStyle = COL.ink;
      ctx.lineWidth = 2 * px;
      ctx.stroke(k.path);
    }
    ctx.fillStyle = fill;
    ctx.fill(k.path);
    if (o.hatch) {
      ctx.save();
      ctx.clip(k.path);
      hatch(ctx, intersectBox(k.bbox, visibleWorldBox(rc)), o.hatch, o.hatchColor, 0.8 * px);
      ctx.restore();
    }
  }
  function drawRailings(rc, railings) {
    const { ctx, px } = rc;
    ctx.strokeStyle = COL.ink;
    railings.forEach(({ w, quads }) => {
      quads.forEach((q) => {
        polyPath(ctx, q);
        ctx.fillStyle = rc.paper;
        ctx.fill();
        ctx.lineWidth = px;
        ctx.stroke();
        ctx.lineWidth = 0.8 * px;
        strokeLine(ctx, { x: (q[0].x + q[3].x) / 2, y: (q[0].y + q[3].y) / 2 }, { x: (q[1].x + q[2].x) / 2, y: (q[1].y + q[2].y) / 2 });
      });
      void w;
    });
  }
  function drawFadingWalls(rc, fading) {
    const ctx = rc.ctx, now = clock();
    fading.forEach((f) => {
      const fade = S.fades.find((x) => x.wallId === f.wallId);
      const t = fade ? U.clamp((now - fade.t0) / DEMOLISH_FADE_MS, 0, 1) : 1;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = COL.coral;
      ctx.fill(f.path);
    });
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ openings
  function drawOpenings(rc) {
    const geo = wallGeometry(rc.doc, rc.floorId, fadingKey(rc));
    rc.ctx.lineCap = 'butt';
    rc.doc.openings.forEach((op) => {
      const w = geo.wallMap.get(op.wall);
      if (!w) return;
      try {
        drawOpeningSymbol(rc, w, op, G.openingFrame(w, op));
      } catch (e) {
        warnOnce('opening:' + op.style, e);
      }
    });
  }
  function drawOpeningSymbol(rc, w, op, f) {
    const cut = cutsWall(op);
    if (cut) {
      polyPath(rc.ctx, pieceQuad(w, f.t0, f.t1));
      rc.ctx.fillStyle = rc.paper;
      rc.ctx.fill();
    }
    rc.ctx.setLineDash([]);
    if (op.type === 'door') drawDoorSymbol(rc, w, op, f);
    else drawWindowSymbol(rc, w, op, f, !cut);
  }
  function drawDoorSymbol(rc, w, op, f) {
    const h = w.thick / 2, side = op.side || 1;
    switch (op.style) {
      case 'double':
        drawSwingLeaf(rc, f.start, f.c, f.n, side, h, op.width / 2);
        drawSwingLeaf(rc, f.end, f.c, f.n, side, h, op.width / 2);
        break;
      case 'slide':
        drawSlidingPanels(rc, w, op, f, 1);
        break;
      case 'slide4':
        drawSlidingPanels(rc, w, op, f, 4);
        break;
      case 'gateSlide':
        drawGateSlide(rc, w, op, f);
        break;
      default: {
        // 'swing' and 'gate'
        const hinge = op.hinge === 'end' ? f.end : f.start;
        const other = op.hinge === 'end' ? f.start : f.end;
        drawSwingLeaf(rc, hinge, other, f.n, side, h, op.width, op.style === 'gate');
      }
    }
  }
  function drawSwingLeaf(rc, hinge, closedEnd, n, side, h, len, heavy) {
    const { ctx, px } = rc;
    const H = offsetPt(hinge, n, side * h);
    const O = offsetPt(closedEnd, n, side * h);
    const tip = offsetPt(H, n, side * len);
    const along = unit(H, O);
    const lt = heavy ? 50 : 35;
    polyPath(ctx, [H, tip, offsetPt(tip, along, lt), offsetPt(H, along, lt)]);
    ctx.fillStyle = rc.paper;
    ctx.fill();
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1.1 * px;
    ctx.stroke();
    const a0 = Math.atan2(tip.y - H.y, tip.x - H.x), a1 = Math.atan2(O.y - H.y, O.x - H.x);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(H.x, H.y, len, a0, a1, delta < 0);
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 0.8 * px;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function panelQuad(w, f, t0, t1, u0, u1) {
    const a = { x: w.a.x + f.d.x * t0, y: w.a.y + f.d.y * t0 };
    const b = { x: w.a.x + f.d.x * t1, y: w.a.y + f.d.y * t1 };
    return [offsetPt(a, f.n, u0), offsetPt(b, f.n, u0), offsetPt(b, f.n, u1), offsetPt(a, f.n, u1)];
  }
  function drawPanel(rc, q) {
    const ctx = rc.ctx;
    polyPath(ctx, q);
    ctx.fillStyle = rc.paper;
    ctx.fill();
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1 * rc.px;
    ctx.stroke();
  }
  function drawSlideArrow(rc, from, dir, len) {
    const { ctx, px } = rc;
    const to = offsetPt(from, dir, len);
    ctx.strokeStyle = COL.ink;
    ctx.fillStyle = COL.ink;
    ctx.lineWidth = 0.8 * px;
    strokeLine(ctx, from, to);
    arrowHead(ctx, to, dir, 7 * px);
  }
  function drawSlidingPanels(rc, w, op, f, count) {
    const side = op.side || 1, h = w.thick / 2;
    const T = Math.min(w.thick * 0.28, 40);
    const seg = op.width / count, ov = Math.min(40, seg * 0.1);
    for (let i = 0; i < count; i++) {
      const t0 = f.t0 + i * seg - (i > 0 ? ov : 0);
      const t1 = f.t0 + (i + 1) * seg + (i < count - 1 ? ov : 0);
      const track = count === 1 ? side * w.thick * 0.18 : (i === 0 || i === count - 1 ? -1 : 1) * side * w.thick * 0.16;
      drawPanel(rc, panelQuad(w, f, t0, t1, track - T / 2, track + T / 2));
    }
    const outside = offsetPt(f.c, f.n, side * (h + 110));
    if (count === 1) {
      const dir = op.hinge === 'end' ? f.d : { x: -f.d.x, y: -f.d.y };
      drawSlideArrow(rc, offsetPt(outside, dir, -op.width * 0.2), dir, Math.min(op.width * 0.5, 500));
    } else {
      const back = { x: -f.d.x, y: -f.d.y };
      drawSlideArrow(rc, offsetPt(outside, back, 60), back, seg * 0.8);
      drawSlideArrow(rc, offsetPt(outside, f.d, 60), f.d, seg * 0.8);
    }
  }
  function drawGateSlide(rc, w, op, f) {
    const side = op.side || 1, h = w.thick / 2;
    drawPanel(rc, panelQuad(w, f, f.t0 - 60, f.t1 + 60, side * (h + 20), side * (h + 70)));
    const dir = op.hinge === 'end' ? f.d : { x: -f.d.x, y: -f.d.y };
    const from = offsetPt(f.c, f.n, side * (h + 230));
    drawSlideArrow(rc, offsetPt(from, dir, -op.width * 0.25), dir, op.width * 0.5);
  }
  function drawWindowSymbol(rc, w, op, f, above) {
    const { ctx, px } = rc;
    const h = w.thick / 2;
    const onDark = above && w.kind !== 'partition' && w.kind !== 'railing';
    ctx.strokeStyle = onDark ? COL.onDark : COL.ink;
    ctx.lineWidth = 0.9 * px;
    if (above) ctx.setLineDash([5 * px, 3.5 * px]);
    strokeLine(ctx, offsetPt(f.start, f.n, h), offsetPt(f.end, f.n, h));
    strokeLine(ctx, offsetPt(f.start, f.n, -h), offsetPt(f.end, f.n, -h));
    if (!above) {
      strokeLine(ctx, offsetPt(f.start, f.n, h), offsetPt(f.start, f.n, -h));
      strokeLine(ctx, offsetPt(f.end, f.n, h), offsetPt(f.end, f.n, -h));
    }
    if (op.style === 'slide2') {
      const T = Math.min(30, w.thick * 0.2), ov = Math.min(40, op.width * 0.05), u = w.thick * 0.14;
      const q1 = panelQuad(w, f, f.t0, f.t0 + op.width / 2 + ov, -u - T / 2, -u + T / 2);
      const q2 = panelQuad(w, f, f.t1 - op.width / 2 - ov, f.t1, u - T / 2, u + T / 2);
      [q1, q2].forEach((q) => {
        polyPath(ctx, q);
        if (!above) {
          ctx.fillStyle = rc.paper;
          ctx.fill();
        }
        ctx.stroke();
      });
    } else {
      const g = Math.min(12, w.thick * 0.08);
      strokeLine(ctx, offsetPt(f.start, f.n, g), offsetPt(f.end, f.n, g));
      strokeLine(ctx, offsetPt(f.start, f.n, -g), offsetPt(f.end, f.n, -g));
      if (op.style === 'fixedMaxar') strokeLine(ctx, offsetPt(f.c, f.n, h), offsetPt(f.c, f.n, -h));
      if (op.style === 'pivot') {
        ctx.beginPath();
        ctx.arc(f.c.x, f.c.y, Math.max(25, 2.5 * px), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  // ------------------------------------------------------------------ screen annotations
  function drawSiteLabels(rc) {
    const site = rc.doc.site;
    if (!site || !site.lot || !site.street) return;
    const ctx = rc.ctx;
    const p = w2s(rc.v, { x: site.lot.w / 2, y: site.lot.h + SIDEWALK_MM + ROAD_MM * STREET_NAME_AT });
    ctx.font = '600 12px ' + FONT_UI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    haloText(ctx, String(site.street).toUpperCase(), p.x, p.y, '#5E574D', COL.street);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  function drawStairLabels(rc) {
    const { ctx, v } = rc;
    stairsForFloor(rc.doc, rc.floorIdx).forEach(({ st, mode, h }) => {
      const g = stairGeo(st, h);
      if (st.tread * v.scale >= 11) {
        ctx.font = '500 8px ' + FONT_MONO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COL.muted;
        g.treads.forEach((t) => {
          // near the outer stringer so the number never sits on the walk line (row centre)
          const y = t.flight === 0 ? t.y1 - (t.y1 - t.y0) * 0.24 : t.y0 + (t.y1 - t.y0) * 0.24;
          const c = w2s(v, { x: (t.x0 + t.x1) / 2, y });
          ctx.fillText(String(t.n), c.x, c.y);
        });
      }
      const pos = w2s(v, { x: st.x, y: st.y + st.width * (mode === 'up' ? 0.75 : 0.25) });
      ctx.font = '700 12px ' + FONT_UI;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      haloText(ctx, mode === 'up' ? 'S' : 'D', pos.x - 6, pos.y, COL.ink, rc.paper);
    });
  }
  function drawDimensions(rc) {
    const dd = dimensionData(rc.doc, rc.floorId);
    if (!dd) return;
    const b = dd.bbox;
    rc.ctx.font = '500 10px ' + FONT_MONO;
    drawChain(rc, dd.xs, 'top', b.minY);
    drawChain(rc, dd.xsExt, 'bottom', b.maxY);
    drawChain(rc, dd.ys, 'left', b.minX);
    drawChain(rc, dd.ysExt, 'right', b.maxX);
  }
  function drawChain(rc, values, side, edge) {
    if (!values || values.length < 2) return;
    drawChainLine(rc, values, side, edge, DIM_OFFSET_PX);
    if (values.length > 2) drawChainLine(rc, [values[0], values[values.length - 1]], side, edge, DIM_OVERALL_PX);
  }
  function drawChainLine(rc, values, side, edge, offPx) {
    const { ctx, v } = rc;
    const horiz = side === 'top' || side === 'bottom';
    const sign = side === 'top' || side === 'left' ? -1 : 1;
    const edgeS = horiz ? w2sY(v, edge) : w2sX(v, edge);
    const lineS = edgeS + sign * offPx;
    const sv = values.map((x) => (horiz ? w2sX(v, x) : w2sY(v, x)));
    const P = (along, across) => (horiz ? [along, across] : [across, along]);
    ctx.strokeStyle = COL.dimLine;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(...P(sv[0] - 6, lineS));
    ctx.lineTo(...P(sv[sv.length - 1] + 6, lineS));
    sv.forEach((s) => {
      ctx.moveTo(...P(s, edgeS + sign * DIM_EXT_GAP_PX));
      ctx.lineTo(...P(s, lineS + sign * 4));
    });
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    sv.forEach((s) => {
      const [x, y] = P(s, lineS);
      ctx.moveTo(x - 3.5, y + 3.5);
      ctx.lineTo(x + 3.5, y - 3.5);
    });
    ctx.stroke();
    drawChainTexts(rc, values, sv, lineS, sign, horiz);
  }
  function drawChainTexts(rc, values, sv, lineS, sign, horiz) {
    const ctx = rc.ctx;
    const labels = [];
    for (let i = 0; i < values.length - 1; i++) labels.push(U.fmtM(values[i + 1] - values[i]));
    const levels = layoutChainLabels(sv, labels.map((t) => ctx.measureText(t).width), 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const rows = { 0: lineS - 3, 1: sign < 0 ? lineS - 15 : lineS + 13, 2: sign < 0 ? lineS + 13 : lineS - 15 };
    levels.forEach((lvl, i) => {
      if (lvl < 0) return;
      const mid = (sv[i] + sv[i + 1]) / 2;
      if (horiz) {
        haloText(ctx, labels[i], mid, rows[lvl], COL.dimText, rc.paper);
      } else {
        ctx.save();
        ctx.translate(rows[lvl], mid);
        ctx.rotate(-Math.PI / 2);
        haloText(ctx, labels[i], 0, 0, COL.dimText, rc.paper);
        ctx.restore();
      }
    });
  }
  /** Dimension-style line between two world points (screen space): ticks at the ends and a pill label. */
  function drawMeasureLine(rc, a, b, color, label, dashed) {
    const { ctx, v } = rc;
    const A = w2s(v, a), B = w2s(v, b);
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    if (len < 1) return;
    const u = unit(A, B);
    let n = { x: -u.y, y: u.x };
    if (n.y > 0 || (n.y === 0 && n.x > 0)) n = { x: -n.x, y: -n.y };
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (dashed) ctx.setLineDash([6, 4]);
    strokeLine(ctx, A, B);
    ctx.setLineDash([]);
    ctx.lineWidth = 1.3;
    [A, B].forEach((P) => strokeLine(ctx, offsetPt(P, n, -6), offsetPt(P, n, 6)));
    ctx.fillStyle = color;
    [A, B].forEach((P) => {
      ctx.beginPath();
      ctx.arc(P.x, P.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    if (label && len > 24) drawPill(ctx, label, (A.x + B.x) / 2 + n.x * 13, (A.y + B.y) / 2 + n.y * 13, { fg: color, border: color });
  }
  function drawMeasures(rc) {
    const sel = rc.interactive ? rc.ui.selection : null;
    const hov = rc.interactive ? refOf(effectiveHover()) : null;
    (rc.doc.measures || []).forEach((m) => {
      if (m.floor !== rc.floorId) return;
      const isSel = !!sel && sel.kind === 'measure' && sel.id === m.id;
      const isHov = !!hov && hov.kind === 'measure' && hov.id === m.id;
      const color = isSel || isHov ? COL.coral : COL.teal;
      drawMeasureLine(rc, m.a, m.b, color, U.fmtM(U.dist(m.a, m.b)) + ' m', false);
    });
  }
  function drawRoomLabels(rc) {
    const showName = rc.show.labels !== false, showArea = rc.show.areas !== false;
    if (!showName && !showArea) return;
    const { ctx, v } = rc;
    const sel = rc.interactive ? rc.ui.selection : null;
    const nameSize = U.clamp(8 + v.scale * 40, 10, 14);
    const smallSize = Math.max(9, nameSize - 2.5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    safeRooms(rc.doc, rc.floorId).forEach((r) => {
      const x = w2sX(v, r.labelX), y = w2sY(v, r.labelY);
      if (x < -120 || y < -60 || x > v.width + 120 || y > v.height + 60) return;
      const lines = roomLabelLines(r, showName, showArea);
      const heights = lines.map((l) => (l.kind === 'name' ? nameSize + 4 : smallSize + 3));
      let cy = y - heights.reduce((a, b) => a + b, 0) / 2;
      const isSel = !!sel && sel.kind === 'room' && sel.id === r.id;
      lines.forEach((l, i) => {
        cy += heights[i] / 2;
        if (l.kind === 'name') {
          ctx.font = '600 ' + nameSize + 'px ' + FONT_UI;
          haloText(ctx, l.text, x, cy, isSel ? COL.coral : r.open ? COL.muted : COL.ink, rc.paper);
        } else {
          ctx.font = (l.kind === 'area' ? '500 ' : '400 ') + smallSize + 'px ' + FONT_MONO;
          haloText(ctx, l.text, x, cy, l.kind === 'area' ? COL.dimText : COL.muted, rc.paper);
        }
        cy += heights[i] / 2;
      });
    });
  }
  function drawOpeningTags(rc) {
    if (rc.v.scale < TAG_MIN_SCALE) return;
    const { ctx, v, px } = rc;
    const geo = wallGeometry(rc.doc, rc.floorId, fadingKey(rc));
    ctx.font = '600 8.5px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    rc.doc.openings.forEach((op) => {
      const w = geo.wallMap.get(op.wall);
      if (!w || !op.code) return;
      const f = G.openingFrame(w, op);
      const side = tagSide(rc.doc, rc.floorId, w, op);
      const p = w2s(v, offsetPt(f.c, f.n, side * (w.thick / 2 + TAG_GAP_PX * px)));
      if (p.x < -20 || p.y < -20 || p.x > v.width + 20 || p.y > v.height + 20) return;
      const r = Math.max(9.5, ctx.measureText(op.code).width / 2 + 4);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = rc.paper;
      ctx.fill();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = COL.ink;
      ctx.stroke();
      ctx.fillStyle = COL.ink;
      ctx.fillText(op.code, p.x, p.y + 0.5);
    });
  }
  function drawCornerWidgets(rc) {
    const bottom = rc.v.height - rc.footer - 18;
    drawScaleBar(rc, 18, bottom);
    drawNorthArrow(rc, 36, bottom - 52);
  }
  function drawScaleBar(rc, x, y) {
    const ctx = rc.ctx;
    const nb = niceScaleBar(rc.v.scale);
    const label = scaleLabel(nb.mm);
    ctx.font = '500 9.5px ' + FONT_MONO;
    const lw = ctx.measureText(label).width;
    roundRectPath(ctx, x - 8, y - 24, nb.px + lw / 2 + 20, 34, 6);
    ctx.fillStyle = rc.exporting ? 'rgba(255,255,255,0.9)' : 'rgba(243,239,230,0.88)';
    ctx.fill();
    const segs = 4, sw = nb.px / segs;
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i % 2 ? rc.paper : COL.ink;
      ctx.fillRect(x + i * sw, y - 5, sw, 5);
    }
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x, y - 5, nb.px, 5);
    ctx.fillStyle = COL.dimText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('0', x, y - 9);
    ctx.fillText(label, x + nb.px, y - 9);
  }
  function drawNorthArrow(rc, x, y) {
    const ctx = rc.ctx;
    const site = rc.doc.site || {};
    const deg = typeof site.northDeg === 'number' ? site.northDeg : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fillStyle = rc.exporting ? 'rgba(255,255,255,0.9)' : 'rgba(243,239,230,0.88)';
    ctx.fill();
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    const r = U.rad(deg);
    ctx.rotate(r);
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(-5, 7);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fillStyle = COL.ink;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(5, 7);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fillStyle = rc.paper;
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.rotate(-r);
    ctx.font = '700 10px ' + FONT_UI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    haloText(ctx, 'N', Math.sin(r) * 23, -Math.cos(r) * 23, COL.ink, rc.paper);
    ctx.restore();
  }

  // ------------------------------------------------------------------ interactive overlays
  function effectiveHover() {
    if (S.drag && S.drag.phase === 'active') return null;
    if (S.pointerInside) return S.hover;
    const st = store();
    return (st && st.ui.hover) || null;
  }
  function drawOverlays(rc) {
    const sel = rc.ui.selection;
    const hov = refOf(effectiveHover());
    toWorldSpace(rc);
    if (hov && !sameRef(hov, sel) && !isToolHover(rc.ui.tool)) highlightShape(rc, hov, false);
    if (sel) highlightShape(rc, sel, true);
    toolOverlayWorld(rc);
    feedbackWorld(rc);
    toScreenSpace(rc);
    selectionScreen(rc);
    toolOverlayScreen(rc);
    feedbackScreen(rc);
  }
  const isToolHover = (tool) => tool === 'demolish' || tool === 'paint';

  function wallOnFloor(doc, id, floorId) {
    const w = OPS.byId(doc, 'walls', id);
    return w && w.floor === floorId ? w : null;
  }
  function highlightShape(rc, ref, selected) {
    const { ctx, px, doc, floorId } = rc;
    ctx.save();
    ctx.strokeStyle = COL.coral;
    ctx.fillStyle = COL.coral;
    ctx.lineWidth = (selected ? 1.8 : 1.2) * px;
    if (!selected) ctx.setLineDash([5 * px, 3 * px]);
    const fillAlpha = selected ? 0.14 : 0.08;
    const shape = highlightGeometry(doc, floorId, ref, px);
    if (shape && shape.path) {
      // rooms: hovering is frequent (any empty spot), so keep it a whisper; selection is clear
      ctx.setLineDash([]);
      ctx.globalAlpha = selected ? 0.08 : 0.04;
      ctx.fill(shape.path, 'evenodd');
      ctx.globalAlpha = selected ? 1 : 0.35;
      ctx.lineWidth = (selected ? 2.2 : 1) * px;
      ctx.stroke(shape.path);
    } else if (shape && shape.poly) {
      polyPath(ctx, shape.poly);
      ctx.globalAlpha = fillAlpha;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    ctx.restore();
  }
  function highlightGeometry(doc, floorId, ref, px) {
    switch (ref.kind) {
      case 'furniture': {
        const it = OPS.byId(doc, 'furniture', ref.id);
        if (!it || it.floor !== floorId) return null;
        return { poly: G.furnitureCorners(Object.assign({}, it, { w: it.w + 4 * px, d: it.d + 4 * px })) };
      }
      case 'wall': {
        const w = wallOnFloor(doc, ref.id, floorId);
        return w ? { poly: G.wallPolygon(w) } : null;
      }
      case 'opening': {
        const op = OPS.byId(doc, 'openings', ref.id);
        const w = op && wallOnFloor(doc, op.wall, floorId);
        return w ? { poly: pieceQuad(w, op.t - op.width / 2, op.t + op.width / 2, 3 * px) } : null;
      }
      case 'room': {
        const r = DD.rooms.byId(doc, floorId, ref.id);
        return r && r.outer ? { path: roomPath(r) } : null;
      }
      default:
        return null;
    }
  }
  function toolOverlayWorld(rc) {
    const { ctx, px, doc, floorId, ui } = rc;
    const hov = S.pointerInside ? S.hover : null;
    if (ui.tool === 'demolish' && hov && hov.kind === 'wall') {
      const w = wallOnFloor(doc, hov.id, floorId);
      if (w) {
        polyPath(ctx, G.wallPolygon(w));
        const editable = OPS.isEditableWall(w);
        ctx.globalAlpha = editable ? 0.25 : 0.1;
        ctx.fillStyle = editable ? COL.coral : COL.muted;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.setLineDash([5 * px, 3 * px]);
        ctx.strokeStyle = editable ? COL.coral : COL.muted;
        ctx.lineWidth = 1.6 * px;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (ui.tool === 'paint' && hov && hov.kind === 'room') {
      const r = DD.rooms.byId(doc, floorId, hov.id);
      if (r && r.outer) {
        const path = roomPath(r);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = materialPattern(ctx, ui.paintMaterial) || materialColor(ui.paintMaterial);
        ctx.fill(path, 'evenodd');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COL.coral;
        ctx.lineWidth = 2 * px;
        ctx.stroke(path);
      }
    }
    if (ui.tool === 'wall' && S.wallDraw && U.dist(S.wallDraw.a, S.wallDraw.cur) > 1) {
      const w = { a: S.wallDraw.a, b: S.wallDraw.cur, thick: NEW_WALL_THICK_MM };
      polyPath(ctx, G.wallPolygon(w));
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = COL.partition;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COL.teal;
      ctx.lineWidth = 1.2 * px;
      ctx.stroke();
    }
  }
  function feedbackWorld(rc) {
    const fb = S.feedback;
    if (!fb) return;
    const { ctx, px } = rc;
    ctx.strokeStyle = COL.teal;
    if (fb.ghostWall) {
      polyPath(ctx, fb.ghostWall);
      ctx.setLineDash([5 * px, 3 * px]);
      ctx.lineWidth = 1.2 * px;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    (fb.faces || []).forEach((f) => {
      ctx.lineWidth = 3 * px;
      ctx.lineCap = 'round';
      strokeLine(ctx, f.a, f.b);
    });
  }
  function selectionScreen(rc) {
    const { ctx, v, doc, floorId, ui } = rc;
    const sel = ui.selection;
    if (!sel || ui.tool !== 'select') return;
    const d = S.drag && S.drag.phase === 'active' ? S.drag : null;
    if (sel.kind === 'furniture') {
      const it = OPS.byId(doc, 'furniture', sel.id);
      if (!it || it.floor !== floorId || !rc.show.furniture) return;
      if (!d || d.type !== 'furnMove') drawFurnitureHandles(rc, it);
      drawSizeLabel(rc, it, !!d && d.type === 'furnResize');
      return;
    }
    if (sel.kind === 'wall') {
      const w = wallOnFloor(doc, sel.id, floorId);
      if (!w) return;
      if (OPS.isEditableWall(w)) {
        [w.a, w.b].forEach((p) => {
          const s = w2s(v, p);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.strokeStyle = COL.coral;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        });
      } else {
        const m = w2s(v, { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
        drawLockBadge(ctx, m.x, m.y);
      }
    }
  }
  function drawFurnitureHandles(rc, it) {
    const { ctx, v, px } = rc;
    const h = furnitureHandles(it, px);
    const stem = w2s(v, { x: h.rotate.stemX, y: h.rotate.stemY });
    const knob = w2s(v, h.rotate);
    ctx.strokeStyle = COL.coral;
    ctx.lineWidth = 1;
    strokeLine(ctx, stem, knob);
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, 3, -Math.PI * 0.9, Math.PI * 0.4);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const hs = HANDLE_PX;
    h.resize.forEach((r) => {
      const s = w2s(v, r);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(s.x - hs / 2, s.y - hs / 2, hs, hs);
      ctx.strokeStyle = COL.coral;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(s.x - hs / 2, s.y - hs / 2, hs, hs);
    });
  }
  function drawSizeLabel(rc, it, active) {
    const pts = G.furnitureCorners(it).map((p) => w2s(rc.v, p));
    const maxY = Math.max(...pts.map((p) => p.y));
    const cx = pts.reduce((a, p) => a + p.x, 0) / 4;
    const text = U.fmtM(it.w) + ' × ' + U.fmtM(it.d) + ' m';
    drawPill(rc.ctx, text, cx, maxY + 16, {
      fg: active ? '#FFFFFF' : COL.dimText,
      bg: active ? COL.coral : 'rgba(251,249,244,0.94)',
      border: active ? COL.coral : '#CFC6B7',
      font: '600 10px ' + FONT_MONO,
    });
  }
  function drawLockBadge(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = COL.structural;
    ctx.fill();
    ctx.strokeStyle = COL.paper;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -1.5, 3.1, Math.PI, 0);
    ctx.moveTo(3.1, -1.5);
    ctx.lineTo(3.1, 0.8);
    ctx.moveTo(-3.1, -1.5);
    ctx.lineTo(-3.1, 0.8);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = COL.paper;
    roundRectPath(ctx, -4.6, 0.3, 9.2, 6.4, 1.3);
    ctx.fill();
    ctx.restore();
  }
  function toolOverlayScreen(rc) {
    const { ctx, v, doc, floorId, ui } = rc;
    const hov = S.pointerInside ? S.hover : null;
    if (ui.tool === 'demolish' && hov && hov.kind === 'wall') {
      const w = wallOnFloor(doc, hov.id, floorId);
      if (w) {
        const m = w2s(v, { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
        if (OPS.isEditableWall(w)) drawPill(ctx, 'Demolir', m.x, m.y - 18, { fg: '#FFFFFF', bg: COL.coral, border: COL.coral, font: '600 10px ' + FONT_UI });
        else drawLockBadge(ctx, m.x, m.y);
      }
    }
    if (ui.tool === 'paint' && hov && hov.kind === 'room' && S.cursorWorld) {
      const c = w2s(v, S.cursorWorld);
      drawPill(ctx, materialName(ui.paintMaterial), c.x + 18, c.y + 24, { fg: COL.ink, border: COL.coral, font: '600 10px ' + FONT_UI });
    }
    if (ui.tool === 'measure' && S.measure) {
      const { a, cur } = S.measure;
      drawMeasureLine(rc, a, cur, COL.teal, U.fmtM(U.dist(a, cur)) + ' m', true);
    }
    if (ui.tool === 'wall' && S.wallDraw) {
      const { a, cur } = S.wallDraw;
      const as = w2s(v, a);
      ctx.beginPath();
      ctx.arc(as.x, as.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = COL.teal;
      ctx.fill();
      if (U.dist(a, cur) > 1) {
        const m = w2s(v, { x: (a.x + cur.x) / 2, y: (a.y + cur.y) / 2 });
        drawPill(ctx, U.fmtM(U.dist(a, cur)) + ' m', m.x, m.y - 16);
      }
    }
    if ((ui.tool === 'measure' || ui.tool === 'wall') && S.snapHint) drawSnapRing(rc, S.snapHint);
  }
  function drawSnapRing(rc, p) {
    const ctx = rc.ctx;
    const s = w2s(rc.v, p);
    ctx.strokeStyle = COL.teal;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (p.kind === 'face') {
      ctx.moveTo(s.x, s.y - 7);
      ctx.lineTo(s.x + 7, s.y);
      ctx.lineTo(s.x, s.y + 7);
      ctx.lineTo(s.x - 7, s.y);
      ctx.closePath();
    } else {
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.fillStyle = COL.teal;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  function feedbackScreen(rc) {
    const fb = S.feedback;
    if (!fb) return;
    (fb.rays || []).forEach((r) => drawMeasureLine(rc, r.a, r.b, COL.teal, U.fmtM(r.dist), false));
    (fb.alongDims || []).forEach((r) => drawMeasureLine(rc, r.a, r.b, COL.teal, U.fmtM(U.dist(r.a, r.b)), false));
    if (fb.label) {
      const s = w2s(rc.v, fb.label.at);
      drawPill(rc.ctx, fb.label.text, s.x, s.y - 22, { fg: '#FFFFFF', bg: COL.teal, border: COL.teal });
    }
    if (fb.snapPoint) drawSnapRing(rc, fb.snapPoint);
  }

  // ================================================================== frame loop
  function requestFrame() {
    if (S.raf || typeof requestAnimationFrame === 'undefined') return;
    S.raf = requestAnimationFrame(frame);
  }
  function markDirty() {
    S.dirty = true;
    requestFrame();
  }
  function frame() {
    S.raf = 0;
    if (!S.canvas) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (dpr !== S.dpr) resize();
    if (S.pendingMove) processPendingMove();
    let again = false;
    if (S.viewAnim) again = stepViewAnim() || again;
    if (S.zoomAnim) again = stepZoomAnim() || again;
    if (S.fades.length) again = stepFades() || again;
    if (S.dirty) {
      S.dirty = false;
      renderScreen();
    }
    flushEvents();
    if (again) requestFrame();
  }
  function renderScreen() {
    const st = store();
    if (!S.ctx || !st || S.view.width <= 0 || S.view.height <= 0) return;
    try {
      drawScene(makeRC(S.ctx, S.view, S.dpr, st.doc, st.ui, { interactive: true }));
    } catch (e) {
      warnOnce('render', e);
    }
  }
  function flushEvents() {
    if (S.cursorDirty && S.cursorWorld) {
      S.cursorDirty = false;
      DD.events.emit('plan2d:cursor', { x: Math.round(S.cursorWorld.x), y: Math.round(S.cursorWorld.y) });
    }
    if (S.viewportDirty) {
      S.viewportDirty = false;
      DD.events.emit('plan2d:viewport', getViewport());
    }
  }

  // ================================================================== viewport
  function setView(patch) {
    const next = Object.assign({}, S.view, patch);
    next.scale = clampScale(next.scale);
    S.view = next;
    S.viewportDirty = true;
    markDirty();
  }
  function stopViewAnims() {
    S.viewAnim = null;
    S.zoomAnim = null;
  }
  function animateView(target, ms) {
    S.zoomAnim = null;
    S.viewAnim = { from: Object.assign({}, S.view), to: target, t0: clock(), ms };
    requestFrame();
  }
  function stepViewAnim() {
    const a = S.viewAnim;
    const t = U.clamp((clock() - a.t0) / a.ms, 0, 1);
    const e = U.easeInOut(t);
    const scale = Math.exp(U.lerp(Math.log(a.from.scale), Math.log(a.to.scale), e));
    setView({ cx: U.lerp(a.from.cx, a.to.cx, e), cy: U.lerp(a.from.cy, a.to.cy, e), scale });
    if (t >= 1) S.viewAnim = null;
    return t < 1;
  }
  /** Smooth zoom that keeps the world point under (sx,sy) fixed while the scale eases to the target. */
  function zoomSmooth(factor, sx, sy) {
    S.viewAnim = null;
    const base = S.zoomAnim ? S.zoomAnim.target : S.view.scale;
    S.zoomAnim = { sx, sy, anchor: s2w(S.view, sx, sy), target: clampScale(base * factor) };
    requestFrame();
  }
  function stepZoomAnim() {
    const z = S.zoomAnim;
    const l = Math.log(S.view.scale), lt = Math.log(z.target);
    let nl = l + (lt - l) * ZOOM_EASE;
    const done = Math.abs(lt - nl) < 0.002;
    if (done) nl = lt;
    const scale = Math.exp(nl);
    setView({ scale, cx: z.anchor.x - (z.sx - S.view.width / 2) / scale, cy: z.anchor.y - (z.sy - S.view.height / 2) / scale });
    if (done) S.zoomAnim = null;
    return !done;
  }
  function fitTarget() {
    const st = store();
    if (!st) return null;
    const box = floorBox(st.doc, st.ui.floor, true);
    const pad =Math.min(84, Math.max(24, Math.min(S.view.width, S.view.height) * 0.12));
    return fitRect(box, S.view.width, S.view.height, pad);
  }
  function fit(animated) {
    if (!S.canvas || S.view.width <= 0) return;
    const t = fitTarget();
    if (!t) return;
    stopViewAnims();
    if (animated) animateView(t, FIT_ANIM_MS);
    else setView(t);
  }
  function canvasRect() {
    if (S.canvas && S.canvas.getBoundingClientRect) return S.canvas.getBoundingClientRect();
    return { left: 0, top: 0, width: S.view.width, height: S.view.height, right: S.view.width, bottom: S.view.height };
  }
  function screenToWorld(clientX, clientY) {
    const r = canvasRect();
    return s2w(S.view, clientX - r.left, clientY - r.top);
  }
  function worldToScreen(x, y) {
    const r = canvasRect();
    return { x: r.left + w2sX(S.view, x), y: r.top + w2sY(S.view, y) };
  }
  function getViewport() {
    const v = S.view;
    return { cx: v.cx, cy: v.cy, scale: v.scale, width: v.width, height: v.height, rect: canvasRect() };
  }
  function setViewport(p) {
    if (!p) return;
    stopViewAnims();
    const patch = {};
    ['cx', 'cy', 'scale'].forEach((k) => {
      if (typeof p[k] === 'number' && isFinite(p[k])) patch[k] = p[k];
    });
    setView(patch);
  }
  function zoomBy(factor, clientX, clientY) {
    if (!(factor > 0)) return;
    const r = canvasRect();
    const sx = clientX == null ? S.view.width / 2 : clientX - r.left;
    const sy = clientY == null ? S.view.height / 2 : clientY - r.top;
    zoomSmooth(factor, sx, sy);
  }
  function resize() {
    if (!S.canvas || !S.parent) return;
    const w = S.parent.clientWidth, h = S.parent.clientHeight;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (w === S.view.width && h === S.view.height && dpr === S.dpr) return;
    S.dpr = dpr;
    S.canvas.width = Math.max(1, Math.round(w * dpr));
    S.canvas.height = Math.max(1, Math.round(h * dpr));
    S.view = Object.assign({}, S.view, { width: w, height: h });
    if (!S.hasFit && w > 0 && h > 0) {
      S.hasFit = true;
      const t = fitTarget();
      if (t) S.view = Object.assign({}, S.view, t);
    }
    S.viewportDirty = true;
    S.dirty = false;
    renderScreen(); // repaint right away: resizing the backing store clears the canvas
    requestFrame();
  }

  // ================================================================== selection & hover
  function setSelection(sel) {
    const st = store();
    if (!st || sameRef(st.ui.selection, sel)) return;
    st.setUI({ selection: sel ? { kind: sel.kind, id: sel.id } : null });
  }
  function setLocalHover(h) {
    if (sameHover(S.hover, h)) return false;
    S.hover = h;
    scheduleHoverSync();
    markDirty();
    return true;
  }
  function scheduleHoverSync() {
    if (S.hoverTimer) return;
    const wait = Math.max(0, HOVER_SYNC_MS - (clock() - S.lastHoverSync));
    S.hoverTimer = setTimeout(syncHover, wait);
  }
  function syncHover() {
    S.hoverTimer = 0;
    S.lastHoverSync = clock();
    const st = store();
    if (!st) return;
    const ref = refOf(S.hover);
    if (!sameRef(st.ui.hover, ref)) st.setUI({ hover: ref });
  }
  function updateHover(ev, p) {
    const st = store();
    const ui = st.ui, doc = st.doc, px = 1 / S.view.scale;
    let h = null;
    if (!S.spaceDown) {
      if (ui.tool === 'select') h = hitTestSelect(doc, ui.floor, p, px, { selection: ui.selection, showFurniture: ui.show.furniture });
      else if (ui.tool === 'demolish') {
        const w = hitWall(doc, ui.floor, p, HIT_PX * px);
        h = w ? { kind: 'wall', id: w.id } : null;
      } else if (ui.tool === 'paint') {
        const r = safeRoomAt(doc, ui.floor, p.x, p.y);
        h = r ? { kind: 'room', id: r.id } : null;
      }
    }
    setLocalHover(h);
    if (ui.tool === 'measure' || ui.tool === 'wall') updateToolPreview(ev, p);
    if (ui.tool === 'paint' && h) markDirty(); // material label follows the cursor
    updateCursor();
  }

  // ================================================================== cursor
  function wallAxisCursor(w) {
    const { n } = G.wallDir(w);
    if (Math.abs(n.x) > 0.92) return 'ew-resize';
    if (Math.abs(n.y) > 0.92) return 'ns-resize';
    return 'move';
  }
  function cursorForDrag(d) {
    switch (d.type) {
      case 'pan':
        return 'grabbing';
      case 'furnMove':
        return 'grabbing';
      case 'furnRotate':
        return 'grabbing';
      case 'furnResize':
        return handleCursor(d.sx, d.sy, d.startItem ? d.startItem.rot : 0);
      case 'wallMove':
        return d.startWall ? wallAxisCursor(d.startWall) : 'move';
      case 'locked':
        return 'not-allowed';
      default:
        return null;
    }
  }
  function cursorForHover(ui, doc) {
    const h = S.hover;
    if (ui.tool === 'measure' || ui.tool === 'wall') return 'crosshair';
    if (ui.tool === 'pan') return 'grab';
    if (ui.tool === 'paint') return h ? PAINT_CURSOR : 'not-allowed';
    if (ui.tool === 'demolish') {
      const w = h && OPS.byId(doc, 'walls', h.id);
      return w ? (OPS.isEditableWall(w) ? 'pointer' : 'not-allowed') : 'crosshair';
    }
    if (!h) return 'default';
    switch (h.kind) {
      case 'handle': {
        if (h.handle.type === 'rotate') return 'grab';
        const it = OPS.byId(doc, 'furniture', h.id);
        return handleCursor(h.handle.sx, h.handle.sy, it ? it.rot : 0);
      }
      case 'wallEnd':
        return 'crosshair';
      case 'furniture':
        return 'move';
      case 'wall': {
        const w = OPS.byId(doc, 'walls', h.id);
        return w && OPS.isEditableWall(w) ? wallAxisCursor(w) : 'pointer';
      }
      case 'opening':
      case 'measure':
      case 'room':
        return 'pointer';
      default:
        return 'default';
    }
  }
  function updateCursor() {
    const st = store();
    if (!S.canvas || !st) return;
    let c = null;
    if (S.drag && S.drag.phase === 'active') c = cursorForDrag(S.drag);
    if (!c && S.spaceDown) c = 'grab';
    if (!c) c = cursorForHover(st.ui, st.doc);
    if (c !== S.cursor) {
      S.cursor = c;
      S.canvas.style.cursor = c;
    }
  }

  // ================================================================== tools: measure / wall
  function snapOptsFor(tool, anchor, ev) {
    const tol = SNAP_POINT_PX / S.view.scale;
    if (tool === 'wall') return { anchor, ortho: anchor && !ev.shiftKey ? 'force' : 'off', tol, grid: WALL_GRID_MM };
    return { anchor, ortho: anchor && ev.shiftKey ? 'force' : 'off', tol, grid: 0 };
  }
  function updateToolPreview(ev, p) {
    const st = store();
    const tool = st.ui.tool;
    const state = tool === 'measure' ? S.measure : S.wallDraw;
    const anchor = state ? state.a : null;
    const sp = snapWallPoint(st.doc, st.ui.floor, p, snapOptsFor(tool, anchor, ev));
    if (state) state.cur = { x: sp.x, y: sp.y };
    S.snapHint = sp.kind === 'end' || sp.kind === 'corner' || sp.kind === 'face' ? sp : null;
    markDirty();
  }
  function toolDown(d, ev, p) {
    const st = store();
    const tool = st.ui.tool;
    const sp = snapWallPoint(st.doc, st.ui.floor, p, snapOptsFor(tool, null, ev));
    const pt = { x: sp.x, y: sp.y };
    if (tool === 'measure' && !S.measure) {
      S.measure = { a: pt, cur: pt };
      d.fresh = true;
    } else if (tool === 'wall' && !S.wallDraw) {
      S.wallDraw = { a: pt, cur: pt };
      d.fresh = true;
    } else {
      updateToolPreview(ev, p); // touch has no hover: the tap itself sets the end point
    }
    markDirty();
  }
  function toolUp(d, dragged) {
    const tool = store().ui.tool;
    if (d.fresh && !dragged) return; // first click only anchors the start point
    if (tool === 'measure' && S.measure) commitMeasure(S.measure.a, S.measure.cur);
    else if (tool === 'wall' && S.wallDraw) addWallSegment(S.wallDraw.a, S.wallDraw.cur);
  }
  function commitMeasure(a, b) {
    const st = store();
    if (U.dist(a, b) < 20) return;
    const m = { id: U.uid('m'), floor: st.ui.floor, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
    st.commit(OPS.add(st.doc, 'measures', m), 'Medição');
    S.measure = null;
    markDirty();
  }
  function addWallSegment(a, b) {
    const st = store();
    if (U.dist(a, b) < MIN_WALL_MM) return false;
    const r = OPS.addWall(st.doc, st.ui.floor, a, b, NEW_WALL_THICK_MM);
    st.commit(r.doc, 'Nova parede');
    S.wallDraw = { a: { x: r.wall.b.x, y: r.wall.b.y }, cur: { x: r.wall.b.x, y: r.wall.b.y } };
    markDirty();
    return true;
  }
  function onContextClick() {
    const tool = store().ui.tool;
    if (tool === 'wall' && S.wallDraw) S.wallDraw = null;
    else if (tool === 'measure' && S.measure) S.measure = null;
    else return;
    S.snapHint = null;
    markDirty();
  }

  // ================================================================== tools: demolish / paint
  function demolishAt(p) {
    const st = store();
    const px = 1 / S.view.scale;
    const w = hitWall(st.doc, st.ui.floor, p, HIT_PX * px);
    if (!w) return;
    if (!OPS.isEditableWall(w)) {
      DD.toast(w.kind === 'structural' ? 'Parede estrutural — não pode ser demolida' : (OPS.KIND_LABEL[w.kind] || 'Elemento') + ' — não pode ser demolido', 'warn');
      return;
    }
    if (S.fades.some((f) => f.wallId === w.id)) return;
    S.fades = S.fades.concat([{ wallId: w.id, floor: w.floor, t0: clock() }]);
    setLocalHover(null);
    markDirty();
  }
  function stepFades() {
    const now = clock();
    const done = S.fades.filter((f) => now - f.t0 >= DEMOLISH_FADE_MS);
    if (done.length) {
      S.fades = S.fades.filter((f) => done.indexOf(f) < 0);
      done.forEach(finishDemolish);
    }
    markDirty();
    return S.fades.length > 0;
  }
  function finishDemolish(fade) {
    const st = store();
    const w = OPS.byId(st.doc, 'walls', fade.wallId);
    if (!w) return; // undone / replaced meanwhile
    const res = OPS.demolishWall(st.doc, w.id);
    if (res.error) {
      DD.toast(res.error, 'warn');
      return;
    }
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    st.commit(res.doc, 'Demolir parede');
    const sel = st.ui.selection;
    if (sel && sel.kind === 'wall' && sel.id === w.id) setSelection(null);
    const room = safeRoomAt(res.doc, w.floor, mid.x, mid.y);
    DD.toast(room ? 'Parede demolida — ambiente agora: ' + room.name : 'Parede demolida', 'ok');
  }
  function paintAt(p) {
    const st = store();
    const room = safeRoomAt(st.doc, st.ui.floor, p.x, p.y);
    if (!room) {
      DD.toast('Clique dentro de um ambiente para aplicar o piso.', 'info');
      return;
    }
    const mat = st.ui.paintMaterial;
    if (!mat) return;
    const seeds = st.doc.roomSeeds.filter((s) => room.seedIds.indexOf(s.id) >= 0);
    if (seeds.every((s) => s.material === mat)) {
      DD.toast(room.name + ' já tem piso ' + materialName(mat) + '.', 'info');
      return;
    }
    st.commit(OPS.setRoomMaterial(st.doc, room.seedIds, mat), 'Piso: ' + materialName(mat) + ' em ' + room.name);
  }

  // ================================================================== drags
  // Each drag handler: activate(d, ev) → false aborts; move(d, ev, p); end(d, ev); click(d, ev) (released without
  // exceeding the drag threshold); cancel(d) (Esc / pointercancel / floor change).
  const DRAGS = {
    pan: {
      activate(d) {
        stopViewAnims();
        d.startView = Object.assign({}, S.view);
      },
      move(d, ev) {
        const s = d.startView.scale;
        setView({ cx: d.startView.cx - (ev.clientX - d.startClient.x) / s, cy: d.startView.cy - (ev.clientY - d.startClient.y) / s });
      },
      end() {},
      click(d, ev) {
        const p = screenToWorld(ev.clientX, ev.clientY);
        if (d.clickAction === 'context') onContextClick();
        else if (d.clickAction === 'demolish') demolishAt(p);
        else if (d.clickAction === 'paint') paintAt(p);
        else if (d.clickAction === 'select') setSelection(d.clickHit && d.clickHit.kind === 'room' ? refOf(d.clickHit) : null);
      },
      cancel() {},
    },
    locked: {
      activate(d) {
        DD.toast(d.message, 'warn');
      },
      move() {},
      end() {},
      cancel() {},
    },
    toolPress: {
      activate() {},
      move(d, ev, p) {
        updateToolPreview(ev, p);
      },
      end(d) {
        toolUp(d, true);
      },
      click(d) {
        toolUp(d, false);
      },
      cancel() {},
    },
    furnMove: {
      activate(d) {
        return beginItemGesture(d, 'Mover ');
      },
      move(d, ev, p) {
        moveFurniture(d, ev, p);
      },
      end(d) {
        store().endGesture(d.label);
      },
      cancel() {
        store().cancelGesture();
      },
    },
    furnResize: {
      activate(d) {
        return beginItemGesture(d, 'Redimensionar ');
      },
      move(d, ev, p) {
        const r = resizeFromHandle(d.startItem, d.sx, d.sy, p.x, p.y);
        previewItem(d, r);
      },
      end(d) {
        store().endGesture(d.label);
      },
      cancel() {
        store().cancelGesture();
      },
    },
    furnRotate: {
      activate(d) {
        return beginItemGesture(d, 'Girar ');
      },
      move(d, ev, p) {
        const rot = rotationFromPointer(d.startItem, p.x, p.y, ev.shiftKey);
        previewItem(d, { rot });
        S.feedback = { label: { at: { x: d.startItem.x, y: d.startItem.y }, text: Math.round(rot) + '°' } };
      },
      end(d) {
        store().endGesture(d.label);
      },
      cancel() {
        store().cancelGesture();
      },
    },
    wallMove: {
      activate(d) {
        return beginWallGesture(d, 'Mover parede');
      },
      move(d, ev, p) {
        moveWallDrag(d, p);
      },
      end(d) {
        store().endGesture(d.label);
      },
      cancel() {
        store().cancelGesture();
      },
    },
    wallEnd: {
      activate(d) {
        return beginWallGesture(d, 'Ajustar parede');
      },
      move(d, ev, p) {
        moveWallEnd(d, ev, p);
      },
      end(d) {
        store().endGesture(d.label);
      },
      cancel() {
        store().cancelGesture();
      },
    },
    openingMove: {
      activate(d) {
        const st = store();
        const op = OPS.byId(st.doc, 'openings', d.id);
        const w = op && OPS.byId(st.doc, 'walls', op.wall);
        if (!op || !w) return false;
        const { d: dir } = G.wallDir(w);
        d.startDoc = st.doc;
        d.startOp = op;
        d.wall = w;
        d.grab = (d.startWorld.x - w.a.x) * dir.x + (d.startWorld.y - w.a.y) * dir.y - op.t;
        d.label = 'Mover ' + (op.code || 'abertura');
        st.beginGesture(d.label);
        return true;
      },
      move(d, ev, p) {
        moveOpening(d, p);
      },
      end(d) {
        store().endGesture(d.label);
      },
      cancel() {
        store().cancelGesture();
      },
    },
  };
  function beginItemGesture(d, verb) {
    const st = store();
    const it = OPS.byId(st.doc, 'furniture', d.id);
    if (!it) return false;
    d.startDoc = st.doc;
    d.startItem = it;
    d.label = verb + furnitureName(it);
    st.beginGesture(d.label);
    return true;
  }
  function previewItem(d, patch) {
    const key = JSON.stringify(patch);
    if (key === d.lastKey) return;
    d.lastKey = key;
    store().preview(OPS.update(d.startDoc, 'furniture', d.id, patch));
  }
  function moveFurniture(d, ev, p) {
    const st = store();
    const it = d.startItem;
    const prop = { x: p.x - d.offset.x, y: p.y - d.offset.y, rot: it.rot || 0 };
    let res = prop, snaps = [];
    if (st.ui.snap && !ev.altKey && !isFlat(it)) {
      res = G.snapFurniture(d.startDoc, it.floor, it, prop, { threshold: SNAP_FURNITURE_PX / S.view.scale, angleTol: 30 });
      snaps = res.snaps || [];
    }
    const next = { x: Math.round(res.x), y: Math.round(res.y), rot: res.rot };
    previewItem(d, next);
    S.feedback = {
      faces: snapFaces(d.startDoc, snaps),
      rays: sideRays(d.startDoc, it.floor, Object.assign({}, it, next)),
    };
  }
  function beginWallGesture(d, label) {
    const st = store();
    const w = OPS.byId(st.doc, 'walls', d.id);
    if (!w || !OPS.isEditableWall(w)) return false;
    d.startDoc = st.doc;
    d.startWall = w;
    d.label = label;
    st.beginGesture(label);
    return true;
  }
  function moveWallDrag(d, p) {
    const w = d.startWall;
    const { n } = G.wallDir(w);
    const raw = (p.x - d.startWorld.x) * n.x + (p.y - d.startWorld.y) * n.y;
    const off = Math.round(raw / WALL_MOVE_STEP_MM) * WALL_MOVE_STEP_MM;
    if (off !== d.lastOff) {
      d.lastOff = off;
      store().preview(off ? OPS.moveWall(d.startDoc, w.id, Math.round(n.x * off), Math.round(n.y * off)) : d.startDoc);
    }
    const moved = OPS.byId(store().doc, 'walls', w.id) || w;
    const mid = { x: (moved.a.x + moved.b.x) / 2, y: (moved.a.y + moved.b.y) / 2 };
    const rays = [];
    [1, -1].forEach((sgn) => {
      const dir = { x: n.x * sgn, y: n.y * sgn };
      const o = offsetPt(mid, dir, moved.thick / 2 + 1);
      const r = G.raycastWalls(store().doc, moved.floor, o, dir, RAY_MAX_MM);
      if (isFinite(r.dist) && r.dist > 5 && r.dist < RAY_MAX_MM) rays.push({ a: o, b: offsetPt(o, dir, r.dist), dist: r.dist + 1 });
    });
    S.feedback = {
      ghostWall: off ? G.wallPolygon(w) : null,
      rays,
      label: { at: mid, text: 'Deslocamento ' + U.fmtM(Math.abs(off)) + ' m' },
    };
  }
  function moveWallEnd(d, ev, p) {
    const w = d.startWall;
    const anchor = d.end === 'a' ? w.b : w.a;
    const sp = snapWallPoint(d.startDoc, w.floor, p, {
      anchor,
      ortho: ev.shiftKey ? 'off' : 'near',
      tol: SNAP_POINT_PX / S.view.scale,
      grid: WALL_MOVE_STEP_MM,
      excludeWall: w.id,
    });
    if (U.dist(anchor, sp) < MIN_WALL_MM) return;
    const pt = { x: sp.x, y: sp.y };
    const key = pt.x + ',' + pt.y;
    if (key !== d.lastKey) {
      d.lastKey = key;
      const newWall = Object.assign({}, w, { [d.end]: pt });
      const doc1 = OPS.update(d.startDoc, 'walls', w.id, { [d.end]: pt });
      store().preview(retargetOpenings(doc1, w, newWall));
    }
    const mid = { x: (anchor.x + pt.x) / 2, y: (anchor.y + pt.y) / 2 };
    S.feedback = {
      snapPoint: sp.kind === 'grid' || sp.kind === 'free' ? null : sp,
      label: { at: mid, text: U.fmtM(U.dist(anchor, pt)) + ' m' },
    };
  }
  function moveOpening(d, p) {
    const w = d.wall, op = d.startOp;
    const { d: dir, n } = G.wallDir(w);
    let t = (p.x - w.a.x) * dir.x + (p.y - w.a.y) * dir.y - d.grab;
    t = Math.round(t / WALL_MOVE_STEP_MM) * WALL_MOVE_STEP_MM;
    const range = openingRange(d.startDoc, op, w);
    t = range.lo <= range.hi ? U.clamp(t, range.lo, range.hi) : op.t;
    if (t !== d.lastT) {
      d.lastT = t;
      store().preview(OPS.update(d.startDoc, 'openings', op.id, { t }));
    }
    const off = w.thick / 2 + 20 / S.view.scale;
    const side = -tagSide(d.startDoc, w.floor, w, op);
    const along = (tt) => offsetPt({ x: w.a.x + dir.x * tt, y: w.a.y + dir.y * tt }, n, side * off);
    const dims = [];
    if (t - op.width / 2 > 1) dims.push({ a: along(0), b: along(t - op.width / 2) });
    const L = G.wallDir(w).L;
    if (L - (t + op.width / 2) > 1) dims.push({ a: along(t + op.width / 2), b: along(L) });
    S.feedback = { alongDims: dims };
  }

  /** Builds the drag object for a primary-button press in the select tool. */
  function createSelectDrag(base, p) {
    const st = store();
    const ui = st.ui, doc = st.doc, px = 1 / S.view.scale;
    const hit = hitTestSelect(doc, ui.floor, p, px, { selection: ui.selection, showFurniture: ui.show.furniture });
    if (!hit || hit.kind === 'room') return Object.assign(base, { type: 'pan', clickAction: 'select', clickHit: hit });
    if (hit.kind === 'handle') {
      if (hit.handle.type === 'rotate') return Object.assign(base, { type: 'furnRotate', id: hit.id });
      return Object.assign(base, { type: 'furnResize', id: hit.id, sx: hit.handle.sx, sy: hit.handle.sy });
    }
    if (hit.kind === 'wallEnd') return Object.assign(base, { type: 'wallEnd', id: hit.id, end: hit.end });
    setSelection(refOf(hit));
    if (hit.kind === 'furniture') {
      const it = OPS.byId(doc, 'furniture', hit.id);
      return Object.assign(base, { type: 'furnMove', id: hit.id, offset: { x: p.x - it.x, y: p.y - it.y } });
    }
    if (hit.kind === 'wall') {
      const w = OPS.byId(doc, 'walls', hit.id);
      if (OPS.isEditableWall(w)) return Object.assign(base, { type: 'wallMove', id: hit.id });
      return Object.assign(base, { type: 'locked', message: LOCK_MSG[w.kind] || 'Elemento bloqueado' });
    }
    if (hit.kind === 'opening') {
      const op = OPS.byId(doc, 'openings', hit.id);
      const w = op && OPS.byId(doc, 'walls', op.wall);
      if (w && OPS.isEditableWall(w)) return Object.assign(base, { type: 'openingMove', id: hit.id });
      const where = w && w.kind === 'muro' ? 'muro de divisa' : 'parede estrutural';
      return Object.assign(base, { type: 'locked', message: 'Abertura em ' + where + ' — bloqueada' });
    }
    return Object.assign(base, { type: 'pan' }); // measures: select on press, drag pans
  }
  function createDrag(ev, p) {
    const st = store();
    const tool = st.ui.tool;
    const base = {
      pointerId: ev.pointerId,
      button: ev.button,
      startClient: { x: ev.clientX, y: ev.clientY },
      startWorld: p,
      phase: 'pending',
      threshold: ev.pointerType === 'touch' ? DRAG_START_TOUCH_PX : DRAG_START_PX,
    };
    if (ev.button === 1 || S.spaceDown || tool === 'pan') return Object.assign(base, { type: 'pan' });
    if (ev.button === 2) return Object.assign(base, { type: 'pan', clickAction: 'context' });
    if (ev.button !== 0) return null;
    switch (tool) {
      case 'select':
        return createSelectDrag(base, p);
      case 'measure':
      case 'wall':
        return Object.assign(base, { type: 'toolPress' });
      case 'demolish':
      case 'paint':
        return Object.assign(base, { type: 'pan', clickAction: tool });
      default:
        return Object.assign(base, { type: 'pan' });
    }
  }
  function activateDrag(d, ev, p) {
    d.phase = 'active';
    setLocalHover(null);
    const ok = DRAGS[d.type].activate(d, ev, p);
    if (ok === false) {
      S.drag = null;
      return false;
    }
    updateCursor();
    return true;
  }
  function abortDrag() {
    const d = S.drag;
    S.drag = null;
    S.feedback = null;
    if (d && d.phase === 'active') {
      try {
        DRAGS[d.type].cancel(d);
      } catch (e) {
        warnOnce('cancel ' + d.type, e);
      }
    }
    releaseCapture(d);
  }
  function releaseCapture(d) {
    if (!d || !S.canvas) return;
    try {
      if (S.canvas.hasPointerCapture && S.canvas.hasPointerCapture(d.pointerId)) S.canvas.releasePointerCapture(d.pointerId);
    } catch (e) {
      /* capture already released */
    }
  }

  // ================================================================== pointer events
  function eventSnapshot(e) {
    return {
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'mouse',
      button: e.button,
      buttons: e.buttons,
      clientX: e.clientX,
      clientY: e.clientY,
      shiftKey: !!e.shiftKey,
      altKey: !!e.altKey,
    };
  }
  function onPointerDown(e) {
    if (!store()) return;
    S.pointerInside = true;
    if (e.pointerType === 'touch') {
      S.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (S.touches.size === 2) {
        abortDrag();
        startPinch();
        return;
      }
      if (S.touches.size > 2) return;
    }
    if (S.drag) return; // another button pressed during a drag
    const ev = eventSnapshot(e);
    const p = screenToWorld(ev.clientX, ev.clientY);
    const d = createDrag(ev, p);
    if (!d) return;
    try {
      S.canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* not capturable (synthetic event) */
    }
    if (e.cancelable) e.preventDefault();
    S.drag = d;
    if (d.type === 'toolPress') toolDown(d, ev, p);
    markDirty();
    updateCursor();
  }
  function onPointerMove(e) {
    S.pointerInside = true;
    if (e.pointerType === 'touch' && S.touches.has(e.pointerId)) {
      S.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (S.pinch) {
        applyPinch();
        return;
      }
    }
    S.pendingMove = eventSnapshot(e);
    requestFrame();
  }
  function processPendingMove() {
    const ev = S.pendingMove;
    S.pendingMove = null;
    if (!ev || !store()) return;
    S.lastEvent = ev;
    const p = screenToWorld(ev.clientX, ev.clientY);
    S.cursorWorld = p;
    S.cursorDirty = true;
    const d = S.drag;
    if (!d) {
      updateHover(ev, p);
      return;
    }
    if (d.pointerId !== ev.pointerId) return;
    if (d.phase === 'pending') {
      const moved = Math.hypot(ev.clientX - d.startClient.x, ev.clientY - d.startClient.y);
      if (moved < d.threshold) {
        if (d.type === 'toolPress') updateToolPreview(ev, p);
        return;
      }
      if (!activateDrag(d, ev, p)) return;
    }
    try {
      DRAGS[d.type].move(d, ev, p);
    } catch (err) {
      warnOnce('drag ' + d.type, err);
    }
    markDirty();
  }
  function onPointerUp(e) {
    if (e.pointerType === 'touch') {
      S.touches.delete(e.pointerId);
      if (S.pinch) {
        if (S.touches.size < 2) S.pinch = null;
        return;
      }
    }
    const d = S.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    if (S.pendingMove && S.pendingMove.pointerId === e.pointerId) processPendingMove();
    if (S.drag !== d) return; // aborted while processing the last move
    S.drag = null;
    const ev = eventSnapshot(e);
    try {
      if (d.phase === 'active') DRAGS[d.type].end(d, ev);
      else if (DRAGS[d.type].click) DRAGS[d.type].click(d, ev);
    } catch (err) {
      warnOnce('pointerup ' + d.type, err);
      if (store() && store().inGesture()) store().cancelGesture();
    }
    S.feedback = null;
    releaseCapture(d);
    if (e.pointerType !== 'touch') updateHover(ev, screenToWorld(ev.clientX, ev.clientY));
    markDirty();
    updateCursor();
  }
  function onPointerCancel(e) {
    S.touches.delete(e.pointerId);
    if (S.touches.size < 2) S.pinch = null;
    if (S.drag && S.drag.pointerId === e.pointerId) abortDrag();
    markDirty();
  }
  function onPointerLeave(e) {
    if (e.pointerType === 'touch') return;
    S.pointerInside = false;
    S.snapHint = null;
    setLocalHover(null);
    markDirty();
  }
  function startPinch() {
    const pts = Array.from(S.touches.values());
    const r = canvasRect();
    const mid = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
    stopViewAnims();
    S.pinch = {
      startDist: Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)),
      startScale: S.view.scale,
      anchor: s2w(S.view, mid.x, mid.y),
    };
  }
  function applyPinch() {
    const pts = Array.from(S.touches.values());
    if (pts.length < 2) return;
    const r = canvasRect();
    const mid = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const scale = clampScale((S.pinch.startScale * dist) / S.pinch.startDist);
    const a = S.pinch.anchor;
    setView({ scale, cx: a.x - (mid.x - S.view.width / 2) / scale, cy: a.y - (mid.y - S.view.height / 2) / scale });
  }
  function onWheel(e) {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    const k = e.ctrlKey ? WHEEL_ZOOM_K * 2.5 : WHEEL_ZOOM_K; // ctrl+wheel = trackpad pinch (small deltas)
    const r = canvasRect();
    zoomSmooth(Math.exp(-dy * k), e.clientX - r.left, e.clientY - r.top);
  }
  function onDoubleClick(e) {
    const st = store();
    if (!st) return;
    const tool = st.ui.tool;
    if (tool === 'wall') {
      S.wallDraw = null;
      S.snapHint = null;
      markDirty();
      return;
    }
    if (tool !== 'select' && tool !== 'pan') return;
    const p = screenToWorld(e.clientX, e.clientY);
    const hit = hitTestSelect(st.doc, st.ui.floor, p, 1 / S.view.scale, { selection: null, showFurniture: st.ui.show.furniture });
    if (!hit || hit.kind === 'room') fit(true);
  }

  // ================================================================== keyboard (Space = pan, Esc = cancel)
  function isEditableTarget(t) {
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  }
  function onKeyDown(e) {
    if (isEditableTarget(e.target)) return;
    if (e.code === 'Space' || e.key === ' ') {
      if (!S.pointerInside && !S.drag) return;
      e.preventDefault();
      if (!S.spaceDown) {
        S.spaceDown = true;
        setLocalHover(null);
        updateCursor();
      }
      return;
    }
    if (e.key === 'Escape') {
      cancel();
      return;
    }
    if (e.key === 'Shift' || e.key === 'Alt') reprocessModifiers(e);
  }
  function onKeyUp(e) {
    if (e.code === 'Space' || e.key === ' ') {
      if (S.spaceDown) {
        e.preventDefault(); // we consumed this Space: don't let a focused button activate on keyup
        S.spaceDown = false;
        updateCursor();
      }
      return;
    }
    if (e.key === 'Shift' || e.key === 'Alt') reprocessModifiers(e);
  }
  /** Re-evaluate the current drag / preview when Shift or Alt toggles (ortho, free rotation, snapping). */
  function reprocessModifiers(e) {
    if (!S.lastEvent || !S.pointerInside) return;
    S.pendingMove = Object.assign({}, S.lastEvent, { shiftKey: !!e.shiftKey, altKey: !!e.altKey });
    requestFrame();
  }
  function onBlur() {
    S.spaceDown = false;
    updateCursor();
  }

  // ================================================================== public actions
  /** Abort the in-progress gesture / tool operation. Returns true when something was cancelled. */
  function cancel() {
    let did = !!S.drag || !!S.measure || !!S.wallDraw || !!S.pinch;
    if (S.drag) abortDrag();
    if (store() && store().inGesture()) {
      store().cancelGesture();
      did = true;
    }
    S.measure = null;
    S.wallDraw = null;
    S.pinch = null;
    S.snapHint = null;
    S.feedback = null;
    markDirty();
    updateCursor();
    return did;
  }
  function insideCanvas(clientX, clientY) {
    const r = canvasRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }
  /** Add a furniture item at the pointer (snapped back-to-wall when close to one); returns the new id or null. */
  function addFurnitureAt(type, clientX, clientY) {
    const st = store();
    if (!st) return null;
    const def = catalogDef(type);
    if (!def) {
      DD.toast('Tipo de móvel desconhecido: ' + type, 'error');
      return null;
    }
    const usePointer = clientX != null && clientY != null && S.canvas && insideCanvas(clientX, clientY);
    const p = usePointer ? screenToWorld(clientX, clientY) : { x: S.view.cx, y: S.view.cy };
    const floor = st.ui.floor;
    let doc = st.doc, item = null;
    try {
      const r = OPS.addFurniture(doc, type, floor, p.x, p.y, 0);
      doc = r.doc;
      item = r.item;
    } catch (e) {
      warnOnce('addFurniture', e);
    }
    if (!item) {
      DD.toast('Não foi possível adicionar o móvel.', 'error');
      return null;
    }
    if (st.ui.snap && !def.flat) doc = snapNewItem(doc, floor, item);
    st.commit(doc, 'Adicionar ' + (def.name || type));
    setSelection({ kind: 'furniture', id: item.id });
    return item.id;
  }
  /** Dropped near a wall: turn the item's back to the nearest face, slide it flush, then let core snapping add corners. */
  function snapNewItem(doc, floor, item) {
    const threshold = Math.max(SNAP_FURNITURE_PX / S.view.scale, DROP_SNAP_MM);
    const place = backToWallPlacement(doc, floor, item, threshold + item.d / 2);
    if (!place) return doc;
    const n = place.face.n, shift = item.d / 2 - place.dist;
    const prop = { x: item.x + n.x * shift, y: item.y + n.y * shift, rot: place.rot };
    const s = G.snapFurniture(doc, floor, item, prop, { threshold, angleTol: 30 });
    const res = s.snaps && s.snaps.length ? s : prop;
    return OPS.update(doc, 'furniture', item.id, { x: Math.round(res.x), y: Math.round(res.y), rot: res.rot });
  }

  // ================================================================== PNG export
  function exportBox(doc, floorId, isGround) {
    const b = floorBox(doc, floorId);
    const dd = dimensionData(doc, floorId);
    if (dd) {
      growBox(b, dd.bbox.minX, dd.bbox.minY);
      growBox(b, dd.bbox.maxX, dd.bbox.maxY);
    }
    // Térreo: keep the sidewalk and the street name, not the whole road
    if (isGround && doc.site && doc.site.lot) growBox(b, doc.site.lot.w / 2, doc.site.lot.h + SIDEWALK_MM + ROAD_MM * STREET_NAME_AT + 250);
    return b;
  }
  /** Offscreen render of the active floor at 1 px per 10 mm × scale, with title block and wall legend. */
  function exportPNG(opts) {
    const st = store();
    if (!st) throw new Error('Editor 2D não inicializado.');
    const o = opts || {};
    const k = o.scale > 0 ? Math.min(o.scale, 6) : 2;
    const doc = st.doc;
    const idx = Math.max(0, doc.floors.findIndex((f) => f.id === st.ui.floor));
    const box = exportBox(doc, doc.floors[idx].id, idx === 0);
    const width = Math.ceil((box.maxX - box.minX) * EXPORT_PX_PER_MM + 2 * EXPORT_MARGIN_PX);
    const height = Math.ceil((box.maxY - box.minY) * EXPORT_PX_PER_MM + 2 * EXPORT_MARGIN_PX + EXPORT_FOOTER_PX);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * k);
    canvas.height = Math.round(height * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível.');
    const view = {
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2 + EXPORT_FOOTER_PX / 2 / EXPORT_PX_PER_MM,
      scale: EXPORT_PX_PER_MM,
      width,
      height,
    };
    const rc = makeRC(ctx, view, k, doc, st.ui, {
      exporting: true,
      background: o.background !== false,
      footer: EXPORT_FOOTER_PX,
      show: { dims: true, grid: false },
    });
    drawScene(rc);
    layer('title block', rc, drawTitleBlock);
    return canvas.toDataURL('image/png');
  }
  function drawTitleBlock(rc) {
    const { ctx, doc, floor } = rc;
    const W = rc.v.width, y0 = rc.v.height - rc.footer;
    toScreenSpace(rc);
    if (rc.background) {
      ctx.fillStyle = rc.paper;
      ctx.fillRect(0, y0, W, rc.footer);
    }
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1.2;
    strokeLine(ctx, { x: 20, y: y0 + 10 }, { x: W - 20, y: y0 + 10 });
    let area = 0;
    try {
      area = DD.rooms.totalArea(doc, floor.id);
    } catch (e) {
      warnOnce('totalArea', e);
    }
    const meta = doc.meta || {};
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COL.ink;
    ctx.font = '600 18px ' + FONT_UI;
    ctx.fillText(floor.name + ' — Área útil: ' + U.fmtArea(area), 20, y0 + 40);
    ctx.font = '500 12px ' + FONT_UI;
    ctx.fillStyle = COL.dimText;
    ctx.fillText(meta.name || 'Projeto', 20, y0 + 62);
    ctx.font = '400 11px ' + FONT_UI;
    ctx.fillStyle = COL.muted;
    const date = new Date().toLocaleDateString('pt-BR');
    ctx.fillText((meta.source ? meta.source + ' · ' : '') + 'Exportado em ' + date, 20, y0 + 80);
    drawWallLegend(rc, W - 20, y0 + 30);
  }
  function drawWallLegend(rc, right, top) {
    const ctx = rc.ctx;
    const colW = 186, rowH = 24;
    const x0 = Math.max(20 + 380, right - 2 * colW);
    ctx.font = '500 11px ' + FONT_UI;
    ctx.textBaseline = 'middle';
    WALL_LEGEND.forEach((item, i) => {
      const x = x0 + (i % 2) * colW, y = top + Math.floor(i / 2) * rowH;
      drawLegendSwatch(ctx, item.kind, x, y - 6, 30, 12, rc.paper);
      ctx.fillStyle = COL.dimText;
      ctx.textAlign = 'left';
      ctx.fillText(item.label, x + 38, y);
    });
  }
  function drawLegendSwatch(ctx, kind, x, y, w, h, paper) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COL.ink;
    if (kind === 'structural') {
      ctx.fillStyle = COL.structural;
      ctx.fillRect(x, y, w, h);
    } else if (kind === 'railing') {
      ctx.fillStyle = paper;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      strokeLine(ctx, { x, y: y + h / 2 }, { x: x + w, y: y + h / 2 });
    } else {
      ctx.fillStyle = kind === 'muro' ? COL.muro : COL.partition;
      ctx.fillRect(x, y, w, h);
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      hatch(ctx, { minX: x, minY: y, maxX: x + w, maxY: y + h }, kind === 'muro' ? 9 : 4, kind === 'muro' ? COL.muroHatch : COL.partitionHatch, 0.8);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    ctx.restore();
  }

  // ================================================================== init & subscriptions
  function prepareCanvas(canvas) {
    const parent = canvas.parentElement || canvas;
    if (parent !== canvas && typeof getComputedStyle === 'function' && getComputedStyle(parent).position === 'static')
      parent.style.position = 'relative';
    const s = canvas.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.width = '100%';
    s.height = '100%';
    s.display = 'block';
    s.touchAction = 'none';
    s.userSelect = 'none';
    s.outline = 'none';
    if (canvas.setAttribute && canvas.getAttribute && !canvas.getAttribute('aria-label')) {
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Planta baixa 2D editável');
    }
    return parent;
  }
  function bindEvents(canvas) {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      S.unsubs.push(() => target.removeEventListener(type, fn, opts));
    };
    on(canvas, 'pointerdown', onPointerDown);
    on(canvas, 'pointermove', onPointerMove);
    on(canvas, 'pointerup', onPointerUp);
    on(canvas, 'pointercancel', onPointerCancel);
    on(canvas, 'pointerleave', onPointerLeave);
    on(canvas, 'pointerenter', () => (S.pointerInside = true));
    on(canvas, 'lostpointercapture', (e) => {
      if (S.drag && S.drag.pointerId === e.pointerId && S.drag.phase === 'active' && e.pointerType !== 'mouse') abortDrag();
    });
    on(canvas, 'wheel', onWheel, { passive: false });
    on(canvas, 'dblclick', onDoubleClick);
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'mousedown', (e) => {
      if (e.button === 1) e.preventDefault(); // no middle-click autoscroll: middle drag pans
    });
    on(window, 'keydown', onKeyDown);
    on(window, 'keyup', onKeyUp);
    on(window, 'blur', onBlur);
  }
  function observeSize(parent) {
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => resize());
      ro.observe(parent);
      S.unsubs.push(() => ro.disconnect());
    } else {
      window.addEventListener('resize', resize);
      S.unsubs.push(() => window.removeEventListener('resize', resize));
    }
  }
  function onDocChange(doc, prev, info) {
    const d = S.drag;
    if (d && d.phase === 'active' && info && (info.undo || info.redo || info.replaced || info.cancel)) {
      S.drag = null; // the store already dropped the gesture
      S.feedback = null;
      releaseCapture(d);
    }
    if (info && (info.undo || info.redo || info.replaced)) S.fades = [];
    markDirty();
    updateCursor();
  }
  function onlyHoverChanged(ui, prev) {
    return Object.keys(ui).every((k) => k === 'hover' || ui[k] === prev[k]);
  }
  function onUIChange(ui, prev) {
    // our own hover mirroring needs no repaint while the pointer is over the canvas
    if (onlyHoverChanged(ui, prev) && S.pointerInside) return;
    if (ui.floor !== prev.floor) cancel();
    else if (ui.tool !== prev.tool) {
      if (S.drag) abortDrag();
      S.measure = null;
      S.wallDraw = null;
      S.snapHint = null;
      setLocalHover(null);
    }
    markDirty();
    updateCursor();
  }
  function onFocusItem(ref) {
    const st = store();
    if (!st || !ref || ref.kind !== 'furniture') return;
    const it = OPS.byId(st.doc, 'furniture', ref.id);
    if (!it || it.floor !== st.ui.floor) return;
    const s = w2s(S.view, it);
    const inside = s.x > 40 && s.y > 40 && s.x < S.view.width - 40 && s.y < S.view.height - 40;
    if (!inside) animateView({ cx: it.x, cy: it.y, scale: S.view.scale }, FIT_ANIM_MS);
  }
  function init(canvasEl) {
    if (S.canvas) return; // already initialised
    if (!canvasEl || typeof canvasEl.getContext !== 'function') {
      console.error('[plan2d] canvas #plan-canvas não encontrado');
      return;
    }
    const ctx = canvasEl.getContext('2d');
    if (!ctx) {
      console.error('[plan2d] contexto 2D indisponível');
      return;
    }
    S.canvas = canvasEl;
    S.ctx = ctx;
    S.parent = prepareCanvas(canvasEl);
    bindEvents(canvasEl);
    observeSize(S.parent);
    const st = store();
    if (st) {
      S.unsubs.push(st.subscribe(onDocChange));
      S.unsubs.push(st.subscribeUI(onUIChange));
    }
    S.unsubs.push(DD.events.on('focus:item', onFocusItem));
    resize();
    updateCursor();
    requestFrame();
  }

  DD.plan2d = {
    init,
    redraw: markDirty,
    fit: () => fit(false),
    zoomBy,
    getViewport,
    setViewport,
    screenToWorld,
    worldToScreen,
    addFurnitureAt,
    exportPNG,
    cancel,
    // pure helpers & renderer, exposed for tools/test-plan2d.js (not part of the public contract)
    _test: {
      zoomAround, fitRect, floorBox, furnitureHandles, hitFurnitureHandle, resizeFromHandle, rotationFromPointer,
      handleCursor, hitTestSelect, hitWall, hitOpening, snapWallPoint, solidIntervals, pieceQuad, openingRange,
      retargetOpenings, layoutChainLabels, niceScaleBar, scaleLabel, stairsForFloor, roomLabelLines, tagSideOf,
      sideRays, backToWallRotation, cutsWall, makeRC, drawScene,
      state: () => S,
      setClock(fn) {
        clock = fn;
      },
    },
  };
})();
