import type { WBGains } from '../types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 自动白平衡：以白平衡前的 HDR 线性 RGB 均值为依据，
 * 按 Rec.709 亮度把各通道拉到同一亮度，再归一化使总曝光基本不变。
 */
export function computeAutoGains(hdrMean: WBGains): WBGains {
  const eps = 1e-4;
  const r = Math.max(eps, hdrMean.r);
  const g = Math.max(eps, hdrMean.g);
  const b = Math.max(eps, hdrMean.b);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  const raw = { r: lum / r, g: lum / g, b: lum / b };
  const avg = (raw.r + raw.g + raw.b) / 3;
  // 归一化：平均增益为 1，避免整体提亮/压暗
  const gains = {
    r: clamp(raw.r / avg, 0.25, 4),
    g: clamp(raw.g / avg, 0.25, 4),
    b: clamp(raw.b / avg, 0.25, 4),
  };
  return gains;
}

/** 指数平滑，避免自动增益随画面抖动 */
export function smoothGains(current: WBGains, target: WBGains, alpha: number): WBGains {
  return {
    r: current.r + (target.r - current.r) * alpha,
    g: current.g + (target.g - current.g) * alpha,
    b: current.b + (target.b - current.b) * alpha,
  };
}
