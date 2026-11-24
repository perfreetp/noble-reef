import { useRef } from 'react';
import { downloadSceneFile, parseSceneFile, useBonsaiStore, type ModuleId } from '../store';

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'skeleton', label: '① 骨架' },
  { id: 'growth', label: '② 生长' },
  { id: 'moss', label: '③ 苔藓' },
  { id: 'lighting', label: '④ 布光' },
];

export function Toolbar(props: { fps: number }) {
  const activeModule = useBonsaiStore((s) => s.activeModule);
  const setActiveModule = useBonsaiStore((s) => s.setActiveModule);
  const exportScene = useBonsaiStore((s) => s.exportScene);
  const importScene = useBonsaiStore((s) => s.importScene);
  const resetAll = useBonsaiStore((s) => s.resetAll);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImportFile = async (file: File) => {
    try {
      const data = parseSceneFile(await file.text());
      importScene(data);
    } catch (err) {
      alert(`导入失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="toolbar">
      <span className="logo">盆景工坊</span>
      <div className="module-tabs">
        {MODULES.map((m) => (
          <button
            key={m.id}
            className={activeModule === m.id ? 'tab active' : 'tab'}
            onClick={() => setActiveModule(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="toolbar-actions">
        <span className={`fps ${props.fps < 50 ? 'fps-low' : ''}`}>{props.fps} fps</span>
        <button onClick={() => downloadSceneFile(exportScene())}>导出场景</button>
        <button onClick={() => fileRef.current?.click()}>导入</button>
        <button
          onClick={() => {
            if (confirm('重置为默认盆景?当前修改将丢失。')) resetAll();
          }}
        >
          重置
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
