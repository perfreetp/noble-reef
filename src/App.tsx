import { TopBar } from './components/TopBar';
import { LightPanel } from './components/LightPanel';
import { WaterPanel } from './components/WaterPanel';
import { WhiteBalancePanel } from './components/WhiteBalancePanel';
import { Viewport } from './components/Viewport';

export function App() {
  return (
    <div class="app">
      <TopBar />
      <aside class="sidebar">
        <LightPanel />
        <WaterPanel />
        <WhiteBalancePanel />
      </aside>
      <Viewport />
    </div>
  );
}
