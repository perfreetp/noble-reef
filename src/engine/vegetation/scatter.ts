import { VEG_TARGET, VEG_TREE_RATIO } from '../../config/constants';
import { mulberry32 } from '../../util/rng';
import type { TerrainModel } from '../terrain/TerrainModel';
import type { DirtyRect } from '../../util/dirtyRect';
import { expandRect } from '../../util/dirtyRect';
import type { FacilityInstance, PathState, VegSettings } from '../../types/project';
import { rebuildPath } from '../paths/pathSampling';

export interface PlantInstance {
  kind: 'tree' | 'shrub';
  /** 锚点格坐标 */
  gx: number;
  gy: number;
  x: number;
  z: number;
  scale: number;
  rotationY: number;
  eligible: boolean;
}

/**
 * 栅格化占用区：路径宽度+1m、设施占地（含 blend 环近似）标记为不可种植。
 * Uint8Array，1 = 占用。
 */
export const buildOccupancy = (
  model: TerrainModel,
  paths: PathState[],
  facilities: FacilityInstance[],
): Uint8Array => {
  const occ = new Uint8Array(model.size * model.size);
  const markWorldCircle = (wx: number, wz: number, radius: number): void => {
    const rCells = radius / model.cellSize;
    const { gx, gy } = model.worldToGrid(wx, wz);
    const r = Math.ceil(rCells);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > rCells * rCells) continue;
        const x = Math.round(gx) + dx;
        const y = Math.round(gy) + dy;
        if (model.inBounds(x, y)) occ[model.idx(x, y)] = 1;
      }
    }
  };

  for (const path of paths) {
    const sampled = rebuildPath(path, model);
    if (!sampled) continue;
    const radius = path.style.width / 2 + 1;
    for (const p of sampled.points) markWorldCircle(p.x, p.z, radius);
  }
  for (const f of facilities) {
    const r =
      f.footprint.shape === 'circle'
        ? f.footprint.radius + 2
        : Math.max(f.footprint.w, f.footprint.d) / 2 + 2;
    markWorldCircle(f.x, f.z, r);
  }
  return occ;
};

const isEligible = (
  model: TerrainModel,
  gx: number,
  gy: number,
  occ: Uint8Array,
  settings: VegSettings,
): boolean => {
  if (occ[model.idx(gx, gy)]) return false;
  const [, ny] = model.computeNormalAt(gx, gy);
  const slopeDeg = (Math.acos(Math.min(1, ny)) * 180) / Math.PI;
  if (slopeDeg > settings.rules.maxSlopeDeg) return false;
  const h = model.heights[model.idx(gx, gy)]!;
  if (h < settings.rules.minAltitude || h > settings.rules.maxAltitude) return false;
  return true;
};

/** 全量确定性散布 */
export const scatterInstances = (
  model: TerrainModel,
  settings: VegSettings,
  paths: PathState[],
  facilities: FacilityInstance[],
  target = VEG_TARGET,
): PlantInstance[] => {
  const rng = mulberry32(settings.seed);
  const occ = buildOccupancy(model, paths, facilities);
  const treeCount = Math.round(target * VEG_TREE_RATIO);
  const plants: PlantInstance[] = [];
  // 抖动网格候选：每格一个候选，用 RNG 决定 kind 与资格，密度由目标数抽稀
  const step = Math.max(1, Math.floor(Math.sqrt((model.size * model.size) / target)));
  for (let gy = 0; gy < model.size && plants.length < target; gy += step) {
    for (let gx = 0; gx < model.size && plants.length < target; gx += step) {
      const jx = gx + Math.floor(rng() * step);
      const jy = gy + Math.floor(rng() * step);
      if (!model.inBounds(jx, jy)) continue;
      if (rng() > 0.85) continue; // 抽稀
      if (!isEligible(model, jx, jy, occ, settings)) continue;
      const { x, z } = model.gridToWorld(jx, jy);
      plants.push({
        kind: plants.length < treeCount ? 'tree' : 'shrub',
        gx: jx,
        gy: jy,
        x,
        z,
        scale: 0.7 + rng() * 0.7,
        rotationY: rng() * Math.PI * 2,
        eligible: true,
      });
    }
  }
  return plants;
};

/**
 * 脏矩形增量重布：
 * 锚点落在 expand(rect,2) 内的实例重新判定资格；不合格的 eligible=false（渲染时缩放到 0）；
 * 新合格的空白位置从确定性候选序列补入（数量保持稳定，避免频繁伸缩 buffer）。
 */
export const rebuildInDirtyRects = (
  model: TerrainModel,
  settings: VegSettings,
  plants: PlantInstance[],
  rects: DirtyRect[],
  paths: PathState[],
  facilities: FacilityInstance[],
): PlantInstance[] => {
  const expanded = rects.map((r) => expandRect(r, 2, model.size));
  const inDirty = (gx: number, gy: number): boolean =>
    expanded.some((r) => gx >= r.minX && gx <= r.maxX && gy >= r.minY && gy <= r.maxY);

  const occ = buildOccupancy(model, paths, facilities);
  let disabled = 0;
  for (const p of plants) {
    if (!inDirty(p.gx, p.gy)) continue;
    const ok = isEligible(model, p.gx, p.gy, occ, settings);
    if (ok && !p.eligible) {
      p.eligible = true;
    } else if (!ok && p.eligible) {
      p.eligible = false;
      disabled++;
    }
  }

  // 补位：在脏区内寻找新合格格点，复活被淘汰的实例
  if (disabled > 0) {
    const rng = mulberry32(settings.seed ^ 0x51ed270b);
    const occupiedCells = new Set(plants.map((p) => p.gx * model.size + p.gy));
    for (const r of expanded) {
      for (let gy = r.minY; gy <= r.maxY && disabled > 0; gy++) {
        for (let gx = r.minX; gx <= r.maxX && disabled > 0; gx++) {
          const key = gx * model.size + gy;
          if (occupiedCells.has(key)) continue;
          if (rng() > 0.3) continue;
          if (!isEligible(model, gx, gy, occ, settings)) continue;
          const dead = plants.find((p) => !p.eligible);
          if (!dead) break;
          const { x, z } = model.gridToWorld(gx, gy);
          dead.gx = gx;
          dead.gy = gy;
          dead.x = x;
          dead.z = z;
          dead.scale = 0.7 + rng() * 0.7;
          dead.rotationY = rng() * Math.PI * 2;
          dead.eligible = true;
          occupiedCells.add(key);
          disabled--;
        }
      }
    }
  }
  return plants;
};
