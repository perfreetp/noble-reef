/** 全局类型与常量。单位约定:1 场景单位 = 1 毫米。 */

export interface FeatherParams {
  id: number;
  /** 羽枝库纹理编号 0..23 */
  textureIndex: number;
  /** 纤维密度 0.3..1.5 */
  density: number;
  /** 丝理走向 -1..1(负值左斜,正值右斜) */
  grainDir: number;
  /** 羽枝长度 mm */
  length: number;
  /** 羽枝最大宽度 mm */
  width: number;
  /** 羽枝弯曲度 -1..1 */
  curvature: number;
  /** 纵向细分段数 4..64 */
  segments: number;
  /** 冠面参数坐标 */
  u: number;
  v: number;
  /** 绕冠面法线旋转(弧度) */
  rotation: number;
  /** 是否镜像 */
  mirrored: boolean;
  /** 与冠面间隙 mm */
  gap: number;
  /** 纤维方向角(弧度) */
  fiberAngle: number;
  /** 虹彩偏移色相 -0.5..0.5 */
  hueShift: number;
  /** 光泽锐度档位 0|1|2 */
  glossLevel: 0 | 1 | 2;
}

export interface LightParams {
  /** 方位角(度) */
  azimuth: number;
  /** 俯仰角(度) */
  elevation: number;
  /** 强度 0..3 */
  intensity: number;
}

export interface CrownConfig {
  version: 1;
  light: LightParams;
  feathers: FeatherParams[];
}

/** 间隙报警阈值 mm */
export const GAP_WARN_MM = 0.4;
export const MAX_FEATHERS = 200;
export const MAX_SEGMENTS = 64;
export const TEXTURE_COUNT = 24;

let fallbackId = 1;

export function defaultFeather(id: number, u = 0.5, v = 0.4): FeatherParams {
  return {
    id,
    textureIndex: (id * 7 + fallbackId++) % TEXTURE_COUNT,
    density: 0.85,
    grainDir: 0,
    length: 42,
    width: 13,
    curvature: 0.25,
    segments: 48,
    u,
    v,
    rotation: 0,
    mirrored: false,
    gap: 0.15,
    fiberAngle: 0,
    hueShift: 0,
    glossLevel: 1,
  };
}

export function clampFeather(p: FeatherParams): FeatherParams {
  const c = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
  return {
    ...p,
    textureIndex: Math.round(c(p.textureIndex, 0, TEXTURE_COUNT - 1)),
    density: c(p.density, 0.3, 1.5),
    grainDir: c(p.grainDir, -1, 1),
    length: c(p.length, 10, 90),
    width: c(p.width, 4, 30),
    curvature: c(p.curvature, -1, 1),
    segments: Math.round(c(p.segments, 4, MAX_SEGMENTS)),
    u: c(p.u, 0.02, 0.98),
    v: c(p.v, 0.05, 0.98),
    gap: c(p.gap, 0, 1.5),
    hueShift: c(p.hueShift, -0.5, 0.5),
    glossLevel: (Math.round(c(p.glossLevel, 0, 2)) as 0 | 1 | 2),
  };
}
