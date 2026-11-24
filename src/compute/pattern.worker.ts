import type { Antenna, ContourPayload, PatternRequest, PatternResponse } from './types'
import { computePatternGrid } from './physics'
import { extractContours } from './contour'

const CONTOUR_LEVELS = [-3, -10, -20]

/**
 * 方向图计算 worker：把 O(N天线 × 9344 方向) 复指数求和与 marching squares
 * 等高线提取全部移出主线程，拖动天线 / 改频率 / 改指向时保持球面交互流畅。
 */
self.onmessage = (ev: MessageEvent<PatternRequest>) => {
  const req = ev.data
  const t0 = performance.now()
  const { gainDb, peakDb } = computePatternGrid(
    req.antennas as Antenna[],
    req.frequencyMHz,
    req.theta0Deg,
    req.phi0Deg,
    req.nTheta,
    req.nPhi,
  )
  // 转 Float32 并 transfer，零拷贝回传
  const f32 = Float32Array.from(gainDb)
  const contours: ContourPayload[] = []
  const transfer: Transferable[] = [f32.buffer]
  for (const level of CONTOUR_LEVELS) {
    const set = extractContours(gainDb, req.nTheta, req.nPhi, level, 180)
    const coords = new Float32Array(set.segments.length * 6)
    let k = 0
    for (const s of set.segments) {
      coords.set([s.a[0], s.a[1], s.a[2], s.b[0], s.b[1], s.b[2]], k)
      k += 6
    }
    contours.push({ level, coords })
    transfer.push(coords.buffer)
  }
  const res: PatternResponse = {
    seq: req.seq,
    gainDb: f32,
    nTheta: req.nTheta,
    nPhi: req.nPhi,
    peakDb,
    contours,
    computeMs: performance.now() - t0,
  }
  ;(self as unknown as Worker).postMessage(res, transfer)
}
