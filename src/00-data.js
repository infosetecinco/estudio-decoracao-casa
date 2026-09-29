// ===== 00-data.js — plan model extracted from "Proj Aprovado.pdf" (1:100, vector) =====
// Units: millimetres. Origin: back-left corner of the 9,00 x 20,00 m lot (top-left of the drawing).
// +x → right, +y → down (towards the street).
(function () {
  const DD = (window.DD = window.DD || {});

  const FLOORS = [
    { id: 'f0', name: 'Térreo', short: 'T', level: 0, height: 2880, ceiling: 2780 },
    { id: 'f1', name: '1º Pavimento', short: '1', level: 2880, height: 2880, ceiling: 2780 },
    { id: 'f2', name: '2º Pavimento', short: '2', level: 5760, height: 2880, ceiling: 2780 },
  ];

  // Door & window schedule (Quadro de esquadrias) — width x height x sill (mm)
  const SCHEDULE = {
    P1: { type: 'door', width: 800, height: 2100, sill: 0, style: 'swing', desc: 'Porta de madeira lisa de giro, 1 folha' },
    P2: { type: 'door', width: 700, height: 2100, sill: 0, style: 'swing', desc: 'Porta de madeira lisa de giro, 1 folha' },
    P3: { type: 'door', width: 800, height: 2100, sill: 0, style: 'swing', desc: 'Porta de madeira com vitrô, 1 folha' },
    P4: { type: 'door', width: 2000, height: 2100, sill: 0, style: 'slide4', desc: 'Porta de correr de madeira e vidro, 4 folhas' },
    P5: { type: 'door', width: 1600, height: 2100, sill: 0, style: 'double', desc: 'Porta balcão de madeira e vidro, 2 folhas' },
    P6: { type: 'door', width: 800, height: 2100, sill: 0, style: 'slide', desc: 'Porta de madeira de correr, 1 folha' },
    P7: { type: 'door', width: 1000, height: 1800, sill: 0, style: 'gate', desc: 'Portão de alumínio de abrir' },
    P8: { type: 'door', width: 3500, height: 1900, sill: 0, style: 'gateSlide', desc: 'Portão de correr de alumínio para carro' },
    J1: { type: 'window', width: 600, height: 600, sill: 1800, style: 'maxar', desc: 'Janela de madeira e vidro máximo-ar' },
    J2: { type: 'window', width: 2000, height: 1300, sill: 1100, style: 'slide2', desc: 'Janela de madeira e vidro de correr, 2 folhas' },
    J3: { type: 'window', width: 800, height: 600, sill: 1800, style: 'maxar', desc: 'Janela de madeira e vidro máximo-ar' },
    J4: { type: 'window', width: 2000, height: 1800, sill: 600, style: 'slide2', desc: 'Janela de madeira e vidro de correr, 2 folhas' },
    J5: { type: 'window', width: 1200, height: 1600, sill: 2200, style: 'fixedMaxar', desc: 'Janela de madeira e vidro fixo e máximo-ar' },
    J6: { type: 'window', width: 1000, height: 1200, sill: 1100, style: 'slide2', desc: 'Janela de vidro e madeira de correr, 2 folhas' },
    J7: { type: 'window', width: 500, height: 2100, sill: 0, style: 'pivot', desc: 'Janela pivotante de vidro e madeira' },
  };

  // Wall helpers. kind: structural | partition | muro | railing
  const KIND_HEIGHT = { structural: 2880, partition: 2880, muro: 1800, railing: 1000 };
  // extra: optional overrides, e.g. { height } or { mureta } (solid base height of a railing, mm)
  function W(id, floor, x1, y1, x2, y2, kind, thick, extra) {
    return Object.assign({ id, floor, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thick: thick || 150, height: KIND_HEIGHT[kind], kind }, extra || {});
  }
  const H = (id, floor, y, x1, x2, kind, t, extra) => W(id, floor, x1, y, x2, y, kind, t, extra);
  const V = (id, floor, x, y1, y2, kind, t, extra) => W(id, floor, x, y1, x, y2, kind, t, extra);
  const MURO_TERREO = { height: 2000 }; // cortes: boundary walls 2,00 m on the ground (1,80 m on the terrace)

  // Opening helper. t = distance (mm) from wall.a to the opening centre.
  // hinge: 'start' | 'end' (jamb nearer wall.a / wall.b); side: +1 swings/slides towards the wall's
  // left normal n = (-dir.y, dir.x) (for a wall drawn +x that is +y), -1 the opposite side.
  function O(id, wall, code, t, extra) {
    const s = SCHEDULE[code];
    return Object.assign(
      { id, wall, code, type: s.type, t, width: s.width, height: s.height, sill: s.sill, style: s.style, hinge: 'start', side: 1 },
      extra || {}
    );
  }

  const walls = [
    // ---------------- TÉRREO (f0) ----------------
    H('w0_back', 'f0', 2925, 1500, 7500, 'structural'),
    V('w0_left', 'f0', 1575, 2850, 10500, 'structural'),
    V('w0_right', 'f0', 7425, 2850, 8675, 'structural'),
    H('w0_salaTop', 'f0', 8675, 4150, 8850, 'structural'),
    H('w0_cozBottom', 'f0', 8675, 1500, 4150, 'partition'),
    V('w0_cozDesp', 'f0', 4225, 2925, 4675, 'partition'),
    V('w0_cozQuarto', 'f0', 4225, 4675, 8675, 'partition'),
    H('w0_despSuite', 'f0', 4675, 4225, 7425, 'partition'),
    V('w0_despSuiteDiv', 'f0', 5475, 2925, 4675, 'partition'),
    V('w0_divisaDir', 'f0', 8925, 8000, 16200, 'structural'),
    H('w0_salaFront', 'f0', 14925, 4150, 8925, 'structural'),
    V('w0_garagemSala', 'f0', 4225, 10425, 15000, 'structural'),
    H('w0_lavBottom', 'f0', 10425, 1500, 4300, 'structural'),
    V('w0_lavRight', 'f0', 3075, 8675, 10425, 'structural'),
    V('w0_garagemEsq', 'f0', 75, 10500, 16200, 'structural'),
    // muros de divisa (A = 2,00 m no térreo, conforme os cortes)
    H('m0_fundos', 'f0', 75, 0, 9000, 'muro', 150, MURO_TERREO),
    V('m0_esqFundos', 'f0', 75, 0, 10500, 'muro', 150, MURO_TERREO),
    V('m0_dirFundos', 'f0', 8925, 0, 8000, 'muro', 150, MURO_TERREO),
    V('m0_esqFrente', 'f0', 75, 16200, 20000, 'muro', 150, MURO_TERREO),
    V('m0_dirFrente', 'f0', 8925, 16200, 20000, 'muro', 150, MURO_TERREO),
    H('m0_frente', 'f0', 19925, 0, 9000, 'muro', 150, MURO_TERREO),

    // ---------------- 1º PAVIMENTO (f1) ----------------
    H('w1_back', 'f1', 2925, 1500, 7500, 'structural'),
    V('w1_left', 'f1', 1575, 2850, 10500, 'structural'),
    V('w1_right', 'f1', 7425, 2850, 8675, 'structural'),
    H('w1_closetBottom', 'f1', 4675, 1500, 7425, 'partition'),
    V('w1_closetDiv', 'f1', 4225, 2925, 4675, 'partition'),
    V('w1_suiteBanho', 'f1', 3075, 4675, 10425, 'structural'),
    H('w1_suiteBanhoDiv', 'f1', 7575, 1575, 3075, 'partition'),
    H('w1_masterBottom', 'f1', 8675, 3075, 8850, 'structural'),
    V('w1_divisaDir', 'f1', 8925, 8000, 16200, 'structural'),
    H('w1_quartosTop', 'f1', 10425, 0, 8925, 'structural'),
    V('w1_quartosDiv', 'f1', 4225, 10425, 14925, 'partition'),
    V('w1_esq', 'f1', 75, 10350, 16200, 'structural'),
    H('w1_front', 'f1', 14925, 0, 8925, 'structural'),
    // "Guarda corpo A=0,90 / Mureta A=0,30" → top rail at 1,20 m over a 0,30 m mureta
    H('w1_guardaCorpo', 'f1', 16125, 150, 8850, 'railing', 150, { height: 1200, mureta: 300 }),

    // ---------------- 2º PAVIMENTO (f2) ----------------
    H('w2_back', 'f2', 2925, 1500, 7500, 'structural'),
    V('w2_left', 'f2', 1575, 2850, 10500, 'structural'),
    V('w2_right', 'f2', 7425, 2850, 8675, 'structural'),
    H('w2_lavTop', 'f2', 8675, 1575, 3075, 'partition'),
    V('w2_lavRight', 'f2', 3075, 7900, 10425, 'partition'),
    H('w2_escadaTop', 'f2', 8675, 6170, 8925, 'structural'),
    V('w2_divisaDir', 'f2', 8925, 8000, 10500, 'structural'),
    H('w2_front', 'f2', 10425, 1500, 9000, 'structural'),
    V('m2_esq', 'f2', 75, 10350, 15000, 'muro'),
    V('m2_dir', 'f2', 8925, 10500, 15000, 'muro'),
    // terraço: platibanda 0,80 m + guarda-corpo preto (corte longitudinal / fachada)
    H('w2_guardaCorpoFrente', 'f2', 14925, 150, 8850, 'railing', 150, { height: 1100, mureta: 800 }),
    H('w2_guardaCorpoFundo', 'f2', 10425, 0, 1500, 'railing', 150, { height: 1100, mureta: 800 }),
    // guard on the open side of the stair void (drop onto the flight below)
    V('w2_guardaEscada', 'f2', 6125, 9550, 10425, 'railing', 50, { height: 1000, mureta: 0 }),
  ];

  const openings = [
    // Térreo
    O('o0_p1_fundos', 'w0_back', 'P1', 2125, { hinge: 'end', side: 1 }),
    O('o0_j1_desp', 'w0_back', 'J1', 3170),
    O('o0_j1_suite', 'w0_back', 'J1', 4450),
    O('o0_j2_coz', 'w0_left', 'J2', 2150),
    O('o0_j1_lav', 'w0_left', 'J1', 7100),
    O('o0_j2_quarto', 'w0_right', 'J2', 3000),
    O('o0_p1_quarto', 'w0_salaTop', 'P1', 2675, { hinge: 'end', side: -1 }),
    O('o0_j5_escada', 'w0_salaTop', 'J5', 4025),
    O('o0_p1_coz', 'w0_cozBottom', 'P1', 2125, { hinge: 'end', side: -1 }),
    O('o0_p6_desp', 'w0_cozDesp', 'P6', 1250, { side: 1 }),
    O('o0_p2_suite', 'w0_despSuite', 'P2', 2700, { hinge: 'end', side: -1 }),
    O('o0_j7_a', 'w0_salaFront', 'J7', 600),
    O('o0_p3_entrada', 'w0_salaFront', 'P3', 1377, { hinge: 'start', side: -1 }),
    O('o0_j7_b', 'w0_salaFront', 'J7', 2150),
    O('o0_j4_sala', 'w0_salaFront', 'J4', 3600),
    O('o0_p1_garagem', 'w0_lavBottom', 'P1', 2150, { hinge: 'start', side: -1 }),
    O('o0_p2_lav', 'w0_lavRight', 'P2', 500, { hinge: 'start', side: 1 }),
    O('o0_p8_portao', 'm0_frente', 'P8', 2400, { side: -1 }),
    O('o0_p7_portao', 'm0_frente', 'P7', 5770, { hinge: 'start', side: -1 }),
    // 1º pavimento
    O('o1_j6_closetE', 'w1_left', 'J6', 1150),
    O('o1_j3_suite', 'w1_left', 'J3', 3250),
    O('o1_j3_banho', 'w1_left', 'J3', 6200),
    O('o1_j6_closetD', 'w1_right', 'J6', 950),
    O('o1_j2_master', 'w1_right', 'J2', 3000),
    O('o1_p6_closet', 'w1_closetBottom', 'P6', 2150, { side: 1 }),
    O('o1_p2_closet', 'w1_closetBottom', 'P2', 3275, { hinge: 'start', side: -1 }),
    O('o1_p2_suite', 'w1_suiteBanho', 'P2', 550, { hinge: 'start', side: 1 }),
    O('o1_p2_banho', 'w1_suiteBanho', 'P2', 5200, { hinge: 'end', side: 1 }),
    O('o1_p2_master', 'w1_masterBottom', 'P2', 550, { hinge: 'start', side: -1 }),
    O('o1_j5_escada', 'w1_masterBottom', 'J5', 5100),
    O('o1_p2_q1', 'w1_quartosTop', 'P2', 3675, { hinge: 'end', side: 1 }),
    O('o1_p2_q2', 'w1_quartosTop', 'P2', 4775, { hinge: 'start', side: 1 }),
    O('o1_p5_q1', 'w1_front', 'P5', 2500, { side: 1 }),
    O('o1_p5_q2', 'w1_front', 'P5', 5950, { side: 1 }),
    // 2º pavimento
    O('o2_j2_esq', 'w2_left', 'J2', 2150),
    O('o2_j1_lav', 'w2_left', 'J1', 6900),
    O('o2_j2_dir', 'w2_right', 'J2', 3000),
    O('o2_p2_lav', 'w2_lavRight', 'P2', 1250, { hinge: 'start', side: 1 }),
    O('o2_p4_terraco', 'w2_front', 'P4', 2750, { side: 1 }),
  ];

  // Room seeds: a named point inside each room. Rooms themselves are detected automatically from
  // the walls (see core: DD.rooms), so demolishing a wall merges the rooms on both sides.
  // planArea = area printed on the approved drawing (m²), used only for comparison in the UI.
  const S = (id, floor, name, x, y, material, planArea, extra) =>
    Object.assign({ id, floor, name, x, y, material, planArea: planArea == null ? null : planArea, outdoor: false }, extra || {});
  const roomSeeds = [
    S('r0_cozinha', 'f0', 'Cozinha', 2900, 6200, 'porcelanato', 14.0),
    S('r0_desp', 'f0', 'Desp.', 4850, 3800, 'ceramica', 1.76),
    S('r0_suite', 'f0', 'Suíte', 6450, 3900, 'ceramica', 2.88),
    S('r0_quarto', 'f0', 'Quarto', 5825, 6700, 'vinilico', 11.74),
    S('r0_lav', 'f0', 'Lav.', 2325, 9550, 'ceramica', 2.16),
    S('r0_sala', 'f0', 'Sala', 6500, 12200, 'porcelanato', 29.6),
    S('r0_garagem', 'f0', 'Garagem', 2150, 12750, 'concreto', 18.0),
    S('r1_closetE', 'f1', 'Closet', 2900, 3800, 'madeira', 4.0),
    S('r1_closetD', 'f1', 'Closet', 5800, 3800, 'madeira', 4.88),
    S('r1_master', 'f1', 'Quarto Master', 5250, 6700, 'madeira', 16.17),
    S('r1_suite', 'f1', 'Suíte', 2325, 6100, 'ceramica', 3.71),
    S('r1_banho', 'f1', 'Banhº', 2325, 9000, 'ceramica', 3.65),
    S('r1_circ', 'f1', 'Circulação', 4700, 9550, 'porcelanato', 9.12),
    S('r1_q1', 'f1', 'Quarto 1', 2150, 12700, 'vinilico', 17.4),
    S('r1_q2', 'f1', 'Quarto 2', 6575, 12700, 'vinilico', 19.79),
    S('r1_varanda', 'f1', 'Varanda', 7000, 15550, 'ceramicaExt', 9.14, { outdoor: true }),
    S('r2_gourmet', 'f2', 'Varanda coberta', 4800, 6000, 'porcelanato', null),
    S('r2_lav', 'f2', 'Lav.', 2325, 9550, 'ceramica', 2.16),
    S('r2_terraco', 'f2', 'Varanda descoberta', 4500, 12700, 'deck', 37.85, { outdoor: true }),
  ];

  // Room-separation lines (bound a room without building a wall, e.g. the open garage front).
  const separators = [
    { id: 's0_garagemTopo', floor: 'f0', a: { x: 150, y: 10500 }, b: { x: 1500, y: 10500 } },
    { id: 's0_garagemFrente', floor: 'f0', a: { x: 150, y: 15000 }, b: { x: 4150, y: 15000 } },
  ];

  // U-shaped stair: 16 risers of 18 cm, treads of 27 cm, landing (step 8) at 1,44 m. `floor` = the floor it rises from.
  const stairs = [
    { id: 'st0', floor: 'f0', x: 6150, y: 8750, length: 2700, width: 1600, tread: 270, lowerCount: 7, upperCount: 7 },
    { id: 'st1', floor: 'f1', x: 6150, y: 8750, length: 2700, width: 1600, tread: 270, lowerCount: 7, upperCount: 7 },
  ];

  // Ground-level site surfaces (decorative; drawn under the plan on the Térreo and as ground in 3D).
  const site = {
    lot: { w: 9000, h: 20000 },
    street: 'Rua',
    northDeg: 41, // north arrow, degrees clockwise from "up" on the drawing
    zones: [
      { id: 'z_grama', kind: 'grass', x: 0, y: 0, w: 9000, h: 20000 },
      { id: 'z_calcadaFundos', kind: 'paving', x: 150, y: 2050, w: 8700, h: 800 },
      { id: 'z_calcadaEsq', kind: 'paving', x: 150, y: 2850, w: 1350, h: 7650 },
      { id: 'z_calcadaDir', kind: 'paving', x: 7500, y: 2850, w: 650, h: 5150 },
      { id: 'z_coberta', kind: 'paving', x: 150, y: 15000, w: 8700, h: 1200 },
      { id: 'z_rampa', kind: 'driveway', x: 650, y: 16200, w: 3500, h: 3650 },
      { id: 'z_acesso', kind: 'paving', x: 4850, y: 16200, w: 1900, h: 3650 },
    ],
  };

  function initialState() {
    return {
      version: 1,
      meta: {
        name: 'Casa — projeto aprovado',
        source: 'Planta aprovada 01/01 (esc. 1:100)',
      },
      floors: FLOORS.map((f) => Object.assign({}, f)),
      walls: walls.map((w) => Object.assign({}, w, { a: Object.assign({}, w.a), b: Object.assign({}, w.b) })),
      openings: openings.map((o) => Object.assign({}, o)),
      roomSeeds: roomSeeds.map((r) => Object.assign({}, r)),
      separators: separators.map((s) => ({ id: s.id, floor: s.floor, a: Object.assign({}, s.a), b: Object.assign({}, s.b) })),
      stairs: stairs.map((s) => Object.assign({}, s)),
      furniture: [], // filled by DD.catalog.defaultLayout() at boot (see 10-catalog.js)
      measures: [],
      site: JSON.parse(JSON.stringify(site)),
    };
  }

  DD.data = { FLOORS, SCHEDULE, KIND_HEIGHT, initialState };
})();
