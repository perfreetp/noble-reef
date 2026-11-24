import { Quaternion, Vector3 } from 'three';
import { Rng } from './rng';
import { clamp, DEG, toV3 } from './math';
import type { LimbInfo, Skeleton, SkeletonNode, TreeParams } from './types';

export const DEFAULT_TREE: TreeParams = {
  seed: 12,
  height: 31,
  trunkBend: 0.72,
  trunkRadius: 3.1,
  taper: 0.36,
  primaryCount: 6,
  primaryLength: 10.5,
  branchSpread: 0.78,
  droop: 0.42,
  detail: 2,
};

export const TRUNK_NODES = 15;
const PRIMARY_SEGMENTS = 5;
const SECONDARY_SEGMENTS = 4;
const TWIG_SEGMENTS = 2;

interface WalkOptions {
  start: Vector3;
  dir: Vector3;
  nodes: number;
  length: number;
  curl: Vector3;
  rng: Rng;
  wiggle: number;
}

/** March a chain forward, bending a little at each joint. Returns joints (index 0 = origin). */
function walk(opts: WalkOptions): Vector3[] {
  const pos: Vector3[] = [opts.start.clone()];
  const step = opts.length / opts.nodes;
  const d = opts.dir.clone().normalize();
  for (let i = 0; i < opts.nodes; i++) {
    d.add(opts.curl)
      .add(new Vector3(
        opts.rng.jitter() * opts.wiggle,
        opts.rng.jitter() * opts.wiggle * 0.4,
        opts.rng.jitter() * opts.wiggle,
      ))
      .normalize();
    pos.push(pos[pos.length - 1].clone().addScaledVector(d, step));
  }
  return pos;
}

/** Attach-frame orientation of a chain joint: +Y along the incoming bone. */
const WORLD_UP = new Vector3(0, 1, 0);

export function quatFromDir(dir: Vector3): Quaternion {
  const d = dir.clone();
  if (d.lengthSq() < 1e-12) return new Quaternion();
  return new Quaternion().setFromUnitVectors(WORLD_UP, d.normalize());
}

export function buildSkeleton(input: TreeParams): Skeleton {
  const params: TreeParams = { ...DEFAULT_TREE, ...input };
  const rng = new Rng(params.seed * 7919 + 101);
  const nodes: SkeletonNode[] = [];
  const limbs: LimbInfo[] = [];
  const H = params.height;
  const bend = params.trunkBend;

  // ---- Trunk: informal upright, gentle S-curve.
  const trunkPos: Vector3[] = [];
  for (let i = 0; i < TRUNK_NODES; i++) {
    const t = i / (TRUNK_NODES - 1);
    const y = H * Math.pow(t, 1.16);
    const sway = Math.sin(3.05 * t - 0.65) + Math.sin(0.65);
    const x = H * bend * 0.13 * sway * Math.pow(t, 0.9) + H * 0.006 * Math.sin(6.4 * t) * t;
    const z = H * bend * 0.042 * Math.sin(4.2 * t + 0.4) * t * t;
    trunkPos.push(new Vector3(x, y, z));
  }
  limbs.push({ id: 0, parentLimb: -1, attachNode: -1, nodes: [], depth: 0, kind: 'trunk', seedAngle: 0 });
  const pushNode = (
    id: number,
    parent: number,
    limb: number,
    depth: number,
    pos: Vector3,
    radius: number,
    segIndex: number,
    length: number,
  ): SkeletonNode => {
    const node: SkeletonNode = {
      id,
      parent,
      limb,
      depth,
      restPos: toV3(pos),
      radius,
      length,
      segIndex,
      control: false,
    };
    nodes.push(node);
    return node;
  };
  for (let i = 0; i < TRUNK_NODES; i++) {
    const t = i / (TRUNK_NODES - 1);
    const radius = params.trunkRadius * (1 - (1 - params.taper) * Math.pow(t, 0.75))
      * (1 + 0.5 * Math.exp(-t * 10));
    const length = i === 0 ? 0 : trunkPos[i].distanceTo(trunkPos[i - 1]);
    const node = pushNode(i, i - 1, 0, 0, trunkPos[i], radius, i, length);
    limbs[0].nodes.push(node.id);
  }

  // ---- Primaries spiral up the trunk on the golden angle, with tapering droop.
  const golden = 137.50776 * DEG;
  let angle = rng.range(0, Math.PI * 2);
  const primaryCount = clamp(Math.round(params.primaryCount), 3, 9);
  const firstAttach = Math.max(2, Math.round((TRUNK_NODES - 1) * 0.28));
  const lastAttach = TRUNK_NODES - 3;
  const attaches: number[] = [];
  for (let k = 0; k < primaryCount; k++) {
    const f = primaryCount === 1 ? 0.5 : k / (primaryCount - 1);
    const idx = Math.round(firstAttach + f * (lastAttach - firstAttach) + rng.jitter() * 0.3);
    attaches.push(clamp(idx, 1, TRUNK_NODES - 3));
  }
  for (let k = 1; k < attaches.length; k++) {
    if (attaches[k] <= attaches[k - 1]) attaches[k] = Math.min(TRUNK_NODES - 3, attaches[k - 1] + 1);
  }

  const primaryLimbIds: number[] = [];
  for (let k = 0; k < attaches.length; k++) {
    const attach = attaches[k];
    const base = trunkPos[attach];
    angle += golden + rng.range(-0.3, 0.3);
    const outward = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const pitch = (0.6 + rng.range(-0.15, 0.2)) * params.branchSpread;
    const dir = outward.clone().multiplyScalar(Math.cos(pitch)).add(new Vector3(0, Math.sin(pitch), 0)).normalize();
    const len = params.primaryLength * rng.range(0.8, 1.15) * (1 - 0.1 * (k / primaryCount));
    const curl = outward.clone().multiplyScalar(0.03)
      .add(new Vector3(0, -params.droop * 0.2, 0));
    const pos = walk({
      start: base.clone(), dir, nodes: PRIMARY_SEGMENTS, length: len, curl, rng,
      wiggle: 0.055 * params.branchSpread,
    });
    const limbId = limbs.length;
    const limb: LimbInfo = {
      id: limbId, parentLimb: 0, attachNode: attach, nodes: [], depth: 1, kind: 'primary',
      seedAngle: angle,
    };
    const startRadius = Math.min(nodes[attach].radius * 0.6, 1.2);
    for (let j = 1; j <= PRIMARY_SEGMENTS; j++) {
      const t = j / PRIMARY_SEGMENTS;
      const parent = j === 1 ? attach : nodes.length - 1;
      const radius = startRadius * (1 - 0.7 * Math.pow(t, 0.9));
      const node = pushNode(nodes.length, parent, limbId, 1, pos[j], radius, j - 1,
        pos[j].distanceTo(pos[j - 1]));
      limb.nodes.push(node.id);
    }
    limbs.push(limb);
    primaryLimbIds.push(limbId);
  }

  // ---- Secondaries spring from primaries in alternating pairs.
  const secondaryLimbIds: number[] = [];
  for (const pid of primaryLimbIds) {
    const limb = limbs[pid];
    const segCount = limb.nodes.length;
    const pairCount = clamp(params.detail, 1, 3);
    for (let s = 0; s < pairCount; s++) {
      const idx = clamp(1 + Math.round((s / pairCount) * (segCount - 2)), 1, segCount - 2);
      const attach = limb.nodes[idx];
      const attachNode = nodes[attach];
      const prev = nodes[attachNode.parent];
      const outDir = new Vector3(...attachNode.restPos).sub(new Vector3(...prev.restPos)).normalize();
      const side = new Vector3(-outDir.z, 0, outDir.x).normalize();
      const sgn = s % 2 === 0 ? 1 : -1;
      const dir = outDir.clone().multiplyScalar(0.5)
        .addScaledVector(side, sgn * 0.5)
        .add(new Vector3(0, 0.5, 0))
        .normalize();
      const pos = walk({
        start: new Vector3(...attachNode.restPos), dir, nodes: SECONDARY_SEGMENTS,
        length: params.primaryLength * rng.range(0.34, 0.5),
        curl: new Vector3(0, -0.05, 0), rng, wiggle: 0.1,
      });
      const limbId = limbs.length;
      const limbInfo: LimbInfo = {
        id: limbId, parentLimb: pid, attachNode: attach, nodes: [], depth: 2, kind: 'secondary',
        seedAngle: Math.atan2(pos[1].z - pos[0].z, pos[1].x - pos[0].x),
      };
      const startRadius = Math.max(0.16, attachNode.radius * 0.55);
      for (let j = 1; j <= SECONDARY_SEGMENTS; j++) {
        const t = j / SECONDARY_SEGMENTS;
        const parent = j === 1 ? attach : nodes.length - 1;
        const node = pushNode(nodes.length, parent, limbId, 2, pos[j],
          startRadius * (1 - 0.72 * Math.pow(t, 0.85)), j - 1, pos[j].distanceTo(pos[j - 1]));
        limbInfo.nodes.push(node.id);
      }
      limbs.push(limbInfo);
      secondaryLimbIds.push(limbId);

      // A fine twig off the secondary midrib.
      if (params.detail >= 2) {
        const twigAttach = limbInfo.nodes[Math.min(1, limbInfo.nodes.length - 2)];
        const twigNode = nodes[twigAttach];
        const twigPrev = nodes[twigNode.parent];
        const twigOut = new Vector3(...twigNode.restPos).sub(new Vector3(...twigPrev.restPos)).normalize();
        const twigSide = new Vector3(-twigOut.z, 0, twigOut.x).normalize().multiplyScalar(rng.range(-0.9, 0.9));
        const twigDir = twigOut.clone().multiplyScalar(0.55).add(twigSide).add(new Vector3(0, 0.55, 0)).normalize();
        const twigPos = walk({
          start: new Vector3(...twigNode.restPos), dir: twigDir, nodes: TWIG_SEGMENTS,
          length: params.primaryLength * rng.range(0.13, 0.22),
          curl: new Vector3(0, 0.025, 0), rng, wiggle: 0.16,
        });
        const twigId = limbs.length;
        const twig: LimbInfo = {
          id: twigId, parentLimb: limbId, attachNode: twigAttach, nodes: [], depth: 3, kind: 'twig',
          seedAngle: Math.atan2(twigDir.z, twigDir.x),
        };
        for (let j = 1; j <= TWIG_SEGMENTS; j++) {
          const parent = j === 1 ? twigAttach : nodes.length - 1;
          const node = pushNode(nodes.length, parent, twigId, 3, twigPos[j],
            Math.max(0.055, twigNode.radius * 0.45 * (1 - 0.55 * (j / TWIG_SEGMENTS))),
            j - 1, twigPos[j].distanceTo(twigPos[j - 1]));
          twig.nodes.push(node.id);
        }
        limbs.push(twig);
      }
    }
  }

  // ---- Draggable controls: 7 on the trunk, two per primary, one per secondary.
  const mark = (nodeId: number): void => {
    const n = nodes[nodeId];
    if (n) n.control = true;
  };
  for (const idx of [2, 4, 6, 8, 10, 12, TRUNK_NODES - 1]) mark(idx);
  for (const pid of primaryLimbIds) {
    const limb = limbs[pid];
    mark(limb.nodes[1]);
    mark(limb.nodes[limb.nodes.length - 1]);
  }
  for (const sid of secondaryLimbIds) {
    const limb = limbs[sid];
    mark(limb.nodes[limb.nodes.length - 2]);
  }
  const controls = nodes.filter((n) => n.control).map((n) => n.id);

  return {
    seed: params.seed,
    nodes,
    limbs,
    controls,
    trunk: limbs[0].nodes.slice(),
    params,
  };
}

export function limbKindLabel(kind: LimbInfo['kind']): string {
  switch (kind) {
    case 'trunk': return '主干';
    case 'primary': return '一级枝';
    case 'secondary': return '二级枝';
    case 'twig': return '细枝';
    case 'root': return '根';
  }
}

export function limbDepthLabel(depth: number): string {
  return ['主干', '一级枝', '二级枝', '细枝'][depth] ?? '枝';
}

/**
 * Which limbs survive pruning. A pruned limb takes all of its descendants with it.
 * Limbs are always listed parent-first.
 */
export function visibleLimbSet(limbs: readonly LimbInfo[], pruned: readonly number[]): Set<number> {
  const dead = new Set<number>(pruned);
  for (const limb of limbs) {
    if (limb.parentLimb >= 0 && dead.has(limb.parentLimb)) dead.add(limb.id);
  }
  const visible = new Set<number>();
  for (const limb of limbs) if (!dead.has(limb.id)) visible.add(limb.id);
  return visible;
}

/** Leaf anchoring sites, weighted by branch order. */
export function leafSites(limbs: readonly LimbInfo[], visible: Set<number>): {
  node: number; limb: number; depth: number; count: number; spread: number;
}[] {
  const sites: { node: number; limb: number; depth: number; count: number; spread: number }[] = [];
  for (const limb of limbs) {
    if (!visible.has(limb.id) || limb.kind === 'trunk') continue;
    if (limb.kind === 'primary') {
      sites.push({ node: limb.nodes[limb.nodes.length - 1], limb: limb.id, depth: 1, count: 6, spread: 3.4 });
      sites.push({ node: limb.nodes[Math.max(0, limb.nodes.length - 2)], limb: limb.id, depth: 1, count: 5, spread: 2.9 });
      sites.push({ node: limb.nodes[Math.max(0, limb.nodes.length - 3)], limb: limb.id, depth: 1, count: 3.5, spread: 2.5 });
    } else if (limb.kind === 'secondary') {
      sites.push({ node: limb.nodes[limb.nodes.length - 1], limb: limb.id, depth: 2, count: 6, spread: 2.3 });
      sites.push({ node: limb.nodes[Math.max(0, limb.nodes.length - 2)], limb: limb.id, depth: 2, count: 5, spread: 2.1 });
    } else if (limb.kind === 'twig') {
      sites.push({ node: limb.nodes[limb.nodes.length - 1], limb: limb.id, depth: 3, count: 8, spread: 1.8 });
      sites.push({ node: limb.nodes[0], limb: limb.id, depth: 3, count: 4, spread: 1.5 });
    }
  }
  return sites;
}
