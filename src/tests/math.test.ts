import { describe, it, expect } from 'vitest';
import { bilinearSample, clamp, lerp, smoothstep, uid } from '../util/math';

describe('math 工具', () => {
  it('clamp 边界钳制', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('lerp 线性插值', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('smoothstep 端点与单调性', () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 0.25)).toBeLessThan(smoothstep(0, 1, 0.75));
  });

  it('bilinearSample 角点精确且中点为均值', () => {
    expect(bilinearSample(1, 2, 3, 4, 0, 0)).toBe(1);
    expect(bilinearSample(1, 2, 3, 4, 1, 0)).toBe(2);
    expect(bilinearSample(1, 2, 3, 4, 0, 1)).toBe(3);
    expect(bilinearSample(1, 2, 3, 4, 1, 1)).toBe(4);
    expect(bilinearSample(1, 2, 3, 4, 0.5, 0.5)).toBe(2.5);
  });

  it('uid 唯一', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid('t')));
    expect(ids.size).toBe(100);
  });
});
