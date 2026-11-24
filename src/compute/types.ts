/** 领域模型与 worker 消息类型 */

export interface Antenna {
  id: number
  /** 站心东向坐标，米 */
  x: number
  /** 站心北向坐标，米 */
  y: number
}

export interface Baseline {
  idA: number
  idB: number
  dx: number
  dy: number
  /** 基线长度，米 */
  length: number
}

export interface Steering {
  /** 指向天顶角，度（0 = 天顶） */
  theta0Deg: number
  /** 指向方位角，度（自东向北，0~360） */
  phi0Deg: number
}

export interface PatternRequest {
  seq: number
  antennas: Antenna[]
  frequencyMHz: number
  theta0Deg: number
  phi0Deg: number
  nTheta: number
  nPhi: number
}

export interface ContourPayload {
  level: number
  /** 扁平 [ax,ay,az,bx,by,bz, …] 单位方向（随指向旋转的局部坐标） */
  coords: Float32Array
}

export interface PatternResponse {
  seq: number
  /** 归一化增益 dB，长度 nTheta*nPhi，theta-major: idx = i*nPhi + j */
  gainDb: Float32Array
  nTheta: number
  nPhi: number
  peakDb: number
  /** 主瓣 / 旁瓣等高线（worker 内提取，避免占用主线程帧时间） */
  contours: ContourPayload[]
  computeMs: number
}

/** 固定采样网格：73 × 128 = 9344 个采样方向（上千级） */
export const GRID_N_THETA = 73
export const GRID_N_PHI = 128
