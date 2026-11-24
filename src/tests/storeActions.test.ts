import { describe, it, expect, beforeEach } from 'vitest';
import { projectStore } from '../store/projectStore';
import { initTerrainService } from '../engine/terrain/terrainService';
import {
  addControlPoint,
  addFacility,
  addPath,
  addViewpoint,
  beginTerrainStroke,
  commitTerrainStroke,
  deleteFacility,
  deletePath,
  loadProject,
  redo,
  resetTerrain,
  undo,
  updateControlPoint,
} from '../store/actions';
import { TerrainModel } from '../engine/terrain/TerrainModel';
import { rebuildPath } from '../engine/paths/pathSampling';
import { createInitialProject } from '../store/projectStore';

describe('工程 action 集成（store + 地形服务 + 历史）', () => {
  beforeEach(() => {
    const fresh = createInitialProject(1234);
    initTerrainService(fresh.terrain.heights, fresh.terrain.size, fresh.terrain.cellSize);
    loadProject(fresh);
  });

  it('笔刷 stroke 抬升高度并可撤销还原', () => {
    const model = new TerrainModel(256, 2, projectStore.terrain.heights);
    const before = projectStore.terrain.heights[128 * 256 + 128]!;
    const token = beginTerrainStroke('测试抬升');
    projectStore.terrain.heights[128 * 256 + 128] = before + 25;
    commitTerrainStroke(token);
    expect(projectStore.terrain.heights[128 * 256 + 128]).toBe(before + 25);
    undo();
    expect(projectStore.terrain.heights[128 * 256 + 128]).toBe(before);
    redo();
    expect(projectStore.terrain.heights[128 * 256 + 128]).toBe(before + 25);
    void model;
  });

  it('路径控制点 y 由地形派生：整平后重算高度自动变化', () => {
    const pathId = addPath('测试步道');
    // 两个控制点，跨一块将要整平的区域
    addControlPoint(pathId, -10, 0);
    addControlPoint(pathId, 30, 0);
    const terrain = initTerrainServiceGetter();
    const before = rebuildPath(projectStore.paths[pathId]!, terrain.model)!;
    const midBefore = before.points[Math.floor(before.points.length / 2)]!.y;

    // 在路径中点附近放置设施 → 整平抬高到目标高
    addFacility('kiosk', 10, 0);
    const after = rebuildPath(projectStore.paths[pathId]!, terrain.model)!;
    const midAfter = after.points[Math.floor(after.points.length / 2)]!.y;
    expect(midAfter).not.toBe(midBefore);
  });

  it('设施放置是复合历史：undo 同时回滚设施记录与地形', () => {
    const facCount = projectStore.facilityOrder.length;
    // 必须独立副本：当前 heights 会被整平就地修改
    const hBefore = projectStore.terrain.heights.slice();
    addFacility('observation', 0, 0);
    expect(projectStore.facilityOrder.length).toBe(facCount + 1);
    undo();
    expect(projectStore.facilityOrder.length).toBe(facCount);
    // 地形快照内容逐元素回到操作前
    expect(projectStore.terrain.heights.length).toBe(hBefore.length);
    let changed = false;
    for (let i = 0; i < hBefore.length; i++) {
      if (hBefore[i] !== projectStore.terrain.heights[i]) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(false);
  });

  it('删除步道级联清理关联视点', () => {
    const pathId = addPath();
    addControlPoint(pathId, 0, 0);
    addControlPoint(pathId, 10, 0);
    addViewpoint(pathId, 0.5);
    expect(projectStore.viewpoints.length).toBe(1);
    deletePath(pathId);
    expect(projectStore.viewpoints.length).toBe(0);
    expect(projectStore.pathOrder).not.toContain(pathId);
  });

  it('删除设施入历史且可重做', () => {
    const id = addFacility('cable', 5, 5);
    const n = projectStore.facilityOrder.length;
    deleteFacility(id);
    expect(projectStore.facilityOrder.length).toBe(n - 1);
    undo();
    expect(projectStore.facilityOrder.length).toBe(n);
    expect(projectStore.facilities[id]).toBeDefined();
  });

  it('重置平坦后所有高度为 0 且可撤销', () => {
    resetTerrain('flat');
    expect(projectStore.terrain.heights.every((h) => h === 0)).toBe(true);
    undo();
    expect(projectStore.terrain.heights.some((h) => h !== 0)).toBe(true);
  });

  it('控制点拖拽更新生效', () => {
    const pathId = addPath();
    const cpId = addControlPoint(pathId, 0, 0);
    addControlPoint(pathId, 10, 0);
    updateControlPoint(pathId, cpId, 7, 7);
    const cp = projectStore.paths[pathId]!.controlPoints.find((c) => c.id === cpId)!;
    expect(cp.x).toBe(7);
    expect(cp.z).toBe(7);
  });
});

// 测试辅助：拿到全局地形服务
import { getTerrainService } from '../engine/terrain/terrainService';
const initTerrainServiceGetter = (): ReturnType<typeof getTerrainService> => getTerrainService();
