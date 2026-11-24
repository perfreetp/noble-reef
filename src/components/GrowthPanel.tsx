import { useBonsaiStore } from '../store';
import { Slider } from './controls';

/** 枝叶生长参数面板 */
export function GrowthPanel() {
  const growth = useBonsaiStore((s) => s.growth);
  const setGrowth = useBonsaiStore((s) => s.setGrowth);

  return (
    <div className="panel">
      <h3>枝叶生长参数</h3>
      <p className="hint">改动后整树细枝实例缓冲会立即重建(约 2000 根,毫秒级完成)。</p>
      <Slider
        label="分枝角度"
        value={growth.branchAngle}
        min={10}
        max={80}
        unit="°"
        onChange={(v) => setGrowth({ branchAngle: v })}
      />
      <Slider
        label="节间距"
        value={growth.internodeSpacing}
        min={0.2}
        max={1.2}
        step={0.05}
        onChange={(v) => setGrowth({ internodeSpacing: v })}
      />
      <Slider
        label="叶片密度"
        value={growth.leafDensity}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setGrowth({ leafDensity: v })}
      />
      <Slider
        label="细枝数量"
        value={growth.twigBudget}
        min={200}
        max={4000}
        step={100}
        onChange={(v) => setGrowth({ twigBudget: v })}
      />
      <Slider
        label="随机种子"
        value={growth.seed}
        min={1}
        max={99999999}
        onChange={(v) => setGrowth({ seed: v })}
      />
      <div className="button-row">
        <button onClick={() => setGrowth({ seed: Math.floor(Math.random() * 1e8) })}>
          🎲 随机换个形态
        </button>
      </div>
    </div>
  );
}
