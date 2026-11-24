import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import earcut from 'earcut';
import type { Vec3 } from '../types';

interface PN {
  p: THREE.Vector3;
  n: THREE.Vector3;
}

export interface PlaneSplitResult {
  lower: THREE.BufferGeometry;
  upper: THREE.BufferGeometry;
  lowerBody: THREE.BufferGeometry;
  upperBody: THREE.BufferGeometry;
  loops: Vec3[][];
  segmentCount: number;
  capped: boolean;
}

const EPS = 1e-5;
const nonIndexedCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function getNonIndexed(input: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!input.index) return input;
  const cached = nonIndexedCache.get(input);
  if (cached) return cached;
  const copy = input.toNonIndexed();
  nonIndexedCache.set(input, copy);
  return copy;
}

function makePN(x: number, y: number, z: number, nx: number, ny: number, nz: number): PN {
  return { p: new THREE.Vector3(x, y, z), n: new THREE.Vector3(nx, ny, nz) };
}

function cleanPolygon(poly: PN[]): PN[] {
  const out: PN[] = [];
  for (const v of poly) {
    const last = out[out.length - 1];
    if (!last || last.p.distanceToSquared(v.p) > 1e-12) out.push(v);
  }
  if (out.length > 1 && out[0].p.distanceToSquared(out[out.length - 1].p) < 1e-12) out.pop();
  return out;
}

function intersectPN(a: PN, b: PN, h: number): PN {
  const denom = b.p.y - a.p.y;
  const t = Math.abs(denom) < 1e-12 ? 0 : (h - a.p.y) / denom;
  const p = a.p.clone().lerp(b.p, THREE.MathUtils.clamp(t, 0, 1));
  p.y = h;
  const n = a.n.clone().lerp(b.n, t).normalize();
  return { p, n };
}

function clipTriangle(tri: PN[], h: number, lower: boolean): PN[] {
  const inside = (v: PN) => (lower ? v.p.y <= h + EPS : v.p.y >= h - EPS);
  const output: PN[] = [];
  let prev = tri[tri.length - 1];
  let prevInside = inside(prev);

  for (const curr of tri) {
    const currInside = inside(curr);
    if (currInside) {
      if (!prevInside) output.push(intersectPN(prev, curr, h));
      output.push(curr);
    } else if (prevInside) {
      output.push(intersectPN(prev, curr, h));
    }
    prev = curr;
    prevInside = currInside;
  }
  return cleanPolygon(output);
}

function pushVertex(arr: number[], nrm: number[], v: PN, fallbackCapNormal?: THREE.Vector3) {
  arr.push(v.p.x, v.p.y, v.p.z);
  const n = fallbackCapNormal ?? v.n;
  nrm.push(n.x, n.y, n.z);
}

function appendFan(
  poly: PN[],
  positions: number[],
  normals: number[],
  bodyPositions: number[],
  bodyNormals: number[],
) {
  for (let i = 1; i < poly.length - 1; i++) {
    const tri = [poly[0], poly[i], poly[i + 1]];
    for (const v of tri) {
      pushVertex(positions, normals, v);
      pushVertex(bodyPositions, bodyNormals, v);
    }
  }
}

function keyOf(v: THREE.Vector3): string {
  return `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
}

function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function signedAreaXZ(points: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

function pointInPolygonXZ(x: number, z: number, poly: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].y;
    const xj = poly[j].x;
    const zj = poly[j].y;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

interface CapLoop {
  points3: THREE.Vector3[];
  points2: THREE.Vector2[];
  area: number;
  parent: number;
  depth: number;
}

function buildCapLoops(rawLoops: THREE.Vector3[][]): CapLoop[] {
  const loops: CapLoop[] = rawLoops
    .map((points3) => {
      const cleaned: THREE.Vector3[] = [];
      for (const p of points3) {
        if (!cleaned.length || cleaned[cleaned.length - 1].distanceToSquared(p) > 1e-10) cleaned.push(p);
      }
      if (cleaned.length > 2 && cleaned[0].distanceToSquared(cleaned[cleaned.length - 1]) < 1e-10) cleaned.pop();
      const points2 = cleaned.map((p) => new THREE.Vector2(p.x, p.z));
      return { points3: cleaned, points2, area: Math.abs(signedAreaXZ(points2)), parent: -1, depth: 0 };
    })
    .filter((l) => l.points2.length >= 3 && l.area > 1e-4);

  for (let i = 0; i < loops.length; i++) {
    const p = loops[i].points2[0];
    let best = -1;
    let bestArea = Number.POSITIVE_INFINITY;
    for (let j = 0; j < loops.length; j++) {
      if (i === j || loops[j].area <= loops[i].area + 1e-6) continue;
      if (pointInPolygonXZ(p.x, p.y, loops[j].points2) && loops[j].area < bestArea) {
        best = j;
        bestArea = loops[j].area;
      }
    }
    loops[i].parent = best;
  }

  const depthOf = (i: number, seen = new Set<number>()): number => {
    const l = loops[i];
    if (l.parent < 0 || seen.has(i)) return 0;
    seen.add(i);
    return 1 + depthOf(l.parent, seen);
  };
  loops.forEach((l, i) => (l.depth = depthOf(i) % 2 === 0 ? 0 : 1));
  // Keep actual parity through potentially nested island/hole chains.
  loops.forEach((l, i) => {
    let d = 0;
    let p = l.parent;
    const seen = new Set<number>([i]);
    while (p >= 0 && !seen.has(p)) {
      seen.add(p);
      d++;
      p = loops[p].parent;
    }
    l.depth = d % 2;
  });
  return loops;
}

function appendCaps(rawLoops: THREE.Vector3[][], h: number, lower: boolean, positions: number[], normals: number[]) {
  const loops = buildCapLoops(rawLoops);
  const outNormal = lower ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -1, 0);

  for (let outerIndex = 0; outerIndex < loops.length; outerIndex++) {
    const outer = loops[outerIndex];
    if (outer.depth !== 0) continue;
    const holes = loops.filter((l) => l.parent === outerIndex && l.depth === 1);

    const vertex3: THREE.Vector3[] = [];
    const vertex2: THREE.Vector2[] = [];
    const holeStarts: number[] = [];

    for (const p of outer.points3) {
      vertex3.push(new THREE.Vector3(p.x, h, p.z));
      vertex2.push(new THREE.Vector2(p.x, p.z));
    }
    for (const hole of holes) {
      holeStarts.push(vertex2.length);
      for (const p of hole.points3) {
        vertex3.push(new THREE.Vector3(p.x, h, p.z));
        vertex2.push(new THREE.Vector2(p.x, p.z));
      }
    }

    const flat: number[] = [];
    vertex2.forEach((p) => flat.push(p.x, p.y));
    let indices: number[] = [];
    try {
      indices = earcut(flat, holeStarts, 2);
    } catch {
      continue;
    }

    for (let k = 0; k < indices.length; k += 3) {
      let ia = indices[k];
      let ib = indices[k + 1];
      let ic = indices[k + 2];
      const a = vertex3[ia];
      const b = vertex3[ib];
      const c = vertex3[ic];
      const ny = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a)).y;
      if ((lower && ny < 0) || (!lower && ny > 0)) {
        const tmp = ib;
        ib = ic;
        ic = tmp;
      }
      for (const idx of [ia, ib, ic]) {
        const v = vertex3[idx];
        positions.push(v.x, h, v.z);
        normals.push(outNormal.x, outNormal.y, outNormal.z);
      }
    }
  }
}

function toGeometry(positions: number[], normals: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function chainSegments(segments: Array<[THREE.Vector3, THREE.Vector3]>, h: number): Vec3[][] {
  const pointMap = new Map<string, THREE.Vector3>();
  const edges = new Set<string>();
  const adjacency = new Map<string, Set<string>>();

  for (const [a0, b0] of segments) {
    const a = a0.clone();
    const b = b0.clone();
    a.y = h;
    b.y = h;
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === kb) continue;
    pointMap.set(ka, a);
    pointMap.set(kb, b);
    const ek = edgeKey(ka, kb);
    if (edges.has(ek)) continue;
    edges.add(ek);
    if (!adjacency.has(ka)) adjacency.set(ka, new Set());
    if (!adjacency.has(kb)) adjacency.set(kb, new Set());
    adjacency.get(ka)!.add(kb);
    adjacency.get(kb)!.add(ka);
  }

  const unused = new Set(edges);
  const result: Vec3[][] = [];

  while (unused.size) {
    const firstEdge = unused.values().next().value as string;
    unused.delete(firstEdge);
    const [ka, kb] = firstEdge.split('|');
    const keyLoop = [ka, kb];
    let prev = ka;
    let cur = kb;
    let closed = false;

    for (let guard = 0; guard < 200000; guard++) {
      if (cur === ka) {
        closed = true;
        break;
      }
      const candidates = [...(adjacency.get(cur) ?? [])];
      let next = candidates.find((n) => n !== prev && unused.has(edgeKey(cur, n)));
      if (!next) next = candidates.find((n) => unused.has(edgeKey(cur, n)));
      if (!next) break;

      unused.delete(edgeKey(cur, next));
      if (next === ka) {
        closed = true;
        break;
      }
      keyLoop.push(next);
      prev = cur;
      cur = next;
    }

    if (keyLoop.length >= 3) {
      const pts = keyLoop.map((k) => pointMap.get(k) ?? new THREE.Vector3());
      if (!closed && pts.length > 2) pts.push(pts[0].clone());
      result.push(pts.map((p) => ({ x: p.x, y: h, z: p.z })));
    }
  }
  return result;
}

function collectBVHPlaneSegments(
  source: THREE.BufferGeometry,
  h: number,
  segments: Array<[THREE.Vector3, THREE.Vector3]>,
): number {
  if (!source.boundsTree) source.boundsTree = new MeshBVH(source, { targetLeafSize: 8 });
  const bvh = source.boundsTree;
  let hits = 0;
  const crossings: THREE.Vector3[] = [];

  const edgeIntersection = (a: THREE.Vector3, b: THREE.Vector3) => {
    const da = a.y - h;
    const db = b.y - h;
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
      const t = (h - a.y) / (b.y - a.y);
      return a.clone().lerp(b, t);
    }
    return null;
  };

  bvh.shapecast({
    intersectsBounds: (box: THREE.Box3) => box.min.y <= h + EPS * 4 && box.max.y >= h - EPS * 4,
    intersectsTriangle: (triangle: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }) => {
      crossings.length = 0;
      const ab = edgeIntersection(triangle.a, triangle.b);
      const bc = edgeIntersection(triangle.b, triangle.c);
      const ca = edgeIntersection(triangle.c, triangle.a);
      if (ab) crossings.push(ab);
      if (bc) crossings.push(bc);
      if (ca) crossings.push(ca);
      if (crossings.length >= 2) {
        segments.push([crossings[0], crossings[1]]);
        hits++;
      }
      return false;
    },
    // The shipped .d.ts currently omits MeshBVH's intersectsTriangle hook.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return hits;
}

export function splitGeometryAtY(input: THREE.BufferGeometry, h: number): PlaneSplitResult {
  const source = getNonIndexed(input);
  const pos = source.attributes.position as THREE.BufferAttribute;
  const normalAttr = source.attributes.normal as THREE.BufferAttribute | undefined;

  const lowerPositions: number[] = [];
  const lowerNormals: number[] = [];
  const upperPositions: number[] = [];
  const upperNormals: number[] = [];
  const lowerBodyPositions: number[] = [];
  const lowerBodyNormals: number[] = [];
  const upperBodyPositions: number[] = [];
  const upperBodyNormals: number[] = [];
  const planeSegments: Array<[THREE.Vector3, THREE.Vector3]> = [];

  const triCount = Math.floor(pos.count / 3);
  collectBVHPlaneSegments(source, h, planeSegments);
  for (let t = 0; t < triCount; t++) {
    const tri: PN[] = [];
    for (let k = 0; k < 3; k++) {
      const idx = t * 3 + k;
      let y = pos.getY(idx);
      if (Math.abs(y - h) < EPS) y = h;
      const nx = normalAttr ? normalAttr.getX(idx) : 0;
      const ny = normalAttr ? normalAttr.getY(idx) : 1;
      const nz = normalAttr ? normalAttr.getZ(idx) : 0;
      tri.push(makePN(pos.getX(idx), y, pos.getZ(idx), nx, ny, nz));
    }

    const lowerPoly = clipTriangle(tri, h, true);
    const upperPoly = clipTriangle(tri, h, false);

    appendFan(lowerPoly, lowerPositions, lowerNormals, lowerBodyPositions, lowerBodyNormals);
    appendFan(upperPoly, upperPositions, upperNormals, upperBodyPositions, upperBodyNormals);

    for (let i = 0; i < lowerPoly.length; i++) {
      const a = lowerPoly[i];
      const b = lowerPoly[(i + 1) % lowerPoly.length];
      if (Math.abs(a.p.y - h) < EPS * 2 && Math.abs(b.p.y - h) < EPS * 2) {
        planeSegments.push([a.p.clone(), b.p.clone()]);
      }
    }
  }

  const loops = chainSegments(planeSegments, h);
  appendCaps(loops.map((l) => l.map((p) => new THREE.Vector3(p.x, p.y, p.z))), h, true, lowerPositions, lowerNormals);
  appendCaps(loops.map((l) => l.map((p) => new THREE.Vector3(p.x, p.y, p.z))), h, false, upperPositions, upperNormals);

  const lower = toGeometry(lowerPositions, lowerNormals);
  const upper = toGeometry(upperPositions, upperNormals);
  const lowerBody = toGeometry(lowerBodyPositions, lowerBodyNormals);
  const upperBody = toGeometry(upperBodyPositions, upperBodyNormals);

  return {
    lower,
    upper,
    lowerBody,
    upperBody,
    loops,
    segmentCount: planeSegments.length,
    capped: loops.length > 0,
  };
}

export function geometryVolumeMm3(g: THREE.BufferGeometry): number {
  const p = g.attributes.position as THREE.BufferAttribute;
  let sum = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    sum += a.dot(b.clone().cross(c));
  }
  return Math.abs(sum) / 6;
}
