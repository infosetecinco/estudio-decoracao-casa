// ===== 11-catalog.js — furniture catalog: types, 2D drafting symbols, thumbnails, default layout =====
// Local frame of every symbol (see CONTRACT §1): origin at the footprint centre, +x = width w, +y = depth d,
// BACK of the item at y = -d/2, front at +d/2. Units are millimetres; the caller has already translated and
// rotated the context. Everything below is derived from item.w / item.d so resized items stay correct.
(function () {
  'use strict';
  const DD = (window.DD = window.DD || {});

  const PAPER = '#F3EFE6';
  const INK = '#1F1D1A';
  const NEUTRAL = '#A39A8C';
  const STONE = '#3F3B36';
  const GLASS = '#6F97A6';
  const STEEL = '#AEB4B8';
  const SOIL = '#5A4636';
  const TERRACOTTA = '#B07A55';
  const TAIL_LIGHT = '#B23A2E';
  const GHOST_ALPHA = 0.4;
  const LW_OUT = 1.1; // screen px for outlines
  const LW_DET = 0.6; // screen px for details
  const THUMB_DPR = 2;
  const THUMB_FILL = 0.84; // share of the thumbnail the symbol occupies
  const TAU = Math.PI * 2;
  const NO_DASH = [];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ================================================================== categories & types
  const CATEGORIES = Object.freeze(
    [
      { id: 'sala', name: 'Sala de estar' },
      { id: 'jantar', name: 'Jantar' },
      { id: 'quarto', name: 'Quarto' },
      { id: 'cozinha', name: 'Cozinha e serviço' },
      { id: 'banheiro', name: 'Banheiro' },
      { id: 'externo', name: 'Área externa e garagem' },
      { id: 'decor', name: 'Decoração' },
    ].map(Object.freeze)
  );

  function T(name, category, w, d, h, color, extra) {
    return Object.freeze(Object.assign({ name, category, w, d, h, elev: 0, color }, extra || {}));
  }
  const FIX = { fixture: true };

  const TYPES = Object.freeze({
    // sala
    sofa3: T('Sofá 3 lugares', 'sala', 2100, 900, 850, '#8E8A80'),
    sofa2: T('Sofá 2 lugares', 'sala', 1600, 880, 850, '#8E8A80'),
    sofaL: T('Sofá com chaise', 'sala', 2700, 1650, 850, '#A7A095'),
    armchair: T('Poltrona', 'sala', 800, 820, 900, '#C27A4A'),
    coffeeTable: T('Mesa de centro', 'sala', 1100, 600, 400, '#7A5A3C'),
    sideTable: T('Mesa lateral', 'sala', 450, 450, 550, '#7A5A3C'),
    tvUnit: T('Rack com TV 65"', 'sala', 1800, 450, 1350, '#5A4636'),
    bookshelf: T('Estante', 'sala', 1200, 350, 2000, '#6B5641'),
    floorLamp: T('Luminária de piso', 'sala', 400, 400, 1650, '#1F1D1A'),
    // jantar
    dining4: T('Mesa 4 lugares', 'jantar', 1200, 1600, 750, '#7A5A3C'),
    dining6: T('Mesa 6 lugares', 'jantar', 1800, 1700, 750, '#7A5A3C'),
    dining8: T('Mesa 8 lugares', 'jantar', 2600, 1800, 750, '#7A5A3C'),
    roundTable: T('Mesa redonda 4 lugares', 'jantar', 1500, 1500, 750, '#7A5A3C'),
    chair: T('Cadeira', 'jantar', 450, 520, 850, '#6B5641'),
    sideboard: T('Aparador', 'jantar', 1600, 450, 800, '#7A5A3C'),
    // quarto
    bedQueen: T('Cama queen', 'quarto', 1600, 2100, 1050, '#E9E4DA'),
    bedDouble: T('Cama casal', 'quarto', 1400, 1950, 1000, '#E9E4DA'),
    bedSingle: T('Cama de solteiro', 'quarto', 900, 1950, 900, '#E9E4DA'),
    nightstand: T('Criado-mudo', 'quarto', 450, 400, 550, '#7A5A3C'),
    wardrobe: T('Guarda-roupa', 'quarto', 2000, 600, 2300, '#D9D2C5'),
    dresser: T('Cômoda', 'quarto', 1200, 500, 850, '#7A5A3C'),
    desk: T('Escrivaninha', 'quarto', 1200, 600, 750, '#B89A74'),
    officeChair: T('Cadeira de escritório', 'quarto', 620, 620, 1000, '#2E2A26'),
    closetIsland: T('Ilha de closet', 'quarto', 1200, 600, 900, '#D9D2C5'),
    // cozinha e serviço
    kitchenSink: T('Bancada com pia', 'cozinha', 2000, 600, 900, '#EDEAE4', FIX),
    counter: T('Balcão baixo', 'cozinha', 1000, 600, 900, '#EDEAE4'),
    stove: T('Fogão 5 bocas', 'cozinha', 760, 650, 900, '#C9CCCE'),
    fridge: T('Geladeira', 'cozinha', 700, 750, 1850, '#C9CCCE'),
    upperCabinet: T('Armário aéreo', 'cozinha', 1200, 350, 700, '#EDEAE4', { elev: 1500 }),
    island: T('Ilha de cozinha', 'cozinha', 1600, 900, 900, '#EDEAE4'),
    washer: T('Máquina de lavar', 'cozinha', 600, 650, 850, '#F2F2F0'),
    shelves: T('Estante metálica', 'cozinha', 900, 400, 1800, '#8A8F94'),
    // banheiro
    toilet: T('Vaso sanitário', 'banheiro', 380, 650, 780, '#F4F3F0', FIX),
    basin: T('Lavatório com gabinete', 'banheiro', 800, 460, 850, '#F4F3F0', FIX),
    shower: T('Box de banho', 'banheiro', 900, 900, 2000, '#BFD8DC', FIX),
    bathtub: T('Banheira', 'banheiro', 1700, 750, 550, '#F4F3F0', FIX),
    // área externa e garagem
    car: T('Carro (SUV)', 'externo', 1850, 4600, 1650, '#3E4A56'),
    bbq: T('Churrasqueira', 'externo', 900, 600, 2400, '#B85C3A'),
    outdoorTable: T('Mesa com guarda-sol', 'externo', 1800, 1800, 2300, '#E7E1D5'),
    lounger: T('Espreguiçadeira', 'externo', 700, 1900, 400, '#D6CBB8'),
    outdoorSofa: T('Sofá externo', 'externo', 1800, 800, 700, '#9AA59A'),
    planter: T('Floreira', 'externo', 1500, 400, 500, '#6F8F4E'),
    bike: T('Bicicleta', 'externo', 600, 1750, 1050, '#2BA3A3'),
    // decoração
    rug: T('Tapete', 'decor', 2000, 1400, 10, '#C9B79C', { flat: true }),
    plant: T('Vaso com planta', 'decor', 550, 550, 1300, '#5E8A48'),
  });

  // ================================================================== colour
  function parseHex(c) {
    if (typeof c !== 'string') return null;
    let s = c.trim().replace(/^#/, '');
    if (s.length === 3) s = s.replace(/./g, (ch) => ch + ch);
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mixRGB = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const cssRGB = (rgb) => 'rgb(' + rgb.join(',') + ')';
  const PAPER_RGB = parseHex(PAPER);
  const INK_RGB = parseHex(INK);
  const toPaper = (hex, t) => cssRGB(mixRGB(parseHex(hex), PAPER_RGB, t));

  // Fixed accent tones (materials that do not follow the item colour), pre-blended with the paper.
  const TONE = Object.freeze({
    glass: toPaper(GLASS, 0.45),
    glassLine: toPaper(GLASS, 0.05),
    steel: toPaper(STEEL, 0.35),
    soil: toPaper(SOIL, 0.45),
    pot: toPaper(TERRACOTTA, 0.45),
    charcoal: toPaper(INK, 0.35),
    tail: toPaper(TAIL_LIGHT, 0.35),
    screen: toPaper(INK, 0.12),
  });

  const paletteCache = new Map();
  /** Tones derived from an item colour, blended towards the paper so symbols read as a coloured drawing. */
  function palette(hex) {
    const cached = paletteCache.get(hex);
    if (cached) return cached;
    const base = parseHex(hex) || parseHex(NEUTRAL);
    const paper = (t) => cssRGB(mixRGB(base, PAPER_RGB, t));
    const p = Object.freeze({
      soft: paper(0.8),
      fill: paper(0.58),
      mid: paper(0.36),
      deep: cssRGB(mixRGB(base, INK_RGB, 0.25)),
      stone: cssRGB(mixRGB(mixRGB(base, parseHex(STONE), 0.6), PAPER_RGB, 0.42)),
    });
    if (paletteCache.size > 256) paletteCache.clear();
    paletteCache.set(hex, p);
    return p;
  }
  function pickColor() {
    for (let i = 0; i < arguments.length; i++) if (parseHex(arguments[i])) return arguments[i];
    return NEUTRAL;
  }

  // ================================================================== drawing primitives
  function roundRectPath(ctx, x0, y0, x1, y1, r) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const rr = Math.max(0, Math.min(r || 0, (bx - ax) / 2, (by - ay) / 2));
    ctx.beginPath();
    if (rr <= 0.01) {
      ctx.rect(ax, ay, bx - ax, by - ay);
      return;
    }
    ctx.moveTo(ax + rr, ay);
    ctx.lineTo(bx - rr, ay);
    ctx.arcTo(bx, ay, bx, ay + rr, rr);
    ctx.lineTo(bx, by - rr);
    ctx.arcTo(bx, by, bx - rr, by, rr);
    ctx.lineTo(ax + rr, by);
    ctx.arcTo(ax, by, ax, by - rr, rr);
    ctx.lineTo(ax, ay + rr);
    ctx.arcTo(ax, ay, ax + rr, ay, rr);
    ctx.closePath();
  }
  /** Fill and/or stroke the current path. style = { fill, stroke, lw, dash }. */
  function finish(ctx, st) {
    if (st.fill) {
      ctx.fillStyle = st.fill;
      ctx.fill();
    }
    if (st.lw > 0) {
      ctx.strokeStyle = st.stroke || INK;
      ctx.lineWidth = st.lw;
      ctx.setLineDash(st.dash || NO_DASH);
      ctx.stroke();
      if (st.dash) ctx.setLineDash(NO_DASH);
    }
  }

  /** A small drawing kit bound to one item: sizes, palette, line weights and shape helpers. */
  function createPen(ctx, w, d, o, c) {
    const px = o.px > 0 && isFinite(o.px) ? o.px : 1;
    const lwOut = LW_OUT * px * (o.hovered ? 1.35 : 1);
    const lwDet = LW_DET * px;
    const g = {
      ctx, w, d, hw: w / 2, hd: d / 2, px, c, lwOut, lwDet,
      O: (fill) => ({ fill, lw: lwOut }),
      D: (fill) => ({ fill, lw: lwDet }),
      F: (fill) => ({ fill, lw: 0 }),
      S: (stroke, k, dash) => ({ stroke, lw: (k || LW_DET) * px, dash }),
      dash: (on, off) => [on * px, (off == null ? on : off) * px],
      box(x0, y0, x1, y1, st, r) {
        roundRectPath(ctx, x0, y0, x1, y1, r);
        finish(ctx, st);
      },
      circle(cx, cy, r, st) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0, r), 0, TAU);
        finish(ctx, st);
      },
      ellipse(cx, cy, rx, ry, st) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, TAU);
        finish(ctx, st);
      },
      poly(pts, st, open) {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        if (!open) ctx.closePath();
        finish(ctx, open ? Object.assign({}, st, { fill: null }) : st);
      },
      line(x0, y0, x1, y1, st) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        finish(ctx, Object.assign({ lw: lwDet }, st, { fill: null }));
      },
      /** Run fn in a sub-frame (translated / rotated clockwise by rotDeg). */
      frame(cx, cy, rotDeg, fn) {
        ctx.save();
        ctx.translate(cx, cy);
        if (rotDeg) ctx.rotate((rotDeg * Math.PI) / 180);
        try {
          fn();
        } finally {
          ctx.restore();
        }
      },
      alpha(k, fn) {
        ctx.save();
        ctx.globalAlpha *= k;
        try {
          fn();
        } finally {
          ctx.restore();
        }
      },
    };
    return g;
  }

  // ================================================================== symbols — seating
  /** Evenly split [x0,x1] into seat cushions; returns the cushion pitch. */
  function seatCushions(g, x0, x1, y0, y1) {
    const n = clamp(Math.round((x1 - x0) / 620), 1, 6);
    const cw = (x1 - x0) / n;
    const gap = clamp(cw * 0.02, 6, 16);
    for (let i = 0; i < n; i++) g.box(x0 + i * cw + gap, y0 + gap, x0 + (i + 1) * cw - gap, y1 - gap * 1.5, g.D(g.c.soft), 45);
    return { n, cw };
  }

  function paintSofa(g) {
    const { hw, hd, w, d, c } = g;
    const arm = clamp(w * 0.08, 70, 200);
    const back = clamp(d * 0.22, 100, 240);
    const r = Math.min(80, arm * 0.6);
    g.box(-hw, -hd, hw, hd, g.F(c.fill), r);
    g.box(-hw + arm, -hd, hw - arm, -hd + back, g.D(c.mid), r * 0.5);
    const { n, cw } = seatCushions(g, -hw + arm, hw - arm, -hd + back, hd);
    for (let i = 1; i < n; i++) g.line(-hw + arm + i * cw, -hd + 20, -hw + arm + i * cw, -hd + back - 20);
    g.box(-hw, -hd, -hw + arm, hd, g.D(c.mid), r);
    g.box(hw - arm, -hd, hw, hd, g.D(c.mid), r);
    g.box(-hw, -hd, hw, hd, g.O(null), r);
  }

  /** Sofa with the seat along the back (full width) and a chaise on the RIGHT end (full depth). */
  function paintSofaL(g) {
    const { hw, hd, w, d, c } = g;
    const arm = clamp(w * 0.055, 70, 180);
    const back = clamp(d * 0.13, 100, 240);
    const seatD = clamp(d * 0.55, back + 150, Math.min(900, d));
    const chW = clamp(Math.min(900, w * 0.34), 200, Math.max(200, w - 2 * arm - 200));
    const outline = [[-hw, -hd], [hw, -hd], [hw, hd], [hw - chW, hd], [hw - chW, -hd + seatD], [-hw, -hd + seatD]];
    g.poly(outline, g.F(c.fill));
    g.box(-hw + arm, -hd, hw - arm, -hd + back, g.D(c.mid), 40);
    const { n, cw } = seatCushions(g, -hw + arm, hw - chW, -hd + back, -hd + seatD);
    for (let i = 1; i <= n; i++) g.line(-hw + arm + i * cw, -hd + 20, -hw + arm + i * cw, -hd + back - 20);
    const gap = 12;
    g.box(hw - chW + gap, -hd + back + gap, hw - arm - gap, hd - gap * 1.5, g.D(c.soft), 60);
    g.line(hw - chW + 60, -hd + seatD, hw - arm - 60, -hd + seatD, g.S(c.mid, LW_DET, g.dash(3, 2)));
    g.box(-hw, -hd, -hw + arm, -hd + seatD, g.D(c.mid), 50);
    g.box(hw - arm, -hd, hw, hd, g.D(c.mid), 50);
    g.poly(outline, g.O(null));
  }

  /** Chair in its own local frame (back at -cd/2). */
  function chairLocal(g, cw, cd) {
    const bt = clamp(cd * 0.14, 30, 80);
    const r = Math.min(60, cw * 0.15);
    g.box(-cw / 2, -cd / 2 + bt * 0.6, cw / 2, cd / 2, g.O(g.c.fill), r);
    g.box(-cw / 2 + cw * 0.05, -cd / 2, cw / 2 - cw * 0.05, -cd / 2 + bt, g.O(g.c.mid), bt / 2);
  }

  function paintChair(g) {
    chairLocal(g, g.w, g.d);
  }

  function paintOfficeChair(g) {
    const { hw, hd, w, d, c } = g;
    const R = Math.min(hw, hd) * 0.94;
    const castor = clamp(R * 0.09, 12, 30);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 5 + Math.PI / 5;
      const x = Math.cos(a) * (R - castor) * (hw / Math.min(hw, hd));
      const y = Math.sin(a) * (R - castor) * (hd / Math.min(hw, hd));
      g.line(0, 0, x, y, g.S(INK, 1.4));
      g.circle(x, y, castor, g.D(c.mid));
    }
    g.box(-w * 0.35, -d * 0.24, w * 0.35, d * 0.38, g.O(c.fill), Math.min(w, d) * 0.14);
    g.box(-w * 0.44, -d * 0.12, -w * 0.36, d * 0.2, g.D(c.mid), 12);
    g.box(w * 0.36, -d * 0.12, w * 0.44, d * 0.2, g.D(c.mid), 12);
    g.box(-w * 0.33, -hd + d * 0.03, w * 0.33, -hd + d * 0.2, g.O(c.mid), Math.min(w, d) * 0.08);
    g.circle(0, d * 0.06, Math.min(w, d) * 0.05, g.D(c.deep));
  }

  // ================================================================== symbols — tables
  function tableTop(g, x0, y0, x1, y1) {
    const inset = clamp(Math.min(x1 - x0, y1 - y0) * 0.04, 18, 45);
    g.box(x0, y0, x1, y1, g.O(g.c.fill), 25);
    g.box(x0 + inset, y0 + inset, x1 - inset, y1 - inset, g.D(null), 12);
  }

  function paintDiningRect(g, perSide, ends, twFrac, tdFrac) {
    const { w, d, hw, hd } = g;
    const tw = w * twFrac, td = d * tdFrac;
    const tuck = Math.min(150, td * 0.18);
    const sideD = Math.max(120, Math.min(540, (d - td) / 2 + tuck));
    const cw = clamp((tw / perSide) * 0.72, 180, 480);
    for (let i = 0; i < perSide; i++) {
      const cx = -tw / 2 + (i + 0.5) * (tw / perSide);
      g.frame(cx, -hd + sideD / 2, 0, () => chairLocal(g, cw, sideD));
      g.frame(cx, hd - sideD / 2, 180, () => chairLocal(g, cw, sideD));
    }
    if (ends) {
      const endD = Math.max(120, Math.min(540, (w - tw) / 2 + tuck));
      const ecw = clamp(td * 0.5, 180, 480);
      g.frame(-hw + endD / 2, 0, 270, () => chairLocal(g, ecw, endD));
      g.frame(hw - endD / 2, 0, 90, () => chairLocal(g, ecw, endD));
    }
    tableTop(g, -tw / 2, -td / 2, tw / 2, td / 2);
  }

  /** Round (elliptical when stretched) table with four chairs; optional umbrella for the garden set. */
  function paintRoundSet(g, frac, umbrella) {
    const { hw, hd, c } = g;
    const m = Math.min(hw, hd);
    const tuck = Math.min(120, m * frac * 0.2);
    const cd = Math.max(120, Math.min(540, m * (1 - frac) + tuck));
    const cw = clamp(m * frac * 0.75, 180, 480);
    g.frame(0, -hd + cd / 2, 0, () => chairLocal(g, cw, cd));
    g.frame(hw - cd / 2, 0, 90, () => chairLocal(g, cw, cd));
    g.frame(0, hd - cd / 2, 180, () => chairLocal(g, cw, cd));
    g.frame(-hw + cd / 2, 0, 270, () => chairLocal(g, cw, cd));
    g.ellipse(0, 0, hw * frac, hd * frac, g.O(c.fill));
    g.ellipse(0, 0, hw * frac - 30, hd * frac - 30, g.D(null));
    if (umbrella) paintUmbrella(g);
  }

  function paintUmbrella(g) {
    const rx = g.hw * 0.97, ry = g.hd * 0.97;
    g.alpha(0.3, () => g.ellipse(0, 0, rx, ry, g.F(g.c.mid)));
    g.ellipse(0, 0, rx, ry, g.S(INK, LW_DET, g.dash(5, 3)));
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      g.line(0, 0, Math.cos(a) * rx, Math.sin(a) * ry, g.S(INK, LW_DET * 0.8, g.dash(3, 3)));
    }
    g.circle(0, 0, Math.min(rx, ry) * 0.045, g.D(g.c.deep));
  }

  function paintCoffeeTable(g) {
    const { hw, hd, c } = g;
    tableTop(g, -hw, -hd, hw, hd);
    const r = Math.min(g.w, g.d) * 0.14;
    g.circle(hw * 0.45, 0, r, g.D(c.soft));
    g.box(-hw * 0.62, -hd * 0.42, -hw * 0.12, hd * 0.3, g.D(c.mid), 8);
  }

  function paintSideTable(g) {
    const { hw, hd, c } = g;
    if (Math.abs(hw - hd) / Math.max(hw, hd) < 0.12) {
      g.ellipse(0, 0, hw, hd, g.O(c.fill));
      g.ellipse(0, 0, hw * 0.82, hd * 0.82, g.D(null));
      g.circle(0, 0, Math.min(hw, hd) * 0.12, g.D(c.mid));
    } else {
      tableTop(g, -hw, -hd, hw, hd);
    }
  }

  function paintDesk(g) {
    const { hw, hd, w, d, c } = g;
    tableTop(g, -hw, -hd, hw, hd);
    if (w >= 700) {
      const mw = Math.min(600, w * 0.42);
      g.box(-mw / 2 - mw * 0.2, -hd + d * 0.28, mw / 2 - mw * 0.2, -hd + d * 0.28 + 20, g.D(c.mid), 4);
      g.box(-mw / 2, -hd + d * 0.1, mw / 2, -hd + d * 0.1 + Math.max(25, d * 0.06), g.D(TONE.screen), 6);
      g.box(-mw * 0.35, d * 0.02, mw * 0.35, d * 0.02 + d * 0.2, g.D(c.soft), 10);
    }
  }

  // ================================================================== symbols — storage
  /** Vertical module lines with small handles near the front (drawers / doors). */
  function frontModules(g, n, handles) {
    const { hw, hd, w, d } = g;
    const step = w / n;
    for (let i = 1; i < n; i++) g.line(-hw + i * step, -hd + d * 0.12, -hw + i * step, hd);
    if (!handles) return;
    for (let i = 0; i < n; i++) {
      const cx = -hw + (i + 0.5) * step;
      g.line(cx - step * 0.15, hd - d * 0.08, cx + step * 0.15, hd - d * 0.08, g.S(INK, 1.2));
    }
  }

  function paintCabinet(g, moduleW) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 10);
    g.line(-hw, -hd + d * 0.12, hw, -hd + d * 0.12);
    frontModules(g, Math.max(1, Math.round(w / moduleW)), true);
  }

  function paintSideboard(g) {
    paintCabinet(g, 450);
  }
  function paintDresser(g) {
    paintCabinet(g, 400);
  }

  function paintNightstand(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 12);
    g.line(-hw + 20, hd - d * 0.14, hw - 20, hd - d * 0.14);
    g.line(-w * 0.15, hd - d * 0.07, w * 0.15, hd - d * 0.07, g.S(INK, 1.2));
    const r = Math.min(w, d) * 0.26;
    g.circle(0, -d * 0.08, r, g.D(c.soft));
    g.line(-r * 0.7, -d * 0.08 - r * 0.7, r * 0.7, -d * 0.08 + r * 0.7);
    g.line(-r * 0.7, -d * 0.08 + r * 0.7, r * 0.7, -d * 0.08 - r * 0.7);
  }

  function paintWardrobe(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 8);
    // clothes on hangers + rod (dashed: above the section plane)
    const rodY = -d * 0.06;
    const hang = d * 0.3;
    const step = clamp(w / 22, 60, 130);
    for (let x = -hw + 90; x <= hw - 90; x += step) {
      g.line(x - hang * 0.12, rodY - hang, x + hang * 0.12, rodY + hang, g.S(c.deep, LW_DET * 0.9));
    }
    g.line(-hw + 50, rodY, hw - 50, rodY, g.S(INK, LW_DET * 1.2, g.dash(6, 3)));
    // sliding doors on two tracks
    const t = clamp(d * 0.045, 16, 32);
    const leaves = Math.max(2, Math.round(w / 900));
    const lw = w / leaves;
    for (let i = 0; i < leaves; i++) {
      const outer = i % 2 === 0;
      const y1 = hd - (outer ? t * 0.4 : t * 1.8);
      const x0 = -hw + i * lw - (outer ? 0 : 40);
      const x1 = -hw + (i + 1) * lw + (outer ? 0 : 40);
      g.box(Math.max(-hw, x0), y1 - t, Math.min(hw, x1), y1, g.D(c.mid));
    }
    g.box(-hw, -hd, hw, hd, g.O(null), 8);
  }

  function paintClosetIsland(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 12);
    const inset = clamp(Math.min(w, d) * 0.12, 30, 90);
    g.box(-hw + inset, -hd + inset, hw - inset, hd - inset, g.D(TONE.glass), 8);
    const n = Math.max(1, Math.round(w / 400));
    for (let i = 1; i < n; i++) {
      const x = -hw + (i * w) / n;
      g.line(x, -hd, x, -hd + inset);
      g.line(x, hd - inset, x, hd);
    }
  }

  function paintBookshelf(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 6);
    const n = Math.max(1, Math.round(w / 420));
    const step = w / n;
    for (let i = 0; i < n; i++) {
      const x0 = -hw + i * step + 20, x1 = -hw + (i + 1) * step - 20;
      let x = x0;
      let k = 0;
      while (x < x1 - 40) {
        const bw = Math.min(x1 - x, 30 + ((i * 7 + k * 13) % 5) * 9);
        g.box(x, -hd + d * 0.12, x + bw, hd - d * 0.18 - ((k * 11) % 3) * d * 0.06, g.D(k % 3 ? c.soft : c.mid));
        x += bw + 6;
        k++;
      }
      if (i > 0) g.line(-hw + i * step, -hd, -hw + i * step, hd, g.S(INK, LW_DET * 1.4));
    }
    g.box(-hw, -hd, hw, hd, g.O(null), 6);
  }

  function paintTvUnit(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 10);
    frontModules(g, Math.max(1, Math.round(w / 600)), true);
    const sw = Math.min(w * 0.82, 1450);
    const th = clamp(d * 0.12, 25, 60);
    const ty = -hd + d * 0.3;
    g.box(-sw * 0.16, ty - 35, sw * 0.16, ty + th + 70, g.D(c.mid), 12);
    g.box(-sw / 2, ty, sw / 2, ty + th, g.O(TONE.screen), 6);
    g.line(-sw / 2 + 15, ty + th + 6, sw / 2 - 15, ty + th + 6, g.S(TONE.glassLine, 1.2));
  }

  function paintFloorLamp(g) {
    const { hw, hd, c } = g;
    g.ellipse(0, 0, hw * 0.98, hd * 0.98, g.O(c.soft));
    g.ellipse(0, 0, hw * 0.55, hd * 0.55, g.D(c.fill));
    const k = Math.SQRT1_2;
    g.line(-hw * 0.98 * k, -hd * 0.98 * k, hw * 0.98 * k, hd * 0.98 * k);
    g.line(-hw * 0.98 * k, hd * 0.98 * k, hw * 0.98 * k, -hd * 0.98 * k);
    g.circle(0, 0, Math.min(hw, hd) * 0.12, g.D(c.deep));
  }

  // ================================================================== symbols — beds
  function paintBed(g) {
    const { hw, hd, w, d, c } = g;
    const hb = clamp(d * 0.05, 50, 110);
    const inset = clamp(w * 0.02, 12, 30);
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 30);
    g.box(-hw, -hd, hw, -hd + hb, g.D(c.deep), 20);
    const mx0 = -hw + inset, mx1 = hw - inset, my0 = -hd + hb + 10, my1 = hd - inset;
    g.box(mx0, my0, mx1, my1, g.D(c.soft), 40);
    // pillows
    const n = w >= 1150 ? 2 : 1;
    const pd = clamp(d * 0.14, 150, 330);
    const pg = clamp(w * 0.03, 20, 50);
    const pw = (mx1 - mx0 - (n + 1) * pg) / n;
    for (let i = 0; i < n; i++) {
      const x0 = mx0 + pg + i * (pw + pg);
      g.box(x0, my0 + 45, x0 + pw, my0 + 45 + pd, g.D(PAPER), Math.min(80, pd * 0.35));
      g.line(x0 + pw * 0.12, my0 + 45 + pd / 2, x0 + pw * 0.88, my0 + 45 + pd / 2, g.S(c.mid, LW_DET * 0.8));
    }
    // duvet with turned-down sheet and a folded corner
    const dy0 = Math.min(my1 - 100, my0 + 45 + pd + 80);
    const band = clamp(d * 0.07, 60, 160);
    g.box(mx0, dy0, mx1, my1, g.D(c.mid), 30);
    g.box(mx0, dy0, mx1, Math.min(my1, dy0 + band), g.D(c.soft), 20);
    const f = Math.min((mx1 - mx0) * 0.3, (my1 - dy0 - band) * 0.45);
    if (f > 40) {
      const fy = dy0 + band;
      g.poly([[mx1 - f, fy], [mx1, fy], [mx1, fy + f]], g.D(c.soft));
      g.line(mx1 - f, fy, mx1, fy + f, g.S(INK, LW_DET));
    }
    g.box(-hw, -hd, hw, hd, g.O(null), 30);
  }

  // ================================================================== symbols — kitchen & service
  function paintCounterTop(g) {
    const { hw, hd, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.stone), 6);
    g.line(-hw, -hd + clamp(d * 0.03, 10, 20), hw, -hd + clamp(d * 0.03, 10, 20), g.S(INK, LW_DET * 0.8));
    g.line(-hw, hd - clamp(d * 0.04, 12, 28), hw, hd - clamp(d * 0.04, 12, 28), g.S(c.fill, LW_DET * 1.6));
  }

  function paintCounter(g) {
    paintCounterTop(g);
  }

  function paintKitchenSink(g) {
    const { hw, hd, w, d, c } = g;
    paintCounterTop(g);
    const bw = clamp(w * 0.34, 300, 800);
    const bd = clamp(d * 0.62, 250, 460);
    const cy = d * 0.04;
    // drainer grooves on the left of the bowl
    const dr = Math.min(460, hw - bw / 2 - 80);
    if (dr > 150) {
      const x1 = -bw / 2 - 50, x0 = x1 - dr;
      g.box(x0, cy - bd / 2, x1, cy + bd / 2, g.D(TONE.steel), 20);
      for (let y = cy - bd / 2 + 45; y < cy + bd / 2 - 30; y += 45) g.line(x0 + 30, y, x1 - 25, y, g.S(INK, LW_DET * 0.8));
    }
    g.box(-bw / 2, cy - bd / 2, bw / 2, cy + bd / 2, g.D(TONE.steel), 45);
    g.box(-bw / 2 + 22, cy - bd / 2 + 22, bw / 2 - 22, cy + bd / 2 - 22, g.D(null), 35);
    g.circle(0, cy + bd * 0.12, Math.min(bw, bd) * 0.06, g.D(c.stone));
    // tap
    const ty = cy - bd / 2 - 40;
    g.circle(0, ty, 22, g.D(TONE.steel));
    g.line(0, ty, 0, cy - bd / 2 + 70, g.S(INK, 2));
    g.line(22, ty, 60, ty - 12, g.S(INK, 1.4));
  }

  function paintStove(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 12);
    const top = -hd + d * 0.04, bot = hd - d * 0.14;
    g.box(-hw + w * 0.04, top, hw - w * 0.04, bot, g.D(TONE.charcoal), 10);
    const m = Math.min(w, bot - top);
    const burner = (x, y, r) => {
      g.circle(x, y, r, g.D(c.mid));
      g.circle(x, y, r * 0.55, g.D(TONE.charcoal));
      g.line(x - r, y, x + r, y, g.S(INK, LW_DET * 0.8));
      g.line(x, y - r, x, y + r, g.S(INK, LW_DET * 0.8));
    };
    const cy = (top + bot) / 2;
    const dx = w * 0.27, dy = (bot - top) * 0.26;
    [[-dx, cy - dy], [dx, cy - dy], [-dx, cy + dy], [dx, cy + dy]].forEach(([x, y]) => burner(x, y, m * 0.11));
    burner(0, cy, m * 0.14);
    for (let i = 0; i < 5; i++) g.circle(-hw + ((i + 0.5) * w) / 5, hd - d * 0.07, Math.min(22, w * 0.03), g.D(c.deep));
  }

  function paintFridge(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 18);
    const t = clamp(d * 0.07, 30, 60);
    g.box(-hw, hd - t, hw, hd, g.D(c.mid), 8);
    g.line(0, hd - t, 0, hd);
    g.line(-w * 0.08, hd - t - 25, -w * 0.08, hd - t - 5, g.S(INK, 1.6));
    g.line(w * 0.08, hd - t - 25, w * 0.08, hd - t - 5, g.S(INK, 1.6));
    g.line(-hw + 40, -hd + 40, hw - 40, hd - t - 40, g.S(c.mid, LW_DET));
    g.line(-hw + 40, hd - t - 40, hw - 40, -hd + 40, g.S(c.mid, LW_DET));
  }

  /** Elevated element: dashed outline + diagonal cross (drafting convention for items above the cut). */
  function paintUpperCabinet(g) {
    const { hw, hd, w, c } = g;
    const dash = g.dash(5, 3);
    g.alpha(0.55, () => g.box(-hw, -hd, hw, hd, g.F(c.fill)));
    g.box(-hw, -hd, hw, hd, g.S(INK, LW_OUT, dash));
    g.line(-hw, -hd, hw, hd, g.S(INK, LW_DET, dash));
    g.line(-hw, hd, hw, -hd, g.S(INK, LW_DET, dash));
    const n = Math.max(1, Math.round(w / 500));
    for (let i = 1; i < n; i++) g.line(-hw + (i * w) / n, -hd, -hw + (i * w) / n, hd, g.S(INK, LW_DET, dash));
  }

  function paintIsland(g) {
    const { hw, hd, d } = g;
    paintCounterTop(g);
    const ov = Math.min(300, d * 0.3);
    g.line(-hw, hd - ov, hw, hd - ov, g.S(INK, LW_DET, g.dash(5, 3)));
  }

  function paintWasher(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 18);
    const panel = -hd + d * 0.16;
    g.line(-hw, panel, hw, panel);
    g.circle(hw - w * 0.18, (-hd + panel) / 2, Math.min(w, d) * 0.045, g.D(c.mid));
    g.box(-hw + w * 0.1, -hd + d * 0.04, -hw + w * 0.45, panel - d * 0.04, g.D(TONE.screen), 6);
    const r = Math.min(w, d - d * 0.16) * 0.36;
    const cy = (panel + hd) / 2;
    g.circle(0, cy, r, g.D(TONE.steel));
    g.circle(0, cy, r * 0.68, g.D(TONE.glass));
  }

  function paintShelves(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.soft), 4);
    const p = clamp(Math.min(w, d) * 0.08, 20, 40);
    g.line(-hw + p, -hd + p, hw - p, hd - p, g.S(c.deep, LW_DET, g.dash(4, 3)));
    g.line(-hw + p, hd - p, hw - p, -hd + p, g.S(c.deep, LW_DET, g.dash(4, 3)));
    [[-hw, -hd], [hw - p, -hd], [-hw, hd - p], [hw - p, hd - p]].forEach(([x, y]) => g.box(x, y, x + p, y + p, g.D(c.deep)));
    const boxes = Math.max(1, Math.round(w / 320));
    const bw = (w - 2 * p) / boxes;
    for (let i = 0; i < boxes; i++) {
      const x0 = -hw + p + i * bw + 20;
      g.box(x0, -hd + p + 20, x0 + bw - 40, hd - p - 20 - (i % 2) * d * 0.12, g.D(c.fill), 6);
    }
  }

  // ================================================================== symbols — bathroom
  function paintToilet(g) {
    const { hw, hd, w, d, c } = g;
    const tankD = clamp(d * 0.28, 110, 220);
    const bowlCY = -hd + tankD + (d - tankD) * 0.48;
    const rx = hw * 0.92, ry = (d - tankD) * 0.5;
    g.ellipse(0, bowlCY, rx, ry, g.O(c.fill));
    g.ellipse(0, bowlCY + ry * 0.1, rx * 0.66, ry * 0.7, g.D(c.soft));
    g.ellipse(0, bowlCY + ry * 0.18, rx * 0.35, ry * 0.38, g.D(TONE.glass));
    g.box(-hw, -hd, hw, -hd + tankD, g.O(c.fill), 25);
    g.circle(0, -hd + tankD / 2, Math.min(w, tankD) * 0.12, g.D(c.mid));
  }

  function paintBasin(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 12);
    g.line(-hw, hd - d * 0.07, hw, hd - d * 0.07, g.S(c.mid, LW_DET));
    const rx = Math.min(hw * 0.62, 270), ry = Math.min(hd * 0.58, 190);
    const cy = d * 0.04;
    g.ellipse(0, cy, rx, ry, g.D(c.soft));
    g.ellipse(0, cy + ry * 0.05, rx * 0.8, ry * 0.76, g.D(TONE.glass));
    g.circle(0, cy + ry * 0.12, Math.min(rx, ry) * 0.08, g.D(c.mid));
    const ty = cy - ry - Math.min(40, (hd - ry) * 0.6);
    g.circle(0, ty, 18, g.D(TONE.steel));
    g.line(0, ty, 0, cy - ry + 45, g.S(INK, 1.8));
  }

  function paintShower(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.soft), 6);
    const m = Math.min(w, d);
    const inset = clamp(m * 0.03, 15, 30);
    g.box(-hw + inset, -hd + inset, hw - inset, hd - inset * 2.5, g.D(c.fill), 10);
    [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]].forEach(([x, y]) => g.line(x * 0.94, y * 0.94, 0, 0, g.S(c.deep, LW_DET * 0.7)));
    const dr = clamp(m * 0.05, 25, 55);
    g.circle(0, 0, dr, g.D(TONE.steel));
    g.line(-dr * 0.6, 0, dr * 0.6, 0, g.S(INK, LW_DET * 0.8));
    // glass on the front edge: fixed pane + sliding leaf
    const gy = hd - inset * 0.8;
    g.line(-hw, gy, hw * 0.1, gy, g.S(TONE.glassLine, 2.2));
    g.line(-hw * 0.1, gy - inset * 1.3, hw, gy - inset * 1.3, g.S(TONE.glassLine, 2.2));
    // shower head on the back wall
    const hr = clamp(m * 0.08, 40, 100);
    g.line(0, -hd, 0, -hd + hr * 1.4, g.S(INK, 1.4));
    g.circle(0, -hd + hr * 1.6, hr, g.D(TONE.steel));
    g.circle(0, -hd + hr * 1.6, hr * 0.55, g.D(null));
  }

  function paintBathtub(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 30);
    const t = clamp(Math.min(w, d) * 0.09, 45, 90);
    g.box(-hw + t, -hd + t, hw - t, hd - t, g.D(c.soft), Math.min((d - 2 * t) / 2, 220));
    g.circle(-hw + t + 90, 0, 26, g.D(TONE.steel));
    g.circle(-hw + t / 2, 0, Math.min(18, t * 0.35), g.D(TONE.steel));
    g.line(-hw + t / 2, 0, -hw + t + 40, 0, g.S(INK, 1.4));
  }

  // ================================================================== symbols — outdoor & garage
  function paintCar(g) {
    const { hw, hd, w, d, c } = g;
    const bw = w * 0.9, hb = bw / 2;
    const axleF = hd - d * 0.18, axleR = -hd + d * 0.19;
    const wl = clamp(d * 0.15, 200, 720), ww = clamp(w * 0.12, 70, 240);
    [axleF, axleR].forEach((ay) =>
      [-1, 1].forEach((s) => g.box(s * hb - (s > 0 ? ww * 0.6 : ww * 0.4), ay - wl / 2, s * hb + (s > 0 ? ww * 0.4 : ww * 0.6), ay + wl / 2, g.D(TONE.charcoal), 30))
    );
    g.box(-hb, -hd, hb, hd, g.O(c.fill), Math.min(bw * 0.24, d * 0.07));
    const yWs = hd - d * 0.27, yRf = hd - d * 0.39, yRr = -hd + d * 0.22, yRw = -hd + d * 0.11;
    g.line(-bw * 0.3, hd - d * 0.04, -bw * 0.33, yWs, g.S(c.deep, LW_DET));
    g.line(bw * 0.3, hd - d * 0.04, bw * 0.33, yWs, g.S(c.deep, LW_DET));
    // glasshouse: windscreen, side windows, rear window, roof
    g.poly([[-bw * 0.42, yWs], [bw * 0.42, yWs], [bw * 0.36, yRf], [-bw * 0.36, yRf]], g.D(TONE.glass));
    g.poly([[-bw * 0.43, yWs - 40], [-bw * 0.37, yRf], [-bw * 0.37, yRr], [-bw * 0.43, yRw + 40]], g.D(TONE.glass));
    g.poly([[bw * 0.43, yWs - 40], [bw * 0.37, yRf], [bw * 0.37, yRr], [bw * 0.43, yRw + 40]], g.D(TONE.glass));
    g.poly([[-bw * 0.36, yRr], [bw * 0.36, yRr], [bw * 0.4, yRw], [-bw * 0.4, yRw]], g.D(TONE.glass));
    g.box(-bw * 0.36, yRf, bw * 0.36, yRr, g.D(c.mid), 50);
    g.line(-bw * 0.3, (yRf + yRr) / 2, bw * 0.3, (yRf + yRr) / 2, g.S(c.deep, LW_DET * 0.8, g.dash(4, 3)));
    // mirrors (inside the footprint: body is 90 % of w)
    [-1, 1].forEach((s) =>
      g.poly([[s * (hb - 10), yWs - 30], [s * (hw - 4), yWs - 70], [s * (hw - 4), yWs - 150], [s * (hb - 10), yWs - 140]], g.O(c.mid))
    );
    // lights
    [-1, 1].forEach((s) => {
      g.box(s * hb - s * bw * 0.22, hd - 80, s * hb - s * 45, hd - 25, g.D(PAPER), 20);
      g.box(s * hb - s * bw * 0.2, -hd + 25, s * hb - s * 45, -hd + 75, g.D(TONE.tail), 15);
    });
  }

  function paintBbq(g) {
    const { hw, hd, w, d, c } = g;
    const t = clamp(Math.min(w, d) * 0.14, 60, 140);
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 6);
    // brick joints on the U-shaped walls
    for (let y = -hd + 60; y < hd - 20; y += 65) {
      g.line(-hw + 6, y, -hw + t - 6, y, g.S(c.deep, LW_DET * 0.6));
      g.line(hw - t + 6, y, hw - 6, y, g.S(c.deep, LW_DET * 0.6));
    }
    for (let x = -hw + t + 60; x < hw - t; x += 110) g.line(x, -hd + 6, x, -hd + t - 6, g.S(c.deep, LW_DET * 0.6));
    const fx0 = -hw + t, fx1 = hw - t, fy0 = -hd + t, fy1 = hd - t * 0.6;
    g.box(fx0, fy0, fx1, fy1, g.D(TONE.charcoal), 4);
    for (let x = fx0 + 35; x < fx1 - 10; x += 35) g.line(x, fy0 + 15, x, fy1 - 15, g.S(TONE.steel, LW_DET * 1.1));
    g.line(fx0 + 10, (fy0 + fy1) / 2, fx1 - 10, (fy0 + fy1) / 2, g.S(TONE.steel, LW_DET * 1.4));
    // hood and chimney (above the cut: dashed)
    const dash = g.dash(5, 3);
    g.box(-hw + t * 0.5, -hd + t * 0.5, hw - t * 0.5, hd - t * 0.3, g.S(INK, LW_DET, dash));
    const cw = Math.min(w * 0.42, 420);
    g.box(-cw / 2, -hd, cw / 2, -hd + Math.min(d * 0.5, cw), g.S(INK, LW_OUT, dash));
    g.line(-cw / 2, -hd, cw / 2, -hd + Math.min(d * 0.5, cw), g.S(INK, LW_DET, dash));
    g.box(-hw, -hd, hw, hd, g.O(null), 6);
  }

  function paintLounger(g) {
    const { hw, hd, w, d, c } = g;
    g.box(-hw, -hd, hw, hd, g.O(c.fill), 40);
    const backEnd = -hd + d * 0.34;
    g.box(-hw + 25, -hd + 25, hw - 25, backEnd, g.D(c.mid), 30);
    for (let y = -hd + 80; y < backEnd - 20; y += 70) g.line(-hw + 45, y, hw - 45, y, g.S(c.deep, LW_DET * 0.7));
    g.box(-w * 0.3, -hd + 45, w * 0.3, -hd + 45 + clamp(d * 0.09, 80, 200), g.D(c.soft), 40);
    for (let y = backEnd + 60; y < hd - 30; y += 85) g.line(-hw + 35, y, hw - 35, y, g.S(c.deep, LW_DET * 0.7));
    g.line(-hw, backEnd, hw, backEnd, g.S(INK, LW_DET * 1.2));
  }

  function paintPlanter(g) {
    const { hw, hd, w, d, c } = g;
    const t = clamp(Math.min(w, d) * 0.1, 25, 60);
    g.box(-hw, -hd, hw, hd, g.O(TONE.pot), 8);
    g.box(-hw + t, -hd + t, hw - t, hd - t, g.D(TONE.soil), 4);
    const long = w >= d;
    const L = long ? w - 2 * t : d - 2 * t, S = long ? d - 2 * t : w - 2 * t;
    const n = Math.max(1, Math.round(L / Math.max(S * 1.1, 200)));
    const step = L / n;
    for (let i = 0; i < n; i++) {
      const a = -L / 2 + (i + 0.5) * step;
      const r = Math.min(step, S) * 0.62;
      rosette(g, long ? a : 0, long ? 0 : a, r, r, 7, i);
    }
  }

  function paintBike(g) {
    const { hw, hd, w, d, c } = g;
    const wl = clamp(d * 0.37, 250, 720);
    const tw = clamp(w * 0.07, 22, 50);
    g.box(-tw / 2, hd - wl, tw / 2, hd, g.O(TONE.charcoal), tw / 2);
    g.box(-tw / 2, -hd, tw / 2, -hd + wl, g.O(TONE.charcoal), tw / 2);
    g.line(0, hd - wl / 2, 0, -hd + wl / 2, g.S(c.deep, 3));
    const bars = hd - d * 0.22;
    g.line(0, bars + 60, 0, bars, g.S(c.deep, 2.4));
    g.line(-hw * 0.88, bars, hw * 0.88, bars, g.S(INK, 2));
    const grip = Math.min(90, hw * 0.3);
    [-1, 1].forEach((s) => g.box(s * hw * 0.88, bars - 18, s * (hw * 0.88 - grip), bars + 18, g.D(TONE.charcoal), 8));
    const by = -d * 0.04;
    g.line(-w * 0.26, by, w * 0.26, by, g.S(INK, 1.6));
    [-1, 1].forEach((s) => g.box(s * w * 0.26 - 30, by - 20, s * w * 0.26 + 30, by + 20, g.D(c.mid), 4));
    g.circle(0, by, Math.min(w, d) * 0.08, g.D(c.fill));
    g.ellipse(0, -d * 0.16, Math.max(40, w * 0.1), Math.max(60, d * 0.06), g.O(TONE.charcoal));
  }

  // ================================================================== symbols — decor
  /** Leaf rosette centred at (cx,cy) with radii rx/ry; alternating leaf lengths and two tones. */
  function rosette(g, cx, cy, rx, ry, n, seed) {
    const { ctx, c } = g;
    const phase = ((seed || 0) * 0.7) % TAU;
    for (let i = 0; i < n; i++) {
      const a = phase + (i * TAU) / n;
      const len = i % 2 ? 0.78 : 1;
      const ux = Math.cos(a), uy = Math.sin(a);
      const tip = [cx + ux * rx * len, cy + uy * ry * len];
      const wv = 0.3 * len;
      const c1 = [cx + (ux * 0.5 - uy * wv) * rx, cy + (uy * 0.5 + ux * wv) * ry];
      const c2 = [cx + (ux * 0.5 + uy * wv) * rx, cy + (uy * 0.5 - ux * wv) * ry];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(c1[0], c1[1], tip[0], tip[1]);
      ctx.quadraticCurveTo(c2[0], c2[1], cx, cy);
      ctx.closePath();
      finish(ctx, g.D(i % 2 ? c.mid : c.fill));
      g.line(cx, cy, cx + (tip[0] - cx) * 0.85, cy + (tip[1] - cy) * 0.85, g.S(c.deep, LW_DET * 0.6));
    }
  }

  function paintPlant(g) {
    const { hw, hd, c } = g;
    g.ellipse(0, 0, hw * 0.58, hd * 0.58, g.O(TONE.pot));
    g.ellipse(0, 0, hw * 0.5, hd * 0.5, g.D(TONE.soil));
    rosette(g, 0, 0, hw * 0.98, hd * 0.98, 9, 0);
    rosette(g, 0, 0, hw * 0.55, hd * 0.55, 5, 3);
    g.circle(0, 0, Math.min(hw, hd) * 0.08, g.D(c.deep));
  }

  function paintRug(g) {
    const { hw, hd, w, d, c } = g;
    const along = w >= d; // fringe on the two short edges
    const fr = clamp(Math.min(w, d) * 0.04, 20, 70);
    const bx = along ? hw - fr : hw, by = along ? hd : hd - fr;
    const step = clamp(Math.min(w, d) / 40, 18, 45);
    if (along) for (let y = -by + step / 2; y < by; y += step) [-1, 1].forEach((s) => g.line(s * bx, y, s * hw, y, g.S(c.deep, LW_DET * 0.7)));
    else for (let x = -bx + step / 2; x < bx; x += step) [-1, 1].forEach((s) => g.line(x, s * by, x, s * hd, g.S(c.deep, LW_DET * 0.7)));
    g.box(-bx, -by, bx, by, g.O(c.fill), 4);
    const b = clamp(Math.min(w, d) * 0.07, 40, 160);
    g.box(-bx + b, -by + b, bx - b, by - b, g.D(c.soft), 2);
    g.box(-bx + b * 1.6, -by + b * 1.6, bx - b * 1.6, by - b * 1.6, g.S(c.mid, LW_DET, g.dash(4, 3)));
  }

  function paintFallback(g, name) {
    const { hw, hd, w, d, ctx } = g;
    const r = Math.min(w, d) * 0.08;
    g.box(-hw, -hd, hw, hd, g.O(palette(NEUTRAL).fill), r);
    g.line(-hw, -hd, hw, hd);
    g.line(-hw, hd, hw, -hd);
    const size = clamp(Math.min(w, d) * 0.16, 40, 400);
    if (name && Math.min(w, d) > size * 1.5) {
      ctx.font = '600 ' + size + 'px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText ? ctx.measureText(name).width : 0;
      g.box(-tw / 2 - size * 0.3, -size * 0.7, tw / 2 + size * 0.3, size * 0.7, g.F(PAPER), size * 0.2);
      ctx.fillStyle = INK;
      ctx.fillText(name, 0, 0);
    }
  }

  const PAINTERS = Object.freeze({
    sofa3: paintSofa,
    sofa2: paintSofa,
    sofaL: paintSofaL,
    armchair: paintSofa,
    coffeeTable: paintCoffeeTable,
    sideTable: paintSideTable,
    tvUnit: paintTvUnit,
    bookshelf: paintBookshelf,
    floorLamp: paintFloorLamp,
    dining4: (g) => paintDiningRect(g, 2, false, 1, 0.5),
    dining6: (g) => paintDiningRect(g, 3, false, 1, 0.53),
    dining8: (g) => paintDiningRect(g, 3, true, 0.81, 0.53),
    roundTable: (g) => paintRoundSet(g, 0.73, false),
    chair: paintChair,
    sideboard: paintSideboard,
    bedQueen: paintBed,
    bedDouble: paintBed,
    bedSingle: paintBed,
    nightstand: paintNightstand,
    wardrobe: paintWardrobe,
    dresser: paintDresser,
    desk: paintDesk,
    officeChair: paintOfficeChair,
    closetIsland: paintClosetIsland,
    kitchenSink: paintKitchenSink,
    counter: paintCounter,
    stove: paintStove,
    fridge: paintFridge,
    upperCabinet: paintUpperCabinet,
    island: paintIsland,
    washer: paintWasher,
    shelves: paintShelves,
    toilet: paintToilet,
    basin: paintBasin,
    shower: paintShower,
    bathtub: paintBathtub,
    car: paintCar,
    bbq: paintBbq,
    outdoorTable: (g) => paintRoundSet(g, 0.55, true),
    lounger: paintLounger,
    outdoorSofa: paintSofa,
    planter: paintPlanter,
    bike: paintBike,
    rug: paintRug,
    plant: paintPlant,
  });

  // ================================================================== public drawing API
  const warned = new Set();
  function warnOnce(type, err) {
    if (warned.has(type)) return;
    warned.add(type);
    console.warn('[catalog] símbolo 2D falhou para "' + type + '"', err);
  }
  const positive = (v, fallback) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : fallback);

  /**
   * Draw the top-view symbol of `item` in its local frame (ctx already translated/rotated, units = mm).
   * o = { px: mm per screen pixel, selected, hovered, ghost, color }. Never throws.
   */
  function draw2d(ctx, item, o) {
    if (!ctx || !item) return;
    const opts = o || {};
    const type = TYPES[item.type] || null;
    const w = positive(item.w, type ? type.w : 600);
    const d = positive(item.d, type ? type.d : 600);
    const c = palette(pickColor(opts.color, item.color, type && type.color));
    const name = type ? type.name : String(item.type || '?');
    const paint = (fn) => {
      ctx.save();
      try {
        if (opts.ghost) ctx.globalAlpha *= GHOST_ALPHA;
        fn(createPen(ctx, w, d, opts, c));
      } finally {
        ctx.restore();
      }
    };
    const painter = type ? PAINTERS[item.type] : null;
    try {
      paint(painter || ((g) => paintFallback(g, name)));
    } catch (err) {
      warnOnce(item.type, err);
      try {
        paint((g) => paintFallback(g, name));
      } catch (err2) {
        /* the canvas itself is unusable — nothing sensible left to draw */
      }
    }
  }

  const thumbCache = new Map();
  /** dataURL (PNG) of the symbol centred on a transparent px×px canvas (DPR 2). '' when no DOM is available. */
  function thumbnail(typeId, px) {
    const size = Math.round(positive(px, 72));
    const key = typeId + '@' + size;
    if (thumbCache.has(key)) return thumbCache.get(key);
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') return '';
    try {
      const type = TYPES[typeId];
      const w = type ? type.w : 600, d = type ? type.d : 600;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size * THUMB_DPR;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return '';
      const s = (size * THUMB_DPR * THUMB_FILL) / Math.max(w, d);
      ctx.setTransform(s, 0, 0, s, (size * THUMB_DPR) / 2, (size * THUMB_DPR) / 2);
      draw2d(ctx, { type: typeId, w, d, h: type ? type.h : 600, color: null }, { px: THUMB_DPR / s });
      const url = canvas.toDataURL('image/png');
      thumbCache.set(key, url);
      return url;
    } catch (err) {
      warnOnce('thumb:' + typeId, err);
      return '';
    }
  }

  // ================================================================== default layout
  // Positions are item centres in world mm; rot follows CONTRACT §1 (back to top wall 0, right 90, bottom 180,
  // left 270). Each row: [type, x, y, rot, overrides?]. Verified by tools/test-layout.js (rooms, walls, stairs,
  // door swings, circulation, overlaps).
  const LAYOUT = Object.freeze({
    f0: [
      // Cozinha — galley: counters on the left wall (sink under the window), fridge + counter on the right wall
      ['counter', 1950, 3400, 270, { w: 800 }],
      ['upperCabinet', 1825, 3400, 270, { w: 800 }],
      ['kitchenSink', 1950, 4950, 270, { w: 2300 }],
      ['stove', 1950, 6480, 270, { d: 600 }],
      ['upperCabinet', 1825, 6480, 270, { w: 760 }],
      ['fridge', 3775, 5000, 90],
      ['counter', 3850, 5860, 90],
      ['upperCabinet', 3975, 5860, 90, { w: 1000 }],
      ['dining4', 2425, 7550, 90, { d: 1550 }],
      // Despensa
      ['shelves', 4850, 3200, 0, { w: 1100 }],
      ['shelves', 5200, 3900, 90],
      // Suíte (banheiro)
      ['shower', 5950, 3400, 0, { w: 800, d: 800 }],
      ['toilet', 6850, 3325, 0],
      ['basin', 5780, 4230, 270, { w: 700 }],
      // Quarto
      ['bedDouble', 5825, 5725, 0],
      ['nightstand', 4890, 4950, 0],
      ['nightstand', 6760, 4950, 0],
      ['rug', 5825, 6500, 0, { w: 1800, d: 1300 }],
      ['wardrobe', 4600, 7550, 270],
      ['desk', 5650, 8300, 180],
      ['officeChair', 5650, 7760, 0],
      // Lavabo
      ['basin', 1880, 9150, 270, { w: 700 }],
      ['toilet', 2500, 10025, 180],
      // Sala de estar
      ['rug', 7200, 12000, 90, { w: 2600, d: 1800 }],
      ['tvUnit', 4525, 11900, 270],
      ['sofaL', 8025, 12200, 90],
      ['coffeeTable', 6880, 11900, 90],
      ['floorLamp', 8625, 10600, 0],
      ['armchair', 8440, 14250, 90],
      ['sideTable', 7775, 14450, 0],
      ['bookshelf', 4475, 13650, 270],
      ['plant', 4600, 14560, 0],
      // Garagem
      ['car', 2150, 12870, 0],
      ['shelves', 3950, 11950, 90],
      ['bike', 450, 11700, 0],
    ],
    f1: [
      // Closets
      ['wardrobe', 2275, 3300, 0, { w: 1250 }],
      ['wardrobe', 3525, 3300, 0, { w: 1250 }],
      ['wardrobe', 5060, 3300, 0, { w: 1520 }],
      ['wardrobe', 6590, 3300, 0, { w: 1520 }],
      ['rug', 5900, 4100, 0, { w: 1400, d: 700 }],
      // Quarto Master
      ['rug', 5050, 6740, 90, { w: 2400, d: 1600 }],
      ['bedQueen', 4200, 6740, 270],
      ['nightstand', 3340, 5760, 270, { w: 350, d: 380 }],
      ['nightstand', 3340, 7720, 270, { w: 350, d: 380 }],
      ['tvUnit', 7125, 7700, 90, { w: 1600 }],
      ['armchair', 6940, 5450, 90],
      ['sideTable', 7125, 6150, 0],
      // Suíte (banheiro)
      ['basin', 1880, 5200, 270, { w: 700 }],
      ['toilet', 1975, 6150, 270],
      ['shower', 2325, 7050, 180, { w: 1350, d: 900 }],
      // Banheiro
      ['shower', 2325, 8125, 0, { w: 1350, d: 950 }],
      ['toilet', 1975, 8980, 270],
      ['basin', 1880, 9670, 270, { w: 700 }],
      // Circulação
      ['plant', 5355, 10100, 0, { w: 450, d: 450 }],
      // Quarto 1
      ['wardrobe', 1550, 10800, 0, { w: 2800 }],
      ['rug', 1900, 12850, 90, { w: 2000, d: 1400 }],
      ['bedDouble', 1125, 12850, 270],
      ['nightstand', 350, 11925, 270],
      ['nightstand', 350, 13775, 270],
      ['desk', 3850, 12800, 90],
      ['officeChair', 3350, 12800, 270],
      ['plant', 3850, 14550, 0],
      // Quarto 2
      ['wardrobe', 6600, 10800, 0, { w: 2600 }],
      ['rug', 6450, 12800, 90, { w: 2200, d: 1400 }],
      ['bedQueen', 7800, 12800, 90],
      ['nightstand', 8650, 11775, 90],
      ['nightstand', 8650, 13825, 90],
      ['desk', 4600, 12600, 270],
      ['officeChair', 5100, 12600, 90],
      ['armchair', 7300, 14400, 180],
      ['plant', 4600, 14550, 0],
      // Varanda
      ['planter', 925, 15200, 0],
      ['plant', 450, 15760, 0],
      ['plant', 1400, 15760, 0],
      ['planter', 4225, 15200, 0, { w: 1200 }],
      ['armchair', 7200, 15410, 0],
      ['sideTable', 7825, 15300, 0, { w: 400, d: 400 }],
      ['armchair', 8450, 15410, 0],
    ],
    f2: [
      // Varanda coberta (área gourmet)
      ['plant', 1925, 3325, 0],
      ['counter', 1950, 4380, 270],
      ['kitchenSink', 1950, 5940, 270, { w: 2100 }],
      ['counter', 1950, 7450, 270, { w: 900 }],
      ['fridge', 1950, 8275, 270, { w: 650, d: 600 }],
      ['bbq', 2650, 8300, 180, { w: 700 }],
      ['sideboard', 4700, 3225, 0],
      ['dining8', 4700, 5000, 0],
      ['plant', 7050, 3325, 0],
      ['rug', 5900, 7650, 90, { w: 1800, d: 2400 }],
      ['outdoorSofa', 6950, 7650, 90],
      ['coffeeTable', 5950, 7650, 90],
      ['armchair', 5060, 7650, 270],
      ['plant', 5850, 10050, 0],
      // Lavabo
      ['basin', 1880, 9300, 270, { w: 700 }],
      ['toilet', 2575, 10025, 180],
      // Varanda descoberta (terraço)
      ['planter', 350, 11450, 270],
      ['lounger', 1100, 13450, 0],
      ['lounger', 2000, 13450, 0],
      ['lounger', 2900, 13450, 0],
      ['plant', 450, 14550, 0],
      ['plant', 5600, 10850, 0],
      ['outdoorTable', 6000, 13000, 0],
      ['outdoorSofa', 8450, 11600, 90],
      ['coffeeTable', 7400, 11600, 90],
      ['planter', 8650, 13450, 90],
      ['plant', 8550, 14550, 0],
    ],
  });

  const normRot = (r) => (((Math.round(r) % 360) + 360) % 360);

  function layoutItem(floor, n, row) {
    const [typeId, x, y, rot, patch] = row;
    const t = TYPES[typeId];
    if (!t) {
      console.warn('[catalog] tipo desconhecido no layout padrão:', typeId);
      return null;
    }
    const p = patch || {};
    return {
      id: 'f_' + floor + '_' + n,
      floor,
      type: typeId,
      x,
      y,
      rot: normRot(rot),
      w: p.w || t.w,
      d: p.d || t.d,
      h: p.h || t.h,
      elev: p.elev != null ? p.elev : t.elev || 0,
      color: null,
    };
  }

  /** Fully furnished arrangement for the floors present in `doc` (new objects every call; doc is not touched). */
  function defaultLayout(doc) {
    const floors = doc && Array.isArray(doc.floors) ? doc.floors.map((f) => f.id) : Object.keys(LAYOUT);
    const out = [];
    floors.forEach((floorId) => {
      (LAYOUT[floorId] || []).forEach((row, i) => {
        const item = layoutItem(floorId, i + 1, row);
        if (item) out.push(item);
      });
    });
    return out;
  }

  DD.catalog = {
    categories: CATEGORIES,
    types: TYPES,
    draw2d,
    thumbnail,
    defaultLayout,
  };
})();
