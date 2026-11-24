/** 二维挂点(部件局部坐标,单位:世界单位) */
export interface Vec2 {
  x: number;
  y: number;
}

/** 部件定义:影偶固定由 头/身/左臂/右臂/左腿/右腿 6 个部件组成 */
export interface PartDef {
  id: PartId;
  /** 父部件,身为根部件 */
  parent: PartId | null;
  /** 铰接挂点:在父(根部件为世界)坐标系中的位置,部件枢轴挂在这里 */
  anchor: Vec2;
  /** 可被操纵杆绑定的挂点列表(局部坐标) */
  tips: Partial<Record<TipId, Vec2>>;
  /** 相对父级的静止角度(弧度),姿态归零姿态 */
  restAngle: number;
  /** 关节限位(相对父级角度的最小/最大值),防止翻折穿透 */
  limits: [number, number];
  /** 渲染层级(深度),越大越靠前 */
  z: number;
}

export type PartId = 'head' | 'body' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export type TipId = PartId;

/** 一根杆对一个挂点的绑定:杆位移轴向 -> 关节角 */
export interface RodBinding {
  tip: TipId;
  axis: 'x' | 'y';
  /** 位移(单位)到角度(弧度)的换算系数 */
  scale: number;
}

/** 操纵杆:1~2 个挂点绑定,最多 3 根 */
export interface RodDef {
  id: string;
  label: string;
  /** 操纵盘内的初始位置,分量均在 [-1,1] */
  home: Vec2;
  bindings: [RodBinding] | [RodBinding, RodBinding];
}

/** 一个姿态:记录各杆件的操纵盘位置 */
export interface Pose {
  id: string;
  name: string;
  rods: Record<string, Vec2>;
  light: number;
  createdAt: number;
}

/** 完整配置:挂点层级 + 杆件绑定 + 姿态列表,即导出文件的全部内容 */
export interface RigConfig {
  version: number;
  parts: PartDef[];
  rods: RodDef[];
  poses: Pose[];
  lightIntensity: number;
}

export const RIG_VERSION = 1;
export const MAX_RODS = 3;
export const MAX_POSES = 6;
/** 操纵盘活动半径(世界单位) */
export const ROD_RANGE = 1.15;
