/**
 * Pure geometry layer: turns high-level scene elements into manifold-3d solids.
 *
 * Runs unchanged in the browser worker and in Node tests — no three.js imports.
 *
 * Conventions
 * -----------
 * Manifold is Z-up; everything returned here is three.js space (Y up).
 * An element's local origin sits on the ground at the centre of its footprint.
 * Ramps and stairs rise toward -Z; +Z is the approach side.
 *
 * Extruded profiles are authored in (u = depth, v = height) and mapped with
 *   x = z_extrude - width/2,  y = v,  z = depth/2 - u
 * which is a proper rotation (det +1), so winding stays outward.
 */

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 1e4) / 1e4;

function dedupePoints(rawPts) {
  const pts = [];
  for (const p of rawPts) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) pts.push(p);
  }
  if (pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6) pts.pop();
  }
  return pts;
}

/** Extrude a depth/height profile across the element width. */
function profileSolid(wasm, rawPts, width, depth) {
  const pts = dedupePoints(rawPts);
  if (pts.length < 3) throw new Error('截面点不足');
  const cs = new wasm.CrossSection([pts]);
  if (!(cs.area() > 1e-9)) {
    cs.delete();
    throw new Error('截面面积为 0');
  }
  const w = Math.max(1e-3, width);
  const extruded = wasm.Manifold.extrude(cs, w);
  cs.delete();
  const out = extruded.transform([
    0, 0, -1, 0,
    0, 1, 0, 0,
    1, 0, 0, 0,
    -w / 2, 0, depth / 2, 1,
  ]);
  extruded.delete();
  return out;
}

/** Axis-aligned box in three space; cy is the vertical centre. */
function box3(wasm, w, h, d, cx = 0, cy = h / 2, cz = 0) {
  return wasm.Manifold.cube([Math.max(1e-3, w), Math.max(1e-3, h), Math.max(1e-3, d)], true)
    .translate([cx, cy, cz]);
}

/** Vertical cylinder (along +Y) centred at (cx, cy, cz). */
function cylY(wasm, radius, height, cx, cy, cz, segments = 20) {
  const raw = wasm.Manifold.cylinder(Math.max(1e-3, height), radius, radius, segments, true);
  const rotated = raw.rotate([90, 0, 0]);
  const placed = rotated.translate([cx, cy, cz]);
  raw.delete();
  rotated.delete();
  return placed;
}

/** Horizontal cylinder along Z, centred at (cx, cy, cz). */
function cylZ(wasm, radius, length, cx, cy, cz, segments = 24) {
  return wasm.Manifold.cylinder(Math.max(1e-3, length), radius, radius, segments, true)
    .translate([cx, cy, cz]);
}

function unionAll(wasm, parts) {
  const live = parts.filter(Boolean);
  if (!live.length) throw new Error('空几何体');
  let out;
  if (live.length === 1) {
    out = live[0].asOriginal();
    live[0].delete();
  } else {
    out = wasm.Manifold.union(live);
    for (const p of live) p.delete();
  }
  const status = out.status();
  if (status !== 'NoError') {
    out.delete();
    throw new Error(`布尔运算失败: ${status}`);
  }
  return out;
}

const sample = (fn, n) => {
  const pts = [];
  for (let i = 1; i <= n; i++) pts.push(fn(i / n));
  return pts;
};

/* ------------------------------------------------------------------ */
/* Builders (local three space, ground at y = 0)                       */
/* ------------------------------------------------------------------ */

const BUILDERS = {
  bank(wasm, p) {
    return profileSolid(wasm, [[0, 0], [p.length, 0], [p.length, p.height]], p.width, p.length);
  },

  kicker(wasm, p) {
    const pts = [[0, 0], [p.length, 0]];
    pts.push(...sample((t) => [p.length * t, p.height * Math.pow(t, p.curve)], 18).reverse());
    return profileSolid(wasm, pts, p.width, p.length);
  },

  quarter(wasm, p) {
    const R = p.radius;
    const wall = 0.3;
    const deck = p.deck;
    const depth = R + wall + deck;
    const top = R + p.extension;
    // Depth `u` maps to z = depth/2 - u, so the transition front sits at +Z.
    const zOf = (u) => depth / 2 - u;
    const arc = [];
    for (let i = 22; i >= 1; i--) {
      const t = (i / 22) * (Math.PI / 2);
      arc.push([Math.sin(t) * R, (1 - Math.cos(t)) * R]);
    }
    const transition = profileSolid(wasm, [[0, 0], [R, 0], ...arc], p.width, depth);
    const parts = [transition];
    // Back wall, overlapping the transition by 2 cm so the union fuses.
    const overlap = 0.02;
    parts.push(box3(wasm, p.width, top, wall + overlap, 0, top / 2, zOf(R + wall / 2 - overlap / 2)));
    if (deck > 0.05) {
      parts.push(
        box3(wasm, p.width, 0.14, deck + overlap, 0, top - 0.07, zOf(R + wall + deck / 2 - overlap / 2)),
      );
    }
    return unionAll(wasm, parts);
  },

  roller(wasm, p) {
    const pts = [[0, 0], [p.length, 0]];
    pts.push(...sample((t) => [p.length * t, p.height * Math.sin(Math.PI * t) ** 2], 20).reverse());
    return profileSolid(wasm, pts, p.width, p.length);
  },

  stairs(wasm, p) {
    const depth = p.steps * p.tread;
    const parts = [];
    for (let i = 0; i < p.steps; i++) {
      const h = (i + 1) * p.rise;
      const cz = depth / 2 - (i + 0.5) * p.tread;
      parts.push(box3(wasm, p.width, h, p.tread + 0.002, 0, h / 2, cz));
    }
    return unionAll(wasm, parts);
  },

  ledge(wasm, p) {
    return box3(wasm, p.width, p.height, p.length, 0, p.height / 2, 0);
  },

  funbox(wasm, p) {
    const L = p.length;
    const a = Math.max(0.05, (L - p.topLength) / 2);
    return profileSolid(wasm, [[0, 0], [L, 0], [L - a, p.height], [a, p.height]], p.width, L);
  },

  rail(wasm, p) {
    const r = p.radius;
    const parts = [];
    // Crossbar runs along Z (length axis) at the rail height.
    parts.push(cylZ(wasm, r, Math.max(r * 2, p.length - r * 2), 0, p.height, 0, 20));
    const postR = Math.max(0.03, r * 1.4);
    const offset = Math.max(0.08, p.length / 2 - 0.12);
    for (const z of [-offset, offset]) {
      parts.push(cylY(wasm, postR, p.height + postR * 0.5, 0, (p.height + postR * 0.5) / 2, z, 16));
      parts.push(box3(wasm, Math.max(0.16, r * 7), 0.035, Math.max(0.16, r * 7), 0, 0.0175, z));
    }
    return unionAll(wasm, parts);
  },

  box(wasm, p) {
    return box3(wasm, p.width, p.height, p.length, 0, p.height / 2, 0);
  },
};

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export const TYPES = {
  bank: {
    key: 'bank', name: '斜面坡', en: 'Bank', category: 'ramp', color: 0xa89c86, rough: 0.86,
    icon: 'M3 19 L21 19 L21 7 Z',
    hint: '平滑斜面，适合贴地加速',
    params: [
      { key: 'width', label: '宽度', min: 1.2, max: 8, step: 0.1, default: 3, unit: 'm' },
      { key: 'length', label: '长度', min: 1.2, max: 10, step: 0.1, default: 4, unit: 'm' },
      { key: 'height', label: '高度', min: 0.2, max: 3, step: 0.05, default: 1.2, unit: 'm' },
    ],
  },
  kicker: {
    key: 'kicker', name: '弧形跳台', en: 'Kicker', category: 'ramp', color: 0xb0a48d, rough: 0.84,
    icon: 'M3 19 L21 19 L21 16 C21 8 14 4 3 19 Z',
    hint: '凹弧起跳面，起点贴地',
    params: [
      { key: 'width', label: '宽度', min: 1, max: 6, step: 0.1, default: 2.4, unit: 'm' },
      { key: 'length', label: '长度', min: 1.2, max: 8, step: 0.1, default: 3.2, unit: 'm' },
      { key: 'height', label: '高度', min: 0.3, max: 2.4, step: 0.05, default: 1.1, unit: 'm' },
      { key: 'curve', label: '弧度', min: 1.4, max: 3.2, step: 0.1, default: 2 },
    ],
  },
  quarter: {
    key: 'quarter', name: '四分之一管', en: 'Quarter', category: 'ramp', color: 0x9d9486, rough: 0.82,
    icon: 'M3 19 L21 19 L21 6 L19 6 C19 13 10 16 3 19 Z',
    hint: '垂直过渡，可加平台（coping）',
    params: [
      { key: 'width', label: '宽度', min: 1.5, max: 8, step: 0.1, default: 4, unit: 'm' },
      { key: 'radius', label: '半径', min: 0.8, max: 3.5, step: 0.05, default: 1.8, unit: 'm' },
      { key: 'extension', label: '垂直延伸', min: 0, max: 1.5, step: 0.05, default: 0.25, unit: 'm' },
      { key: 'deck', label: '平台深度', min: 0, max: 1.5, step: 0.05, default: 0, unit: 'm' },
    ],
  },
  roller: {
    key: 'roller', name: '波浪坡', en: 'Roller', category: 'ramp', color: 0xa79d8d, rough: 0.86,
    icon: 'M3 19 C7 19 8 9 12 9 C16 9 17 19 21 19 Z',
    hint: '起伏坡，两端贴地',
    params: [
      { key: 'width', label: '宽度', min: 1, max: 6, step: 0.1, default: 3, unit: 'm' },
      { key: 'length', label: '长度', min: 1, max: 6, step: 0.1, default: 3, unit: 'm' },
      { key: 'height', label: '高度', min: 0.1, max: 1.5, step: 0.05, default: 0.5, unit: 'm' },
    ],
  },
  stairs: {
    key: 'stairs', name: '台阶', en: 'Stairs', category: 'street', color: 0x9b9280, rough: 0.88,
    icon: 'M3 19 L21 19 L21 15 L17 15 L17 11 L13 11 L13 7 L9 7 L9 3 L3 3 Z',
    hint: '用于下台阶或衔接落差',
    params: [
      { key: 'width', label: '宽度', min: 1, max: 8, step: 0.1, default: 3, unit: 'm' },
      { key: 'steps', label: '台阶数', min: 1, max: 14, step: 1, default: 4, integer: true },
      { key: 'rise', label: '单级高', min: 0.08, max: 0.5, step: 0.01, default: 0.22, unit: 'm' },
      { key: 'tread', label: '单级深', min: 0.18, max: 0.9, step: 0.01, default: 0.34, unit: 'm' },
    ],
  },
  ledge: {
    key: 'ledge', name: '台子', en: 'Ledge', category: 'street', color: 0xada392, rough: 0.88,
    icon: 'M4 19 L4 12 L20 12 L20 19 Z',
    hint: '方台，可加杆做 grind',
    params: [
      { key: 'width', label: '宽度', min: 0.6, max: 6, step: 0.1, default: 2.4, unit: 'm' },
      { key: 'length', label: '长度', min: 1, max: 12, step: 0.1, default: 4, unit: 'm' },
      { key: 'height', label: '高度', min: 0.15, max: 1.4, step: 0.05, default: 0.45, unit: 'm' },
    ],
  },
  funbox: {
    key: 'funbox', name: '金字塔台', en: 'Funbox', category: 'street', color: 0xa79b84, rough: 0.88,
    icon: 'M3 19 L21 19 L17 8 L7 8 Z',
    hint: '两侧斜面的平台，可对穿',
    params: [
      { key: 'width', label: '宽度', min: 1.5, max: 8, step: 0.1, default: 3, unit: 'm' },
      { key: 'length', label: '长度', min: 2, max: 8, step: 0.1, default: 4, unit: 'm' },
      { key: 'height', label: '高度', min: 0.3, max: 2, step: 0.05, default: 0.9, unit: 'm' },
      { key: 'topLength', label: '顶面长度', min: 0.4, max: 6, step: 0.1, default: 2.2, unit: 'm' },
    ],
  },
  rail: {
    key: 'rail', name: '栏杆', en: 'Rail', category: 'rail', color: 0x9aabbd, rough: 0.3, metal: 0.85,
    icon: 'M4 19 L4 8 L20 8 L20 19 M4 8 L4 6 M20 8 L20 6',
    hint: '圆形钢管，两端立柱',
    params: [
      { key: 'length', label: '长度', min: 1, max: 12, step: 0.1, default: 4, unit: 'm' },
      { key: 'height', label: '高度', min: 0.15, max: 1.3, step: 0.01, default: 0.55, unit: 'm' },
      { key: 'radius', label: '管径', min: 0.015, max: 0.07, step: 0.001, default: 0.026, unit: 'm' },
    ],
  },
  box: {
    key: 'box', name: '方箱', en: 'Box', category: 'street', color: 0x968c79, rough: 0.88,
    icon: 'M5 19 L5 8 L19 8 L19 19 Z M5 8 L8 4 L22 4 L22 15 L19 19',
    hint: '自由立方体，可做任意堆叠或被切割',
    params: [
      { key: 'width', label: '宽度', min: 0.3, max: 5, step: 0.05, default: 1.4, unit: 'm' },
      { key: 'length', label: '长度', min: 0.3, max: 5, step: 0.05, default: 1.4, unit: 'm' },
      { key: 'height', label: '高度', min: 0.2, max: 4, step: 0.05, default: 0.8, unit: 'm' },
    ],
  },
};

export const TYPE_LIST = Object.values(TYPES);

export function normalizeParams(type, raw) {
  const def = TYPES[type];
  if (!def) throw new Error(`未知元素类型: ${type}`);
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const p of def.params) {
    const v = num(src[p.key], p.default);
    out[p.key] = p.integer ? Math.round(clamp(v, p.min, p.max)) : round(clamp(v, p.min, p.max));
  }
  return out;
}

/**
 * Local element solid. Composite elements (quarter pipe = transition + wall +
 * deck) are stamped with a single originalID so downstream code sees one
 * material band per element.
 */
export function buildLocalManifold(wasm, type, params) {
  const def = TYPES[type];
  if (!def) throw new Error(`未知元素类型: ${type}`);
  const built = BUILDERS[type](wasm, normalizeParams(type, params));
  if (built.status() !== 'NoError') {
    const status = built.status();
    built.delete();
    throw new Error(`构建「${def.name}」失败: ${status}`);
  }
  const stamped = built.asOriginal();
  built.delete();
  return stamped;
}

/** World-space manifold, stamped with asOriginal() so booleans keep element IDs. */
export function buildWorldManifold(wasm, el) {
  const local = buildLocalManifold(wasm, el.type, el.params);
  const rotated = local.rotate([0, num(el.rotationY, 0), 0]);
  const pos = Array.isArray(el.position) ? el.position : [0, 0, 0];
  const placed = rotated.translate([num(pos[0], 0), num(pos[1], 0), num(pos[2], 0)]);
  local.delete();
  rotated.delete();
  const stamped = placed.asOriginal();
  placed.delete();
  return stamped;
}

/**
 * Build one boolean group from cached world manifolds.
 * The returned manifold is owned by the caller; inputs stay cached.
 * @returns {{manifold: any, idMap: Map<number, string>}}
 */
export function buildGroupManifold(wasm, group, worldById) {
  const solids = [];
  const idMap = new Map();
  for (const id of group.members) {
    const m = worldById.get(id);
    if (m) {
      idMap.set(m.originalID(), id);
      solids.push(m);
    }
  }
  if (!solids.length) throw new Error('合并组内没有实体');
  // Single member: borrow the cached manifold (run IDs stay valid).
  let acc = solids.length === 1 ? solids[0] : wasm.Manifold.union(solids);
  let owned = solids.length > 1;
  let status = acc.status();
  if (status !== 'NoError') {
    if (owned) acc.delete();
    throw new Error(`并集失败: ${status}`);
  }
  for (const id of group.cutters || []) {
    const cut = worldById.get(id);
    if (!cut) continue;
    // Difference results tag the newly cut faces with the cutter's run id;
    // mapping it lets the viewport shade cut surfaces distinctly.
    idMap.set(cut.originalID(), id);
    const next = acc.subtract(cut);
    if (owned) acc.delete();
    acc = next;
    owned = true;
    status = acc.status();
    if (status !== 'NoError') {
      acc.delete();
      throw new Error(`差集失败: ${status}`);
    }
    if (acc.isEmpty()) {
      acc.delete();
      throw new Error('差集后模型为空，请检查切割体');
    }
  }
  if (!owned) {
    // Caller deletes the result; give it a private copy.
    const copy = acc.asOriginal();
    idMap.clear();
    idMap.set(copy.originalID(), group.members[0]);
    acc = copy;
  }
  return { manifold: acc, idMap };
}
