import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../engine/camera/pathFrame';
import { samplePathAtT, rebuildPath } from '../engine/paths/pathSampling';
import { TerrainModel } from '../engine/terrain/TerrainModel';
import type { PathState, Viewpoint } from '../types/project';

const path: PathState = {
  id: 'p1',
  name: 'p',
  style: { width: 2, color: 0, railHeight: 1, hasWall: true, hasRail: true },
  controlPoints: [
    { id: 'a', x: -20, z: 0 },
    { id: 'b', x: 20, z: 0 },
  ],
};

const makeViewpoints = (): Viewpoint[] => [
  { id: 'v0', pathId: 'p1', t: 0, eyeHeight: 1.7, mode: 'fp', durationSec: 4 },
  { id: 'v1', pathId: 'p1', t: 0.5, eyeHeight: 1.7, mode: 'fp', durationSec: 4 },
  { id: 'v2', pathId: 'p1', t: 1, eyeHeight: 1.7, mode: 'top', durationSec: 2 },
];

describe('漫游时间线', () => {
  it('时间线进度单调递增且端点为 0 与 1', () => {
    const tl = buildTimeline(makeViewpoints());
    expect(tl[0]!.startProgress).toBe(0);
    expect(tl[tl.length - 1]!.endProgress).toBeCloseTo(1, 8);
    for (let i = 1; i < tl.length; i++) {
      expect(tl[i]!.startProgress).toBeGreaterThan(tl[i - 1]!.startProgress);
    }
  });

  it('段内 t 从关键点里程插值', () => {
    const tl = buildTimeline(makeViewpoints());
    expect(tl[1]!.startT).toBe(0);
    expect(tl[1]!.endT).toBe(0.5);
    expect(tl[2]!.endT).toBe(1);
  });

  it('samplePathAtT 沿 t 单调推进且两种相机模式高度差正确', async () => {
    const { sampleFrame } = await import('../engine/camera/pathFrame');
    const model = new TerrainModel(64, 2);
    const sampled = rebuildPath(path, model)!;
    const f0 = sampleFrame(sampled, 0, 'fp', model);
    const f0top = sampleFrame(sampled, 0, 'top', model);
    const f1 = sampleFrame(sampled, 1, 'fp', model);
    expect(f1.position.x).toBeGreaterThan(f0.position.x);
    // 俯瞰比第一人称高 35-1.7 量级
    expect(f0top.position.y - f0.position.y).toBeGreaterThan(30);
    // 中点位置在端点之间
    const mid = samplePathAtT(sampled, 0.5);
    expect(mid.point.x).toBeGreaterThan(f0.position.x);
    expect(mid.point.x).toBeLessThan(f1.position.x);
  });
});
