<script setup lang="ts">
import AntennaLayout from './components/AntennaLayout.vue'
import ObservationPanel from './components/ObservationPanel.vue'
import PatternView from './components/PatternView.vue'
import ProfileChart from './components/ProfileChart.vue'
import ColorLegend from './components/ColorLegend.vue'
import ExportPanel from './components/ExportPanel.vue'
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>天线阵列波束方向图渲染器</h1>
      <span class="subtitle">Vue 3 · TypeScript · Babylon.js (WebGPU) · Web Worker 采样计算</span>
    </header>

    <main class="layout">
      <aside class="left-col">
        <AntennaLayout />
        <ObservationPanel />
        <ExportPanel />
      </aside>

      <section class="center-col">
        <div class="scene-card">
          <PatternView />
          <div class="legend-overlay">
            <ColorLegend />
          </div>
        </div>
        <div class="profile-card">
          <ProfileChart />
        </div>
      </section>
    </main>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
  --bg: #070b12;
  --panel: #0e1726;
  --border: #1e3049;
  --text: #e6efff;
}
* {
  box-sizing: border-box;
}
html,
body,
#app {
  height: 100%;
  margin: 0;
}
body {
  background: var(--bg);
  color: var(--text);
  font-family:
    'Segoe UI', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
}
</style>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
}
.app-header {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}
.app-header h1 {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  background: linear-gradient(90deg, #8fc1ff, #b79bff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.subtitle {
  font-size: 12px;
  color: #6f86a8;
}
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 12px;
}
.left-col {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;
}
.center-col {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1.55fr) minmax(220px, 1fr);
  gap: 12px;
}
.scene-card,
.profile-card {
  position: relative;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.legend-overlay {
  position: absolute;
  right: 18px;
  bottom: 16px;
  width: 260px;
  padding: 8px 10px;
  background: rgba(9, 15, 26, 0.82);
  border: 1px solid rgba(70, 100, 145, 0.4);
  border-radius: 8px;
  backdrop-filter: blur(4px);
}
:deep(.pattern-view) {
  flex: 1;
}
:deep(.profile-panel) {
  flex: 1;
}

@media (max-width: 1080px) {
  .layout {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .center-col {
    min-height: 720px;
  }
}
</style>
