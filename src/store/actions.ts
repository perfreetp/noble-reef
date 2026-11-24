import { setProjectStore, projectStore } from './projectStore';
import { HistoryStack, type MutationToken } from './history';
import { getTerrainService } from '../engine/terrain/terrainService';
import { flattenFootprint } from '../engine/facilities/leveling';
import { generateMountainTerrain, createFlatTerrain } from '../engine/terrain/noise';
import { GRID_SIZE } from '../config/constants';
import { uid, clamp } from '../util/math';
import type {
  ControlPoint,
  FacilityInstance,
  FacilityType,
  PathState,
  ProjectState,
  SliceKey,
  Viewpoint,
  CameraMode,
} from '../types/project';
import type { Footprint } from '../types/project';
import { getCatalogEntry } from '../config/facilityCatalog';

/* ---------------- 历史栈适配器 ---------------- */

/**
 * Solid store 的代理身份稳定，切片不能按代理引用快照：
 * - terrain 直接捕获 heights TypedArray（每次 stroke 前整体克隆，旧数组不可变）；
 * - 其余切片是 KB 级纯 JSON，经 JSON 深拷贝脱离 Solid 代理后快照
 *   （不能用 structuredClone：它无法克隆 Solid 的 Proxy 包装）。
 */
const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const history = new HistoryStack({
  getSlice: (key: SliceKey): unknown => {
    switch (key) {
      case 'terrain':
        return projectStore.terrain.heights;
      case 'paths':
        return cloneJson({ pathOrder: projectStore.pathOrder, paths: projectStore.paths });
      case 'facilities':
        return cloneJson({
          facilityOrder: projectStore.facilityOrder,
          facilities: projectStore.facilities,
        });
      case 'viewpoints':
        return cloneJson(projectStore.viewpoints);
      case 'vegetation':
        return cloneJson(projectStore.vegetation);
    }
  },
  applySlices: (slices, direction) => {
    if (slices.terrain) {
      const heights = slices.terrain as Float32Array;
      getTerrainService().adopt(heights);
      setProjectStore('terrain', {
        size: projectStore.terrain.size,
        cellSize: projectStore.terrain.cellSize,
        heights,
        revision: projectStore.terrain.revision + 1,
      });
    }
    if (slices.paths) {
      const snap = slices.paths as { pathOrder: string[]; paths: Record<string, PathState> };
      setProjectStore('pathOrder', snap.pathOrder);
      setProjectStore('paths', snap.paths);
    }
    if (slices.facilities) {
      const snap = slices.facilities as {
        facilityOrder: string[];
        facilities: Record<string, FacilityInstance>;
      };
      setProjectStore('facilityOrder', snap.facilityOrder);
      setProjectStore('facilities', snap.facilities);
    }
    if (slices.viewpoints) {
      setProjectStore('viewpoints', slices.viewpoints as Viewpoint[]);
    }
    if (slices.vegetation) {
      setProjectStore('vegetation', slices.vegetation as ProjectState['vegetation']);
    }
    void direction;
  },
});

export const { canUndo, canRedo } = history;
export const undo = (): void => history.undo();
export const redo = (): void => history.redo();

/* ---------------- 地形 stroke ---------------- */

/**
 * 笔刷 stroke 开始：克隆当前 heights 作为新工作数组（旧数组成为不可变快照）。
 * 返回的 token 在 commit/cancel 时使用。
 */
export const beginTerrainStroke = (label = '地形笔刷'): MutationToken => {
  const token = history.begin(label, ['terrain']);
  const working = projectStore.terrain.heights.slice();
  getTerrainService().adopt(working);
  setProjectStore('terrain', {
    size: projectStore.terrain.size,
    cellSize: projectStore.terrain.cellSize,
    heights: working,
    revision: projectStore.terrain.revision + 1,
  });
  return token;
};

/** stroke 提交：revision 再自增一次，触发路径/植被派生重建并入栈 */
export const commitTerrainStroke = (token: MutationToken): void => {
  setProjectStore('terrain', 'revision', projectStore.terrain.revision + 1);
  history.commit(token);
};

/** 放弃 stroke（如未产生移动）：恢复旧数组且不入栈 */
export const cancelTerrainStroke = (token: MutationToken): void => {
  const oldHeights = token.before.terrain as Float32Array;
  getTerrainService().adopt(oldHeights);
  setProjectStore('terrain', {
    size: projectStore.terrain.size,
    cellSize: projectStore.terrain.cellSize,
    heights: oldHeights,
    revision: projectStore.terrain.revision + 1,
  });
};

/** 整图重置（平坦/重新生成），单条历史 */
export const resetTerrain = (kind: 'flat' | 'regenerate', seed?: number): void => {
  const token = history.begin(kind === 'flat' ? '重置为平坦地形' : '重新生成山地', ['terrain']);
  const next =
    kind === 'flat'
      ? createFlatTerrain(GRID_SIZE)
      : generateMountainTerrain(GRID_SIZE, seed ?? (Date.now() ^ 0x9e3779b9) >>> 0).heights;
  getTerrainService().adopt(next);
  setProjectStore('terrain', {
    size: projectStore.terrain.size,
    cellSize: projectStore.terrain.cellSize,
    heights: next,
    revision: projectStore.terrain.revision + 1,
  });
  history.commit(token);
};

/** 放弃进行中的变更并回滚（拖拽中断用），不入历史 */
export const rollbackMutation = (token: MutationToken): void => history.cancel(token);

/* ---------------- 路径 ---------------- */

export const addPath = (name?: string): string => {
  const token = history.begin('新建步道', ['paths']);
  const id = uid('path');
  const path: PathState = {
    id,
    name: name ?? `步道 ${projectStore.pathOrder.length + 1}`,
    style: { width: 2.4, color: 0x8a6d3b, railHeight: 1.1, hasWall: true, hasRail: true },
    controlPoints: [],
  };
  setProjectStore('pathOrder', [...projectStore.pathOrder, id]);
  setProjectStore('paths', { ...projectStore.paths, [id]: path });
  history.commit(token);
  return id;
};

export const deletePath = (pathId: string): void => {
  const token = history.begin('删除步道', ['paths', 'viewpoints']);
  const order = projectStore.pathOrder.filter((id) => id !== pathId);
  const map = { ...projectStore.paths };
  delete map[pathId];
  setProjectStore('pathOrder', order);
  setProjectStore('paths', map);
  // 关联视点一并清理
  setProjectStore(
    'viewpoints',
    projectStore.viewpoints.filter((v) => v.pathId !== pathId),
  );
  history.commit(token);
};

export const renamePath = (pathId: string, name: string): void => {
  const token = history.begin('重命名步道', ['paths']);
  setProjectStore('paths', pathId, 'name', name);
  history.commit(token);
};

export const updatePathStyle = (
  pathId: string,
  patch: Partial<PathState['style']>,
): void => {
  const token = history.begin('修改步道样式', ['paths']);
  setProjectStore('paths', pathId, 'style', { ...projectStore.paths[pathId]!.style, ...patch });
  history.commit(token);
};

export const addControlPoint = (pathId: string, x: number, z: number): string => {
  const token = history.begin('添加控制点', ['paths']);
  const cp: ControlPoint = { id: uid('cp'), x, z };
  setProjectStore('paths', pathId, 'controlPoints', [
    ...projectStore.paths[pathId]!.controlPoints,
    cp,
  ]);
  history.commit(token);
  return cp.id;
};

/** 拖拽控制点：down 时 begin，move 时直接改（不逐条入栈），up 时 commit */
export const beginControlPointDrag = (): MutationToken => history.begin('拖动控制点', ['paths']);

export const updateControlPoint = (
  pathId: string,
  cpId: string,
  x: number,
  z: number,
): void => {
  const cps = projectStore.paths[pathId]!.controlPoints;
  const i = cps.findIndex((c) => c.id === cpId);
  if (i < 0) return;
  setProjectStore('paths', pathId, 'controlPoints', i, { id: cpId, x, z });
};

export const commitControlPointDrag = (token: MutationToken): void => history.commit(token);

export const deleteControlPoint = (pathId: string, cpId: string): void => {
  const token = history.begin('删除控制点', ['paths']);
  setProjectStore(
    'paths',
    pathId,
    'controlPoints',
    projectStore.paths[pathId]!.controlPoints.filter((c) => c.id !== cpId),
  );
  history.commit(token);
};

/**
 * 复合地形命令（设施放置/移动）开始：
 * 与笔刷 stroke 相同，先克隆工作数组，保证 before 快照不被后续就地整平污染。
 */
const beginTerrainCompound = (label: string, keys: SliceKey[]): MutationToken => {
  const token = history.begin(label, keys);
  const working = projectStore.terrain.heights.slice();
  getTerrainService().adopt(working);
  setProjectStore('terrain', {
    size: projectStore.terrain.size,
    cellSize: projectStore.terrain.cellSize,
    heights: working,
    revision: projectStore.terrain.revision + 1,
  });
  return token;
};

/* ---------------- 设施（复合命令：整平 + 记录） ---------------- */

export const addFacility = (
  type: FacilityType,
  x: number,
  z: number,
  rotation = 0,
): string => {
  const token = beginTerrainCompound(`放置${getCatalogEntry(type).name}`, ['terrain', 'facilities']);
  const catalog = getCatalogEntry(type);
  const footprint: Footprint = structuredClone(catalog.footprint);
  const { baseHeight } = flattenFootprint(getTerrainService().model, footprint, x, z);
  getTerrainService().model.recomputeNormals();

  const id = uid('fac');
  const facility: FacilityInstance = { id, type, x, z, rotation, footprint, baseHeight };
  setProjectStore('facilityOrder', [...projectStore.facilityOrder, id]);
  setProjectStore('facilities', { ...projectStore.facilities, [id]: facility });
  setProjectStore('terrain', 'revision', projectStore.terrain.revision + 1);
  history.commit(token);
  return id;
};

export const beginFacilityMove = (): MutationToken =>
  beginTerrainCompound('移动设施', ['terrain', 'facilities']);

export const updateFacilityPosition = (facilityId: string, x: number, z: number): void => {
  const f = projectStore.facilities[facilityId]!;
  // 拖拽中：仅更新位置记录，整平在 commit 时一次性完成，避免每帧改地形
  setProjectStore('facilities', facilityId, { ...f, x, z });
};

export const commitFacilityMove = (token: MutationToken, facilityId: string): void => {
  const f = projectStore.facilities[facilityId]!;
  const { baseHeight } = flattenFootprint(getTerrainService().model, f.footprint, f.x, f.z);
  getTerrainService().model.recomputeNormals();
  setProjectStore('facilities', facilityId, 'baseHeight', baseHeight);
  setProjectStore('terrain', 'revision', projectStore.terrain.revision + 1);
  history.commit(token);
};

export const deleteFacility = (facilityId: string): void => {
  const token = history.begin('删除设施', ['facilities']);
  const order = projectStore.facilityOrder.filter((id) => id !== facilityId);
  const map = { ...projectStore.facilities };
  delete map[facilityId];
  setProjectStore('facilityOrder', order);
  setProjectStore('facilities', map);
  history.commit(token);
};

/* ---------------- 视点 ---------------- */

export const addViewpoint = (
  pathId: string,
  t: number,
  mode: CameraMode = 'fp',
): string => {
  const token = history.begin('添加漫游关键点', ['viewpoints']);
  const vp: Viewpoint = {
    id: uid('vp'),
    pathId,
    t: clamp(t, 0, 1),
    eyeHeight: 1.7,
    mode,
    durationSec: 4,
  };
  setProjectStore('viewpoints', [...projectStore.viewpoints, vp]);
  history.commit(token);
  return vp.id;
};

export const updateViewpoint = (vpId: string, patch: Partial<Viewpoint>): void => {
  const token = history.begin('修改关键点', ['viewpoints']);
  const list = projectStore.viewpoints;
  const i = list.findIndex((v) => v.id === vpId);
  if (i < 0) return;
  setProjectStore('viewpoints', i, { ...list[i]!, ...patch });
  history.commit(token);
};

export const deleteViewpoint = (vpId: string): void => {
  const token = history.begin('删除关键点', ['viewpoints']);
  setProjectStore(
    'viewpoints',
    projectStore.viewpoints.filter((v) => v.id !== vpId),
  );
  history.commit(token);
};

/* ---------------- 植被参数 ---------------- */

export const updateVegetationSettings = (
  patch: Partial<ProjectState['vegetation']>,
): void => {
  const token = history.begin('修改植被参数', ['vegetation']);
  setProjectStore('vegetation', { ...projectStore.vegetation, ...patch });
  history.commit(token);
};

/* ---------------- 工程装载（导入） ---------------- */

export const loadProject = (next: ProjectState): void => {
  getTerrainService().adopt(next.terrain.heights);
  setProjectStore({
    terrain: next.terrain,
    pathOrder: next.pathOrder,
    paths: next.paths,
    facilityOrder: next.facilityOrder,
    facilities: next.facilities,
    viewpoints: next.viewpoints,
    vegetation: next.vegetation,
  });
  history.clear();
};
