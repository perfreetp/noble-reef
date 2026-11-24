<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BeamScene } from '../babylon/beamScene'
import {
  latestPattern,
  registerSceneHandle,
  state,
} from '../store/store'
import { GRID_N_PHI, GRID_N_THETA } from '../compute/types'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const engineMode = ref<string>('初始化中…')
let scene: BeamScene | null = null

onMounted(async () => {
  if (!canvasRef.value) return
  scene = await BeamScene.Create(canvasRef.value, GRID_N_THETA, GRID_N_PHI)
  engineMode.value = scene.engineMode === 'webgpu' ? 'WebGPU' : 'WebGL2（回退）'
  scene.setSteering({ theta0Deg: state.theta0Deg, phi0Deg: state.phi0Deg })
  scene.updateAntennas(state.antennas, state.showBaselines3d)
  if (latestPattern.value) scene.applyGain(latestPattern.value)
  registerSceneHandle({
    setSteering: (s) => scene?.setSteering(s),
    applyGain: (res) => scene?.applyGain(res),
  })
})

watch(
  () => state.antennas,
  () => scene?.updateAntennas(state.antennas, state.showBaselines3d),
  { deep: true },
)
watch(
  () => state.showBaselines3d,
  () => scene?.updateAntennas(state.antennas, state.showBaselines3d),
)

onBeforeUnmount(() => {
  registerSceneHandle(null)
  scene?.dispose()
  scene = null
})
</script>

<template>
  <div class="pattern-view">
    <canvas ref="canvasRef" class="render-canvas"></canvas>
    <div class="engine-badge">引擎：{{ engineMode }}</div>
    <div class="view-hint">左键旋转 · 滚轮缩放 · 右键平移</div>
  </div>
</template>

<style scoped>
.pattern-view {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: #090d13;
  border-radius: 10px;
  overflow: hidden;
}
.render-canvas {
  width: 100%;
  height: 100%;
  display: block;
  outline: none;
  touch-action: none;
}
.engine-badge {
  position: absolute;
  top: 10px;
  left: 12px;
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 999px;
  background: rgba(20, 30, 48, 0.82);
  border: 1px solid rgba(120, 170, 255, 0.35);
  color: #9cc2ff;
  pointer-events: none;
}
.view-hint {
  position: absolute;
  bottom: 10px;
  left: 12px;
  font-size: 11px;
  color: rgba(210, 225, 250, 0.55);
  pointer-events: none;
}
</style>
