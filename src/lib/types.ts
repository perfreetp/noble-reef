// 核心数据模型 —— 整份编排工程的可序列化结构

export type Vec2 = { x: number; y: number };

/** 单个喷头（俯视平面坐标，单位：厘米；角度单位：度，0=朝右，逆时针） */
export interface Nozzle {
  id: string;
  x: number;
  y: number;
  /** 朝向（度） */
  angle: number;
  /** 所属分组 id，空字符串表示未分组 */
  groupId: string;
}

/** 喷头分组，时间轴轨道以分组为行 */
export interface NozzleGroup {
  id: string;
  name: string;
  /** 显示颜色，#rrggbb */
  color: string;
}

/** 时间轴上的色块：某分组在某一节拍内的喷水强度 0..1 */
export interface Block {
  id: string;
  groupId: string;
  beatIndex: number;
  intensity: number;
}

/** 广场 / 水池外观与范围配置（俯视世界坐标，单位厘米） */
export interface PlazaConfig {
  /** 广场底色 */
  plazaColor: string;
  /** 水池范围（矩形，世界坐标） */
  pool: { x: number; y: number; width: number; height: number };
  /** 水池底色 */
  poolColor: string;
  /** 水柱射程（厘米），强度 1 时的落点距离 */
  jetRange: number;
  /** 网格间距（厘米），0 表示关闭网格 */
  gridSize: number;
}

export interface Doc {
  version: 1;
  nozzles: Nozzle[];
  groups: NozzleGroup[];
  blocks: Block[];
  config: PlazaConfig;
  /** 每小节节拍数 */
  beatsPerBar: number;
  /** 每分钟节拍数 */
  bpm: number;
  /** 总小节数 */
  barCount: number;
}

/** 矩形阵列参数 */
export interface RectArraySpec {
  rows: number;
  cols: number;
  spacingX: number;
  spacingY: number;
  angle: number;
  groupId: string;
}

/** 环形阵列参数 */
export interface RingArraySpec {
  count: number;
  radius: number;
  /** 起始角（度） */
  startAngle: number;
  /** 是否布满整圆；否则为扇形 */
  fullCircle: boolean;
  /** 扇形扫掠角度（度，fullCircle=false 时生效） */
  sweep: number;
  /** 喷头朝向：radial=沿半径向外，tangent=切线，fixed=统一角度 */
  orientation: 'radial' | 'tangent' | 'fixed';
  fixedAngle: number;
  groupId: string;
}

export const DOC_FILE_MARKER = 'AQUA_PLAZA_STUDIO';

export interface ProjectFile {
  app: typeof DOC_FILE_MARKER;
  formatVersion: 1;
  exportedAt: string;
  doc: Doc;
}
