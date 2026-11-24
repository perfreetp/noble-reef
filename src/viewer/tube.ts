import { Color, Quaternion, Vector3 } from 'three';
import type { Skeleton } from '../core/types';
import type { TreeRig } from '../core/pose';

export interface TubeGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  limbOfVertex: Uint16Array;
  indices: Uint32Array;
  /** World-space AABB used for framing. */
  min: Vector3;
  max: Vector3;
}

const UP = new Vector3(0, 1, 0);

interface RingFrame {
  center: Vector3;
  axis: Vector3;
  u: Vector3;
  v: Vector3;
  radius: number;
  segments: number;
  limb: number;
  barkTone: number;
}

function segmentsFor(radius: number): number {
  if (radius > 2.4) return 22;
  if (radius > 1.5) return 18;
  if (radius > 0.9) return 12;
  if (radius > 0.45) return 8;
  return 6;
}

/**
 * Bark palette by branch order. Hex values are sRGB; `Color.setHex` converts them to the
 * linear working space that vertex colours need, which keeps the bark brown under tone
 * mapping instead of turning grey.
 */
const BARK_HEX = [0xa8835f, 0xb08c66, 0xb89670, 0xc0a07b];
const BARK_LINEAR = BARK_HEX.map((hex) => {
  const c = new Color(hex);
  return [c.r, c.g, c.b] as [number, number, number];
});

function barkTone(depth: number): [number, number, number] {
  return BARK_LINEAR[Math.min(BARK_LINEAR.length - 1, Math.max(0, depth))];
}

/**
 * Sweeps tapered rings along every visible limb. Frames are parallel-transported so
 * twisting the tree does not introduce a pinched or spinning tube.
 */
export function buildTubeGeometry(skel: Skeleton, rig: TreeRig): TubeGeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const limbOf: number[] = [];
  const indices: number[] = [];
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);

  const addRing = (frame: RingFrame): number => {
    const base = positions.length / 3;
    const [cr, cg, cb] = barkTone(skel.limbs[frame.limb].depth);
    const shade = frame.barkTone;
    for (let s = 0; s < frame.segments; s++) {
      const a = (s / frame.segments) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nx = frame.u.x * ca + frame.v.x * sa;
      const ny = frame.u.y * ca + frame.v.y * sa;
      const nz = frame.u.z * ca + frame.v.z * sa;
      const px = frame.center.x + nx * frame.radius;
      const py = frame.center.y + ny * frame.radius;
      const pz = frame.center.z + nz * frame.radius;
      positions.push(px, py, pz);
      normals.push(nx, ny, nz);
      colors.push(cr * shade, cg * shade, cb * shade);
      limbOf.push(frame.limb);
      if (px < min.x) min.x = px;
      if (py < min.y) min.y = py;
      if (pz < min.z) min.z = pz;
      if (px > max.x) max.x = px;
      if (py > max.y) max.y = py;
      if (pz > max.z) max.z = pz;
    }
    return base;
  };

  const stitch = (a: number, b: number, segs: number): void => {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      indices.push(a + s, b + s, a + s2);
      indices.push(a + s2, b + s, b + s2);
    }
  };

  const addLimb = (limbId: number, chain: number[]): void => {
    const limb = skel.limbs[limbId];
    const nodes = chain;
    const rings: RingFrame[] = [];
    const prevU = new Vector3();
    const axis = new Vector3();
    const q = new Quaternion();
    const positions3 = nodes.map((id) => rig.nodePos(id));

    for (let j = 0; j < nodes.length; j++) {
      const id = nodes[j];
      const node = skel.nodes[id];
      const p = positions3[j];
      if (j === 0) {
        axis.copy(positions3[1] ?? p).sub(p);
      } else if (j === nodes.length - 1) {
        axis.copy(p).sub(positions3[j - 1]);
      } else {
        axis.copy(positions3[j + 1]).sub(positions3[j - 1]);
      }
      if (axis.lengthSq() < 1e-9) axis.set(0, 1, 0);
      axis.normalize();
      let u: Vector3;
      if (j === 0) {
        const ref = Math.abs(axis.y) > 0.94 ? new Vector3(1, 0, 0) : UP;
        u = new Vector3().crossVectors(ref, axis).normalize();
        if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
      } else {
        const prevAxis = new Vector3().copy(rings[j - 1].axis);
        q.setFromUnitVectors(prevAxis, axis);
        u = rings[j - 1].u.clone().applyQuaternion(q);
        // Re-orthogonalise against the new axis to stop drift.
        u.addScaledVector(axis, -u.dot(axis)).normalize();
      }
      prevU.copy(u);
      const v = new Vector3().crossVectors(axis, u).normalize();
      let radius = node.radius;
      if (j === 0 && limbId !== 0) {
        // Blend the first ring with the joint it sprouts from.
        const parentNode = skel.nodes[node.parent];
        radius = Math.min(node.radius * 1.18, (parentNode?.radius ?? node.radius) * 0.62);
      }
      if (j === nodes.length - 1) radius *= 0.72;
      rings.push({
        center: p.clone(),
        axis: axis.clone(),
        u,
        v,
        radius: Math.max(0.035, radius),
        segments: segmentsFor(radius),
        limb: limbId,
        barkTone: 0.93 + ((id * 37) % 17) / 120,
      });
    }

    // Normalise segment counts within a limb so the stitch stays simple: use the max.
    const segs = Math.max(...rings.map((r) => r.segments));
    for (const ring of rings) ring.segments = segs;

    let prevBase = -1;
    for (let j = 0; j < rings.length; j++) {
      const base = addRing(rings[j]);
      if (prevBase >= 0) stitch(prevBase, base, segs);
      prevBase = base;
    }
    // Tip cap: a small cone so tips do not read as open pipes.
    const last = rings[rings.length - 1];
    const centerIndex = positions.length / 3;
    const tip = last.center.clone().addScaledVector(last.axis, last.radius * 1.7);
    positions.push(tip.x, tip.y, tip.z);
    normals.push(last.axis.x, last.axis.y, last.axis.z);
    const [cr, cg, cb] = barkTone(limb.depth);
    colors.push(cr, cg, cb);
    limbOf.push(limbId);
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      indices.push(prevBase + s, centerIndex, prevBase + s2);
    }
  };

  for (const limb of skel.limbs) {
    if (!rig.limbVisible[limb.id]) continue;
    if (limb.kind === 'trunk') {
      addLimb(limb.id, limb.nodes);
      continue;
    }
    const attach = limb.attachNode;
    if (attach < 0 || !rig.visible[attach]) continue;
    addLimb(limb.id, [attach, ...limb.nodes]);
  }

  // Root flare at the base of the trunk.
  addRootFlare(skel, rig, positions, normals, colors, limbOf, indices, min, max);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    limbOfVertex: new Uint16Array(limbOf),
    indices: new Uint32Array(indices),
    min,
    max,
  };
}

function addRootFlare(
  skel: Skeleton,
  rig: TreeRig,
  positions: number[],
  normals: number[],
  colors: number[],
  limbOf: number[],
  indices: number[],
  min: Vector3,
  max: Vector3,
): void {
  const baseIndex = skel.trunk[0];
  if (!rig.visible[baseIndex]) return;
  const base = rig.nodePos(baseIndex);
  const next = rig.nodePos(skel.trunk[1] ?? baseIndex);
  const up = next.clone().sub(base);
  if (up.lengthSq() < 1e-8) up.set(0, 1, 0);
  up.normalize();
  // Buttress roots: a flared skirt with a few lobes, sinking below the soil line.
  const segs = 28;
  const baseRadius = skel.nodes[baseIndex].radius;
  const lobes = 5;
  const lobeSeed = baseIndex * 1.7 + 0.4;
  const profile = [
    { radius: 1.62, y: -1.6, lobe: 0.36 },  // buried
    { radius: 1.34, y: -0.15, lobe: 0.26 }, // emerging from the soil
    { radius: 1.12, y: 1.4, lobe: 0.12 },
    { radius: 1.0, y: 2.9, lobe: 0 },
  ];
  const u = new Vector3().crossVectors(Math.abs(up.y) > 0.9 ? new Vector3(1, 0, 0) : UP, up).normalize();
  const v = new Vector3().crossVectors(up, u).normalize();
  const ringPositions: Vector3[][] = [];
  for (const ring of profile) {
    const row: Vector3[] = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      // Lobed skirt: roots flare unevenly around the trunk, not as a symmetric cone.
      const lobe = 1 + ring.lobe * (0.65 * Math.abs(Math.sin(a * lobes * 0.5 + lobeSeed)) + 0.35 * Math.sin(a * 3 + lobeSeed * 2));
      const r = baseRadius * ring.radius * lobe;
      const c = base.clone().addScaledVector(up, ring.y);
      const p = c.addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
      row.push(p);
    }
    ringPositions.push(row);
  }
  const [cr, cg, cb] = BARK_LINEAR[0];
  const ringBases: number[] = [];
  for (let r = 0; r < ringPositions.length; r++) {
    const row = ringPositions[r];
    const baseIdx = positions.length / 3;
    ringBases.push(baseIdx);
    for (let s = 0; s < segs; s++) {
      const p = row[s];
      positions.push(p.x, p.y, p.z);
      const n = p.clone().sub(base).addScaledVector(up, baseRadius * 0.4).normalize();
      normals.push(n.x, n.y, n.z);
      colors.push(cr * 0.94, cg * 0.94, cb * 0.94);
      limbOf.push(0);
      if (p.x < min.x) min.x = p.x;
      if (p.y < min.y) min.y = p.y;
      if (p.z < min.z) min.z = p.z;
      if (p.x > max.x) max.x = p.x;
      if (p.y > max.y) max.y = p.y;
      if (p.z > max.z) max.z = p.z;
    }
  }
  for (let r = 0; r < ringBases.length - 1; r++) {
    const a0 = ringBases[r];
    const b0 = ringBases[r + 1];
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      indices.push(a0 + s, b0 + s, a0 + s2);
      indices.push(a0 + s2, b0 + s, b0 + s2);
    }
  }
}
