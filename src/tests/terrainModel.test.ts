import { describe, it, expect } from 'vitest';
import { TerrainModel } from '../engine/terrain/TerrainModel';
import { CELL_SIZE, GRID_SIZE } from '../config/constants';

const size = 16;

describe('TerrainModel', () => {
  it('世界/格点坐标往返互逆', () => {
    const m = new TerrainModel(size, CELL_SIZE);
    const wx = 37.4;
    const wz = -18.2;
    const { gx, gy } = m.worldToGrid(wx, wz);
    const back = m.gridToWorld(gx, gy);
    expect(back.x).toBeCloseTo(wx, 10);
    expect(back.z).toBeCloseTo(wz, 10);
  });

  it('平坦地形法线恒为 (0,1,0)', () => {
    const m = new TerrainModel(size, CELL_SIZE);
    m.recomputeNormals();
    const [nx, ny, nz] = m.computeNormalAt(8, 8);
    expect(nx).toBeCloseTo(0, 10);
    expect(ny).toBeCloseTo(1, 10);
    expect(nz).toBeCloseTo(0, 10);
  });

  it('斜面法线与解析值误差 < 1e-5', () => {
    // h = 0.1*x（格坐标），世界坡度 dh/dx(world) = 0.1/CELL_SIZE
    const heights = new Float32Array(size * size);
    for (let gy = 0; gy < size; gy++) {
      for (let gx = 0; gx < size; gx++) {
        heights[gy * size + gx] = 0.1 * gx;
      }
    }
    const m = new TerrainModel(size, CELL_SIZE, heights);
    const slope = 0.1 / CELL_SIZE;
    const expected = [-slope, 1, 0].map((v) => v / Math.hypot(slope, 1));
    const [nx, ny, nz] = m.computeNormalAt(8, 8);
    expect(nx).toBeCloseTo(expected[0]!, 6);
    expect(ny).toBeCloseTo(expected[1]!, 6);
    expect(nz).toBeCloseTo(expected[2]!, 6);
  });

  it('双线性采样在格点上精确、格间线性', () => {
    const m = new TerrainModel(size, CELL_SIZE);
    m.heights[m.idx(4, 4)] = 10;
    m.heights[m.idx(5, 4)] = 20;
    const p = m.gridToWorld(4, 4);
    expect(m.sampleHeightBilinear(p.x, p.z)).toBeCloseTo(10, 10);
    const half = m.gridToWorld(4.5, 4);
    expect(m.sampleHeightBilinear(half.x, half.z)).toBeCloseTo(15, 10);
  });

  it('脏矩形法线只重算指定区域', () => {
    const m = new TerrainModel(size, CELL_SIZE);
    m.heights[m.idx(8, 8)] = 50;
    m.recomputeNormals({ minX: 7, minY: 7, maxX: 9, maxY: 9 });
    const base = m.idx(2, 2) * 3;
    // 区域外仍是初始 (0,1,0)
    expect(m.normals[base + 1]).toBe(1);
    // 尖峰影响相邻格 (7,8) 的法线（中心差分引用 8,8 的高度）
    const neighbor = m.idx(7, 8) * 3;
    expect(m.normals[neighbor + 1]).toBeLessThan(1);
    expect(m.normals[neighbor]).not.toBe(0);
  });

  it('默认尺寸为 256 且高度场长度正确', () => {
    const m = new TerrainModel();
    expect(m.size).toBe(GRID_SIZE);
    expect(m.heights.length).toBe(GRID_SIZE * GRID_SIZE);
  });
});
