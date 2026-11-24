import { ProjectStore } from './core/ProjectStore';
import { AssetLibrary } from './render/assets';
import { RenderEngine } from './render/RenderEngine';
import { OrnamentEditor } from './editor/OrnamentEditor';
import { OverlayView } from './editor/OverlayView';
import { StudioShellElement } from './ui/StudioShell';
import { defineElements } from './ui/registry';
import { fillTo5000, seedDemoForTest } from './testData';

async function boot(): Promise<void> {
  defineElements();
  const store = new ProjectStore(1600, 1000);
  seedDemoForTest(store);

  const lib = AssetLibrary.createDefault();
  // 离屏 canvas 先让 Pixi 初始化,再由 CanvasView 移动进 Shadow DOM
  const bootCanvas = document.createElement('canvas');
  document.body.appendChild(bootCanvas);
  const engine = await RenderEngine.create(bootCanvas, store, lib);

  const editor = new OrnamentEditor(store);
  editor.onTransform = (id, patch) => store.updateOrnament(id, patch);
  const overlay = new OverlayView(store, editor);

  const shell = new StudioShellElement(store, engine, lib, editor, overlay);
  document.body.appendChild(shell);

  // 调试/验收钩子
  (window as unknown as Record<string, unknown>).fg = {
    store,
    engine,
    editor,
    fillTo5000: () => fillTo5000(store),
    clearAll: () => {
      store.ornaments.splice(0, store.ornaments.length);
      store.emitter.emit('project:load', store.toJSON());
    },
  };
  console.info('[boot] 凤冠珠光层叠合成台就绪。window.fg.fillTo5000() 可灌入 5000 图元做帧率验收。');
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#ff7a6b;padding:20px">启动失败:\n${String(err)}</pre>`;
});
