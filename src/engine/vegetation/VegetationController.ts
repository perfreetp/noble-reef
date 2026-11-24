import { createEffect } from 'solid-js';
import { projectStore } from '../../store/projectStore';
import { uiStore } from '../../store/uiStore';
import { getTerrainService } from '../terrain/terrainService';
import { VEG_REBUILD_DEBOUNCE_MS, VEG_TARGET } from '../../config/constants';
import { rebuildInDirtyRects, scatterInstances, type PlantInstance } from './scatter';
import { VegetationMesh } from './VegetationMesh';
import type { DirtyRect } from '../../util/dirtyRect';

/**
 * 植被控制器：
 * - seed/规则/路径/设施变化 → 全量重布；
 * - 地形 revision 变化 → 防抖 200ms 增量重布（笔刷拖动中不阻塞）；
 * - 可见性开关直接切 group.visible。
 */
export class VegetationController {
  readonly mesh: VegetationMesh;
  private plants: PlantInstance[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRects: DirtyRect[] = [];
  private lastRevision = 0;

  constructor() {
    const model = getTerrainService().model;
    this.mesh = new VegetationMesh(model, VEG_TARGET + 64);
    this.fullScatter();

    createEffect(() => {
      uiStore.vegetationVisible;
      this.mesh.setVisible(uiStore.vegetationVisible);
    });

    // 参数/路径/设施变化 → 全量（与地形 effect 通过 lastFullScatterRev 去重）
    let lastFullScatterRev = -1;
    createEffect(() => {
      void JSON.stringify(projectStore.vegetation);
      void JSON.stringify(projectStore.paths);
      void JSON.stringify(projectStore.facilities);
      const rev = projectStore.terrain.revision;
      if (rev === lastFullScatterRev) return;
      lastFullScatterRev = rev;
      this.fullScatter();
    });

    // 地形变化 → 防抖增量
    createEffect(() => {
      const rev = projectStore.terrain.revision;
      if (rev === this.lastRevision) return;
      this.lastRevision = rev;
      this.scheduleIncremental();
    });
  }

  private fullScatter(): void {
    const model = getTerrainService().model;
    this.plants = scatterInstances(
      model,
      projectStore.vegetation,
      projectStore.pathOrder.map((id) => projectStore.paths[id]!),
      projectStore.facilityOrder.map((id) => projectStore.facilities[id]!),
    );
    this.mesh.setPlants(this.plants);
  }

  private scheduleIncremental(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const model = getTerrainService().model;
      this.plants = rebuildInDirtyRects(
        model,
        projectStore.vegetation,
        this.plants,
        this.pendingRects.length
          ? this.pendingRects
          : [{ minX: 0, minY: 0, maxX: model.size - 1, maxY: model.size - 1 }],
        projectStore.pathOrder.map((id) => projectStore.paths[id]!),
        projectStore.facilityOrder.map((id) => projectStore.facilities[id]!),
      );
      this.pendingRects = [];
      this.mesh.setPlants(this.plants);
    }, VEG_REBUILD_DEBOUNCE_MS);
  }

  /** 外部（如未来精细脏区来源）可追加脏矩形；当前地形联动按全图增量兜底 */
  addDirtyRect(rect: DirtyRect): void {
    this.pendingRects.push(rect);
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.mesh.dispose();
  }
}
