<script setup lang="ts">
import { computed } from 'vue'
import {
  baselineCount,
  latestProfile,
  maxBaseline,
  state,
  updateFrequency,
  updateSteering,
  wavelength,
} from '../store/store'

const FREQ_MIN = 50
const FREQ_MAX = 3000

const hpbwText = computed(() => {
  const v = latestProfile.value?.hpbwDeg
  return v === null || v === undefined ? '—' : `${v.toFixed(2)}°`
})
const fsllText = computed(() => {
  const v = latestProfile.value?.firstSidelobeDb
  return v === null || v === undefined ? '—' : `${v.toFixed(2)} dB`
})

/** 瑞利波束宽度估计 ≈ λ/D（弧度），用作数值旁证 */
const rayleighDeg = computed(() => {
  const d = maxBaseline.value
  if (d <= 0) return null
  return ((wavelength.value / d) * 180) / Math.PI
})

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function onFreqInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  updateFrequency(clamp(v, FREQ_MIN, FREQ_MAX))
}
function commitFreq() {
  // 频率变化 → 主瓣宽度 / 旁瓣结构联动重算（store 防抖调度 worker）
  updateFrequency(clamp(Number(state.frequencyMHz) || FREQ_MIN, FREQ_MIN, FREQ_MAX))
}
</script>

<template>
  <section class="panel">
    <header class="panel-head"><h2>观测参数</h2></header>

    <div class="field">
      <div class="field-label">
        <span>观测频率</span>
        <input
          class="num-input"
          type="number"
          :min="FREQ_MIN"
          :max="FREQ_MAX"
          v-model.number="state.frequencyMHz"
          @change="commitFreq"
        />
        <span class="unit">MHz</span>
      </div>
      <input
        class="slider"
        type="range"
        :min="FREQ_MIN"
        :max="FREQ_MAX"
        step="1"
        :value="state.frequencyMHz"
        @input="onFreqInput"
      />
      <div class="sub">波长 λ = <b>{{ wavelength.toFixed(3) }}</b> m</div>
    </div>

    <div class="field">
      <div class="field-label">
        <span>指向天顶角 θ₀</span>
        <input
          class="num-input"
          type="number"
          min="0"
          max="90"
          step="0.5"
          v-model.number="state.theta0Deg"
          @change="updateSteering({ theta0Deg: clamp(Number(state.theta0Deg) || 0, 0, 90) })"
        />
        <span class="unit">°</span>
      </div>
      <input
        class="slider"
        type="range"
        min="0"
        max="90"
        step="0.5"
        :value="state.theta0Deg"
        @input="updateSteering({ theta0Deg: Number(($event.target as HTMLInputElement).value) })"
      />
      <div class="sub">0° = 天顶，球面主瓣实时旋转</div>
    </div>

    <div class="field">
      <div class="field-label">
        <span>指向方位角 φ₀</span>
        <input
          class="num-input"
          type="number"
          min="0"
          max="360"
          step="1"
          v-model.number="state.phi0Deg"
          @change="updateSteering({ phi0Deg: ((Number(state.phi0Deg) % 360) + 360) % 360 })"
        />
        <span class="unit">°</span>
      </div>
      <input
        class="slider"
        type="range"
        min="0"
        max="360"
        step="1"
        :value="state.phi0Deg"
        @input="updateSteering({ phi0Deg: Number(($event.target as HTMLInputElement).value) })"
      />
      <div class="sub">自东向北计量（东 0° → 北 90°）</div>
    </div>

    <div class="metrics">
      <div class="metric">
        <span class="m-label">主瓣宽度 HPBW</span>
        <span class="m-value">{{ hpbwText }}</span>
      </div>
      <div class="metric">
        <span class="m-label">第一旁瓣电平</span>
        <span class="m-value">{{ fsllText }}</span>
      </div>
      <div class="metric">
        <span class="m-label">基线数 / 最长基线</span>
        <span class="m-value">{{ baselineCount }} · {{ maxBaseline.toFixed(1) }} m</span>
      </div>
      <div class="metric" v-if="rayleighDeg !== null">
        <span class="m-label">λ/D 瑞利估计</span>
        <span class="m-value">{{ rayleighDeg.toFixed(2) }}°</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #e6efff;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #bcd0ee;
}
.num-input {
  width: 82px;
  margin-left: auto;
  background: #101c30;
  border: 1px solid #2c4468;
  border-radius: 6px;
  color: #e6efff;
  padding: 4px 8px;
  font-size: 13px;
}
.unit {
  font-size: 12px;
  color: #7f97bb;
  width: 30px;
}
.slider {
  width: 100%;
  accent-color: #4f93e8;
}
.sub {
  font-size: 11.5px;
  color: #748db2;
}
.sub b {
  color: #9cc2ff;
}
.metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 2px;
}
.metric {
  background: #101b2e;
  border: 1px solid #223754;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.m-label {
  font-size: 11px;
  color: #7f97bb;
}
.m-value {
  font-size: 15px;
  font-weight: 600;
  color: #8fc1ff;
}
</style>
