import { useState } from 'react';
import { Viewport } from './components/Viewport';
import { Toolbar } from './components/Toolbar';
import { Timeline } from './components/Timeline';
import { SkeletonPanel } from './components/SkeletonPanel';
import { GrowthPanel } from './components/GrowthPanel';
import { MossPanel } from './components/MossPanel';
import { LightingPanel } from './components/LightingPanel';
import { useBonsaiStore } from './store';

export default function App() {
  const activeModule = useBonsaiStore((s) => s.activeModule);
  const [fps, setFps] = useState(60);

  return (
    <div className="app">
      <Toolbar fps={fps} />
      <div className="main">
        <Viewport onFps={setFps} />
        <aside className="sidebar">
          {activeModule === 'skeleton' && <SkeletonPanel />}
          {activeModule === 'growth' && <GrowthPanel />}
          {activeModule === 'moss' && <MossPanel />}
          {activeModule === 'lighting' && <LightingPanel />}
        </aside>
      </div>
      <Timeline />
    </div>
  );
}
