/** 发束可调参数。四个主参数 + 刷子工具产生的蓬松度。 */
export interface BundleParams {
  /** 长度（世界单位，头模半径约为 1） */
  length: number;
  /** 粗细倍率，影响几何截面半径 */
  thickness: number;
  /** 卷曲度 0..1，改变时沿曲线重算走向 */
  curl: number;
  /** 弯曲方向：绕发根法线的方位角（度） */
  direction: number;
  /** 下垂角：离开发法线的倾角（度），0 = 贴法线直立 */
  tilt: number;
  /** 蓬松度 0..1，由刷子工具局部增加 */
  fluff: number;
}

export type Vec3Tuple = [number, number, number];

/** 发根锚点：贴在头皮网格上的位置与法线 */
export interface Anchor {
  position: Vec3Tuple;
  normal: Vec3Tuple;
}

export interface HairBundle {
  id: string;
  anchor: Anchor;
  params: BundleParams;
  groupId: string | null;
  /** 层级顺序，用于化解发束穿插时的上下关系 */
  layer: number;
  color: string;
}

export interface HairGroup {
  id: string;
  name: string;
  memberIds: string[];
}

export const DEFAULT_PARAMS: BundleParams = {
  length: 0.9,
  thickness: 1,
  curl: 0.15,
  direction: 180,
  tilt: 55,
  fluff: 0,
};

export const PARAM_LIMITS = {
  length: { min: 0.15, max: 2.5, step: 0.01 },
  thickness: { min: 0.3, max: 3, step: 0.01 },
  curl: { min: 0, max: 1, step: 0.01 },
  direction: { min: 0, max: 360, step: 1 },
  tilt: { min: 0, max: 90, step: 1 },
  fluff: { min: 0, max: 1, step: 0.01 },
} as const;

export type ParamKey = keyof BundleParams;

/** 新建发束时的默认颜色池 */
export const HAIR_COLORS = ['#3b2a1e', '#5a3a22', '#7a5230', '#2b2b2b', '#8c6a3f', '#4a3325'];

let nextId = 1;
export function genId(prefix: string): string {
  return `${prefix}_${nextId++}_${Math.floor(performance.now() % 1e6).toString(36)}`;
}

/** 载入文件后重置 id 计数，避免与既有 id 冲突 */
export function bumpIdCounter(): void {
  nextId += 1000;
}

export function cloneParams(p: BundleParams): BundleParams {
  return { ...p };
}

export function cloneAnchor(a: Anchor): Anchor {
  return { position: [...a.position], normal: [...a.normal] };
}

export function cloneBundle(b: HairBundle): HairBundle {
  return {
    id: b.id,
    anchor: cloneAnchor(b.anchor),
    params: cloneParams(b.params),
    groupId: b.groupId,
    layer: b.layer,
    color: b.color,
  };
}
