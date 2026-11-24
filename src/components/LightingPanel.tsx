import { useBonsaiStore } from '../store';
import { ColorRow, Slider } from './controls';

/** 布光与倒影面板 */
export function LightingPanel() {
  const lighting = useBonsaiStore((s) => s.lighting);
  const setLighting = useBonsaiStore((s) => s.setLighting);

  return (
    <div className="panel">
      <h3>布光与倒影</h3>
      <p className="hint">三点布光(主光 / 补光 / 轮廓光)+ 盆钵水面平面反射(菲涅尔混合)。</p>
      <ColorRow label="主光色" value={lighting.keyColor} onChange={(v) => setLighting({ keyColor: v })} />
      <Slider
        label="主光强度"
        value={lighting.keyIntensity}
        min={0}
        max={6}
        step={0.1}
        onChange={(v) => setLighting({ keyIntensity: v })}
      />
      <ColorRow label="补光色" value={lighting.fillColor} onChange={(v) => setLighting({ fillColor: v })} />
      <Slider
        label="补光强度"
        value={lighting.fillIntensity}
        min={0}
        max={3}
        step={0.1}
        onChange={(v) => setLighting({ fillIntensity: v })}
      />
      <ColorRow label="轮廓光色" value={lighting.rimColor} onChange={(v) => setLighting({ rimColor: v })} />
      <Slider
        label="轮廓光强度"
        value={lighting.rimIntensity}
        min={0}
        max={4}
        step={0.1}
        onChange={(v) => setLighting({ rimIntensity: v })}
      />
      <Slider
        label="环境光"
        value={lighting.ambient}
        min={0}
        max={1.5}
        step={0.05}
        onChange={(v) => setLighting({ ambient: v })}
      />
      <Slider
        label="倒影强度"
        value={lighting.reflectionStrength}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setLighting({ reflectionStrength: v })}
      />
      <Slider
        label="泛光"
        value={lighting.bloom}
        min={0}
        max={1.5}
        step={0.05}
        onChange={(v) => setLighting({ bloom: v })}
      />
    </div>
  );
}
