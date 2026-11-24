import { useSceneStore, setWaterPreset, setWaterDepth } from '../store';
import { WATER_PRESETS, effectiveAbsorption, effectiveBackscatterDensity } from '../lib/water';
import type { WaterPreset } from '../types';
import { Slider } from './Slider';

const PRESET_ORDER: WaterPreset[] = ['clear', 'coastal', 'murky'];

/** 水体吸收模型：三档预设 + 水深联动，展示当前 RGB 吸收系数 */
export function WaterPanel() {
  const state = useSceneStore();

  const absorption = () => effectiveAbsorption(state.water.preset, state.water.depth);
  const bsDensity = () => effectiveBackscatterDensity(state.water.preset, state.water.depth);

  return (
    <section class="panel">
      <h2>水体吸收模型</h2>

      <div class="seg">
        {PRESET_ORDER.map((key) => (
          <button
            classList={{ active: state.water.preset === key }}
            onClick={() => setWaterPreset(key)}
          >
            {WATER_PRESETS[key].label}
          </button>
        ))}
      </div>

      <Slider
        label="水深"
        value={state.water.depth}
        min={1}
        max={60}
        step={1}
        unit="m"
        onInput={setWaterDepth}
      />

      <table class="coef-table">
        <tbody>
          <tr>
            <td>红光吸收系数 (1/m)</td>
            <td style={{ color: '#ff7b7b' }}>{absorption().r.toFixed(3)}</td>
          </tr>
          <tr>
            <td>绿光吸收系数 (1/m)</td>
            <td style={{ color: '#7be08a' }}>{absorption().g.toFixed(3)}</td>
          </tr>
          <tr>
            <td>蓝光吸收系数 (1/m)</td>
            <td style={{ color: '#7bb8ff' }}>{absorption().b.toFixed(3)}</td>
          </tr>
          <tr>
            <td>后向散射密度 (1/m)</td>
            <td>{bsDensity().toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
      <div class="hint-inline">红光衰减最快，光程越长物体越偏蓝绿；吸收系数随水深按比例增强。</div>
    </section>
  );
}
