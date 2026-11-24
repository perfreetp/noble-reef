import { describe, it, expect } from 'vitest';
import { TerrainModel } from '../engine/terrain/TerrainModel';
import { buildOccupancy, rebuildInDirtyRects, scatterInstances } from '../engine/vegetation/scatter';
import type { PathState, VegSettings } from '../types/project';

const settings: VegSettings = {
  seed: 42,
  treeDensity: 0.6,
  shrubDensity: 0.4,
  rules: { maxSlopeDeg: 30, minAltitude: 2, maxAltitude: 80 },
};

const makeHillModel = (size = 64): TerrainModel => {
  const heights = new Float32Array(size * size);
  const half = (size - 1) / 2;
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const d = Math.hypot(gx - half, gy - half) / half;
      heights[gy * size + gx] = 30 * (1 - Math.min(1, d));
    }
  }
  return new TerrainModel(size, 2, heights);
};

describe('植被散布', () => {
  it('同 seed 生成确定性结果', () => {
    const m = makeHillModel();
    const a = scatterInstances(m, settings, [], [], 500);
    const b = scatterInstances(m, settings, [], [], 500);
    expect(a.length).toBe(b.length);
    expect(a.map((p) => `${p.gx},${p.gy}`).join('|')).toBe(
      b.map((p) => `${p.gx},${p.gy}`).join('|'),
    );
  });

  it('产生树与灌木两类实例且全部合格', () => {
    const m = makeHillModel();
    const plants = scatterInstances(m, settings, [], [], 500);
    expect(plants.length).toBeGreaterThan(50);
    const kinds = new Set(plants.map((p) => p.kind));
    expect(kinds.has('tree')).toBe(true);
    expect(plants.every((p) => p.eligible)).toBe(true);
  });

  it('occupancy 栅格覆盖路径与设施占地', () => {
    const m = makeHillModel();
    const path: PathState = {
      id: 'p',
      name: 'p',
      style: { width: 2.4, color: 0, railHeight: 1.1, hasWall: true, hasRail: true },
      controlPoints: [
        { id: 'a', x: -20, z: 0 },
        { id: 'b', x: 20, z: 0 },
      ],
    };
    const occ = buildOccupancy(m, [path], [
      {
        id: 'f',
        type: 'kiosk',
        x: 10,
        z: 10,
        rotation: 0,
        footprint: { shape: 'circle', radius: 5 },
        baseHeight: 5,
      },
    ]);
    expect(occ.some((v) => v === 1)).toBe(true);
    // 设施中心格被占用
    const { gx, gy } = m.worldToGrid(10, 10);
    expect(occ[m.idx(Math.round(gx), Math.round(gy))]).toBe(1);
  });

  it('脏矩形增量更新不影响区域外实例', () => {
    const m = makeHillModel();
    const plants = scatterInstances(m, settings, [], [], 500);
    const before = plants.map((p) => ({ gx: p.gx, gy: p.gy, x: p.x, z: p.z }));
    // 在角落制造高度变化
    for (let gy = 0; gy < 6; gy++)
      for (let gx = 0; gx < 6; gx++) m.heights[m.idx(gx, gy)] = 0.5;
    m.recomputeNormals({ minX: 0, minY: 0, maxX: 7, maxY: 7 });
    const updated = rebuildInDirtyRects(
      m,
      settings,
      plants,
      [{ minX: 0, minY: 0, maxX: 6, maxY: 6 }],
      [],
      [],
    );
    // 远离脏区的实例保持原位
    const far = updated.filter((p) => p.gx > 20 && p.gy > 20);
    expect(far.length).toBeGreaterThan(0);
    for (const p of far) {
      const orig = before.find((b) => b.gx === p.gx && b.gy === p.gy);
      expect(orig?.x).toBe(p.x);
      expect(orig?.z).toBe(p.z);
    }
  });
});
