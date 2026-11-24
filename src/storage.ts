import { defaultConfig } from './config';
import type { Pose, RigConfig, RodBinding, RodDef, Vec2 } from './types';
import { MAX_POSES, MAX_RODS, RIG_VERSION } from './types';

const STORAGE_KEY = 'shadow-puppet-rig:v1';

export function loadConfig(): RigConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    const cfg = JSON.parse(raw) as RigConfig;
    return validateConfig(cfg);
  } catch (err) {
    console.warn('本地配置读取失败,回退默认:', err);
    return defaultConfig();
  }
}

export function saveConfig(cfg: RigConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function exportJSON(cfg: RigConfig): void {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `shadow-puppet-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importJSON(file: File): Promise<RigConfig> {
  const text = await file.text();
  const data = JSON.parse(text) as RigConfig;
  const cfg = validateConfig(data);
  saveConfig(cfg);
  return cfg;
}

const isVec2 = (v: unknown): v is Vec2 =>
  !!v && typeof v === 'object' && typeof (v as Vec2).x === 'number' && typeof (v as Vec2).y === 'number';

const VALID_TIPS = new Set(['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']);

function validateBinding(b: unknown): RodBinding | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as RodBinding;
  if (!VALID_TIPS.has(o.tip)) return null;
  if (o.axis !== 'x' && o.axis !== 'y') return null;
  if (typeof o.scale !== 'number' || !Number.isFinite(o.scale)) return null;
  return { tip: o.tip, axis: o.axis, scale: Math.max(-4, Math.min(4, o.scale)) };
}

function validateRod(r: unknown, index: number): RodDef | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as RodDef;
  const bindings = Array.isArray(o.bindings) ? o.bindings.map(validateBinding).filter(Boolean) : [];
  if (bindings.length < 1 || bindings.length > 2) return null; // 每杆 1~2 挂点
  const home = isVec2(o.home) ? o.home : { x: 0, y: 0 };
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `rod-${index}`,
    label: typeof o.label === 'string' && o.label ? o.label : `杆 ${index + 1}`,
    home,
    bindings: bindings as RodDef['bindings'],
  };
}

function validatePose(p: unknown): Pose | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Pose;
  if (typeof o.name !== 'string') return null;
  if (!o.rods || typeof o.rods !== 'object') return null;
  const rods: Record<string, Vec2> = {};
  for (const [k, v] of Object.entries(o.rods)) {
    if (isVec2(v)) rods[k] = { x: Math.max(-1, Math.min(1, v.x)), y: Math.max(-1, Math.min(1, v.y)) };
  }
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `pose-${Math.round(performance.now())}`,
    name: o.name,
    rods,
    light: typeof o.light === 'number' ? Math.max(0, Math.min(2, o.light)) : 1,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
  };
}

/**
 * 校验导入文件。部件层级是运动学成立的前提,结构非法时整体回退默认,
 * 杆件/姿态等可裁剪数据则逐条过滤 —— 保证导入后操纵、限位、联动可还原。
 */
export function validateConfig(data: unknown): RigConfig {
  const fallback = defaultConfig();
  if (!data || typeof data !== 'object') throw new Error('配置不是合法 JSON 对象');
  const o = data as Partial<RigConfig>;
  if (!Array.isArray(o.parts) || o.parts.length !== 6) {
    throw new Error('部件定义缺失:影偶必须由 6 个部件组成');
  }
  const ids = new Set(o.parts.map((p) => p.id as string));
  for (const id of ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
    if (!ids.has(id)) throw new Error(`缺少部件:${id}`);
  }
  for (const p of o.parts) {
    if (p.parent !== null && !ids.has(p.parent)) throw new Error(`部件 ${p.id} 的父级挂点不存在`);
    if (!Array.isArray(p.limits) || p.limits[0] >= p.limits[1]) {
      throw new Error(`部件 ${p.id} 的关节限位非法`);
    }
    if (!isVec2(p.anchor)) throw new Error(`部件 ${p.id} 缺挂点坐标`);
  }
  const hasRoot = o.parts.some((p) => p.parent === null);
  if (!hasRoot) throw new Error('缺少根部件(身)');

  const rods = Array.isArray(o.rods) ? o.rods.slice(0, MAX_RODS).map(validateRod).filter(Boolean) : [];
  if (rods.length === 0) throw new Error('杆件绑定为空');
  const poses = Array.isArray(o.poses)
    ? o.poses.slice(0, MAX_POSES).map(validatePose).filter(Boolean).map((p) => p!)
    : [];

  return {
    version: RIG_VERSION,
    parts: o.parts as RigConfig['parts'],
    rods: rods as RodDef[],
    poses,
    lightIntensity:
      typeof o.lightIntensity === 'number' ? Math.max(0, Math.min(2, o.lightIntensity)) : fallback.lightIntensity,
  };
}
