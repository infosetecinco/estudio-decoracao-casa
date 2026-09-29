// ===== 40-ui.js — page chrome: top bar, tool rail, library, inspector, status bar, view switching, keyboard =====
// Owns everything outside the 2D canvas and the WebGL canvas. Talks to the other modules only through DD.* and
// guards every cross-module call (plan2d / view3d / catalog / materials may be missing or still loading).
(function () {
  'use strict';
  const DD = (window.DD = window.DD || {});

  // =================================================================== constants
  const VIEWS = ['2d', 'split', '3d'];
  const TOOLS = [
    { id: 'select', key: 'V', label: 'Selecionar', icon: 'select', hint: 'Clique para selecionar · arraste para mover · Alt desliga a adsorção' },
    { id: 'measure', key: 'M', label: 'Medir', icon: 'measure', hint: 'Clique no ponto inicial e no ponto final da medida · Esc cancela' },
    { id: 'wall', key: 'W', label: 'Parede', icon: 'wall', hint: 'Clique para iniciar e para terminar uma parede não estrutural · Esc cancela' },
    { id: 'demolish', key: 'D', label: 'Demolir', icon: 'demolish', hint: 'Clique numa parede não estrutural para demolir — os ambientes se unem' },
    { id: 'paint', key: 'F', label: 'Piso', icon: 'paint', hint: 'Escolha o revestimento na paleta e clique num ambiente' },
    { id: 'pan', key: 'H', label: 'Mover', icon: 'pan', hint: 'Arraste para mover a vista · roda do mouse para zoom' },
  ];
  const TOOL_BY_KEY = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));
  const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

  const LIMITS = Object.freeze({
    size: { min: 100, max: 6000 },
    elev: { min: 0, max: 3000 },
    partitionThick: { min: 70, max: 250 },
    openingWidth: { min: 400, max: 4000 },
    roomName: 40,
  });
  const OPENING_CLEARANCE = 100; // mm kept free between openings and from wall ends
  const NUDGE_MERGE_MS = 600;
  const NUDGE_STEP = 10;
  const NUDGE_STEP_BIG = 100;
  const TOAST_MS = 2800;
  const TOAST_MAX = 4;
  const TOAST_DEDUPE_MS = 500;
  const TOOLTIP_DELAY = 380;
  const VIEW_FADE_MS = 450;
  const LAYOUT_ANIM_MS = 420;
  const TO3D_MS = 1100;
  const TO2D_MS = 900;
  const SPLIT_MIN = 0.2;
  const SPLIT_MAX = 0.8;
  const SAVE_STALL_MS = 4000;
  const THUMB_PX = 96;
  const THUMB_BATCH = 8;
  const ZOOM_STEP = 1.25;
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
  const PRINT_SCALE = 96 / 25.4 / 100; // css px per mm at 1:100 → "100 %"
  const DRAG_MIME = 'application/x-dd-furniture';
  const NARROW_MQ = '(max-width: 999px)';
  const EXPORT_JSON_NAME = 'projeto-casa-lote-38.json';

  const COLOR_SWATCHES = [
    { hex: '#F2EEE6', name: 'Off-white' },
    { hex: '#CDBFA8', name: 'Linho' },
    { hex: '#B8895A', name: 'Carvalho' },
    { hex: '#6E4A2E', name: 'Nogueira' },
    { hex: '#3A3733', name: 'Grafite' },
    { hex: '#6B7456', name: 'Verde oliva' },
    { hex: '#2F5563', name: 'Azul petróleo' },
    { hex: '#C0643F', name: 'Terracota' },
  ];

  const STYLE_LABELS = {
    swing: 'De giro, 1 folha',
    double: 'De giro, 2 folhas',
    slide: 'De correr, 1 folha',
    slide4: 'De correr, 4 folhas',
    gate: 'Portão de abrir',
    gateSlide: 'Portão de correr',
    slide2: 'De correr, 2 folhas',
    maxar: 'Máximo-ar',
    fixedMaxar: 'Fixa + máximo-ar',
    pivot: 'Pivotante',
  };

  const WALL_KIND = {
    structural: {
      label: 'Estrutural',
      locked: true,
      note: 'Parede estrutural: sustenta as lajes e se repete no pavimento de cima. Não pode ser demolida, movida nem receber novas aberturas.',
    },
    partition: { label: 'Não estrutural', locked: false, note: '' },
    muro: { label: 'Muro de divisa', locked: true, note: 'Muro de divisa do lote (altura 1,80 m) — elemento fixo do projeto aprovado.' },
    railing: { label: 'Guarda-corpo', locked: true, note: 'Guarda-corpo / mureta (≈ 1,00 m) — elemento de segurança fixo do projeto aprovado.' },
  };

  const PANEL_TITLES = { overview: 'Projeto', furniture: 'Móvel', wall: 'Parede', opening: 'Abertura', room: 'Ambiente', measure: 'Medida' };
  const SELECTION_COLLECTION = { furniture: 'furniture', wall: 'walls', opening: 'openings', measure: 'measures' };

  const CAM_MODES = [
    { id: 'orbit', label: 'Aérea', icon: 'orbit', hint: 'Arraste para girar · botão direito para deslocar · roda do mouse para zoom · clique para selecionar' },
    { id: 'walk', label: 'Primeira pessoa', icon: 'walk', hint: 'Clique na vista para caminhar · W A S D para andar · mouse para olhar · Esc solta o cursor' },
  ];

  const TOAST_ICONS = { info: 'info', ok: 'ok', warn: 'warn', error: 'error' };

  // Drafting swatches that mirror the 2D canvas styles exactly (CONTRACT §7), drawn on paper.
  const LEGEND = [
    {
      kind: 'structural',
      label: 'Parede estrutural',
      svg: '<rect width="40" height="14" fill="#F3EFE6"/><rect y="3" width="40" height="8" fill="#2E2A26"/>',
    },
    {
      kind: 'partition',
      label: 'Parede não estrutural (vedação)',
      svg:
        '<defs><pattern id="lg-hatch-p" width="3.5" height="3.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
        '<line x1="0" y1="0" x2="0" y2="3.5" stroke="#8C8375" stroke-width="0.9"/></pattern></defs>' +
        '<rect width="40" height="14" fill="#F3EFE6"/><rect y="3" width="40" height="8" fill="#CFC6B7"/>' +
        '<rect y="3" width="40" height="8" fill="url(#lg-hatch-p)"/><rect x=".4" y="3.4" width="39.2" height="7.2" fill="none" stroke="#8C8375" stroke-width=".8"/>',
    },
    {
      kind: 'muro',
      label: 'Muro de divisa (1,80 m)',
      svg:
        '<defs><pattern id="lg-hatch-m" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
        '<line x1="0" y1="0" x2="0" y2="7" stroke="#6E655A" stroke-width="0.9"/></pattern></defs>' +
        '<rect width="40" height="14" fill="#F3EFE6"/><rect y="3" width="40" height="8" fill="#9C9385"/><rect y="3" width="40" height="8" fill="url(#lg-hatch-m)"/>',
    },
    {
      kind: 'railing',
      label: 'Guarda-corpo / mureta',
      svg:
        '<rect width="40" height="14" fill="#F3EFE6"/><rect x=".5" y="4.5" width="39" height="5" fill="none" stroke="#1F1D1A" stroke-width="1"/>' +
        '<line x1="0" y1="7" x2="40" y2="7" stroke="#1F1D1A" stroke-width=".7"/>',
    },
  ];

  // Inline icon set: 20×20 viewBox, stroked with currentColor (1.6), drawn for this tool.
  const ICONS = {
    select: '<path d="M5 3.2l10.2 6-4.5 1.2-2 4.6z"/><path d="M10.7 10.4l3.4 4.2"/>',
    measure: '<path d="M2.8 13.6 13.6 2.8l3.6 3.6L6.4 17.2z"/><path d="M5.6 10.8l1.6 1.6M8 8.4l1.1 1.1M10.4 6l1.6 1.6M12.8 3.6l1.1 1.1"/>',
    wall: '<rect x="2.5" y="5" width="15" height="10" rx="1"/><path d="M2.5 10h15M7.5 5v5M12.5 10v5"/>',
    demolish: '<path d="M11.6 2.9l5.5 5.5-2.4 2.4-5.5-5.5z"/><path d="M10.4 7.7 3 15.1a1.4 1.4 0 0 0 2 2l7.4-7.4"/>',
    paint: '<path d="M2.8 16.5 5.6 5.5h8.8l2.8 11z"/><path d="M4.2 11h11.6M8.5 5.5 7.6 16.5M11.5 5.5l.9 11"/>',
    pan: '<path d="M10 2.5v15M2.5 10h15"/><path d="M7.8 4.7 10 2.5l2.2 2.2M7.8 15.3l2.2 2.2 2.2-2.2M4.7 7.8 2.5 10l2.2 2.2M15.3 7.8l2.2 2.2-2.2 2.2"/>',
    undo: '<path d="M7.5 4.5 4 8l3.5 3.5"/><path d="M4 8h8.2a4 4 0 0 1 0 8H9"/>',
    redo: '<path d="M12.5 4.5 16 8l-3.5 3.5"/><path d="M16 8H7.8a4 4 0 0 0 0 8H11"/>',
    save: '<path d="M4 3.5h9.3l2.7 2.7v10.3H4z"/><path d="M7 3.5v3.8h5.5V3.5M7 16.5v-5h6v5"/>',
    export: '<path d="M10 12.5V3M6.5 6.5 10 3l3.5 3.5"/><path d="M4 11v5.5h12V11"/>',
    upload: '<path d="M10 3v9.5M6.5 9 10 12.5 13.5 9"/><path d="M4 11v5.5h12V11"/>',
    chevron: '<path d="M6 8l4 4 4-4"/>',
    chevronRight: '<path d="M8 5l5 5-5 5"/>',
    more: '<circle class="fill" cx="4.8" cy="10" r="1.4"/><circle class="fill" cx="10" cy="10" r="1.4"/><circle class="fill" cx="15.2" cy="10" r="1.4"/>',
    library:
      '<path d="M4.5 9V7.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2V9"/><path d="M3 15.5v-4.8a1.7 1.7 0 0 1 3.4 0V12h7.2v-1.3a1.7 1.7 0 0 1 3.4 0v4.8z"/><path d="M4.5 15.5V17M15.5 15.5V17"/>',
    inspector: '<path d="M4 6h6M14 6h2M4 14h2M10 14h6"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="14" r="2"/>',
    close: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
    search: '<circle cx="8.8" cy="8.8" r="5.3"/><path d="M12.7 12.7l4 4"/>',
    lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
    trash: '<path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5.3 5.5l.8 11h7.8l.8-11"/><path d="M8.3 8.5v5M11.7 8.5v5"/>',
    duplicate: '<rect x="6.5" y="6.5" width="10" height="10" rx="1.5"/><path d="M13.5 6.5v-2a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/>',
    rotateCcw: '<path d="M4 4.5v4h4"/><path d="M4.6 8.4A6 6 0 1 1 5.2 13"/>',
    rotateCw: '<path d="M16 4.5v4h-4"/><path d="M15.4 8.4A6 6 0 1 0 14.8 13"/>',
    fit: '<path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/><rect x="7" y="7" width="6" height="6" rx="1"/>',
    plus: '<path d="M10 4.5v11M4.5 10h11"/>',
    minus: '<path d="M4.5 10h11"/>',
    grid: '<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 7.7h14M3 12.3h14M7.7 3v14M12.3 3v14"/>',
    dims: '<path d="M3 6v6M17 6v6M3 9h14"/><path d="M5.8 7.2 3.9 9l1.9 1.8M14.2 7.2 16.1 9l-1.9 1.8"/><path d="M7 15h6"/>',
    tag: '<path d="M3.5 10.2V4.5a1 1 0 0 1 1-1h5.7l7 7-6.7 6.7z"/><circle cx="7.3" cy="7.3" r="1.2"/>',
    magnet: '<path d="M5 3.5v6.5a5 5 0 0 0 10 0V3.5h-3.2V10a1.8 1.8 0 0 1-3.6 0V3.5z"/><path d="M5 6.5h3.2M11.8 6.5H15"/>',
    theme: '<circle cx="10" cy="10" r="6.5"/><path class="fill" d="M10 3.5a6.5 6.5 0 0 1 0 13z"/>',
    keyboard: '<rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M5.5 11.5h.01M14.5 11.5h.01M8 11.5h4"/>',
    image: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8.3" r="1.4"/><path d="M3.5 15l4.5-4.5 3 3 2-2 3.5 3.5"/>',
    cube: '<path d="M10 2.8 16.5 6.5v7L10 17.2 3.5 13.5v-7z"/><path d="M3.5 6.5 10 10.2l6.5-3.7M10 10.2v7"/>',
    file: '<path d="M5 2.8h6.5L15 6.3v10.9H5z"/><path d="M11.5 2.8v3.5H15"/><path d="M8.3 10 7 11.5l1.3 1.5M11.7 10l1.3 1.5-1.3 1.5"/>',
    reset: '<path d="M3.8 10a6.2 6.2 0 1 0 1.9-4.5"/><path d="M3.5 3.5V7H7"/><path d="M10 7v3.3l2.2 1.4"/>',
    warn: '<path d="M10 3 17.5 16H2.5z"/><path d="M10 8v3.5M10 13.9h.01"/>',
    info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v4.5M10 6.6h.01"/>',
    ok: '<circle cx="10" cy="10" r="7"/><path d="M6.8 10.2l2.2 2.2 4.3-4.6"/>',
    error: '<circle cx="10" cy="10" r="7"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"/>',
    door: '<path d="M4 17V3.5h8V17"/><path d="M12 5l4 1.2V17"/><path d="M2.5 17h15M9.5 10.5h.01"/>',
    window: '<rect x="3.5" y="3.5" width="13" height="13" rx="1"/><path d="M10 3.5v13M3.5 10h13"/>',
    orbit: '<ellipse cx="10" cy="10.5" rx="7.5" ry="3.2"/><circle cx="10" cy="10.5" r="2.2"/><path d="M10 3v2.4"/>',
    walk: '<circle cx="11" cy="3.8" r="1.5"/><path d="M8 18l2-5.5 2.5 2.3V18M6.8 10.2l2.7-3.4 3 .9 1.4 2.8 2 .8M9.5 6.8l-1 4.7"/>',
    recenter: '<circle cx="10" cy="10" r="5.5"/><circle cx="10" cy="10" r="1.6"/><path d="M10 1.8v3M10 15.2v3M1.8 10h3M15.2 10h3"/>',
    layers: '<path d="M10 3 17.5 7 10 11 2.5 7z"/><path d="M2.5 10.5 10 14.5l7.5-4M2.5 14l7.5 4 7.5-4"/>',
    flip: '<path d="M10 2.5v15"/><path d="M7.5 5.5 3 10l4.5 4.5zM12.5 5.5 17 10l-4.5 4.5"/>',
    hinge: '<path d="M4 16.5V3.5"/><path d="M4 3.5a13 13 0 0 1 12.5 13"/><path d="M4 16.5h12.5"/>',
    room: '<path d="M3 3.5h14v13H3z"/><path d="M3 10h6M12 3.5V8M12 11v5.5"/>',
  };

  const SHORTCUT_GROUPS = [
    { title: 'Ferramentas', items: TOOLS.map((t) => [[t.key], t.id === 'pan' ? 'Mover a vista' : t.label]) },
    {
      title: 'Edição',
      items: [
        [['Ctrl', 'Z'], 'Desfazer'],
        [['Ctrl', 'Shift', 'Z'], 'Refazer (ou Ctrl + Y)'],
        [['Ctrl', 'D'], 'Duplicar móvel'],
        [['Del'], 'Excluir / demolir a seleção'],
        [['R'], 'Girar 90° (Shift: sentido anti-horário)'],
        [['←', '↑', '→', '↓'], 'Deslocar 10 mm (Shift: 100 mm)'],
        [['Esc'], 'Cancelar / limpar seleção'],
        [['Ctrl', 'S'], 'Salvar neste navegador'],
      ],
    },
    {
      title: 'Vista',
      items: [
        [['1', '2', '3'], 'Térreo · 1º Pav. · 2º Pav.'],
        [['Q'], 'Alternar 2D / 3D'],
        [['Shift', 'Q'], 'Vista dividida'],
        [['0'], 'Enquadrar o pavimento'],
        [['+', '−'], 'Zoom'],
        [['G'], 'Mostrar / ocultar a grade'],
        [['?'], 'Esta lista de atalhos'],
      ],
    },
  ];

  // =================================================================== pure helpers (tested in tools/test-ui.js)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normDeg = (d) => ((d % 360) + 360) % 360;
  const fmtM = (mm, digits) => (mm / 1000).toFixed(digits == null ? 2 : digits).replace('.', ',');
  const fmtArea = (m2) => (Math.round(m2 * 100 + 1e-7) / 100).toFixed(2).replace('.', ',') + ' m²'; // half-up (29,595 → 29,60)
  const fmtInt = (v) => Math.round(v).toLocaleString('pt-BR');
  const fmtDeg = (deg) => String(Math.round(normDeg(deg) * 10) / 10).replace('.', ',');

  /** Parse a user-typed decimal ("4,25", "4.25", "1.200,5", "90°"). Returns NaN when invalid. */
  function parseDecimal(raw) {
    if (raw == null) return NaN;
    let s = String(raw).trim().replace(/\s+/g, '').replace(/(mm|m|°|º)$/i, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return parseFloat(s);
  }
  /** Millimetres: integers; "1.200" is read as one thousand two hundred (pt-BR thousands separator). */
  function parseMM(raw) {
    const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
    const thousands = /^[-+]?\d{1,3}(\.\d{3})+(mm)?$/i.test(s);
    const v = parseDecimal(thousands ? s.replace(/\./g, '') : s);
    return isFinite(v) ? Math.round(v) : NaN;
  }
  /** Metres typed by the user → millimetres. */
  function parseMeters(raw) {
    const v = parseDecimal(raw);
    return isFinite(v) ? Math.round(v * 1000) : NaN;
  }
  /** Degrees → normalised 0–360 with one decimal. */
  function parseDegrees(raw) {
    const v = parseDecimal(raw);
    return isFinite(v) ? Math.round(normDeg(v) * 10) / 10 % 360 : NaN;
  }

  const FURNITURE_FIELDS = {
    w: { parse: parseMM, label: 'Largura', limit: () => LIMITS.size, unit: 'mm' },
    d: { parse: parseMM, label: 'Profundidade', limit: () => LIMITS.size, unit: 'mm' },
    h: { parse: parseMM, label: 'Altura', limit: () => LIMITS.size, unit: 'mm' },
    elev: { parse: parseMM, label: 'Elevação', limit: () => LIMITS.elev, unit: 'mm' },
    x: { parse: parseMeters, label: 'Posição X', limit: (lot) => ({ min: 0, max: lot.w }), unit: 'm' },
    y: { parse: parseMeters, label: 'Posição Y', limit: (lot) => ({ min: 0, max: lot.h }), unit: 'm' },
    rot: { parse: parseDegrees, label: 'Rotação', limit: () => null, unit: '°' },
  };
  function rangeText(lim, unit) {
    return unit === 'm' ? `${fmtM(lim.min)} e ${fmtM(lim.max)} m` : `${fmtInt(lim.min)} e ${fmtInt(lim.max)} ${unit}`;
  }
  /**
   * Validate one inspector edit of a furniture item.
   * @returns {{patch:object}|{noop:true}|{error:string}}
   */
  function furnitureEdit(item, field, raw, lot) {
    const spec = FURNITURE_FIELDS[field];
    if (!spec) return { error: 'Campo desconhecido.' };
    const v = spec.parse(raw);
    if (!isFinite(v)) return { error: `${spec.label}: valor inválido.` };
    const lim = spec.limit(lot || { w: 9000, h: 20000 });
    if (lim && (v < lim.min || v > lim.max)) return { error: `${spec.label} deve estar entre ${rangeText(lim, spec.unit)}.` };
    const current = field === 'rot' ? normDeg(item.rot || 0) : field === 'elev' ? item.elev || 0 : item[field];
    if (Math.abs(v - current) < 1e-6) return { noop: true };
    return { patch: { [field]: v } };
  }

  /** Wall thickness edit (partitions only). */
  function thicknessEdit(wall, raw) {
    const v = parseMM(raw);
    const lim = LIMITS.partitionThick;
    if (!isFinite(v)) return { error: 'Espessura: valor inválido.' };
    if (v < lim.min || v > lim.max) return { error: `Espessura deve estar entre ${rangeText(lim, 'mm')}.` };
    if (v === wall.thick) return { noop: true };
    return { patch: { thick: v } };
  }

  /** Opening width edit: keeps the opening inside its wall and clear of its siblings. */
  function openingWidthEdit(op, wallLength, raw, siblings) {
    const v = parseMM(raw);
    if (!isFinite(v)) return { error: 'Largura: valor inválido.' };
    const max = Math.min(LIMITS.openingWidth.max, Math.floor(wallLength));
    const lim = { min: LIMITS.openingWidth.min, max };
    if (max < lim.min || v < lim.min || v > max) return { error: `Largura deve estar entre ${rangeText(lim, 'mm')}.` };
    if (v === op.width) return { noop: true };
    const t = Math.round(clamp(op.t, v / 2, wallLength - v / 2));
    const overlaps = (siblings || []).some((o) => o.id !== op.id && Math.abs(o.t - t) < (o.width + v) / 2);
    if (overlaps) return { error: 'Com essa largura a abertura ficaria sobreposta a outra.' };
    return { patch: { width: v, t } };
  }

  /**
   * Position (distance from wall.a, mm) for a new opening of `width` on a wall of length L, as close to the
   * middle as possible and at least `clearance` away from other openings and from the wall ends; null if none.
   */
  function findFreeT(L, existing, width, clearance) {
    const gap = clearance == null ? OPENING_CLEARANCE : clearance;
    const lo = gap;
    const hi = L - gap;
    if (hi - lo < width) return null;
    const busy = (existing || [])
      .map((o) => [o.t - o.width / 2 - gap, o.t + o.width / 2 + gap])
      .sort((a, b) => a[0] - b[0]);
    const free = [];
    let cur = lo;
    busy.forEach(([s, e]) => {
      if (s > cur) free.push([cur, Math.min(s, hi)]);
      cur = Math.max(cur, e);
    });
    if (cur < hi) free.push([cur, hi]);
    let best = null;
    free.forEach(([s, e]) => {
      if (e - s < width) return;
      const t = clamp(L / 2, s + width / 2, e - width / 2);
      if (best == null || Math.abs(t - L / 2) < Math.abs(best - L / 2)) best = t;
    });
    return best == null ? null : Math.round(best);
  }

  const stripAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normSearch = (s) => stripAccents(s).toLowerCase().trim();
  const slug = (s) =>
    stripAccents(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pavimento';
  const floorTabLabel = (floor) => String(floor.name).replace(/Pavimento/i, 'Pav.');
  function formatCursor(p) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return 'x —  · y —';
    return `x ${fmtM(p.x)} · y ${fmtM(p.y)} m`;
  }
  const zoomPercent = (scale) => (isFinite(scale) && scale > 0 ? Math.round((scale / PRINT_SCALE) * 100) : null);
  const fmtTime = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    return isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  function normHex(c) {
    const s = String(c == null ? '' : c).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
    return null;
  }

  const TEXT_INPUT_TYPES = ['text', 'search', 'number', 'email', 'password', 'tel', 'url', 'date', 'time', ''];
  function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    return TEXT_INPUT_TYPES.indexOf(String(el.type || '').toLowerCase()) >= 0;
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function nudgeDelta(key, big) {
    const a = ARROWS[key];
    if (!a) return null;
    const step = big ? NUDGE_STEP_BIG : NUDGE_STEP;
    return { dx: a[0] * step, dy: a[1] * step };
  }

  /** Map a keydown to a UI action (pure). ctx.walkMode: first-person camera owns letters and arrows. */
  function keyToAction(e, ctx) {
    const k = e.key || '';
    const lower = k.length === 1 ? k.toLowerCase() : k;
    if (e.ctrlKey || e.metaKey) {
      if (e.altKey) return null;
      if (lower === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
      if (lower === 'y') return { type: 'redo' };
      if (lower === 's') return { type: 'save' };
      if (lower === 'd') return { type: 'duplicate' };
      return null;
    }
    if (e.altKey) return null;
    if (k === 'Escape') return { type: 'escape' };
    if (k === 'Delete' || k === 'Backspace') return { type: 'delete' };
    if (k === '?') return { type: 'shortcuts' };
    if (k === '1' || k === '2' || k === '3') return { type: 'floor', index: Number(k) - 1 };
    const walk = ctx && ctx.walkMode;
    if (walk && (/^[a-z ]$/.test(lower) || ARROWS[k])) return lower === 'q' ? { type: 'view', mode: e.shiftKey ? 'split' : 'toggle' } : null;
    if (!e.shiftKey && TOOL_BY_KEY[lower]) return { type: 'tool', tool: TOOL_BY_KEY[lower] };
    if (lower === 'r') return { type: 'rotate', delta: e.shiftKey ? -90 : 90 };
    if (lower === 'q') return { type: 'view', mode: e.shiftKey ? 'split' : 'toggle' };
    if (lower === 'g' && !e.shiftKey) return { type: 'grid' };
    if (k === '0') return { type: 'fit' };
    if (k === '+' || k === '=') return { type: 'zoom', factor: ZOOM_STEP };
    if (k === '-' || k === '_') return { type: 'zoom', factor: 1 / ZOOM_STEP };
    const nd = nudgeDelta(k, e.shiftKey);
    return nd ? { type: 'nudge', dx: nd.dx, dy: nd.dy } : null;
  }
  const REPEATABLE_ACTIONS = { nudge: true, zoom: true, undo: true, redo: true };

  /** Next view for the Q / Shift+Q shortcuts. */
  function nextView(current, mode) {
    if (mode === 'split') return current === 'split' ? '2d' : 'split';
    return current === '3d' ? '2d' : '3d';
  }

  // =================================================================== runtime state (UI only — never the document)
  const S = {
    initialized: false,
    ready: false,
    appliedView: null,
    viewToken: 0,
    split: 0.5,
    nudge: null,
    drawer: null,
    openMenu: null,
    panel: null,
    inspKey: null,
    inspRaf: 0,
    staleTimer: 0,
    layoutRaf: 0,
    trackUntil: 0,
    cursorRaf: 0,
    cursorPoint: null,
    saveTimer: 0,
    libCards: [],
    libCategory: 'all',
    libQuery: '',
    paintBuilt: false,
    lastToast: { msg: '', at: 0 },
    tooltip: null,
    dialogReturn: null,
    el: {},
  };

  // =================================================================== DOM helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function appendChildren(el, children) {
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }
  /** Tiny element factory. `html` is only ever used with static icon markup, never with user data. */
  function h(tag, props, children) {
    const el = document.createElement(tag);
    Object.keys(props || {}).forEach((k) => {
      const v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    if (children != null) appendChildren(el, children);
    return el;
  }
  const iconSVG = (name) => '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' + (ICONS[name] || ICONS.info) + '</svg>';
  const icon = (name, extra) => h('span', { class: 'ic' + (extra ? ' ' + extra : ''), html: iconSVG(name) });
  function hydrateIcons(root) {
    $$('[data-icon]', root).forEach((el) => {
      if (!el.firstElementChild) el.innerHTML = iconSVG(el.getAttribute('data-icon'));
    });
  }
  const setPressed = (el, on) => el && el.setAttribute('aria-pressed', on ? 'true' : 'false');
  const setText = (el, text) => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  function iconButton(name, label, onClick, key) {
    return h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, 'data-tip': label, 'data-key': key || null, onclick: onClick }, [icon(name)]);
  }
  function textButton(iconName, label, onClick, cls) {
    return h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: onClick }, [iconName ? icon(iconName) : null, h('span', { text: label })]);
  }
  function flagInvalid(input) {
    input.classList.remove('is-invalid');
    void input.offsetWidth; // restart the shake animation
    input.classList.add('is-invalid');
    setTimeout(() => input.classList.remove('is-invalid'), 700);
  }
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isNarrow = () => !!(window.matchMedia && window.matchMedia(NARROW_MQ).matches);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const promiseOf = (v) => (v && typeof v.then === 'function' ? v : Promise.resolve(v));
  const withTimeout = (p, ms) => Promise.race([p, wait(ms)]);

  // =================================================================== guarded cross-module access
  function hasFn(ns, fn) {
    const m = DD[ns];
    return !!m && typeof m[fn] === 'function';
  }
  function call(ns, fn, ...args) {
    if (!hasFn(ns, fn)) return undefined;
    try {
      return DD[ns][fn](...args);
    } catch (err) {
      console.error(`[ui] DD.${ns}.${fn} falhou`, err);
      return undefined;
    }
  }
  const doc = () => DD.store.doc;
  const ui = () => DD.store.ui;
  const setUI = (patch) => DD.store.setUI(patch);
  const toast = (msg, kind) => showToast(msg, kind);

  function typeDef(type) {
    const c = DD.catalog;
    return (c && c.types && c.types[type]) || null;
  }
  const furnitureName = (item) => (typeDef(item.type) || {}).name || item.type;
  function categoryName(catId) {
    const cats = (DD.catalog && DD.catalog.categories) || [];
    const c = cats.find((x) => x.id === catId);
    return c ? c.name : '';
  }
  const thumbURL = (type) => call('catalog', 'thumbnail', type, THUMB_PX) || null;
  function materialOf(id) {
    const m = call('materials', 'get', id);
    return m || { id, name: id, group: '' };
  }
  const roomMaterials = () => ((DD.materials && DD.materials.list) || []).filter((m) => !m.site);
  const swatchURL = (id, px) => call('materials', 'swatch', id, px || 64) || '';
  /**
   * Material swatches are procedural 512² textures generated on first use; paint them into backgrounds during
   * idle time (a few per slice) so opening a panel never blocks input.
   */
  const bgQueue = [];
  let bgScheduled = false;
  function lazySwatch(el, matId, px) {
    bgQueue.push({ el, matId, px });
    if (!bgScheduled) scheduleSwatches();
    return el;
  }
  function scheduleSwatches() {
    bgScheduled = true;
    const idle = typeof requestIdleCallback === 'function' ? (fn) => requestIdleCallback(fn, { timeout: 300 }) : (fn) => setTimeout(fn, 16);
    const step = () => {
      const t0 = performance.now();
      while (bgQueue.length && performance.now() - t0 < 12) {
        const job = bgQueue.shift();
        if (!job.el.isConnected) continue;
        const url = swatchURL(job.matId, job.px);
        if (url) job.el.style.backgroundImage = `url("${url}")`;
      }
      if (bgQueue.length) idle(step);
      else bgScheduled = false;
    };
    idle(step);
  }
  const lotSize = (d) => (d.site && d.site.lot) || { w: 9000, h: 20000 };
  const floorOf = (d, id) => d.floors.find((f) => f.id === id) || null;
  function safeRooms(d, floorId) {
    try {
      return DD.rooms.compute(d, floorId) || [];
    } catch (err) {
      console.error('[ui] rooms.compute falhou', err);
      return [];
    }
  }
  function floorArea(d, floorId) {
    try {
      return DD.rooms.totalArea(d, floorId);
    } catch (err) {
      console.error('[ui] rooms.totalArea falhou', err);
      return 0;
    }
  }
  function findRoom(d, roomId, preferFloor) {
    const order = [preferFloor].concat(d.floors.map((f) => f.id).filter((id) => id !== preferFloor));
    for (const f of order) {
      const r = safeRooms(d, f).find((x) => x.id === roomId);
      if (r) return r;
    }
    return null;
  }
  function resolveSelection(d, u) {
    const sel = u.selection;
    if (!sel || !sel.kind) return null;
    const coll = SELECTION_COLLECTION[sel.kind];
    if (coll) {
      const item = DD.ops.byId(d, coll, sel.id);
      return item ? { kind: sel.kind, item } : null;
    }
    if (sel.kind === 'room') {
      const room = findRoom(d, sel.id, u.floor);
      return room ? { kind: 'room', item: room } : null;
    }
    return null;
  }
  const wallLength = (w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const openingsOfWall = (d, wallId) => d.openings.filter((o) => o.wall === wallId).sort((a, b) => a.t - b.t);

  // =================================================================== document commands
  /** Commit one undo step (closing any pending keyboard nudge first). */
  function commitDoc(next, label) {
    flushNudge();
    if (next && next !== doc()) DD.store.commit(next, label);
  }
  function select(kind, id, focus) {
    setUI({ selection: kind ? { kind, id } : null });
    if (kind && focus) DD.events.emit('focus:item', { kind, id });
  }
  function flushNudge() {
    const n = S.nudge;
    if (!n) return;
    clearTimeout(n.timer);
    S.nudge = null;
    if (DD.store.inGesture && DD.store.inGesture()) DD.store.endGesture(n.label);
  }
  function nudgeSelection(dx, dy) {
    const sel = ui().selection;
    if (!sel || sel.kind !== 'furniture') return;
    const st = DD.store;
    const inForeignGesture = st.inGesture && st.inGesture() && !S.nudge;
    if (inForeignGesture) return;
    const item = DD.ops.byId(doc(), 'furniture', sel.id);
    if (!item) return;
    if (!S.nudge || S.nudge.id !== item.id) {
      flushNudge();
      const label = 'Mover ' + furnitureName(item);
      st.beginGesture(label);
      S.nudge = { id: item.id, label, timer: 0 };
    }
    st.preview(DD.ops.update(doc(), 'furniture', item.id, { x: item.x + dx, y: item.y + dy }));
    clearTimeout(S.nudge.timer);
    S.nudge.timer = setTimeout(flushNudge, NUDGE_MERGE_MS);
  }

  function editFurniture(id, field, raw) {
    const d = doc();
    const it = DD.ops.byId(d, 'furniture', id);
    if (!it) return false;
    const res = furnitureEdit(it, field, raw, lotSize(d));
    if (res.error) {
      toast(res.error, 'warn');
      return false;
    }
    if (res.patch) commitDoc(DD.ops.update(d, 'furniture', id, res.patch), 'Editar ' + furnitureName(it));
    return true;
  }
  function setFurnitureColor(id, color) {
    const d = doc();
    const it = DD.ops.byId(d, 'furniture', id);
    if (!it) return;
    const next = color == null ? null : normHex(color);
    if ((it.color || null) === next) return;
    commitDoc(DD.ops.update(d, 'furniture', id, { color: next }), 'Editar ' + furnitureName(it));
  }
  function rotateFurniture(id, delta) {
    const d = doc();
    const it = DD.ops.byId(d, 'furniture', id);
    if (!it) return;
    const rot = normDeg(Math.round((it.rot || 0) + delta));
    commitDoc(DD.ops.update(d, 'furniture', id, { rot }), 'Girar ' + furnitureName(it));
  }
  function duplicateFurniture(id) {
    const d = doc();
    const it = DD.ops.byId(d, 'furniture', id);
    if (!it) return;
    const res = DD.ops.duplicateFurniture(d, id);
    if (!res.item) return;
    commitDoc(res.doc, 'Duplicar ' + furnitureName(it));
    select('furniture', res.item.id);
  }
  function removeFurniture(id) {
    const d = doc();
    const it = DD.ops.byId(d, 'furniture', id);
    if (!it) return;
    commitDoc(DD.ops.remove(d, 'furniture', id), 'Excluir ' + furnitureName(it));
    select(null);
  }
  function removeMeasure(id) {
    const d = doc();
    if (!DD.ops.byId(d, 'measures', id)) return;
    commitDoc(DD.ops.remove(d, 'measures', id), 'Excluir medida');
    select(null);
  }
  function demolishWall(id) {
    const res = DD.ops.demolishWall(doc(), id);
    if (res.error) {
      toast(res.error, 'warn');
      return;
    }
    commitDoc(res.doc, 'Demolir parede');
    select(null);
    toast('Parede demolida — os ambientes vizinhos foram unidos.', 'ok');
  }
  function editWallThickness(id, raw) {
    const d = doc();
    const w = DD.ops.byId(d, 'walls', id);
    if (!w || !DD.ops.isEditableWall(w)) return false;
    const res = thicknessEdit(w, raw);
    if (res.error) {
      toast(res.error, 'warn');
      return false;
    }
    if (res.patch) commitDoc(DD.ops.update(d, 'walls', id, res.patch), 'Editar parede');
    return true;
  }
  function addOpeningTo(wallId, code) {
    const d = doc();
    const w = DD.ops.byId(d, 'walls', wallId);
    const spec = DD.data.SCHEDULE[code];
    if (!w || !spec) return;
    if (!DD.ops.isEditableWall(w)) {
      toast('Só é possível abrir vãos em paredes não estruturais.', 'warn');
      return;
    }
    const t = findFreeT(wallLength(w), openingsOfWall(d, wallId), spec.width);
    if (t == null) {
      toast(`Não há espaço livre nesta parede para ${code} (${fmtM(spec.width)} m).`, 'warn');
      return;
    }
    const res = DD.ops.addOpening(d, wallId, code, t);
    if (!res.opening) return;
    commitDoc(res.doc, spec.type === 'door' ? `Adicionar porta ${code}` : `Adicionar janela ${code}`);
    select('opening', res.opening.id);
  }
  function openingContext(id) {
    const d = doc();
    const op = DD.ops.byId(d, 'openings', id);
    const wall = op ? DD.ops.byId(d, 'walls', op.wall) : null;
    return { d, op, wall };
  }
  function flipOpening(id, field) {
    const { d, op } = openingContext(id);
    if (!op) return;
    const patch = field === 'side' ? { side: op.side === -1 ? 1 : -1 } : { hinge: op.hinge === 'end' ? 'start' : 'end' };
    commitDoc(DD.ops.update(d, 'openings', id, patch), (field === 'side' ? 'Inverter lado ' : 'Inverter dobradiça ') + op.code);
  }
  function editOpeningWidth(id, raw) {
    const { d, op, wall } = openingContext(id);
    if (!op || !wall || !DD.ops.isEditableWall(wall)) return false;
    const res = openingWidthEdit(op, wallLength(wall), raw, openingsOfWall(d, wall.id));
    if (res.error) {
      toast(res.error, 'warn');
      return false;
    }
    if (res.patch) commitDoc(DD.ops.update(d, 'openings', id, res.patch), 'Editar ' + op.code);
    return true;
  }
  function removeOpening(id) {
    const { d, op, wall } = openingContext(id);
    if (!op) return;
    if (!wall || !DD.ops.isEditableWall(wall)) {
      toast('Aberturas em paredes estruturais fazem parte do projeto aprovado e não podem ser removidas.', 'warn');
      return;
    }
    commitDoc(DD.ops.remove(d, 'openings', id), 'Remover ' + op.code);
    select(null);
  }
  function renameRoom(roomId, raw) {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!name) {
      toast('O nome do ambiente não pode ficar vazio.', 'warn');
      return false;
    }
    if (name.length > LIMITS.roomName) {
      toast(`Use no máximo ${LIMITS.roomName} caracteres.`, 'warn');
      return false;
    }
    const d = doc();
    const room = findRoom(d, roomId, ui().floor);
    if (!room || room.name === name) return !!room;
    // A merged room shows its seeds' names joined; renaming every seed makes the typed name the room name.
    const next = room.seedIds.reduce((acc, seedId) => DD.ops.renameRoom(acc, seedId, name), d);
    commitDoc(next, 'Renomear ' + room.name);
    return true;
  }
  function setRoomMaterial(roomId, matId) {
    const d = doc();
    const room = findRoom(d, roomId, ui().floor);
    if (!room || room.material === matId) return;
    commitDoc(DD.ops.setRoomMaterial(d, room.seedIds, matId), 'Piso: ' + room.name);
  }

  function deleteSelection() {
    const u = ui();
    const target = resolveSelection(doc(), u);
    if (!target) return;
    const { kind, item } = target;
    if (kind === 'furniture') removeFurniture(item.id);
    else if (kind === 'measure') removeMeasure(item.id);
    else if (kind === 'opening') removeOpening(item.id);
    else if (kind === 'wall') {
      if (DD.ops.isEditableWall(item)) demolishWall(item.id);
      else toast((WALL_KIND[item.kind] || WALL_KIND.structural).label + ': elemento travado — não pode ser demolido.', 'warn');
    } else if (kind === 'room') toast('Ambientes são definidos pelas paredes — demolir uma parede une os ambientes.', 'info');
  }
  function selectedFurnitureId() {
    const sel = ui().selection;
    return sel && sel.kind === 'furniture' && DD.ops.byId(doc(), 'furniture', sel.id) ? sel.id : null;
  }

  function doUndo() {
    flushNudge();
    const label = DD.store.undo();
    toast(label ? 'Desfeito: ' + label : 'Nada para desfazer.', 'info');
  }
  function doRedo() {
    flushNudge();
    const label = DD.store.redo();
    toast(label ? 'Refeito: ' + label : 'Nada para refazer.', 'info');
  }
  function saveNow() {
    flushNudge();
    if (DD.persist.save(doc())) {
      DD.events.emit('saved', { auto: false, at: new Date() });
      toast('Projeto salvo neste navegador', 'ok');
    } else {
      toast('Não foi possível salvar: o armazenamento do navegador está indisponível ou cheio.', 'error');
    }
  }
  function setTool(id) {
    if (!TOOL_BY_ID[id]) return;
    flushNudge();
    if (ui().tool !== id) setUI({ tool: id });
  }
  function setFloor(id) {
    const d = doc();
    if (!floorOf(d, id)) return;
    flushNudge();
    if (ui().floor === id) return;
    call('plan2d', 'cancel');
    setUI({ floor: id, selection: null });
    call('plan2d', 'fit');
  }
  function toggleShow(key) {
    const show = ui().show || {};
    setUI({ show: Object.assign({}, show, { [key]: !show[key] }) });
  }
  function escapeAction() {
    if (S.openMenu) return closeMenu(S.openMenu, true);
    if (S.drawer) return closeDrawer(true);
    flushNudge();
    call('plan2d', 'cancel');
    if (ui().selection) select(null);
  }

  // =================================================================== toasts
  function showToast(msg, kind) {
    const text = String(msg == null ? '' : msg);
    const k = TOAST_ICONS[kind] ? kind : 'info';
    const box = document.getElementById('toasts');
    if (!box) {
      console.warn('[toast]', text);
      return;
    }
    const now = Date.now();
    if (S.lastToast.msg === text && now - S.lastToast.at < TOAST_DEDUPE_MS) return;
    S.lastToast = { msg: text, at: now };
    const el = h('div', { class: 'toast toast-' + k, role: k === 'error' ? 'alert' : 'status' }, [
      icon(TOAST_ICONS[k]),
      h('span', { class: 'toast-msg', text }),
    ]);
    box.appendChild(el);
    while (box.children.length > TOAST_MAX) box.firstElementChild.remove();
    requestAnimationFrame(() => el.classList.add('is-in'));
    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 240);
    };
    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(dismiss, ms);
    };
    arm(TOAST_MS + (k === 'error' ? 1600 : 0));
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => arm(1400));
    el.addEventListener('click', dismiss);
  }

  // =================================================================== tooltips
  function initTooltips() {
    const tip = h('div', { class: 'tooltip', role: 'tooltip', id: 'ui-tooltip', hidden: true });
    document.body.appendChild(tip);
    S.tooltip = { el: tip, timer: 0, target: null };
    document.addEventListener('pointerover', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (t === S.tooltip.target) return;
      hideTooltip();
      if (!t || e.pointerType === 'touch') return;
      S.tooltip.target = t;
      S.tooltip.timer = setTimeout(() => showTooltip(t), TOOLTIP_DELAY);
    });
    document.addEventListener('focusin', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      hideTooltip();
      if (t && t.matches(':focus-visible')) showTooltip(t);
    });
    ['pointerdown', 'focusout', 'keydown', 'wheel'].forEach((ev) => document.addEventListener(ev, hideTooltip, true));
  }
  function hideTooltip() {
    if (!S.tooltip) return;
    clearTimeout(S.tooltip.timer);
    S.tooltip.target = null;
    S.tooltip.el.hidden = true;
  }
  function showTooltip(target) {
    const tip = S.tooltip.el;
    const text = target.getAttribute('data-tip');
    if (!text || !document.body.contains(target)) return;
    tip.textContent = '';
    tip.appendChild(h('span', { text }));
    const key = target.getAttribute('data-key');
    if (key) key.split('+').forEach((part) => tip.appendChild(h('kbd', { text: part })));
    tip.hidden = false;
    positionTooltip(tip, target);
    S.tooltip.target = target;
  }
  function positionTooltip(tip, target) {
    const r = target.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const pos = target.getAttribute('data-tip-pos') || 'bottom';
    const gap = 8;
    let x = r.left + r.width / 2 - tr.width / 2;
    let y = r.bottom + gap;
    if (pos === 'right') {
      x = r.right + gap;
      y = r.top + r.height / 2 - tr.height / 2;
    } else if (pos === 'top') y = r.top - tr.height - gap;
    x = clamp(x, 6, window.innerWidth - tr.width - 6);
    y = clamp(y, 6, window.innerHeight - tr.height - 6);
    tip.style.left = Math.round(x) + 'px';
    tip.style.top = Math.round(y) + 'px';
  }

  // =================================================================== menus
  const menus = [];
  function bindMenu(btnId, menuId) {
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    if (!btn || !menu) return;
    const entry = { btn, menu };
    menus.push(entry);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openMenu(entry);
      else closeMenu(entry, false);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && menu.hidden) {
        e.preventDefault();
        openMenu(entry);
      }
    });
    menu.addEventListener('keydown', (e) => onMenuKey(e, entry));
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[role="menuitem"]');
      if (!item || item.disabled) return;
      closeMenu(entry, true);
      runMenuAction(item.getAttribute('data-action'));
    });
  }
  const menuItems = (menu) => $$('[role="menuitem"]', menu).filter((el) => !el.disabled && el.getClientRects().length > 0);
  function openMenu(entry) {
    closeAllMenus();
    hideTooltip();
    entry.menu.hidden = false;
    entry.btn.setAttribute('aria-expanded', 'true');
    S.openMenu = entry;
    const first = menuItems(entry.menu)[0];
    if (first) first.focus();
  }
  function closeMenu(entry, returnFocus) {
    if (!entry || entry.menu.hidden) return;
    entry.menu.hidden = true;
    entry.btn.setAttribute('aria-expanded', 'false');
    if (S.openMenu === entry) S.openMenu = null;
    if (returnFocus) entry.btn.focus();
  }
  const closeAllMenus = () => menus.forEach((m) => closeMenu(m, false));
  function onMenuKey(e, entry) {
    const items = menuItems(entry.menu);
    const i = items.indexOf(document.activeElement);
    const focusAt = (n) => items.length && items[(n + items.length) % items.length].focus();
    const handlers = {
      ArrowDown: () => focusAt(i + 1),
      ArrowUp: () => focusAt(i - 1),
      Home: () => focusAt(0),
      End: () => focusAt(items.length - 1),
      Escape: () => closeMenu(entry, true),
      Tab: () => closeMenu(entry, false),
    };
    const fn = handlers[e.key];
    e.stopPropagation();
    if (!fn) return;
    if (e.key !== 'Tab') e.preventDefault();
    fn();
  }
  function runMenuAction(action) {
    const actions = {
      redo: doRedo,
      'export-plan': exportPlan,
      'export-3d': export3D,
      'export-json': exportJSON,
      import: () => document.getElementById('file-import').click(),
      reset: resetProject,
      theme: toggleTheme,
      shortcuts: openShortcuts,
    };
    const fn = actions[action];
    if (fn) fn();
  }

  // =================================================================== dialogs
  const focusables = (root) =>
    $$('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', root).filter(
      (el) => el.getClientRects().length > 0
    );
  const isModalOpen = () => $$('dialog[open]').length > 0;
  function openDialog(dlg, initialFocus) {
    S.dialogReturn = document.activeElement;
    hideTooltip();
    closeAllMenus();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    const target = initialFocus || focusables(dlg)[0];
    if (target) target.focus();
  }
  function closeDialog(dlg) {
    if (!dlg.hasAttribute('open')) return;
    if (typeof dlg.close === 'function') dlg.close();
    else {
      dlg.removeAttribute('open');
      dlg.dispatchEvent(new Event('close'));
    }
  }
  function initDialog(dlg) {
    dlg.addEventListener('keydown', (e) => {
      e.stopPropagation(); // app shortcuts never fire behind a modal
      if (e.key !== 'Tab') return;
      const f = focusables(dlg);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    dlg.addEventListener('close', () => {
      const back = S.dialogReturn;
      S.dialogReturn = null;
      if (back && typeof back.focus === 'function' && document.body.contains(back)) back.focus();
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) closeDialog(dlg); // click on the backdrop
    });
    $$('[data-dialog-close]', dlg).forEach((b) => b.addEventListener('click', () => closeDialog(dlg)));
  }
  /** Accessible confirm dialog → Promise<boolean>. */
  function confirmDialog(opts) {
    const dlg = document.getElementById('dlg-confirm');
    if (!dlg) return Promise.resolve(window.confirm(opts.body));
    setText($('#dlg-confirm-title', dlg), opts.title);
    setText($('#dlg-confirm-body', dlg), opts.body);
    const ok = $('[data-dialog-confirm]', dlg);
    const cancel = $('[data-dialog-cancel]', dlg);
    setText(ok, opts.confirm || 'Confirmar');
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        dlg.removeEventListener('close', onClose);
        closeDialog(dlg);
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onClose = () => finish(false);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      dlg.addEventListener('close', onClose);
      openDialog(dlg, cancel);
    });
  }
  function renderShortcuts() {
    const box = document.getElementById('shortcut-groups');
    if (!box) return;
    box.textContent = '';
    SHORTCUT_GROUPS.forEach((g) => {
      const rows = g.items.map(([keys, label]) =>
        h('div', { class: 'shortcut-row' }, [h('span', { text: label }), h('span', { class: 'shortcut-keys' }, keys.map((k) => h('kbd', { text: k })))])
      );
      box.appendChild(h('div', { class: 'shortcut-group' }, [h('h3', { text: g.title })].concat(rows)));
    });
  }
  function openShortcuts() {
    const dlg = document.getElementById('dlg-shortcuts');
    if (dlg && !dlg.hasAttribute('open')) openDialog(dlg);
  }

  // =================================================================== export / import / reset / theme
  function activeFloorSlug() {
    const f = floorOf(doc(), ui().floor);
    return slug(f ? f.name : 'pavimento');
  }
  const isDataURL = (v) => typeof v === 'string' && v.indexOf('data:image/') === 0;
  function exportPlan() {
    if (!hasFn('plan2d', 'exportPNG')) return toast('A exportação da planta ainda não está disponível.', 'warn');
    const url = call('plan2d', 'exportPNG', { scale: 2, background: true });
    if (!isDataURL(url)) return toast('Não foi possível gerar a imagem da planta.', 'error');
    DD.persist.downloadDataURL(url, `planta-${activeFloorSlug()}.png`);
    toast('Planta exportada em PNG.', 'ok');
  }
  function export3D() {
    if (!call('view3d', 'isReady')) return toast('A vista 3D ainda não está pronta para exportar.', 'warn');
    const url = call('view3d', 'exportPNG');
    if (!isDataURL(url)) return toast('Não foi possível gerar a imagem 3D.', 'error');
    DD.persist.downloadDataURL(url, `vista-3d-${activeFloorSlug()}.png`);
    toast('Vista 3D exportada em PNG.', 'ok');
  }
  function exportJSON() {
    try {
      flushNudge();
      DD.persist.downloadJSON(doc(), EXPORT_JSON_NAME);
      toast('Projeto exportado (.json).', 'ok');
    } catch (err) {
      console.error('[ui] exportJSON', err);
      toast('Não foi possível exportar o projeto.', 'error');
    }
  }
  function loadDocument(next, label) {
    flushNudge();
    call('plan2d', 'cancel');
    DD.store.replace(next, label);
    const u = ui();
    const floor = floorOf(next, u.floor) ? u.floor : (next.floors[0] || {}).id;
    setUI({ floor, selection: null });
    call('plan2d', 'fit');
  }
  function onImportFile(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return toast('Arquivo grande demais para um projeto (máx. 10 MB).', 'error');
    DD.persist
      .readJSONFile(file)
      .then((next) => {
        if (!next.floors.length) throw new Error('O arquivo não contém pavimentos.');
        loadDocument(next, 'Importar projeto');
        toast('Projeto importado: ' + file.name, 'ok');
      })
      .catch((err) => toast(err && err.message ? err.message : 'Não foi possível importar o arquivo.', 'error'));
  }
  function defaultFurniture(fresh) {
    if (!hasFn('catalog', 'defaultLayout')) return [];
    try {
      const list = DD.catalog.defaultLayout(fresh);
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.error('[ui] defaultLayout', err);
      toast('Não foi possível recriar a decoração padrão.', 'warn');
      return [];
    }
  }
  function resetProject() {
    confirmDialog({
      title: 'Restaurar projeto original?',
      body: 'Móveis, paredes, pisos e medidas voltam à planta aprovada com a decoração padrão. Você ainda poderá desfazer com Ctrl + Z.',
      confirm: 'Restaurar',
    }).then((ok) => {
      if (!ok) return;
      const fresh = DD.data.initialState();
      loadDocument(Object.assign({}, fresh, { furniture: defaultFurniture(fresh) }), 'Restaurar projeto original');
      toast('Projeto original restaurado.', 'ok');
    });
  }
  function effectiveTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function toggleTheme() {
    document.documentElement.setAttribute('data-theme', effectiveTheme() === 'dark' ? 'light' : 'dark');
    syncThemeLabel();
    call('plan2d', 'redraw');
  }
  const syncThemeLabel = () => setText(document.getElementById('theme-label'), effectiveTheme() === 'dark' ? 'Tema claro' : 'Tema escuro');

  // =================================================================== top bar
  function initTopbar() {
    const toggle = document.getElementById('view-toggle');
    toggle.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (b) setView(b.getAttribute('data-view'));
    });
    document.getElementById('btn-undo').addEventListener('click', doUndo);
    document.getElementById('btn-redo').addEventListener('click', doRedo);
    document.getElementById('btn-save').addEventListener('click', saveNow);
    document.getElementById('file-import').addEventListener('change', onImportFile);
    document.getElementById('floor-tabs').addEventListener('keydown', onFloorTabKey);
    bindMenu('btn-export', 'menu-export');
    bindMenu('btn-more', 'menu-more');
    document.addEventListener('pointerdown', (e) => {
      const m = S.openMenu;
      if (m && !m.menu.contains(e.target) && !m.btn.contains(e.target)) closeMenu(m, false);
    });
  }
  function onFloorTabKey(e) {
    const tabs = $$('#floor-tabs .floor-tab');
    const i = tabs.indexOf(document.activeElement);
    const moves = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: tabs.length - 1 };
    if (i < 0 || !(e.key in moves)) return;
    e.preventDefault();
    e.stopPropagation();
    const next = tabs[(moves[e.key] + tabs.length) % tabs.length];
    next.focus();
    setFloor(next.getAttribute('data-floor'));
  }
  function renderFloorTabs() {
    const wrap = document.getElementById('floor-tabs');
    wrap.textContent = '';
    doc().floors.forEach((f, i) => {
      wrap.appendChild(
        h('button', { type: 'button', class: 'floor-tab', role: 'tab', 'data-floor': f.id, 'aria-selected': 'false', 'data-tip': f.name, 'data-key': String(i + 1), onclick: () => setFloor(f.id) }, [
          h('span', { class: 'floor-tab-name', text: floorTabLabel(f) }),
          h('span', { class: 'floor-tab-short', text: f.short || String(i), 'aria-hidden': 'true' }),
          h('span', { class: 'floor-tab-area num' }),
        ])
      );
    });
    syncFloorTabs();
    updateFloorAreas();
  }
  function syncFloorTabs() {
    const active = ui().floor;
    $$('#floor-tabs .floor-tab').forEach((b) => {
      const on = b.getAttribute('data-floor') === active;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }
  function updateFloorAreas() {
    const d = doc();
    $$('#floor-tabs .floor-tab').forEach((b) => {
      const area = floorArea(d, b.getAttribute('data-floor'));
      const txt = fmtArea(area);
      setText($('.floor-tab-area', b), txt);
      b.setAttribute('aria-label', `${b.getAttribute('data-tip')} — ${txt} construídos`);
    });
  }
  function syncHistory() {
    const st = DD.store;
    const undo = document.getElementById('btn-undo');
    const redo = document.getElementById('btn-redo');
    const ul = st.undoLabel();
    const rl = st.redoLabel();
    undo.disabled = !st.canUndo();
    redo.disabled = !st.canRedo();
    undo.setAttribute('data-tip', ul ? 'Desfazer: ' + ul : 'Nada para desfazer');
    redo.setAttribute('data-tip', rl ? 'Refazer: ' + rl : 'Nada para refazer');
    undo.setAttribute('data-key', 'Ctrl+Z');
    redo.setAttribute('data-key', 'Ctrl+Shift+Z');
    undo.setAttribute('aria-label', ul ? 'Desfazer: ' + ul : 'Desfazer');
    redo.setAttribute('aria-label', rl ? 'Refazer: ' + rl : 'Refazer');
  }
  function syncViewToggle(view) {
    $$('#view-toggle button[data-view]').forEach((b) => setPressed(b, b.getAttribute('data-view') === view));
  }
  const syncProjectName = () => setText(document.getElementById('project-name'), (doc().meta && doc().meta.name) || 'Casa');

  // =================================================================== tool rail
  function renderToolRail() {
    const rail = document.getElementById('toolrail');
    rail.textContent = '';
    TOOLS.forEach((t) => {
      rail.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn tool-btn',
            'data-tool': t.id,
            'aria-pressed': 'false',
            'aria-label': `${t.label} (${t.key})`,
            'aria-keyshortcuts': t.key,
            'data-tip': t.id === 'pan' ? 'Mover a vista' : t.label,
            'data-key': t.key,
            'data-tip-pos': 'right',
            onclick: () => setTool(t.id),
          },
          [icon(t.icon)]
        )
      );
    });
    rail.appendChild(h('span', { class: 'rail-sep', 'aria-hidden': 'true' }));
    S.el.libToggle = h('button', { type: 'button', class: 'icon-btn', id: 'btn-lib-toggle', 'aria-label': 'Biblioteca de móveis', 'aria-controls': 'library', 'data-tip': 'Biblioteca de móveis', 'data-tip-pos': 'right', onclick: toggleLibrary }, [icon('library')]);
    rail.appendChild(S.el.libToggle);
    rail.appendChild(h('span', { class: 'rail-spacer' }));
    rail.appendChild(
      h('button', { type: 'button', class: 'icon-btn hide-compact', 'aria-label': 'Atalhos de teclado', 'data-tip': 'Atalhos', 'data-key': '?', 'data-tip-pos': 'right', onclick: openShortcuts }, [icon('keyboard')])
    );
  }
  function syncToolRail(u) {
    $$('#toolrail .tool-btn').forEach((b) => setPressed(b, b.getAttribute('data-tool') === u.tool));
  }

  // =================================================================== library
  function initLibrary() {
    const grid = document.getElementById('lib-grid');
    const cat = DD.catalog;
    grid.textContent = '';
    if (!cat || !cat.types || !Object.keys(cat.types).length) {
      grid.appendChild(h('p', { class: 'lib-empty', text: 'O catálogo de móveis ainda não está disponível.' }));
      return;
    }
    const order = (cat.categories || []).map((c) => c.id);
    const rank = (def) => (order.indexOf(def.category) < 0 ? order.length : order.indexOf(def.category));
    S.libCards = Object.keys(cat.types)
      .map((type) => ({ type, def: cat.types[type] }))
      .sort((a, b) => rank(a.def) - rank(b.def))
      .map(({ type, def }) => createLibCard(type, def));
    S.libCards.forEach((c) => grid.appendChild(c.el));
    S.el.libEmpty = h('p', { class: 'lib-empty', text: 'Nenhum móvel encontrado.', hidden: true });
    grid.appendChild(S.el.libEmpty);
    renderChips(cat);
    bindLibraryEvents(grid);
    filterLibrary();
    loadThumbnails(S.libCards.slice());
  }
  function createLibCard(type, def) {
    const img = h('img', { alt: '', width: 72, height: 54, decoding: 'async', draggable: 'false' });
    const size = `${fmtM(def.w)} × ${fmtM(def.d)} m`;
    const el = h('div', { class: 'lib-card', role: 'button', tabindex: '0', draggable: 'true', 'data-type': type, 'aria-label': `Adicionar ${def.name} (${size})` }, [
      h('span', { class: 'lib-thumb' }, [img]),
      h('span', { class: 'lib-name', text: def.name }),
      h('span', { class: 'lib-size num', text: size }),
    ]);
    return { el, img, type, def, search: normSearch(`${def.name} ${categoryName(def.category)} ${type}`) };
  }
  function renderChips(cat) {
    const box = document.getElementById('lib-chips');
    box.textContent = '';
    const cats = [{ id: 'all', name: 'Todos' }].concat(cat.categories || []);
    cats.forEach((c) => {
      box.appendChild(
        h('button', { type: 'button', class: 'chip', 'data-cat': c.id, 'aria-pressed': c.id === S.libCategory ? 'true' : 'false', onclick: () => setLibCategory(c.id) }, [c.name])
      );
    });
  }
  function setLibCategory(id) {
    S.libCategory = id;
    $$('#lib-chips .chip').forEach((b) => setPressed(b, b.getAttribute('data-cat') === id));
    filterLibrary();
  }
  function filterLibrary() {
    const q = normSearch(S.libQuery);
    let shown = 0;
    S.libCards.forEach((c) => {
      const visible = (S.libCategory === 'all' || c.def.category === S.libCategory) && (!q || c.search.indexOf(q) >= 0);
      c.el.hidden = !visible;
      if (visible) shown++;
    });
    if (S.el.libEmpty) S.el.libEmpty.hidden = shown > 0;
    setText(document.getElementById('lib-count'), `${shown} ${shown === 1 ? 'item' : 'itens'}`);
  }
  function loadThumbnails(queue) {
    const step = () => {
      queue.splice(0, THUMB_BATCH).forEach((card) => {
        const url = thumbURL(card.type);
        if (!url) return;
        card.img.addEventListener('load', () => card.img.classList.add('is-loaded'), { once: true });
        card.img.src = url;
      });
      if (queue.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function bindLibraryEvents(grid) {
    const search = document.getElementById('lib-search');
    let debounce = 0;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        S.libQuery = search.value;
        filterLibrary();
      }, 90);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) {
        e.stopPropagation();
        search.value = '';
        S.libQuery = '';
        filterLibrary();
      }
    });
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.lib-card');
      if (card) addFromLibrary(card.getAttribute('data-type'));
    });
    grid.addEventListener('keydown', (e) => {
      const card = e.target.closest && e.target.closest('.lib-card');
      if (!card || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.stopPropagation();
      addFromLibrary(card.getAttribute('data-type'));
    });
    grid.addEventListener('dragstart', onLibDragStart);
    grid.addEventListener('dragend', (e) => {
      const card = e.target.closest && e.target.closest('.lib-card');
      if (card) card.classList.remove('is-dragging');
      document.getElementById('view2d').classList.remove('is-drop-target');
    });
  }
  function onLibDragStart(e) {
    const card = e.target.closest && e.target.closest('.lib-card');
    if (!card || !e.dataTransfer) return;
    const type = card.getAttribute('data-type');
    e.dataTransfer.setData(DRAG_MIME, type);
    e.dataTransfer.setData('text/plain', type);
    e.dataTransfer.effectAllowed = 'copy';
    const img = $('img', card);
    if (img && img.complete && img.naturalWidth) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
    card.classList.add('is-dragging');
    hideTooltip();
    if (isNarrow()) setTimeout(() => closeDrawer(false), 0); // uncover the plan so the item can be dropped
  }
  const isFurnitureDrag = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf(DRAG_MIME) >= 0);
  function bindDropTarget(el, onDrop) {
    el.addEventListener('dragover', (e) => {
      if (!isFurnitureDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('is-drop-target');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('is-drop-target');
    });
    el.addEventListener('drop', (e) => {
      if (!isFurnitureDrag(e)) return;
      e.preventDefault();
      el.classList.remove('is-drop-target');
      onDrop(e.dataTransfer.getData(DRAG_MIME), e);
    });
  }
  function afterAdd(type) {
    const def = typeDef(type);
    if (isNarrow() && S.drawer === 'library') closeDrawer(false);
    if (def) toast(`${def.name} adicionado`, 'ok');
  }
  function addFurnitureAtPoint(type, clientX, clientY) {
    if (!typeDef(type)) return toast('Tipo de móvel desconhecido.', 'warn');
    flushNudge();
    if (!hasFn('plan2d', 'addFurnitureAt')) return addAtFloorCentre(type);
    const id = call('plan2d', 'addFurnitureAt', type, clientX, clientY);
    if (!id) return;
    const sel = ui().selection;
    if (!sel || sel.id !== id) select('furniture', id);
    afterAdd(type);
  }
  function addFromLibrary(type) {
    const canvas = document.getElementById('plan-canvas');
    const r = canvas ? canvas.getBoundingClientRect() : null;
    if (ui().view !== '3d' && r && r.width > 0 && r.height > 0) addFurnitureAtPoint(type, r.left + r.width / 2, r.top + r.height / 2);
    else addAtFloorCentre(type);
  }
  /** Seed point of the largest closed indoor room of the floor (guaranteed inside it); lot centre as fallback. */
  function floorCentre(d, floorId) {
    const rooms = safeRooms(d, floorId).filter((r) => !r.open);
    const best = rooms.reduce((acc, r) => (!acc || r.area > acc.area ? r : acc), null);
    if (best) return { x: best.labelX, y: best.labelY };
    const lot = lotSize(d);
    return { x: lot.w / 2, y: lot.h / 2 };
  }
  function addAtFloorCentre(type) {
    const def = typeDef(type);
    if (!def) return toast('Tipo de móvel desconhecido.', 'warn');
    const d = doc();
    const floor = ui().floor;
    const c = floorCentre(d, floor);
    const res = DD.ops.addFurniture(d, type, floor, c.x, c.y, 0);
    if (!res.item) return toast('Não foi possível adicionar este móvel.', 'error');
    commitDoc(res.doc, 'Adicionar ' + def.name);
    select('furniture', res.item.id, true);
    afterAdd(type);
  }

  // =================================================================== stage & view switching
  function initStage() {
    S.el.stage = document.getElementById('stage');
    S.el.view2d = document.getElementById('view2d');
    S.el.view3d = document.getElementById('view3d');
    S.el.divider = document.getElementById('split-divider');
    initDivider();
    bindDropTarget(S.el.view2d, (type, e) => addFurnitureAtPoint(type, e.clientX, e.clientY));
    bindDropTarget(S.el.view3d, (type) => addAtFloorCentre(type));
    window.addEventListener('resize', scheduleLayout);
  }
  /** Redraw both views on the next frame (after any layout change). */
  function scheduleLayout() {
    if (S.layoutRaf) return;
    S.layoutRaf = requestAnimationFrame(() => {
      S.layoutRaf = 0;
      call('plan2d', 'redraw');
      if (ui().view !== '2d') call('view3d', 'resize');
    });
  }
  /** Keep the canvases in step with a CSS width/left animation for `ms`. */
  function trackLayout(ms) {
    S.trackUntil = Math.max(S.trackUntil, performance.now() + ms);
    const tick = () => {
      call('view3d', 'resize');
      call('plan2d', 'redraw');
      if (performance.now() < S.trackUntil) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function applyViewInstant(view) {
    const stage = S.el.stage;
    stage.classList.add('no-anim');
    stage.setAttribute('data-view', view);
    void stage.offsetWidth; // commit the new layout without transitions
    if (view !== '2d') {
      call('view3d', 'resize');
      call('view3d', 'setActive', true);
    } else call('view3d', 'setActive', false);
    requestAnimationFrame(() => stage.classList.remove('no-anim'));
    syncDivider(view);
    scheduleLayout();
  }
  function finishView(view, token) {
    if (token !== S.viewToken) return false;
    if (view === '2d') call('view3d', 'setActive', false);
    scheduleLayout();
    DD.events.emit('view:changed', { view });
    return true;
  }
  function notify3DNotReady() {
    if (!DD.view3d) toast('A vista 3D não está disponível neste navegador.', 'warn');
    else toast('A vista 3D ainda está carregando…', 'info');
  }
  function animateTo3D(token) {
    const vp = call('plan2d', 'getViewport');
    call('view3d', 'resize');
    call('view3d', 'setActive', true);
    const ready = !!call('view3d', 'isReady');
    S.el.stage.setAttribute('data-view', '3d');
    if (ready && vp) promiseOf(call('view3d', 'transitionFrom2D', vp, TO3D_MS)).catch((err) => console.error('[ui] transitionFrom2D', err));
    else notify3DNotReady();
    return wait(VIEW_FADE_MS + 40).then(() => finishView('3d', token));
  }
  function animateTo2D(token) {
    const vp = call('plan2d', 'getViewport');
    const ready = !!call('view3d', 'isReady');
    const camera = ready && vp ? withTimeout(promiseOf(call('view3d', 'transitionTo2D', vp, TO2D_MS)), TO2D_MS + 600) : Promise.resolve();
    return camera
      .catch((err) => console.error('[ui] transitionTo2D', err))
      .then(() => {
        if (token !== S.viewToken) return false;
        call('plan2d', 'redraw');
        S.el.stage.setAttribute('data-view', '2d');
        return wait(VIEW_FADE_MS + 180).then(() => finishView('2d', token));
      });
  }
  function animateLayout(view, token) {
    if (view !== '2d') {
      call('view3d', 'setActive', true);
      if (!call('view3d', 'isReady')) notify3DNotReady();
    }
    S.el.stage.setAttribute('data-view', view);
    trackLayout(LAYOUT_ANIM_MS + 80);
    return wait(Math.max(LAYOUT_ANIM_MS, VIEW_FADE_MS) + 80).then(() => finishView(view, token));
  }
  /**
   * Switch between '2d' | 'split' | '3d' with animated transitions (instant with prefers-reduced-motion).
   * Both views stay mounted. Returns a Promise<boolean> (false when superseded by a newer switch).
   */
  function setView(view) {
    if (VIEWS.indexOf(view) < 0) return Promise.resolve(false);
    const from = S.appliedView;
    S.appliedView = view;
    if (DD.store && ui().view !== view) setUI({ view });
    if (from === view || !S.el.stage) return Promise.resolve(true);
    flushNudge();
    syncViewToggle(view);
    syncDivider(view);
    ensureOverlayAttached();
    const token = ++S.viewToken;
    if (from == null || reducedMotion() || !S.ready) {
      applyViewInstant(view);
      return Promise.resolve(finishView(view, token));
    }
    if (from === '2d' && view === '3d') return animateTo3D(token);
    if (from === '3d' && view === '2d') return animateTo2D(token);
    return animateLayout(view, token);
  }

  // split divider
  function initDivider() {
    const div = S.el.divider;
    div.addEventListener('pointerdown', (e) => {
      if (ui().view !== 'split' || e.button !== 0) return;
      e.preventDefault();
      div.setPointerCapture(e.pointerId);
      S.el.stage.classList.add('is-resizing');
      const rect = S.el.stage.getBoundingClientRect();
      const move = (ev) => {
        setSplit((ev.clientX - rect.left) / rect.width);
        scheduleLayout();
      };
      const up = () => {
        div.removeEventListener('pointermove', move);
        div.removeEventListener('pointerup', up);
        div.removeEventListener('pointercancel', up);
        S.el.stage.classList.remove('is-resizing');
        scheduleLayout();
      };
      div.addEventListener('pointermove', move);
      div.addEventListener('pointerup', up);
      div.addEventListener('pointercancel', up);
    });
    div.addEventListener('dblclick', () => {
      setSplit(0.5);
      trackLayout(LAYOUT_ANIM_MS);
    });
    div.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const moves = { ArrowLeft: S.split - step, ArrowRight: S.split + step, Home: SPLIT_MIN, End: SPLIT_MAX };
      if (!(e.key in moves)) return;
      e.preventDefault();
      e.stopPropagation();
      setSplit(moves[e.key]);
      scheduleLayout();
    });
  }
  function setSplit(ratio) {
    S.split = clamp(isFinite(ratio) ? ratio : 0.5, SPLIT_MIN, SPLIT_MAX);
    S.el.stage.style.setProperty('--split', (S.split * 100).toFixed(2) + '%');
    S.el.divider.setAttribute('aria-valuenow', String(Math.round(S.split * 100)));
  }
  function syncDivider(view) {
    if (S.el.divider) S.el.divider.tabIndex = view === 'split' ? 0 : -1;
  }

  // =================================================================== paint strip
  function renderPaintStrip() {
    const strip = document.getElementById('paint-strip');
    strip.textContent = '';
    const mats = roomMaterials();
    if (!mats.length) {
      strip.appendChild(h('span', { class: 'insp-sub', text: 'Revestimentos indisponíveis' }));
      return;
    }
    S.el.paintName = h('span', { class: 'insp-sub' });
    strip.appendChild(h('div', { class: 'paint-strip-label' }, [h('strong', { text: 'Piso' }), S.el.paintName]));
    const row = h('div', { class: 'paint-swatches' });
    mats.forEach((m) => {
      const btn = h('button', {
        type: 'button',
        class: 'paint-swatch',
        'data-mat': m.id,
        'aria-label': m.name,
        'aria-pressed': 'false',
        'data-tip': m.name,
        onclick: () => setUI({ paintMaterial: m.id }),
      });
      row.appendChild(lazySwatch(btn, m.id, 72));
    });
    strip.appendChild(row);
    S.paintBuilt = true;
  }
  function syncPaintStrip(u) {
    const strip = document.getElementById('paint-strip');
    const on = u.tool === 'paint';
    strip.hidden = !on;
    if (!on) return;
    if (!S.paintBuilt) renderPaintStrip();
    $$('.paint-swatch', strip).forEach((b) => setPressed(b, b.getAttribute('data-mat') === u.paintMaterial));
    if (S.el.paintName) setText(S.el.paintName, materialOf(u.paintMaterial).name);
  }

  // =================================================================== 3D overlay
  function renderOverlay() {
    const ov = document.getElementById('view3d-overlay');
    S.el.overlay = ov;
    ov.textContent = '';
    const seg = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Modo de câmera' },
      CAM_MODES.map((m) =>
        h('button', { type: 'button', 'data-cam': m.id, 'aria-pressed': 'false', 'aria-label': m.label, 'data-tip': m.label, onclick: () => setCameraMode(m.id) }, [
          icon(m.icon),
          h('span', { class: 'btn-label', text: m.label }),
        ])
      )
    );
    S.el.floorsChip = h(
      'button',
      {
        type: 'button',
        class: 'chip',
        'aria-pressed': 'false',
        'aria-label': 'Pavimentos superiores',
        'data-tip': 'Mostrar os pavimentos acima do atual e a cobertura',
        onclick: () => setUI({ showAllFloors: !ui().showAllFloors }),
      },
      [icon('layers'), h('span', { class: 'btn-label', text: 'Pavimentos superiores' })]
    );
    const recenter = h('button', { type: 'button', class: 'btn', 'aria-label': 'Recentralizar câmera', 'data-tip': 'Voltar a câmera para o pavimento ativo', onclick: recenter3D }, [
      icon('recenter'),
      h('span', { class: 'btn-label', text: 'Recentralizar' }),
    ]);
    ov.appendChild(h('div', { class: 'o3d-bar' }, [seg, S.el.floorsChip, recenter]));
    S.el.overlayHint = h('div', { class: 'o3d-hint', 'aria-live': 'polite' });
    ov.appendChild(S.el.overlayHint);
  }
  /** view3d owns #view3d; re-attach our overlay if its init replaced the container's children. */
  function ensureOverlayAttached() {
    const ov = S.el.overlay;
    const host = document.getElementById('view3d');
    if (ov && host && !host.contains(ov)) host.appendChild(ov);
  }
  function syncOverlay(u) {
    if (!S.el.overlay) return;
    $$('[data-cam]', S.el.overlay).forEach((b) => setPressed(b, b.getAttribute('data-cam') === u.cam3d));
    setPressed(S.el.floorsChip, !!u.showAllFloors);
    const mode = CAM_MODES.find((m) => m.id === u.cam3d) || CAM_MODES[0];
    setText(S.el.overlayHint, mode.hint);
  }
  function setCameraMode(mode) {
    flushNudge();
    call('view3d', 'setCameraMode', mode);
    if (ui().cam3d !== mode) setUI({ cam3d: mode });
  }
  function recenter3D() {
    const fn = ['recenter', 'resetCamera', 'fitCamera'].find((name) => hasFn('view3d', name));
    if (fn) call('view3d', fn);
    else call('view3d', 'setCameraMode', ui().cam3d);
  }

  // =================================================================== inspector: building blocks
  function section(label, children, cls) {
    return h('section', { class: 'insp-section' + (cls ? ' ' + cls : '') }, [label ? h('h3', { class: 'section-label', text: label }) : null].concat(children));
  }
  function propList(rows) {
    const dl = h('dl', { class: 'props' });
    const cells = {};
    rows.forEach(([key, label]) => {
      const dt = h('dt', { text: label });
      const dd = h('dd');
      cells[key] = { dt, dd };
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    return {
      el: dl,
      set(key, text, cls) {
        const c = cells[key];
        if (!c) return;
        setText(c.dd, text);
        c.dd.className = cls || '';
      },
      show(key, visible) {
        const c = cells[key];
        if (!c) return;
        c.dt.hidden = !visible;
        c.dd.hidden = !visible;
      },
    };
  }
  /**
   * Inspector input bound to the current item. Commits on change / Enter, reverts on Esc or invalid input,
   * and is refreshed by sync() without clobbering what the user is typing.
   */
  function inputField(opts) {
    const input = h('input', {
      class: 'field-input ' + (opts.text ? 'is-text' : 'num'),
      type: 'text',
      inputmode: opts.text ? null : 'decimal',
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: opts.maxLength || null,
      'aria-label': opts.aria || opts.label,
      title: opts.aria || null,
    });
    const el = h('label', { class: 'field' }, [
      h('span', { class: 'field-label', text: opts.label, 'aria-hidden': 'true' }),
      h('span', { class: 'field-control' }, [input, opts.unit ? h('span', { class: 'field-unit', text: opts.unit, 'aria-hidden': 'true' }) : null]),
    ]);
    let shown = '';
    const attempt = () => {
      if (input.value.trim() === shown) {
        input.value = shown;
        return;
      }
      if (!opts.commit(input.value)) {
        flagInvalid(input);
        input.value = shown;
      }
    };
    input.addEventListener('change', attempt);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        attempt();
        input.value = shown;
        input.select();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        input.value = shown;
        input.blur();
      }
    });
    input.addEventListener('focus', () => requestAnimationFrame(() => document.activeElement === input && input.select()));
    input.addEventListener('blur', () => {
      input.value = shown;
    });
    return {
      el,
      input,
      sync(item) {
        shown = opts.read(item);
        if (document.activeElement !== input) input.value = shown;
      },
      setDisabled(disabled) {
        input.disabled = !!disabled;
      },
    };
  }
  function heroBlock(media, title, sub) {
    return h('div', { class: 'insp-hero' }, [media, h('div', { class: 'insp-hero-text' }, [title, sub])]);
  }
  function kindBadge(kind) {
    const info = WALL_KIND[kind] || WALL_KIND.structural;
    const legend = LEGEND.find((l) => l.kind === kind);
    return h('span', { class: 'badge' }, [
      legend ? legendSVG(legend, 'bd-', 'badge-swatch') : null,
      info.locked ? icon('lock', 'ic-sm') : null,
      info.label,
    ]);
  }
  /** Legend swatch as a real SVG element; `idPrefix` keeps pattern ids unique when several are on screen. */
  function legendSVG(item, idPrefix, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 40 14');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    svg.innerHTML = idPrefix ? item.svg.replace(/lg-/g, idPrefix) : item.svg;
    return svg;
  }

  // =================================================================== inspector: panels
  function buildOverviewPanel() {
    const el = h('div', { class: 'insp-panel' });
    let last = null;
    return {
      el,
      sync(d, u) {
        const key = [d.walls, d.roomSeeds, d.separators, d.floors, d.furniture, u.floor];
        if (last && key.every((v, i) => v === last[i])) return;
        last = key;
        el.textContent = '';
        renderOverview(el, d, u);
      },
    };
  }
  function renderOverview(el, d, u) {
    const floor = floorOf(d, u.floor) || d.floors[0];
    let total = 0;
    const floorRows = d.floors.map((f) => {
      const area = floorArea(d, f.id);
      total += area;
      return h('li', null, [
        h('button', { type: 'button', class: 'list-row' + (f.id === u.floor ? ' is-active' : ''), onclick: () => setFloor(f.id) }, [
          icon('layers', 'ic-sm'),
          h('span', { class: 'list-name', text: f.name }),
          h('span', { class: 'list-meta num', text: fmtArea(area) }),
        ]),
      ]);
    });
    el.appendChild(
      section('Pavimentos', [
        h('ul', { class: 'list' }, floorRows),
        h('div', { class: 'totals' }, [h('span', { class: 'insp-sub', text: 'Área útil total (ambientes)' }), h('strong', { text: fmtArea(total) })]),
      ])
    );
    el.appendChild(section(`Ambientes — ${floor ? floor.name : ''}`, [roomList(d, floor)]));
    el.appendChild(section('Legenda', [legendBlock()]));
  }
  function roomList(d, floor) {
    if (!floor) return h('p', { class: 'list-empty', text: 'Nenhum pavimento.' });
    const rooms = safeRooms(d, floor.id)
      .slice()
      .sort((a, b) => b.area - a.area);
    const count = d.furniture.filter((f) => f.floor === floor.id).length;
    const rows = rooms.map((r) => {
      return h('li', null, [
        h('button', { type: 'button', class: 'list-row', onclick: () => select('room', r.id, true) }, [
          lazySwatch(h('span', { class: 'list-mat', 'aria-hidden': 'true', title: materialOf(r.material).name }), r.material, 32),
          h('span', { class: 'list-name', text: r.name + (r.outdoor ? ' · externo' : '') }),
          h('span', { class: 'list-meta num', text: r.open ? 'aberto' : fmtArea(r.area) }),
        ]),
      ]);
    });
    return h('div', null, [
      rows.length ? h('ul', { class: 'list' }, rows) : h('p', { class: 'list-empty', text: 'Nenhum ambiente detectado.' }),
      h('div', { class: 'totals' }, [
        h('span', { class: 'insp-sub', text: `${count} ${count === 1 ? 'móvel' : 'móveis'} neste pavimento` }),
        h('strong', { text: fmtArea(floorArea(d, floor.id)) }),
      ]),
    ]);
  }
  function legendBlock() {
    const rows = LEGEND.map((item) => h('div', { class: 'legend-row' }, [legendSVG(item), h('span', { text: item.label })]));
    return h('div', null, [
      h('div', { class: 'legend' }, rows),
      h('p', {
        class: 'legend-note',
        text: 'A estrutura foi inferida da planta aprovada: fachadas, divisas e paredes que se repetem no pavimento de cima são tratadas como estruturais.',
      }),
    ]);
  }

  function buildFurniturePanel(item) {
    const id = item.id;
    const thumb = h('img', { alt: '', src: thumbURL(item.type) });
    const title = h('h3', { class: 'insp-title' });
    const sub = h('span', { class: 'insp-sub num' });
    const field = (key, label, unit, aria, read) => inputField({ label, unit, aria, read, commit: (raw) => editFurniture(id, key, raw) });
    const fields = [
      field('w', 'L', 'mm', 'Largura (mm)', (it) => String(Math.round(it.w))),
      field('d', 'P', 'mm', 'Profundidade (mm)', (it) => String(Math.round(it.d))),
      field('h', 'A', 'mm', 'Altura (mm)', (it) => String(Math.round(it.h))),
      field('rot', 'Rotação', '°', 'Rotação (graus, horário)', (it) => fmtDeg(it.rot || 0)),
      field('x', 'X', 'm', 'Posição X (m)', (it) => fmtM(it.x)),
      field('y', 'Y', 'm', 'Posição Y (m)', (it) => fmtM(it.y)),
      field('elev', 'Elevação', 'mm', 'Elevação do piso (mm)', (it) => String(Math.round(it.elev || 0))),
    ];
    const [fw, fd, fh, frot, fx, fy, fe] = fields;
    const colors = colorPicker(id);
    const el = h('div', { class: 'insp-panel' }, [
      section(null, [heroBlock(h('div', { class: 'insp-hero-thumb' }, [thumb]), title, sub)]),
      section('Dimensões', [h('div', { class: 'fields fields-3' }, [fw.el, fd.el, fh.el])]),
      section('Posição', [
        h('div', { class: 'rot-row' }, [
          frot.el,
          iconButton('rotateCcw', 'Girar 90° anti-horário', () => rotateFurniture(id, -90), 'Shift+R'),
          iconButton('rotateCw', 'Girar 90° horário', () => rotateFurniture(id, 90), 'R'),
        ]),
        h('div', { class: 'fields fields-3', style: { marginTop: '8px' } }, [fx.el, fy.el, fe.el]),
      ]),
      section('Cor', [colors.el]),
      section(null, [
        h('div', { class: 'btn-row' }, [
          textButton('duplicate', 'Duplicar', () => duplicateFurniture(id)),
          textButton('trash', 'Excluir', () => removeFurniture(id), 'btn-danger'),
        ]),
      ]),
    ]);
    return {
      el,
      sync(d, u, it) {
        const def = typeDef(it.type);
        setText(title, furnitureName(it));
        setText(sub, [def ? categoryName(def.category) : '', `${fmtM(it.w)} × ${fmtM(it.d)} × ${fmtM(it.h)} m`].filter(Boolean).join(' · '));
        fields.forEach((f) => f.sync(it));
        colors.sync(it);
      },
    };
  }
  function colorPicker(id) {
    const swatches = COLOR_SWATCHES.map((s) =>
      h('button', { type: 'button', class: 'swatch', style: { background: s.hex }, 'data-color': s.hex, 'aria-label': s.name, 'aria-pressed': 'false', 'data-tip': s.name, onclick: () => setFurnitureColor(id, s.hex) })
    );
    const native = h('input', { type: 'color', 'aria-label': 'Escolher outra cor' });
    native.addEventListener('change', () => setFurnitureColor(id, native.value));
    const picker = h('label', { class: 'swatch-picker', 'data-tip': 'Outra cor…' }, [icon('plus'), native]);
    const reset = h('button', { type: 'button', class: 'swatch-default', 'aria-pressed': 'false', 'data-tip': 'Cor original do catálogo', onclick: () => setFurnitureColor(id, null) }, ['Padrão']);
    const el = h('div', { class: 'swatches' }, swatches.concat([picker, reset]));
    return {
      el,
      sync(it) {
        const c = normHex(it.color);
        let matched = false;
        swatches.forEach((b) => {
          const on = c === b.getAttribute('data-color');
          matched = matched || on;
          setPressed(b, on);
        });
        setPressed(reset, !c);
        const custom = !!c && !matched;
        picker.classList.toggle('is-custom', custom);
        picker.style.background = custom ? c : '';
        const def = typeDef(it.type);
        if (document.activeElement !== native) native.value = (c || normHex(def && def.color) || '#888888').toLowerCase();
      },
    };
  }

  function buildWallPanel(wall) {
    const id = wall.id;
    const title = h('h3', { class: 'insp-title', text: 'Parede' });
    const badgeSlot = h('span', { class: 'insp-sub' });
    const props = propList([
      ['len', 'Comprimento'],
      ['thick', 'Espessura'],
      ['height', 'Altura'],
      ['floor', 'Pavimento'],
    ]);
    const thick = inputField({ label: 'Espessura', unit: 'mm', aria: 'Espessura da parede (mm)', read: (w) => String(Math.round(w.thick)), commit: (raw) => editWallThickness(id, raw) });
    const openList = h('ul', { class: 'list' });
    const note = h('p', { class: 'insp-note is-locked' });
    const actions = [
      textButton('demolish', 'Demolir', () => demolishWall(id), 'btn-danger'),
      textButton('door', 'Adicionar porta (P2)', () => addOpeningTo(id, 'P2')),
      textButton('window', 'Adicionar janela (J6)', () => addOpeningTo(id, 'J6')),
    ];
    const el = h('div', { class: 'insp-panel' }, [
      section(null, [heroBlock(h('div', { class: 'insp-hero-code' }, [icon('wall')]), title, badgeSlot)]),
      section('Medidas', [props.el, h('div', { style: { marginTop: '10px' } }, [thick.el])]),
      section('Aberturas', [openList]),
      section('Ações', [h('div', { class: 'btn-row' }, actions), note]),
    ]);
    let openingsSig = null;
    return {
      el,
      sync(d, u, w) {
        const editable = DD.ops.isEditableWall(w);
        const info = WALL_KIND[w.kind] || WALL_KIND.structural;
        const f = floorOf(d, w.floor);
        badgeSlot.textContent = '';
        badgeSlot.appendChild(kindBadge(w.kind));
        props.set('len', fmtM(wallLength(w)) + ' m');
        props.set('thick', fmtInt(w.thick) + ' mm');
        props.show('thick', !editable);
        props.set('height', fmtM(w.height) + ' m');
        props.set('floor', f ? f.name : w.floor);
        thick.el.hidden = !editable;
        thick.sync(w);
        actions.forEach((b) => {
          b.disabled = !editable;
        });
        note.hidden = editable;
        setText(note, info.note);
        const ops = openingsOfWall(d, w.id);
        const sig = ops.map((o) => [o.id, o.code, o.width, o.style].join(':')).join('|');
        if (sig !== openingsSig) renderOpeningList(openList, ops);
        openingsSig = sig;
      },
    };
  }
  function renderOpeningList(list, ops) {
    list.textContent = '';
    if (!ops.length) {
      list.appendChild(h('li', { class: 'list-empty', text: 'Sem portas ou janelas nesta parede.' }));
      return;
    }
    ops.forEach((o) => {
      const spec = DD.data.SCHEDULE[o.code];
      list.appendChild(
        h('li', null, [
          h('button', { type: 'button', class: 'list-row', onclick: () => select('opening', o.id, true) }, [
            h('span', { class: 'list-code', text: o.code }),
            h('span', { class: 'list-name', text: spec ? (o.type === 'door' ? 'Porta' : 'Janela') + ' · ' + (STYLE_LABELS[o.style] || o.style) : o.style }),
            h('span', { class: 'list-meta num', text: fmtM(o.width) + ' m' }),
          ]),
        ])
      );
    });
  }

  function buildOpeningPanel(op) {
    const id = op.id;
    const code = h('div', { class: 'insp-hero-code' });
    const title = h('h3', { class: 'insp-title' });
    const sub = h('span', { class: 'insp-sub' });
    const props = propList([
      ['size', 'Largura × altura'],
      ['sill', 'Peitoril'],
      ['style', 'Tipo'],
      ['wall', 'Parede'],
    ]);
    const width = inputField({ label: 'Largura', unit: 'mm', aria: 'Largura da abertura (mm)', read: (o) => String(Math.round(o.width)), commit: (raw) => editOpeningWidth(id, raw) });
    const btnSide = textButton('flip', 'Inverter lado', () => flipOpening(id, 'side'));
    const btnHinge = textButton('hinge', 'Inverter dobradiça', () => flipOpening(id, 'hinge'));
    const btnWall = textButton('wall', 'Selecionar parede', () => {
      const o = DD.ops.byId(doc(), 'openings', id);
      if (o) select('wall', o.wall, true);
    }, 'btn-ghost btn-sm');
    const btnRemove = textButton('trash', 'Remover', () => removeOpening(id), 'btn-danger');
    const note = h('p', { class: 'insp-note is-locked', text: 'Abertura em parede estrutural: posição e dimensões seguem o projeto aprovado.' });
    const widthWrap = h('div', { style: { marginTop: '10px' } }, [width.el]);
    const el = h('div', { class: 'insp-panel' }, [
      section(null, [heroBlock(code, title, sub)]),
      section('Especificação', [props.el, widthWrap, h('div', { style: { marginTop: '8px' } }, [btnWall])]),
      section('Ações', [h('div', { class: 'btn-row' }, [btnSide, btnHinge]), h('div', { class: 'btn-row', style: { marginTop: '6px' } }, [btnRemove]), note]),
    ]);
    return {
      el,
      sync(d, u, o) {
        const wall = DD.ops.byId(d, 'walls', o.wall);
        const editable = !!wall && DD.ops.isEditableWall(wall);
        const spec = DD.data.SCHEDULE[o.code];
        setText(code, o.code);
        setText(title, (o.type === 'door' ? 'Porta ' : 'Janela ') + o.code);
        setText(sub, spec ? spec.desc : '');
        props.set('size', `${fmtM(o.width)} × ${fmtM(o.height)} m`);
        props.set('sill', o.sill ? fmtM(o.sill) + ' m' : '—');
        props.set('style', STYLE_LABELS[o.style] || o.style);
        props.set('wall', wall ? (WALL_KIND[wall.kind] || WALL_KIND.structural).label : '—');
        widthWrap.hidden = !editable;
        width.sync(o);
        btnRemove.hidden = !editable;
        note.hidden = editable;
      },
    };
  }

  function buildRoomPanel(room) {
    const roomId = room.id;
    const name = inputField({ label: 'Nome', text: true, maxLength: LIMITS.roomName, aria: 'Nome do ambiente', read: (r) => r.name, commit: (raw) => renameRoom(roomId, raw) });
    const props = propList([
      ['area', 'Área'],
      ['plan', 'Área na planta aprovada'],
      ['perim', 'Perímetro'],
      ['floorMat', 'Piso atual'],
      ['floor', 'Pavimento'],
    ]);
    const matBox = h('div');
    const tiles = renderMaterialGrid(matBox, (matId) => setRoomMaterial(roomId, matId));
    const openNote = h('p', { class: 'insp-note', text: 'Ambiente aberto (sem fechamento completo de paredes) — a área não é calculada.' });
    const el = h('div', { class: 'insp-panel' }, [
      section(null, [h('div', { class: 'fields' }, [name.el])]),
      section('Medidas', [props.el, openNote]),
      section('Revestimento de piso', [matBox]),
    ]);
    return {
      el,
      sync(d, u, r) {
        name.sync(r);
        const f = floorOf(d, r.floor);
        props.set('area', r.open ? '—' : fmtArea(r.area));
        const hasPlan = r.planArea != null && !r.open;
        props.show('plan', hasPlan);
        if (hasPlan) {
          const same = Math.abs(r.area - r.planArea) < 0.01;
          props.set('plan', fmtArea(r.planArea) + (same ? ' ✓' : ''), same ? 'delta-ok' : 'delta-off');
        }
        props.set('perim', r.open ? '—' : fmtM(r.perimeter) + ' m');
        props.set('floorMat', materialOf(r.material).name);
        props.set('floor', f ? f.name : r.floor);
        openNote.hidden = !r.open;
        tiles.forEach((t) => setPressed(t, t.getAttribute('data-mat') === r.material));
      },
    };
  }
  function renderMaterialGrid(box, onPick) {
    const mats = roomMaterials();
    if (!mats.length) {
      box.appendChild(h('p', { class: 'list-empty', text: 'Revestimentos indisponíveis.' }));
      return [];
    }
    const groups = [];
    mats.forEach((m) => {
      const g = groups.find((x) => x.name === (m.group || 'Outros'));
      if (g) g.items.push(m);
      else groups.push({ name: m.group || 'Outros', items: [m] });
    });
    const tiles = [];
    groups.forEach((g) => {
      const grid = h('div', { class: 'mat-grid' });
      g.items.forEach((m) => {
        const tile = h('button', { type: 'button', class: 'mat-tile', 'data-mat': m.id, 'aria-pressed': 'false', 'aria-label': m.name, 'data-tip': m.name, onclick: () => onPick(m.id) }, [
          lazySwatch(h('span', { class: 'mat-img' }), m.id, 96),
          h('span', { text: m.name }),
        ]);
        tiles.push(tile);
        grid.appendChild(tile);
      });
      box.appendChild(h('div', { class: 'mat-group' }, [h('h4', { class: 'mat-group-title', text: g.name }), grid]));
    });
    return tiles;
  }

  function buildMeasurePanel(m) {
    const id = m.id;
    const props = propList([
      ['len', 'Comprimento'],
      ['dx', 'Δx'],
      ['dy', 'Δy'],
    ]);
    const title = h('h3', { class: 'insp-title num' });
    const el = h('div', { class: 'insp-panel' }, [
      section(null, [heroBlock(h('div', { class: 'insp-hero-code' }, [icon('measure')]), title, h('span', { class: 'insp-sub', text: 'Medida livre' }))]),
      section('Medidas', [props.el]),
      section(null, [h('div', { class: 'btn-row' }, [textButton('trash', 'Excluir medida', () => removeMeasure(id), 'btn-danger')])]),
    ]);
    return {
      el,
      sync(d, u, it) {
        const len = Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y);
        setText(title, fmtM(len) + ' m');
        props.set('len', fmtM(len) + ' m');
        props.set('dx', fmtM(Math.abs(it.b.x - it.a.x)) + ' m');
        props.set('dy', fmtM(Math.abs(it.b.y - it.a.y)) + ' m');
      },
    };
  }

  const PANEL_BUILDERS = {
    overview: buildOverviewPanel,
    furniture: buildFurniturePanel,
    wall: buildWallPanel,
    opening: buildOpeningPanel,
    room: buildRoomPanel,
    measure: buildMeasurePanel,
  };

  // =================================================================== inspector: mounting & sync
  function errorPanel() {
    const el = h('div', { class: 'insp-panel' }, [section(null, [h('p', { class: 'insp-note', text: 'Não foi possível exibir as propriedades deste item.' })])]);
    return { el, sync() {} };
  }
  function refreshInspector() {
    if (!S.el.inspBody) return;
    const d = doc();
    const u = ui();
    const target = resolveSelection(d, u);
    if (u.selection && !target) scheduleStaleSelectionCheck();
    const kind = target ? target.kind : 'overview';
    const key = target ? kind + ':' + target.item.id : 'overview';
    if (key !== S.inspKey || !S.panel) mountPanel(kind, key, target);
    try {
      S.panel.sync(d, u, target && target.item);
    } catch (err) {
      console.error('[ui] inspector sync', err);
    }
    syncInspectorHead(kind, target);
  }
  function mountPanel(kind, key, target) {
    let panel;
    try {
      panel = PANEL_BUILDERS[kind](target ? target.item : null);
    } catch (err) {
      console.error('[ui] inspector build', kind, err);
      panel = errorPanel();
    }
    S.inspKey = key;
    S.panel = panel;
    S.el.inspBody.textContent = '';
    S.el.inspBody.appendChild(panel.el);
    S.el.inspBody.scrollTop = 0;
  }
  function syncInspectorHead(kind, target) {
    let title = PANEL_TITLES[kind] || 'Projeto';
    if (kind === 'opening' && target) title = target.item.type === 'door' ? 'Porta' : 'Janela';
    setText(document.getElementById('inspector-title'), title);
    const clear = document.getElementById('btn-clear-selection');
    if (clear) clear.hidden = !target;
    const dot = $('#btn-drawer-insp .dot');
    if (dot) dot.hidden = !target;
  }
  /** Coalesce inspector refreshes during drags (transient previews) to one per frame. */
  function scheduleInspector() {
    if (S.inspRaf) return;
    S.inspRaf = requestAnimationFrame(() => {
      S.inspRaf = 0;
      refreshInspector();
    });
  }
  function scheduleStaleSelectionCheck() {
    if (S.staleTimer) return;
    S.staleTimer = setTimeout(() => {
      S.staleTimer = 0;
      const u = ui();
      if (u.selection && !resolveSelection(doc(), u)) setUI({ selection: null });
    }, 0);
  }

  // =================================================================== status bar
  function initStatusbar() {
    document.getElementById('btn-zoom-in').addEventListener('click', () => call('plan2d', 'zoomBy', ZOOM_STEP));
    document.getElementById('btn-zoom-out').addEventListener('click', () => call('plan2d', 'zoomBy', 1 / ZOOM_STEP));
    document.getElementById('btn-fit').addEventListener('click', () => call('plan2d', 'fit'));
    document.getElementById('tg-snap').addEventListener('click', () => setUI({ snap: !ui().snap }));
    [
      ['tg-grid', 'grid'],
      ['tg-dims', 'dims'],
      ['tg-labels', 'labels'],
    ].forEach(([elId, key]) => document.getElementById(elId).addEventListener('click', () => toggleShow(key)));
    DD.events.on('plan2d:cursor', onCursor);
    DD.events.on('plan2d:viewport', syncZoom);
    DD.events.on('saved', (p) => setSaveState('saved', p && p.at));
    DD.events.on('doc:committed', () => setSaveState('pending'));
  }
  function onCursor(p) {
    const pt = p && (p.world || p);
    S.cursorPoint = pt && isFinite(pt.x) && isFinite(pt.y) ? { x: pt.x, y: pt.y } : null;
    if (S.cursorRaf) return;
    S.cursorRaf = requestAnimationFrame(() => {
      S.cursorRaf = 0;
      setText(document.getElementById('status-coords'), formatCursor(S.cursorPoint));
    });
  }
  function syncZoom() {
    const vp = call('plan2d', 'getViewport');
    const pct = vp ? zoomPercent(vp.scale) : null;
    setText(document.getElementById('status-zoom'), pct == null ? '—' : pct + '%');
  }
  function syncStatus(u) {
    const tool = TOOL_BY_ID[u.tool] || TOOLS[0];
    const toolEl = document.getElementById('status-tool');
    if (toolEl.getAttribute('data-tool') !== tool.id) {
      toolEl.setAttribute('data-tool', tool.id);
      toolEl.textContent = '';
      toolEl.appendChild(icon(tool.icon));
      toolEl.appendChild(document.createTextNode(' ' + (tool.id === 'pan' ? 'Mover a vista' : tool.label)));
    }
    setText(document.getElementById('status-hint'), tool.hint);
    const show = u.show || {};
    setPressed(document.getElementById('tg-snap'), !!u.snap);
    setPressed(document.getElementById('tg-grid'), !!show.grid);
    setPressed(document.getElementById('tg-dims'), !!show.dims);
    setPressed(document.getElementById('tg-labels'), !!show.labels);
  }
  function setSaveState(state, at) {
    const box = document.getElementById('save-state');
    const txt = document.getElementById('save-text');
    if (!box || !txt) return;
    clearTimeout(S.saveTimer);
    box.setAttribute('data-state', state);
    if (state === 'saved') setText(txt, 'Salvo ' + fmtTime(at || new Date()));
    else if (state === 'unsaved') setText(txt, 'Alterações não salvas');
    else if (state === 'pending') {
      setText(txt, 'Salvando…');
      S.saveTimer = setTimeout(() => setSaveState('unsaved'), SAVE_STALL_MS);
    }
  }

  // =================================================================== drawers (narrow layouts) & library column
  function initDrawers() {
    document.getElementById('btn-drawer-lib').addEventListener('click', () => toggleDrawer('library'));
    document.getElementById('btn-drawer-insp').addEventListener('click', () => toggleDrawer('inspector'));
    document.getElementById('scrim').addEventListener('click', () => closeDrawer(false));
    $$('[data-close-drawer]').forEach((b) => b.addEventListener('click', () => closeDrawer(true)));
    document.getElementById('btn-clear-selection').addEventListener('click', () => select(null));
    if (window.matchMedia) {
      const mq = window.matchMedia(NARROW_MQ);
      const onChange = () => {
        if (!mq.matches) closeDrawer(false);
        syncLibraryToggle();
        scheduleLayout();
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }
  function toggleLibrary() {
    if (isNarrow()) toggleDrawer('library');
    else {
      document.getElementById('workspace').classList.toggle('lib-collapsed');
      syncLibraryToggle();
      trackLayout(LAYOUT_ANIM_MS + 60);
    }
  }
  function syncLibraryToggle() {
    const open = isNarrow() ? S.drawer === 'library' : !document.getElementById('workspace').classList.contains('lib-collapsed');
    setPressed(S.el.libToggle, open);
  }
  function toggleDrawer(name) {
    if (S.drawer === name) closeDrawer(true);
    else openDrawer(name);
  }
  function openDrawer(name) {
    closeAllMenus();
    S.drawerReturn = document.activeElement;
    S.drawer = name;
    applyDrawers();
    const panel = document.getElementById(name);
    requestAnimationFrame(() => {
      const target = name === 'library' ? document.getElementById('lib-search') : focusables(panel)[0];
      if (target && S.drawer === name) target.focus({ preventScroll: true });
    });
  }
  function closeDrawer(returnFocus) {
    if (!S.drawer) return;
    S.drawer = null;
    applyDrawers();
    const back = S.drawerReturn;
    S.drawerReturn = null;
    if (returnFocus && back && typeof back.focus === 'function' && document.body.contains(back)) back.focus();
  }
  function applyDrawers() {
    const lib = S.drawer === 'library';
    const insp = S.drawer === 'inspector';
    document.getElementById('library').classList.toggle('is-open', lib);
    document.getElementById('inspector').classList.toggle('is-open', insp);
    document.getElementById('scrim').hidden = !S.drawer;
    document.getElementById('btn-drawer-lib').setAttribute('aria-expanded', lib ? 'true' : 'false');
    document.getElementById('btn-drawer-insp').setAttribute('aria-expanded', insp ? 'true' : 'false');
    syncLibraryToggle();
  }

  // =================================================================== keyboard
  function initKeyboard() {
    document.addEventListener('keydown', onKeyDown);
  }
  function onKeyDown(e) {
    if (e.defaultPrevented || document.pointerLockElement || isModalOpen() || S.openMenu) return;
    if (e.key === 'Escape' && S.drawer) {
      e.preventDefault();
      closeDrawer(true);
      return;
    }
    if (isTypingTarget(e.target)) return;
    const u = ui();
    const action = keyToAction(e, { walkMode: u.cam3d === 'walk' && u.view !== '2d' });
    if (!action) return;
    e.preventDefault();
    if (e.repeat && !REPEATABLE_ACTIONS[action.type]) return;
    runAction(action);
  }
  function runAction(a) {
    const fid = () => selectedFurnitureId();
    const handlers = {
      tool: () => setTool(a.tool),
      undo: doUndo,
      redo: doRedo,
      save: saveNow,
      duplicate: () => fid() && duplicateFurniture(fid()),
      escape: escapeAction,
      delete: deleteSelection,
      shortcuts: openShortcuts,
      rotate: () => fid() && rotateFurniture(fid(), a.delta),
      view: () => setView(nextView(ui().view, a.mode)),
      floor: () => {
        const f = doc().floors[a.index];
        if (f) setFloor(f.id);
      },
      fit: () => call('plan2d', 'fit'),
      zoom: () => call('plan2d', 'zoomBy', a.factor),
      grid: () => toggleShow('grid'),
      nudge: () => nudgeSelection(a.dx, a.dy),
    };
    const fn = handlers[a.type];
    if (fn) fn();
  }

  // =================================================================== store subscriptions
  function onDocChange(d, prev, info) {
    if (info && info.transient) {
      scheduleInspector();
      return;
    }
    if (d.floors !== prev.floors) renderFloorTabs();
    else if (d.walls !== prev.walls || d.roomSeeds !== prev.roomSeeds || d.separators !== prev.separators) updateFloorAreas();
    if (d.meta !== prev.meta) syncProjectName();
    syncHistory();
    refreshInspector();
  }
  function onUIChange(u, prev) {
    if (S.ready && u.view !== S.appliedView) setView(u.view);
    if (u.floor !== prev.floor) syncFloorTabs();
    if (u.tool !== prev.tool || u.snap !== prev.snap || u.show !== prev.show) syncStatus(u);
    if (u.tool !== prev.tool) syncToolRail(u);
    if (u.tool !== prev.tool || u.paintMaterial !== prev.paintMaterial) syncPaintStrip(u);
    if (u.cam3d !== prev.cam3d || u.showAllFloors !== prev.showAllFloors) syncOverlay(u);
    if (u.selection !== prev.selection || u.floor !== prev.floor) refreshInspector();
  }

  // =================================================================== lifecycle
  /** Bind the DOM from shell.html. Must run before plan2d/view3d init (it does not call them). */
  function init() {
    if (S.initialized) return;
    if (!DD.store) {
      console.error('[ui] DD.store ausente — a interface não pode ser iniciada.');
      return;
    }
    S.initialized = true;
    hydrateIcons(document);
    S.el.inspBody = document.getElementById('inspector-body');
    initTooltips();
    initTopbar();
    renderToolRail();
    renderFloorTabs();
    initStage();
    renderOverlay();
    initLibrary();
    initStatusbar();
    initDrawers();
    renderShortcuts();
    $$('dialog.dialog').forEach(initDialog);
    initKeyboard();
    DD.events.on('toast', (p) => p && showToast(p.msg, p.kind));
    DD.store.subscribe(onDocChange);
    DD.store.subscribeUI(onUIChange);
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      if (mq.addEventListener) mq.addEventListener('change', syncThemeLabel);
    }
    const u = ui();
    S.el.stage.setAttribute('data-view', u.view);
    syncViewToggle(u.view);
    syncProjectName();
    syncHistory();
    syncToolRail(u);
    syncStatus(u);
    syncOverlay(u);
    syncPaintStrip(u);
    syncThemeLabel();
    syncLibraryToggle();
    refreshInspector();
  }
  /** Called by boot after plan2d/view3d init: apply the initial view and pull state from the other modules. */
  function ready() {
    if (!S.initialized) init();
    if (!S.initialized || S.ready) return;
    S.ready = true;
    ensureOverlayAttached();
    setSplit(S.split);
    const view = ui().view;
    S.appliedView = view;
    applyViewInstant(view);
    syncZoom();
    call('materials', 'prewarm');
    S.inspKey = null; // rebuild so thumbnails/material swatches from late modules show up
    refreshInspector();
  }

  DD.ui = {
    init,
    ready,
    setView,
    showToast,
    /** Pure helpers, exposed for tests (tools/test-ui.js). */
    util: {
      parseDecimal,
      parseMM,
      parseMeters,
      parseDegrees,
      furnitureEdit,
      thicknessEdit,
      openingWidthEdit,
      findFreeT,
      slug,
      floorTabLabel,
      formatCursor,
      zoomPercent,
      fmtTime,
      normHex,
      isTypingTarget,
      nudgeDelta,
      keyToAction,
      nextView,
      LIMITS,
    },
  };
})();
