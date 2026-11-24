/** dB 增益 → 颜色 LUT（主瓣暖色高亮，旁瓣按增益分级冷色） */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 色标断点，dB 从低（深蓝）到高（白热），覆盖 -45 ~ 0 dB */
const COLOR_STOPS: Array<{ db: number; rgb: Rgb }> = [
  { db: -45, rgb: { r: 8, g: 16, b: 56 } },
  { db: -35, rgb: { r: 22, g: 58, b: 128 } },
  { db: -25, rgb: { r: 30, g: 130, b: 190 } },
  { db: -18, rgb: { r: 40, g: 190, b: 170 } },
  { db: -12, rgb: { r: 130, g: 215, b: 95 } },
  { db: -7, rgb: { r: 245, g: 220, b: 70 } },
  { db: -3, rgb: { r: 245, g: 145, b: 40 } },
  { db: -1, rgb: { r: 225, g: 60, b: 45 } },
  { db: 0, rgb: { r: 255, g: 255, b: 245 } },
]

/** 颜色映射的有效 dB 范围 */
export const DB_FLOOR = -45
export const DB_CEIL = 0

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 将 dB 增益映射为 0~1 线性 RGB */
export function gainToColor(db: number): Rgb {
  if (!Number.isFinite(db)) return COLOR_STOPS[0].rgb
  const v = Math.max(DB_FLOOR, Math.min(DB_CEIL, db))
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    if (v <= COLOR_STOPS[i].db) {
      const lo = COLOR_STOPS[i - 1]
      const hi = COLOR_STOPS[i]
      const t = (v - lo.db) / (hi.db - lo.db)
      return {
        r: lerp(lo.rgb.r, hi.rgb.r, t) / 255,
        g: lerp(lo.rgb.g, hi.rgb.g, t) / 255,
        b: lerp(lo.rgb.b, hi.rgb.b, t) / 255,
      }
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1].rgb
  return { r: last.r / 255, g: last.g / 255, b: last.b / 255 }
}

/** CSS 字符串，供 2D 图例 / 剖面视图复用 */
export function gainToCss(db: number): string {
  const c = gainToColor(db)
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`
}
