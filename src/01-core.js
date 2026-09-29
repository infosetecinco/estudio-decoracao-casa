// ===== 01-core.js — namespace, utils, event bus, store (undo/redo), geometry, rooms, persistence =====
(function () {
  const DD = (window.DD = window.DD || {});

  // ------------------------------------------------------------------ utils
  const U = (DD.util = {});
  U.uid = (prefix) => (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 8) + (Date.now() % 1e6).toString(36);
  U.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  U.deg = (rad) => (rad * 180) / Math.PI;
  U.rad = (deg) => (deg * Math.PI) / 180;
  U.normDeg = (d) => ((d % 360) + 360) % 360;
  U.round = (v, step) => Math.round(v / (step || 1)) * (step || 1);
  // "2,50" — metres with Brazilian decimal comma
  U.fmtM = (mm, digits) => (mm / 1000).toFixed(digits == null ? 2 : digits).replace('.', ',');
  // round half-up on the decimal value (29.595 → "29,60"; plain toFixed gives 29,59 because of binary floats)
  U.round2 = (v) => Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100;
  U.fmtArea = (m2) => U.round2(m2).toFixed(2).replace('.', ',') + ' m²';
  U.fmtMM = (mm) => Math.round(mm).toLocaleString('pt-BR') + ' mm';
  U.easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  U.debounce = (fn, ms) => {
    let h = null;
    return function () {
      const args = arguments;
      clearTimeout(h);
      h = setTimeout(() => fn.apply(null, args), ms);
    };
  };
  U.clone = (o) => JSON.parse(JSON.stringify(o));
  U.escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // rotate local (lx,ly) by deg (clockwise on screen, because +y is down) and translate to (cx,cy)
  U.localToWorld = (cx, cy, rotDeg, lx, ly) => {
    const r = U.rad(rotDeg), c = Math.cos(r), s = Math.sin(r);
    return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
  };
  U.worldToLocal = (cx, cy, rotDeg, x, y) => {
    const r = U.rad(rotDeg), c = Math.cos(r), s = Math.sin(r), dx = x - cx, dy = y - cy;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  };
  U.polygonArea = (pts) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    return a / 2; // positive = clockwise on screen (y down)
  };
  U.pointInPolygon = (p, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  U.segDist = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = U.clamp(t, 0, 1);
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    return { d: Math.hypot(p.x - q.x, p.y - q.y), t, q };
  };
  // segment–segment intersection; returns {t,u,x,y} or null (t along p→p2, u along q→q2)
  U.segIntersect = (p, p2, q, q2) => {
    const r = { x: p2.x - p.x, y: p2.y - p.y }, s = { x: q2.x - q.x, y: q2.y - q.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-9) return null;
    const qp = { x: q.x - p.x, y: q.y - p.y };
    const t = (qp.x * s.y - qp.y * s.x) / den, u = (qp.x * r.y - qp.y * r.x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { t, u, x: p.x + t * r.x, y: p.y + t * r.y };
  };

  // ------------------------------------------------------------------ event bus
  const listeners = {};
  DD.events = {
    on(name, fn) {
      (listeners[name] = listeners[name] || new Set()).add(fn);
      return () => listeners[name].delete(fn);
    },
    emit(name, payload) {
      (listeners[name] || []).forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error('[DD.events]', name, e);
        }
      });
    },
  };
  DD.toast = (msg, kind) => DD.events.emit('toast', { msg, kind: kind || 'info' });

  // ------------------------------------------------------------------ store
  const HISTORY_MAX = 150;
  function createStore(initialDoc, initialUI) {
    let doc = initialDoc;
    let ui = initialUI;
    const undoStack = [];
    const redoStack = [];
    const subs = new Set();
    const uiSubs = new Set();
    let gestureStart = null;
    let gestureLabel = null;

    function notify(prev, info) {
      subs.forEach((fn) => {
        try {
          fn(doc, prev, info);
        } catch (e) {
          console.error('[store subscriber]', e);
        }
      });
    }
    function pushUndo(state, label) {
      undoStack.push({ state, label: label || 'Edição' });
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
      redoStack.length = 0;
    }
    const api = {
      get doc() {
        return doc;
      },
      get ui() {
        return ui;
      },
      getDoc: () => doc,
      getUI: () => ui,
      /** Replace the document with `next` (a NEW object — never mutate the old one) and record one undo step. */
      commit(next, label) {
        if (!next || next === doc) return;
        if (gestureStart) {
          // committing inside a gesture: fold into the gesture
          const prev = doc;
          doc = next;
          notify(prev, { label, transient: true });
          return;
        }
        pushUndo(doc, label);
        const prev = doc;
        doc = next;
        notify(prev, { label, source: 'commit' });
        DD.events.emit('doc:committed', { label });
      },
      /** Start a continuous interaction (drag). Subsequent preview() calls do not create history. */
      beginGesture(label) {
        if (!gestureStart) {
          gestureStart = doc;
          gestureLabel = label || 'Edição';
        }
      },
      /** Update the document during a gesture (or any transient change) without recording history. */
      preview(next) {
        if (!next || next === doc) return;
        const prev = doc;
        doc = next;
        notify(prev, { transient: true });
      },
      /** Finish the gesture: if anything changed, one undo step is recorded. */
      endGesture(label) {
        if (!gestureStart) return;
        const start = gestureStart;
        gestureStart = null;
        if (start !== doc) {
          pushUndo(start, label || gestureLabel);
          // prev = pre-gesture doc, so reference diffs in subscribers see everything the gesture changed
          notify(start, { label: label || gestureLabel, gestureEnd: true });
          DD.events.emit('doc:committed', { label: label || gestureLabel });
        }
      },
      cancelGesture() {
        if (!gestureStart) return;
        const prev = doc;
        doc = gestureStart;
        gestureStart = null;
        notify(prev, { cancel: true });
      },
      inGesture: () => !!gestureStart,
      /** Undo. During an open gesture (drag) it only aborts the gesture — the previous step is kept. */
      undo() {
        if (gestureStart) {
          const lbl = gestureLabel;
          api.cancelGesture();
          return lbl;
        }
        const e = undoStack.pop();
        if (!e) return null;
        redoStack.push({ state: doc, label: e.label });
        const prev = doc;
        doc = e.state;
        notify(prev, { undo: true, label: e.label });
        DD.events.emit('doc:committed', { label: e.label, undo: true });
        return e.label;
      },
      /** Redo. Ignored during an open gesture (the drag is aborted so the store never stays half-open). */
      redo() {
        if (gestureStart) {
          api.cancelGesture();
          return null;
        }
        const e = redoStack.pop();
        if (!e) return null;
        undoStack.push({ state: doc, label: e.label });
        const prev = doc;
        doc = e.state;
        notify(prev, { redo: true, label: e.label });
        DD.events.emit('doc:committed', { label: e.label, redo: true });
        return e.label;
      },
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      undoLabel: () => (undoStack.length ? undoStack[undoStack.length - 1].label : null),
      redoLabel: () => (redoStack.length ? redoStack[redoStack.length - 1].label : null),
      /** Load a whole new document (import / reset). Recorded as one undo step unless opts.clearHistory. */
      replace(next, label, opts) {
        if (gestureStart) api.cancelGesture();
        if (opts && opts.clearHistory) {
          undoStack.length = 0;
          redoStack.length = 0;
          const prev = doc;
          doc = next;
          notify(prev, { label, replaced: true });
          DD.events.emit('doc:committed', { label });
          return;
        }
        pushUndo(doc, label || 'Substituir projeto');
        const prev = doc;
        doc = next;
        notify(prev, { label, replaced: true });
        DD.events.emit('doc:committed', { label });
      },
      subscribe(fn) {
        subs.add(fn);
        return () => subs.delete(fn);
      },
      /** UI state (floor, view, tool, selection…) is NOT part of undo history. */
      setUI(patch) {
        const prev = ui;
        const next = Object.assign({}, ui, typeof patch === 'function' ? patch(ui) : patch);
        ui = next;
        uiSubs.forEach((fn) => {
          try {
            fn(ui, prev);
          } catch (e) {
            console.error('[ui subscriber]', e);
          }
        });
      },
      subscribeUI(fn) {
        uiSubs.add(fn);
        return () => uiSubs.delete(fn);
      },
    };
    return api;
  }
  DD.createStore = createStore;

  DD.defaultUI = () => ({
    floor: 'f0', // active floor id
    view: '2d', // '2d' | '3d' | 'split'
    tool: 'select', // 'select' | 'measure' | 'wall' | 'paint' | 'demolish' | 'pan'
    selection: null, // null | { kind: 'furniture'|'wall'|'opening'|'room'|'measure', id }
    hover: null, // same shape as selection, for hover highlight sync 2D<->3D
    cam3d: 'orbit', // 'orbit' | 'walk'
    showAllFloors: false, // 3D: show floors above the active one (and roof)
    snap: true, // furniture adsorbs to walls; walls snap to grid/endpoints
    paintMaterial: 'madeira', // material used by the paint tool
    show: { dims: true, furniture: true, areas: true, grid: true, labels: true, structure: true },
  });

  // ------------------------------------------------------------------ document helpers (immutable)
  const OPS = (DD.ops = {});
  OPS.floorById = (doc, id) => doc.floors.find((f) => f.id === id);
  OPS.byId = (doc, coll, id) => (doc[coll] || []).find((it) => it.id === id) || null;
  OPS.update = (doc, coll, id, patch) =>
    Object.assign({}, doc, {
      [coll]: doc[coll].map((it) => (it.id === id ? Object.assign({}, it, typeof patch === 'function' ? patch(it) : patch) : it)),
    });
  OPS.add = (doc, coll, item) => Object.assign({}, doc, { [coll]: doc[coll].concat([item]) });
  OPS.remove = (doc, coll, id) => Object.assign({}, doc, { [coll]: doc[coll].filter((it) => it.id !== id) });

  OPS.isEditableWall = (w) => !!w && w.kind === 'partition';
  OPS.KIND_LABEL = { structural: 'Estrutural', partition: 'Não estrutural (vedação)', muro: 'Muro de divisa', railing: 'Guarda-corpo / mureta' };

  /** Demolish a non-structural wall (and its openings). Returns { doc, error }. */
  OPS.demolishWall = (doc, wallId) => {
    const w = OPS.byId(doc, 'walls', wallId);
    if (!w) return { doc, error: 'Parede não encontrada.' };
    if (!OPS.isEditableWall(w))
      return { doc, error: w.kind === 'structural' ? 'Parede estrutural — não pode ser demolida.' : 'Este elemento não pode ser demolido.' };
    return {
      doc: Object.assign({}, doc, {
        walls: doc.walls.filter((x) => x.id !== wallId),
        openings: doc.openings.filter((o) => o.wall !== wallId),
      }),
      error: null,
    };
  };

  /** Add a new partition wall on a floor. */
  OPS.addWall = (doc, floorId, a, b, thick) => {
    const f = OPS.floorById(doc, floorId);
    const wall = {
      id: U.uid('w'),
      floor: floorId,
      a: { x: Math.round(a.x), y: Math.round(a.y) },
      b: { x: Math.round(b.x), y: Math.round(b.y) },
      thick: thick || 100,
      height: f ? f.height : 2880,
      kind: 'partition',
    };
    const next = OPS.reseedSplitRooms(doc, OPS.add(doc, 'walls', wall), floorId);
    return { doc: next, wall };
  };

  /**
   * After a wall change, give every newly enclosed region that used to belong to a room its own seed
   * ("Sala 2", same floor material), so a room split by a new wall never loses its other half.
   */
  OPS.reseedSplitRooms = (prevDoc, nextDoc, floorId) => {
    if (!DD.rooms) return nextDoc;
    const before = DD.rooms.compute(prevDoc, floorId).filter((r) => !r.open && r.outer);
    const STEP = 200;
    let doc = nextDoc;
    let added = 0;
    const inRoom = (r, p) => U.pointInPolygon(p, r.outer) && !r.holes.some((h) => U.pointInPolygon(p, h));
    const uniqueName = (base) => {
      const names = new Set(doc.roomSeeds.filter((x) => x.floor === floorId).map((x) => x.name));
      let n = 2;
      while (names.has(base + ' ' + n)) n++;
      return base + ' ' + n;
    };
    for (const R of before) {
      for (let y = R.bbox.minY + STEP / 2; y < R.bbox.maxY && added < 8; y += STEP) {
        for (let x = R.bbox.minX + STEP / 2; x < R.bbox.maxX && added < 8; x += STEP) {
          const p = { x, y };
          if (!inRoom(R, p) || DD.rooms.at(doc, floorId, x, y)) continue;
          const walls = doc.walls.filter((w) => w.floor === floorId);
          if (walls.some((w) => U.pointInPolygon(p, G.wallPolygon(w)))) continue;
          const seed = {
            id: U.uid('r'), floor: floorId, name: uniqueName(R.name.split(' + ')[0]),
            x: Math.round(x), y: Math.round(y), material: R.material, planArea: null, outdoor: R.outdoor,
          };
          doc = OPS.add(doc, 'roomSeeds', seed);
          added++;
          const room = DD.rooms.compute(doc, floorId).find((r) => r.seedIds.indexOf(seed.id) >= 0);
          if (!room || room.open || !room.outer) {
            doc = OPS.remove(doc, 'roomSeeds', seed.id); // leaked to the outside: not a room
            continue;
          }
          const c = { x: Math.round((room.bbox.minX + room.bbox.maxX) / 2), y: Math.round((room.bbox.minY + room.bbox.maxY) / 2) };
          if (inRoom(room, c) && !walls.some((w) => U.pointInPolygon(c, G.wallPolygon(w))))
            doc = OPS.update(doc, 'roomSeeds', seed.id, { x: c.x, y: c.y });
        }
      }
    }
    return doc;
  };

  /**
   * Translate a partition wall by (dx,dy). Other PARTITIONS on the same floor whose endpoint touched the moved
   * wall are stretched along their own axis so the joint is kept; locked walls (structural, muro, railing) are
   * never changed. Openings of the moved wall keep their `t`; openings of stretched walls keep their world
   * position (their `t` is re-based when the wall's `a` end moves).
   */
  OPS.moveWall = (doc, wallId, dx, dy) => {
    const w = OPS.byId(doc, 'walls', wallId);
    if (!w) return doc;
    const moved = Object.assign({}, w, { a: { x: w.a.x + dx, y: w.a.y + dy }, b: { x: w.b.x + dx, y: w.b.y + dy } });
    const L = U.dist(w.a, w.b) || 1;
    const dir = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const sameFloor = doc.walls.filter((x) => x.floor === w.floor);
    // A joint at one END of the moved wall that is shared with a third wall (e.g. a collinear continuation)
    // belongs to that third wall too: stretching the perpendicular wall there would open a gap.
    const sharedJoint = (p, o) =>
      sameFloor.some((x) => x.id !== w.id && x.id !== o.id && U.segDist(p, x.a, x.b).d <= x.thick / 2 + 6);
    const tShift = {}; // wallId -> mm to add to the t of its openings (when its `a` end moved)
    const walls = doc.walls.map((o) => {
      if (o.id === wallId) return moved;
      if (o.floor !== w.floor || !OPS.isEditableWall(o)) return o;
      const oL = U.dist(o.a, o.b) || 1;
      const od = { x: (o.b.x - o.a.x) / oL, y: (o.b.y - o.a.y) / oL };
      if (Math.abs(od.x * dir.x + od.y * dir.y) > 0.3) return o; // only roughly perpendicular walls
      let changed = false;
      const res = { a: o.a, b: o.b };
      ['a', 'b'].forEach((end) => {
        const p = o[end];
        const sd = U.segDist(p, w.a, w.b);
        const atEnd = Math.min(sd.t * L, (1 - sd.t) * L) <= o.thick / 2 + 6;
        if (atEnd && sharedJoint(p, o)) return;
        if (sd.d <= w.thick / 2 + 6 && sd.t > -0.001 && sd.t < 1.001) {
          // slide endpoint along the other wall's axis onto the moved wall's centre line
          const other = end === 'a' ? o.b : o.a;
          const hit = lineIntersect(other, p, moved.a, moved.b);
          if (hit) {
            res[end] = { x: Math.round(hit.x), y: Math.round(hit.y) };
            changed = true;
          }
        }
      });
      if (!changed) return o;
      if (res.a !== o.a) tShift[o.id] = (o.a.x - res.a.x) * od.x + (o.a.y - res.a.y) * od.y;
      return Object.assign({}, o, res);
    });
    const shifted = Object.keys(tShift).length;
    const openings = shifted
      ? doc.openings.map((op) => (tShift[op.wall] ? Object.assign({}, op, { t: op.t + tShift[op.wall] }) : op))
      : doc.openings;
    return Object.assign({}, doc, { walls, openings });
  };
  function lineIntersect(p1, p2, p3, p4) {
    const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (Math.abs(d) < 1e-9) return null;
    const a = p1.x * p2.y - p1.y * p2.x, b = p3.x * p4.y - p3.y * p4.x;
    return { x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d, y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d };
  }
  DD.util.lineIntersect = lineIntersect;

  /** Set floor material for all seeds of a room. */
  OPS.setRoomMaterial = (doc, seedIds, material) =>
    Object.assign({}, doc, { roomSeeds: doc.roomSeeds.map((s) => (seedIds.indexOf(s.id) >= 0 ? Object.assign({}, s, { material }) : s)) });

  OPS.renameRoom = (doc, seedId, name) => OPS.update(doc, 'roomSeeds', seedId, { name });

  /** Add a furniture item using catalog defaults. */
  OPS.addFurniture = (doc, type, floorId, x, y, rot) => {
    const def = DD.catalog && DD.catalog.types[type];
    if (!def) return { doc, item: null };
    const item = {
      id: U.uid('f'),
      floor: floorId,
      type,
      x: Math.round(x),
      y: Math.round(y),
      rot: rot || 0,
      w: def.w,
      d: def.d,
      h: def.h,
      elev: def.elev || 0,
      color: null,
    };
    return { doc: OPS.add(doc, 'furniture', item), item };
  };
  OPS.duplicateFurniture = (doc, id) => {
    const it = OPS.byId(doc, 'furniture', id);
    if (!it) return { doc, item: null };
    const item = Object.assign({}, it, { id: U.uid('f'), x: it.x + 300, y: it.y + 300 });
    return { doc: OPS.add(doc, 'furniture', item), item };
  };
  OPS.addOpening = (doc, wallId, code, t) => {
    const w = OPS.byId(doc, 'walls', wallId);
    const s = DD.data.SCHEDULE[code];
    if (!w || !s) return { doc, opening: null };
    const L = U.dist(w.a, w.b);
    const op = {
      id: U.uid('o'),
      wall: wallId,
      code,
      type: s.type,
      t: U.clamp(t == null ? L / 2 : t, s.width / 2, Math.max(s.width / 2, L - s.width / 2)),
      width: s.width,
      height: s.height,
      sill: s.sill,
      style: s.style,
      hinge: 'start',
      side: 1,
    };
    return { doc: OPS.add(doc, 'openings', op), opening: op };
  };

  // ------------------------------------------------------------------ geometry
  const G = (DD.geom = {});

  G.wallDir = (w) => {
    const L = U.dist(w.a, w.b) || 1;
    const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    return { L, d, n: { x: -d.y, y: d.x } }; // n = left normal (for a +x wall, n = +y)
  };
  /** 4 corners of a wall rectangle (clockwise on screen): a+n, b+n, b-n, a-n (n scaled by thick/2). */
  G.wallPolygon = (w) => {
    const { d, n } = G.wallDir(w);
    const h = w.thick / 2;
    void d;
    return [
      { x: w.a.x + n.x * h, y: w.a.y + n.y * h },
      { x: w.b.x + n.x * h, y: w.b.y + n.y * h },
      { x: w.b.x - n.x * h, y: w.b.y - n.y * h },
      { x: w.a.x - n.x * h, y: w.a.y - n.y * h },
    ];
  };
  /** Two faces of a wall as segments with the outward normal of each face. */
  G.wallFaces = (w) => {
    const { d, n, L } = G.wallDir(w);
    const h = w.thick / 2;
    return [
      { wall: w.id, a: { x: w.a.x + n.x * h, y: w.a.y + n.y * h }, b: { x: w.b.x + n.x * h, y: w.b.y + n.y * h }, n: { x: n.x, y: n.y }, d, L },
      { wall: w.id, a: { x: w.a.x - n.x * h, y: w.a.y - n.y * h }, b: { x: w.b.x - n.x * h, y: w.b.y - n.y * h }, n: { x: -n.x, y: -n.y }, d, L },
    ];
  };
  /** Opening frame in plan: centre, direction along wall, normal, jamb points on the centre line. */
  G.openingFrame = (w, op) => {
    const { d, n, L } = G.wallDir(w);
    const c = { x: w.a.x + d.x * op.t, y: w.a.y + d.y * op.t };
    const hw = op.width / 2;
    return {
      c, d, n, L,
      start: { x: c.x - d.x * hw, y: c.y - d.y * hw }, // jamb nearer wall.a
      end: { x: c.x + d.x * hw, y: c.y + d.y * hw }, // jamb nearer wall.b
      t0: op.t - hw,
      t1: op.t + hw,
    };
  };
  G.openingsOfWall = (doc, wallId) => doc.openings.filter((o) => o.wall === wallId).sort((a, b) => a.t - b.t);

  /**
   * Split a wall into solid boxes around its openings (for 3D and walk collision).
   * Returns [{ t0, t1, z0, z1, part: 'solid'|'sill'|'lintel', opening? }] — t along the wall from a (mm),
   * z from the floor level (mm). z1 of solids = wall.height.
   */
  G.wallPieces = (w, openings) => {
    const { L } = G.wallDir(w);
    const H = w.height;
    const ops = openings
      .filter((o) => o.wall === w.id)
      .map((o) => ({ o, s: U.clamp(o.t - o.width / 2, 0, L), e: U.clamp(o.t + o.width / 2, 0, L) }))
      .sort((a, b) => a.s - b.s);
    const out = [];
    let cur = 0;
    ops.forEach(({ o, s, e }) => {
      if (s > cur + 0.5) out.push({ t0: cur, t1: s, z0: 0, z1: H, part: 'solid' });
      const s2 = Math.max(s, cur);
      if (e > s2 + 0.5) {
        const sill = U.clamp(o.sill || 0, 0, H);
        const top = U.clamp((o.sill || 0) + o.height, 0, H);
        if (sill > 0.5) out.push({ t0: s2, t1: e, z0: 0, z1: sill, part: 'sill', opening: o.id });
        if (top < H - 0.5) out.push({ t0: s2, t1: e, z0: top, z1: H, part: 'lintel', opening: o.id });
      }
      cur = Math.max(cur, e);
    });
    if (L > cur + 0.5) out.push({ t0: cur, t1: L, z0: 0, z1: H, part: 'solid' });
    return out;
  };

  /**
   * Stair geometry of a U-stair (as drawn on the approved plan: "Espelho=18cm", 16 risers for 2,88 m).
   * Lower flight = far row (y+w/2..y+w) rising along +x with `lowerCount` treads; the landing spans both rows at
   * the far end and is step lowerCount+1 (at 1,44 m); the upper flight = near row going back along −x with
   * `upperCount` treads; the next floor is the last riser. riser = floorHeight / (lowerCount + upperCount + 2).
   * `landingLabel` is the landing's first cell, where the plan prints the step number (8).
   */
  G.stairGeometry = (st, floorHeight) => {
    const T = st.tread, W = st.width, hw = W / 2;
    const lower = Math.max(1, Math.round(st.lowerCount) || 1), upper = Math.max(1, Math.round(st.upperCount) || 1);
    const risers = lower + upper + 2;
    const r = floorHeight / risers;
    const landX = Math.min(st.x + Math.max(lower, upper) * T, st.x + st.length - T);
    const treads = [];
    for (let i = 0; i < lower; i++)
      treads.push({ n: i + 1, x0: st.x + i * T, y0: st.y + hw, x1: st.x + (i + 1) * T, y1: st.y + W, z: (i + 1) * r, flight: 0 });
    const landZ = (lower + 1) * r;
    const landing = [{ x0: landX, y0: st.y, x1: st.x + st.length, y1: st.y + W, z: landZ }];
    for (let j = 0; j < upper; j++) {
      const x1 = landX - j * T;
      treads.push({ n: lower + 2 + j, x0: x1 - T, y0: st.y, x1, y1: st.y + hw, z: (lower + 2 + j) * r, flight: 1 });
    }
    const midX = (landX + st.x + st.length) / 2;
    return {
      riser: r,
      risers,
      treads,
      landing,
      landingLabel: { n: lower + 1, x0: landX, y0: st.y + hw, x1: landX + T, y1: st.y + W, z: landZ },
      footprint: { x0: st.x, y0: st.y, x1: st.x + st.length, y1: st.y + W },
      // walk line: up the lower flight, round the landing, back along the upper flight
      walkline: [
        { x: st.x + T * 0.3, y: st.y + hw * 1.5 },
        { x: midX, y: st.y + hw * 1.5 },
        { x: midX, y: st.y + hw * 0.5 },
        { x: st.x + T * 0.3, y: st.y + hw * 0.5 },
      ],
    };
  };
  /** Height (mm above the stair's floor level) of the stair surface at (x,y), or null if outside. */
  G.stairHeightAt = (st, floorHeight, x, y) => {
    const g = G.stairGeometry(st, floorHeight);
    const f = g.footprint;
    if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) return null;
    let z = null;
    g.treads.concat(g.landing).forEach((t) => {
      if (x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) z = Math.max(z == null ? -1 : z, t.z);
    });
    return z == null ? 0 : z;
  };
  /** Stair openings (holes) in the slab of a floor = footprints of stairs rising from the floor below. */
  G.stairHoles = (doc, floorId) => {
    const idx = doc.floors.findIndex((f) => f.id === floorId);
    if (idx <= 0) return [];
    const below = doc.floors[idx - 1].id;
    return doc.stairs.filter((s) => s.floor === below).map((s) => ({ x0: s.x, y0: s.y, x1: s.x + s.length, y1: s.y + s.width, stair: s.id }));
  };

  /** Distance from p along unit dir to the first wall face on the floor (or Infinity). */
  G.raycastWalls = (doc, floorId, p, dir, maxDist) => {
    const far = { x: p.x + dir.x * (maxDist || 50000), y: p.y + dir.y * (maxDist || 50000) };
    let best = Infinity, hitWall = null;
    doc.walls.forEach((w) => {
      if (w.floor !== floorId) return;
      const poly = G.wallPolygon(w);
      for (let i = 0; i < 4; i++) {
        const h = U.segIntersect(p, far, poly[i], poly[(i + 1) % 4]);
        if (h) {
          const dd = Math.hypot(h.x - p.x, h.y - p.y);
          if (dd < best) {
            best = dd;
            hitWall = w.id;
          }
        }
      }
    });
    return { dist: best, wall: hitWall };
  };

  /** Footprint corners of a furniture item (clockwise on screen). */
  G.furnitureCorners = (it, x, y, rot) => {
    const cx = x == null ? it.x : x, cy = y == null ? it.y : y, r = rot == null ? it.rot : rot;
    const hw = it.w / 2, hd = it.d / 2;
    return [
      U.localToWorld(cx, cy, r, -hw, -hd),
      U.localToWorld(cx, cy, r, hw, -hd),
      U.localToWorld(cx, cy, r, hw, hd),
      U.localToWorld(cx, cy, r, -hw, hd),
    ];
  };

  /**
   * Wall adsorption for furniture. `prop` = proposed {x, y, rot}. Returns {x, y, rot, snaps:[{wall, face, side}]}.
   * If a wall face is within `threshold` mm of the item's nearest side, the item is rotated so that side is parallel
   * to the wall (the item's BACK — local -y — is preferred to face the wall when the rotation is ambiguous) and
   * translated so it touches the face. A second, perpendicular face can then snap it into a corner.
   */
  G.snapFurniture = (doc, floorId, item, prop, opts) => {
    opts = opts || {};
    const threshold = opts.threshold || 150;
    const angleTol = opts.angleTol == null ? 30 : opts.angleTol;
    const faces = [];
    doc.walls.forEach((w) => {
      if (w.floor !== floorId || w.kind === 'railing') return;
      G.wallFaces(w).forEach((f) => faces.push(f));
    });
    const res = { x: prop.x, y: prop.y, rot: prop.rot, snaps: [] };

    function extentAlong(rot, nx, ny) {
      const r = U.rad(rot);
      const ax = { x: Math.cos(r), y: Math.sin(r) }, ay = { x: -Math.sin(r), y: Math.cos(r) };
      return Math.abs((item.w / 2) * (ax.x * nx + ax.y * ny)) + Math.abs((item.d / 2) * (ay.x * nx + ay.y * ny));
    }
    function halfLenAlong(rot, ux, uy) {
      return extentAlong(rot, ux, uy);
    }
    function best(candFaces, fixedRot, excludeDir) {
      let bestC = null;
      candFaces.forEach((f) => {
        if (excludeDir && Math.abs(f.n.x * excludeDir.x + f.n.y * excludeDir.y) > 0.2) return;
        // rotation that makes the back (local -y) face the wall: back normal = -f.n  =>  (sin r, -cos r) = -n
        let rot = res.rot;
        if (!fixedRot) {
          const base = U.deg(Math.atan2(f.n.x, -f.n.y)) + 180; // back faces wall
          let bestK = null, bestDiff = 1e9;
          for (let k = 0; k < 4; k++) {
            const cand = U.normDeg(base + k * 90);
            let diff = Math.abs(U.normDeg(res.rot - cand));
            diff = Math.min(diff, 360 - diff);
            // prefer back-to-wall (k = 0) slightly
            const score = diff - (k === 0 ? 8 : 0);
            if (score < bestDiff) {
              bestDiff = score;
              bestK = cand;
            }
          }
          let realDiff = Math.abs(U.normDeg(res.rot - bestK));
          realDiff = Math.min(realDiff, 360 - realDiff);
          if (realDiff > angleTol) return;
          rot = bestK;
        }
        const e = extentAlong(rot, f.n.x, f.n.y);
        const s = (res.x - f.a.x) * f.n.x + (res.y - f.a.y) * f.n.y; // signed distance of centre from face
        const gap = s - e;
        if (s < 0 || gap > threshold) return; // centre behind the face, or too far away (any overlap snaps back)
        // must overlap the face segment along its direction
        const along = (res.x - f.a.x) * f.d.x + (res.y - f.a.y) * f.d.y;
        const hl = halfLenAlong(rot, f.d.x, f.d.y);
        if (along < -hl * 0.6 || along > f.L + hl * 0.6) return;
        // an item sunk into a wall is pushed out first; otherwise the nearest face wins
        const better = !bestC || (gap < 0 && bestC.gap < 0 ? gap < bestC.gap : gap < 0 !== bestC.gap < 0 ? gap < 0 : Math.abs(gap) < Math.abs(bestC.gap));
        if (better) bestC = { f, rot, gap };
      });
      return bestC;
    }
    const c1 = best(faces, false, null);
    if (!c1) return res;
    res.rot = c1.rot;
    res.x -= c1.f.n.x * c1.gap;
    res.y -= c1.f.n.y * c1.gap;
    res.snaps.push({ wall: c1.f.wall, n: c1.f.n });
    // corner: a face perpendicular to the first
    const perp = faces.filter((f) => Math.abs(f.n.x * c1.f.n.x + f.n.y * c1.f.n.y) < 0.2);
    const c2 = best(perp, true, null);
    if (c2) {
      res.x -= c2.f.n.x * c2.gap;
      res.y -= c2.f.n.y * c2.gap;
      res.snaps.push({ wall: c2.f.wall, n: c2.f.n });
    }
    res.x = Math.round(res.x);
    res.y = Math.round(res.y);
    return res;
  };

  /** Wall endpoints / corners on a floor for snapping (measure tool, wall drawing). */
  G.snapPoints = (doc, floorId) => {
    const pts = [];
    doc.walls.forEach((w) => {
      if (w.floor !== floorId) return;
      pts.push({ x: w.a.x, y: w.a.y, kind: 'end' }, { x: w.b.x, y: w.b.y, kind: 'end' });
      G.wallPolygon(w).forEach((p) => pts.push({ x: p.x, y: p.y, kind: 'corner' }));
    });
    return pts;
  };

  /**
   * Dimension breakpoints for the automatic dimension chains around a floor, one list per facade (like the
   * approved drawing): a wall contributes to a side only if it reaches that facade — its end looks out of the
   * building on that side (the ray from it crosses no structural/partition wall and no indoor room), directly or
   * through the facade wall it butts into. Upper floors also count railings and muros (balconies, terraces).
   * Returns { bbox, top, bottom, left, right } (x lists for top/bottom, y lists for left/right, each including the
   * bbox ends) plus the legacy aliases xs=top, xsExt=bottom, ys=left, ysExt=right. Cached per doc identity.
   */
  const dimCache = new Map();
  G.dimensionData = (doc, floorId) => {
    const c = dimCache.get(floorId);
    if (c && c.walls === doc.walls && c.seeds === doc.roomSeeds && c.seps === doc.separators && c.floors === doc.floors)
      return c.data;
    const data = computeDimensionData(doc, floorId);
    dimCache.set(floorId, { walls: doc.walls, seeds: doc.roomSeeds, seps: doc.separators, floors: doc.floors, data });
    return data;
  };
  function computeDimensionData(doc, floorId) {
    const floor = OPS.floorById(doc, floorId);
    const upper = !!floor && floor.level > 0;
    const ws = doc.walls.filter(
      (w) => w.floor === floorId && U.dist(w.a, w.b) > 1 &&
        (w.kind === 'structural' || w.kind === 'partition' || (upper && (w.kind === 'railing' || w.kind === 'muro')))
    );
    if (!ws.length) return null;
    const polys = new Map(ws.map((w) => [w.id, G.wallPolygon(w)]));
    const blockers = ws.filter((w) => w.kind === 'structural' || w.kind === 'partition');
    const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    polys.forEach((poly) =>
      poly.forEach((p) => {
        bbox.minX = Math.min(bbox.minX, p.x);
        bbox.minY = Math.min(bbox.minY, p.y);
        bbox.maxX = Math.max(bbox.maxX, p.x);
        bbox.maxY = Math.max(bbox.maxY, p.y);
      })
    );
    const indoor = DD.rooms ? DD.rooms.compute(doc, floorId).filter((r) => !r.open && r.outer && !r.outdoor) : [];
    const DIRS = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const isVertical = (w) => Math.abs(w.a.x - w.b.x) < 1;
    const isHorizontal = (w) => Math.abs(w.a.y - w.b.y) < 1;
    const inWall = (p, id) => U.pointInPolygon(p, polys.get(id));
    // walk outwards from p until past the bbox: blocked by structural/partition walls or indoor rooms
    const rayClear = (p, dir, ignore) => {
      const reach = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) + 200;
      for (let d = 0; d <= reach; d += 50) {
        const q = { x: p.x + dir.x * d, y: p.y + dir.y * d };
        if (q.x < bbox.minX - 1 || q.x > bbox.maxX + 1 || q.y < bbox.minY - 1 || q.y > bbox.maxY + 1) return true;
        if (blockers.some((w) => ignore.indexOf(w.id) < 0 && inWall(q, w.id))) return false;
        if (indoor.some((r) => U.pointInPolygon(q, r.outer))) return false;
      }
      return true;
    };
    const facePoint = (w, dir) => {
      // point on the wall's polygon furthest along dir (its end or face towards the side), nudged out 2 mm
      let best = null;
      polys.get(w.id).forEach((p) => {
        const v = p.x * dir.x + p.y * dir.y;
        if (!best || v > best.v + 0.5) best = { v, p };
      });
      const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      const along = dir.x ? { x: best.p.x, y: mid.y } : { x: mid.x, y: best.p.y };
      return { x: along.x + dir.x * 2, y: along.y + dir.y * 2 };
    };
    const isFacade = (w, dir) => rayClear(facePoint(w, dir), dir, [w.id]);
    const reaches = (w, dir) => {
      const start = facePoint(w, dir);
      const touched = ws.find((o) => o.id !== w.id && inWall(start, o.id));
      if (!touched) return rayClear(start, dir, [w.id]);
      const perpendicular = dir.x ? isVertical(touched) : isHorizontal(touched);
      return perpendicular && isFacade(touched, dir);
    };
    const uniq = (arr, lo, hi) => {
      const out = [];
      arr.concat([lo, hi]).filter((v) => v >= lo - 1 && v <= hi + 1).sort((a, b) => a - b).forEach((v) => {
        if (!out.length || v - out[out.length - 1] > 4) out.push(Math.round(v));
      });
      return out;
    };
    const side = (name) => {
      const dir = DIRS[name];
      const vals = [];
      ws.forEach((w) => {
        const across = dir.y ? isVertical(w) : isHorizontal(w);
        // slim guards (e.g. the 50 mm steel guard at the stair void) bound the bbox but are not dimensioned
        if (!across || w.thick < 100 || !reaches(w, dir)) return;
        const c = dir.y ? w.a.x : w.a.y;
        vals.push(c - w.thick / 2, c + w.thick / 2);
      });
      return dir.y ? uniq(vals, bbox.minX, bbox.maxX) : uniq(vals, bbox.minY, bbox.maxY);
    };
    const top = side('top'), bottom = side('bottom'), left = side('left'), right = side('right');
    return { bbox, top, bottom, left, right, xs: top, xsExt: bottom, ys: left, ysExt: right };
  }

  // ------------------------------------------------------------------ rooms (automatic detection)
  // Walls are rasterised on a 10 mm grid; each room seed flood-fills its region; the region outline is traced
  // back into a rectilinear polygon. Area = cell count × 1e-4 m² (exact for walls on a 10 mm grid).
  const CELL = 10; // exact grid (mm)
  const CELL_PREVIEW = 25; // coarser grid while a gesture (e.g. a wall drag) is re-shaping rooms every frame
  const FAR = 20000; // geometry farther than this outside the lot is ignored by room detection
  const roomCache = new Map();
  const inGesture = () => !!(DD.store && DD.store.inGesture && DD.store.inGesture());
  // Scratch buffers reused between computations (a wall drag recomputes rooms every frame).
  const pool = {};
  function scratch(name, Ctor, size, fill) {
    let buf = pool[name];
    if (!buf || buf.length < size) buf = pool[name] = new Ctor(size);
    const view = buf.length === size ? buf : buf.subarray(0, size);
    view.fill(fill || 0);
    return view;
  }

  function rasterizeFloor(doc, floorId, CELL) {
    const lot = (doc.site && doc.site.lot) || { w: 9000, h: 20000 };
    const near = (p) => p.x > -FAR && p.y > -FAR && p.x < lot.w + FAR && p.y < lot.h + FAR;
    const walls = doc.walls.filter((w) => w.floor === floorId && near(w.a) && near(w.b) && U.dist(w.a, w.b) > 1);
    const seps = (doc.separators || []).filter((s) => s.floor === floorId && near(s.a) && near(s.b));
    const seeds = doc.roomSeeds.filter((s) => s.floor === floorId && near(s));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    };
    walls.forEach((w) => G.wallPolygon(w).forEach(grow));
    seeds.forEach(grow);
    seps.forEach((s) => {
      grow(s.a);
      grow(s.b);
    });
    if (!isFinite(minX)) return null;
    const x0 = Math.floor(minX / CELL) * CELL - 3 * CELL;
    const y0 = Math.floor(minY / CELL) * CELL - 3 * CELL;
    const W = Math.ceil((maxX - x0) / CELL) + 4;
    const H = Math.ceil((maxY - y0) / CELL) + 4;
    const blocked = scratch('blocked', Uint8Array, W * H, 0);
    // walls: cell centre inside the wall rectangle (half-open so adjacent walls don't double count)
    walls.forEach((w) => {
      const { d, n, L } = G.wallDir(w);
      const hT = w.thick / 2;
      const poly = G.wallPolygon(w);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      poly.forEach((p) => {
        bx0 = Math.min(bx0, p.x);
        by0 = Math.min(by0, p.y);
        bx1 = Math.max(bx1, p.x);
        by1 = Math.max(by1, p.y);
      });
      const i0 = Math.max(0, Math.floor((bx0 - x0) / CELL) - 1), i1 = Math.min(W - 1, Math.ceil((bx1 - x0) / CELL) + 1);
      const j0 = Math.max(0, Math.floor((by0 - y0) / CELL) - 1), j1 = Math.min(H - 1, Math.ceil((by1 - y0) / CELL) + 1);
      for (let j = j0; j <= j1; j++) {
        const cy = y0 + (j + 0.5) * CELL;
        for (let i = i0; i <= i1; i++) {
          const cx = x0 + (i + 0.5) * CELL;
          const rx = cx - w.a.x, ry = cy - w.a.y;
          const s = rx * d.x + ry * d.y;
          const u = rx * n.x + ry * n.y;
          if (s >= 0 && s < L && u >= -hT && u < hT) blocked[j * W + i] = 1;
        }
      }
    });
    // separators: zero-thickness barriers between neighbouring cells
    const barR = scratch('barR', Uint8Array, W * H, 0); // barrier between (i,j) and (i+1,j)
    const barD = scratch('barD', Uint8Array, W * H, 0); // barrier between (i,j) and (i,j+1)
    seps.forEach((s) => {
      const i0 = Math.max(0, Math.floor((Math.min(s.a.x, s.b.x) - x0) / CELL) - 2);
      const i1 = Math.min(W - 2, Math.ceil((Math.max(s.a.x, s.b.x) - x0) / CELL) + 2);
      const j0 = Math.max(0, Math.floor((Math.min(s.a.y, s.b.y) - y0) / CELL) - 2);
      const j1 = Math.min(H - 2, Math.ceil((Math.max(s.a.y, s.b.y) - y0) / CELL) + 2);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const p = { x: x0 + (i + 0.5) * CELL, y: y0 + (j + 0.5) * CELL };
          if (U.segIntersect(p, { x: p.x + CELL, y: p.y }, s.a, s.b)) barR[j * W + i] = 1;
          if (U.segIntersect(p, { x: p.x, y: p.y + CELL }, s.a, s.b)) barD[j * W + i] = 1;
        }
    });
    return { x0, y0, W, H, blocked, barR, barD, seeds };
  }

  function traceRegion(label, W, H, rid, bx0, by0, bx1, by1) {
    // directed boundary edges, region on the right (clockwise on screen)
    const edges = []; // [fromVertex, toVertex, dx, dy]
    const VW = W + 1;
    const inR = (i, j) => i >= 0 && j >= 0 && i < W && j < H && label[j * W + i] === rid;
    for (let j = by0; j <= by1; j++)
      for (let i = bx0; i <= bx1; i++) {
        if (label[j * W + i] !== rid) continue;
        if (!inR(i, j - 1)) edges.push([j * VW + i, j * VW + i + 1, 1, 0]);
        if (!inR(i + 1, j)) edges.push([j * VW + i + 1, (j + 1) * VW + i + 1, 0, 1]);
        if (!inR(i, j + 1)) edges.push([(j + 1) * VW + i + 1, (j + 1) * VW + i, -1, 0]);
        if (!inR(i - 1, j)) edges.push([(j + 1) * VW + i, j * VW + i, 0, -1]);
      }
    const byStart = new Map();
    edges.forEach((e, k) => {
      const l = byStart.get(e[0]);
      if (l) l.push(k);
      else byStart.set(e[0], [k]);
    });
    const used = new Uint8Array(edges.length);
    const loops = [];
    for (let k0 = 0; k0 < edges.length; k0++) {
      if (used[k0]) continue;
      const loop = [];
      let k = k0;
      let guard = 0;
      while (k != null && !used[k] && guard++ < 1e6) {
        used[k] = 1;
        const e = edges[k];
        loop.push(e);
        const cands = (byStart.get(e[1]) || []).filter((c) => !used[c]);
        if (!cands.length) break;
        if (cands.length === 1) k = cands[0];
        else {
          // pinch vertex: prefer a right turn (keeps the region on the right)
          const rx = -e[3], ry = e[2];
          k = cands.find((c) => edges[c][2] === rx && edges[c][3] === ry);
          if (k == null) k = cands.find((c) => edges[c][2] === e[2] && edges[c][3] === e[3]);
          if (k == null) k = cands[0];
        }
      }
      // simplify: keep vertices where direction changes
      const pts = [];
      for (let q = 0; q < loop.length; q++) {
        const prev = loop[(q - 1 + loop.length) % loop.length];
        const cur = loop[q];
        if (prev[2] !== cur[2] || prev[3] !== cur[3]) pts.push(cur[0]);
      }
      if (pts.length >= 3) loops.push(pts.map((v) => ({ i: v % VW, j: Math.floor(v / VW) })));
    }
    return loops;
  }

  function computeRooms(doc, floorId) {
    const key = floorId;
    const c = roomCache.get(key);
    const coarse = inGesture();
    if (c && c.walls === doc.walls && c.seeds === doc.roomSeeds && c.seps === doc.separators && (!c.coarse || coarse))
      return c.rooms;
    const CELL = coarse ? CELL_PREVIEW : DD.rooms.CELL;
    const R = rasterizeFloor(doc, floorId, CELL);
    const rooms = [];
    if (R) {
      const { x0, y0, W, H, blocked, barR, barD, seeds } = R;
      const label = scratch('label', Int32Array, W * H, -1);
      const regions = [];
      const stack = scratch('stack', Int32Array, W * H, 0);
      seeds.forEach((seed) => {
        let si = Math.floor((seed.x - x0) / CELL), sj = Math.floor((seed.y - y0) / CELL);
        // seed inside a wall? search nearby for a free cell
        if (si < 0 || sj < 0 || si >= W || sj >= H || blocked[sj * W + si]) {
          let found = false;
          for (let r = 1; r < 40 && !found; r++)
            for (let dj = -r; dj <= r && !found; dj++)
              for (let di = -r; di <= r && !found; di++) {
                const i = si + di, j = sj + dj;
                if (i >= 0 && j >= 0 && i < W && j < H && !blocked[j * W + i]) {
                  si = i;
                  sj = j;
                  found = true;
                }
              }
          if (!found) return;
        }
        const idx0 = sj * W + si;
        if (label[idx0] >= 0) {
          regions[label[idx0]].seeds.push(seed);
          return;
        }
        const rid = regions.length;
        const reg = { rid, seeds: [seed], cells: 0, open: false, bx0: si, by0: sj, bx1: si, by1: sj };
        regions.push(reg);
        let sp = 0;
        stack[sp++] = idx0;
        label[idx0] = rid;
        while (sp) {
          const idx = stack[--sp];
          const i = idx % W, j = (idx - i) / W;
          reg.cells++;
          if (i < reg.bx0) reg.bx0 = i;
          if (i > reg.bx1) reg.bx1 = i;
          if (j < reg.by0) reg.by0 = j;
          if (j > reg.by1) reg.by1 = j;
          if (i === 0 || j === 0 || i === W - 1 || j === H - 1) {
            reg.open = true;
          }
          // right
          if (i < W - 1 && !barR[idx]) {
            const n = idx + 1;
            if (!blocked[n] && label[n] < 0) {
              label[n] = rid;
              stack[sp++] = n;
            }
          }
          if (i > 0 && !barR[idx - 1]) {
            const n = idx - 1;
            if (!blocked[n] && label[n] < 0) {
              label[n] = rid;
              stack[sp++] = n;
            }
          }
          if (j < H - 1 && !barD[idx]) {
            const n = idx + W;
            if (!blocked[n] && label[n] < 0) {
              label[n] = rid;
              stack[sp++] = n;
            }
          }
          if (j > 0 && !barD[idx - W]) {
            const n = idx - W;
            if (!blocked[n] && label[n] < 0) {
              label[n] = rid;
              stack[sp++] = n;
            }
          }
        }
      });
      regions.forEach((reg) => {
        const primary = reg.seeds[0];
        const names = [];
        reg.seeds.forEach((s) => {
          if (names.indexOf(s.name) < 0) names.push(s.name);
        });
        const room = {
          id: 'room:' + primary.id,
          floor: floorId,
          seedIds: reg.seeds.map((s) => s.id),
          name: names.join(' + '),
          material: primary.material,
          outdoor: reg.seeds.every((s) => s.outdoor),
          planArea: reg.seeds.length === 1 ? primary.planArea : null,
          open: reg.open,
          cells: reg.cells,
          area: reg.open ? 0 : (reg.cells * CELL * CELL) / 1e6,
          labelX: primary.x,
          labelY: primary.y,
          outer: null,
          holes: [],
          bbox: {
            minX: x0 + reg.bx0 * CELL,
            minY: y0 + reg.by0 * CELL,
            maxX: x0 + (reg.bx1 + 1) * CELL,
            maxY: y0 + (reg.by1 + 1) * CELL,
          },
          perimeter: 0,
        };
        if (!reg.open) {
          const loops = traceRegion(label, W, H, reg.rid, reg.bx0, reg.by0, reg.bx1, reg.by1).map((l) =>
            l.map((v) => ({ x: x0 + v.i * CELL, y: y0 + v.j * CELL }))
          );
          loops.sort((a, b) => Math.abs(U.polygonArea(b)) - Math.abs(U.polygonArea(a)));
          room.outer = loops[0] || null;
          room.holes = loops.slice(1);
          if (room.outer)
            room.perimeter = room.outer.reduce((acc, p, i2) => acc + U.dist(p, room.outer[(i2 + 1) % room.outer.length]), 0);
        }
        rooms.push(room);
      });
    }
    roomCache.set(key, { walls: doc.walls, seeds: doc.roomSeeds, seps: doc.separators, rooms, coarse });
    return rooms;
  }

  DD.rooms = {
    CELL,
    /** Rooms of a floor: [{id, floor, seedIds, name, material, outdoor, planArea, open, area (m²), perimeter (mm),
     *  labelX, labelY, outer:[{x,y}], holes:[[{x,y}]], bbox}]. Cached per (walls, roomSeeds, separators) identity. */
    compute: computeRooms,
    /** Room containing a world point (uses polygon test on the computed rooms). */
    at(doc, floorId, x, y) {
      const rooms = computeRooms(doc, floorId);
      return (
        rooms.find(
          (r) => r.outer && U.pointInPolygon({ x, y }, r.outer) && !r.holes.some((h) => U.pointInPolygon({ x, y }, h))
        ) || null
      );
    },
    byId(doc, floorId, roomId) {
      return computeRooms(doc, floorId).find((r) => r.id === roomId) || null;
    },
    /** Total built (indoor) area of a floor, m². */
    totalArea(doc, floorId) {
      return computeRooms(doc, floorId)
        .filter((r) => !r.open && !r.outdoor)
        .reduce((a, r) => a + r.area, 0);
    },
  };

  // ------------------------------------------------------------------ persistence
  const LS_KEY = 'dd.decor.casa.v1';
  DD.persist = {
    key: LS_KEY,
    save(doc) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: new Date().toISOString(), doc }));
        return true;
      } catch (e) {
        console.warn('save failed', e);
        return false;
      }
    },
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const doc = DD.persist.validate(parsed && parsed.doc);
        return doc ? { doc, savedAt: parsed.savedAt } : null;
      } catch (e) {
        console.warn('load failed', e);
        return null;
      }
    },
    clear() {
      try {
        localStorage.removeItem(LS_KEY);
      } catch (e) {
        /* storage unavailable */
      }
    },
    /**
     * Schema validation for loaded/imported documents. Returns a NEW, normalised doc or null.
     * Structural problems (no floors, duplicate floor ids, too many broken items) reject the file; items with
     * a bad optional field get defaults; items with bad required fields are dropped (count in lastDropped).
     */
    lastDropped: 0,
    validate(input) {
      DD.persist.lastDropped = 0;
      if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
      const arrays = ['floors', 'walls', 'openings', 'roomSeeds', 'stairs', 'furniture'];
      for (const k of arrays) if (!Array.isArray(input[k])) return null;
      const num = (v) => typeof v === 'number' && isFinite(v);
      const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= (max || 80) ? v : null);
      const pt = (p) => (p && num(p.x) && num(p.y) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6 ? { x: p.x, y: p.y } : null);
      const floors = [];
      const floorIds = new Set();
      for (const f of input.floors) {
        if (!f || !str(f.id, 40) || floorIds.has(f.id) || !num(f.level) || !num(f.height) || f.height <= 0) return null;
        floorIds.add(f.id);
        floors.push({
          id: f.id, name: str(f.name, 60) || f.id, short: str(f.short, 4) || '', level: f.level, height: f.height,
          ceiling: num(f.ceiling) && f.ceiling > 0 ? f.ceiling : f.height - 100,
        });
      }
      if (!floors.length) return null;
      let dropped = 0, total = 0;
      const keep = (list, fn) =>
        list.map((it) => {
          total++;
          const r = it && typeof it === 'object' ? fn(it) : null;
          if (!r) dropped++;
          return r;
        }).filter(Boolean);
      const KINDS = ['structural', 'partition', 'muro', 'railing'];
      const walls = keep(input.walls, (w) => {
        const a = pt(w.a), b = pt(w.b);
        if (!str(w.id, 80) || !floorIds.has(w.floor) || !a || !b || !num(w.thick) || w.thick <= 0 || w.thick > 2000) return null;
        const kind = KINDS.indexOf(w.kind) >= 0 ? w.kind : 'partition';
        const out = { id: w.id, floor: w.floor, a, b, thick: w.thick, kind, height: num(w.height) && w.height > 0 ? w.height : DD.data.KIND_HEIGHT[kind] };
        if (num(w.mureta) && w.mureta >= 0) out.mureta = w.mureta;
        return out;
      });
      const wallIds = new Set(walls.map((w) => w.id));
      const openings = keep(input.openings, (o) => {
        if (!str(o.id, 80) || !wallIds.has(o.wall) || !num(o.t) || !num(o.width) || o.width <= 0 || !num(o.height) || o.height <= 0) return null;
        if (o.type !== 'door' && o.type !== 'window') return null;
        return {
          id: o.id, wall: o.wall, code: str(o.code, 12) || (o.type === 'door' ? 'P' : 'J'), type: o.type, t: o.t,
          width: o.width, height: o.height, sill: num(o.sill) && o.sill >= 0 ? o.sill : 0,
          style: str(o.style, 20) || (o.type === 'door' ? 'swing' : 'slide2'),
          hinge: o.hinge === 'end' ? 'end' : 'start', side: o.side === -1 ? -1 : 1,
        };
      });
      const roomSeeds = keep(input.roomSeeds, (r) => {
        if (!str(r.id, 80) || !floorIds.has(r.floor) || !num(r.x) || !num(r.y)) return null;
        return {
          id: r.id, floor: r.floor, name: str(String(r.name == null ? '' : r.name).slice(0, 60), 60) || 'Ambiente',
          x: r.x, y: r.y, material: str(r.material, 40) || 'porcelanato',
          planArea: num(r.planArea) ? r.planArea : null, outdoor: r.outdoor === true,
        };
      });
      const int = (v, lo, hi) => (num(v) && Math.round(v) === v && v >= lo && v <= hi ? v : null);
      const stairs = keep(input.stairs, (st) => {
        if (!str(st.id, 80) || !floorIds.has(st.floor) || !num(st.x) || !num(st.y)) return null;
        if (!(num(st.length) && st.length > 0 && num(st.width) && st.width > 0 && num(st.tread) && st.tread > 50)) return null;
        const lower = int(st.lowerCount, 1, 30), upper = int(st.upperCount, 1, 30);
        if (lower == null || upper == null) return null;
        return { id: st.id, floor: st.floor, x: st.x, y: st.y, length: st.length, width: st.width, tread: st.tread, lowerCount: lower, upperCount: upper };
      });
      const HEX = /^#[0-9a-fA-F]{6}$/;
      const furniture = keep(input.furniture, (f) => {
        if (!str(f.id, 80) || !floorIds.has(f.floor) || !str(f.type, 40) || !num(f.x) || !num(f.y)) return null;
        if (!(num(f.w) && f.w > 0 && f.w <= 20000 && num(f.d) && f.d > 0 && f.d <= 20000)) return null;
        const def = DD.catalog && DD.catalog.types ? DD.catalog.types[f.type] : null;
        return {
          id: f.id, floor: f.floor, type: f.type, x: f.x, y: f.y, rot: num(f.rot) ? U.normDeg(f.rot) : 0, w: f.w, d: f.d,
          h: num(f.h) && f.h > 0 ? f.h : def ? def.h : 800, elev: num(f.elev) ? f.elev : 0,
          color: typeof f.color === 'string' && HEX.test(f.color) ? f.color : null,
        };
      });
      const segs = (list) =>
        keep(Array.isArray(list) ? list : [], (m) => {
          const a = pt(m.a), b = pt(m.b);
          return str(m.id, 80) && floorIds.has(m.floor) && a && b ? { id: m.id, floor: m.floor, a, b } : null;
        });
      const separators = segs(input.separators);
      const measures = segs(input.measures);
      if (total && dropped / total > 0.2) return null;
      DD.persist.lastDropped = dropped;
      const defaults = DD.data.initialState();
      const ZONES = ['grass', 'paving', 'driveway'];
      const inSite = input.site && input.site.lot && num(input.site.lot.w) && num(input.site.lot.h) ? input.site : null;
      const site = inSite
        ? {
            lot: { w: inSite.lot.w, h: inSite.lot.h },
            street: str(inSite.street, 60) || defaults.site.street,
            northDeg: num(inSite.northDeg) ? inSite.northDeg : defaults.site.northDeg,
            zones: (Array.isArray(inSite.zones) ? inSite.zones : [])
              .filter((z) => z && ZONES.indexOf(z.kind) >= 0 && num(z.x) && num(z.y) && num(z.w) && num(z.h) && z.w > 0 && z.h > 0)
              .map((z) => ({ id: str(z.id, 80) || U.uid('z'), kind: z.kind, x: z.x, y: z.y, w: z.w, h: z.h })),
          }
        : defaults.site;
      const meta = { name: (input.meta && str(input.meta.name, 80)) || defaults.meta.name, source: (input.meta && str(input.meta.source, 120)) || defaults.meta.source };
      return { version: 1, meta, floors, walls, openings, roomSeeds, separators, stairs, furniture, measures, site };
    },
    downloadJSON(doc, filename) {
      const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
      DD.persist.downloadBlob(blob, filename || 'projeto-decoracao.json');
    },
    downloadDataURL(dataURL, filename) {
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      DD.persist.downloadDataURL(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    readJSONFile(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          try {
            const doc = DD.persist.validate(JSON.parse(r.result));
            if (!doc) reject(new Error('Arquivo não é um projeto válido.'));
            else resolve(doc);
          } catch (e) {
            reject(new Error('JSON inválido.'));
          }
        };
        r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        r.readAsText(file);
      });
    },
  };
})();
