import type { JSX } from 'solid-js';
import { BRUSH_RADII, BRUSH_STRENGTH_MAX, BRUSH_STRENGTH_MIN } from '../../config/constants';
import { setUiStore, uiStore } from '../../store/uiStore';
import { resetTerrain } from '../../store/actions';
import { pushToast } from './toast';
import type { BrushModeName } from '../../types/project';

const MODES: { key: BrushModeName; label: string }[] = [
  { key: 'raise', label: '抬升' },
  { key: 'lower', label: '压低' },
  { key: 'smooth', label: '平滑' },
];

export const BrushPanel = (): JSX.Element => (
  <>
    <div class="panel-section">
      <h3>笔刷工具</h3>
      <div class="seg-group">
        {MODES.map((m) => (
          <button
            class={`seg ${uiStore.brush.mode === m.key ? 'active' : ''}`}
            onClick={() => setUiStore('brush', 'mode', m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>

    <div class="panel-section">
      <h3>笔刷半径（3 档）</h3>
      <div class="seg-group">
        {BRUSH_RADII.map((r, i) => (
          <button
            class={`seg ${uiStore.brush.radiusIdx === i ? 'active' : ''}`}
            onClick={() => setUiStore('brush', 'radiusIdx', i)}
          >
            {['小', '中', '大'][i]}
            <div class="meta">{r} 格</div>
          </button>
        ))}
      </div>
    </div>

    <div class="panel-section">
      <h3>参数</h3>
      <label class="field">
        <span class="field-label">
          <span>作用强度</span>
          <span>{uiStore.brush.strength.toFixed(0)} m/s</span>
        </span>
        <input
          type="range"
          min={BRUSH_STRENGTH_MIN}
          max={BRUSH_STRENGTH_MAX}
          step={1}
          value={uiStore.brush.strength}
          onInput={(e) => setUiStore('brush', 'strength', Number(e.currentTarget.value))}
        />
      </label>
      <label class="field">
        <span class="field-label">
          <span>平滑系数</span>
          <span>{uiStore.brush.smoothFactor.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={uiStore.brush.smoothFactor}
          onInput={(e) => setUiStore('brush', 'smoothFactor', Number(e.currentTarget.value))}
        />
      </label>
      <label class="field">
        <span class="field-label">
          <span>等高距</span>
          <span>{uiStore.brush.contourInterval.toFixed(1)} m</span>
        </span>
        <input
          type="range"
          min={1}
          max={20}
          step={0.5}
          value={uiStore.brush.contourInterval}
          onInput={(e) => setUiStore('brush', 'contourInterval', Number(e.currentTarget.value))}
        />
      </label>
    </div>

    <div class="panel-section">
      <h3>地形初始化</h3>
      <div class="btn-row">
        <button
          class="btn"
          onClick={() => {
            resetTerrain('flat');
            pushToast('已重置为平坦地形', 'success');
          }}
        >
          重置平坦
        </button>
        <button
          class="btn"
          onClick={() => {
            resetTerrain('regenerate');
            pushToast('已重新生成程序化山地', 'success');
          }}
        >
          重新生成
        </button>
      </div>
    </div>

    <div class="panel-section">
      <div class="stat-box">
        <div>网格规格：256 × 256（共 65,536 高度点）</div>
        <div>着色：坡度色带 + 实时等高线</div>
        <div>按住左键拖动即可连续作用，一次拖动记为一步历史</div>
      </div>
    </div>
  </>
);
