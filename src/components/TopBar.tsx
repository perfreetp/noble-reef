import { useSceneStore, resetScene, importScene } from '../store';
import { downloadPlan } from '../lib/exportPlan';

/** 顶部工具栏：布光方案导出 JSON / 导入 / 重置 */
export function TopBar() {
  const state = useSceneStore();
  let fileInput: HTMLInputElement | undefined;

  const onImportFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      importScene(await file.text());
    } catch (err) {
      window.alert(`导入失败：${(err as Error).message}`);
    }
    input.value = '';
  };

  return (
    <header class="topbar">
      <h1>水下摄影布光工具</h1>
      <span style={{ color: 'var(--muted)' }}>机械臂场景 · 多灯吸收联动预览</span>
      <div class="spacer" />
      <button onClick={() => downloadPlan(state)}>导出方案 JSON</button>
      <button class="secondary" onClick={() => fileInput?.click()}>
        导入方案
      </button>
      <button class="secondary" onClick={() => resetScene()}>
        重置
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={onImportFile}
      />
    </header>
  );
}
