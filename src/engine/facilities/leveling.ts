import type { TerrainModel } from '../terrain/TerrainModel';
import type { Footprint } from '../../types/project';
import { clamp, lerp, smoothstep } from '../../util/math';
import type { DirtyRect } from '../../util/dirtyRect';

/** 整平目标高：中心 3×3 格均值 */
export const computeBaseHeight = (model: TerrainModel, gx: number, gy: number): number => {
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.round(gx) + dx;
      const y = Math.round(gy) + dy;
      if (model.inBounds(x, y)) {
        sum += model.heights[model.idx(x, y)]!;
        n++;
      }
    }
  }
  return sum / n;
};

/** blend 环宽（格）：max(2, R/4) */
export const blendWidthCells = (radiusCells: number): number =>
  Math.max(2, Math.round(radiusCells / 4));

export interface LevelResult {
  rect: DirtyRect;
  baseHeight: number;
}

/**
 * 圆域整平：
 * d <= R-b 全平为 H；R-b < d < R+b 用 smoothstep 在 H 与原高间过渡；环外不变。
 * 半径与偏移均以“格”为单位传入。
 */
export const flattenCircle = (
  model: TerrainModel,
  centerGx: number,
  centerGy: number,
  radiusCells: number,
  baseHeight?: number,
): LevelResult => {
  const H = baseHeight ?? computeBaseHeight(model, centerGx, centerGy);
  const b = blendWidthCells(radiusCells);
  const inner = radiusCells - b;
  const outer = radiusCells + b;
  const rect = clampRect(
    model,
    Math.floor(centerGx - outer),
    Math.floor(centerGy - outer),
    Math.ceil(centerGx + outer),
    Math.ceil(centerGy + outer),
  );

  for (let gy = rect.minY; gy <= rect.maxY; gy++) {
    for (let gx = rect.minX; gx <= rect.maxX; gx++) {
      const d = Math.hypot(gx - centerGx, gy - centerGy);
      const i = model.idx(gx, gy);
      if (d <= inner) {
        model.heights[i] = H;
      } else if (d < outer) {
        const t = smoothstep(0, 1, (d - inner) / (2 * b));
        model.heights[i] = lerp(H, model.heights[i]!, t);
      }
    }
  }
  return { rect, baseHeight: H };
};

/** 圆角矩形 SDF 距离（格单位，b 为圆角/blend 宽） */
const roundedRectDistance = (
  gx: number,
  gy: number,
  cx: number,
  cy: number,
  halfW: number,
  halfD: number,
  b: number,
): number => {
  const qx = Math.abs(gx - cx) - (halfW - b);
  const qy = Math.abs(gy - cy) - (halfD - b);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - b;
};

/** 矩形（圆角）整平，复用与圆域相同的分段过渡公式 */
export const flattenRect = (
  model: TerrainModel,
  centerGx: number,
  centerGy: number,
  halfWCells: number,
  halfDCells: number,
  baseHeight?: number,
): LevelResult => {
  const H = baseHeight ?? computeBaseHeight(model, centerGx, centerGy);
  const b = Math.max(2, Math.round(Math.min(halfWCells, halfDCells) / 4));
  const rect = clampRect(
    model,
    Math.floor(centerGx - halfWCells - b),
    Math.floor(centerGy - halfDCells - b),
    Math.ceil(centerGx + halfWCells + b),
    Math.ceil(centerGy + halfDCells + b),
  );

  for (let gy = rect.minY; gy <= rect.maxY; gy++) {
    for (let gx = rect.minX; gx <= rect.maxX; gx++) {
      // d <= 0 在形状内部；过渡带为 0..2b
      const sdf = roundedRectDistance(gx, gy, centerGx, centerGy, halfWCells, halfDCells, b);
      const i = model.idx(gx, gy);
      if (sdf <= 0) {
        model.heights[i] = H;
      } else if (sdf < 2 * b) {
        const t = smoothstep(0, 1, sdf / (2 * b));
        model.heights[i] = lerp(H, model.heights[i]!, t);
      }
    }
  }
  return { rect, baseHeight: H };
};

/** 按设施占地自动分派整平，输入世界坐标 */
export const flattenFootprint = (
  model: TerrainModel,
  footprint: Footprint,
  worldX: number,
  worldZ: number,
  baseHeight?: number,
): LevelResult => {
  const { gx, gy } = model.worldToGrid(worldX, worldZ);
  if (footprint.shape === 'circle') {
    const rCells = footprint.radius / model.cellSize;
    return flattenCircle(model, gx, gy, rCells, baseHeight);
  }
  return flattenRect(
    model,
    gx,
    gy,
    footprint.w / 2 / model.cellSize,
    footprint.d / 2 / model.cellSize,
    baseHeight,
  );
};

const clampRect = (
  model: TerrainModel,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): DirtyRect => ({
  minX: clamp(minX, 0, model.size - 1),
  minY: clamp(minY, 0, model.size - 1),
  maxX: clamp(maxX, 0, model.size - 1),
  maxY: clamp(maxY, 0, model.size - 1),
});
