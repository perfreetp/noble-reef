import type { Antenna } from './types'

/**
 * 默认 9 副天线 Y 形阵列（类似 VLA 布局，等比三臂）。
 * 臂长 60 m，臂间夹角 120°，每臂 3 副站。
 */
export function defaultAntennas(): Antenna[] {
  const out: Antenna[] = []
  let id = 1
  const armAnglesDeg = [0, 120, 240]
  const armRatios = [0.25, 0.55, 1]
  for (const armDeg of armAnglesDeg) {
    const a = (armDeg * Math.PI) / 180
    for (const r of armRatios) {
      out.push({ id: id++, x: 60 * r * Math.cos(a), y: 60 * r * Math.sin(a) })
    }
  }
  return out
}

export const DEFAULT_FREQUENCY_MHZ = 400
export const DEFAULT_THETA0_DEG = 0
export const DEFAULT_PHI0_DEG = 0
