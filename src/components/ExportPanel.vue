<script setup lang="ts">
import {
  exportAntennasCsv,
  exportAntennasJson,
  exportPatternCsv,
  exportPatternJson,
  latestPattern,
  state,
} from '../store/store'
import { GRID_N_PHI, GRID_N_THETA } from '../compute/types'
</script>

<template>
  <section class="panel export-panel">
    <header class="panel-head"><h2>数据导出 / 本地存储</h2></header>
    <p class="note">
      布局与观测参数自动保存于浏览器 localStorage；每次天线位置改动都会整体重算基线集合与方向图。
    </p>
    <div class="btn-grid">
      <button class="btn" @click="exportAntennasCsv">天线坐标 CSV</button>
      <button class="btn" @click="exportAntennasJson">天线坐标 JSON</button>
      <button class="btn" :disabled="!latestPattern" @click="exportPatternCsv">
        方向图增益 CSV
      </button>
      <button class="btn" :disabled="!latestPattern" @click="exportPatternJson">
        方向图增益 JSON
      </button>
    </div>
    <div class="meta">
      <span>采样方向 {{ (GRID_N_THETA * GRID_N_PHI).toLocaleString() }} 个（{{ GRID_N_THETA }}×{{ GRID_N_PHI }} θ–φ 网格）</span>
      <span :class="['dot', state.computing ? 'busy' : 'idle']"></span>
      <span>{{ state.computing ? '重算中…' : `上次计算 ${state.lastComputeMs.toFixed(1)} ms` }}</span>
    </div>
  </section>
</template>

<style scoped>
.export-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #e6efff;
}
.note {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: #748db2;
}
.btn-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.btn {
  background: #1c2a44;
  color: #cfe0ff;
  border: 1px solid #2f4770;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12.5px;
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: #25385c;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #7f97bb;
  flex-wrap: wrap;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot.busy {
  background: #ffb03a;
  box-shadow: 0 0 6px #ffb03a;
  animation: pulse 1s infinite;
}
.dot.idle {
  background: #46c46e;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
