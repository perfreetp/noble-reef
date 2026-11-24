import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CrownEngine, HudInfo } from './engine/CrownEngine';
import { GAP_WARN_MM } from './engine/types';
import { FeatherLibraryPanel, AssemblyPanel, LightPanel, ExportPanel } from './ui/panels';

const TABS = ['羽枝库', '冠体装配', '羽光调校', '成片导出'];

function useEngineVersion(engine: CrownEngine | null): number {
  const subscribe = useCallback(
    (cb: () => void) => (engine ? engine.subscribe(cb) : () => {}),
    [engine],
  );
  const getSnapshot = useCallback(() => (engine ? engine.getVersion() : 0), [engine]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<CrownEngine | null>(null);
  const [hud, setHud] = useState<HudInfo>({ fps: 0, count: 0, selectedId: null, hover: null });
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const eng = new CrownEngine(containerRef.current, setHud);
    setEngine(eng);
    return () => {
      eng.dispose();
      setEngine(null);
    };
  }, []);

  useEngineVersion(engine);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <h1>点翠冠冕</h1>
          <span>羽光编辑渲染工具</span>
        </header>
        <nav className="tabs">
          {TABS.map((t, i) => (
            <button key={t} className={tab === i ? 'active' : ''} onClick={() => setTab(i)}>
              {t}
            </button>
          ))}
        </nav>
        {engine && (
          <>
            {tab === 0 && <FeatherLibraryPanel engine={engine} />}
            {tab === 1 && <AssemblyPanel engine={engine} />}
            {tab === 2 && <LightPanel engine={engine} />}
            {tab === 3 && <ExportPanel engine={engine} />}
          </>
        )}
      </aside>

      <main className="viewport" ref={containerRef}>
        <div className={`fps-badge ${hud.fps >= 55 ? 'ok' : 'bad'}`}>
          {hud.fps} fps · {hud.count} 根羽枝
        </div>
        {hud.hover && (
          <div
            className={`gap-tip ${hud.hover.warn ? 'warn' : ''}`}
            style={{ left: hud.hover.x + 14, top: hud.hover.y + 14 }}
          >
            法线已显示 · 间隙 {hud.hover.gap.toFixed(2)}mm
            {hud.hover.warn && ` ⚠ 超 ${GAP_WARN_MM}mm`}
          </div>
        )}
        <div className="help">
          左键拖动旋转视角 · 滚轮缩放 · 点击羽枝选中 · 拖动羽枝沿冠面移动 · Alt+拖动调光源
        </div>
      </main>
    </div>
  );
}
