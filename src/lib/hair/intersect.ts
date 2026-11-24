import * as THREE from 'three';
import { baseRadius } from './curve';
import type { HairModel } from './model';

export interface IntersectionPair {
  a: string;
  b: string;
  /** 最近距离（世界单位） */
  distance: number;
}

const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

/**
 * 检测发束穿插：对曲线采样点做空间哈希，只在邻近发束间做线段距离检查。
 * 结果供 UI 提示，用户可调整层级顺序化解。
 */
export function detectIntersections(model: HairModel, maxPairs = 200): IntersectionPair[] {
  const ids = [...model.bundles.keys()];
  const pairs: IntersectionPair[] = [];
  if (ids.length < 2) return pairs;

  // 空间哈希格子
  const cell = 0.08;
  const grid = new Map<string, { id: string; index: number; p: THREE.Vector3 }[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;

  const curves = new Map<string, THREE.Vector3[]>();
  for (const id of ids) {
    const curve = model.getCurve(id, 10);
    curves.set(id, curve);
    // 发根附近的点不参与穿插判断（同区域发根天然密集）
    for (let i = 2; i < curve.length; i++) {
      const p = curve[i]!;
      const key = keyOf(p.x, p.y, p.z);
      let bucket = grid.get(key);
      if (!bucket) grid.set(key, (bucket = []));
      bucket.push({ id, index: i, p });
    }
  }

  const seen = new Set<string>();
  for (const [key, bucket] of grid) {
    // 收集本格与相邻格
    const [cx, cy, cz] = key.split(',').map(Number) as [number, number, number];
    const neighbors: { id: string; index: number; p: THREE.Vector3 }[] = [...bucket];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nb = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (nb) neighbors.push(...nb);
        }
    for (const entry of bucket) {
      for (const other of neighbors) {
        if (entry.id === other.id) continue;
        const pairKey = entry.id < other.id ? `${entry.id}|${other.id}` : `${other.id}|${entry.id}`;
        if (seen.has(pairKey)) continue;
        const ba = model.bundles.get(entry.id)!;
        const bb = model.bundles.get(other.id)!;
        const threshold = (baseRadius(ba.params.thickness) + baseRadius(bb.params.thickness)) * 1.2;
        _pa.copy(entry.p);
        _pb.copy(other.p);
        const dist = _pa.distanceTo(_pb);
        if (dist < threshold) {
          seen.add(pairKey);
          pairs.push({ a: entry.id, b: other.id, distance: dist });
          if (pairs.length >= maxPairs) return pairs;
        }
      }
    }
  }
  return pairs;
}
