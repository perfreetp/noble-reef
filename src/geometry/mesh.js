/**
 * Manifold -> renderable buffers.
 *
 * Produces indexed triangles with smooth/sharp vertex normals (from
 * manifold's calculateNormals), per-triangle element groups, and a crease-angle
 * edge overlay so boolean intersections read clearly in the viewport.
 */

const EDGE_ANGLE = Math.cos((28 * Math.PI) / 180);

function quantize(v) {
  return Math.round(v * 1e4);
}

/**
 * @param manifold result of calculateNormals()
 * @param idMap originalID -> element id
 * @param opts {sharpAngle}
 */
export function manifoldToRenderMesh(manifold, idMap, opts = {}) {
  const sharp = opts.sharpAngle ?? 40;
  let withNormals;
  let owned = false;
  try {
    withNormals = manifold.calculateNormals(0, sharp);
    owned = true;
  } catch (err) {
    throw new Error(`法线计算失败: ${err && err.message ? err.message : err}`);
  }
  const mesh = withNormals.getMesh();
  const numProp = mesh.numProp || 0;
  const vp = mesh.vertProperties;
  if (!numProp || numProp < 6) throw new Error('网格属性通道不足');
  const triCount = mesh.triVerts.length / 3;
  const vertCount = vp.length / numProp;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    const o = i * numProp;
    positions[i * 3] = vp[o];
    positions[i * 3 + 1] = vp[o + 1];
    positions[i * 3 + 2] = vp[o + 2];
    normals[i * 3] = vp[o + 3];
    normals[i * 3 + 1] = vp[o + 4];
    normals[i * 3 + 2] = vp[o + 5];
  }
  const indices = new Uint32Array(mesh.triVerts.length);
  for (let i = 0; i < mesh.triVerts.length; i++) indices[i] = mesh.triVerts[i];

  // Map triangle runs -> element ids.
  const runs = mesh.runIndex || new Uint32Array([0, mesh.triVerts.length]);
  const runIds = mesh.runOriginalID || new Uint32Array([-1]);
  const triGroup = new Array(triCount).fill(null);
  let unmapped = 0;
  for (let r = 0; r < runIds.length; r++) {
    const start = (runs[r] ?? 0) / 3;
    const end = (runs[r + 1] ?? mesh.triVerts.length) / 3;
    const rawId = runIds[r];
    const elId = rawId === undefined ? null : idMap.get(rawId) ?? null;
    if (elId === null && rawId !== undefined) unmapped += 1;
    for (let t = start; t < end; t++) triGroup[t] = elId;
  }
  if (unmapped > 0 && !opts.allowUnmapped) {
    throw new Error(`有 ${unmapped} 个几何分带无法对应到场地元素`);
  }
  // Compact consecutive equal groups into draw ranges.
  const groups = [];
  for (let t = 0; t < triCount; t++) {
    const id = triGroup[t];
    const last = groups[groups.length - 1];
    if (last && last.id === id) last.count += 1;
    else groups.push({ id, start: t * 3, count: 1 });
  }

  const edges = buildFeatureEdges(positions, indices);

  // With out-of-band normals requested through calculateNormals(0), getMesh()
  // may still expose them, but guard against all-zero normals.
  let anyNormal = false;
  for (let i = 0; i < normals.length; i += 97) {
    if (normals[i] !== 0 || normals[i + 1] !== 0 || normals[i + 2] !== 0) {
      anyNormal = true;
      break;
    }
  }
  if (!anyNormal) computeTriangleNormals(positions, indices, normals);

  if (owned) withNormals.delete();
  return {
    positions,
    normals,
    indices,
    groups,
    edges,
    vertexCount: vertCount,
    triangleCount: triCount,
  };
}

export function buildFeatureEdges(positions, indices) {
  const lookup = new Map();
  const keyOf = (i) =>
    `${quantize(positions[i * 3])},${quantize(positions[i * 3 + 1])},${quantize(positions[i * 3 + 2])}`;
  const canon = new Map();
  const canonKey = new Array(positions.length / 3);
  for (let i = 0; i < positions.length / 3; i++) {
    const k = keyOf(i);
    let c = canon.get(k);
    if (c === undefined) {
      c = i;
      canon.set(k, i);
    }
    canonKey[i] = c;
  }

  const triCount = indices.length / 3;
  const faceNormal = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    faceNormal[t * 3] = nx / len;
    faceNormal[t * 3 + 1] = ny / len;
    faceNormal[t * 3 + 2] = nz / len;
  }

  const seen = new Set();
  const out = [];
  const addEdge = (i0, i1, fi) => {
    const a = canonKey[i0];
    const b = canonKey[i1];
    if (a === b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const k = `${lo}:${hi}`;
    const prev = lookup.get(k);
    if (prev === undefined) {
      lookup.set(k, fi);
      return;
    }
    if (prev === -1) return;
    if (seen.has(k)) return;
    seen.add(k);
    const dot =
      faceNormal[prev * 3] * faceNormal[fi * 3] +
      faceNormal[prev * 3 + 1] * faceNormal[fi * 3 + 1] +
      faceNormal[prev * 3 + 2] * faceNormal[fi * 3 + 2];
    if (dot <= EDGE_ANGLE) {
      out.push(
        positions[lo * 3], positions[lo * 3 + 1], positions[lo * 3 + 2],
        positions[hi * 3], positions[hi * 3 + 1], positions[hi * 3 + 2],
      );
    }
    lookup.set(k, -1);
  };

  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    addEdge(a, b, t);
    addEdge(b, c, t);
    addEdge(c, a, t);
  }
  return new Float32Array(out);
}

function computeTriangleNormals(positions, indices, normals) {
  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const i of [ia, ib, ic]) {
      normals[i] = nx;
      normals[i + 1] = ny;
      normals[i + 2] = nz;
    }
  }
}

/** Concatenate several render meshes into one. */
export function mergeRenderMeshes(meshes) {
  let vTotal = 0;
  let iTotal = 0;
  let eTotal = 0;
  for (const m of meshes) {
    vTotal += m.vertexCount;
    iTotal += m.triangleCount;
    eTotal += m.edges.length;
  }
  const positions = new Float32Array(vTotal * 3);
  const normals = new Float32Array(vTotal * 3);
  const indices = new Uint32Array(iTotal * 3);
  const edges = new Float32Array(eTotal);
  const groups = [];
  let vOff = 0;
  let iOff = 0;
  let eOff = 0;
  for (const m of meshes) {
    positions.set(m.positions, vOff * 3);
    normals.set(m.normals, vOff * 3);
    for (let i = 0; i < m.indices.length; i++) indices[iOff + i] = m.indices[i] + vOff;
    for (const g of m.groups) {
      groups.push({ id: g.id, start: g.start + iOff * 3, count: g.count });
    }
    edges.set(m.edges, eOff);
    vOff += m.vertexCount;
    iOff += m.triangleCount;
    eOff += m.edges.length;
  }
  return {
    positions,
    normals,
    indices,
    edges,
    groups,
    vertexCount: vTotal,
    triangleCount: iTotal,
  };
}
