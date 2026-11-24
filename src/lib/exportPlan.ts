import type { SceneState } from '../types';

/** 布光方案导出：光源位置/强度/色温 + 水体档位 + 白平衡增益打包 JSON */
export function buildExportPayload(state: SceneState): string {
  const payload = {
    schema: 'underwater-lighting-plan/v1',
    version: 1,
    exportedAt: new Date().toISOString(),
    lights: state.lights.map((l) => ({
      id: l.id,
      enabled: l.enabled,
      position: { x: l.position[0], y: l.position[1], z: l.position[2] },
      intensity: l.intensity,
      colorTempKelvin: l.colorTemp,
    })),
    water: {
      preset: state.water.preset,
      depthMeters: state.water.depth,
    },
    whiteBalance: {
      mode: state.whiteBalance.mode,
      gains: state.whiteBalance.manual,
    },
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadPlan(state: SceneState, filename = 'lighting-plan.json') {
  const blob = new Blob([buildExportPayload(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
