import { APP_VERSION, SCHEMA_VERSION, CELL_SIZE, GRID_SIZE } from '../config/constants';
import { projectStore } from '../store/projectStore';
import { float32ToBase64 } from './encoding';
import type { ProjectDTO } from '../types/project';

/** 组装工程 DTO：只存可序列化数据，不存派生采样/植被实例/法线 */
export const buildProjectDTO = (createdAt = new Date().toISOString()): ProjectDTO => ({
  schemaVersion: SCHEMA_VERSION,
  appVersion: APP_VERSION,
  createdAt,
  updatedAt: new Date().toISOString(),
  terrain: {
    size: projectStore.terrain.size,
    cellSize: projectStore.terrain.cellSize,
    encoding: 'f32-le-base64',
    data: float32ToBase64(projectStore.terrain.heights),
  },
  vegetation: structuredClone(projectStore.vegetation),
  paths: projectStore.pathOrder.map((id) => structuredClone(projectStore.paths[id]!)),
  facilities: projectStore.facilityOrder.map((id) => structuredClone(projectStore.facilities[id]!)),
  viewpoints: structuredClone(projectStore.viewpoints),
});

/** 导出为 .json 文件并触发浏览器下载 */
export const exportProjectFile = (): string => {
  const dto = buildProjectDTO();
  const blob = new Blob([JSON.stringify(dto)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `park-project-${stamp}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
};

export const DEFAULT_GRID_SIZE = GRID_SIZE;
export const DEFAULT_CELL_SIZE = CELL_SIZE;
