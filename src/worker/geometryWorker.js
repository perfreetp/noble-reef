/**
 * Geometry worker: owns the manifold-3d WASM instance.
 *
 * The main thread never touches manifold. It sends a document snapshot and
 * receives transferable typed arrays for rendering.
 *
 * Rebuild strategy (stability past 20+ merges):
 *   - every element is rebuilt from its parameters, never from previous output;
 *   - every group is rebuilt from its member elements;
 *   - world manifolds are cached only while the element's parameters and
 *     transform are unchanged, so one edit does not rebuild the whole park;
 *   - no tolerance or mesh state accumulates between merges.
 */

import Module from 'manifold-3d';
import { buildWorldManifold, buildGroupManifold, buildLocalManifold, TYPES } from '../geometry/solids.js';
import { manifoldToRenderMesh } from '../geometry/mesh.js';

let wasm = null;
let ready = false;

const worldCache = new Map(); // element id -> {key, manifold}
const boundsCache = new Map(); // type|params -> local AABB
const groupCache = new Map(); // group id -> {key, result}
let lastDoc = null;

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'init') {
    init(msg.wasmUrl)
      .then(() => {
        ready = true;
        self.postMessage({ type: 'ready' });
      })
      .catch((err) => {
        self.postMessage({
          type: 'fatal',
          message: `几何引擎初始化失败: ${err && err.message ? err.message : err}`,
        });
      });
    return;
  }
  if (msg.type === 'build') {
    if (!ready) {
      self.postMessage({ type: 'build-error', requestId: msg.requestId, message: '几何引擎尚未就绪' });
      return;
    }
    try {
      const payload = buildAll(msg.doc, msg.opts || {});
      const transfers = [];
      for (const c of [...payload.chunks, ...(payload.cutterChunks || [])]) {
        transfers.push(c.positions.buffer, c.normals.buffer, c.indices.buffer, c.colors.buffer, c.edges.buffer);
      }
      self.postMessage({ type: 'built', requestId: msg.requestId, ...payload }, transfers);
    } catch (err) {
      self.postMessage({
        type: 'build-error',
        requestId: msg.requestId,
        message: err && err.message ? err.message : String(err),
      });
    }
  }
});

async function init(wasmUrl) {
  if (wasm) return;
  const options = {};
  if (wasmUrl) options.locateFile = (path) => (path.endsWith('.wasm') ? wasmUrl : path);
  wasm = await Module(options);
  wasm.setup();
}

function elementKey(el, sharpAngle) {
  return `${el.type}|${JSON.stringify(el.params)}|${el.position.map((v) => v.toFixed(5)).join(',')}|${(
    el.rotationY || 0
  ).toFixed(5)}`;
}

function getWorld(el, sharpAngle) {
  const key = elementKey(el, sharpAngle);
  const cached = worldCache.get(el.id);
  if (cached && cached.key === key) return cached.manifold;
  if (cached) {
    try {
      cached.manifold.delete();
    } catch (e) {
      /* ignore */
    }
  }
  const manifold = buildWorldManifold(wasm, el);
  worldCache.set(el.id, { key, manifold });
  return manifold;
}

function groupKey(group, world, sharpAngle, byId) {
  const parts = [String(sharpAngle)];
  for (const id of group.members) {
    const el = byId.get(id);
    parts.push('m:' + id + ':' + (el ? elementKey(el, sharpAngle) : 'missing'));
  }
  for (const id of group.cutters) {
    const el = byId.get(id);
    parts.push('c:' + id + ':' + (el ? elementKey(el, sharpAngle) : 'missing'));
  }
  parts.push('order:' + group.members.join(',') + '|' + group.cutters.join(','));
  return parts.join('\n');
}

/** Cache private copies: the arrays handed to the main thread get transferred. */
function snapshotChunk(chunk) {
  return {
    ...chunk,
    positions: chunk.positions.slice(),
    normals: chunk.normals.slice(),
    indices: chunk.indices.slice(),
    colors: chunk.colors.slice(),
    edges: chunk.edges.slice(),
  };
}

function pruneCache(liveIds) {
  for (const [id, entry] of worldCache) {
    if (!liveIds.has(id)) {
      try {
        entry.manifold.delete();
      } catch (e) {
        /* ignore */
      }
      worldCache.delete(id);
    }
  }
}

/** Local AABB without keeping a manifold alive: built once per parameter set. */
function getLocalBounds(type, params) {
  const key = `${type}|${JSON.stringify(params)}`;
  const cached = boundsCache.get(key);
  if (cached) return cached;
  const m = buildLocalManifold(wasm, type, params);
  const box = m.boundingBox();
  m.delete();
  if (boundsCache.size > 400) boundsCache.clear();
  boundsCache.set(key, box);
  return box;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function colorForEl(el, isCutter) {
  if (isCutter) return [0.16, 0.18, 0.21].map(srgbToLinear);
  const def = TYPES[el.type];
  const hex = def ? def.color : 0xaaaaaa;
  const r = srgbToLinear(((hex >> 16) & 255) / 255);
  const g = srgbToLinear(((hex >> 8) & 255) / 255);
  const b = srgbToLinear((hex & 255) / 255);
  // Small deterministic tint so neighbouring same-type parts stay legible.
  let h = 0;
  const id = el.id || '';
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const t = 1 + ((h % 9) - 4) * 0.012;
  return [r * t, g * t, b * t];
}

function buildAll(doc, opts) {
  const t0 = performance.now();
  const sharpAngle = opts.sharpAngle ?? 40;
  const liveIds = new Set(doc.elements.map((e) => e.id));
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const groupedIds = new Set();
  const cutterIds = new Set();
  for (const g of doc.groups) {
    for (const id of g.members) groupedIds.add(id);
    for (const id of g.cutters) {
      groupedIds.add(id);
      cutterIds.add(id);
    }
  }

  // 1. World manifolds (cached by parameter+transform key).
  const world = new Map();
  for (const el of doc.elements) {
    try {
      world.set(el.id, getWorld(el, sharpAngle));
    } catch (err) {
      throw new Error(`元素「${el.name || el.type}」构建失败：${err.message}`);
    }
  }
  pruneCache(liveIds);
  const liveGroups = new Set(doc.groups.map((g) => g.id));
  for (const id of groupCache.keys()) {
    if (!liveGroups.has(id)) groupCache.delete(id);
  }

  // 2. Local AABBs (used for ghosts, overlap detection and placement).
  const localBounds = {};
  for (const el of doc.elements) {
    try {
      localBounds[el.id] = getLocalBounds(el.type, el.params);
    } catch (err) {
      /* element already failed above */
    }
  }

  const chunks = [];
  const targets = {};
  const groupInfo = {};
  const groupErrors = [];
  let unionOps = 0;
  let differenceOps = 0;
  let groupHits = 0;
  let groupMisses = 0;

  const makeChunk = (id, isGroup, rm, colorIds, cutterIdSet) => {
    const colors = new Float32Array(rm.vertexCount * 3);
    const cache = new Map();
    for (const band of rm.groups) {
      const elId = band.id;
      const el = elId ? byId.get(elId) : null;
      let rgb = cache.get(elId);
      if (!rgb) {
        rgb = colorForEl(el || { id: String(elId), type: 'box' }, Boolean(elId && cutterIdSet.has(elId)));
        cache.set(elId, rgb);
      }
      for (let t = band.start; t < band.start + band.count * 3; t += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = (rm.indices[t + k] || 0) * 3;
          colors[vi] = rgb[0];
          colors[vi + 1] = rgb[1];
          colors[vi + 2] = rgb[2];
        }
      }
    }
    return {
      id,
      isGroup,
      positions: rm.positions,
      normals: rm.normals,
      indices: rm.indices,
      edges: rm.edges,
      colors,
      triangleCount: rm.triangleCount,
      vertexCount: rm.vertexCount,
      bands: rm.groups.map((g) => ({ id: g.id, start: g.start, count: g.count })),
    };
  };

  // 3. Loose elements, then groups.
  for (const el of doc.elements) {
    if (groupedIds.has(el.id)) continue;
    const m = world.get(el.id);
    const rm = manifoldToRenderMesh(m, new Map([[m.originalID(), el.id]]), { sharpAngle });
    chunks.push(makeChunk(el.id, false, rm, null, new Set()));
    targets[el.id] = { position: [...el.position], rotationY: el.rotationY || 0 };
  }

  const memberGroups = {};
  for (const group of doc.groups) {
    for (const id of [...group.members, ...group.cutters]) memberGroups[id] = group.id;
  }

  const cutterChunks = [];
  for (const group of doc.groups) {
    for (const cutterId of group.cutters) {
      const m = world.get(cutterId);
      if (!m) continue;
      const el = byId.get(cutterId);
      const rm = manifoldToRenderMesh(m, new Map([[m.originalID(), cutterId]]), { sharpAngle });
      const chunk = makeChunk(cutterId, false, rm, null, new Set([cutterId]));
      chunk.role = 'cutter';
      chunk.groupId = group.id;
      cutterChunks.push(chunk);
    }
  }

  for (const group of doc.groups) {
    try {
      const key = groupKey(group, world, sharpAngle, byId);
      const cached = groupCache.get(group.id);
      if (cached && cached.key === key) {
        groupHits += 1;
        chunks.push(snapshotChunk(cached.chunk));
        groupInfo[group.id] = { ...cached.info };
        unionOps += Math.max(0, group.members.length - 1);
        differenceOps += group.cutters.length;
      } else {
      groupMisses += 1;
      const { manifold, idMap } = buildGroupManifold(wasm, group, world);
      const status = manifold.status();
      const info = {
        status,
        volume: manifold.volume(),
        genus: manifold.genus(),
        triangles: manifold.numTri(),
        isEmpty: manifold.isEmpty(),
      };
      unionOps += Math.max(0, group.members.length - 1);
      differenceOps += group.cutters.length;
      const rm = manifoldToRenderMesh(manifold, idMap, { sharpAngle });
      manifold.delete();
      const chunk = makeChunk(group.id, true, rm, null, cutterIds);
      chunks.push(chunk);
      groupCache.set(group.id, { key, chunk: snapshotChunk(chunk), info: { ...info } });
      groupInfo[group.id] = info;
      }
      // Group transform handle sits at the centroid of its member origins.
      let cx = 0;
      let cz = 0;
      let cy = 0;
      let n = 0;
      for (const id of group.members) {
        const el = byId.get(id);
        if (!el) continue;
        cx += el.position[0];
        cy += el.position[1];
        cz += el.position[2];
        n += 1;
      }
      if (n) targets[group.id] = { position: [cx / n, cy / n, cz / n], rotationY: 0, group: true };
    } catch (err) {
      groupErrors.push({ groupId: group.id, message: err.message });
      // Render members individually so the park stays visible and editable.
      for (const id of group.members) {
        const m = world.get(id);
        if (!m) continue;
        const rm = manifoldToRenderMesh(m, new Map([[m.originalID(), id]]), { sharpAngle });
        chunks.push(makeChunk(id, false, rm, null, cutterIds));
      }
    }
  }

  // 4. World AABBs for layout, framing and overlap detection.
  const worldBounds = {};
  for (const el of doc.elements) {
    const local = localBounds[el.id];
    if (local) worldBounds[el.id] = rotateAabb(local, el.position, el.rotationY || 0);
  }
  const groupBounds = {};
  for (const group of doc.groups) {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const id of [...group.members, ...group.cutters]) {
      const b = worldBounds[id];
      if (!b) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], b.min[i]);
        max[i] = Math.max(max[i], b.max[i]);
      }
    }
    if (Number.isFinite(min[0])) groupBounds[group.id] = { min, max };
  }
  const parkBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const b of Object.values(worldBounds)) {
    for (let i = 0; i < 3; i++) {
      parkBounds.min[i] = Math.min(parkBounds.min[i], b.min[i]);
      parkBounds.max[i] = Math.max(parkBounds.max[i], b.max[i]);
    }
  }

  let triangles = 0;
  let vertices = 0;
  let edgeSegments = 0;
  for (const c of chunks) {
    triangles += c.triangleCount;
    vertices += c.vertexCount;
    edgeSegments += c.edges.length / 6;
  }

  return {
    chunks,
    cutterChunks,
    memberGroups,
    targets,
    localBounds,
    worldBounds,
    groupBounds,
    parkBounds: Number.isFinite(parkBounds.min[0]) ? parkBounds : null,
    groupInfo,
    groupErrors,
    stats: {
      triangles,
      vertices,
      edgeSegments,
      unionOps,
      differenceOps,
      groupHits,
      groupMisses,
      buildMs: Math.round((performance.now() - t0) * 10) / 10,
      chunkCount: chunks.length,
    },
  };
}

function rotateAabb(local, position, rotationY) {
  const r = (rotationY * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const px of [local.min[0], local.max[0]]) {
    for (const pz of [local.min[2], local.max[2]]) {
      const wx = px * c + pz * s + position[0];
      const wz = -px * s + pz * c + position[2];
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz);
      maxZ = Math.max(maxZ, wz);
    }
  }
  return {
    min: [minX, local.min[1] + position[1], minZ],
    max: [maxX, local.max[1] + position[1], maxZ],
  };
}
