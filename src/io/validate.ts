import { SCHEMA_VERSION } from '../config/constants';
import type {
  FacilityType,
  ValidationResult,
  Viewpoint,
} from '../types/project';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const FACILITY_TYPES: FacilityType[] = ['observation', 'cable', 'kiosk'];

/** 手写 DTO 守卫，返回结构化中文错误/告警 */
export const validateProjectDto = (input: unknown): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObj(input)) return { ok: false, errors: ['工程文件不是有效的 JSON 对象'], warnings };
  const dto = input as Record<string, unknown>;

  if (!isFiniteNum(dto.schemaVersion)) errors.push('缺少合法的 schemaVersion 字段');
  else if (dto.schemaVersion > SCHEMA_VERSION)
    errors.push(`工程版本 ${dto.schemaVersion} 高于当前应用支持的 ${SCHEMA_VERSION}，请升级应用`);

  const terrain = dto.terrain;
  if (!isObj(terrain)) errors.push('缺少 terrain 地形数据');
  else {
    if (!isFiniteNum(terrain.size) || terrain.size <= 0) errors.push('terrain.size 非法');
    if (!isFiniteNum(terrain.cellSize) || terrain.cellSize <= 0) errors.push('terrain.cellSize 非法');
    if (terrain.encoding !== 'f32-le-base64') errors.push('不支持的地形编码（仅支持 f32-le-base64）');
    if (typeof terrain.data !== 'string' || terrain.data.length === 0) errors.push('地形数据为空');
  }

  if (!isObj(dto.vegetation)) errors.push('缺少 vegetation 植被参数');
  else if (!isFiniteNum(dto.vegetation.seed)) errors.push('vegetation.seed 非法');

  if (!Array.isArray(dto.paths)) errors.push('paths 必须是数组');
  if (!Array.isArray(dto.facilities)) errors.push('facilities 必须是数组');
  if (!Array.isArray(dto.viewpoints)) errors.push('viewpoints 必须是数组');

  const pathIds = new Set<string>();
  if (Array.isArray(dto.paths)) {
    dto.paths.forEach((p, i) => {
      if (!isObj(p) || typeof p.id !== 'string') {
        errors.push(`paths[${i}] 缺少 id`);
        return;
      }
      pathIds.add(p.id);
      if (!Array.isArray(p.controlPoints)) errors.push(`路径 ${p.id} 的 controlPoints 必须是数组`);
    });
  }

  if (Array.isArray(dto.facilities)) {
    dto.facilities.forEach((f, i) => {
      if (!isObj(f) || typeof f.id !== 'string') {
        errors.push(`facilities[${i}] 缺少 id`);
        return;
      }
      if (!FACILITY_TYPES.includes(f.type as FacilityType))
        errors.push(`设施 ${f.id} 的类型非法: ${String(f.type)}`);
      if (!isObj(f.footprint)) errors.push(`设施 ${f.id} 缺少 footprint`);
    });
  }

  if (Array.isArray(dto.viewpoints)) {
    dto.viewpoints.forEach((v, i) => {
      const vp = v as Partial<Viewpoint>;
      if (!vp || typeof vp.id !== 'string') {
        errors.push(`viewpoints[${i}] 缺少 id`);
        return;
      }
      if (!isFiniteNum(vp.t) || vp.t < 0 || vp.t > 1) errors.push(`关键点 ${vp.id} 的 t 必须在 0..1`);
      if (vp.mode !== 'fp' && vp.mode !== 'top') errors.push(`关键点 ${vp.id} 的 mode 非法`);
      if (typeof vp.pathId === 'string' && !pathIds.has(vp.pathId))
        warnings.push(`关键点 ${vp.id} 引用的步道 ${vp.pathId} 不存在，已丢弃`);
    });
  }

  return { ok: errors.length === 0, errors, warnings };
};
