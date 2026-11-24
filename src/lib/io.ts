// 工程文件导入导出

import { DOC_FILE_MARKER, type ProjectFile } from './types';
import { store, type DocStore } from './store.svelte';

export function downloadProject(s: DocStore = store) {
  const data: ProjectFile = s.exportFile();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `water-plaza-${stamp}.aqua.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function openImportFile(): Promise<boolean> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(false);
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result);
        try {
          const parsed = JSON.parse(text) as ProjectFile;
          if (parsed.app !== DOC_FILE_MARKER) {
            alert('导入失败：文件不是水景广场编排工程（.aqua.json）');
            resolve(false);
            return;
          }
          store.importJSON(text);
          resolve(true);
        } catch (err) {
          alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
          resolve(false);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}
