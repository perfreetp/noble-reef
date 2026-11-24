/**
 * 全局数据模型:图层、饰片图元、素材类型
 *
 * 三层固定语义:
 *  - kingfisher 点翠底:各向异性光泽,半透明可透出下层珠光
 *  - pearl      珠串层:折射偏移采样下层
 *  - metal      金银饰片:金属高光 + 边缘亮边
 */

export type LayerId = 'kingfisher' | 'pearl' | 'metal';

/** Pixi BLEND_MODES 中对本工具有意义的子集,配置 JSON 用字符串持久化 */
export type BlendModeName =
  | 'normal'
  | 'add'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light';

/** 素材面板里可拖入的三类饰片 */
export type OrnamentKind = 'kingfisher' | 'pearl' | 'champleve';

export interface LayerConfig {
  id: LayerId;
  name: string;
  /** 0..1,层整体不透明度 */
  opacity: number;
  blendMode: BlendModeName;
  visible: boolean;
}

/** 饰片图元实例(配置 JSON 中可完整回读) */
export interface Ornament {
  id: string;
  kind: OrnamentKind;
  /** 素材 id,对应素材面板条目 */
  assetId: string;
  layer: LayerId;
  /** 画布坐标(图元中心) */
  x: number;
  y: number;
  /** 等比缩放 */
  scale: number;
  /** 旋转角(弧度) */
  rotation: number;
  /**
   * 层内深度 0..1,越大越靠近观者。
   * 同层压盖与跨层排序共同参与最终合成顺序。
   */
  depth: number;
}

/** 冠面吸附曲线:沿一条中心对称的贝塞尔脊线投影 */
export interface CrownProfile {
  /** 冠面控制点(画布坐标),二次贝塞尔 */
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  /** 吸附强度 0..1,0 为自由摆放 */
  snapStrength: number;
}

export interface ProjectConfig {
  version: 1;
  canvas: { width: number; height: number };
  /** 数组顺序 = 层叠顺序,index 0 在最底 */
  layers: LayerConfig[];
  ornaments: Ornament[];
  crown: CrownProfile;
}

export const LAYER_ORDER: LayerId[] = ['kingfisher', 'pearl', 'metal'];

export const LAYER_LABELS: Record<LayerId, string> = {
  kingfisher: '点翠底',
  pearl: '珠串层',
  metal: '金银饰片',
};

/** 每个图层只接受对应语义的饰片种类 */
export const LAYER_ACCEPTS: Record<LayerId, OrnamentKind[]> = {
  kingfisher: ['kingfisher'],
  pearl: ['pearl'],
  metal: ['champleve'],
};

export function isLayerId(v: string): v is LayerId {
  return v === 'kingfisher' || v === 'pearl' || v === 'metal';
}
