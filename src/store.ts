import { createStore, produce } from 'solid-js/store';
import { DEFAULT_STATE, MAX_LIGHTS, MIN_COLOR_TEMP, MAX_COLOR_TEMP } from './types';
import type { LightState, SceneState, WBGains, WaterPreset, WhiteBalanceMode } from './types';

/**
 * 全局场景状态。Solid store 细粒度响应：
 * 拖动时只更新 position 字段，3D 引擎通过 createEffect 订阅具体路径，
 * 不会因为其它字段变化而触发整树重算。
 */
const [state, setState] = createStore<SceneState>(structuredClone(DEFAULT_STATE));

export function useSceneStore() {
  return state;
}

export function setLightPosition(id: number, position: [number, number, number]) {
  const idx = state.lights.findIndex((l) => l.id === id);
  if (idx >= 0) setState('lights', idx, 'position', position);
}

export function setLightIntensity(id: number, intensity: number) {
  const idx = state.lights.findIndex((l) => l.id === id);
  if (idx >= 0) setState('lights', idx, 'intensity', Math.min(1, Math.max(0, intensity)));
}

export function setLightColorTemp(id: number, colorTemp: number) {
  const idx = state.lights.findIndex((l) => l.id === id);
  if (idx >= 0)
    setState('lights', idx, 'colorTemp', Math.min(MAX_COLOR_TEMP, Math.max(MIN_COLOR_TEMP, colorTemp)));
}

export function setLightEnabled(id: number, enabled: boolean) {
  const idx = state.lights.findIndex((l) => l.id === id);
  if (idx >= 0) setState('lights', idx, 'enabled', enabled);
}

/** 添加一盏灯，最多 MAX_LIGHTS 盏 */
export function addLight(): LightState | null {
  if (state.lights.length >= MAX_LIGHTS) return null;
  const id = state.lights.reduce((max, l) => Math.max(max, l.id), -1) + 1;
  const angle = (id * Math.PI) / 2.6;
  const light: LightState = {
    id,
    enabled: true,
    position: [Math.cos(angle) * 1.8, 1.2 + (id % 2) * 0.5, Math.sin(angle) * 1.6 + 0.6],
    intensity: 0.6,
    colorTemp: 5500,
  };
  setState('lights', (ls) => [...ls, light]);
  return light;
}

export function removeLight(id: number) {
  setState(
    'lights',
    produce((ls) => {
      const idx = ls.findIndex((l) => l.id === id);
      if (idx >= 0) ls.splice(idx, 1);
    }),
  );
}

export function setWaterPreset(preset: WaterPreset) {
  setState('water', 'preset', preset);
}

export function setWaterDepth(depth: number) {
  setState('water', 'depth', Math.min(60, Math.max(1, depth)));
}

export function setWBMode(mode: WhiteBalanceMode) {
  setState('whiteBalance', 'mode', mode);
}

export function setManualWBGains(gains: WBGains) {
  setState('whiteBalance', 'manual', gains);
}

/** 把当前自动白平衡计算结果固化为手动增益 */
export function captureAutoAsManual(gains: WBGains) {
  setState('whiteBalance', { mode: 'manual', manual: { ...gains } });
}

export function resetScene() {
  setState(structuredClone(DEFAULT_STATE));
}

export function importScene(json: string): SceneState {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (parsed.version !== 1 || !Array.isArray(parsed.lights))
    throw new Error('无效的布光方案文件');
  const raw = parsed as unknown as {
    version: number;
    lights: Array<Record<string, unknown>>;
    water?: SceneState['water'] & { depthMeters?: number };
    whiteBalance?: SceneState['whiteBalance'] & { gains?: WBGains };
  };
  if (raw.lights.length > MAX_LIGHTS) throw new Error(`灯数量超过上限 ${MAX_LIGHTS}`);

  // 归一化：兼容导出文件的外部字段名（colorTempKelvin / position 对象）
  const lights: LightState[] = raw.lights.map((l, i) => {
    const pos = l.position as unknown;
    const position: [number, number, number] = Array.isArray(pos)
      ? [Number(pos[0]), Number(pos[1]), Number(pos[2])]
      : (() => {
          const p = (pos ?? {}) as { x?: number; y?: number; z?: number };
          return [Number(p.x ?? 0), Number(p.y ?? 0), Number(p.z ?? 0)];
        })();
    const colorTemp = Number(
      (l.colorTemp as number | undefined) ??
        (l.colorTempKelvin as number | undefined) ??
        5500,
    );
    return {
      id: typeof l.id === 'number' ? l.id : i,
      enabled: l.enabled !== false,
      position,
      intensity: Number(l.intensity ?? 0.6),
      colorTemp,
    };
  });

  const water = raw.water ?? DEFAULT_STATE.water;
  const wb = (raw.whiteBalance ?? DEFAULT_STATE.whiteBalance) as SceneState['whiteBalance'] & {
    gains?: WBGains;
  };
  const normalized: SceneState = {
    version: 1,
    lights,
    water: {
      preset: water.preset,
      depth: Number(water.depth ?? (water as { depthMeters?: number }).depthMeters ?? 10),
    },
    whiteBalance: {
      mode: wb.mode === 'manual' ? 'manual' : 'auto',
      manual: wb.manual ?? wb.gains ?? { r: 1, g: 1, b: 1 },
    },
  };
  setState(structuredClone(normalized));
  return normalized;
}
