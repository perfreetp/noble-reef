<script setup lang="ts">
import { DB_CEIL, DB_FLOOR } from '../compute/colormap'

const stops: number[] = [0, -3, -7, -12, -18, -25, -35, -45]
const cssFor = (db: number): string => {
  // 与 colormap LUT 保持一致的轻量复算（仅用于图例渐变）
  const map: Record<number, string> = {
    0: '#fffff5',
    '-3': '#f59128',
    '-7': '#f5dc46',
    '-12': '#82d75f',
    '-18': '#28beaa',
    '-25': '#1e82be',
    '-35': '#163a80',
    '-45': '#081038',
  }
  return map[db]
}
void DB_CEIL
void DB_FLOOR
</script>

<template>
  <div class="legend">
    <div class="bar">
      <span v-for="db in stops" :key="db" class="seg" :style="{ background: cssFor(db) }" />
    </div>
    <div class="ticks">
      <span v-for="db in stops" :key="'t' + db">{{ db }}</span>
    </div>
    <div class="legend-title">归一化增益 (dB) · 白线 −3 dB · 黄线 −10 dB · 橙线 −20 dB</div>
  </div>
</template>

<style scoped>
.legend {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
}
.bar {
  display: flex;
  height: 12px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #2a4060;
}
.seg {
  flex: 1;
}
.ticks {
  display: flex;
  justify-content: space-between;
  font-size: 9.5px;
  color: #7f97bb;
  font-family: ui-monospace, monospace;
}
.legend-title {
  font-size: 10.5px;
  color: #6f86a8;
}
</style>
