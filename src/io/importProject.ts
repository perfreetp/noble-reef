import { base64ToFloat32 } from './encoding';
import { migrate } from './migrate';
import { validateProjectDto } from './validate';
import { loadProject } from '../store/actions';
import type { ProjectDTO, ProjectState, Viewpoint } from '../types/project';

export interface ImportOutcome {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** 读取并导入工程文件；成功时装载 store 并清空历史 */
export const importProjectFile = async (file: File): Promise<ImportOutcome> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, errors: ['文件不是合法的 JSON'], warnings: [] };
  }

  const validation = validateProjectDto(parsed);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings };

  const dto = migrate(parsed as ProjectDTO);
  let heights: Float32Array;
  try {
    heights = base64ToFloat32(dto.terrain.data);
  } catch (e) {
    return {
      ok: false,
      errors: [`地形数据解码失败：${e instanceof Error ? e.message : String(e)}`],
      warnings: validation.warnings,
    };
  }

  const expectedLen = dto.terrain.size * dto.terrain.size;
  if (heights.length !== expectedLen) {
    return {
      ok: false,
      errors: [`高度场长度应为 ${expectedLen}，实际 ${heights.length}`],
      warnings: validation.warnings,
    };
  }
  let badCount = 0;
  for (const h of heights) {
    if (!Number.isFinite(h)) badCount++;
  }
  if (badCount > 0) {
    return { ok: false, errors: [`高度场包含 ${badCount} 个非有限数值`], warnings: validation.warnings };
  }

  // 丢弃悬空关键点
  const pathIds = new Set(dto.paths.map((p) => p.id));
  const viewpoints: Viewpoint[] = dto.viewpoints.filter((v) => pathIds.has(v.pathId));
  const dropped = dto.viewpoints.length - viewpoints.length;
  if (dropped > 0) validation.warnings.push(`已丢弃 ${dropped} 个引用无效的关键点`);

  const state: ProjectState = {
    terrain: {
      size: dto.terrain.size,
      cellSize: dto.terrain.cellSize,
      heights,
      revision: 0,
    },
    pathOrder: dto.paths.map((p) => p.id),
    paths: Object.fromEntries(dto.paths.map((p) => [p.id, p])),
    facilityOrder: dto.facilities.map((f) => f.id),
    facilities: Object.fromEntries(dto.facilities.map((f) => [f.id, f])),
    viewpoints,
    vegetation: dto.vegetation,
  };

  loadProject(state);
  return { ok: true, errors: [], warnings: validation.warnings };
};
