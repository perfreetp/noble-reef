/** 剖面分析：沿过主瓣（局部天顶）的大圆切出增益剖面，提取 HPBW 与第一旁瓣电平 */

export interface ProfilePoint {
  /** 距主瓣轴的角偏移，度（负/正表示主瓣两侧） */
  offsetDeg: number
  gainDb: number
}

export interface ProfileResult {
  points: ProfilePoint[]
  /** 主瓣半功率波束宽度（-3 dB 全宽），度；不可测时为 null */
  hpbwDeg: number | null
  /** 第一旁瓣电平（相对主瓣峰值，dB，负值）；不存在旁瓣时为 null */
  firstSidelobeDb: number | null
  peakDb: number
}

const D2R = Math.PI / 180
const HALF_RANGE_DEG = 90
const PROFILE_SAMPLES = 721

/** 双线性插值读取网格增益（φ 周期环绕，θ 钳制到边界） */
function sampleGrid(
  gainDb: Float64Array | Float32Array,
  nTheta: number,
  nPhi: number,
  thetaDeg: number,
  phiDeg: number,
): number {
  const theta = Math.max(0, Math.min(180, thetaDeg))
  let phi = phiDeg % 360
  if (phi < 0) phi += 360
  const fi = (theta / 180) * nTheta
  const fj = (phi / 360) * nPhi
  const i0 = Math.min(nTheta - 2, Math.floor(fi))
  const j0 = Math.floor(fj) % nPhi
  const j1 = (j0 + 1) % nPhi
  const ti = fi - Math.floor(fi)
  const tj = fj - Math.floor(fj)
  const v00 = gainDb[i0 * nPhi + j0]
  const v10 = gainDb[i0 * nPhi + j1]
  const v01 = gainDb[(i0 + 1) * nPhi + j0]
  const v11 = gainDb[(i0 + 1) * nPhi + j1]
  const a = v00 + (v10 - v00) * tj
  const b = v01 + (v11 - v01) * tj
  return a + (b - a) * ti
}

/**
 * 沿局部 φ=0 子午面的大圆切片（随指向旋转的坐标系，主瓣恒在偏移 0°）。
 * 两侧各扫 90°，共 721 个采样点。
 */
export function computeProfile(
  gainDb: Float64Array | Float32Array,
  nTheta: number,
  nPhi: number,
): ProfileResult {
  const points: ProfilePoint[] = new Array(PROFILE_SAMPLES)
  for (let k = 0; k < PROFILE_SAMPLES; k++) {
    const offset = -HALF_RANGE_DEG + (2 * HALF_RANGE_DEG * k) / (PROFILE_SAMPLES - 1)
    // 偏移 α → 局部球坐标 θ=|α|，φ=0（α≥0）或 φ=180（α<0）
    const theta = Math.abs(offset)
    const phi = offset >= 0 ? 0 : 180
    points[k] = { offsetDeg: offset, gainDb: sampleGrid(gainDb, nTheta, nPhi, theta, phi) }
  }

  let peakDb = -Infinity
  for (const p of points) {
    if (Number.isFinite(p.gainDb) && p.gainDb > peakDb) peakDb = p.gainDb
  }

  const center = (PROFILE_SAMPLES - 1) / 2
  const threshold = peakDb - 3

  // —— HPBW：从中心向两侧找 -3 dB 穿越点（线性插值）——
  const findCrossing = (dir: -1 | 1): number | null => {
    for (let k = center + dir; k > 0 && k < PROFILE_SAMPLES - 1; k += dir) {
      const prev = points[k - dir].gainDb
      const cur = points[k].gainDb
      if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue
      if ((prev - threshold) * (cur - threshold) <= 0 && prev !== cur) {
        const t = (threshold - prev) / (cur - prev)
        return (
          points[k - dir].offsetDeg +
          (points[k].offsetDeg - points[k - dir].offsetDeg) * t
        )
      }
      if (cur < threshold) break
    }
    return null
  }
  const right = findCrossing(1)
  const left = findCrossing(-1)
  const hpbwDeg = right !== null && left !== null ? right - left : null

  // —— 第一旁瓣：越过 -3 dB 点后遇到的第一个局部极大（取两侧较强者）——
  const findFirstSidelobe = (dir: -1 | 1): number | null => {
    let outside = false
    for (let k = center + dir; k > 1 && k < PROFILE_SAMPLES - 2; k += dir) {
      const g = points[k].gainDb
      if (!outside) {
        if (Number.isFinite(g) && g < threshold) outside = true
        continue
      }
      const prevG = points[k - dir].gainDb
      const nextG = points[k + dir].gainDb
      if (
        Number.isFinite(g) &&
        Number.isFinite(prevG) &&
        Number.isFinite(nextG) &&
        g >= prevG &&
        g >= nextG
      ) {
        return g - peakDb
      }
    }
    return null
  }
  const slRight = findFirstSidelobe(1)
  const slLeft = findFirstSidelobe(-1)
  let firstSidelobeDb: number | null = null
  if (slRight !== null || slLeft !== null) {
    firstSidelobeDb = Math.max(slRight ?? -Infinity, slLeft ?? -Infinity)
  }

  return { points, hpbwDeg, firstSidelobeDb, peakDb }
}

export function degToRad(d: number): number {
  return d * D2R
}
