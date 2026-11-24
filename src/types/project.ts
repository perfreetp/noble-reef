/** 可序列化工程数据类型与导入导出 DTO */

export type FacilityType = 'observation' | 'cable' | 'kiosk';
export type CameraMode = 'fp' | 'top';
export type BrushModeName = 'raise' | 'lower' | 'smooth';

export interface FootprintCircle {
  shape: 'circle';
  radius: number;
}
export interface FootprintRect {
  shape: 'rect';
  w: number;
  d: number;
}
export type Footprint = FootprintCircle | FootprintRect;

export interface PathStyle {
  width: number;
  color: number;
  railHeight: number;
  hasWall: boolean;
  hasRail: boolean;
}

export interface ControlPoint {
  id: string;
  /** 仅存水平坐标，y 全部由地形派生 */
  x: number;
  z: number;
}

export interface PathState {
  id: string;
  name: string;
  style: PathStyle;
  controlPoints: ControlPoint[];
}

export interface FacilityInstance {
  id: string;
  type: FacilityType;
  x: number;
  z: number;
  rotation: number;
  footprint: Footprint;
  /** 整平目标高（提交时记录） */
  baseHeight: number;
}

export interface Viewpoint {
  id: string;
  pathId: string;
  /** 沿路径归一化里程 0..1 */
  t: number;
  eyeHeight: number;
  mode: CameraMode;
  /** 从上一关键点到本点的播放时长（秒） */
  durationSec: number;
}

export interface VegRules {
  maxSlopeDeg: number;
  minAltitude: number;
  maxAltitude: number;
}

export interface VegSettings {
  seed: number;
  treeDensity: number;
  shrubDensity: number;
  rules: VegRules;
}

export interface TerrainState {
  readonly size: number;
  cellSize: number;
  heights: Float32Array;
  /** 地形修订号：每次提交自增，驱动引擎侧派生重建（TypedArray 元素级无响应式通知） */
  revision: number;
}

export interface ProjectState {
  terrain: TerrainState;
  pathOrder: string[];
  paths: Record<string, PathState>;
  facilityOrder: string[];
  facilities: Record<string, FacilityInstance>;
  viewpoints: Viewpoint[];
  vegetation: VegSettings;
}

/** 切片键，历史栈按切片做结构共享 */
export type SliceKey = 'terrain' | 'paths' | 'facilities' | 'viewpoints' | 'vegetation';

/* ---------------- DTO（文件格式） ---------------- */

export interface TerrainDTO {
  size: number;
  cellSize: number;
  encoding: 'f32-le-base64';
  data: string;
}

export interface ProjectDTO {
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  terrain: TerrainDTO;
  vegetation: VegSettings;
  paths: PathState[];
  facilities: FacilityInstance[];
  viewpoints: Viewpoint[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
