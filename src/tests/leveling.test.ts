import { describe, it, expect } from 'vitest';
import { TerrainModel } from '../engine/terrain/TerrainModel';
import {
  blendWidthCells,
  computeBaseHeight,
  flattenCircle,
  flattenRect,
} from '../engine/facilities/leveling';

const makeBumpyTerrain = (size = 64): TerrainModel => {
  const heights = new Float32Array(size * size);
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      heights[gy * size + gx] = 10 + 5 * Math.sin(gx * 0.4) * Math.cos(gy * 0.3);
    }
  }
  return new TerrainModel(size, 2, heights);
};

describe('设施整平', () => {
  it('blend 环宽至少 2 格', () => {
    expect(blendWidthCells(2)).toBe(2);
    expect(blendWidthCells(16)).toBe(4);
  });

  it('computeBaseHeight 取中心 3×3 均值', () => {
    const m = new TerrainModel(16, 2);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) m.heights[m.idx(8 + dx, 8 + dy)] = 12;
    expect(computeBaseHeight(m, 8, 8)).toBe(12);
  });

  it('圆域核心区完全平坦、环外原值不变', () => {
    const m = makeBumpyTerrain();
    const before = m.cloneHeights();
    const R = 10;
    const { baseHeight, rect } = flattenCircle(m, 32, 32, R);
    expect(rect.maxX - rect.minX).toBeGreaterThan(0);
    // 核心区平坦（Float32 存储有约 1e-7 的精度损失）
    for (let gy = 28; gy <= 36; gy++) {
      for (let gx = 28; gx <= 36; gx++) {
        expect(m.heights[m.idx(gx, gy)]).toBeCloseTo(baseHeight, 5);
      }
    }
    // 环外不变
    const far = m.idx(0, 0);
    expect(m.heights[far]).toBe(before[far]);
  });

  it('blend 环 C0 连续：内边界等于 H、外边界等于原值', () => {
    const m = makeBumpyTerrain();
    const before = m.cloneHeights();
    const R = 10;
    const b = blendWidthCells(R);
    const { baseHeight } = flattenCircle(m, 32, 32, R);
    // 内边界（d = R-b 处取整格点近似）高度接近 H
    const innerIdx = m.idx(32 + R - b, 32);
    expect(m.heights[innerIdx]).toBeCloseTo(baseHeight, 5);
    // 外边界之外保持原值
    const outerIdx = m.idx(32 + R + b + 2, 32);
    expect(m.heights[outerIdx]).toBe(before[outerIdx]);
  });

  it('矩形整平核心区平坦且形状为矩形（角外不变）', () => {
    const m = makeBumpyTerrain();
    const before = m.cloneHeights();
    const { baseHeight } = flattenRect(m, 32, 32, 9, 6);
    expect(m.heights[m.idx(32, 32)]).toBeCloseTo(baseHeight, 5);
    expect(m.heights[m.idx(38, 30)]).toBeCloseTo(baseHeight, 5);
    // 矩形长边外侧的点保持原值
    const side = m.idx(32, 32 + 10);
    expect(m.heights[side]).toBe(before[side]);
  });
});
