// ===== 12-furniture3d.js — procedural low-poly 3D furniture models (three.js, metres) =====
// DD.furniture3d.build(THREE, item) → THREE.Group
//   local +X = width (item.w), +Z = depth (item.d) with the BACK at z = -d/2, +Y up, origin = bottom-centre.
// Builders record parts against cached template geometries; at the end the parts are baked and merged per
// material, so an item costs only a handful of draw calls. Materials are cached per (kind, colour) and SHARED
// between items (material.userData.shared = true): never mutate them — clone first for per-item effects.
(function () {
  'use strict';
  const DD = (window.DD = window.DD || {});

  // ------------------------------------------------------------------ constants
  const MM = 0.001;
  const PI = Math.PI;
  const HALF_PI = PI / 2;
  const GOLDEN_ANGLE = PI * (3 - Math.sqrt(5));
  const MIN_DIM = 0.005; // m — smallest accepted item dimension (rugs are 10 mm thick)
  const MAX_DIM = 50; // m
  const MIN_PART = 0.0005; // m — smallest part dimension (avoids degenerate matrices)
  const MAX_TEMPLATES = 600; // bounded LRU of template geometries (per three.js instance)
  const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  const FRONT_T = 0.018; // door / drawer front thickness
  const FRONT_GAP = 0.003; // reveal between fronts

  // Default sizes (mm) and colours — mirrors the catalog; used when DD.catalog is unavailable or incomplete.
  const FALLBACK_TYPES = {
    sofa3: { w: 2100, d: 900, h: 850, color: '#8E8A80' },
    sofa2: { w: 1600, d: 880, h: 850, color: '#8E8A80' },
    sofaL: { w: 2700, d: 1650, h: 850, color: '#A7A095' },
    armchair: { w: 800, d: 820, h: 900, color: '#C27A4A' },
    coffeeTable: { w: 1100, d: 600, h: 400, color: '#7A5A3C' },
    sideTable: { w: 450, d: 450, h: 550, color: '#7A5A3C' },
    tvUnit: { w: 1800, d: 450, h: 1350, color: '#5A4636' },
    bookshelf: { w: 1200, d: 350, h: 2000, color: '#6B5641' },
    floorLamp: { w: 400, d: 400, h: 1650, color: '#1F1D1A' },
    dining4: { w: 1200, d: 1600, h: 750, color: '#7A5A3C' },
    dining6: { w: 1800, d: 1700, h: 750, color: '#7A5A3C' },
    dining8: { w: 2600, d: 1800, h: 750, color: '#7A5A3C' },
    roundTable: { w: 1500, d: 1500, h: 750, color: '#7A5A3C' },
    chair: { w: 450, d: 520, h: 850, color: '#6B5641' },
    sideboard: { w: 1600, d: 450, h: 800, color: '#7A5A3C' },
    bedQueen: { w: 1600, d: 2100, h: 1050, color: '#E9E4DA' },
    bedDouble: { w: 1400, d: 1950, h: 1000, color: '#E9E4DA' },
    bedSingle: { w: 900, d: 1950, h: 900, color: '#E9E4DA' },
    nightstand: { w: 450, d: 400, h: 550, color: '#7A5A3C' },
    wardrobe: { w: 2000, d: 600, h: 2300, color: '#D9D2C5' },
    dresser: { w: 1200, d: 500, h: 850, color: '#7A5A3C' },
    desk: { w: 1200, d: 600, h: 750, color: '#B89A74' },
    officeChair: { w: 620, d: 620, h: 1000, color: '#2E2A26' },
    closetIsland: { w: 1200, d: 600, h: 900, color: '#D9D2C5' },
    kitchenSink: { w: 2000, d: 600, h: 900, color: '#EDEAE4', fixture: true },
    counter: { w: 1000, d: 600, h: 900, color: '#EDEAE4' },
    stove: { w: 760, d: 650, h: 900, color: '#C9CCCE' },
    fridge: { w: 700, d: 750, h: 1850, color: '#C9CCCE' },
    upperCabinet: { w: 1200, d: 350, h: 700, elev: 1500, color: '#EDEAE4' },
    island: { w: 1600, d: 900, h: 900, color: '#EDEAE4' },
    washer: { w: 600, d: 650, h: 850, color: '#F2F2F0' },
    shelves: { w: 900, d: 400, h: 1800, color: '#8A8F94' },
    toilet: { w: 380, d: 650, h: 780, color: '#F4F3F0', fixture: true },
    basin: { w: 800, d: 460, h: 850, color: '#F4F3F0', fixture: true },
    shower: { w: 900, d: 900, h: 2000, color: '#BFD8DC', fixture: true },
    bathtub: { w: 1700, d: 750, h: 550, color: '#F4F3F0', fixture: true },
    car: { w: 1850, d: 4600, h: 1650, color: '#3E4A56' },
    bbq: { w: 900, d: 600, h: 2400, color: '#B85C3A' },
    outdoorTable: { w: 1800, d: 1800, h: 2300, color: '#E7E1D5' },
    lounger: { w: 700, d: 1900, h: 400, color: '#D6CBB8' },
    outdoorSofa: { w: 1800, d: 800, h: 700, color: '#9AA59A' },
    planter: { w: 1500, d: 400, h: 500, color: '#6F8F4E' },
    bike: { w: 600, d: 1750, h: 1050, color: '#2BA3A3' },
    rug: { w: 2000, d: 1400, h: 10, color: '#C9B79C', flat: true },
    plant: { w: 550, d: 550, h: 1300, color: '#5E8A48' },
  };
  const GENERIC_TYPE = { w: 600, d: 600, h: 600, color: '#B8B0A2' };

  // Fixed accent colours (sRGB hex).
  const C = {
    legWood: '#3B2C20',
    blackMetal: '#2B2926',
    chrome: '#D9DCDF',
    brass: '#B8925A',
    stoneDark: '#2F2D2B',
    stoneLight: '#A8A198',
    linen: '#EFE6D2',
    white: '#F6F3EE',
    pillow: '#FBFAF7',
    teak: '#8B6443',
    rubber: '#1E1E1F',
    plasticDark: '#2A2C2E',
    terracotta: '#B5653C',
    soil: '#3A2C22',
    bark: '#6B4A2E',
    carGlass: '#1B2127',
    screen: '#08090B',
    tvBody: '#1C1C1E',
    headlight: '#F4F7FA',
    taillight: '#C0392B',
    ember: '#F08A3C',
    plateBlue: '#1F4E9A',
    concrete: '#A39C92',
  };
  const PILLOW_COLORS = ['#D8CBB3', '#C27A4A'];
  const OUTDOOR_PILLOWS = ['#E7E1D5', '#C98B5A'];
  const BOOK_COLORS = ['#7C3F2E', '#2F4858', '#C9B79C', '#8A9A5B', '#D9643A', '#3E3A36', '#B89A74', '#5F6F7A', '#E7E1D5'];
  const BIN_COLORS = ['#3E6E8E', '#D9643A', '#E8E2D5', '#C4A27A', '#6F8F4E'];
  const FLOWER_COLORS = ['#F2D06B', '#E07A5F', '#F4F1EA'];

  // Material presets. `glass` = transparent MeshPhysicalMaterial (no transmission).
  // Metalness is kept moderate so metals still read well without an environment map.
  // `closedShell`: double-sided material used on closed meshes → shadows rendered from back faces only
  // (avoids shadow acne that DoubleSide shadow casting causes).
  const MATERIAL_PRESETS = {
    fabric: { roughness: 0.94, metalness: 0 },
    canvas: { roughness: 0.9, metalness: 0, doubleSide: true },
    soft: { roughness: 0.97, metalness: 0 },
    paper: { roughness: 0.82, metalness: 0 },
    wood: { roughness: 0.6, metalness: 0 },
    lacquer: { roughness: 0.32, metalness: 0 },
    paint: { roughness: 0.3, metalness: 0.3 },
    plastic: { roughness: 0.5, metalness: 0 },
    stone: { roughness: 0.28, metalness: 0.02 },
    concrete: { roughness: 0.92, metalness: 0 },
    ceramic: { roughness: 0.14, metalness: 0, doubleSide: true, closedShell: true },
    metal: { roughness: 0.42, metalness: 0.55 },
    steel: { roughness: 0.34, metalness: 0.45 },
    chrome: { roughness: 0.16, metalness: 0.75 },
    rubber: { roughness: 0.9, metalness: 0 },
    brick: { roughness: 0.96, metalness: 0 },
    terracotta: { roughness: 0.9, metalness: 0 },
    foliage: { roughness: 0.72, metalness: 0, flatShading: true, doubleSide: true, closedShell: true },
    screen: { roughness: 0.07, metalness: 0.2 },
    darkGlass: { roughness: 0.08, metalness: 0.35 },
    light: { roughness: 0.4, metalness: 0, emissive: 0.85 },
    shade: { roughness: 0.9, metalness: 0, emissive: 0.35, emissiveColor: '#FFC98A', doubleSide: true },
    glass: { glass: true },
  };

  // Normalised lathe profiles [radius, height] (scaled per item).
  const POT_PROFILE = [[0, 0], [0.72, 0], [0.76, 0.06], [0.95, 0.9], [1, 0.93], [1, 1], [0.93, 1], [0.9, 0.94]];
  const TOILET_BOWL_PROFILE = [[0, 0], [0.62, 0], [0.6, 0.1], [0.66, 0.45], [0.86, 0.8], [1, 1]];
  const VESSEL_PROFILE = [[0, 0], [0.55, 0], [0.8, 0.25], [0.97, 0.75], [1, 1], [0.93, 1], [0.88, 0.72], [0.66, 0.3], [0, 0.18]];
  const VASE_PROFILE = [[0, 0], [0.7, 0], [1, 0.35], [0.8, 0.8], [0.45, 0.92], [0.55, 1], [0.4, 1]];

  // ------------------------------------------------------------------ pure helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const isPositive = (v) => typeof v === 'number' && isFinite(v) && v > 0;
  const quant = (v) => Math.round(v * 2000) / 2000; // 0.5 mm grid for template keys

  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

  function normalizeHex(hex) {
    if (typeof hex !== 'string' || !HEX_RE.test(hex.trim())) return null;
    let s = hex.trim().slice(1).toLowerCase();
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return '#' + s;
  }
  function hexToRgb(hex) {
    const s = (normalizeHex(hex) || '#808080').slice(1);
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  /** Linear mix of two sRGB hex colours. */
  function mixHex(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    return rgbToHex([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
  }
  /** Lighten (f > 0, towards white) or darken (f < 0, towards black) a colour. */
  const tone = (hex, f) => (f >= 0 ? mixHex(hex, '#ffffff', f) : mixHex(hex, '#000000', -f));

  // ------------------------------------------------------------------ item spec
  function catalogEntry(type) {
    try {
      const types = DD.catalog && DD.catalog.types;
      const t = types && types[type];
      return t && typeof t === 'object' ? t : null;
    } catch (e) {
      return null;
    }
  }
  function resolveDim(value, key, cat, fb) {
    const mm = isPositive(value) ? value : cat && isPositive(cat[key]) ? cat[key] : fb && isPositive(fb[key]) ? fb[key] : GENERIC_TYPE[key];
    return clamp(mm * MM, MIN_DIM, MAX_DIM);
  }
  /** Normalises an item into { type, id, w, d, h (metres), color (#rrggbb) } with catalog/local fallbacks. */
  function resolveSpec(item) {
    const type = typeof item.type === 'string' ? item.type : '';
    const cat = catalogEntry(type);
    const fb = FALLBACK_TYPES[type] || null;
    const color =
      normalizeHex(item.color) || normalizeHex(cat && cat.color) || normalizeHex(fb && fb.color) || GENERIC_TYPE.color;
    return {
      type,
      id: item.id != null ? item.id : null,
      w: resolveDim(item.w, 'w', cat, fb),
      d: resolveDim(item.d, 'd', cat, fb),
      h: resolveDim(item.h, 'h', cat, fb),
      color,
    };
  }

  // ------------------------------------------------------------------ per-three.js resource caches
  const resourceCache = new WeakMap();
  function resourcesFor(THREE) {
    let r = resourceCache.get(THREE);
    if (!r) {
      r = { materials: new Map(), templates: new Map() };
      resourceCache.set(THREE, r);
    }
    return r;
  }

  function createMaterial(THREE, kind, hex) {
    const p = MATERIAL_PRESETS[kind] || MATERIAL_PRESETS.plastic;
    let m;
    if (p.glass) {
      m = new THREE.MeshPhysicalMaterial({
        color: hex,
        roughness: 0.05,
        metalness: 0,
        transmission: 0,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
        shadowSide: THREE.BackSide,
      });
    } else {
      m = new THREE.MeshStandardMaterial({
        color: hex,
        roughness: p.roughness,
        metalness: p.metalness,
        flatShading: !!p.flatShading,
        side: p.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (p.closedShell) m.shadowSide = THREE.BackSide;
      if (p.emissive) {
        m.emissive.set(p.emissiveColor || hex);
        m.emissiveIntensity = p.emissive;
      }
    }
    m.name = 'furniture:' + kind + ':' + hex;
    m.userData.shared = true;
    m.userData.kind = kind;
    return m;
  }
  function getMaterial(ctx, kind, color) {
    const hex = normalizeHex(color) || ctx.color;
    const key = kind + '|' + hex;
    let m = ctx.res.materials.get(key);
    if (!m) {
      m = createMaterial(ctx.THREE, kind, hex);
      ctx.res.materials.set(key, m);
    }
    return m;
  }

  /** Bounded LRU of template geometries. Templates are never added to a scene (only baked), so evicting is safe. */
  function template(ctx, key, factory) {
    const map = ctx.res.templates;
    let g = map.get(key);
    if (g) {
      map.delete(key);
      map.set(key, g);
      return g;
    }
    g = factory();
    map.set(key, g);
    if (map.size > MAX_TEMPLATES) {
      const oldest = map.keys().next().value;
      map.get(oldest).dispose();
      map.delete(oldest);
    }
    return g;
  }

  /**
   * Rounded box (same idea as three's RoundedBoxGeometry addon, re-implemented because addons are not
   * imported): a subdivided unit box whose vertices are pushed onto rounded edges with smooth normals.
   */
  function roundedBoxGeometry(THREE, sx, sy, sz, radius, seg) {
    const s = seg * 2 + 1; // odd → no vertex sits exactly on an axis
    const geo = new THREE.BoxGeometry(1, 1, 1, s, s, s);
    const r = Math.max(0, Math.min(radius, sx / 2, sy / 2, sz / 2) - 1e-6);
    const half = [sx / 2 - r, sy / 2 - r, sz / 2 - r];
    const hs = 0.5 / s;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const p = [0, 0, 0];
    const n = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      p[0] = pos.getX(i);
      p[1] = pos.getY(i);
      p[2] = pos.getZ(i);
      for (let k = 0; k < 3; k++) n[k] = p[k] - Math.sign(p[k]) * hs;
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      for (let k = 0; k < 3; k++) n[k] /= len;
      pos.setXYZ(i, half[0] * Math.sign(p[0]) + n[0] * r, half[1] * Math.sign(p[1]) + n[1] * r, half[2] * Math.sign(p[2]) + n[2] * r);
      nor.setXYZ(i, n[0], n[1], n[2]);
    }
    return geo;
  }

  /** Flat-shaded frustum with a rectangular section (unit bottom 1×1, top k×k, height 1). */
  function frustumGeometry(THREE, k) {
    const g = new THREE.CylinderGeometry(k * Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1, false, PI / 4).toNonIndexed();
    g.computeVertexNormals();
    return g;
  }

  /** Scales/translates a geometry so that its bounding box becomes exactly [min, max]. */
  function fitGeometry(geo, min, max) {
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    const extent = (lo, hi) => Math.max(hi - lo, 1e-6);
    geo.translate(-b.min.x, -b.min.y, -b.min.z);
    geo.scale(
      (max[0] - min[0]) / extent(b.min.x, b.max.x),
      (max[1] - min[1]) / extent(b.min.y, b.max.y),
      (max[2] - min[2]) / extent(b.min.z, b.max.z)
    );
    geo.translate(min[0], min[1], min[2]);
    return geo;
  }

  // ------------------------------------------------------------------ kit (part recorder)
  // A kit records parts in its own local frame (metres, origin bottom-centre, back at z = -d/2).
  // Box / vertical cylinder / lathe positions are BOTTOM-centre [x, y0, z] unless o.center is set;
  // spheres, tori, tubes and beams take centre / end points.
  function createContext(THREE, spec) {
    return {
      THREE,
      res: resourcesFor(THREE),
      color: spec.color,
      rng: mulberry32(hashString(String(spec.id) + '|' + spec.type)),
      parts: [],
      ONE: new THREE.Vector3(1, 1, 1),
      QI: new THREE.Quaternion(),
      UP: new THREE.Vector3(0, 1, 0),
    };
  }

  function quatFrom(K, o) {
    if (o.quat) return o.quat;
    if (!o.rot) return K.ctx.QI;
    const T = K.T;
    return new T.Quaternion().setFromEuler(new T.Euler(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0, o.order || 'XYZ'));
  }

  function addPart(K, geo, mat, pos, quat, scale, o) {
    const matrix = new K.T.Matrix4().compose(pos, quat, scale).premultiply(K.base);
    K.ctx.parts.push({ geo, mat, matrix, tag: o.part || null, temp: !!o.temp });
  }

  function addBox(K, mat, size, at, o) {
    const T = K.T;
    const sx = Math.max(size[0], MIN_PART), sy = Math.max(size[1], MIN_PART), sz = Math.max(size[2], MIN_PART);
    const pos = new T.Vector3(at[0], o.center ? at[1] : at[1] + sy / 2, at[2]);
    const r = Math.min(o.r || 0, sx / 2, sy / 2, sz / 2);
    if (r > 0.0015) {
      const seg = o.seg || 1;
      const q = [quant(sx), quant(sy), quant(sz), quant(r)];
      const key = 'rbox|' + q.join('|') + '|' + seg;
      const geo = template(K.ctx, key, () => roundedBoxGeometry(T, q[0], q[1], q[2], q[3], seg));
      addPart(K, geo, mat, pos, quatFrom(K, o), K.ctx.ONE, o);
      return;
    }
    const geo = template(K.ctx, 'box', () => new T.BoxGeometry(1, 1, 1));
    addPart(K, geo, mat, pos, quatFrom(K, o), new T.Vector3(sx, sy, sz), o);
  }

  function addCylinder(K, mat, rTop, rBottom, height, at, o) {
    const T = K.T;
    const rMax = Math.max(rTop, rBottom, MIN_PART);
    const rt = Math.round((rTop / rMax) * 100) / 100;
    const rb = Math.round((rBottom / rMax) * 100) / 100;
    const seg = o.seg || 12;
    const open = !!o.open;
    const key = 'cyl|' + rt + '|' + rb + '|' + seg + '|' + open;
    const geo = template(K.ctx, key, () => new T.CylinderGeometry(rt, rb, 1, seg, 1, open));
    const ex = o.scaleXZ ? o.scaleXZ[0] : 1;
    const ez = o.scaleXZ ? o.scaleXZ[1] : 1;
    const h = Math.max(height, MIN_PART);
    const pos = new T.Vector3(at[0], o.center ? at[1] : at[1] + h / 2, at[2]);
    addPart(K, geo, mat, pos, quatFrom(K, o), new T.Vector3(rMax * ex, h, rMax * ez), o);
  }

  function addFrustum(K, mat, bottom, topRatio, height, at, o) {
    const T = K.T;
    const k = Math.round(clamp(topRatio, 0, 1) * 100) / 100;
    const geo = template(K.ctx, 'frustum|' + k, () => frustumGeometry(T, k));
    const h = Math.max(height, MIN_PART);
    addPart(K, geo, mat, new T.Vector3(at[0], at[1] + h / 2, at[2]), K.ctx.QI, new T.Vector3(bottom[0], h, bottom[1]), o);
  }

  function addSphere(K, mat, r, center, o) {
    const T = K.T;
    const detail = o.detail != null ? o.detail : 1;
    const key = o.smooth ? 'sphere' : 'ico|' + detail;
    const geo = template(K.ctx, key, () => (o.smooth ? new T.SphereGeometry(1, 12, 8) : new T.IcosahedronGeometry(1, detail)));
    const s = o.scale || [1, 1, 1];
    const scale = new T.Vector3(Math.max(r * s[0], MIN_PART), Math.max(r * s[1], MIN_PART), Math.max(r * s[2], MIN_PART));
    addPart(K, geo, mat, new T.Vector3(center[0], center[1], center[2]), quatFrom(K, o), scale, o);
  }

  function addLathe(K, mat, profile, at, o) {
    const T = K.T;
    const seg = o.seg || 16;
    const key = 'lathe|' + seg + '|' + profile.map((p) => p.join(',')).join(';');
    const geo = template(K.ctx, key, () => new T.LatheGeometry(profile.map((p) => new T.Vector2(p[0], p[1])), seg));
    const s = o.scale;
    addPart(K, geo, mat, new T.Vector3(at[0], at[1], at[2]), quatFrom(K, o), new T.Vector3(s[0], s[1], s[2]), o);
  }

  function addTorus(K, mat, R, tube, center, o) {
    const T = K.T;
    const ratio = Math.round((tube / Math.max(R, MIN_PART)) * 1000) / 1000;
    const rs = o.radial || 6, ts = o.tubular || 16, arc = o.arc || PI * 2;
    const key = 'torus|' + ratio + '|' + rs + '|' + ts + '|' + arc.toFixed(4);
    const geo = template(K.ctx, key, () => new T.TorusGeometry(1, ratio, rs, ts, arc));
    const r = Math.max(R, MIN_PART);
    addPart(K, geo, mat, new T.Vector3(center[0], center[1], center[2]), quatFrom(K, o), new T.Vector3(r, r, r), o);
  }

  /** Orientation (local +Y → a→b), midpoint and length of a segment. */
  function segmentFrame(K, a, b) {
    const T = K.T;
    const va = new T.Vector3(a[0], a[1], a[2]);
    const dir = new T.Vector3(b[0], b[1], b[2]).sub(va);
    const len = Math.max(dir.length(), MIN_PART);
    dir.divideScalar(len);
    const quat = new T.Quaternion().setFromUnitVectors(K.ctx.UP, dir);
    const mid = va.addScaledVector(dir, len / 2);
    return { quat, mid, len };
  }
  function addTube(K, mat, a, b, r, o) {
    const f = segmentFrame(K, a, b);
    const seg = o.seg || 6;
    const geo = template(K.ctx, 'cyl|1|1|' + seg + '|false', () => new K.T.CylinderGeometry(1, 1, 1, seg, 1, false));
    addPart(K, geo, mat, f.mid, f.quat, new K.T.Vector3(r, f.len, r), o);
  }
  function addBeam(K, mat, a, b, cross, o) {
    const f = segmentFrame(K, a, b);
    const geo = template(K.ctx, 'box', () => new K.T.BoxGeometry(1, 1, 1));
    addPart(K, geo, mat, f.mid, f.quat, new K.T.Vector3(cross[0], f.len, cross[1]), o);
  }

  function makeKit(ctx, base, dims, color) {
    const T = ctx.THREE;
    const K = { T, ctx, base, w: dims.w, d: dims.d, h: dims.h, color: color || ctx.color, rng: ctx.rng };
    K.mat = (kind, c) => getMaterial(ctx, kind, c || K.color);
    K.box = (mat, size, at, o) => addBox(K, mat, size, at, o || {});
    K.cyl = (mat, rTop, rBottom, height, at, o) => addCylinder(K, mat, rTop, rBottom, height, at, o || {});
    K.frustum = (mat, bottom, topRatio, height, at, o) => addFrustum(K, mat, bottom, topRatio, height, at, o || {});
    K.sphere = (mat, r, center, o) => addSphere(K, mat, r, center, o || {});
    K.lathe = (mat, profile, at, o) => addLathe(K, mat, profile, at, o || {});
    K.torus = (mat, R, tube, center, o) => addTorus(K, mat, R, tube, center, o || {});
    K.tube = (mat, a, b, r, o) => addTube(K, mat, a, b, r, o || {});
    K.beam = (mat, a, b, cross, o) => addBeam(K, mat, a, b, cross, o || {});
    /** Adds a one-off geometry already expressed in this kit's frame (disposed after baking). */
    K.geometry = (mat, geo, o) => addPart(K, geo, mat, new T.Vector3(), ctx.QI, ctx.ONE, Object.assign({}, o, { temp: true }));
    /** Child kit: its own dims, placed at bottom-centre `at` and turned by rotY about +Y (radians). */
    K.sub = (subDims, at, rotY, subColor) => {
      const local = new T.Matrix4().compose(
        new T.Vector3(at[0], at[1], at[2]),
        new T.Quaternion().setFromAxisAngle(ctx.UP, rotY || 0),
        ctx.ONE
      );
      return makeKit(ctx, base.clone().multiply(local), subDims, subColor || K.color);
    };
    return K;
  }

  // ------------------------------------------------------------------ baking / merging
  function bakePart(part, out, scratch) {
    const g = part.geo;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const I = g.index;
    const m = part.matrix;
    scratch.nm.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const base = out.vOff;
    for (let i = 0; i < P.count; i++) {
      scratch.v.fromBufferAttribute(P, i).applyMatrix4(m);
      const o = (base + i) * 3;
      out.pos[o] = scratch.v.x;
      out.pos[o + 1] = scratch.v.y;
      out.pos[o + 2] = scratch.v.z;
      if (part.box) part.box.expandByPoint(scratch.v);
      if (N) scratch.n.fromBufferAttribute(N, i).applyMatrix3(scratch.nm).normalize();
      else scratch.n.set(0, 1, 0);
      out.nor[o] = scratch.n.x;
      out.nor[o + 1] = scratch.n.y;
      out.nor[o + 2] = scratch.n.z;
    }
    const count = I ? I.count : P.count;
    for (let j = 0; j + 2 < count; j += 3) {
      const a = I ? I.getX(j) : j, b = I ? I.getX(j + 1) : j + 1, c = I ? I.getX(j + 2) : j + 2;
      out.idx[out.iOff++] = base + a;
      out.idx[out.iOff++] = base + (flip ? c : b);
      out.idx[out.iOff++] = base + (flip ? b : c);
    }
    out.vOff += P.count;
  }

  function mergeGroup(T, mat, parts, scratch) {
    let nv = 0, ni = 0;
    parts.forEach((p) => {
      const g = p.geo;
      const n = g.index ? g.index.count : g.attributes.position.count;
      nv += g.attributes.position.count;
      ni += n - (n % 3);
    });
    const out = {
      pos: new Float32Array(nv * 3),
      nor: new Float32Array(nv * 3),
      idx: nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni),
      vOff: 0,
      iOff: 0,
    };
    parts.forEach((p) => bakePart(p, out, scratch));
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(out.pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(out.nor, 3));
    geo.setIndex(new T.BufferAttribute(out.idx, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return new T.Mesh(geo, mat);
  }

  /** Bakes all recorded parts into one mesh per material; returns meshes (opaque first) and tagged part boxes. */
  function mergeParts(ctx) {
    const T = ctx.THREE;
    const groups = new Map();
    ctx.parts.forEach((p) => {
      if (p.tag) p.box = new T.Box3();
      if (!groups.has(p.mat)) groups.set(p.mat, []);
      groups.get(p.mat).push(p);
    });
    const scratch = { v: new T.Vector3(), n: new T.Vector3(), nm: new T.Matrix3() };
    const meshes = [];
    groups.forEach((parts, mat) => meshes.push(mergeGroup(T, mat, parts, scratch)));
    const tagBoxes = {};
    ctx.parts.forEach((p) => {
      if (p.temp) p.geo.dispose();
      if (!p.tag || p.box.isEmpty()) return;
      tagBoxes[p.tag] = tagBoxes[p.tag] ? tagBoxes[p.tag].union(p.box) : p.box;
    });
    meshes.sort((a, b) => (a.material.transparent ? 1 : 0) - (b.material.transparent ? 1 : 0));
    const tags = {};
    Object.keys(tagBoxes).forEach((k) => {
      const b = tagBoxes[k];
      tags[k] = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
    });
    return { meshes, tags };
  }

  // ------------------------------------------------------------------ shared sub-builders
  /** Four legs at the corners of a w×d rectangle centred at (cx, cz). */
  function cornerLegs(K, mat, o) {
    const w = o.w != null ? o.w : K.w;
    const d = o.d != null ? o.d : K.d;
    const size = o.size;
    const inset = o.inset || 0;
    const ox = Math.max(0, w / 2 - inset - size / 2);
    const oz = Math.max(0, d / 2 - inset - size / 2);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const at = [(o.cx || 0) + sx * ox, o.y0 || 0, (o.cz || 0) + sz * oz];
        if (o.round) K.cyl(mat, size / 2, (size / 2) * (o.taper || 1), o.height, at, { seg: 8 });
        else K.box(mat, [size, o.height, size], at);
      }
    }
  }

  /** Grid of front cells (drawers or doors) covering [x0,x1]×[y0,y1]. */
  function gridCells(x0, x1, y0, y1, cols, rows, kind) {
    const cells = [];
    const cw = (x1 - x0) / cols;
    const rh = (y1 - y0) / rows;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        cells.push({ x0: x0 + c * cw, x1: x0 + (c + 1) * cw, y0: y0 + r * rh, y1: y0 + (r + 1) * rh, kind, side: c % 2 ? 'l' : 'r' });
      }
    }
    return cells;
  }
  /** n doors side by side; handles sit on the meeting stiles of each pair. */
  function doorCells(x0, x1, y0, y1, n) {
    const cells = [];
    const cw = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 1 ? 'l' : i + 1 < n ? 'r' : 'l';
      cells.push({ x0: x0 + i * cw, x1: x0 + (i + 1) * cw, y0, y1, kind: 'door', side });
    }
    return cells;
  }

  function handleY(c, o) {
    if (c.kind === 'drawer') return (c.y0 + c.y1) / 2;
    const at = o.doorHandleY;
    if (typeof at === 'number') return clamp(at, c.y0 + 0.05, c.y1 - 0.05);
    if (at === 'bottom') return c.y0 + Math.min(0.08, (c.y1 - c.y0) * 0.25);
    if (at === 'middle') return (c.y0 + c.y1) / 2;
    return c.y1 - Math.min(0.1, (c.y1 - c.y0) * 0.25);
  }

  /** Handle on the face plane zFace (knob, bar or slim lip). Protrudes at most 0.022 m. */
  function addHandle(K, c, zFace, o) {
    const style = o.handle || 'bar';
    if (style === 'none') return;
    const hm = o.handleMat;
    const cw = c.x1 - c.x0;
    const ch = c.y1 - c.y0;
    const isDoor = c.kind === 'door';
    const edge = Math.min(0.045, cw * 0.2);
    let hx = isDoor ? (c.side === 'l' ? c.x0 + edge : c.x1 - edge) : (c.x0 + c.x1) / 2;
    const hy = handleY(c, o);
    if (style === 'knob') {
      K.cyl(hm, 0.011, 0.013, 0.022, [hx, hy, zFace + 0.011], { rot: [HALF_PI, 0, 0], center: true, seg: 10 });
      return;
    }
    if (style === 'lip') {
      K.box(hm, [cw * 0.7, 0.01, 0.012], [(c.x0 + c.x1) / 2, c.y0 + 0.012, zFace + 0.006]);
      return;
    }
    const vertical = isDoor && o.verticalBars !== false;
    const len = vertical ? clamp(o.barLen || ch * 0.3, 0.08, Math.max(0.08, ch - 0.06)) : clamp(cw * 0.4, 0.06, 0.32);
    if (!vertical) hx = clamp(hx, Math.min(c.x0 + len / 2 + 0.01, (c.x0 + c.x1) / 2), Math.max(c.x1 - len / 2 - 0.01, (c.x0 + c.x1) / 2));
    const size = vertical ? [0.012, len, 0.012] : [len, 0.012, 0.012];
    K.box(hm, size, [hx, hy, zFace + 0.016], { center: true });
    const off = len / 2 - 0.012;
    for (const s of [-1, 1]) {
      const px = vertical ? hx : hx + s * off;
      const py = vertical ? hy + s * off : hy;
      K.box(hm, [0.008, 0.008, 0.012], [px, py, zFace + 0.006], { center: true });
    }
  }

  /** Door / drawer fronts laid on the plane z = zf (facing +Z), optional fluting and handles. */
  function drawFronts(K, cells, zf, mat, o) {
    for (const c of cells) {
      const cw = c.x1 - c.x0 - FRONT_GAP;
      const ch = c.y1 - c.y0 - FRONT_GAP;
      if (cw <= 0.01 || ch <= 0.01) continue;
      const cx = (c.x0 + c.x1) / 2;
      K.box(mat, [cw, ch, FRONT_T], [cx, c.y0 + FRONT_GAP / 2, zf + FRONT_T / 2]);
      if (o.fluteMat) flutes(K, o.fluteMat, c, zf + FRONT_T);
      addHandle(K, c, zf + FRONT_T, o);
    }
  }
  function flutes(K, mat, c, zFace) {
    const cw = c.x1 - c.x0;
    const n = Math.min(24, Math.floor(cw / 0.04));
    const step = cw / (n + 1);
    for (let i = 1; i <= n; i++) {
      K.box(mat, [0.004, c.y1 - c.y0 - 0.03, 0.002], [c.x0 + i * step, c.y0 + 0.015, zFace + 0.001]);
    }
  }

  /** Carcass box from the back (-d/2) to the front plane zf, between y0 and y1. */
  function carcass(K, mat, y0, y1, zf, o) {
    const zb = o && o.zBack != null ? o.zBack : -K.d / 2;
    const w = o && o.w != null ? o.w : K.w;
    K.box(mat, [w, y1 - y0, zf - zb], [o && o.cx ? o.cx : 0, y0, (zf + zb) / 2], { r: (o && o.r) || 0 });
  }

  /** Chrome faucet: riser + half-torus spout reaching +Z + nozzle. `at` = base on the counter. */
  function faucet(K, at, height, reach) {
    const chrome = K.mat('chrome', C.chrome);
    const [x, y, z] = at;
    const r = 0.013;
    const R = reach / 2;
    const riserH = Math.max(0.04, height - R);
    K.cyl(chrome, 0.024, 0.027, 0.02, [x, y, z], { seg: 12 });
    K.cyl(chrome, r, r, riserH, [x, y, z], { seg: 10 });
    K.torus(chrome, R, r, [x, y + riserH, z + R], { arc: PI, rot: [0, -HALF_PI, 0], radial: 6, tubular: 10 });
    K.cyl(chrome, r * 0.85, r, 0.045, [x, y + riserH - 0.045, z + reach], { seg: 10 });
    K.box(chrome, [0.06, 0.012, 0.012], [x + 0.035, y + riserH * 0.55, z], { center: true, rot: [0, 0, 0.35] });
  }

  /** Stack of flat books (seeded colours) with its bottom centre at `at`. */
  function bookStack(K, at, bw, bd, count, maxH) {
    let y = at[1];
    for (let i = 0; i < count; i++) {
      const t = 0.025 + K.rng() * 0.02;
      if (y + t - at[1] > maxH) break;
      const shrink = 1 - i * 0.08;
      K.box(K.mat('paper', pick(K.rng, BOOK_COLORS)), [bw * shrink, t, bd * shrink], [at[0], y, at[2]], {
        rot: [0, (K.rng() - 0.5) * 0.3, 0],
      });
      y += t;
    }
  }

  // ================================================================== SEATING
  function sofaMetrics(K, o) {
    const { w, d, h } = K;
    const legH = clamp(h * (o.legFrac || 0.1), 0.03, 0.2);
    const armW = o.noArms ? 0 : clamp(w * (o.armFrac || 0.075), 0.06, Math.min(0.22, w * 0.2));
    const backT = clamp(d * 0.17, 0.06, 0.22);
    const baseTop = legH + clamp(h * 0.18, 0.05, 0.2);
    const seatTop = clamp(h * 0.52, baseTop + 0.04, h * 0.75);
    const armTop = clamp(h * 0.7, seatTop + 0.04, h);
    const cushT = clamp(d * 0.19, 0.06, 0.22);
    return { legH, armW, backT, baseTop, seatTop, armTop, cushT };
  }

  function seatCushions(K, mat, r, m) {
    const cw = (r.x1 - r.x0) / r.n;
    for (let i = 0; i < r.n; i++) {
      const x = r.x0 + cw * (i + 0.5);
      K.box(mat, [cw - 0.01, m.seatTop - m.baseTop, r.z1 - r.z0], [x, m.baseTop, (r.z0 + r.z1) / 2], {
        r: 0.045,
        seg: r.seg || 2,
        part: 'seat',
      });
    }
  }
  function backCushions(K, mat, r, m) {
    const cw = (r.x1 - r.x0) / r.n;
    const bh = Math.max(0.05, K.h - 0.02 - m.seatTop);
    for (let i = 0; i < r.n; i++) {
      const x = r.x0 + cw * (i + 0.5);
      K.box(mat, [cw - 0.01, bh, m.cushT], [x, m.seatTop, r.z + m.cushT / 2], {
        r: 0.05,
        seg: r.seg || 2,
        rot: [-0.1, 0, 0],
        part: 'backrest',
      });
    }
  }
  function throwPillow(K, color, size, at, lean) {
    K.box(K.mat('fabric', color), [size, size, 0.12], at, { r: 0.05, rot: [-0.3, lean * 0.25, lean * 0.12] });
  }
  const seatCount = (innerW) => clamp(Math.round(innerW / 0.7), 1, 6);

  /** Straight sofa / armchair / outdoor sofa. o: { seats?, legFrac, armFrac, frameMat, legMat, squareLegs, pillows } */
  function buildSofa(K, o) {
    const { w, d, h } = K;
    const m = sofaMetrics(K, o);
    const z0 = -d / 2;
    const cushion = K.mat('fabric', K.color);
    const frame = o.frameMat || K.mat('fabric', tone(K.color, -0.1));
    const legMat = o.legMat || K.mat('wood', C.legWood);
    const legSize = clamp(Math.min(w, d) * 0.045, 0.025, 0.05);
    cornerLegs(K, legMat, { size: legSize, inset: 0.04, height: m.legH, round: !o.squareLegs, taper: 0.65 });
    K.box(frame, [w, m.baseTop - m.legH, d], [0, m.legH, 0], { r: 0.02 });
    K.box(frame, [w, h * 0.82 - m.legH, m.backT], [0, m.legH, z0 + m.backT / 2], { r: 0.03, part: 'backrest' });
    for (const s of [-1, 1]) {
      if (!m.armW) break;
      K.box(frame, [m.armW, m.armTop - m.legH, d], [s * (w / 2 - m.armW / 2), m.legH, 0], { r: Math.min(0.05, m.armW * 0.4) });
    }
    const innerW = w - 2 * m.armW;
    const n = o.seats || seatCount(innerW);
    const seg = n <= 3 ? 2 : 1;
    seatCushions(K, cushion, { x0: -innerW / 2, x1: innerW / 2, z0: z0 + m.backT, z1: d / 2 - 0.01, n, seg }, m);
    backCushions(K, cushion, { x0: -innerW / 2, x1: innerW / 2, z: z0 + m.backT, n, seg }, m);
    if (o.pillows === false || innerW < 0.9) return;
    const colors = o.pillowColors || PILLOW_COLORS;
    const ps = Math.min(clamp(innerW * 0.2, 0.28, 0.45), (h - m.seatTop) * 0.8);
    const pz = z0 + m.backT + m.cushT + 0.07;
    for (const s of [-1, 1]) {
      throwPillow(K, colors[s < 0 ? 0 : 1], ps, [s * (innerW / 2 - ps / 2 - 0.04), m.seatTop + 0.02, pz], s);
    }
  }

  /** Sofa with chaise: main seat along the back (full width), chaise on the RIGHT end at full depth. */
  function buildSofaL(K) {
    const { w, d, h } = K;
    const m = sofaMetrics(K, {});
    const z0 = -d / 2;
    const cushion = K.mat('fabric', K.color);
    const frame = K.mat('fabric', tone(K.color, -0.1));
    const legMat = K.mat('wood', C.legWood);
    const mainD = Math.min(d, clamp(d * 0.545, 0.5, 1.1));
    const chaiseW = clamp(w * 0.333, 0.5, w * 0.5);
    const cx0 = w / 2 - chaiseW;
    const armR = m.armW * 0.7;
    const legSize = clamp(Math.min(w, d) * 0.03, 0.025, 0.05);
    cornerLegs(K, legMat, { d: mainD, cz: z0 + mainD / 2, size: legSize, inset: 0.04, height: m.legH, round: true, taper: 0.65 });
    cornerLegs(K, legMat, { w: chaiseW, cx: cx0 + chaiseW / 2, size: legSize, inset: 0.04, height: m.legH, round: true, taper: 0.65 });
    K.box(frame, [w, m.baseTop - m.legH, mainD], [0, m.legH, z0 + mainD / 2], { r: 0.02 });
    K.box(frame, [chaiseW, m.baseTop - m.legH, d - mainD + 0.02], [cx0 + chaiseW / 2, m.legH, (z0 + mainD + d / 2) / 2 - 0.01], { r: 0.02 });
    K.box(frame, [w, h * 0.82 - m.legH, m.backT], [0, m.legH, z0 + m.backT / 2], { r: 0.03, part: 'backrest' });
    K.box(frame, [m.armW, m.armTop - m.legH, mainD], [-w / 2 + m.armW / 2, m.legH, z0 + mainD / 2], { r: Math.min(0.05, m.armW * 0.4) });
    K.box(frame, [armR, m.armTop - m.legH, d], [w / 2 - armR / 2, m.legH, 0], { r: Math.min(0.04, armR * 0.4) });
    const mx0 = -w / 2 + m.armW;
    const nMain = seatCount(cx0 - mx0);
    const seg = nMain <= 2 ? 2 : 1;
    seatCushions(K, cushion, { x0: mx0, x1: cx0, z0: z0 + m.backT, z1: z0 + mainD - 0.01, n: nMain, seg }, m);
    seatCushions(K, cushion, { x0: cx0, x1: w / 2 - armR, z0: z0 + m.backT, z1: d / 2 - 0.01, n: 1, seg }, m);
    backCushions(K, cushion, { x0: mx0, x1: cx0, z: z0 + m.backT, n: nMain, seg }, m);
    backCushions(K, cushion, { x0: cx0, x1: w / 2 - armR, z: z0 + m.backT, n: 1, seg }, m);
    const ps = Math.min(0.42, (h - m.seatTop) * 0.8, chaiseW * 0.45);
    const pz = z0 + m.backT + m.cushT + 0.07;
    throwPillow(K, PILLOW_COLORS[0], ps, [mx0 + ps / 2 + 0.05, m.seatTop + 0.02, pz], -1);
    throwPillow(K, PILLOW_COLORS[1], ps, [w / 2 - armR - ps / 2 - 0.05, m.seatTop + 0.02, pz], 1);
  }

  /** Dining chair: square legs, wooden seat with upholstered pad and a rounded backrest. */
  function buildChair(K, o) {
    const opts = o || {};
    const { w, d, h } = K;
    const wood = opts.frameMat || K.mat('wood', K.color);
    const pad = opts.padMat || K.mat('fabric', C.linen);
    const seatH = clamp(h * 0.53, 0.12, 0.48);
    const seatT = clamp(seatH * 0.08, 0.015, 0.035);
    const leg = clamp(Math.min(w, d) * 0.07, 0.015, 0.035);
    const z0 = -d / 2;
    const zSeat0 = z0 + 0.01;
    cornerLegs(K, wood, { d: d - 0.01, cz: 0.005, size: leg, inset: 0.012, height: seatH - seatT });
    K.box(wood, [w, seatT, d - 0.01], [0, seatH - seatT, 0.005]);
    K.box(pad, [w - 0.03, 0.03, d - 0.07], [0, seatH, 0.02], { r: 0.012 });
    const postX = w / 2 - 0.012 - leg / 2;
    const postZ = zSeat0 + 0.012 + leg / 2;
    for (const s of [-1, 1]) K.box(wood, [leg, h - seatH, leg], [s * postX, seatH, postZ]);
    const backY0 = seatH + (h - seatH) * 0.45;
    K.box(wood, [w - 0.01, h - 0.005 - backY0, 0.022], [0, backY0, postZ + leg / 2 + 0.011], { r: 0.008, part: 'backrest' });
  }

  function buildArmchair(K) {
    buildSofa(K, { seats: 1, legFrac: 0.17, armFrac: 0.13, pillows: false });
    const m = sofaMetrics(K, { legFrac: 0.17, armFrac: 0.13 });
    const ps = Math.min(0.36, K.w * 0.45, (K.h - m.seatTop) * 0.7);
    throwPillow(K, PILLOW_COLORS[0], ps, [0, m.seatTop + 0.02, -K.d / 2 + m.backT + m.cushT + 0.07], 0);
  }

  function buildOutdoorSofa(K) {
    const teak = K.mat('wood', C.teak);
    buildSofa(K, { legFrac: 0.14, frameMat: teak, legMat: teak, squareLegs: true, pillowColors: OUTDOOR_PILLOWS });
  }

  function officeChairBase(K, S) {
    const plastic = K.mat('plastic', '#1E1E20');
    const casterR = clamp(S * 0.04, 0.012, 0.03);
    const armLen = S / 2 - casterR;
    const yArm = casterR * 2 + 0.012;
    for (let k = 0; k < 5; k++) {
      const a = (k * 2 * PI) / 5;
      const tip = [Math.sin(a) * armLen, yArm - 0.01, Math.cos(a) * armLen];
      K.beam(plastic, [0, yArm, 0], tip, [0.032, 0.032]);
      K.sphere(plastic, casterR, [tip[0], casterR, tip[2]], { detail: 1 });
    }
    K.cyl(plastic, 0.05, 0.06, 0.05, [0, yArm - 0.02, 0], { seg: 12 });
    return yArm + 0.03;
  }

  function buildOfficeChair(K) {
    const { w, d, h } = K;
    const S = Math.min(w, d);
    const fabric = K.mat('fabric', K.color);
    const plastic = K.mat('plastic', '#1E1E20');
    const chrome = K.mat('chrome', C.chrome);
    const hubTop = officeChairBase(K, S);
    const seatY = clamp(h * 0.47, hubTop + 0.08, 0.55);
    K.cyl(chrome, 0.022, 0.022, seatY - 0.05 - hubTop, [0, hubTop, 0], { seg: 10 });
    K.cyl(plastic, 0.03, 0.036, Math.min(0.12, (seatY - hubTop) * 0.5), [0, hubTop, 0], { seg: 10 });
    K.box(plastic, [0.18, 0.05, 0.2], [0, seatY - 0.05, 0]);
    K.box(fabric, [w * 0.8, 0.08, d * 0.72], [0, seatY, 0.03], { r: 0.035, seg: 2, part: 'seat' });
    const y0 = seatY + 0.16;
    K.beam(plastic, [0, seatY + 0.02, -d * 0.22], [0, y0 + 0.12, -d / 2 + 0.09], [0.06, 0.02]);
    K.box(fabric, [w * 0.74, Math.max(0.1, h - 0.015 - y0), 0.07], [0, y0, -d / 2 + 0.07], {
      r: 0.035,
      seg: 2,
      rot: [-0.1, 0, 0],
      part: 'backrest',
    });
    for (const s of [-1, 1]) {
      const x = s * (w * 0.4 - 0.02);
      K.box(plastic, [0.03, 0.2, 0.05], [x, seatY + 0.02, 0]);
      K.box(plastic, [0.06, 0.03, Math.min(0.24, d * 0.4)], [x, seatY + 0.2, 0], { r: 0.012 });
    }
  }

  /** Sun lounger — reclined backrest at the back end (-Z), wheels under the back. */
  function buildLounger(K) {
    const { w, d, h } = K;
    const teak = K.mat('wood', C.teak);
    const cushion = K.mat('fabric', K.color);
    const rubber = K.mat('rubber', C.rubber);
    const z0 = -d / 2;
    const frameTop = clamp(h * 0.55, 0.06, 0.35);
    const cushT = clamp(h * 0.14, 0.03, 0.08);
    const backLen = d * 0.32;
    const wheelR = clamp(frameTop * 0.35, 0.03, 0.08);
    cornerLegs(K, teak, { d: d - 0.2, cz: 0.1, size: 0.045, inset: 0.02, height: frameTop - 0.05 });
    for (const s of [-1, 1]) {
      K.box(teak, [0.04, 0.06, d - 0.02], [s * (w / 2 - 0.04), frameTop - 0.06, 0]);
      K.cyl(rubber, wheelR, wheelR, 0.03, [s * (w / 2 - 0.035), wheelR, z0 + wheelR + 0.01], { rot: [0, 0, HALF_PI], center: true, seg: 14 });
    }
    const nSlats = Math.max(3, Math.round((d - backLen) / 0.12));
    const slatStep = (d - backLen - 0.04) / nSlats;
    for (let i = 0; i < nSlats; i++) {
      K.box(teak, [w - 0.08, 0.015, slatStep * 0.6], [0, frameTop - 0.015, z0 + backLen + 0.02 + slatStep * (i + 0.5)]);
    }
    K.box(cushion, [w - 0.06, cushT, d - backLen - 0.02], [0, frameTop, z0 + backLen + (d - backLen - 0.02) / 2], { r: 0.02, part: 'seat' });
    const a = Math.asin(clamp((h - frameTop - cushT) / backLen, 0, 0.9));
    const cy = frameTop + cushT / 2 + (backLen / 2) * Math.sin(a);
    const cz = z0 + backLen - (backLen / 2) * Math.cos(a);
    K.box(teak, [w - 0.06, 0.02, backLen], [0, cy - cushT / 2 - 0.01, cz], { center: true, rot: [a, 0, 0] });
    K.box(cushion, [w - 0.06, cushT, backLen], [0, cy, cz], { center: true, r: 0.02, rot: [a, 0, 0], part: 'backrest' });
  }

  // ================================================================== TABLES
  function buildCoffeeTable(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const t = clamp(h * 0.1, 0.015, 0.05);
    const leg = clamp(Math.min(w, d) * 0.07, 0.025, 0.06);
    K.box(wood, [w, t, d], [0, h - t, 0], { r: Math.min(0.015, t / 2) });
    cornerLegs(K, wood, { size: leg, inset: 0.03, height: h - t });
    const shelfY = h * 0.2;
    K.box(wood, [Math.max(0.02, w - 0.06), 0.018, Math.max(0.02, d - 0.06)], [0, shelfY, 0]);
    const room = h - t - shelfY - 0.03;
    if (room > 0.04 && w > 0.4) {
      bookStack(K, [-w * 0.18, shelfY + 0.018, 0], Math.min(0.3, w * 0.28), Math.min(0.22, d * 0.45), 3, room);
    }
  }

  function buildSideTable(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const metal = K.mat('metal', C.blackMetal);
    const R = Math.min(w, d) / 2;
    const t = clamp(h * 0.045, 0.015, 0.04);
    const ex = w / 2 / R, ez = d / 2 / R;
    K.cyl(wood, R, R, t, [0, h - t, 0], { seg: 24, scaleXZ: [ex, ez] });
    K.cyl(metal, R * 0.55, R * 0.6, 0.02, [0, 0, 0], { seg: 20, scaleXZ: [ex, ez] });
    K.cyl(metal, 0.018, 0.018, h - t - 0.02, [0, 0.02, 0], { seg: 8 });
  }

  /** Rectangular table: top, apron and four square legs. */
  function buildTable(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const t = clamp(h * 0.05, 0.02, 0.05);
    const leg = clamp(Math.min(w, d) * 0.06, 0.035, 0.08);
    const inset = 0.05;
    K.box(wood, [w, t, d], [0, h - t, 0], { r: 0.01, part: 'tabletop' });
    cornerLegs(K, wood, { size: leg, inset, height: h - t });
    const apH = Math.min(0.08, h * 0.12);
    const ax = w - 2 * (inset + leg / 2);
    const az = d - 2 * (inset + leg / 2);
    for (const s of [-1, 1]) {
      K.box(wood, [ax, apH, 0.02], [0, h - t - apH, s * (az / 2)]);
      K.box(wood, [0.02, apH, az], [s * (ax / 2), h - t - apH, 0]);
    }
  }

  /** Round/oval pedestal table filling its kit footprint. */
  function buildPedestalTable(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const R = Math.min(w, d) / 2;
    const scaleXZ = [w / 2 / R, d / 2 / R];
    const t = clamp(h * 0.045, 0.02, 0.05);
    K.cyl(wood, R, R, t, [0, h - t, 0], { seg: 28, scaleXZ, part: 'tabletop' });
    K.cyl(wood, clamp(R * 0.09, 0.025, 0.07), clamp(R * 0.12, 0.03, 0.09), h - t - 0.03, [0, 0.03, 0], { seg: 12 });
    K.cyl(wood, R * 0.42, R * 0.48, 0.03, [0, 0, 0], { seg: 20, scaleXZ });
  }

  const chairHeightFor = (h) => Math.min(h + 0.025, 0.95);

  /** Rectangular dining set: table centred, chairs on the back/front sides (+ optional end chairs). */
  function buildDiningSet(K, o) {
    const { w, d, h } = K;
    const tableW = clamp(w * o.tableW, 0.3, w);
    const tableD = clamp(d * o.tableD, 0.3, d);
    buildTable(K.sub({ w: tableW, d: tableD, h }, [0, 0, 0], 0));
    const chairColor = tone(K.color, -0.08);
    const chairD = clamp((d - tableD) / 2 + 0.18, 0.25, 0.55);
    const pitch = tableW / o.perSide;
    const chairW = clamp(Math.min(0.46, pitch - 0.08), 0.25, 0.5);
    const chairH = chairHeightFor(h);
    for (let i = 0; i < o.perSide; i++) {
      const x = -tableW / 2 + pitch * (i + 0.5);
      buildChair(K.sub({ w: chairW, d: chairD, h: chairH }, [x, 0, -d / 2 + chairD / 2], 0, chairColor));
      buildChair(K.sub({ w: chairW, d: chairD, h: chairH }, [x, 0, d / 2 - chairD / 2], PI, chairColor));
    }
    if (!o.ends || w - tableW < 0.3) return;
    const endD = Math.min(chairD, (w - tableW) / 2 + 0.15);
    const endW = Math.min(chairW, tableD - 0.1);
    for (const s of [-1, 1]) {
      buildChair(K.sub({ w: endW, d: endD, h: chairH }, [s * (w / 2 - endD / 2), 0, 0], s < 0 ? HALF_PI : -HALF_PI, chairColor));
    }
  }

  /** Four chairs around a round table (N/E/S/W), each facing the centre. */
  function chairsAround(K, tableDia, chairH, chairColor, chairOpts) {
    const { w, d } = K;
    const S = Math.min(w, d);
    const chairD = clamp((S - tableDia) / 2 + 0.18, 0.25, 0.52);
    const chairW = clamp(Math.min(0.46, S * 0.3), 0.25, 0.5);
    const rx = w / 2 - chairD / 2;
    const rz = d / 2 - chairD / 2;
    for (let k = 0; k < 4; k++) {
      const phi = k * HALF_PI;
      const at = [Math.sin(phi) * rx, 0, Math.cos(phi) * rz];
      buildChair(K.sub({ w: chairW, d: chairD, h: chairH }, at, phi + PI, chairColor), chairOpts);
    }
  }

  function buildRoundTable(K) {
    const S = Math.min(K.w, K.d);
    const dia = S * 0.67;
    buildPedestalTable(K.sub({ w: dia, d: dia, h: K.h }, [0, 0, 0], 0));
    chairsAround(K, dia, chairHeightFor(K.h), tone(K.color, -0.08));
  }

  function umbrella(K, R, tableTop) {
    const { h } = K;
    const teak = K.mat('wood', C.teak);
    const canvas = K.mat('canvas', K.color);
    const canopyH = clamp(R * 0.4, 0.12, 0.45);
    const top = h - 0.04;
    K.cyl(K.mat('concrete', '#5A5650'), 0.2, 0.22, 0.06, [0, 0, 0], { seg: 16 });
    K.cyl(teak, 0.02, 0.02, top - 0.06, [0, 0.06, 0], { seg: 8 });
    K.cyl(canvas, 0, R, canopyH, [0, top - canopyH, 0], { seg: 8, open: true, part: 'canopy' });
    K.cyl(canvas, R, R, Math.min(0.07, canopyH * 0.4), [0, top - canopyH - Math.min(0.07, canopyH * 0.4), 0], { seg: 8, open: true });
    for (let k = 0; k < 8; k++) {
      const a = (k * PI) / 4;
      K.tube(teak, [0, top - canopyH * 0.35, 0], [Math.sin(a) * R * 0.97, top - canopyH + 0.012, Math.cos(a) * R * 0.97], 0.006, { seg: 4 });
    }
    K.tube(teak, [0, top - canopyH - 0.25, 0], [0, top - canopyH * 0.35, 0], 0.025, { seg: 8 });
    K.sphere(teak, 0.03, [0, h - 0.03, 0], { smooth: true });
    return tableTop;
  }

  function buildOutdoorTable(K) {
    const { w, d, h } = K;
    const S = Math.min(w, d);
    const dia = S * 0.5;
    const tableH = Math.min(0.74, h * 0.45);
    const chairColor = C.teak;
    buildPedestalTable(K.sub({ w: dia, d: dia, h: tableH }, [0, 0, 0], 0, C.teak));
    chairsAround(K, dia, Math.min(0.85, h * 0.4), chairColor, { padMat: K.mat('fabric', C.white) });
    umbrella(K, S / 2 - 0.02, tableH);
  }

  // ================================================================== LIVING / STORAGE
  function buildTvUnit(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const metal = K.mat('metal', C.blackMetal);
    const dark = K.mat('plastic', C.tvBody);
    const rackH = clamp(Math.min(0.5, h * 0.4), 0.15, 0.6);
    const legH = clamp(rackH * 0.14, 0.03, 0.08);
    const zf = d / 2 - FRONT_T - 0.004;
    cornerLegs(K, metal, { size: 0.03, inset: 0.05, height: legH });
    carcass(K, wood, legH, rackH, zf);
    const cols = w > 1.2 ? 3 : 2;
    const cells = gridCells(-w / 2, w / 2, legH, rackH, cols, 1, 'door');
    const niche = cols === 3 ? cells[1] : null;
    const doors = cells.filter((c) => c !== niche);
    drawFronts(K, doors, zf, wood, { handle: 'none', fluteMat: K.mat('wood', tone(K.color, -0.3)) });
    if (niche) {
      K.box(K.mat('wood', tone(K.color, -0.55)), [niche.x1 - niche.x0 - 0.04, rackH - legH - 0.05, 0.004], [(niche.x0 + niche.x1) / 2, legH + 0.025, zf + 0.002]);
    }
    tvScreen(K, rackH, dark);
    const barW = Math.min(0.9, w * 0.5);
    K.box(dark, [barW, 0.06, Math.min(0.09, d * 0.25)], [0, rackH, d / 2 - Math.min(0.09, d * 0.25) / 2 - 0.02], { r: 0.02 });
  }

  function tvScreen(K, rackH, dark) {
    const { w, d, h } = K;
    const lift = 0.03;
    const tvW = Math.max(0.2, Math.min(w * 0.805, (h - rackH - lift) / 0.5625));
    const tvH = tvW * 0.5625;
    const tvZ = -d / 2 + Math.min(0.12, d * 0.3);
    K.box(dark, [tvW * 0.35, 0.012, Math.min(0.22, d * 0.5)], [0, rackH, tvZ]);
    K.box(dark, [0.06, lift + 0.1, 0.03], [0, rackH, tvZ - 0.035]);
    K.box(dark, [tvW * 0.6, tvH * 0.5, 0.05], [0, rackH + lift + tvH * 0.2, tvZ - 0.04], { r: 0.01 });
    K.box(dark, [tvW, tvH, 0.035], [0, rackH + lift, tvZ], { r: 0.004, part: 'tv' });
    K.box(K.mat('screen', C.screen), [tvW - 0.02, tvH - 0.02, 0.004], [0, rackH + lift + 0.01, tvZ + 0.0185], { part: 'screen' });
  }

  function fillCompartment(K, x0, x1, y0, hAvail, d, budget) {
    const rng = K.rng;
    let x = x0 + 0.01 + rng() * 0.04;
    const fill = x0 + (x1 - x0) * (0.55 + rng() * 0.35);
    let used = 0;
    if (rng() < 0.22 && hAvail > 0.12) {
      const vr = Math.min(0.07, (x1 - x0) * 0.2, d * 0.3);
      const vh = Math.min(hAvail - 0.03, 0.22);
      K.lathe(K.mat('ceramic', pick(rng, ['#E7E1D5', '#8A9A5B', '#2F4858', '#C27A4A'])), VASE_PROFILE, [x1 - vr - 0.03, y0, 0], {
        scale: [vr, vh, vr],
        seg: 12,
      });
      used++;
    }
    while (used < budget) {
      const bw = 0.02 + rng() * 0.03;
      const bh = Math.min(hAvail - 0.02, 0.17 + rng() * 0.13);
      const bd = Math.min(d - 0.03, 0.15 + rng() * 0.07);
      if (x + bw > fill || bh < 0.05 || bd < 0.03) break;
      K.box(K.mat('paper', pick(rng, BOOK_COLORS)), [bw, bh, bd], [x + bw / 2, y0, d / 2 - 0.015 - bd / 2]);
      x += bw + 0.002;
      used++;
    }
    const left = x1 - 0.02 - x;
    if (used < budget && left > 0.2 && hAvail > 0.1 && rng() < 0.6) {
      bookStack(K, [x + left / 2, y0, d * 0.05], Math.min(0.2, left * 0.8), Math.min(0.15, d - 0.05), 3, hAvail - 0.03);
    }
  }

  function buildBookshelf(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const t = clamp(Math.min(w, h) * 0.018, 0.012, 0.03);
    const plinth = clamp(h * 0.03, 0.02, 0.08);
    for (const s of [-1, 1]) K.box(wood, [t, h, d], [s * (w / 2 - t / 2), 0, 0]);
    K.box(wood, [w - 2 * t, t, d], [0, h - t, 0]);
    K.box(wood, [w - 2 * t, plinth, d - 0.02], [0, 0, -0.01]);
    K.box(wood, [w - 2 * t, t, d], [0, plinth, 0]);
    K.box(K.mat('wood', tone(K.color, 0.12)), [w - 2 * t, h - plinth - t, 0.008], [0, plinth, -d / 2 + 0.004]);
    const cols = w > 1.4 ? Math.max(2, Math.round(w / 0.8)) : 1;
    const y0 = plinth + t;
    const rows = clamp(Math.round((h - t - y0) / 0.36), 1, 12);
    const rowH = (h - t - y0) / rows;
    const colW = (w - 2 * t) / cols;
    for (let r = 1; r < rows; r++) K.box(wood, [w - 2 * t, t, d - 0.01], [0, y0 + r * rowH - t, 0.005]);
    for (let c = 1; c < cols; c++) K.box(wood, [t, h - t - y0, d - 0.01], [-w / 2 + t + c * colW, y0, 0.005]);
    const budget = Math.max(3, Math.floor(160 / (rows * cols)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx0 = -w / 2 + t + c * colW + (c ? t / 2 : 0);
        const cx1 = -w / 2 + t + (c + 1) * colW - (c < cols - 1 ? t / 2 : 0);
        fillCompartment(K, cx0, cx1, y0 + r * rowH, rowH - t, d, budget);
      }
    }
  }

  function buildFloorLamp(K) {
    const { w, d, h } = K;
    const S = Math.min(w, d);
    const metal = K.mat('metal', K.color);
    const R = S / 2 - 0.005;
    const shadeH = clamp(h * 0.2, 0.08, 0.4);
    K.cyl(metal, S * 0.3, S * 0.32, 0.025, [0, 0, 0], { seg: 20 });
    K.cyl(metal, 0.012, 0.012, h - shadeH * 0.5 - 0.025, [0, 0.025, 0], { seg: 8 });
    K.cyl(K.mat('shade', C.linen), R * 0.82, R, shadeH, [0, h - shadeH, 0], { seg: 24, open: true, part: 'shade' });
    K.sphere(K.mat('light', '#FFE6B8'), Math.min(0.04, R * 0.3), [0, h - shadeH * 0.55, 0], { smooth: true });
  }

  function buildSideboard(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const legH = clamp(h * 0.18, 0.04, 0.2);
    const zf = d / 2 - FRONT_T - 0.026;
    cornerLegs(K, wood, { size: 0.04, inset: 0.04, height: legH, round: true, taper: 0.6 });
    carcass(K, wood, legH, h, zf, { r: 0.006 });
    const n = Math.max(2, Math.round(w / 0.4));
    drawFronts(K, doorCells(-w / 2 + 0.01, w / 2 - 0.01, legH + 0.02, h - 0.02, n), zf, K.mat('wood', tone(K.color, 0.05)), {
      handle: 'knob',
      handleMat: K.mat('metal', C.brass),
      doorHandleY: 'middle',
      fluteMat: K.mat('wood', tone(K.color, -0.25)),
    });
  }

  // ================================================================== BEDROOM
  /** Upholstered bed: channel-tufted headboard at the back, mattress, pillows, duvet with turn-down and a throw. */
  function buildBed(K) {
    const { w, d, h } = K;
    const frame = K.mat('fabric', K.color);
    const z0 = -d / 2;
    const hbT = clamp(d * 0.04, 0.04, 0.1);
    const legH = clamp(h * 0.06, 0.03, 0.08);
    const baseTop = clamp(h * 0.33, legH + 0.08, 0.4);
    const matTop = baseTop + clamp(h * 0.2, 0.08, 0.25);
    const bodyD = d - hbT;
    const bodyZ = z0 + hbT + bodyD / 2;
    cornerLegs(K, K.mat('wood', C.legWood), { w: w - 0.04, d: bodyD - 0.04, cz: bodyZ, size: 0.05, inset: 0.02, height: legH });
    K.box(frame, [w, baseTop - legH, bodyD], [0, legH, bodyZ], { r: 0.02 });
    headboard(K, frame, hbT);
    K.box(K.mat('soft', C.white), [w - 0.03, matTop - baseTop, bodyD - 0.03], [0, baseTop, bodyZ], { r: 0.04 });
    bedding(K, { z0, hbT, baseTop, matTop });
  }

  function headboard(K, mat, hbT) {
    const { w, h } = K;
    const n = Math.max(1, Math.round(w / 0.3));
    const cw = w / n;
    for (let i = 0; i < n; i++) {
      K.box(mat, [cw - 0.004, h, hbT], [-w / 2 + cw * (i + 0.5), 0, -K.d / 2 + hbT / 2], {
        r: Math.min(0.04, hbT * 0.45),
        part: 'headboard',
      });
    }
  }

  function bedding(K, m) {
    const { w, d } = K;
    const pillowMat = K.mat('soft', C.pillow);
    const duvetMat = K.mat('soft', '#F2EEE7');
    const count = w > 1.1 ? 2 : 1;
    const pw = Math.min(0.7, (w - 0.1) / count - 0.04);
    const pd = Math.min(0.4, d * 0.2);
    const pz = m.z0 + m.hbT + pd / 2 + 0.03;
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? 0 : (i === 0 ? -1 : 1) * (pw / 2 + 0.03);
      K.box(pillowMat, [pw, 0.14, pd], [x, m.matTop - 0.02, pz], { r: 0.06, seg: 2, rot: [0.3, 0, 0], part: 'pillow' });
    }
    const dz0 = m.z0 + m.hbT + pd + 0.12;
    const dLen = d / 2 - 0.008 - dz0;
    if (dLen <= 0.1) return;
    K.box(duvetMat, [w - 0.006, m.matTop + 0.05 - (m.baseTop + 0.08), dLen], [0, m.baseTop + 0.08, dz0 + dLen / 2], { r: 0.05, seg: 2 });
    K.box(pillowMat, [w - 0.004, 0.07, 0.16], [0, m.matTop + 0.005, dz0 + 0.08], { r: 0.035 });
    const throwD = Math.min(0.45, dLen * 0.45);
    K.box(K.mat('fabric', tone(K.color, -0.38)), [w, m.matTop + 0.065 - (m.baseTop + 0.06), throwD], [0, m.baseTop + 0.06, d / 2 - 0.001 - throwD / 2], {
      r: 0.02,
    });
  }

  function buildNightstand(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const legH = clamp(h * 0.18, 0.03, 0.15);
    const zf = d / 2 - FRONT_T - 0.024;
    cornerLegs(K, wood, { size: 0.03, inset: 0.02, height: legH, round: true, taper: 0.6 });
    carcass(K, wood, legH, h, zf, { r: 0.006 });
    const cells = gridCells(-w / 2 + 0.02, w / 2 - 0.02, legH + 0.02, h - 0.03, 1, 2, 'drawer');
    drawFronts(K, cells, zf, K.mat('wood', tone(K.color, 0.06)), { handle: 'knob', handleMat: K.mat('metal', C.brass) });
  }

  function buildDresser(K) {
    const { w, d, h } = K;
    const wood = K.mat('wood', K.color);
    const legH = clamp(h * 0.13, 0.03, 0.14);
    const zf = d / 2 - FRONT_T - 0.024;
    cornerLegs(K, wood, { size: 0.04, inset: 0.03, height: legH, round: true, taper: 0.6 });
    carcass(K, wood, legH, h, zf, { r: 0.006 });
    const cols = w > 1.0 ? 2 : 1;
    const rows = clamp(Math.round((h - legH) / 0.24), 1, 6);
    const cells = gridCells(-w / 2 + 0.02, w / 2 - 0.02, legH + 0.02, h - 0.03, cols, rows, 'drawer');
    drawFronts(K, cells, zf, K.mat('wood', tone(K.color, 0.05)), { handle: 'bar', handleMat: K.mat('metal', C.brass) });
  }

  function buildWardrobe(K) {
    const { w, d, h } = K;
    const body = K.mat('lacquer', K.color);
    const plinthH = clamp(h * 0.035, 0.03, 0.1);
    const zf = d / 2 - FRONT_T - 0.024;
    carcass(K, K.mat('plastic', tone(K.color, -0.5)), 0, plinthH, zf - 0.05, { w: w - 0.02 });
    carcass(K, body, plinthH, h, zf);
    const n = clamp(Math.round(w / 0.5), 1, 10);
    drawFronts(K, doorCells(-w / 2, w / 2, plinthH, h, n), zf, body, {
      handle: 'bar',
      handleMat: K.mat('metal', C.blackMetal),
      doorHandleY: Math.min(1.05, (plinthH + h) / 2),
      barLen: clamp(h * 0.25, 0.1, 0.6),
    });
  }

  function buildDesk(K) {
    const { w, d, h } = K;
    const top = K.mat('wood', K.color);
    const lacquer = K.mat('lacquer', '#EDEAE4');
    const metal = K.mat('metal', C.blackMetal);
    const t = clamp(h * 0.04, 0.015, 0.04);
    K.box(top, [w, t, d], [0, h - t, 0], { r: 0.006, part: 'top' });
    if (w < 0.8) {
      cornerLegs(K, metal, { size: 0.035, inset: 0.03, height: h - t });
      return;
    }
    const pedW = clamp(w * 0.34, 0.25, 0.45);
    const px = -w / 2 + pedW / 2 + 0.01;
    const zf = d / 2 - FRONT_T - 0.05;
    carcass(K, lacquer, 0.02, h - t, zf, { w: pedW, cx: px, zBack: -d / 2 + 0.02 });
    const cells = gridCells(px - pedW / 2, px + pedW / 2, 0.03, h - t - 0.01, 1, 3, 'drawer');
    drawFronts(K, cells, zf, lacquer, { handle: 'bar', handleMat: metal });
    const lx = w / 2 - 0.045;
    for (const s of [-1, 1]) K.box(metal, [0.04, h - t, 0.04], [lx, 0, s * (d / 2 - 0.05)]);
    K.box(metal, [0.03, 0.03, d - 0.1], [lx, 0.1, 0]);
    const panelW = w - pedW - 0.1;
    K.box(lacquer, [panelW, h * 0.35, 0.015], [px + pedW / 2 + panelW / 2 + 0.01, h - t - h * 0.35, -d / 2 + 0.06]);
  }

  function buildClosetIsland(K) {
    const { w, d, h } = K;
    const body = K.mat('lacquer', K.color);
    const wood = K.mat('wood', '#B89A74');
    const plinthH = clamp(h * 0.09, 0.03, 0.1);
    const topT = 0.03;
    const zf = d / 2 - FRONT_T - 0.024;
    K.box(K.mat('plastic', tone(K.color, -0.5)), [Math.max(0.05, w - 0.1), plinthH, Math.max(0.05, d - 0.1)], [0, 0, 0]);
    K.box(body, [w, h - topT - plinthH, 2 * zf], [0, plinthH, 0]);
    const cols = w > 0.9 ? 2 : 1;
    for (const rot of [0, PI]) {
      const S = K.sub({ w, d, h }, [0, 0, 0], rot);
      drawFronts(S, gridCells(-w / 2, w / 2, plinthH, h - topT, cols, 3, 'drawer'), zf, body, {
        handle: 'bar',
        handleMat: K.mat('metal', C.brass),
      });
    }
    const fw = Math.min(0.05, w * 0.1, d * 0.1);
    for (const s of [-1, 1]) {
      K.box(wood, [w, topT, fw], [0, h - topT, s * (d / 2 - fw / 2)]);
      K.box(wood, [fw, topT, d - 2 * fw], [s * (w / 2 - fw / 2), h - topT, 0]);
    }
    K.box(K.mat('fabric', '#3E2F3A'), [w - 2 * fw, 0.004, d - 2 * fw], [0, h - topT, 0]);
    const dividers = Math.max(1, Math.round(w / 0.25)) - 1;
    for (let i = 1; i <= dividers; i++) {
      K.box(wood, [0.006, 0.014, d - 2 * fw], [-w / 2 + fw + ((w - 2 * fw) * i) / (dividers + 1), h - topT + 0.004, 0]);
    }
    K.box(K.mat('glass', '#DCEBEE'), [w - 2 * fw, 0.008, d - 2 * fw], [0, h - 0.01, 0], { part: 'glass' });
  }

  // ================================================================== KITCHEN & SERVICE
  /** Base-cabinet fronts: first unit a drawer stack, the rest paired doors. */
  function baseCells(x0, x1, y0, y1) {
    const units = Math.max(1, Math.round((x1 - x0) / 0.5));
    const uw = (x1 - x0) / units;
    let cells = [];
    if (units > 1) cells = gridCells(x0, x0 + uw, y0, y1, 1, 3, 'drawer');
    const first = units > 1 ? 1 : 0;
    return cells.concat(doorCells(x0 + first * uw, x1, y0, y1, units - first));
  }

  /** Base cabinet run with a dark stone top; o.sink adds an undermount steel bowl and faucet. */
  function buildBaseRun(K, o) {
    const { w, d, h } = K;
    const body = K.mat('lacquer', K.color);
    const stone = K.mat('stone', C.stoneDark);
    const topT = clamp(h * 0.035, 0.015, 0.04);
    const plinthH = clamp(h * 0.11, 0.04, 0.15);
    const zf = d / 2 - FRONT_T - 0.024;
    carcass(K, K.mat('plastic', tone(K.color, -0.55)), 0, plinthH, zf - 0.05, { w: w - 0.01 });
    carcass(K, body, plinthH, h - topT, zf);
    drawFronts(K, baseCells(-w / 2, w / 2, plinthH, h - topT), zf, body, {
      handle: 'bar',
      handleMat: K.mat('chrome', C.chrome),
      verticalBars: false,
    });
    if (o.sink && w >= 0.45 && d >= 0.35) sinkTop(K, stone, topT);
    else K.box(stone, [w, topT, d], [0, h - topT, 0], { part: 'top' });
  }

  function sinkTop(K, stone, topT) {
    const { w, d, h } = K;
    const steel = K.mat('steel', '#C8CCCF');
    const sw = clamp(w * 0.4, 0.3, Math.min(0.9, w - 0.1));
    const sd = clamp(d - 0.2, 0.2, 0.45);
    const zc = d / 2 - 0.07 - sd / 2;
    const y = h - topT;
    const zBack = zc - sd / 2;
    const zFront = zc + sd / 2;
    const sideW = (w - sw) / 2;
    K.box(stone, [w, topT, zBack + d / 2], [0, y, (zBack - d / 2) / 2], { part: 'top' });
    K.box(stone, [w, topT, d / 2 - zFront], [0, y, (zFront + d / 2) / 2], { part: 'top' });
    for (const s of [-1, 1]) K.box(stone, [sideW, topT, sd], [s * (sw / 2 + sideW / 2), y, zc], { part: 'top' });
    const bd = clamp(h * 0.2, 0.08, 0.22);
    K.box(steel, [sw, 0.01, sd], [0, h - bd, zc], { part: 'sink' });
    for (const s of [-1, 1]) {
      K.box(steel, [sw, bd - 0.002, 0.01], [0, h - bd, zc + s * (sd / 2 - 0.005)]);
      K.box(steel, [0.01, bd - 0.002, sd], [s * (sw / 2 - 0.005), h - bd, zc]);
    }
    K.cyl(K.mat('metal', '#5B5F63'), 0.035, 0.035, 0.004, [0, h - bd + 0.01, zc], { seg: 12 });
    faucet(K, [0, h, zBack - 0.045], 0.28, Math.min(0.2, sd * 0.5));
  }

  function buildIsland(K) {
    const { w, d, h } = K;
    const body = K.mat('lacquer', K.color);
    const stone = K.mat('stone', C.stoneDark);
    const topT = clamp(h * 0.035, 0.015, 0.05);
    const plinthH = clamp(h * 0.11, 0.04, 0.15);
    const overhang = clamp(d * 0.28, 0, 0.3);
    const zf = d / 2 - FRONT_T - 0.024;
    const zBack = -d / 2 + overhang;
    const innerW = Math.max(0.05, w - 2 * topT);
    K.box(stone, [w, topT, d], [0, h - topT, 0], { part: 'top' });
    for (const s of [-1, 1]) K.box(stone, [topT, h - topT, d], [s * (w / 2 - topT / 2), 0, 0]);
    carcass(K, K.mat('plastic', tone(K.color, -0.55)), 0, plinthH, zf - 0.05, { w: innerW, zBack });
    carcass(K, body, plinthH, h - topT, zf, { w: innerW, zBack });
    const units = Math.max(1, Math.round(innerW / 0.5));
    const uw = innerW / units;
    let cells = [];
    for (let u = 0; u < units; u++) {
      const x0 = -innerW / 2 + u * uw;
      const edge = u === 0 || u === units - 1;
      cells = cells.concat(edge ? gridCells(x0, x0 + uw, plinthH, h - topT, 1, 3, 'drawer') : doorCells(x0, x0 + uw, plinthH, h - topT, 1));
    }
    drawFronts(K, cells, zf, body, { handle: 'bar', handleMat: K.mat('chrome', C.chrome), verticalBars: false });
  }

  function buildUpperCabinet(K) {
    const { w, d, h } = K;
    const body = K.mat('lacquer', K.color);
    const zf = d / 2 - FRONT_T - 0.002;
    carcass(K, body, 0.01, h, zf);
    K.box(K.mat('light', '#FFF1D6'), [Math.max(0.02, w - 0.06), 0.008, 0.02], [0, 0.001, zf - 0.04]);
    const n = Math.max(1, Math.round(w / 0.45));
    drawFronts(K, doorCells(-w / 2, w / 2, 0, h, n), zf, body, { handle: 'none' });
    K.box(K.mat('metal', C.blackMetal), [w - 0.01, 0.012, 0.004], [0, 0, d / 2 - 0.002]);
  }

  function buildStove(K) {
    const { w, d, h } = K;
    const steel = K.mat('steel', K.color);
    const black = K.mat('screen', '#111214');
    const iron = K.mat('metal', '#26272A');
    const chrome = K.mat('chrome', C.chrome);
    const feetH = clamp(h * 0.08, 0.03, 0.09);
    const hb = h - 0.05;
    const zf = d / 2 - 0.06;
    cornerLegs(K, K.mat('plastic', C.plasticDark), { size: 0.035, inset: 0.03, height: feetH, round: true });
    carcass(K, steel, feetH, hb, zf);
    K.box(black, [w, 0.012, d - 0.02], [0, hb, 0.01], { part: 'cooktop' });
    K.box(steel, [w, h - hb, 0.02], [0, hb, -d / 2 + 0.01]);
    stoveBurners(K, hb + 0.012, iron);
    const panelH = Math.min(0.08, (hb - feetH) * 0.15);
    K.box(K.mat('plastic', C.plasticDark), [w - 0.02, panelH, 0.006], [0, hb - panelH - 0.01, zf]);
    for (let i = 0; i < 5; i++) {
      K.cyl(chrome, 0.017, 0.019, 0.025, [-w * 0.36 + (i * w * 0.72) / 4, hb - panelH / 2 - 0.01, zf + 0.0185], {
        rot: [HALF_PI, 0, 0],
        center: true,
        seg: 12,
      });
    }
    const doorY0 = feetH + 0.1;
    const doorH = Math.max(0.1, hb - panelH - 0.03 - doorY0);
    K.box(steel, [w - 0.02, doorH, 0.025], [0, doorY0, zf + 0.0125], { r: 0.006 });
    K.box(K.mat('darkGlass', C.carGlass), [w * 0.62, doorH * 0.45, 0.004], [0, doorY0 + doorH * 0.25, zf + 0.026]);
    K.cyl(chrome, 0.01, 0.01, w * 0.7, [0, doorY0 + doorH - 0.04, d / 2 - 0.012], { rot: [0, 0, HALF_PI], center: true, seg: 8 });
    K.box(steel, [w - 0.02, 0.08, 0.02], [0, feetH + 0.01, zf + 0.01]);
  }

  function stoveBurners(K, y, iron) {
    const { w, d } = K;
    const spots = [[-0.25, -0.2, 0.04], [0.25, -0.2, 0.04], [-0.25, 0.2, 0.04], [0.25, 0.2, 0.04], [0, 0, 0.055]];
    const scale = clamp(Math.min(w / 0.76, d / 0.65), 0.4, 1.6);
    for (const [fx, fz, r] of spots) {
      const x = fx * w, z = fz * (d - 0.04) + 0.01, rr = r * scale;
      K.cyl(iron, rr * 1.35, rr * 1.4, 0.008, [x, y, z], { seg: 14 });
      K.cyl(K.mat('metal', '#101012'), rr, rr, 0.012, [x, y + 0.008, z], { seg: 14 });
    }
    for (const s of [-1, 1]) {
      const gz = s * (d - 0.04) * 0.2 + 0.01;
      for (const t of [-1, 0, 1]) K.box(iron, [w * 0.9, 0.01, 0.01], [0, y + 0.018, gz + t * 0.06 * scale]);
    }
    for (const t of [-1, 1]) K.box(iron, [0.01, 0.01, (d - 0.04) * 0.75], [t * w * 0.25, y + 0.018, 0.01]);
  }

  function buildFridge(K) {
    const { w, d, h } = K;
    const steel = K.mat('steel', K.color);
    const handleMat = K.mat('chrome', C.chrome);
    const feetH = 0.02;
    const doorT = 0.045;
    const zf = d / 2 - 0.075;
    cornerLegs(K, K.mat('plastic', C.plasticDark), { size: 0.04, inset: 0.04, height: feetH, round: true });
    carcass(K, steel, feetH, h, zf, { r: 0.015 });
    const split = feetH + (h - feetH) * 0.68;
    K.box(steel, [w - 0.006, split - feetH - 0.004, doorT], [0, feetH + 0.002, zf + doorT / 2], { r: 0.012, part: 'door' });
    K.box(steel, [w - 0.006, h - split - 0.006, doorT], [0, split + 0.002, zf + doorT / 2], { r: 0.012, part: 'door' });
    const hx = w / 2 - Math.min(0.06, w * 0.12);
    const hz = zf + doorT + 0.018;
    const lowLen = Math.min(0.6, (split - feetH) * 0.45);
    const upLen = Math.min(0.35, (h - split) * 0.5);
    K.box(handleMat, [0.02, lowLen, 0.02], [hx, split - 0.06 - lowLen, hz]);
    K.box(handleMat, [0.02, upLen, 0.02], [hx, split + 0.06, hz]);
    K.box(K.mat('screen', C.screen), [Math.min(0.08, w * 0.2), 0.1, 0.004], [-w / 2 + Math.min(0.12, w * 0.25), split - 0.3, zf + doorT + 0.002]);
  }

  function buildWasher(K) {
    const { w, d, h } = K;
    const body = K.mat('lacquer', K.color);
    const chrome = K.mat('chrome', C.chrome);
    const zf = d / 2 - 0.04;
    cornerLegs(K, K.mat('plastic', C.plasticDark), { size: 0.04, inset: 0.03, height: 0.015 });
    carcass(K, body, 0.015, h, zf, { r: 0.015 });
    const ph = clamp(h * 0.13, 0.04, 0.12);
    K.box(K.mat('plastic', tone(K.color, -0.06)), [w - 0.02, ph, 0.01], [0, h - ph - 0.015, zf]);
    K.box(body, [w * 0.3, ph * 0.6, 0.012], [-w / 2 + w * 0.18, h - ph * 0.85, zf + 0.004]);
    K.box(K.mat('screen', C.screen), [w * 0.18, ph * 0.35, 0.004], [w * 0.05, h - ph * 0.7, zf + 0.01]);
    K.cyl(chrome, 0.026, 0.028, 0.02, [w * 0.32, h - ph / 2 - 0.015, zf + 0.02], { rot: [HALF_PI, 0, 0], center: true, seg: 16 });
    const R = clamp(Math.min(w, h - ph) * 0.3, 0.05, 0.3);
    const cy = Math.max(R + 0.05, (h - ph) * 0.48);
    const tube = Math.min(R * 0.12, 0.018);
    K.cyl(K.mat('plastic', '#D6D6D3'), R * 1.18, R * 1.18, 0.012, [0, cy, zf + 0.006], { rot: [HALF_PI, 0, 0], center: true, seg: 24 });
    K.torus(chrome, R, tube, [0, cy, zf + 0.012 + tube], { radial: 6, tubular: 24, part: 'door' });
    K.cyl(K.mat('darkGlass', '#2A3238'), R * 0.9, R * 0.9, 0.02, [0, cy, zf + 0.012], { rot: [HALF_PI, 0, 0], center: true, seg: 24 });
  }

  function buildMetalShelves(K) {
    const { w, d, h } = K;
    const metal = K.mat('metal', K.color);
    const post = clamp(Math.min(w, d) * 0.08, 0.015, 0.035);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) K.box(metal, [post, h, post], [sx * (w / 2 - post / 2), 0, sz * (d / 2 - post / 2)]);
    }
    const n = clamp(Math.round(h / 0.42), 2, 10);
    const yBottom = Math.min(0.08, h * 0.1);
    const step = (h - 0.02 - yBottom) / (n - 1);
    for (let i = 0; i < n; i++) {
      const y = yBottom + i * step;
      K.box(metal, [w - 0.004, 0.012, d - 0.004], [0, y, 0]);
      for (const s of [-1, 1]) K.box(metal, [w - 0.004, 0.03, 0.006], [0, y - 0.018, s * (d / 2 - 0.005)]);
      if (i < n - 1) shelfItems(K, y + 0.012, step - 0.03);
    }
  }

  function shelfItems(K, y, hAvail) {
    const { w, d } = K;
    const rng = K.rng;
    const count = 1 + Math.floor(rng() * 3);
    const slot = (w - 0.06) / count;
    for (let i = 0; i < count; i++) {
      if (rng() < 0.2) continue;
      const bw = slot * (0.6 + rng() * 0.3);
      const bh = Math.min(hAvail, 0.12 + rng() * 0.18);
      const bd = Math.max(0.03, Math.min(d - 0.04, 0.2 + rng() * 0.15));
      if (bh < 0.04) continue;
      const kind = rng() < 0.5 ? 'plastic' : 'paper';
      K.box(K.mat(kind, pick(rng, BIN_COLORS)), [bw, bh, bd], [-w / 2 + 0.03 + slot * (i + 0.5), y, 0], { r: kind === 'plastic' ? 0.01 : 0 });
    }
  }

  // ================================================================== BATHROOM
  function buildToilet(K) {
    const { w, d, h } = K;
    const ceramic = K.mat('ceramic', K.color);
    const chrome = K.mat('chrome', C.chrome);
    const z0 = -d / 2;
    const tankD = clamp(d * 0.27, 0.08, 0.24);
    const tankW = w * 0.96;
    const rimY = clamp(h * 0.5, 0.1, 0.45);
    const tankY0 = clamp(h * 0.47, rimY - 0.05, h - 0.08);
    K.box(ceramic, [tankW, h - 0.027 - tankY0, tankD], [0, tankY0, z0 + tankD / 2 + 0.005], { r: 0.025, seg: 2, part: 'tank' });
    K.box(ceramic, [w, 0.022, tankD + 0.01], [0, h - 0.027, z0 + tankD / 2 + 0.005], { r: 0.008, part: 'tank' });
    K.cyl(chrome, 0.02, 0.02, 0.006, [0, h - 0.006, z0 + tankD / 2 + 0.005], { seg: 14 });
    const bR = w * 0.47;
    const bL = (d - tankD + 0.06) / 2;
    const zc = d / 2 - bL;
    K.lathe(ceramic, TOILET_BOWL_PROFILE, [0, 0, zc], { scale: [bR, rimY, bL], seg: 20, part: 'bowl' });
    K.cyl(ceramic, 1, 1, 0.018, [0, rimY, zc], { seg: 20, scaleXZ: [bR, bL] });
    K.cyl(ceramic, 0.96, 0.97, 0.022, [0, rimY + 0.018, zc], { seg: 20, scaleXZ: [bR, bL], part: 'lid' });
    K.cyl(chrome, 0.012, 0.012, bR * 0.9, [0, rimY + 0.03, zc - bL + 0.03], { rot: [0, 0, HALF_PI], center: true, seg: 8 });
  }

  /** Floor vanity with doors, ceramic counter and an oval vessel basin + tall faucet. */
  function buildBasin(K) {
    const { w, d, h } = K;
    const ceramic = K.mat('ceramic', K.color);
    const wood = K.mat('wood', '#8B6B4A');
    const vh = clamp(h * 0.16, 0.06, 0.16);
    const counterTop = h - vh;
    const topT = 0.03;
    const plinthH = clamp(h * 0.1, 0.03, 0.12);
    const zf = d / 2 - FRONT_T - 0.024;
    carcass(K, K.mat('plastic', C.plasticDark), 0, plinthH, zf - 0.04, { w: w - 0.02 });
    carcass(K, wood, plinthH, counterTop - topT, zf);
    const n = w > 0.6 ? 2 : 1;
    drawFronts(K, doorCells(-w / 2, w / 2, plinthH, counterTop - topT, n), zf, wood, {
      handle: 'bar',
      handleMat: K.mat('metal', C.blackMetal),
    });
    K.box(ceramic, [w, topT, d], [0, counterTop - topT, 0], { r: 0.006 });
    const R = Math.min(w * 0.25, d * 0.38, 0.2);
    const zc = d * 0.06;
    K.lathe(ceramic, VESSEL_PROFILE, [0, counterTop, zc], { scale: [R * 1.25, vh, R], seg: 20, part: 'bowl' });
    K.cyl(K.mat('chrome', C.chrome), R * 0.12, R * 0.12, 0.004, [0, counterTop + vh * 0.18, zc], { seg: 12 });
    faucet(K, [0, counterTop, Math.max(-d / 2 + 0.03, zc - R - 0.04)], vh + 0.15, Math.max(0.06, R * 0.9));
  }

  function buildShower(K) {
    const { w, d, h } = K;
    const glass = K.mat('glass', K.color);
    const chrome = K.mat('chrome', C.chrome);
    const trayH = clamp(h * 0.025, 0.015, 0.06);
    K.box(K.mat('ceramic', '#F4F3F0'), [w, trayH, d], [0, 0, 0], { r: 0.008 });
    K.box(chrome, [0.1, 0.004, 0.1], [0, trayH, 0]);
    const gh = h - trayH - 0.03;
    const fw = w * 0.5 + 0.04;
    K.box(glass, [0.008, gh, d - 0.03], [w / 2 - 0.012, trayH, -0.015], { part: 'glass' });
    K.box(glass, [fw, gh, 0.008], [w / 2 - 0.02 - fw / 2, trayH, d / 2 - 0.012], { part: 'glass' });
    K.box(glass, [fw, gh, 0.008], [-w / 2 + 0.02 + fw / 2, trayH, d / 2 - 0.03], { part: 'glass' });
    K.box(chrome, [w - 0.01, 0.02, 0.035], [0, h - 0.03, d / 2 - 0.021]);
    K.box(chrome, [0.02, 0.02, d - 0.01], [w / 2 - 0.012, h - 0.03, 0]);
    K.box(chrome, [0.02, gh, 0.02], [-w / 2 + 0.01, trayH, d / 2 - 0.021]);
    K.box(chrome, [0.02, gh, 0.02], [w / 2 - 0.012, trayH, -d / 2 + 0.01]);
    K.box(chrome, [0.015, Math.min(0.3, gh * 0.2), 0.02], [-w / 2 + fw - 0.04, trayH + gh * 0.45, d / 2 - 0.015]);
    showerColumn(K, chrome);
  }

  function showerColumn(K, chrome) {
    const { w, d, h } = K;
    const z = -d / 2 + 0.035;
    const mixerY = clamp(h * 0.55, 0.3, 1.2);
    const headY = h - 0.1;
    const armLen = clamp(d * 0.35, 0.1, 0.35);
    const headR = clamp(Math.min(w, d) * 0.14, 0.05, 0.15);
    K.box(chrome, [0.07, 0.12, 0.03], [0, mixerY - 0.06, -d / 2 + 0.015], { r: 0.008 });
    K.box(chrome, [0.012, 0.012, 0.08], [0, mixerY, -d / 2 + 0.07], { center: true });
    K.cyl(chrome, 0.012, 0.012, Math.max(0.05, headY - mixerY), [0, mixerY, z], { seg: 10 });
    K.cyl(chrome, 0.01, 0.01, armLen, [0, headY, z + armLen / 2], { rot: [HALF_PI, 0, 0], center: true, seg: 8 });
    K.cyl(chrome, headR, headR, 0.012, [0, headY - 0.02, z + armLen], { seg: 20, part: 'showerHead' });
  }

  function buildBathtub(K) {
    const { w, d, h } = K;
    const ceramic = K.mat('ceramic', K.color);
    const chrome = K.mat('chrome', C.chrome);
    const t = clamp(Math.min(w, d) * 0.085, 0.03, 0.1);
    const floorH = clamp(h * 0.2, 0.03, 0.15);
    const r = Math.min(0.03, t / 2);
    for (const s of [-1, 1]) {
      K.box(ceramic, [w, h, t], [0, 0, s * (d / 2 - t / 2)], { r });
      K.box(ceramic, [t, h, d - 2 * t + 0.01], [s * (w / 2 - t / 2), 0, 0], { r });
    }
    K.box(ceramic, [w - 2 * t + 0.02, floorH, d - 2 * t + 0.02], [0, 0, 0]);
    const inner = -w / 2 + t;
    K.cyl(chrome, 0.03, 0.03, 0.006, [inner + 0.12, floorH, 0], { seg: 12 });
    K.cyl(chrome, 0.03, 0.03, 0.006, [inner + 0.003, Math.max(floorH + 0.05, h - 0.12), 0], { rot: [0, 0, HALF_PI], center: true, seg: 12 });
    K.cyl(chrome, 0.016, 0.016, 0.14, [inner + 0.07, h - 0.06, 0], { rot: [0, 0, HALF_PI], center: true, seg: 10, part: 'spout' });
    K.box(chrome, [0.006, 0.05, 0.16], [inner + 0.003, h - 0.09, 0], { center: true });
    const restD = Math.min(0.35, d - 2 * t - 0.1);
    if (restD > 0.1 && h > 0.3) {
      K.box(K.mat('soft', '#D9D4CC'), [0.08, 0.2, restD], [w / 2 - t - 0.06, h - 0.26, 0], { r: 0.03, rot: [0, 0, 0.35] });
    }
  }

  // ================================================================== CAR (length along Z, FRONT at +Z)
  function archPoints(pts, zc, R, ra, c) {
    const beta = Math.asin(clamp((R - c) / ra, -1, 1));
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const phi = PI + beta - (i / n) * (PI + 2 * beta);
      pts.push([zc + ra * Math.cos(phi), R + ra * Math.sin(phi)]);
    }
  }

  /** Side silhouette (z, y) of the lower body with wheel-arch cut-outs; front/back faces recessed 2 cm. */
  function carLowerProfile(g) {
    const pts = [];
    const zF = g.L / 2 - 0.02, zR = -g.L / 2 + 0.02;
    pts.push([zR + 0.1 * g.sL, g.c + 0.04]);
    archPoints(pts, g.zr, g.R, g.ra, g.c);
    archPoints(pts, g.zf, g.R, g.ra, g.c);
    pts.push([zF - 0.1 * g.sL, g.c + 0.04]);
    pts.push([zF, g.c + 0.2 * g.sH]);
    pts.push([zF, g.yh - 0.1 * g.sH]);
    pts.push([zF - 0.1 * g.sL, g.yh]);
    pts.push([zF - 0.4 * g.sL, g.yh + 0.04 * g.sH]);
    pts.push([g.zWs, g.yb + 0.03 * g.sH]);
    pts.push([zR + 0.12 * g.sL, g.yb + 0.02 * g.sH]);
    pts.push([zR, g.yb - 0.08 * g.sH]);
    pts.push([zR, g.c + 0.2 * g.sH]);
    return pts;
  }

  /** Extrudes a (z, y) profile across X and fits it to the given box. */
  function extrudeProfile(K, mat, pts, xHalf, bevel, part) {
    const T = K.T;
    const shape = new T.Shape(pts.map((p) => new T.Vector2(p[0], p[1])));
    const geo = new T.ExtrudeGeometry(shape, {
      depth: Math.max(xHalf * 2 - 2 * bevel, 0.01),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 4,
      steps: 1,
    });
    geo.rotateY(-HALF_PI);
    const zs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    fitGeometry(geo, [-xHalf, Math.min.apply(null, ys), Math.min.apply(null, zs)], [xHalf, Math.max.apply(null, ys), Math.max.apply(null, zs)]);
    K.geometry(mat, geo, { part });
  }

  function carGeometry(K) {
    const { w, d, h } = K;
    const sL = d / 4.6, sH = h / 1.65, sW = w / 1.85;
    const R = clamp(0.36 * sH, 0.12, d * 0.1);
    const g = { L: d, sL, sH, sW, R, c: R * 0.55, ra: R + 0.05 * Math.min(sH, 1.5) };
    g.zf = d / 2 - 0.9 * sL;
    g.zr = -d / 2 + 0.95 * sL;
    g.yb = 1.0 * sH;
    g.yh = 0.9 * sH;
    g.zWs = d / 2 - 1.2 * sL;
    g.bodyW = w - 0.1 * sW;
    g.cabW = g.bodyW - 0.16 * sW;
    g.zRoofF = d / 2 - 1.95 * sL;
    g.zRoofR = -d / 2 + 0.3 * sL;
    g.zRearBase = -d / 2 + 0.14 * sL;
    g.yTop = h - 0.06 * sH;
    return g;
  }

  function buildCar(K) {
    const g = carGeometry(K);
    const paint = K.mat('paint', K.color);
    extrudeProfile(K, paint, carLowerProfile(g), g.bodyW / 2, 0.03 * g.sH, 'body');
    const cabin = [[g.zRearBase, g.yb - 0.02], [g.zWs, g.yb - 0.02], [g.zRoofF, g.yTop], [g.zRoofR, g.yTop]];
    extrudeProfile(K, K.mat('darkGlass', C.carGlass), cabin, g.cabW / 2, 0.025 * g.sH, 'cabin');
    carRoofAndPillars(K, g, paint);
    carFront(K, g);
    carRear(K, g);
    for (const z of [g.zr, g.zf]) for (const s of [-1, 1]) carWheel(K, g, z, s);
    carSides(K, g, paint);
  }

  function carRoofAndPillars(K, g, paint) {
    const black = K.mat('plastic', C.plasticDark);
    const roofLen = g.zRoofF - g.zRoofR + 0.06;
    K.box(paint, [g.cabW + 0.02, 0.05 * g.sH, roofLen], [0, g.yTop - 0.02, (g.zRoofF + g.zRoofR) / 2], { r: 0.02, part: 'roof' });
    for (const s of [-1, 1]) {
      const x = s * (g.cabW / 2 + 0.006);
      K.box(black, [0.03, 0.03, roofLen * 0.85], [s * (g.cabW / 2 - 0.06), K.h - 0.03, (g.zRoofF + g.zRoofR) / 2]);
      K.beam(paint, [x, g.yb, g.zWs - 0.02], [x, g.yTop, g.zRoofF - 0.02], [0.014, 0.08]);
      K.beam(paint, [x, g.yb, g.zRearBase + 0.05], [x, g.yTop, g.zRoofR + 0.05], [0.014, 0.12]);
      const zB = (g.zWs + g.zRoofR) / 2 + 0.1 * g.sL;
      K.box(paint, [0.014, g.yTop - g.yb, 0.1 * g.sL], [x, g.yb, zB]);
      K.box(K.mat('chrome', C.chrome), [0.01, 0.015, g.zWs - g.zRearBase], [x, g.yb - 0.005, (g.zWs + g.zRearBase) / 2]);
    }
  }

  function carFront(K, g) {
    const L2 = K.d / 2;
    const black = K.mat('plastic', C.plasticDark);
    const lamp = K.mat('light', C.headlight);
    const lx = g.bodyW / 2 - 0.2 * g.sW;
    for (const s of [-1, 1]) {
      K.box(lamp, [0.32 * g.sW, 0.075 * g.sH, 0.02], [s * lx, g.yh - 0.15 * g.sH, L2 - 0.012], { part: 'headlight' });
    }
    K.box(black, [g.bodyW * 0.46, 0.22 * g.sH, 0.02], [0, g.yh - 0.33 * g.sH, L2 - 0.014], { part: 'grille' });
    const chrome = K.mat('chrome', C.chrome);
    for (let i = 0; i < 3; i++) {
      K.box(chrome, [g.bodyW * 0.44, 0.008, 0.006], [0, g.yh - (0.3 - i * 0.07) * g.sH, L2 - 0.003]);
    }
    K.box(black, [g.bodyW, 0.17 * g.sH, 0.06], [0, g.c + 0.02, L2 - 0.038], { part: 'bumperFront' });
    licensePlate(K, g, L2 - 0.004, 1);
  }

  function carRear(K, g) {
    const L2 = K.d / 2;
    const black = K.mat('plastic', C.plasticDark);
    const lamp = K.mat('light', C.taillight);
    const lx = g.bodyW / 2 - 0.12 * g.sW;
    for (const s of [-1, 1]) {
      K.box(lamp, [0.2 * g.sW, 0.1 * g.sH, 0.02], [s * lx, g.yb - 0.2 * g.sH, -L2 + 0.012], { part: 'taillight' });
    }
    K.box(black, [g.bodyW, 0.17 * g.sH, 0.06], [0, g.c + 0.02, -L2 + 0.038], { part: 'bumperRear' });
    licensePlate(K, g, -L2 + 0.004, -1);
  }

  /** Mercosul plate: white with a blue top band. zFace is the plate centre plane; dir = +1 front / -1 rear. */
  function licensePlate(K, g, z, dir) {
    const pw = 0.4 * g.sW, ph = 0.13 * g.sH;
    const y0 = g.c + 0.035;
    K.box(K.mat('plastic', '#F4F4F2'), [pw, ph, 0.006], [0, y0, z]);
    K.box(K.mat('plastic', C.plateBlue), [pw, 0.03 * g.sH, 0.007], [0, y0 + ph - 0.03 * g.sH, z + dir * 0.0005]);
  }

  function carWheel(K, g, z, side) {
    const tw = clamp(0.235 * g.sW, 0.08, 0.4);
    const x = side * (g.bodyW / 2 - tw / 2 - 0.005);
    const R = g.R;
    const rot = { rot: [0, 0, HALF_PI], center: true };
    const wellLen = Math.max(0.02, g.bodyW / 2 - tw - 0.02);
    K.box(K.mat('plastic', '#141516'), [wellLen, R + g.ra - 0.01 - g.c, 2 * (g.ra - 0.005)], [side * (0.01 + wellLen / 2), g.c, z]);
    K.cyl(K.mat('rubber', C.rubber), R, R, tw, [x, R, z], Object.assign({ seg: 20, part: 'wheel' }, rot));
    const rimMat = K.mat('chrome', '#B9BDC1');
    const face = x + side * (tw / 2);
    K.cyl(rimMat, R * 0.62, R * 0.62, 0.02, [face - side * 0.005, R, z], Object.assign({ seg: 14 }, rot));
    for (let k = 0; k < 5; k++) {
      K.box(rimMat, [0.012, R * 1.1, 0.05 * g.sW], [face - side * 0.004, R, z], { center: true, rot: [(k * PI) / 5, 0, 0] });
    }
    K.cyl(K.mat('metal', '#3A3D40'), R * 0.15, R * 0.15, 0.024, [face - side * 0.004, R, z], Object.assign({ seg: 10 }, rot));
  }

  function carSides(K, g, paint) {
    const black = K.mat('plastic', C.plasticDark);
    const chrome = K.mat('chrome', C.chrome);
    const zB = (g.zWs + g.zRoofR) / 2 + 0.1 * g.sL;
    const seams = [g.zWs - 0.05 * g.sL, zB, g.zr + g.ra + 0.06 * g.sL];
    for (const s of [-1, 1]) {
      const xs = s * (g.bodyW / 2 + 0.0015);
      for (const z of seams) K.box(black, [0.003, g.yb - g.c - 0.14 * g.sH, 0.006], [xs, g.c + 0.1 * g.sH, z]);
      for (const z of [zB - 0.2 * g.sL, seams[2] - 0.2 * g.sL]) K.box(chrome, [0.006, 0.02, 0.12], [s * (g.bodyW / 2 + 0.002), g.yb - 0.1 * g.sH, z]);
      const sill = g.zf - g.zr - 2 * g.ra - 0.1;
      if (sill > 0.1) K.box(black, [0.012, 0.09 * g.sH, sill], [s * (g.bodyW / 2 - 0.004), g.c + 0.01, (g.zf + g.zr) / 2]);
      const mx = s * (K.w / 2 - 0.035);
      K.box(paint, [0.06, 0.08 * g.sH, 0.14 * g.sL], [mx, g.yb + 0.06 * g.sH, g.zWs - 0.12 * g.sL], { r: 0.015, part: 'mirror' });
      K.box(black, [Math.abs(mx) - g.cabW / 2, 0.03, 0.05], [s * ((Math.abs(mx) + g.cabW / 2) / 2), g.yb + 0.07 * g.sH, g.zWs - 0.12 * g.sL]);
    }
  }

  // ================================================================== OUTDOOR
  /** Brick barbecue: coursed base with firewood niche, counter, grill chamber, hood and chimney. */
  function buildBbq(K) {
    const { w, d, h } = K;
    const brickA = K.mat('brick', K.color);
    const brickB = K.mat('brick', tone(K.color, -0.1));
    const stone = K.mat('stone', C.stoneLight);
    const baseH = Math.min(0.9, h * 0.375);
    const counterT = 0.05;
    const nicheW = w * 0.5;
    const pw = (w - nicheW) / 2;
    const courses = Math.max(3, Math.round(baseH / 0.075));
    const ch = baseH / courses;
    for (let i = 0; i < courses; i++) {
      const mat = i % 2 ? brickB : brickA;
      for (const s of [-1, 1]) K.box(mat, [pw, ch, d], [s * (w / 2 - pw / 2), i * ch, 0]);
    }
    K.box(brickB, [nicheW, baseH, d * 0.3], [0, 0, -d / 2 + d * 0.15]);
    K.box(brickA, [nicheW, Math.min(0.1, baseH * 0.15), d], [0, baseH - Math.min(0.1, baseH * 0.15), 0]);
    firewood(K, nicheW, baseH * 0.7, d);
    K.box(stone, [w, counterT, d], [0, baseH, 0], { part: 'counter' });
    bbqChamber(K, baseH + counterT, brickA, stone);
  }

  function firewood(K, nicheW, maxH, d) {
    const bark = K.mat('wood', C.bark);
    const r = clamp(Math.min(nicheW, maxH) * 0.12, 0.02, 0.05);
    const len = d * 0.6;
    const rows = [[-2, 0], [0, 0], [2, 0], [-1, 1], [1, 1], [0, 2]];
    for (const [ix, iy] of rows) {
      const y = r + iy * r * 1.75;
      if (y + r > maxH) continue;
      K.cyl(bark, r, r, len, [ix * r * 1.02, y, d / 2 - len / 2 - 0.03], { rot: [HALF_PI, 0, 0], center: true, seg: 7 });
    }
  }

  function bbqChamber(K, y0, brick, stone) {
    const { w, d, h } = K;
    const soot = K.mat('concrete', '#2A2522');
    const wall = Math.min(0.12, w * 0.13);
    const chamberH = clamp((h - y0) * 0.45, 0.2, 0.75);
    const hoodY = y0 + chamberH;
    K.box(brick, [w, chamberH, 0.1], [0, y0, -d / 2 + 0.05]);
    for (const s of [-1, 1]) K.box(brick, [wall, chamberH, d - 0.1], [s * (w / 2 - wall / 2), y0, 0.05]);
    K.box(soot, [w - 2 * wall, chamberH, 0.01], [0, y0, -d / 2 + 0.105]);
    K.box(K.mat('concrete', '#1C1A19'), [w - 2 * wall - 0.06, 0.04, d * 0.5], [0, y0, -d * 0.05]);
    const ember = K.mat('light', C.ember);
    for (let i = 0; i < 5; i++) {
      K.sphere(ember, 0.025, [(i - 2) * (w - 2 * wall) * 0.16, y0 + 0.04, -d * 0.05 + ((i % 2) - 0.5) * 0.08], { detail: 0, scale: [1, 0.5, 1] });
    }
    const chrome = K.mat('chrome', C.chrome);
    const grillY = y0 + Math.min(0.25, chamberH * 0.4);
    for (let i = 0; i < 6; i++) {
      K.cyl(chrome, 0.005, 0.005, w - 2 * wall, [0, grillY, -d / 2 + 0.16 + i * ((d - 0.22) / 5)], { rot: [0, 0, HALF_PI], center: true, seg: 6 });
    }
    K.box(stone, [w, 0.08, d], [0, hoodY, 0]);
    const hoodH = (h - hoodY - 0.08) * 0.45;
    K.frustum(brick, [w, d], 0.42, hoodH, [0, hoodY + 0.08, 0], { part: 'hood' });
    const chimY = hoodY + 0.08 + hoodH;
    const cw = w * 0.42, cd = d * 0.42;
    K.box(brick, [cw, Math.max(0.05, h - 0.1 - chimY), cd], [0, chimY, 0], { part: 'chimney' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(stone, [0.03, 0.05, 0.03], [sx * (cw / 2 - 0.015), h - 0.1, sz * (cd / 2 - 0.015)]);
    K.box(stone, [Math.min(w, cw + 0.08), 0.05, Math.min(d, cd + 0.08)], [0, h - 0.05, 0]);
  }

  function buildPlanter(K) {
    const { w, d, h } = K;
    const trough = K.mat('concrete', C.concrete);
    const th = h * 0.62;
    K.box(trough, [w, th, d], [0, 0, 0], { r: 0.01, part: 'trough' });
    K.box(K.mat('concrete', C.soil), [w - 0.04, 0.01, d - 0.04], [0, th, 0]);
    const n = Math.max(2, Math.round(w / 0.32));
    const slot = w / n;
    const rb = Math.min(d / 2 - 0.01, slot * 0.62, (h - th) * 0.9);
    const greens = [K.mat('foliage', K.color), K.mat('foliage', tone(K.color, 0.16)), K.mat('foliage', tone(K.color, -0.15))];
    for (let i = 0; i < n; i++) {
      const x = clamp(-w / 2 + slot * (i + 0.5), -w / 2 + rb, w / 2 - rb);
      const sy = 0.75 + K.rng() * 0.25;
      const cy = Math.min(th + rb * 0.45, h - rb * sy);
      K.sphere(greens[i % 3], rb, [x, cy, 0], { detail: 1, scale: [1, sy, 1], part: 'foliage' });
      if (K.rng() < 0.6) {
        const fr = Math.min(0.03, rb * 0.25);
        K.sphere(K.mat('plastic', pick(K.rng, FLOWER_COLORS)), fr, [x + rb * 0.4, cy + rb * sy * 0.6, rb * 0.3], { detail: 0 });
      }
    }
  }

  function bikeWheel(K, z, R, t, rubber, chrome) {
    const yz = { rot: [0, HALF_PI, 0] };
    K.torus(rubber, R - t, t, [0, R, z], Object.assign({ radial: 6, tubular: 24, part: 'wheel' }, yz));
    K.torus(chrome, R - 2.3 * t, t * 0.35, [0, R, z], Object.assign({ radial: 4, tubular: 24 }, yz));
    K.cyl(chrome, 0.02, 0.02, 0.1, [0, R, z], { rot: [0, 0, HALF_PI], center: true, seg: 8 });
    for (let k = 0; k < 4; k++) {
      K.box(chrome, [0.003, 2 * (R - 2.3 * t), 0.003], [0, R, z], { center: true, rot: [(k * PI) / 4, 0, 0] });
    }
  }

  function buildBike(K) {
    const { w, d, h } = K;
    const s = d / 1.75;
    const paint = K.mat('paint', K.color);
    const chrome = K.mat('chrome', C.chrome);
    const black = K.mat('plastic', '#1F1F21');
    const R = clamp(Math.min(h * 0.33, d * 0.2), 0.08, 0.5);
    const t = clamp(R * 0.065, 0.008, 0.03);
    const zr = -d / 2 + R, zf = d / 2 - R;
    bikeWheel(K, zr, R, t, K.mat('rubber', C.rubber), chrome);
    bikeWheel(K, zf, R, t, K.mat('rubber', C.rubber), chrome);
    const BB = [0, R * 0.9, zr + (zf - zr) * 0.43];
    const ST = [0, h * 0.7, BB[2] - 0.14 * s];
    const HT = [0, h * 0.74, zf - 0.22 * s];
    const HB = [0, h * 0.58, zf - 0.17 * s];
    const r = clamp(0.018 * s, 0.008, 0.022);
    K.tube(paint, BB, ST, r, { part: 'frame' });
    K.tube(paint, [0, ST[1] - 0.03, ST[2]], HT, r * 0.9);
    K.tube(paint, BB, HB, r * 1.1);
    K.tube(paint, HB, HT, r * 1.2);
    for (const sx of [-1, 1]) {
      K.tube(paint, [sx * 0.012, ST[1] - 0.04, ST[2]], [sx * 0.05, R, zr], r * 0.6);
      K.tube(paint, [sx * 0.012, BB[1], BB[2]], [sx * 0.05, R, zr], r * 0.6);
      K.tube(paint, [sx * 0.03, HB[1], HB[2]], [sx * 0.045, R, zf], r * 0.7, { part: 'fork' });
    }
    bikeCockpit(K, { ST, HT, BB, s, chrome, black, paint });
  }

  function bikeCockpit(K, p) {
    const { w, h } = K;
    const post = [0, Math.min(h - 0.12, p.ST[1] + 0.1), p.ST[2] - 0.03];
    K.tube(p.chrome, p.ST, post, 0.013);
    K.box(p.black, [0.14, 0.05, 0.26 * p.s], [0, post[1], post[2]], { r: 0.02, part: 'saddle' });
    const barY = h - 0.05;
    const barZ = p.HT[2] - 0.05 * p.s;
    K.tube(p.chrome, p.HT, [0, barY, barZ], 0.014);
    const half = w / 2 - 0.02;
    K.tube(p.chrome, [-half, barY, barZ], [half, barY, barZ], 0.011, { part: 'handlebar' });
    for (const sx of [-1, 1]) K.tube(p.black, [sx * half, barY, barZ], [sx * Math.max(0.05, half - 0.12), barY, barZ], 0.016);
    const [bx, by, bz] = p.BB;
    const crank = Math.min(0.16, by - 0.02);
    const px = Math.min(0.12, w / 2 - 0.05);
    K.cyl(p.chrome, 0.09 * p.s, 0.09 * p.s, 0.006, [bx + 0.05, by, bz], { rot: [0, 0, HALF_PI], center: true, seg: 16 });
    for (const sx of [-1, 1]) {
      const end = [sx * (px - 0.03), by - sx * crank, bz + sx * 0.02];
      K.beam(p.black, [sx * 0.06, by, bz], end, [0.015, 0.025]);
      K.box(p.black, [0.08, 0.015, 0.06], [sx * px, end[1], end[2]], { center: true });
    }
  }

  // ================================================================== DECOR
  function buildRug(K) {
    const { w, d, h } = K;
    const bw = clamp(Math.min(w, d) * 0.06, 0.02, 0.12);
    const field = K.mat('fabric', K.color);
    const border = K.mat('fabric', tone(K.color, -0.22));
    const line = K.mat('fabric', tone(K.color, 0.35));
    for (const s of [-1, 1]) {
      K.box(border, [w, h, bw], [0, 0, s * (d / 2 - bw / 2)], { part: 'border' });
      K.box(border, [bw, h, d - 2 * bw], [s * (w / 2 - bw / 2), 0, 0], { part: 'border' });
    }
    const lw = Math.min(0.025, bw * 0.4);
    const iw = w - 2 * bw, id = d - 2 * bw;
    for (const s of [-1, 1]) {
      K.box(line, [iw, h * 0.97, lw], [0, 0, s * (id / 2 - bw * 0.6 - lw / 2)]);
      K.box(line, [lw, h * 0.97, id - 2 * (bw * 0.6 + lw)], [s * (iw / 2 - bw * 0.6 - lw / 2), 0, 0]);
    }
    K.box(field, [iw, h * 0.94, id], [0, 0, 0], { part: 'field' });
  }

  function buildPlant(K) {
    const { w, d, h } = K;
    const S = Math.min(w, d);
    const potR = (S / 2) * 0.62;
    const potH = clamp(h * 0.27, 0.05, 0.5);
    K.lathe(K.mat('terracotta', C.terracotta), POT_PROFILE, [0, 0, 0], { scale: [potR, potH, potR], seg: 16, part: 'pot' });
    K.cyl(K.mat('concrete', C.soil), potR * 0.9, potR * 0.9, 0.01, [0, potH - 0.035, 0], { seg: 16 });
    K.cyl(K.mat('wood', C.bark), 0.008, 0.014, h * 0.8 - potH, [0, potH - 0.03, 0], { seg: 6 });
    const greens = [K.mat('foliage', K.color), K.mat('foliage', tone(K.color, 0.18)), K.mat('foliage', tone(K.color, -0.18))];
    const crown = Math.min(S * 0.2, (h - potH) * 0.25);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      K.sphere(greens[i], crown, [Math.sin(a) * crown * 0.5, h * 0.62 + i * crown * 0.4, Math.cos(a) * crown * 0.5], { detail: 1, part: 'foliage' });
    }
    plantLeaves(K, greens, { S, potH });
  }

  function plantLeaves(K, greens, p) {
    const { h } = K;
    const maxR = p.S / 2 - 0.01;
    const N = 18;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const yb = p.potH + (h - p.potH) * (0.3 + 0.5 * t);
      const pitch = lerp(0.35, -0.9, t);
      let L = clamp(p.S * 0.42, 0.06, 0.35) * (1 - 0.25 * t);
      L = Math.min(L, maxR / Math.max(Math.cos(pitch), 0.3));
      if (pitch < 0) L = Math.min(L, (h - 0.01 - yb) / Math.sin(-pitch));
      if (L < 0.02) continue;
      const ang = i * GOLDEN_ANGLE;
      const dir = [Math.sin(ang) * Math.cos(pitch), -Math.sin(pitch), Math.cos(ang) * Math.cos(pitch)];
      const c = [dir[0] * L * 0.5, yb + dir[1] * L * 0.5, dir[2] * L * 0.5];
      K.sphere(greens[i % 3], L / 2, c, { detail: 0, scale: [0.34, 0.08, 1], rot: [pitch, ang, 0], order: 'YXZ', part: 'foliage' });
    }
  }

  function buildGeneric(K) {
    K.box(K.mat('lacquer', K.color), [K.w, K.h, K.d], [0, 0, 0], { r: Math.min(0.03, K.w / 4, K.d / 4, K.h / 4), seg: 2, part: 'body' });
  }

  // ================================================================== registry & public API
  const BUILDERS = {
    sofa3: (K) => buildSofa(K, {}),
    sofa2: (K) => buildSofa(K, {}),
    sofaL: buildSofaL,
    armchair: buildArmchair,
    coffeeTable: buildCoffeeTable,
    sideTable: buildSideTable,
    tvUnit: buildTvUnit,
    bookshelf: buildBookshelf,
    floorLamp: buildFloorLamp,
    dining4: (K) => buildDiningSet(K, { perSide: 2, tableW: 1, tableD: 0.5 }),
    dining6: (K) => buildDiningSet(K, { perSide: 3, tableW: 1, tableD: 0.53 }),
    dining8: (K) => buildDiningSet(K, { perSide: 3, tableW: 0.81, tableD: 0.53, ends: true }),
    roundTable: buildRoundTable,
    chair: (K) => buildChair(K),
    sideboard: buildSideboard,
    bedQueen: buildBed,
    bedDouble: buildBed,
    bedSingle: buildBed,
    nightstand: buildNightstand,
    wardrobe: buildWardrobe,
    dresser: buildDresser,
    desk: buildDesk,
    officeChair: buildOfficeChair,
    closetIsland: buildClosetIsland,
    kitchenSink: (K) => buildBaseRun(K, { sink: true }),
    counter: (K) => buildBaseRun(K, { sink: false }),
    stove: buildStove,
    fridge: buildFridge,
    upperCabinet: buildUpperCabinet,
    island: buildIsland,
    washer: buildWasher,
    shelves: buildMetalShelves,
    toilet: buildToilet,
    basin: buildBasin,
    shower: buildShower,
    bathtub: buildBathtub,
    car: buildCar,
    bbq: buildBbq,
    outdoorTable: buildOutdoorTable,
    lounger: buildLounger,
    outdoorSofa: buildOutdoorSofa,
    planter: buildPlanter,
    bike: buildBike,
    rug: buildRug,
    plant: buildPlant,
  };

  function runBuilder(THREE, spec) {
    const builder = BUILDERS[spec.type] || buildGeneric;
    let ctx = createContext(THREE, spec);
    try {
      builder(makeKit(ctx, new THREE.Matrix4(), spec));
    } catch (err) {
      console.warn('[DD.furniture3d] Falha ao gerar o modelo "' + spec.type + '"; usando caixa genérica.', err);
      ctx = createContext(THREE, spec);
      buildGeneric(makeKit(ctx, new THREE.Matrix4(), spec));
    }
    return mergeParts(ctx);
  }

  /**
   * Builds the 3D model of a furniture item.
   * @param {object} THREE three.js module namespace (r170)
   * @param {{id, type, w, d, h, color}} item document item (mm); missing/invalid values fall back to the catalog.
   * @returns {THREE.Group} metres, origin bottom-centre, local +X width, +Z depth (back at -d/2), +Y up.
   *   root.userData = { furnitureId, type, size:{w,d,h} (m), parts:{ tag: {min,max} } } — `parts` holds local
   *   bounding boxes of semantic parts (e.g. 'backrest', 'headlight', 'screen', 'tank') for tooling and tests.
   */
  function build(THREE, item) {
    if (!THREE || typeof THREE.Group !== 'function' || typeof THREE.Mesh !== 'function') {
      throw new TypeError('DD.furniture3d.build: é preciso passar o namespace do three.js.');
    }
    const spec = resolveSpec(item && typeof item === 'object' ? item : {});
    const result = runBuilder(THREE, spec);
    const root = new THREE.Group();
    root.name = spec.type || 'furniture';
    root.userData = { furnitureId: spec.id, type: spec.type, size: { w: spec.w, d: spec.d, h: spec.h }, parts: result.tags };
    result.meshes.forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.furnitureId = spec.id;
      mesh.name = root.name + ':' + (mesh.material.userData.kind || 'part');
      root.add(mesh);
    });
    return root;
  }

  DD.furniture3d = {
    build,
    /** Type ids with a dedicated model (anything else renders as a rounded box). */
    types: Object.keys(BUILDERS),
    // exposed for unit tests only
    _internal: { resolveSpec, tone, mixHex, normalizeHex, FALLBACK_TYPES },
  };
})();
