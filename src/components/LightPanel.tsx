import { For } from 'solid-js';
import {
  useSceneStore,
  addLight,
  removeLight,
  setLightEnabled,
  setLightIntensity,
  setLightColorTemp,
} from '../store';
import { MAX_LIGHTS, MIN_COLOR_TEMP, MAX_COLOR_TEMP } from '../types';
import { kelvinToSRGB } from '../lib/kelvin';
import { Slider } from './Slider';

/** 光源布置器：最多 4 盏灯，每盏可开关、调强度/色温，并实时显示坐标 */
export function LightPanel() {
  const state = useSceneStore();

  const swatch = (kelvin: number) => {
    const [r, g, b] = kelvinToSRGB(kelvin);
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  };

  return (
    <section class="panel">
      <h2>
        光源布置器
        <span class="count">
          {state.lights.length}/{MAX_LIGHTS}
        </span>
      </h2>

      <For each={state.lights}>
        {(light) => (
          <div class="light-card" classList={{ disabled: !light.enabled }}>
            <div class="light-head">
              <span class="light-swatch" style={{ background: swatch(light.colorTemp) }} />
              <span class="name">补光灯 {light.id + 1}</span>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={light.enabled}
                  onChange={(e) => setLightEnabled(light.id, e.currentTarget.checked)}
                />
                启用
              </label>
              <button class="danger" onClick={() => removeLight(light.id)}>
                删除
              </button>
            </div>

            <Slider
              label="强度"
              value={light.intensity}
              min={0}
              max={1}
              step={0.01}
              decimals={2}
              disabled={!light.enabled}
              onInput={(v) => setLightIntensity(light.id, v)}
            />
            <Slider
              label="色温"
              value={light.colorTemp}
              min={MIN_COLOR_TEMP}
              max={MAX_COLOR_TEMP}
              step={50}
              unit="K"
              disabled={!light.enabled}
              onInput={(v) => setLightColorTemp(light.id, v)}
            />

            <div class="pos-grid">
              <div class="axis">
                <span>X</span>
                {light.position[0].toFixed(2)}
              </div>
              <div class="axis">
                <span>Y</span>
                {light.position[1].toFixed(2)}
              </div>
              <div class="axis">
                <span>Z</span>
                {light.position[2].toFixed(2)}
              </div>
            </div>
            <div class="hint-inline">视口中拖动球体移动；按住 Shift 拖动仅调整高度 Y。</div>
          </div>
        )}
      </For>

      <button
        style={{ width: '100%' }}
        disabled={state.lights.length >= MAX_LIGHTS}
        onClick={() => addLight()}
      >
        + 添加补光灯（最多 {MAX_LIGHTS} 盏）
      </button>
    </section>
  );
}
