// Test-only stand-ins for modules that are not delivered yet (injected by tools/build-ui-harness.js ONLY for
// namespaces that are missing). They implement just enough of CONTRACT §4 for the chrome to be exercised.
(function () {
  const DD = window.DD;

  if (!DD.plan2d) {
    let canvas = null;
    let vp = { cx: 4500, cy: 10000, scale: 0.04 };
    let raf = 0;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      return { w: Math.max(1, r.width), h: Math.max(1, r.height), r };
    };
    const w2s = (x, y) => {
      const { w, h, r } = size();
      return { x: r.left + w / 2 + (x - vp.cx) * vp.scale, y: r.top + h / 2 + (y - vp.cy) * vp.scale };
    };
    const s2w = (cx, cy) => {
      const { w, h, r } = size();
      return { x: vp.cx + (cx - r.left - w / 2) / vp.scale, y: vp.cy + (cy - r.top - h / 2) / vp.scale };
    };
    function draw() {
      raf = 0;
      const { w, h } = size();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#F3EFE6';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(vp.scale, vp.scale);
      ctx.translate(-vp.cx, -vp.cy);
      const doc = DD.store.doc;
      const ui = DD.store.ui;
      if (ui.show.grid) {
        ctx.strokeStyle = '#DAD2C3';
        ctx.lineWidth = 1 / vp.scale;
        for (let x = 0; x <= 9000; x += 1000) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 20000);
          ctx.stroke();
        }
        for (let y = 0; y <= 20000; y += 1000) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(9000, y);
          ctx.stroke();
        }
      }
      DD.rooms.compute(doc, ui.floor).forEach((r) => {
        if (!r.outer) return;
        const sel = ui.selection && ui.selection.id === r.id;
        ctx.fillStyle = sel ? 'rgba(217,100,58,.12)' : 'rgba(255,255,255,.35)';
        ctx.beginPath();
        r.outer.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
        if (ui.show.labels) {
          ctx.fillStyle = '#1F1D1A';
          ctx.font = `600 ${13 / vp.scale}px Space Grotesk`;
          ctx.textAlign = 'center';
          ctx.fillText(r.name, r.labelX, r.labelY);
        }
      });
      doc.walls.filter((w2) => w2.floor === ui.floor).forEach((wall) => {
        const poly = DD.geom.wallPolygon(wall);
        const sel = ui.selection && ui.selection.id === wall.id;
        ctx.fillStyle = sel ? '#D9643A' : { structural: '#2E2A26', partition: '#CFC6B7', muro: '#9C9385', railing: '#F3EFE6' }[wall.kind];
        ctx.strokeStyle = '#1F1D1A';
        ctx.lineWidth = 1 / vp.scale;
        ctx.beginPath();
        poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
      doc.furniture.filter((f) => f.floor === ui.floor).forEach((it) => {
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.rotate((it.rot * Math.PI) / 180);
        const sel = ui.selection && ui.selection.id === it.id;
        try {
          DD.catalog.draw2d(ctx, it, { px: 1 / vp.scale, selected: sel, color: it.color });
        } catch (e) {
          ctx.strokeRect(-it.w / 2, -it.d / 2, it.w, it.d);
        }
        if (sel) {
          ctx.strokeStyle = '#D9643A';
          ctx.lineWidth = 2 / vp.scale;
          ctx.strokeRect(-it.w / 2, -it.d / 2, it.w, it.d);
        }
        ctx.restore();
      });
      ctx.restore();
    }
    const api = {
      init(el) {
        canvas = el;
        new ResizeObserver(() => api.redraw()).observe(el);
        DD.store.subscribe(() => api.redraw());
        DD.store.subscribeUI(() => api.redraw());
        el.addEventListener('pointermove', (e) => DD.events.emit('plan2d:cursor', s2w(e.clientX, e.clientY)));
        el.addEventListener('pointerleave', () => DD.events.emit('plan2d:cursor', null));
        el.addEventListener('wheel', (e) => {
          e.preventDefault();
          api.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
        });
        el.addEventListener('click', (e) => {
          const p = s2w(e.clientX, e.clientY);
          const doc = DD.store.doc;
          const floor = DD.store.ui.floor;
          const f = doc.furniture.find((it) => it.floor === floor && Math.abs(DD.util.worldToLocal(it.x, it.y, it.rot, p.x, p.y).x) < it.w / 2 && Math.abs(DD.util.worldToLocal(it.x, it.y, it.rot, p.x, p.y).y) < it.d / 2);
          if (f) return DD.store.setUI({ selection: { kind: 'furniture', id: f.id } });
          const w = doc.walls.find((w2) => w2.floor === floor && DD.util.segDist(p, w2.a, w2.b).d < w2.thick / 2 + 40);
          if (w) {
            const op = doc.openings.find((o) => o.wall === w.id && Math.abs(DD.util.segDist(p, w.a, w.b).t * DD.util.dist(w.a, w.b) - o.t) < o.width / 2);
            return DD.store.setUI({ selection: op ? { kind: 'opening', id: op.id } : { kind: 'wall', id: w.id } });
          }
          const r = DD.rooms.at(doc, floor, p.x, p.y);
          DD.store.setUI({ selection: r ? { kind: 'room', id: r.id } : null });
        });
        api.fit();
      },
      redraw() {
        if (!raf && canvas) raf = requestAnimationFrame(draw);
      },
      fit() {
        if (!canvas) return;
        const { w, h } = size();
        vp = { cx: 4500, cy: 9500, scale: Math.min(w / 11000, h / 19000) };
        DD.events.emit('plan2d:viewport', api.getViewport());
        api.redraw();
      },
      zoomBy(f) {
        vp = Object.assign({}, vp, { scale: vp.scale * f });
        DD.events.emit('plan2d:viewport', api.getViewport());
        api.redraw();
      },
      getViewport() {
        const { w, h, r } = size();
        return { cx: vp.cx, cy: vp.cy, scale: vp.scale, width: w, height: h, rect: r };
      },
      setViewport(v) {
        vp = Object.assign({}, vp, v);
        api.redraw();
      },
      screenToWorld: s2w,
      worldToScreen: w2s,
      addFurnitureAt(type, cx, cy) {
        const p = s2w(cx, cy);
        const res = DD.ops.addFurniture(DD.store.doc, type, DD.store.ui.floor, p.x, p.y, 0);
        if (!res.item) return null;
        DD.store.commit(res.doc, 'Adicionar ' + DD.catalog.types[type].name);
        DD.store.setUI({ selection: { kind: 'furniture', id: res.item.id } });
        return res.item.id;
      },
      exportPNG() {
        return canvas.toDataURL('image/png');
      },
      cancel() {},
    };
    DD.plan2d = api;
  }

  if (!DD.view3d) {
    let host = null;
    let cv = null;
    let active = false;
    let ready = false;
    const paint = () => {
      if (!cv) return;
      const r = host.getBoundingClientRect();
      cv.width = Math.max(1, r.width);
      cv.height = Math.max(1, r.height);
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, cv.height);
      g.addColorStop(0, '#9fc3dd');
      g.addColorStop(0.6, '#e9e2d4');
      g.addColorStop(1, '#6f8b4e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.font = '600 16px Space Grotesk';
      ctx.textAlign = 'center';
      ctx.fillText('[stub 3D] ' + DD.store.ui.cam3d + (DD.store.ui.showAllFloors ? ' · todos os pavimentos' : ''), cv.width / 2, cv.height / 2);
    };
    const tween = (ms) => new Promise((res) => setTimeout(res, ms));
    DD.view3d = {
      init(el) {
        host = el;
        cv = document.createElement('canvas');
        cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
        el.appendChild(cv);
        setTimeout(() => {
          ready = true;
          paint();
        }, 600);
        DD.store.subscribeUI(paint);
      },
      isReady: () => ready,
      setActive(on) {
        active = !!on;
        if (active) paint();
      },
      resize: paint,
      setCameraMode(mode) {
        if (DD.store.ui.cam3d !== mode) DD.store.setUI({ cam3d: mode });
      },
      transitionFrom2D: (vp, ms) => tween(ms),
      transitionTo2D: (vp, ms) => tween(ms),
      exportPNG: () => (cv ? cv.toDataURL('image/png') : null),
      recenter() {
        DD.toast('[stub] recentralizar', 'info');
      },
    };
  }
})();
