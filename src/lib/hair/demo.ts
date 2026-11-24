import * as THREE from 'three';
import { model } from './model';
import { history } from './history';
import { DEFAULT_PARAMS, genId, HAIR_COLORS, type HairBundle } from './types';
import type { Scalp } from './scalp';

/**
 * 生成演示发量：在头皮上半部分均匀撒点生成发束。
 * 用于验证上千发束同时编辑时的流畅度。
 */
export function generateDemoHair(scalp: Scalp, count = 1200): void {
  const before = model.snapshotAll();
  const dir = new THREE.Vector3();
  const origin = new THREE.Vector3();

  // 简单可复现的伪随机
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 20) {
    attempts++;
    // 球面均匀采样，只取头顶区域（y 分量偏高）
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    dir.set(r * Math.cos(theta), u, r * Math.sin(theta));
    if (dir.y < 0.05) continue; // 只要头顶
    origin.copy(dir).multiplyScalar(5).add(new THREE.Vector3(0, 0.1, 0));
    const hit = scalp.project(origin, dir.clone().negate());
    if (!hit) continue;
    const bundle: HairBundle = {
      id: genId('b'),
      anchor: {
        position: [hit.point.x, hit.point.y, hit.point.z],
        normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      },
      params: {
        ...DEFAULT_PARAMS,
        length: 0.5 + rand() * 0.9,
        curl: rand() * 0.6,
        direction: rand() * 360,
        tilt: 35 + rand() * 40,
        thickness: 0.7 + rand() * 0.6,
      },
      groupId: null,
      layer: placed,
      color: HAIR_COLORS[Math.floor(rand() * HAIR_COLORS.length)]!,
    };
    model.bundles.set(bundle.id, bundle);
    placed++;
  }
  // 一次性通知结构变化（渲染器重排分块）
  model.restoreAll({
    bundles: [...model.bundles.values()],
    groups: [...model.groups.values()],
  });

  const after = model.snapshotAll();
  history.push({
    label: `生成演示发量（${placed}）`,
    undo: () => model.restoreAll(before),
    redo: () => model.restoreAll(after),
  });
}
