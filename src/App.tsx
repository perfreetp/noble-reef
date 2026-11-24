import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import { Engine } from './engine/Engine';
import { SceneController } from './engine/SceneController';
import { SceneContext } from './pages/components/sceneContext';
import { TopStepper } from './pages/components/TopStepper';
import { HistoryButtons } from './pages/components/HistoryButtons';
import { BrushPanel } from './pages/components/BrushPanel';
import { PathPanel } from './pages/components/PathPanel';
import { FacilityLibrary } from './pages/components/FacilityLibrary';
import { TourTimeline } from './pages/components/TourTimeline';
import { ToastHost, pushToast } from './pages/components/toast';
import { uiStore } from './store/uiStore';
import { exportProjectFile } from './io/exportProject';
import { importProjectFile } from './io/importProject';
import type { PageName } from './types/engine';

const HINTS: Record<PageName, string> = {
  terrain: '左键拖动：抬升 / 压低 / 平滑地形 · 右键拖动旋转视角 · 滚轮缩放',
  path: '单击地形添加控制点 · 拖动黄色球调整弯道 · 红色路段为超 12° 坡度',
  facility: '在左侧选择设施后单击放置（自动整平）· 拖动设施可移动 · Delete 删除',
  viewpoint: '添加关键点后播放：相机沿步道漫游，高度实时跟随地形',
};

function App(): JSX.Element {
  let containerRef: HTMLDivElement | undefined;
  const [scene, setScene] = createSignal<SceneController | null>(null);
  let fileInputRef: HTMLInputElement | undefined;
  let engine: Engine | null = null;

  onMount(() => {
    if (!containerRef) return;
    engine = new Engine(containerRef);
    const controller = new SceneController(engine);
    setScene(controller);
  });

  onCleanup(() => engine?.dispose());

  const onImportFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const outcome = await importProjectFile(file);
    if (outcome.ok) {
      pushToast(`工程导入成功${outcome.warnings.length ? '（含告警）' : ''}`, 'success');
      outcome.warnings.forEach((w) => pushToast(w, 'info'));
    } else {
      outcome.errors.forEach((e) => pushToast(e, 'error'));
    }
    if (fileInputRef) fileInputRef.value = '';
  };

  return (
    <div class="app-shell">
      <header class="topbar">
        <span class="brand">山地主题乐园 · 园区规划工具</span>
        <TopStepper />
        <HistoryButtons />
        <div class="top-actions">
          <button
            class="btn"
            onClick={() => {
              const name = exportProjectFile();
              pushToast(`已导出工程文件 ${name}`, 'success');
            }}
          >
            导出
          </button>
          <button class="btn primary" onClick={() => fileInputRef?.click()}>
            导入
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => void onImportFile(e.currentTarget.files?.[0])}
          />
        </div>
      </header>

      <div class="app-body">
        <div class="canvas-wrap" ref={containerRef}>
          <div class="hint-bar">{HINTS[uiStore.activePage]}</div>
          <ToastHost />
        </div>
        <Show when={scene()}>
          {(s) => (
            <SceneContext.Provider value={s()}>
              <aside class="side-panel">
                <Show when={uiStore.activePage === 'terrain'}>
                  <BrushPanel />
                </Show>
                <Show when={uiStore.activePage === 'path'}>
                  <PathPanel />
                </Show>
                <Show when={uiStore.activePage === 'facility'}>
                  <FacilityLibrary />
                </Show>
                <Show when={uiStore.activePage === 'viewpoint'}>
                  <TourTimeline />
                </Show>
              </aside>
            </SceneContext.Provider>
          )}
        </Show>
      </div>
    </div>
  );
}

export default App;
