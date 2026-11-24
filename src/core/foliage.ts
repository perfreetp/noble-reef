import { Quaternion, Vector3 } from 'three';
import { Rng } from './rng';
import type { FoliageData, FoliageParams, LeafData, Skeleton } from './types';
import { leafSites } from './skeleton';
import { clamp, hashString, quatToV4, toV3 } from './math';
import type { TreeRig } from './pose';

export const DEFAULT_FOLIAGE: FoliageParams = {
  density: 2.6,
  size: 1.75,
  hue: 0.24,
  opacity: 0.84,
  fluff: 0.5,
  seed: 7,
};

interface Site {
  node: number;
  limb: number;
  depth: number;
  count: number;
  spread: number;
}

/** Leaves live in bind space, anchored to a joint, so a pose can move them cheaply. */
export function generateFoliage(skel: Skeleton, rig: TreeRig, params: FoliageParams): FoliageData {
  const sites = leafSites(skel.limbs, new Set(skel.limbs.filter((l) => rig.limbVisible[l.id]).map((l) => l.id)));
  const leaves: LeafData[] = [];
  const byDepth: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (let s = 0; s < sites.length; s++) {
    const site = sites[s];
    const node = skel.nodes[site.node];
    if (!node) continue;
    // Deterministic per-site randomness keeps the canopy stable while dragging.
    const rng = new Rng(hashString(`${params.seed}:${site.limb}:${site.node}:${params.density}`));
    const baseCount = site.count * params.density;
    const count = Math.round(baseCount + (rng.next() - 0.5) * 1.5);
    const limb = skel.limbs[site.limb];
    const tipNode = skel.nodes[limb.nodes[limb.nodes.length - 1]];
    const outward = new Vector3(...tipNode.restPos).sub(new Vector3(...node.restPos));
    outward.y *= 0.35;
    if (outward.lengthSq() < 1e-6) outward.set(0, 0.2, 1);
    outward.normalize();
    const spread = site.spread * (0.55 + params.fluff * 0.9);
    // Pads read as layered foliage: wide in plan, thin in section, sitting above the
    // branch they belong to.
    const padY = 0.3;
    const base = new Vector3(...node.restPos);
    // Foliage pads are built from a few overlapping sub-clusters, which gives the flat,
    // layered silhouette a bonsai pad has rather than a single round blob.
    const clusters = 3 + Math.round(rng.next() * 2);
    const clusterCenters: Vector3[] = [];
    for (let c = 0; c < clusters; c++) {
      const ang = (c / clusters) * Math.PI * 2 + rng.range(-0.5, 0.5);
      const dist = spread * rng.range(0.15, 0.62);
      clusterCenters.push(new Vector3(
        Math.cos(ang) * dist,
        rng.range(-0.1, 0.3) * spread * padY,
        Math.sin(ang) * dist,
      ).addScaledVector(outward, spread * (0.3 + rng.range(-0.1, 0.35))));
    }
    for (let i = 0; i < count; i++) {
      const cc = clusterCenters[i % clusters];
      const dir = new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
      if (dir.lengthSq() < 1e-5) dir.set(1, 0, 0);
      dir.normalize();
      const r = Math.pow(rng.next(), 0.42);
      const dome = 1 - r * r * 0.5;
      const clump = spread * 0.5;
      const offset = base.clone()
        .add(cc)
        .add(new Vector3(dir.x * clump * r, dir.y * clump * padY * dome, dir.z * clump * r));
      offset.y += spread * 0.22 + spread * 0.1 * (1 - r);

      // Leaf orientation: length mostly along the pad surface, face tilted up.
      const up = new Vector3(0, 1, 0);
      const radial = offset.clone().sub(new Vector3(...node.restPos));
      if (radial.lengthSq() < 1e-8) radial.copy(outward);
      radial.normalize();
      // Leaves fan out sideways and slightly up: they read as a pad, not a spiky ball.
      const lengthDir = radial.clone().multiplyScalar(0.85)
        .add(new Vector3(0, 1, 0).multiplyScalar(0.3))
        .add(new Vector3(rng.range(-0.45, 0.45), rng.range(-0.15, 0.4), rng.range(-0.45, 0.45)))
        .normalize();
      const q = new Quaternion().setFromUnitVectors(up, lengthDir);
      q.multiply(new Quaternion().setFromAxisAngle(up, rng.range(0, Math.PI * 2)));
      const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rng.range(-0.5, 0.5));
      q.multiply(tilt);

      const depthScale = site.depth === 1 ? 1.16 : site.depth === 2 ? 1 : 0.86;
      const size = params.size * depthScale * rng.range(0.68, 1.3);
      const qf = q.normalize();
      leaves.push({
        node: site.node,
        offset: toV3(offset),
        quat: quatToV4(qf),
        size,
        depth: site.depth,
        tone: rng.next(),
      });
      byDepth[site.depth] = (byDepth[site.depth] ?? 0) + 1;
    }
  }
  return { leaves, byDepth };
}

/** Simple leaf silhouette in the local XY plane with a slight cup in Z. */
export function leafGeometryArrays(): { positions: number[]; indices: number[] } {
  // Ovate leaf: a smooth closed curve, widest just past the middle.
  const outline: [number, number][] = [];
  const steps = 22;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const y = 0.5 - Math.cos(a) * 0.5; // 0..1 along the midrib
    const width = Math.pow(Math.sin(Math.PI * Math.pow(y, 0.82)), 0.95) * 0.34;
    const x = Math.sin(a) * width;
    outline.push([x * (i < steps / 2 ? 1 : 1), y]);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  const center: [number, number, number] = [0, 0.5, 0.04];
  positions.push(...center);
  for (const [x, y] of outline) {
    const cup = -((Math.abs(x) / 0.34) ** 2) * 0.045 + Math.sin(y * Math.PI) * 0.012;
    positions.push(x, y, cup);
  }
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % n));
  }
  // Back faces so the leaf is visible from both sides with independent shading.
  const back = positions.length / 3;
  positions.push(...center);
  for (const [x, y] of outline) {
    const cup = -((Math.abs(x) / 0.34) ** 2) * 0.045 + Math.sin(y * Math.PI) * 0.012;
    positions.push(x, y, cup - 0.01);
  }
  for (let i = 0; i < n; i++) {
    indices.push(back, back + 1 + ((i + 1) % n), back + 1 + i);
  }
  return { positions, indices };
}



/** Rough canopy radius used for framing the camera. */

export function leafCountByDepth(leaves: readonly LeafData[]): Record<number, number> {
  const out: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const l of leaves) out[l.depth] = (out[l.depth] ?? 0) + 1;
  return out;
}

export function clampFoliage(p: FoliageParams): FoliageParams {
  return {
    density: clamp(p.density, 0.2, 4),
    size: clamp(p.size, 0.6, 3.2),
    hue: clamp(p.hue, 0, 1),
    opacity: clamp(p.opacity, 0.3, 1),
    fluff: clamp(p.fluff, 0, 1),
    seed: p.seed,
  };
}



