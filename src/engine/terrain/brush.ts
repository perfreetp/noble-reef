import type { TerrainModel } from './TerrainModel';
import { clamp } from '../../util/math';
import type { DirtyRect } from '../../util/dirtyRect';

export interface KernelEntry {
  dx: number;
  dy: number;
  w: number;
}

export interface BrushKernel {
  radius: number;
  entries: KernelEntry[];
  /** 核覆盖区外接矩形（相对中心点的偏移范围） */
  extent: number;
}

const kernelCache = new Map<number, BrushKernel>();

/** 高斯核：w = exp(-d² / 2σ²)，σ = radius/2；圆外丢弃。进程内按半径缓存 */
export const makeKernel = (radius: number): BrushKernel => {
  const cached = kernelCache.get(radius);
  if (cached) return cached;

  const sigma = radius / 2;
  const entries: KernelEntry[] = [];
  const r2 = radius * radius;
  const twoSigma2 = 2 * sigma * sigma;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      entries.push({ dx, dy, w: Math.exp(-d2 / twoSigma2) });
    }
  }
  const kernel: BrushKernel = { radius, entries, extent: radius };
  kernelCache.set(radius, kernel);
  return kernel;
};

const rectFor = (model: TerrainModel, cx: number, cy: number, extent: number): DirtyRect => ({
  minX: clamp(Math.round(cx) - extent, 0, model.size - 1),
  minY: clamp(Math.round(cy) - extent, 0, model.size - 1),
  maxX: clamp(Math.round(cx) + extent, 0, model.size - 1),
  maxY: clamp(Math.round(cy) + extent, 0, model.size - 1),
});

/**
 * 抬升 / 压低。dir=+1 抬升，-1 压低。
 * h += dir * strength * w * dt；dt 已在调用方钳制。
 */
export const applyRaiseLower = (
  model: TerrainModel,
  cx: number,
  cy: number,
  dir: 1 | -1,
  strength: number,
  dt: number,
  kernel: BrushKernel,
): DirtyRect => {
  const icx = Math.round(cx);
  const icy = Math.round(cy);
  for (const e of kernel.entries) {
    const gx = icx + e.dx;
    const gy = icy + e.dy;
    if (!model.inBounds(gx, gy)) continue;
    const i = model.idx(gx, gy);
    model.heights[i] = model.heights[i]! + dir * strength * e.w * dt;
  }
  return rectFor(model, cx, cy, kernel.extent);
};

/** 模块级 scratch，避免每次平滑分配 256KB */
let scratch: Float32Array | null = null;

/**
 * 高斯平滑：对核覆盖区每点求加权邻域均值，再按 smoothFactor 混合。
 * 结果先写 scratch 再拷回，防止就地更新造成核内偏差扩散。
 */
export const applySmooth = (
  model: TerrainModel,
  cx: number,
  cy: number,
  kernel: BrushKernel,
  smoothFactor: number,
): DirtyRect => {
  if (!scratch || scratch.length !== model.heights.length) {
    scratch = new Float32Array(model.heights.length);
  }
  const rect = rectFor(model, cx, cy, kernel.extent);

  for (let gy = rect.minY; gy <= rect.maxY; gy++) {
    for (let gx = rect.minX; gx <= rect.maxX; gx++) {
      let sum = 0;
      let wSum = 0;
      for (const e of kernel.entries) {
        const nx = gx + e.dx;
        const ny = gy + e.dy;
        if (!model.inBounds(nx, ny)) continue;
        sum += model.heights[model.idx(nx, ny)]! * e.w;
        wSum += e.w;
      }
      const i = model.idx(gx, gy);
      const avg = sum / wSum;
      const centerW = kernel.entries.find((e) => e.dx === 0 && e.dy === 0)?.w ?? 1;
      scratch[i] = model.heights[i]! + smoothFactor * centerW * (avg - model.heights[i]!);
    }
  }

  for (let gy = rect.minY; gy <= rect.maxY; gy++) {
    for (let gx = rect.minX; gx <= rect.maxX; gx++) {
      const i = model.idx(gx, gy);
      model.heights[i] = scratch[i]!;
    }
  }
  return rect;
};
