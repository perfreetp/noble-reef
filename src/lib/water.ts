import type { WaterPreset, WBGains } from '../types';

/**
 * 水体光学参数。
 * 吸收系数单位 1/m（红光 > 绿光 > 蓝光，符合 Beer-Lambert 衰减规律），
 * 数值参考 Jerlov 水体类型做了简化：
 *  - clear  清澈大洋水（近似 Jerlov I）
 *  - coastal 近岸水体（近似 Jerlov 3）
 *  - murky  浑浊港口水
 */
export interface WaterParams {
  key: WaterPreset;
  label: string;
  /** 基准吸收系数（RGB，1/m），红光衰减最快 */
  absorption: WBGains;
  /** 水中环境/后向散射颜色（线性 RGB，整体偏蓝绿） */
  backscatterColor: WBGains;
  /** 基准后向散射密度（1/m） */
  backscatterDensity: number;
  /** 环境光强度系数 */
  ambientScale: number;
}

export const WATER_PRESETS: Record<WaterPreset, WaterParams> = {
  clear: {
    key: 'clear',
    label: '清澈',
    absorption: { r: 0.055, g: 0.019, b: 0.013 },
    backscatterColor: { r: 0.045, g: 0.16, b: 0.22 },
    backscatterDensity: 0.03,
    ambientScale: 0.55,
  },
  coastal: {
    key: 'coastal',
    label: '近岸',
    absorption: { r: 0.18, g: 0.075, b: 0.05 },
    backscatterColor: { r: 0.035, g: 0.13, b: 0.15 },
    backscatterDensity: 0.08,
    ambientScale: 0.38,
  },
  murky: {
    key: 'murky',
    label: '浑浊',
    absorption: { r: 0.45, g: 0.22, b: 0.16 },
    backscatterColor: { r: 0.05, g: 0.11, b: 0.1 },
    backscatterDensity: 0.18,
    ambientScale: 0.22,
  },
};

/** 水深对吸收的缩放因子：越深，上层水体吸收路径越长，等效系数越大 */
export function depthFactor(depth: number): number {
  return Math.min(2.5, Math.max(0.4, 0.4 + depth * 0.06));
}

/** 当前档位 + 水深下的有效 RGB 吸收系数（1/m） */
export function effectiveAbsorption(preset: WaterPreset, depth: number): WBGains {
  const p = WATER_PRESETS[preset];
  const f = depthFactor(depth);
  return { r: p.absorption.r * f, g: p.absorption.g * f, b: p.absorption.b * f };
}

/** 当前档位 + 水深下的后向散射密度（1/m） */
export function effectiveBackscatterDensity(preset: WaterPreset, depth: number): number {
  return WATER_PRESETS[preset].backscatterDensity * (0.6 + depthFactor(depth) * 0.4);
}
