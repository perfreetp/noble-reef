import type { Antenna, Baseline } from './types'

export const SPEED_OF_LIGHT = 299_792_458

/** 观测频率（MHz）→ 波长（米） */
export function wavelengthM(frequencyMHz: number): number {
  return SPEED_OF_LIGHT / (frequencyMHz * 1e6)
}

/**
 * 枚举全部基线（无序天线对）。
 * N 副天线 → N(N-1)/2 条基线。
 */
export function computeBaselines(antennas: Antenna[]): Baseline[] {
  const out: Baseline[] = []
  for (let i = 0; i < antennas.length; i++) {
    for (let j = i + 1; j < antennas.length; j++) {
      const dx = antennas[j].x - antennas[i].x
      const dy = antennas[j].y - antennas[i].y
      out.push({
        idA: antennas[i].id,
        idB: antennas[j].id,
        dx,
        dy,
        length: Math.hypot(dx, dy),
      })
    }
  }
  return out
}

const D2R = Math.PI / 180

/**
 * 在随指向旋转的局部球面坐标网格上计算阵列方向图（各向同性点源、均匀幅度加权）。
 *
 * 采样方向 u 为局部坐标（主瓣轴恒在局部天顶），先经旋转矩阵 M 映到全局方向 s，
 * 再按标准相控阵公式求和：
 *   AF(u) = Σ_i exp[j k (r_i·s − r_i·s0)]，s = M·u，
 * s0 = (sinθ0 cosφ0, cosθ0, sinθ0 sinφ0) 为指向。
 * 局部天顶处 s = s0，各单元相位恒 0、同相叠加，故峰值 0 dB 恒在天顶。
 *
 * 输出归一化功率方向图 dB：G = 10·log10(|AF|² / N²)。
 *
 * @returns 长度 nTheta*nPhi 的 Float64Array（theta-major）
 */
export function computePatternGrid(
  antennas: Antenna[],
  frequencyMHz: number,
  theta0Deg: number,
  phi0Deg: number,
  nTheta: number,
  nPhi: number,
): { gainDb: Float64Array; peakDb: number } {
  const n = antennas.length
  const gainDb = new Float64Array(nTheta * nPhi)
  if (n === 0) {
    gainDb.fill(-Infinity)
    return { gainDb, peakDb: -Infinity }
  }

  const lambda = wavelengthM(frequencyMHz)
  const k = (2 * Math.PI) / lambda
  const theta0 = theta0Deg * D2R
  const phi0 = phi0Deg * D2R
  const st0 = Math.sin(theta0)
  const ct0 = Math.cos(theta0)
  const cp0 = Math.cos(phi0)
  const sp0 = Math.sin(phi0)
  // 每副天线在指向方向 s0 上的空间相位 ψ_i = k r_i·s0
  const psi = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    psi[i] = k * st0 * (antennas[i].x * cp0 + antennas[i].y * sp0)
  }
  // 旋转矩阵 M：局部坐标 → 全局坐标，局部天顶 (0,1,0) 映到指向 s0。
  // 与 beamScene 中球面旋转矩阵保持同一约定（行主序）。
  const m00 = sp0 * sp0 + ct0 * cp0 * cp0
  const m01 = st0 * cp0
  const m02 = (ct0 - 1) * sp0 * cp0
  const m20 = (ct0 - 1) * sp0 * cp0
  const m21 = st0 * sp0
  const m22 = cp0 * cp0 + ct0 * sp0 * sp0

  const dTheta = Math.PI / nTheta
  const dPhi = (2 * Math.PI) / nPhi
  let maxPower = 0

  for (let i = 0; i < nTheta; i++) {
    const theta = i * dTheta
    const st = Math.sin(theta)
    const ct = Math.cos(theta)
    for (let j = 0; j < nPhi; j++) {
      const phi = j * dPhi
      // 局部单位方向 u = (东, 天顶, 北)
      const ux = st * Math.cos(phi)
      const uy = ct
      const uz = st * Math.sin(phi)
      // 全局方向 s = M·u（地面阵列 r_i 无高度分量，点积只需 s 的东、北分量 sx、sz）
      const sx = m00 * ux + m01 * uy + m02 * uz
      const sz = m20 * ux + m21 * uy + m22 * uz
      let re = 0
      let im = 0
      for (let a = 0; a < n; a++) {
        // AF = Σ exp[j k (r_i·s − r_i·s0)]；局部天顶处 s=s0，相位恒 0
        const phase =
          k * (antennas[a].x * sx + antennas[a].y * sz) - psi[a]
        re += Math.cos(phase)
        im += Math.sin(phase)
      }
      const power = re * re + im * im
      if (power > maxPower) maxPower = power
      gainDb[i * nPhi + j] = power
    }
  }

  const norm = n * n
  let peakDb = -Infinity
  for (let idx = 0; idx < gainDb.length; idx++) {
    const p = gainDb[idx] / norm
    const db = p > 0 ? 10 * Math.log10(p) : -Infinity
    gainDb[idx] = db
    if (db > peakDb) peakDb = db
  }
  return { gainDb, peakDb }
}
