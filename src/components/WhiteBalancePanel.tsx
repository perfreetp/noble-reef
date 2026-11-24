import { useSceneStore, setWBMode, setManualWBGains, captureAutoAsManual } from '../store';
import { useFrameStats, useLastAutoGains } from '../stats';
import { Slider } from './Slider';

const clampGain = (v: number) => Math.min(4, Math.max(0.25, v));

/** 白平衡面板：自动/手动模式、手动三通道增益、画面 RGB 均值显示 */
export function WhiteBalancePanel() {
  const state = useSceneStore();
  const stats = useFrameStats();
  const autoGains = useLastAutoGains();

  const mean = () => stats().ldrMean;

  const cells = () => [
    { ch: 'R', value: mean().r, color: '#ff7b7b' },
    { ch: 'G', value: mean().g, color: '#7be08a' },
    { ch: 'B', value: mean().b, color: '#7bb8ff' },
  ];

  const setGain = (channel: 'r' | 'g' | 'b', v: number) => {
    setManualWBGains({ ...state.whiteBalance.manual, [channel]: clampGain(v) });
  };

  return (
    <section class="panel">
      <h2>白平衡</h2>

      <div class="seg">
        <button
          classList={{ active: state.whiteBalance.mode === 'auto' }}
          onClick={() => setWBMode('auto')}
        >
          自动
        </button>
        <button
          classList={{ active: state.whiteBalance.mode === 'manual' }}
          onClick={() => setWBMode('manual')}
        >
          手动
        </button>
      </div>

      <div class="mean-grid">
        {cells().map((c) => (
          <div class="mean-cell">
            <div class="ch" style={{ color: c.color }}>
              {c.ch}
            </div>
            <div class="num">{Math.round(c.value * 255)}</div>
            <div class="bar">
              <i style={{ width: `${Math.min(100, c.value * 100)}%`, background: c.color }} />
            </div>
          </div>
        ))}
      </div>
      <div class="hint-inline">数值为当前成片画面各通道均值（0–255），随灯光/水体联动重算。</div>

      {state.whiteBalance.mode === 'manual' ? (
        <>
          <Slider
            label="R 增益"
            value={state.whiteBalance.manual.r}
            min={0.25}
            max={4}
            step={0.01}
            decimals={2}
            onInput={(v) => setGain('r', v)}
          />
          <Slider
            label="G 增益"
            value={state.whiteBalance.manual.g}
            min={0.25}
            max={4}
            step={0.01}
            decimals={2}
            onInput={(v) => setGain('g', v)}
          />
          <Slider
            label="B 增益"
            value={state.whiteBalance.manual.b}
            min={0.25}
            max={4}
            step={0.01}
            decimals={2}
            onInput={(v) => setGain('b', v)}
          />
          <button
            class="secondary"
            style={{ width: '100%', 'margin-top': '6px' }}
            onClick={() => captureAutoAsManual(autoGains())}
          >
            抓取自动增益并转手动
          </button>
          <div class="hint-inline">
            当前自动值：R <span class="gain-tag">{autoGains().r.toFixed(2)}</span>
            G <span class="gain-tag">{autoGains().g.toFixed(2)}</span>
            B <span class="gain-tag">{autoGains().b.toFixed(2)}</span>
          </div>
        </>
      ) : (
        <div class="hint-inline">
          自动模式按画面 HDR 亮度逐通道计算增益并做指数平滑，抵消水体蓝绿色偏。
        </div>
      )}
    </section>
  );
}
