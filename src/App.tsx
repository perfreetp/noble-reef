import { useEffect, useRef, useState } from 'react';
import {
  LIGHT_LABELS,
  LightPreset,
  SceneManager,
  Snapshot,
  Tool,
} from './three/SceneManager';
import { PlateKind, PLATE_LABELS } from './three/plates';
import { HEAD_LABELS, HeadSize } from './three/sauce';

const SAUCE_COLORS = [
  { name: '墨鱼汁', value: '#1c1a1e' },
  { name: '甜菜红', value: '#8e1f3c' },
  { name: '罗勒绿', value: '#3e6b34' },
  { name: '南瓜橙', value: '#d97a26' },
  { name: '芒果黄', value: '#e8b93c' },
  { name: '蓝莓紫', value: '#4a3a6e' },
  { name: '白酱', value: '#efe6d4' },
  { name: '巧克力', value: '#4a2c1a' },
];

const PLATES: PlateKind[] = ['flat', 'bowl', 'slanted'];
const LIGHTS: LightPreset[] = ['top', 'rim', 'warm'];
const HEADS: HeadSize[] = ['thin', 'medium', 'thick'];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mgrRef = useRef<SceneManager | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    const mgr = new SceneManager(canvasRef.current!, setSnap);
    mgrRef.current = mgr;
    return () => mgr.dispose();
  }, []);

  const mgr = () => mgrRef.current!;
  const selected = snap?.paths.find((p) => p.id === snap.selectedId) ?? null;

  return (
    <div className="app">
      {/* 顶部:灯光预设 + 器型 + 工具 + 导出 */}
      <header className="topbar">
        <span className="brand">酱汁摆盘</span>
        <div className="group">
          <span className="label">灯光</span>
          {LIGHTS.map((l) => (
            <button
              key={l}
              className={snap?.light === l ? 'active' : ''}
              onClick={() => mgr().setLight(l)}
            >
              {LIGHT_LABELS[l]}
            </button>
          ))}
        </div>
        <div className="group">
          <span className="label">器型</span>
          {PLATES.map((p) => (
            <button
              key={p}
              className={snap?.plate === p ? 'active' : ''}
              onClick={() => mgr().setPlate(p)}
            >
              {PLATE_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="group">
          <span className="label">模式</span>
          {(['draw', 'select'] as Tool[]).map((t) => (
            <button
              key={t}
              className={snap?.tool === t ? 'active' : ''}
              onClick={() => mgr().setTool(t)}
            >
              {t === 'draw' ? '挤出' : '选择'}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="count">
          {snap?.paths.length ?? 0}/{snap?.maxPaths ?? 24} 条
        </span>
        <button className="export" onClick={() => mgr().exportPNG()}>
          导出 PNG
        </button>
      </header>

      <div className="main">
        {/* 左侧:酱汁材质面板 */}
        <aside className="panel left">
          <h2>酱汁材质</h2>
          <div className="section">
            <div className="label">颜色{selected ? '(应用到选中)' : ''}</div>
            <div className="swatches">
              {SAUCE_COLORS.map((c) => (
                <button
                  key={c.value}
                  title={c.name}
                  className={`swatch ${snap?.color === c.value ? 'active' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => mgr().setMaterialPrefs({ color: c.value })}
                />
              ))}
            </div>
            <input
              type="color"
              value={snap?.color ?? '#7a1f2b'}
              onChange={(e) => mgr().setMaterialPrefs({ color: e.target.value })}
            />
          </div>
          <div className="section">
            <div className="label">
              粘稠度 <b>{snap?.viscosity.toFixed(2)}</b>
            </div>
            <input
              type="range"
              min={0.2}
              max={2.0}
              step={0.05}
              value={snap?.viscosity ?? 1}
              onChange={(e) => mgr().setMaterialPrefs({ viscosity: Number(e.target.value) })}
            />
            <div className="hint">越高流动越慢、边缘越圆润、高光越强</div>
          </div>
          <div className="section">
            <div className="label">挤出头</div>
            <div className="heads">
              {HEADS.map((h) => (
                <button
                  key={h}
                  className={snap?.head === h ? 'active' : ''}
                  onClick={() => mgr().setMaterialPrefs({ head: h })}
                >
                  {HEAD_LABELS[h]}
                </button>
              ))}
            </div>
          </div>
          <div className="section help">
            <div className="label">操作</div>
            <ul>
              <li>点击盘面开始挤出</li>
              <li>按住拖动勾线,松开可续画</li>
              <li>双击 / Enter 收尾,Esc 取消</li>
              <li>选择模式下点击酱汁选中并拖动</li>
              <li>右键拖动旋转视角,滚轮缩放</li>
            </ul>
          </div>
        </aside>

        {/* 中间:3D 画布 */}
        <div className="viewport">
          <canvas ref={canvasRef} />
          {snap?.drawing && <div className="badge">挤出中… 双击或 Enter 收尾</div>}
        </div>

        {/* 右侧:路径列表 */}
        <aside className="panel right">
          <h2>路径列表</h2>
          <div className="pathlist">
            {snap?.paths.length === 0 && <div className="empty">还没有酱汁,在盘面上点击开始挤出</div>}
            {snap?.paths.map((p, i) => (
              <div
                key={p.id}
                className={`pathitem ${snap.selectedId === p.id ? 'active' : ''}`}
                onClick={() => mgr().selectPath(snap.selectedId === p.id ? null : p.id)}
              >
                <span className="dot" style={{ background: p.color }} />
                <span className="name">
                  {i + 1}. {p.name}
                </span>
                <span className="meta">
                  {HEAD_LABELS[p.width]} · η{p.viscosity.toFixed(1)}
                </span>
                <button
                  className="del"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    mgr().deletePath(p.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {selected && (
            <div className="section transform">
              <div className="label">选中:{selected.name}</div>
              <div className="row">
                <span>旋转</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={Math.round((selected.transform.rot * 180) / Math.PI)}
                  onChange={(e) =>
                    mgr().setSelectedTransform({ rot: (Number(e.target.value) * Math.PI) / 180 })
                  }
                />
                <b>{Math.round((selected.transform.rot * 180) / Math.PI)}°</b>
              </div>
              <div className="row">
                <span>缩放</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.01}
                  value={selected.transform.scale}
                  onChange={(e) => mgr().setSelectedTransform({ scale: Number(e.target.value) })}
                />
                <b>{selected.transform.scale.toFixed(2)}×</b>
              </div>
              <div className="row btns">
                <button onClick={() => mgr().setSelectedTransform({ rot: 0, scale: 1, x: 0, z: 0 })}>
                  重置变换
                </button>
                <button className="danger" onClick={() => mgr().deletePath(selected.id)}>
                  删除路径
                </button>
              </div>
              <div className="hint">在「选择」模式下可直接拖动该路径整体移动</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
