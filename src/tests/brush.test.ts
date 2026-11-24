import { describe, it, expect } from 'vitest';
import { TerrainModel } from '../engine/terrain/TerrainModel';
import { applyRaiseLower, applySmooth, makeKernel } from '../engine/terrain/brush';

describe('笔刷内核', () => {
  it('核为圆形且权重为正、中心最大', () => {
    const k = makeKernel(6);
    expect(k.entries.length).toBeGreaterThan(0);
    const center = k.entries.find((e) => e.dx === 0 && e.dy === 0)!;
    expect(center.w).toBe(1);
    for (const e of k.entries) {
      expect(e.w).toBeGreaterThan(0);
      expect(Math.hypot(e.dx, e.dy)).toBeLessThanOrEqual(6);
    }
  });

  it('同半径核走缓存', () => {
    expect(makeKernel(14)).toBe(makeKernel(14));
  });

  it('抬升量与 strength*dt 线性，圆外零影响', () => {
    const size = 32;
    const m = new TerrainModel(size, 2);
    const k = makeKernel(4);
    const before = m.cloneHeights();
    applyRaiseLower(m, 16, 16, 1, 10, 0.1, k);
    const i = m.idx(16, 16);
    expect(m.heights[i]).toBeCloseTo(before[i]! + 10 * 1 * 0.1, 10);
    // 圆外点不变
    expect(m.heights[m.idx(0, 0)]).toBe(before[0]);
    expect(m.heights[m.idx(31, 31)]).toBe(before[31 * 32 + 31]);
  });

  it('压低方向为负', () => {
    const m = new TerrainModel(32, 2);
    applyRaiseLower(m, 16, 16, -1, 10, 0.1, makeKernel(4));
    expect(m.heights[m.idx(16, 16)]).toBeLessThan(0);
  });

  it('平滑后方差单调下降并收敛', () => {
    const size = 32;
    const m = new TerrainModel(size, 2);
    // 随机尖峰
    for (let i = 0; i < m.heights.length; i++) m.heights[i] = (i * 2654435761) % 100 / 10 - 5;
    const variance = (): number => {
      const mean = m.heights.reduce((a, b) => a + b, 0) / m.heights.length;
      return m.heights.reduce((a, b) => a + (b - mean) ** 2, 0) / m.heights.length;
    };
    const v0 = variance();
    const k = makeKernel(8);
    for (let n = 0; n < 20; n++) applySmooth(m, 16, 16, k, 0.5);
    const v1 = variance();
    expect(v1).toBeLessThan(v0);
    const v2 = variance();
    for (let n = 0; n < 20; n++) applySmooth(m, 16, 16, k, 0.5);
    // 继续平滑变化越来越小（收敛）
    expect(Math.abs(variance() - v2)).toBeLessThan(Math.abs(v1 - v0));
  });
});
