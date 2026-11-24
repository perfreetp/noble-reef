import { reactive, computed, shallowRef, watch } from 'vue'
import type { Antenna, PatternResponse, Steering } from '../compute/types'
import { GRID_N_PHI, GRID_N_THETA } from '../compute/types'
import { computeBaselines, wavelengthM } from '../compute/physics'
import { computeProfile, type ProfileResult } from '../compute/profile'
import {
  DEFAULT_FREQUENCY_MHZ,
  DEFAULT_PHI0_DEG,
  DEFAULT_THETA0_DEG,
  defaultAntennas,
} from '../compute/defaults'
import PatternWorker from '../compute/pattern.worker.ts?worker'

const STORAGE_KEY = 'array-beam-renderer:v1'

/** 场景句柄：由 Babylon 组件注册，store 通过它做即时旋转 / 重着色 */
export interface SceneHandle {
  setSteering(s: Steering): void
  applyGain(res: PatternResponse): void
}

interface PersistedState {
  antennas: Antenna[]
  frequencyMHz: number
  theta0Deg: number
  phi0Deg: number
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedState
    if (!Array.isArray(parsed.antennas)) return null
    return parsed
  } catch {
    return null
  }
}

const persisted = loadPersisted()

export const state = reactive({
  antennas: (persisted?.antennas ?? defaultAntennas()) as Antenna[],
  frequencyMHz: persisted?.frequencyMHz ?? DEFAULT_FREQUENCY_MHZ,
  theta0Deg: persisted?.theta0Deg ?? DEFAULT_THETA0_DEG,
  phi0Deg: persisted?.phi0Deg ?? DEFAULT_PHI0_DEG,
  /** 3D 视图中是否显示基线连线 */
  showBaselines3d: true,
  /** 2D 布置图中是否标注基线长度 */
  showBaselineLabels: true,
  selectedId: null as number | null,
  computing: false,
  lastComputeMs: 0,
})

/** 最新方向图（shallow，避免 Vue 深度代理大数组） */
export const latestPattern = shallowRef<PatternResponse | null>(null)
export const latestProfile = shallowRef<ProfileResult | null>(null)

export const baselines = computed(() => computeBaselines(state.antennas))
export const baselineCount = computed(() => baselines.value.length)
export const wavelength = computed(() => wavelengthM(state.frequencyMHz))
export const maxBaseline = computed(() =>
  baselines.value.reduce((m, b) => Math.max(m, b.length), 0),
)

// —— worker 调度 ——
const worker = new PatternWorker()
let seq = 0
let scheduleTimer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
let queuedWhileInFlight = false

worker.onmessage = (ev: MessageEvent<PatternResponse>) => {
  const res = ev.data
  // 过期结果（有更新请求在排队）直接丢弃
  inFlight = false
  if (queuedWhileInFlight) {
    queuedWhileInFlight = false
    dispatch()
    return
  }
  if (res.seq !== seq) return
  state.computing = false
  state.lastComputeMs = res.computeMs
  latestPattern.value = res
  latestProfile.value = computeProfile(res.gainDb, res.nTheta, res.nPhi)
  sceneHandle?.applyGain(res)
}

function dispatch() {
  seq += 1
  inFlight = true
  state.computing = true
  worker.postMessage({
    seq,
    antennas: state.antennas.map((a) => ({ ...a })),
    frequencyMHz: state.frequencyMHz,
    theta0Deg: state.theta0Deg,
    phi0Deg: state.phi0Deg,
    nTheta: GRID_N_THETA,
    nPhi: GRID_N_PHI,
  } satisfies import('../compute/types').PatternRequest)
}

/** 防抖重算：天线位置 / 频率 / 指向变更后 100 ms 合并触发 */
export function scheduleRecompute(delayMs = 100) {
  if (scheduleTimer) clearTimeout(scheduleTimer)
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null
    if (inFlight) {
      queuedWhileInFlight = true
    } else {
      dispatch()
    }
  }, delayMs)
}

// —— 场景句柄 ——
let sceneHandle: SceneHandle | null = null
export function registerSceneHandle(h: SceneHandle | null) {
  sceneHandle = h
}

/** 频率变更：波束主瓣宽度与旁瓣结构联动重算 */
export function updateFrequency(mhz: number) {
  state.frequencyMHz = mhz
  scheduleRecompute(100)
}

/** 指向变更：球面即时旋转（无延迟），方向图按防抖节奏重算 */
export function updateSteering(patch: Partial<Steering>) {
  if (patch.theta0Deg !== undefined) state.theta0Deg = patch.theta0Deg
  if (patch.phi0Deg !== undefined) state.phi0Deg = patch.phi0Deg
  sceneHandle?.setSteering({ theta0Deg: state.theta0Deg, phi0Deg: state.phi0Deg })
  scheduleRecompute(100)
}

// —— 天线增删改 ——
let nextId = state.antennas.reduce((m, a) => Math.max(m, a.id), 0) + 1

export function addAntenna(x: number, y: number): Antenna {
  const ant: Antenna = { id: nextId++, x, y }
  state.antennas.push(ant)
  state.selectedId = ant.id
  scheduleRecompute()
  return ant
}

export function updateAntenna(id: number, x: number, y: number) {
  const a = state.antennas.find((v) => v.id === id)
  if (!a) return
  a.x = x
  a.y = y
  scheduleRecompute()
}

export function removeAntenna(id: number) {
  const idx = state.antennas.findIndex((a) => a.id === id)
  if (idx < 0) return
  state.antennas.splice(idx, 1)
  if (state.selectedId === id) state.selectedId = null
  scheduleRecompute()
}

export function clearAntennas() {
  state.antennas.splice(0, state.antennas.length)
  state.selectedId = null
  scheduleRecompute()
}

export function resetLayout() {
  state.antennas.splice(0, state.antennas.length, ...defaultAntennas())
  nextId = state.antennas.reduce((m, a) => Math.max(m, a.id), 0) + 1
  state.selectedId = null
  scheduleRecompute()
}

// —— 本地持久化（300 ms 防抖）——
let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const data: PersistedState = {
      antennas: state.antennas.map((a) => ({ ...a })),
      frequencyMHz: state.frequencyMHz,
      theta0Deg: state.theta0Deg,
      phi0Deg: state.phi0Deg,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* 存储配额不足时静默 */
    }
  }, 300)
}

watch(
  () => [state.antennas, state.frequencyMHz, state.theta0Deg, state.phi0Deg],
  persist,
  { deep: true },
)

// —— 文件导出 ——
function download(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function exportAntennasCsv() {
  const rows = ['id,x_m,y_m']
  for (const a of state.antennas) rows.push(`${a.id},${a.x.toFixed(4)},${a.y.toFixed(4)}`)
  download(`antennas_${timestamp()}.csv`, 'text/csv;charset=utf-8', rows.join('\n'))
}

export function exportAntennasJson() {
  const payload = {
    generatedAt: new Date().toISOString(),
    frequencyMHz: state.frequencyMHz,
    steering: { theta0Deg: state.theta0Deg, phi0Deg: state.phi0Deg },
    antennas: state.antennas,
  }
  download(`antennas_${timestamp()}.json`, 'application/json', JSON.stringify(payload, null, 2))
}

export function exportPatternJson() {
  const p = latestPattern.value
  if (!p) return
  const payload = {
    generatedAt: new Date().toISOString(),
    frequencyMHz: state.frequencyMHz,
    steering: { theta0Deg: state.theta0Deg, phi0Deg: state.phi0Deg },
    nTheta: p.nTheta,
    nPhi: p.nPhi,
    convention: 'theta-major index = i*nPhi + j; theta in [0,180] deg; phi in [0,360) deg',
    gainDb: Array.from(p.gainDb),
  }
  download(`pattern_gain_${timestamp()}.json`, 'application/json', JSON.stringify(payload))
}

export function exportPatternCsv() {
  const p = latestPattern.value
  if (!p) return
  const lines: string[] = ['theta_deg,phi_deg,gain_db']
  const dTheta = 180 / p.nTheta
  const dPhi = 360 / p.nPhi
  for (let i = 0; i < p.nTheta; i++) {
    for (let j = 0; j < p.nPhi; j++) {
      const v = p.gainDb[i * p.nPhi + j]
      lines.push(
        `${(i * dTheta).toFixed(3)},${(j * dPhi).toFixed(3)},${Number.isFinite(v) ? v.toFixed(4) : ''}`,
      )
    }
  }
  download(`pattern_gain_${timestamp()}.csv`, 'text/csv;charset=utf-8', lines.join('\n'))
}

// 首次计算
scheduleRecompute(0)
