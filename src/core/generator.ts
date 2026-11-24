/**
 * 枝叶生成器:
 * - 将可编辑骨架(主干/分枝曲线)展开为约 twigBudget 根细枝实例
 * - 每根细枝带独立生长相位 phase 与层级 level
 * - 生长度 g∈[0,1] 时,细枝按 level 逐级萌发
 * - 修剪:被剪枝干下游生长度归零,并重算父级重心
 */
import * as THREE from 'three';
import type { BranchSkeleton, GrowthParams, SkeletonData } from '../types';
import { Rng } from './random';

export interface Twig {
  /** 稳定 key:同一(骨架,种子)下重建不变,用于修剪持久化 */
  key: string;
  branchId: string;
  level: number;
  phase: number;
  parent: number; // 父细枝索引,-1 表示直接长在骨架上
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  length: number;
  radius: number;
  /** 当前生长度 0..1(运行时计算) */
  growth: number;
  /** 是否被修剪(含上游被剪) */
  pruned: boolean;
}

export interface Leaf {
  twig: number;
  /** 沿细枝的位置 0..1 */
  t: number;
  phase: number;
  yaw: number;
  pitch: number;
  scale: number;
}

export interface BranchCurve {
  id: string;
  parentId: string | null;
  attachT: number;
  radius: number;
  curve: THREE.CatmullRomCurve3;
  length: number;
  /** 世界变换(附着到父曲线) */
  matrix: THREE.Matrix4;
}

export interface GeneratedTree {
  branchCurves: BranchCurve[];
  twigs: Twig[];
  leaves: Leaf[];
  /** 每根骨架枝干的重心(世界坐标),修剪后重算 */
  centersOfMass: Map<string, THREE.Vector3>;
  maxLevel: number;
}

const MAX_LEVEL = 5;
const UP = new THREE.Vector3(0, 1, 0);

/** 由骨架数据构建世界空间曲线(子枝干附着于父曲线 attachT 处) */
export function buildBranchCurves(skeleton: SkeletonData): BranchCurve[] {
  const curves = new Map<string, BranchCurve>();
  const result: BranchCurve[] = [];
  const byId = new Map(skeleton.branches.map((b) => [b.id, b]));

  const build = (b: BranchSkeleton): BranchCurve => {
    const existing = curves.get(b.id);
    if (existing) return existing;
    const local = new THREE.CatmullRomCurve3(
      b.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'catmullrom',
      0.5,
    );
    let matrix = new THREE.Matrix4();
    if (b.parentId) {
      const parentData = byId.get(b.parentId);
      if (parentData) {
        const parent = build(parentData);
        const attachPos = parent.curve.getPointAt(THREE.MathUtils.clamp(b.attachT, 0, 1));
        matrix = new THREE.Matrix4().makeTranslation(attachPos.x, attachPos.y, attachPos.z);
      }
    }
    const worldPoints = local.points.map((p) => p.clone().applyMatrix4(matrix));
    const worldCurve = new THREE.CatmullRomCurve3(worldPoints, false, 'catmullrom', 0.5);
    const bc: BranchCurve = {
      id: b.id,
      parentId: b.parentId,
      attachT: b.attachT,
      radius: b.radius,
      curve: worldCurve,
      length: worldCurve.getLength(),
      matrix,
    };
    curves.set(b.id, bc);
    result.push(bc);
    return bc;
  };

  for (const b of skeleton.branches) build(b);
  return result;
}

/** 收集某枝干及其全部下游枝干 id */
export function collectDescendants(skeleton: SkeletonData, rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const b of skeleton.branches) {
    if (b.parentId) {
      const list = children.get(b.parentId) ?? [];
      list.push(b.id);
      children.set(b.parentId, list);
    }
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of children.get(id) ?? []) {
      out.add(c);
      stack.push(c);
    }
  }
  return out;
}

export function generateTree(
  skeleton: SkeletonData,
  params: GrowthParams,
  prunedBranches: ReadonlySet<string>,
  prunedTwigs: ReadonlySet<string>,
): GeneratedTree {
  const branchCurves = buildBranchCurves(skeleton);
  const twigs: Twig[] = [];
  const leaves: Leaf[] = [];
  const rng = new Rng(params.seed, 1);
  const angleRad = THREE.MathUtils.degToRad(params.branchAngle);
  const budget = Math.max(50, params.twigBudget);

  // 被剪枝干集合(含下游)
  const deadBranches = new Set<string>();
  for (const id of prunedBranches) {
    for (const d of collectDescendants(skeleton, id)) deadBranches.add(d);
  }

  const tmpDir = new THREE.Vector3();
  const tmpSide = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();

  interface SpawnItem {
    origin: THREE.Vector3;
    dir: THREE.Vector3;
    level: number;
    length: number;
    radius: number;
    parent: number;
    branchId: string;
    key: string;
  }

  const queue: SpawnItem[] = [];

  // 沿每根骨架曲线播种一级细枝
  for (const bc of branchCurves) {
    const nodes = Math.max(2, Math.floor(bc.length / Math.max(0.08, params.internodeSpacing)));
    for (let i = 1; i <= nodes; i++) {
      const t = i / (nodes + 1);
      const pos = bc.curve.getPointAt(t);
      const tangent = bc.curve.getTangentAt(t).normalize();
      // 交替方位角,避免同侧拥挤
      const azimuth = i * 2.399963 + rng.float(0, 0.6); // 黄金角
      tmpSide.crossVectors(tangent, UP);
      if (tmpSide.lengthSq() < 1e-4) tmpSide.set(1, 0, 0);
      tmpSide.normalize();
      tmpUp.crossVectors(tmpSide, tangent).normalize();
      const dir = tangent
        .clone()
        .applyAxisAngle(tmpSide, angleRad * rng.float(0.7, 1.3))
        .applyAxisAngle(tangent, azimuth);
      const len = params.internodeSpacing * rng.float(1.6, 2.6) * (1.2 - t * 0.5);
      queue.push({
        origin: pos.clone(),
        dir,
        level: 1,
        length: len,
        radius: bc.radius * 0.45,
        parent: -1,
        branchId: bc.id,
        key: `${bc.id}:${i}`,
      });
    }
  }

  // 广度优先展开,直到预算耗尽
  let cursor = 0;
  while (cursor < queue.length && twigs.length < budget) {
    const item = queue[cursor++];
    const idx = twigs.length;
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, item.dir.clone().normalize());
    const twigRng = new Rng(params.seed, hashString(item.key));
    const twig: Twig = {
      key: item.key,
      branchId: item.branchId,
      level: item.level,
      phase: twigRng.float(0, 0.45),
      parent: item.parent,
      pos: item.origin.clone(),
      quat,
      length: item.length,
      radius: Math.max(0.004, item.radius),
      growth: 0,
      pruned: deadBranches.has(item.branchId) || prunedTwigs.has(item.key),
    };
    twigs.push(twig);

    // 叶片:末两级细枝才长叶
    if (item.level >= MAX_LEVEL - 2) {
      const leafCount = Math.round(params.leafDensity * rng.float(3, 7));
      for (let li = 0; li < leafCount; li++) {
        leaves.push({
          twig: idx,
          t: rng.float(0.25, 1),
          phase: rng.float(0, 0.3),
          yaw: rng.float(0, Math.PI * 2),
          pitch: rng.float(-0.9, 0.9),
          scale: rng.float(0.6, 1.15),
        });
      }
    }

    // 递归子细枝(扇出随层级递减,总量足以填满约 2000 预算)
    if (item.level < MAX_LEVEL && twigs.length + queue.length - cursor < budget) {
      const kids = item.level === 1 ? 4 : item.level <= 3 ? 3 : 2;
      for (let k = 0; k < kids; k++) {
        const t = rng.float(0.45, 1.0);
        tmpPos.copy(item.dir).multiplyScalar(item.length * t).add(item.origin);
        tmpSide.crossVectors(item.dir, UP);
        if (tmpSide.lengthSq() < 1e-4) tmpSide.set(1, 0, 0);
        tmpSide.normalize();
        const childDir = item.dir
          .clone()
          .applyAxisAngle(tmpSide, angleRad * rng.float(0.5, 1.1))
          .applyAxisAngle(item.dir, rng.float(0, Math.PI * 2));
        // 轻微向上趋光
        childDir.lerp(UP, 0.08).normalize();
        queue.push({
          origin: tmpPos.clone(),
          dir: childDir,
          level: item.level + 1,
          length: item.length * rng.float(0.6, 0.8),
          radius: item.radius * 0.62,
          parent: idx,
          branchId: item.branchId,
          key: `${item.key}.${k}`,
        });
      }
    }
  }

  // 修剪传播:父被剪则子被剪
  for (let i = 0; i < twigs.length; i++) {
    const tw = twigs[i];
    if (!tw.pruned && tw.parent >= 0 && twigs[tw.parent].pruned) tw.pruned = true;
  }

  const tree: GeneratedTree = {
    branchCurves,
    twigs,
    leaves,
    centersOfMass: new Map(),
    maxLevel: MAX_LEVEL,
  };
  updateGrowth(tree, 0);
  return tree;
}

/** 根据全局生长度 g 更新每根细枝的局部生长度(0..1),被剪枝条恒为 0 */
export function updateGrowth(tree: GeneratedTree, g: number): void {
  // 跨度保证 g=1 时最高层级 + 最大相位也能长满
  const span = tree.maxLevel + 1.5;
  for (const tw of tree.twigs) {
    if (tw.pruned) {
      tw.growth = 0;
      continue;
    }
    tw.growth = THREE.MathUtils.clamp(g * span - tw.level - tw.phase, 0, 1);
  }
  recomputeCentersOfMass(tree);
}

/** 重算每根骨架枝干的枝叶重心(世界坐标) */
export function recomputeCentersOfMass(tree: GeneratedTree): void {
  const sum = new Map<string, THREE.Vector3>();
  const weight = new Map<string, number>();
  const tmp = new THREE.Vector3();
  for (const tw of tree.twigs) {
    if (tw.growth <= 0) continue;
    const w = tw.growth * tw.length;
    tmp.copy(UP).applyQuaternion(tw.quat).multiplyScalar(tw.length * 0.5).add(tw.pos);
    const s = sum.get(tw.branchId);
    if (s) s.addScaledVector(tmp, w);
    else sum.set(tw.branchId, tmp.clone().multiplyScalar(w));
    weight.set(tw.branchId, (weight.get(tw.branchId) ?? 0) + w);
  }
  tree.centersOfMass.clear();
  for (const [id, s] of sum) {
    tree.centersOfMass.set(id, s.multiplyScalar(1 / (weight.get(id) ?? 1)));
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
