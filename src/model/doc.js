/**
 * Document model for a skatepark project.
 *
 * A document is a flat list of parametric elements plus boolean groups. Groups
 * are rebuilt from their source elements on every change, so repeated merges
 * never accumulate geometric error.
 *
 * All functions are pure (return new objects) so the editor can snapshot the
 * document for undo/redo cheaply.
 */

import { TYPES, normalizeParams } from '../geometry/solids.js';
import { clamp } from '../util.js';

export const SCHEMA = 'grind.skatepark';
export const DOC_VERSION = 1;

export const DEFAULT_SETTINGS = {
  snapStep: 0.1,
  snapEnabled: true,
  edgeSnap: true,
  showGrid: true,
  showEdges: true,
  showCutterGhosts: false,
  showCollision: false,
  sharpAngle: 40,
};

let counter = 0;
function newId(prefix) {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
}

export function createDoc(partial = {}) {
  return {
    schema: SCHEMA,
    version: DOC_VERSION,
    name: partial.name || '未命名场地',
    units: 'm',
    createdAt: partial.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mergeOps: 0,
    settings: { ...DEFAULT_SETTINGS, ...(partial.settings || {}) },
    elements: partial.elements || [],
    groups: partial.groups || [],
  };
}

export function createEmptyDoc(name = '空白场地') {
  return createDoc({ name });
}

function makeElement(type, params, position, rotationY, name, id) {
  return {
    id: id || newId('e'),
    type,
    name,
    params: normalizeParams(type, params),
    position: [position[0], position[1], position[2]].map((v) => Number(v) || 0),
    rotationY: normalizeRotation(rotationY),
  };
}

/* ------------------------------------------------------------------ */
/* Demo park                                                           */
/* ------------------------------------------------------------------ */

export function createDemoDoc() {
  const elements = [
    makeElement('funbox', { width: 3, length: 4, height: 0.9, topLength: 2.2 }, [0, 0, 0], 0, '金字塔台', 'demo-funbox'),
    makeElement('rail', { length: 2.6, height: 0.5, radius: 0.03 }, [0, 0.88, 0], 0, '台面栏杆', 'demo-rail-top'),
    makeElement('bank', { width: 4, length: 4, height: 1.1 }, [-6.2, 0, 0], -90, '左侧斜面', 'demo-bank'),
    makeElement('quarter', { width: 5, radius: 2, extension: 0.3, deck: 0.4 }, [0, 0, -4.6], 180, '中央四分之一管', 'demo-quarter'),
    makeElement('stairs', { width: 3, steps: 4, rise: 0.22, tread: 0.34 }, [5.2, 0, 0], 90, '右侧台阶', 'demo-stairs'),
    makeElement('ledge', { width: 2.4, length: 3, height: 0.45 }, [5.4, 0, -3.6], 0, '台子', 'demo-ledge'),
    makeElement('rail', { length: 3.6, height: 0.5, radius: 0.026 }, [-3.2, 0, 3.4], 0, '平地栏杆', 'demo-rail-flat'),
  ];
  return createDoc({
    name: '街角广场',
    elements,
    groups: [
      {
        id: 'demo-group-1',
        name: '金字塔 + 台面栏杆',
        members: ['demo-funbox', 'demo-rail-top'],
        cutters: [],
        createdAt: new Date().toISOString(),
      },
    ],
    mergeOps: 1,
  });
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export const elementById = (doc, id) => doc.elements.find((e) => e.id === id) || null;
export const groupById = (doc, id) => doc.groups.find((g) => g.id === id) || null;

export function groupOfElement(doc, id) {
  return doc.groups.find((g) => g.members.includes(id) || g.cutters.includes(id)) || null;
}

export const isLoose = (doc, id) => !groupOfElement(doc, id);
export const looseElements = (doc) => doc.elements.filter((el) => !groupOfElement(doc, el.id));

export function elementDisplayName(el) {
  const def = TYPES[el.type];
  return el.name || (def ? def.name : el.type);
}

export function groupDisplayName(doc, group) {
  if (group.name) return group.name;
  const names = group.members.map((id) => {
    const el = elementById(doc, id);
    return el ? TYPES[el.type]?.name || el.type : '?';
  });
  return names.slice(0, 2).join(' + ') + (names.length > 2 ? ` 等 ${names.length} 件` : '');
}

/* ------------------------------------------------------------------ */
/* Transform helpers                                                   */
/* ------------------------------------------------------------------ */

export function normalizeRotation(deg) {
  let r = Number(deg) || 0;
  r = ((r % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return Math.round(r * 1000) / 1000;
}

/** 'skatepark' is the raw doc shape used in JSON. */
export function docStats(doc) {
  const loose = looseElements(doc).length;
  const members = doc.groups.reduce((n, g) => n + g.members.length, 0);
  const cutters = doc.groups.reduce((n, g) => n + g.cutters.length, 0);
  return {
    elements: doc.elements.length,
    groups: doc.groups.length,
    loose,
    members,
    cutters,
    mergeOps: doc.mergeOps,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function cloneDoc(doc) {
  return structuredClone(doc);
}

function touch(doc) {
  doc.updatedAt = new Date().toISOString();
  return doc;
}

export function addElement(doc, type, overrides = {}) {
  const def = TYPES[type];
  if (!def) throw new Error(`未知元素类型: ${type}`);
  const next = cloneDoc(doc);
  const params = normalizeParams(type, { ...defaultsOf(type), ...(overrides.params || {}) });
  const position = overrides.position || [0, 0, 0];
  const sameType = next.elements.filter((e) => e.type === type).length + 1;
  const el = makeElement(
    type,
    params,
    position,
    overrides.rotationY || 0,
    overrides.name || `${def.name} ${sameType}`,
  );
  next.elements.push(el);
  return { doc: touch(next), element: el };
}

export function defaultsOf(type) {
  const def = TYPES[type];
  const out = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

export function updateElement(doc, id, patch) {
  const next = cloneDoc(doc);
  const el = next.elements.find((e) => e.id === id);
  if (!el) throw new Error('元素不存在');
  if (patch.params) el.params = normalizeParams(el.type, { ...el.params, ...patch.params });
  if (patch.position) {
    el.position = patch.position.map((v, i) => (Number.isFinite(Number(v)) ? Number(patch.position[i] ?? v) : el.position[i]));
    el.position[1] = Math.max(0, el.position[1]);
  }
  if (patch.rotationY !== undefined) el.rotationY = normalizeRotation(patch.rotationY);
  if (patch.name !== undefined) el.name = String(patch.name).slice(0, 40);
  return { doc: touch(next), element: next.elements.find((e) => e.id === id) };
}

export function updateGroup(doc, id, patch) {
  const next = cloneDoc(doc);
  const g = next.groups.find((x) => x.id === id);
  if (!g) throw new Error('合并组不存在');
  if (patch.name !== undefined) g.name = String(patch.name).slice(0, 48);
  return touch(next);
}

export function deleteElements(doc, ids) {
  const next = cloneDoc(doc);
  const kill = new Set(ids);
  next.elements = next.elements.filter((e) => !kill.has(e.id));
  for (const g of next.groups) {
    g.members = g.members.filter((id) => !kill.has(id));
    g.cutters = g.cutters.filter((id) => !kill.has(id));
  }
  // Groups without members dissolve; leftover cutters become loose elements.
  next.groups = next.groups.filter((g) => g.members.length > 0);
  return touch(next);
}

export function duplicateElement(doc, id, offset = [0.6, 0, 0.6]) {
  const el = elementById(doc, id);
  if (!el) throw new Error('元素不存在');
  const next = cloneDoc(doc);
  const copy = {
    ...structuredClone(el),
    id: newId('e'),
    name: `${el.name || TYPES[el.type].name} 副本`,
    position: [
      el.position[0] + offset[0],
      el.position[1],
      el.position[2] + offset[2],
    ],
  };
  next.elements.push(copy);
  return { doc: touch(next), element: copy };
}

/** Union a set of loose elements into a new group. */
export function mergeElements(doc, ids, name) {
  const unique = [...new Set(ids)];
  if (unique.length < 2) throw new Error('至少选择两个元素才能合并');
  for (const id of unique) {
    if (!elementById(doc, id)) throw new Error('元素不存在');
    const g = groupOfElement(doc, id);
    if (g) throw new Error(`元素已在合并组「${groupDisplayName(doc, g)}」中，请先解组`);
  }
  const next = cloneDoc(doc);
  const group = {
    id: newId('g'),
    name: name || null,
    members: unique,
    cutters: [],
    createdAt: new Date().toISOString(),
  };
  next.groups.push(group);
  next.mergeOps += 1;
  return { doc: touch(next), group };
}

/**
 * Union loose elements into an existing group (the common iterative flow:
 * drop a new ramp overlapping the ledge, then merge it in).
 */
export function addMembersToGroup(doc, groupId, ids) {
  const g = groupById(doc, groupId);
  if (!g) throw new Error('合并组不存在');
  const additions = [...new Set(ids)].filter((id) => !g.members.includes(id) && !g.cutters.includes(id));
  if (!additions.length) throw new Error('所选元素已在合并组内');
  for (const id of additions) {
    if (!elementById(doc, id)) throw new Error('元素不存在');
    const other = groupOfElement(doc, id);
    if (other) throw new Error(`元素已在合并组「${groupDisplayName(doc, other)}」中，请先解组`);
  }
  const next = cloneDoc(doc);
  const target = next.groups.find((x) => x.id === groupId);
  target.members = [...target.members, ...additions];
  next.mergeOps += 1;
  return { doc: touch(next), group: target };
}

/**
 * Subtract cutter elements from a base element or group.
 * If the base is loose it becomes a one-member group holding the cutters.
 */
export function subtractElements(doc, baseId, cutterIds) {
  const cutters = [...new Set(cutterIds)].filter((id) => id !== baseId);
  if (!cutters.length) throw new Error('请选择至少一个切割体');
  for (const id of cutters) {
    if (!elementById(doc, id)) throw new Error('切割元素不存在');
    const g = groupOfElement(doc, id);
    if (g) throw new Error(`切割体已在合并组「${groupDisplayName(doc, g)}」中，请先解组`);
  }
  const base = elementById(doc, baseId);
  const baseGroup = groupById(doc, baseId) || groupOfElement(doc, baseId);
  if (!base && !baseGroup) throw new Error('基准元素不存在');
  if (baseGroup && baseGroup.cutters.includes(baseId)) throw new Error('不能以切割体为基准');

  const next = cloneDoc(doc);
  let group;
  if (baseGroup) {
    group = next.groups.find((g) => g.id === baseGroup.id);
    group.cutters = [...new Set([...group.cutters, ...cutters])];
  } else {
    group = {
      id: newId('g'),
      name: null,
      members: [baseId],
      cutters,
      createdAt: new Date().toISOString(),
    };
    next.groups.push(group);
  }
  next.mergeOps += 1;
  return { doc: touch(next), group: next.groups.find((g) => g.id === group.id) };
}

export function addCutterToGroup(doc, groupId, cutterId) {
  return subtractElements(doc, groupId, [cutterId]);
}

export function removeCutter(doc, groupId, cutterId) {
  const next = cloneDoc(doc);
  const g = next.groups.find((x) => x.id === groupId);
  if (!g) throw new Error('合并组不存在');
  g.cutters = g.cutters.filter((id) => id !== cutterId);
  return touch(next);
}

export function ungroup(doc, groupId) {
  const next = cloneDoc(doc);
  const before = next.groups.length;
  next.groups = next.groups.filter((g) => g.id !== groupId);
  if (next.groups.length === before) throw new Error('合并组不存在');
  return touch(next);
}

/** Move every member of a group by a world-space delta. */
export function translateGroup(doc, groupId, delta) {
  const next = cloneDoc(doc);
  const g = next.groups.find((x) => x.id === groupId);
  if (!g) throw new Error('合并组不存在');
  for (const id of g.members) {
    const el = next.elements.find((e) => e.id === id);
    if (!el) continue;
    el.position[0] += delta[0];
    el.position[1] = Math.max(0, el.position[1] + delta[1]);
    el.position[2] += delta[2];
  }
  return touch(next);
}

/* ------------------------------------------------------------------ */
/* Validation / serialization                                          */
/* ------------------------------------------------------------------ */

function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof raw[key] === typeof DEFAULT_SETTINGS[key] && raw[key] !== undefined) {
        if (typeof raw[key] === 'number' && !Number.isFinite(raw[key])) continue;
        out[key] = raw[key];
      }
    }
  }
  out.snapStep = clamp(Number(out.snapStep) || 0.1, 0.01, 1);
  out.sharpAngle = clamp(Number(out.sharpAngle) || 40, 0, 80);
  return out;
}

/** Accepts a project file or an autosave payload; throws on unusable input. */
export function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('文件不是有效的 JSON 对象');
  if (raw.schema && raw.schema !== SCHEMA) throw new Error('文件类型不匹配');
  if (!Array.isArray(raw.elements)) throw new Error('缺少 elements 数组');

  const seen = new Set();
  const elements = [];
  for (const rawEl of raw.elements.slice(0, 500)) {
    if (!rawEl || typeof rawEl !== 'object') continue;
    if (!TYPES[rawEl.type]) continue;
    let id = typeof rawEl.id === 'string' && rawEl.id && !seen.has(rawEl.id) ? rawEl.id : newId('e');
    if (seen.has(id)) id = newId('e');
    seen.add(id);
    const pos = Array.isArray(rawEl.position) ? rawEl.position : [0, 0, 0];
    const position = [0, 1, 2].map((i) => {
      const v = Number(pos[i]);
      return Number.isFinite(v) ? clamp(v, -500, 500) : 0;
    });
    position[1] = Math.max(0, position[1]);
    elements.push({
      id,
      type: rawEl.type,
      name: typeof rawEl.name === 'string' ? rawEl.name.slice(0, 40) : TYPES[rawEl.type].name,
      params: normalizeParams(rawEl.type, rawEl.params || {}),
      position,
      rotationY: normalizeRotation(rawEl.rotationY),
    });
  }
  if (!elements.length) throw new Error('文件中没有可用的场地元素');

  const ids = new Set(elements.map((e) => e.id));
  const groups = [];
  const used = new Set();
  for (const rawG of Array.isArray(raw.groups) ? raw.groups.slice(0, 200) : []) {
    if (!rawG || typeof rawG !== 'object') continue;
    const members = [...new Set(Array.isArray(rawG.members) ? rawG.members : [])].filter(
      (id) => ids.has(id) && !used.has(id),
    );
    if (!members.length) continue;
    members.forEach((id) => used.add(id));
    const cutters = [...new Set(Array.isArray(rawG.cutters) ? rawG.cutters : [])].filter(
      (id) => ids.has(id) && !used.has(id),
    );
    cutters.forEach((id) => used.add(id));
    groups.push({
      id: typeof rawG.id === 'string' && rawG.id ? rawG.id : newId('g'),
      name: typeof rawG.name === 'string' ? rawG.name.slice(0, 48) : null,
      members,
      cutters,
      createdAt: typeof rawG.createdAt === 'string' ? rawG.createdAt : new Date().toISOString(),
    });
  }

  return {
    schema: SCHEMA,
    version: DOC_VERSION,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 60) : '导入的场地',
    units: 'm',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mergeOps: Math.max(0, Math.round(Number(raw.mergeOps) || 0)),
    settings: sanitizeSettings(raw.settings),
    elements,
    groups,
  };
}

export function serializeDoc(doc) {
  return JSON.stringify(doc, null, 2);
}

/* ------------------------------------------------------------------ */
/* Overlap detection (layout assistant)                                */
/* ------------------------------------------------------------------ */

/**
 * Loose elements whose world AABBs interpenetrate. `boundsById` comes from the
 * geometry worker (world-space AABBs). Returns clusters of >= 2 ids.
 */
export function findOverlapClusters(doc, boundsById, opts = {}) {
  const margin = opts.margin ?? 0.035;
  const items = [];
  for (const el of doc.elements) {
    if (groupOfElement(doc, el.id)) continue;
    const b = boundsById[el.id];
    if (!b) continue;
    items.push({ id: el.id, kind: 'element', ...b });
  }
  // Merged groups participate too, so dropping a ramp onto a ledge group
  // prompts "merge into group" instead of silently intersecting.
  if (opts.groupBounds) {
    for (const g of doc.groups) {
      const b = opts.groupBounds[g.id];
      if (!b) continue;
      items.push({ id: g.id, kind: 'group', ...b });
    }
  }
  const parent = new Map(items.map((it) => [it.id, it.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
      const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
      if (ox > margin && oy > margin && oz > margin) union(a.id, b.id);
    }
  }

  const clusters = new Map();
  for (const it of items) {
    const root = find(it.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(it.id);
  }
  const kindById = new Map(items.map((it) => [it.id, it.kind]));
  const out = [];
  for (const ids of clusters.values()) {
    if (ids.length >= 2) {
      ids.sort();
      const groupIds = ids.filter((id) => kindById.get(id) === 'group');
      out.push({
        ids,
        key: ids.join('|'),
        groupIds,
        // A cluster is "merge into group" when exactly one group is present.
        targetGroupId: groupIds.length === 1 ? groupIds[0] : null,
      });
    }
  }
  return out.sort((a, b) => b.ids.length - a.ids.length);
}
