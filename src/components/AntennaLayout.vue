<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  addAntenna,
  baselineCount,
  baselines,
  clearAntennas,
  removeAntenna,
  resetLayout,
  state,
  updateAntenna,
} from '../store/store'

const VIEW = 340 // SVG 视口边长 px
const HALF = 80 // 世界坐标半范围（米），总跨度 160 m
const scale = VIEW / (HALF * 2)

const svgRef = ref<SVGSVGElement | null>(null)
const draggingId = ref<number | null>(null)

function toSvg(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x + HALF) * scale, sy: (HALF - y) * scale }
}
function toWorld(sx: number, sy: number): { x: number; y: number } {
  return { x: sx / scale - HALF, y: HALF - sy / scale }
}
function eventToSvg(ev: PointerEvent): { sx: number; sy: number } {
  const rect = svgRef.value!.getBoundingClientRect()
  return {
    sx: ((ev.clientX - rect.left) / rect.width) * VIEW,
    sy: ((ev.clientY - rect.top) / rect.height) * VIEW,
  }
}

const gridTicks = computed(() => {
  const ticks: number[] = []
  for (let v = -HALF; v <= HALF; v += 20) ticks.push(v)
  return ticks
})

const baselineLines = computed(() =>
  baselines.value.map((b) => {
    const a = state.antennas.find((x) => x.id === b.idA)!
    const c = state.antennas.find((x) => x.id === b.idB)!
    const p1 = toSvg(a.x, a.y)
    const p2 = toSvg(c.x, c.y)
    return {
      key: `${b.idA}-${b.idB}`,
      x1: p1.sx,
      y1: p1.sy,
      x2: p2.sx,
      y2: p2.sy,
      mx: (p1.sx + p2.sx) / 2,
      my: (p1.sy + p2.sy) / 2,
      length: b.length,
    }
  }),
)

const antennaMarkers = computed(() =>
  state.antennas.map((a) => {
    const p = toSvg(a.x, a.y)
    return { ...a, sx: p.sx, sy: p.sy }
  }),
)

// —— 指针交互 ——
function onBackgroundPointerDown(ev: PointerEvent) {
  if (ev.button !== 0) return
  const { sx, sy } = eventToSvg(ev)
  const { x, y } = toWorld(sx, sy)
  addAntenna(Number(x.toFixed(3)), Number(y.toFixed(3)))
  const id = state.selectedId
  if (id !== null) startDrag(id, ev)
}

function startDrag(id: number, ev: PointerEvent) {
  ev.stopPropagation()
  state.selectedId = id
  draggingId.value = id
  ;(ev.target as Element).setPointerCapture?.(ev.pointerId)
}

function onPointerMove(ev: PointerEvent) {
  if (draggingId.value === null) return
  const { sx, sy } = eventToSvg(ev)
  const { x, y } = toWorld(
    Math.max(0, Math.min(VIEW, sx)),
    Math.max(0, Math.min(VIEW, sy)),
  )
  updateAntenna(draggingId.value, Number(x.toFixed(3)), Number(y.toFixed(3)))
}

function endDrag() {
  draggingId.value = null
}

function onDelete(id: number, ev: MouseEvent) {
  ev.stopPropagation()
  removeAntenna(id)
}

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(1) : n.toFixed(2)
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2>天线布置</h2>
      <div class="head-actions">
        <button class="btn mini" title="恢复默认 Y 形阵列" @click="resetLayout">重置</button>
        <button class="btn mini danger" title="清空全部天线" @click="clearAntennas">清空</button>
      </div>
    </header>

    <div class="stat-row">
      <span>天线 <b>{{ state.antennas.length }}</b> 副</span>
      <span>基线 <b>{{ baselineCount }}</b> 条</span>
      <label class="check">
        <input type="checkbox" v-model="state.showBaselineLabels" />
        基线长度标注
      </label>
    </div>

    <div class="svg-wrap">
      <svg
        ref="svgRef"
        class="layout-svg"
        :viewBox="`0 0 ${VIEW} ${VIEW}`"
        @pointerdown="onBackgroundPointerDown"
        @pointermove="onPointerMove"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <!-- 网格 -->
        <g class="grid">
          <line
            v-for="t in gridTicks"
            :key="'v' + t"
            :x1="toSvg(t, 0).sx"
            :x2="toSvg(t, 0).sx"
            y1="0"
            :y2="VIEW"
            :class="t === 0 ? 'axis' : ''"
          />
          <line
            v-for="t in gridTicks"
            :key="'h' + t"
            :y1="toSvg(0, t).sy"
            :y2="toSvg(0, t).sy"
            x1="0"
            :x2="VIEW"
            :class="t === 0 ? 'axis' : ''"
          />
        </g>
        <text class="axis-label east" :x="VIEW - 8" :y="toSvg(0, 0).sy - 6">东 E</text>
        <text class="axis-label north" :x="toSvg(0, 0).sx + 6" y="14">北 N</text>

        <!-- 基线 -->
        <g class="baselines">
          <line
            v-for="b in baselineLines"
            :key="b.key"
            :x1="b.x1"
            :y1="b.y1"
            :x2="b.x2"
            :y2="b.y2"
          />
          <g v-if="state.showBaselineLabels">
            <rect
              v-for="b in baselineLines"
              :key="'r' + b.key"
              :x="b.mx - 22"
              :y="b.my - 8"
              width="44"
              height="15"
              rx="3"
              class="label-bg"
            />
            <text
              v-for="b in baselineLines"
              :key="'t' + b.key"
              :x="b.mx"
              :y="b.my + 3.5"
              class="baseline-label"
              text-anchor="middle"
            >
              {{ fmt(b.length) }}m
            </text>
          </g>
        </g>

        <!-- 天线 -->
        <g class="antennas">
          <g
            v-for="a in antennaMarkers"
            :key="a.id"
            :class="['antenna', { selected: state.selectedId === a.id, dragging: draggingId === a.id }]"
            @pointerdown="startDrag(a.id, $event)"
          >
            <circle :cx="a.sx" :cy="a.sy" r="11" class="hit" />
            <circle :cx="a.sx" :cy="a.sy" r="7" class="dot" />
            <text :x="a.sx + 10" :y="a.sy - 9" class="ant-id">#{{ a.id }}</text>
            <text :x="a.sx + 10" :y="a.sy + 4" class="ant-coord">({{ fmt(a.x) }}, {{ fmt(a.y) }})</text>
            <circle
              v-if="state.antennas.length > 1"
              :cx="a.sx + 6"
              :cy="a.sy - 6"
              r="5.5"
              class="del-btn"
              @pointerdown.stop
              @click="onDelete(a.id, $event)"
            >
              <title>删除天线 #{{ a.id }}</title>
            </circle>
            <text
              v-if="state.antennas.length > 1"
              :x="a.sx + 6"
              :y="a.sy - 2.4"
              class="del-x"
              text-anchor="middle"
              @pointerdown.stop
              @click="onDelete(a.id, $event)"
            >×</text>
          </g>
        </g>
      </svg>
    </div>
    <p class="tip">空白处点击添加天线 · 按住圆点拖动改位 · 红点 × 删除 · 单位：米</p>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #e6efff;
}
.head-actions {
  display: flex;
  gap: 6px;
}
.btn {
  background: #1c2a44;
  color: #cfe0ff;
  border: 1px solid #2f4770;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.btn:hover {
  background: #25385c;
}
.btn.mini {
  padding: 3px 9px;
}
.btn.danger {
  border-color: #6e2f3a;
  color: #ffb3bd;
}
.btn.danger:hover {
  background: #3d2028;
}
.stat-row {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12.5px;
  color: #9db4d6;
}
.stat-row b {
  color: #8fc1ff;
  font-size: 14px;
}
.check {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}
.svg-wrap {
  border: 1px solid #22344f;
  border-radius: 10px;
  overflow: hidden;
  background: #0b1220;
}
.layout-svg {
  width: 100%;
  display: block;
  cursor: crosshair;
  user-select: none;
  touch-action: none;
}
.grid line {
  stroke: #1b2c46;
  stroke-width: 0.7;
}
.grid line.axis {
  stroke: #35567f;
  stroke-width: 1.2;
}
.axis-label {
  fill: #7fa3cf;
  font-size: 11px;
}
.baselines line {
  stroke: #3f7fc4;
  stroke-width: 1;
  opacity: 0.75;
}
.label-bg {
  fill: rgba(10, 18, 32, 0.82);
  stroke: #2c4a72;
  stroke-width: 0.6;
}
.baseline-label {
  fill: #9ed0ff;
  font-size: 9.5px;
  pointer-events: none;
}
.antenna .dot {
  fill: #ffb03a;
  stroke: #ffe1a8;
  stroke-width: 1.4;
  cursor: grab;
}
.antenna.selected .dot {
  fill: #ff7a45;
  stroke: #fff;
}
.antenna.dragging .dot {
  cursor: grabbing;
}
.antenna .hit {
  fill: transparent;
  cursor: grab;
}
.ant-id {
  fill: #ffd9a0;
  font-size: 10px;
  pointer-events: none;
}
.ant-coord {
  fill: #86a3c8;
  font-size: 9px;
  pointer-events: none;
}
.del-btn {
  fill: #d43d4e;
  cursor: pointer;
}
.del-btn:hover {
  fill: #ff5566;
}
.del-x {
  fill: #fff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  pointer-events: none;
}
.tip {
  margin: 0;
  font-size: 11px;
  color: #6f86a8;
}
</style>
