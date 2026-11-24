import React, { useMemo, useState } from 'react';
import { CrownEngine } from '../engine/CrownEngine';
import { FeatherParams, GAP_WARN_MM, MAX_SEGMENTS, TEXTURE_COUNT } from '../engine/types';
import { makeFeatherCanvas } from '../engine/featherTextures';
import { GLOSS_LABELS } from '../engine/featherMaterial';

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  warn?: boolean;
  onChange: (v: number) => void;
}) {
  const { label, value, min, max, step = 0.01, unit = '', warn } = props;
  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
      <span className={`slider-value ${warn ? 'warn-text' : ''}`}>
        {value.toFixed(step >= 1 ? 0 : 2)}
        {unit}
      </span>
    </label>
  );
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- 模块一:羽枝库 ----------

export function FeatherLibraryPanel({ engine }: { engine: CrownEngine }) {
  const sel = engine.selectedId !== null ? engine.getFeather(engine.selectedId) : null;
  const [tpl, setTpl] = useState({ textureIndex: 0, density: 0.85, grainDir: 0, length: 42, width: 13, curvature: 0.25, segments: 48 });

  const thumbs = useMemo(
    () => Array.from({ length: TEXTURE_COUNT }, (_, i) => makeFeatherCanvas(i, 0.85, 0).toDataURL()),
    [],
  );

  const apply = (patch: Partial<FeatherParams>) => {
    setTpl((t) => ({ ...t, ...patch }));
    if (engine.selectedId !== null) engine.updateFeather(engine.selectedId, patch);
  };

  const cur = (k: keyof typeof tpl) => (sel ? (sel[k] as number) : tpl[k]);

  return (
    <div className="panel">
      <h3>翠羽条纹 · 24 种</h3>
      <div className="thumb-grid">
        {thumbs.map((src, i) => (
          <img
            key={i}
            src={src}
            className={`thumb ${cur('textureIndex') === i ? 'active' : ''}`}
            title={`纹理 ${i + 1}`}
            onClick={() => apply({ textureIndex: i })}
          />
        ))}
      </div>
      <h3>纤维参数 {sel ? `(羽枝 #${sel.id})` : '(新羽枝模板)'}</h3>
      <Slider label="纤维密度" value={cur('density')} min={0.3} max={1.5} onChange={(v) => apply({ density: v })} />
      <Slider label="丝理走向" value={cur('grainDir')} min={-1} max={1} onChange={(v) => apply({ grainDir: v })} />
      <Slider label="长度" value={cur('length')} min={10} max={90} step={1} unit="mm" onChange={(v) => apply({ length: v })} />
      <Slider label="宽度" value={cur('width')} min={4} max={30} step={1} unit="mm" onChange={(v) => apply({ width: v })} />
      <Slider label="弯曲度" value={cur('curvature')} min={-1} max={1} onChange={(v) => apply({ curvature: v })} />
      <Slider label="细分段数" value={cur('segments')} min={4} max={MAX_SEGMENTS} step={1} onChange={(v) => apply({ segments: v })} />
      <div className="btn-row">
        <button onClick={() => engine.addFeather({ ...tpl })}>添加羽枝</button>
        <button className="ghost" onClick={() => engine.spawnStressTest()}>
          200 根 × 64 段压测
        </button>
      </div>
      <p className="hint">点击纹理编号应用到选中羽枝;未选中时作为新羽枝模板。</p>
    </div>
  );
}

// ---------- 模块二:冠体装配 ----------

export function AssemblyPanel({ engine }: { engine: CrownEngine }) {
  const sel = engine.selectedId !== null ? engine.getFeather(engine.selectedId) : null;
  if (!sel) {
    return (
      <div className="panel">
        <h3>冠体装配</h3>
        <p className="hint">在视口中点击一根羽枝选中它,然后:</p>
        <ul className="hint-list">
          <li>拖动羽枝 — 沿冠梁/冠面移动,自动贴合弧度</li>
          <li>[ / ] — 绕冠面法线旋转</li>
          <li>M — 镜像</li>
          <li>Delete — 删除</li>
        </ul>
        <p className="hint">光标落在冠面上时,实时显示贴合法线箭头与最近羽枝的间隙;间隙超过 {GAP_WARN_MM}mm 标红。</p>
      </div>
    );
  }
  const up = (patch: Partial<FeatherParams>) => engine.updateFeather(sel.id, patch);
  const gapWarn = sel.gap > GAP_WARN_MM;
  return (
    <div className="panel">
      <h3>冠体装配 · 羽枝 #{sel.id}</h3>
      <Slider label="冠梁位置 u" value={sel.u} min={0.02} max={0.98} onChange={(v) => up({ u: v })} />
      <Slider label="冠面高度 v" value={sel.v} min={0.05} max={0.98} onChange={(v) => up({ v: v })} />
      <Slider
        label="旋转"
        value={(sel.rotation * 180) / Math.PI}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(v) => up({ rotation: (v * Math.PI) / 180 })}
      />
      <Slider label="贴合间隙" value={sel.gap} min={0} max={1.5} unit="mm" warn={gapWarn} onChange={(v) => up({ gap: v })} />
      {gapWarn && <p className="warn-text">⚠ 间隙 {sel.gap.toFixed(2)}mm 超过 {GAP_WARN_MM}mm 阈值</p>}
      <div className="btn-row">
        <button onClick={() => up({ mirrored: !sel.mirrored })}>{sel.mirrored ? '取消镜像' : '镜像'}</button>
        <button className="danger" onClick={() => engine.removeFeather(sel.id)}>
          删除
        </button>
      </div>
      <p className="hint">视口中直接拖动羽枝可沿冠面移动;拖动时间隙与法线实时显示。</p>
    </div>
  );
}

// ---------- 模块三:羽光调校 ----------

export function LightPanel({ engine }: { engine: CrownEngine }) {
  const sel = engine.selectedId !== null ? engine.getFeather(engine.selectedId) : null;
  const L = engine.light;
  return (
    <div className="panel">
      <h3>光源</h3>
      <Slider label="方位角" value={L.azimuth} min={0} max={360} step={1} unit="°" onChange={(v) => engine.setLight({ azimuth: v })} />
      <Slider label="俯仰角" value={L.elevation} min={-10} max={90} step={1} unit="°" onChange={(v) => engine.setLight({ elevation: v })} />
      <Slider label="强度" value={L.intensity} min={0} max={3} onChange={(v) => engine.setLight({ intensity: v })} />
      <p className="hint">视口中按住 Alt 拖动可连续调整光源方位与俯仰。</p>
      <h3>翠羽光学 {sel ? `(羽枝 #${sel.id})` : ''}</h3>
      {sel ? (
        <>
          <Slider
            label="纤维方向角"
            value={(sel.fiberAngle * 180) / Math.PI}
            min={-90}
            max={90}
            step={1}
            unit="°"
            onChange={(v) => engine.updateFeather(sel.id, { fiberAngle: (v * Math.PI) / 180 })}
          />
          <Slider
            label="虹彩偏移色相"
            value={sel.hueShift}
            min={-0.5}
            max={0.5}
            onChange={(v) => engine.updateFeather(sel.id, { hueShift: v })}
          />
          <div className="slider-row">
            <span className="slider-label">光泽锐度</span>
            <div className="seg-btns">
              {GLOSS_LABELS.map((name, i) => (
                <button
                  key={name}
                  className={sel.glossLevel === i ? 'active' : ''}
                  onClick={() => engine.updateFeather(sel.id, { glossLevel: i as 0 | 1 | 2 })}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="hint">选中一根羽枝后调校纤维方向角、虹彩色相与光泽锐度。</p>
      )}
    </div>
  );
}

// ---------- 模块四:成片导出 ----------

export function ExportPanel({ engine }: { engine: CrownEngine }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const doPNG = async () => {
    setBusy(true);
    setStatus('离屏渲染中…');
    try {
      const blob = await engine.exportPNG(2);
      download(blob, `diancui-crown-${Date.now()}.png`);
      setStatus(`已导出 2x PNG(${(blob.size / 1024).toFixed(0)} KB)`);
    } catch (err) {
      setStatus(`导出失败:${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const doJSON = () => {
    const blob = new Blob([engine.exportJSON()], { type: 'application/json' });
    download(blob, `diancui-config-${Date.now()}.json`);
    setStatus('已导出羽枝配置 JSON');
  };

  const doImport = (file: File) => {
    file.text().then((text) => {
      const r = engine.importJSON(text);
      setStatus(r.message);
    });
  };

  return (
    <div className="panel">
      <h3>成片导出</h3>
      <div className="btn-col">
        <button disabled={busy} onClick={doPNG}>
          导出 2x 分辨率 PNG
        </button>
        <button disabled={busy} onClick={doJSON}>
          导出羽枝配置 JSON
        </button>
        <label className="file-btn">
          回读配置 JSON
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {status && <p className="status">{status}</p>}
      <p className="hint">
        PNG 以 2 倍分辨率离屏渲染;配置 JSON 记录全部羽枝参数与光源方位/俯仰/强度,回读后羽光参数与导出时一致。
      </p>
    </div>
  );
}
