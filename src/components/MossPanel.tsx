import { useBonsaiStore } from '../store';
import { Slider } from './controls';

/** 苔藓材质面板 */
export function MossPanel() {
  const moss = useBonsaiStore((s) => s.moss);
  const setMoss = useBonsaiStore((s) => s.setMoss);

  return (
    <div className="panel">
      <h3>苔藓材质</h3>
      <p className="hint">
        程序化噪声生成苔藓覆盖,岩石表面按法线朝上程度分布;湿度驱动颜色与次表面散射强度。
      </p>
      <Slider
        label="湿度"
        value={moss.humidity}
        min={0}
        max={100}
        onChange={(v) => setMoss({ humidity: v })}
      />
      <Slider
        label="覆盖度"
        value={moss.coverage}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setMoss({ coverage: v })}
      />
      <Slider
        label="噪声尺度"
        value={moss.noiseScale}
        min={1}
        max={8}
        step={0.1}
        onChange={(v) => setMoss({ noiseScale: v })}
      />
      <div className="humidity-preview">
        <span>干燥</span>
        <div
          className="humidity-bar"
          style={{
            background: `linear-gradient(to right, #736b2e, #14522a ${moss.humidity}%, #14522a)`,
          }}
        />
        <span>湿润</span>
      </div>
    </div>
  );
}
