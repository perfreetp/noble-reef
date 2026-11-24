import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ViewerController } from "./viewer/controller";
import { SAMPLES } from "./chem/samples";
import type { ColorScheme } from "./chem/types";

function useController(): ViewerController {
  const [controller] = useState(() => new ViewerController());
  return controller;
}

export default function App() {
  const controller = useController();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsInputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    controller.init(canvasRef.current!).then(() => {
      if (!disposed) setReady(true);
    });
    return () => {
      disposed = true;
      controller.dispose();
    };
  }, [controller]);

  useSyncExternalStore(controller.subscribe, controller.getVersion);
  const s = controller.state;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) controller.addFiles(Array.from(e.dataTransfer.files));
  };

  const exportSettings = () => {
    const json = controller.exportSettings();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mol-view-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">⚛ 分子结构三维观察工具</span>
        <span className="badge">{s.engineType}</span>
        <span className="badge">{s.fps} FPS</span>
        {s.loading && <span className="loading">{s.loading}</span>}
      </header>
      <div className="main">
        <aside className="sidebar">
          <section>
            <h3>结构列表</h3>
            <div className="row">
              <button onClick={() => fileInputRef.current?.click()}>加载文件…</button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xyz,.pdb,.mol,.sdf,.ent"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.length) controller.addFiles(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
            </div>
            <div className="row">
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) controller.addSample(e.target.value);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  添加示例结构…
                </option>
                {SAMPLES.map((s2) => (
                  <option key={s2.id} value={s2.id}>
                    {s2.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mol-list">
              {s.molecules.length === 0 && <div className="hint">支持 XYZ / PDB / MOL / SDF，可拖拽文件到视口</div>}
              {s.molecules.map((m) => (
                <div key={m.id} className="mol-item">
                  <label className="mol-head">
                    <input
                      type="checkbox"
                      checked={m.visible}
                      onChange={(e) => controller.setVisible(m.id, e.target.checked)}
                    />
                    <span className="mol-name" title={m.name}>
                      {m.name}
                    </span>
                    <button className="del" title="移除" onClick={() => controller.removeMolecule(m.id)}>
                      ×
                    </button>
                  </label>
                  <div className="mol-sub">
                    <span>
                      {m.atomCount.toLocaleString()} 原子 / {m.bondCount.toLocaleString()} 键
                    </span>
                  </div>
                  <div className="mol-sub">
                    <select
                      value={m.colorScheme.type}
                      onChange={(e) => {
                        const scheme: ColorScheme =
                          e.target.value === "cpk" ? { type: "cpk" } : { type: "custom", color: "#4fa3ff" };
                        controller.setColorScheme(m.id, scheme);
                      }}
                    >
                      <option value="cpk">CPK 配色</option>
                      <option value="custom">自定义颜色</option>
                    </select>
                    {m.colorScheme.type === "custom" && (
                      <input
                        type="color"
                        value={m.colorScheme.color}
                        onChange={(e) => controller.setColorScheme(m.id, { type: "custom", color: e.target.value })}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3>显示模式</h3>
            <label className="radio">
              <input
                type="radio"
                name="mode"
                checked={s.displayMode === "ballstick"}
                onChange={() => controller.setDisplayMode("ballstick")}
              />
              球棍模型
            </label>
            <label className="radio">
              <input
                type="radio"
                name="mode"
                checked={s.displayMode === "spacefill"}
                onChange={() => controller.setDisplayMode("spacefill")}
              />
              空间填充（范德华半径）
            </label>
          </section>

          <section>
            <h3>氢键</h3>
            <label className="radio">
              <input
                type="checkbox"
                checked={s.hbond.enabled}
                onChange={(e) => controller.setHBondEnabled(e.target.checked)}
              />
              显示氢键（虚线）
            </label>
            {s.hbond.enabled && (
              <>
                <div className="slider-row">
                  <span>距离阈值</span>
                  <input
                    type="range"
                    min={2.4}
                    max={4.0}
                    step={0.05}
                    value={s.hbond.threshold}
                    onChange={(e) => controller.setHBondThreshold(Number(e.target.value))}
                  />
                  <span>{s.hbond.threshold.toFixed(2)} Å</span>
                </div>
                <div className="hint">检测到 {s.hbond.count.toLocaleString()} 条氢键</div>
              </>
            )}
          </section>

          <section>
            <h3>剖切平面</h3>
            <label className="radio">
              <input
                type="checkbox"
                checked={s.clip.enabled}
                onChange={(e) => controller.setClipEnabled(e.target.checked)}
              />
              启用剖切（可拖动平面手柄）
            </label>
            {s.clip.enabled && (
              <>
                <div className="slider-row">
                  <span>位置</span>
                  <input
                    type="range"
                    min={s.clip.dMin}
                    max={s.clip.dMax}
                    step={0.1}
                    value={s.clip.d}
                    onChange={(e) => controller.setClipDistance(Number(e.target.value))}
                  />
                  <span>{s.clip.d.toFixed(1)}</span>
                </div>
                <div className="slider-row">
                  <span>方位角</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={s.clip.yaw}
                    onChange={(e) => controller.setClipOrientation(Number(e.target.value), s.clip.pitch)}
                  />
                  <span>{s.clip.yaw}°</span>
                </div>
                <div className="slider-row">
                  <span>俯仰角</span>
                  <input
                    type="range"
                    min={-90}
                    max={90}
                    step={1}
                    value={s.clip.pitch}
                    onChange={(e) => controller.setClipOrientation(s.clip.yaw, Number(e.target.value))}
                  />
                  <span>{s.clip.pitch}°</span>
                </div>
                <div className="row">
                  <button onClick={() => controller.flipClip()}>翻转方向</button>
                  <button onClick={() => controller.resetClip()}>重置</button>
                </div>
              </>
            )}
          </section>

          <section>
            <h3>视图设置</h3>
            <div className="row">
              <button onClick={exportSettings}>导出设置文件</button>
              <button onClick={() => settingsInputRef.current?.click()}>导入设置…</button>
              <input
                ref={settingsInputRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    try {
                      controller.importSettings(await f.text());
                    } catch (err) {
                      alert(`导入失败: ${err instanceof Error ? err.message : err}`);
                    }
                  }
                  e.target.value = "";
                }}
              />
            </div>
            <div className="hint">保存配色方案、剖切平面、氢键与相机参数</div>
          </section>
        </aside>

        <div className="viewport" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <canvas ref={canvasRef} />
          {!ready && <div className="overlay">正在初始化引擎…</div>}
          {s.error && (
            <div className="error-toast" onClick={() => controller.clearError()}>
              {s.error}（点击关闭）
            </div>
          )}
          {s.selection && (
            <div className="atom-info">
              <div className="atom-info-head">
                <span className="el-badge">{s.selection.element}</span>
                <span>
                  {s.selection.molName} · 原子 #{s.selection.index + 1}
                </span>
                <button className="del" onClick={() => controller.clearSelection()}>
                  ×
                </button>
              </div>
              <div className="atom-pos">
                ({s.selection.x.toFixed(3)}, {s.selection.y.toFixed(3)}, {s.selection.z.toFixed(3)}) Å
              </div>
              <table>
                <thead>
                  <tr>
                    <th>键</th>
                    <th>键级</th>
                    <th>键长 (Å)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.selection.bonds.map((b) => (
                    <tr key={b.index}>
                      <td>
                        {s.selection!.element}–{b.element}
                      </td>
                      <td>{b.order === 1 ? "单" : b.order === 2 ? "双" : "三"}</td>
                      <td>{b.length.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
