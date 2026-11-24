import type { BrushModeName, CameraMode, FacilityType } from './project';

export type PageName = 'terrain' | 'path' | 'facility' | 'viewpoint';

export interface BrushSettings {
  mode: BrushModeName;
  radiusIdx: number;
  strength: number;
  smoothFactor: number;
  /** 等高距（米），传给地形 shader uniform */
  contourInterval: number;
}

export interface SelectionState {
  kind: 'none' | 'path' | 'controlPoint' | 'facility' | 'viewpoint';
  id: string | null;
  /** 控制点选中时附带路径 id */
  pathId?: string;
}

export interface TourPlayback {
  playing: boolean;
  /** 整条时间线归一化进度 0..1（低频回写） */
  progress: number;
  mode: CameraMode;
}

/** 射线拾取结果（世界坐标） */
export interface PickResult {
  x: number;
  y: number;
  z: number;
}

/** 设施放置预览的临时状态 */
export interface FacilityDraft {
  type: FacilityType;
  x: number;
  z: number;
  valid: boolean;
}
