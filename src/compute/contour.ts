/** Marching squares：在 θ–φ 采样网格上提取等增益等高线，输出球面单位方向 */

export interface ContourSegment {
  /** 起点单位方向（随指向旋转的局部球坐标） */
  a: [number, number, number]
  b: [number, number, number]
}

export interface ContourSet {
  level: number
  segments: ContourSegment[]
}

/**
 * 边编号：0=底(j→j+1) 1=右(i→i+1) 2=顶 3=左
 * 角编号：0=左下(i,j) 1=右下(i,j+1) 2=右上(i+1,j+1) 3=左上(i+1,j)
 * 值 ≥ level 视为角点置位（bit0..bit3 对应角 0..3）
 */
const CASE_TABLE: Record<number, Array<[number, number]>> = {
  0: [],
  1: [[0, 3]],
  2: [[0, 1]],
  3: [[1, 3]],
  4: [[1, 2]],
  5: [[0, 1], [1, 2], [0, 3]],
  6: [[0, 2]],
  7: [[2, 3]],
  8: [[2, 3]],
  9: [[0, 2]],
  10: [[0, 3], [0, 2], [1, 2]],
  11: [[1, 2]],
  12: [[1, 3]],
  13: [[0, 1]],
  14: [[0, 3]],
  15: [],
}

const D2R = Math.PI / 180

/** θ(度)、φ(度) → 局部球面单位向量：x=东, y=天顶, z=北 */
function unitDir(thetaDeg: number, phiDeg: number): [number, number, number] {
  const th = thetaDeg * D2R
  const ph = phiDeg * D2R
  const st = Math.sin(th)
  return [st * Math.cos(ph), Math.cos(th), st * Math.sin(ph)]
}

/**
 * 在规则网格上提取指定 dB 电平的等高线段。
 * @param gainDb theta-major 网格，idx = i*nPhi + j（φ 方向周期环绕）
 * @param thetaMaxDeg 网格覆盖到的最大天顶角（180 = 全球）
 */
export function extractContours(
  gainDb: Float64Array | Float32Array,
  nTheta: number,
  nPhi: number,
  level: number,
  thetaMaxDeg = 180,
): ContourSet {
  const segments: ContourSegment[] = []
  const dTheta = thetaMaxDeg / nTheta
  const dPhi = 360 / nPhi
  const val = (i: number, j: number) => gainDb[i * nPhi + (j % nPhi)]

  for (let i = 0; i < nTheta - 1; i++) {
    for (let j = 0; j < nPhi; j++) {
      const v00 = val(i, j)
      const v10 = val(i, j + 1)
      const v11 = val(i + 1, j + 1)
      const v01 = val(i + 1, j)
      const corners = [v00, v10, v11, v01]
      let mask = 0
      for (let c = 0; c < 4; c++) {
        if (Number.isFinite(corners[c]) && corners[c] >= level) mask |= 1 << c
      }
      const edges = CASE_TABLE[mask]
      if (!edges || edges.length === 0) continue

      // 各边交点的插值参数（0→1），返回该点的 (θ°, φ°)
      const edgePoint = (edge: number): [number, number] => {
        let lo: number, hi: number
        let thetaLo: number, thetaHi: number, phiLo: number, phiHi: number
        const th0 = i * dTheta
        const th1 = (i + 1) * dTheta
        const ph0 = j * dPhi
        const ph1 = (j + 1) * dPhi
        switch (edge) {
          case 0: // 底：(i,j) → (i,j+1)
            lo = v00; hi = v10; thetaLo = th0; thetaHi = th0; phiLo = ph0; phiHi = ph1; break
          case 1: // 右：(i,j+1) → (i+1,j+1)
            lo = v10; hi = v11; thetaLo = th0; thetaHi = th1; phiLo = ph1; phiHi = ph1; break
          case 2: // 顶：(i+1,j) → (i+1,j+1)
            lo = v01; hi = v11; thetaLo = th1; thetaHi = th1; phiLo = ph0; phiHi = ph1; break
          default: // 3 左：(i,j) → (i+1,j)
            lo = v00; hi = v01; thetaLo = th0; thetaHi = th1; phiLo = ph0; phiHi = ph0; break
        }
        let t = 0.5
        if (Number.isFinite(lo) && Number.isFinite(hi) && hi !== lo) {
          t = Math.max(0, Math.min(1, (level - lo) / (hi - lo)))
        }
        return [thetaLo + (thetaHi - thetaLo) * t, phiLo + (phiHi - phiLo) * t]
      }

      for (const [e1, e2] of edges) {
        const [thA, phA] = edgePoint(e1)
        const [thB, phB] = edgePoint(e2)
        segments.push({ a: unitDir(thA, phA), b: unitDir(thB, phB) })
      }
    }
  }
  return { level, segments }
}
