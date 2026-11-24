/** 计算内核冒烟测试：node --experimental-strip-types scripts/test-physics.ts */
import { computeBaselines, computePatternGrid, wavelengthM } from '../src/compute/physics.ts'
import { computeProfile } from '../src/compute/profile.ts'
import { extractContours } from '../src/compute/contour.ts'
import { defaultAntennas } from '../src/compute/defaults.ts'

let failures = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures++
    console.error(`  ✗ ${msg}`)
  }
}

// 1. 默认布局基线数
const ants = defaultAntennas()
const bl = computeBaselines(ants)
assert(ants.length === 9, `默认阵列 9 副天线（实际 ${ants.length}）`)
assert(bl.length === 9 * 8 / 2, `基线数 = N(N-1)/2 = 36（实际 ${bl.length}）`)
assert(Math.abs(bl[0].length - Math.hypot(bl[0].dx, bl[0].dy)) < 1e-12, '基线长度 = √(dx²+dy²)')

// 2. ULA：N=8 沿 x，间距 d=1 m，f=150 MHz → λ≈2 m，d=λ/2，HPBW 理论 ≈ 0.886λ/(Nd)
const N = 8
const ula = Array.from({ length: N }, (_, i) => ({ id: i + 1, x: (i - (N - 1) / 2) * 1, y: 0 }))
const fMHz = 150
const lambda = wavelengthM(fMHz)
const { gainDb } = computePatternGrid(ula, fMHz, 0, 0, 73, 128)
const prof = computeProfile(gainDb, 73, 128)
const theoreticalHpbw = ((0.886 * lambda) / (N * 1)) * 180 / Math.PI
assert(prof.hpbwDeg !== null, 'HPBW 可测')
const err = Math.abs((prof.hpbwDeg ?? 0) - theoreticalHpbw) / theoreticalHpbw
assert(err < 0.12, `ULA HPBW ≈ 理论 ${theoreticalHpbw.toFixed(2)}°（实测 ${prof.hpbwDeg?.toFixed(2)}°，偏差 ${(err * 100).toFixed(1)}%）`)
assert(prof.firstSidelobeDb !== null && prof.firstSidelobeDb < -10, `第一旁瓣 < -10 dB（实测 ${prof.firstSidelobeDb?.toFixed(2)} dB）`)

// 3. 频率加倍 → 主瓣宽度近似减半
const g2 = computePatternGrid(ula, fMHz * 2, 0, 0, 73, 128).gainDb
const p2 = computeProfile(g2, 73, 128)
const ratio = (prof.hpbwDeg ?? 1) / (p2.hpbwDeg ?? 1)
assert(Math.abs(ratio - 2) < 0.15, `频率加倍 HPBW 近似减半（比值 ${ratio.toFixed(2)}）`)

// 4. 指向旋转：主瓣恒位于局部天顶（0 dB），且大指向角产生物理性投影展宽
const planar: Array<{ id: number; x: number; y: number }> = []
for (const gx of [-1, 0, 1]) {
  for (const gy of [-1, 0, 1]) {
    planar.push({ id: planar.length + 1, x: gx * 1, y: gy * 1 })
  }
}
const gPlanar0 = computePatternGrid(planar, fMHz, 0, 0, 73, 128).gainDb
const pPlanar0 = computeProfile(gPlanar0, 73, 128)
const gSteered = computePatternGrid(planar, fMHz, 45, 120, 73, 128).gainDb
const pSteered = computeProfile(gSteered, 73, 128)
assert(Math.abs(gSteered[0]) < 1e-9, '任意指向下局部天顶增益恒为 0 dB（主瓣随旋转对准）')
assert(
  pSteered.hpbwDeg !== null && pSteered.hpbwDeg >= (pPlanar0.hpbwDeg ?? 0),
  `45° 指向下面阵剖面 HPBW 不窄于天顶指向（${pPlanar0.hpbwDeg?.toFixed(2)}° → ${pSteered.hpbwDeg?.toFixed(2)}°，投影展宽）`,
)

// 5. 等高线提取：-3 dB 等高线应闭合环绕主瓣（段数 > 0 且集中在小 θ 区）
const c = extractContours(gainDb, 73, 128, -3, 180)
assert(c.segments.length > 20, `-3 dB 等高线段数充足（${c.segments.length} 段）`)
const maxY = Math.max(...c.segments.flatMap((s) => [s.a[1], s.b[1]]))
assert(maxY > 0.9, '等高线位于球面单位半径附近')

// 6. 空阵列不崩溃
const empty = computePatternGrid([], fMHz, 0, 0, 8, 8)
assert(empty.gainDb.every((v) => !Number.isFinite(v)), '空阵列返回 -∞ 增益')

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
