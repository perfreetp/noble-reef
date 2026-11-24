/** 水体档位：清澈 / 近岸 / 浑浊 */
export type WaterPreset = 'clear' | 'coastal' | 'murky';

/** 白平衡模式 */
export type WhiteBalanceMode = 'auto' | 'manual';

/** 单盏补光灯的状态 */
export interface LightState {
  id: number;
  enabled: boolean;
  /** 世界坐标（米） */
  position: [number, number, number];
  /** 0..1 功率 */
  intensity: number;
  /** 色温 3000K..8000K */
  colorTemp: number;
}

/** 白平衡增益（线性 RGB 乘算增益） */
export interface WBGains {
  r: number;
  g: number;
  b: number;
}

/** 完整场景状态（同时也是导出 JSON 的结构） */
export interface SceneState {
  version: 1;
  lights: LightState[];
  water: {
    preset: WaterPreset;
    /** 水深（米），用于按深度缩放吸收系数 */
    depth: number;
  };
  whiteBalance: {
    mode: WhiteBalanceMode;
    /** 手动模式下使用的增益 */
    manual: WBGains;
  };
}

/** 画面统计：RGB 均值 */
export interface FrameStats {
  /** 白平衡前 HDR 线性均值（自动白平衡用） */
  hdrMean: WBGains;
  /** 最终成片 LDR 0..1 均值（面板显示用） */
  ldrMean: WBGains;
  /** 当前生效的白平衡增益（自动模式为平滑后的值） */
  appliedGains: WBGains;
  fps: number;
}

export const MAX_LIGHTS = 4;
export const MIN_COLOR_TEMP = 3000;
export const MAX_COLOR_TEMP = 8000;

export const DEFAULT_STATE: SceneState = {
  version: 1,
  lights: [
    { id: 0, enabled: true, position: [1.6, 1.4, 1.8], intensity: 0.75, colorTemp: 5200 },
    { id: 1, enabled: true, position: [-1.7, 1.1, 1.4], intensity: 0.65, colorTemp: 5600 },
  ],
  water: { preset: 'coastal', depth: 10 },
  whiteBalance: { mode: 'auto', manual: { r: 1, g: 1, b: 1 } },
};
