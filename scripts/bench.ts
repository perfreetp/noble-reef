/** 性能测量：9344 方向网格在典型规模阵列下的单次计算耗时（worker 内同口径） */
import { computePatternGrid } from '../src/compute/physics.ts'
import { defaultAntennas } from '../src/compute/defaults.ts'
import { computeProfile } from '../src/compute/profile.ts'
import { extractContours } from '../src/compute/contour.ts'

const N_THETA = 73
const N_PHI = 128
const dirs = N_THETA * N_PHI
const ants = defaultAntennas()

// 预热
computePatternGrid(ants, 400, 30, 60, N_THETA, N_PHI)

const t0 = performance.now()
const { gainDb } = computePatternGrid(ants, 400, 30, 60, N_THETA, N_PHI)
const t1 = performance.now()
const prof = computeProfile(gainDb, N_THETA, N_PHI)
const t2 = performance.now()
for (const level of [-3, -10, -20]) extractContours(gainDb, N_THETA, N_PHI, level)
const t3 = performance.now()

console.log(`采样方向数：${dirs}`)
console.log(`方向图内核：${(t1 - t0).toFixed(2)} ms`)
console.log(`剖面分析：  ${(t2 - t1).toFixed(2)} ms（HPBW=${prof.hpbwDeg?.toFixed(2)}°, FSLL=${prof.firstSidelobeDb?.toFixed(2)} dB）`)
console.log(`3 条等高线：${(t3 - t2).toFixed(2)} ms`)
console.log(`合计：      ${(t3 - t0).toFixed(2)} ms（worker 内完成，不阻塞渲染帧）`)
