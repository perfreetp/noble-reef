import { describe, it, expect } from 'vitest';
import { TerrainModel } from '../engine/terrain/TerrainModel';
import {
  computeSlopeFlags,
  rebuildPath,
  resampleByLength,
  samplePathAtT,
  subdivideControlPoints,
} from '../engine/paths/pathSampling';
import { PATH_SAMPLE_SPACING, TAN_SLOPE_LIMIT } from '../config/constants';
import type { PathState } from '../types/project';

const flatModel = (size = 64): TerrainModel => new TerrainModel(size, 2);

/** 构造恒定坡度地形：h = slope * wx（世界坐标） */
const slopeModel = (slope: number, size = 64): TerrainModel => {
  const m = new TerrainModel(size, 2);
  const half = (size - 1) / 2;
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const wx = (gx - half) * 2;
      m.heights[gy * size + gx] = slope * wx;
    }
  }
  m.recomputeNormals();
  return m;
};

const makePath = (points: [number, number][]): PathState => ({
  id: 'p1',
  name: '测试路径',
  style: { width: 2.4, color: 0, railHeight: 1.1, hasWall: true, hasRail: true },
  controlPoints: points.map(([x, z], i) => ({ id: `c${i}`, x, z })),
});

describe('步道采样', () => {
  it('Catmull-Rom 细分经过首尾控制点', () => {
    const sub = subdivideControlPoints([
      { id: 'a', x: 0, z: 0 },
      { id: 'b', x: 10, z: 0 },
      { id: 'c', x: 20, z: 10 },
    ]);
    expect(sub[0]!.x).toBeCloseTo(0, 8);
    expect(sub[0]!.z).toBeCloseTo(0, 8);
    expect(sub[sub.length - 1]!.x).toBeCloseTo(20, 8);
    expect(sub[sub.length - 1]!.z).toBeCloseTo(10, 8);
  });

  it('等弧长重采样间距约等于 2 米', () => {
    const dense = subdivideControlPoints([
      { id: 'a', x: 0, z: 0 },
      { id: 'b', x: 40, z: 0 },
    ]);
    const spaced = resampleByLength(dense);
    for (let i = 1; i < spaced.length; i++) {
      const d = Math.hypot(
        spaced[i]!.x - spaced[i - 1]!.x,
        spaced[i]!.z - spaced[i - 1]!.z,
      );
      expect(d).toBeCloseTo(PATH_SAMPLE_SPACING, 6);
    }
  });

  it('13° 坡必标记超限，11° 坡不标记', () => {
    const flagsFor = (deg: number) => {
      const slope = Math.tan((deg * Math.PI) / 180);
      const model = slopeModel(slope);
      const path = makePath([
        [-30, 0],
        [30, 0],
      ]);
      const sampled = rebuildPath(path, model)!;
      return sampled.slopeFlags.every(Boolean);
    };
    expect(flagsFor(13)).toBe(true);
    expect(flagsFor(11)).toBe(false);
    expect(TAN_SLOPE_LIMIT).toBeCloseTo(Math.tan((12 * Math.PI) / 180), 8);
  });

  it('吸附高度等于双线性地形值加贴面偏移', () => {
    const model = slopeModel(0.1);
    const path = makePath([
      [-10, 5],
      [10, 5],
    ]);
    const sampled = rebuildPath(path, model)!;
    const p = sampled.points[5]!;
    expect(p.y).toBeCloseTo(model.sampleHeightBilinear(p.x, p.z) + 0.08, 8);
  });

  it('弧长表单调递增，samplePathAtT 端点正确', () => {
    const sampled = rebuildPath(
      makePath([
        [-20, 0],
        [20, 0],
      ]),
      flatModel(),
    )!;
    for (let i = 1; i < sampled.cumLen.length; i++) {
      expect(sampled.cumLen[i]).toBeGreaterThan(sampled.cumLen[i - 1]!);
    }
    const s0 = samplePathAtT(sampled, 0);
    const s1 = samplePathAtT(sampled, 1);
    expect(s0.point.x).toBeCloseTo(-20, 6);
    expect(s1.point.x).toBeCloseTo(20, 6);
  });

  it('控制点不足两个时 rebuildPath 返回 null', () => {
    expect(rebuildPath(makePath([[0, 0]]), flatModel())).toBeNull();
  });

  it('computeSlopeFlags 合并连续超限段并给出最大坡角', () => {
    const points = Array.from({ length: 6 }, (_, i) => ({
      x: i * PATH_SAMPLE_SPACING,
      y: i < 3 ? 0 : (i - 2) * PATH_SAMPLE_SPACING * 0.5,
      z: 0,
    }));
    const r = computeSlopeFlags(points, PATH_SAMPLE_SPACING);
    expect(r.flags.filter(Boolean).length).toBe(3);
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0]!.maxAngleDeg).toBeCloseTo(
      (Math.atan(0.5) * 180) / Math.PI,
      6,
    );
  });
});
