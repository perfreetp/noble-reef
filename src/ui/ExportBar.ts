import type { ProjectStore } from '../core/ProjectStore';
import type { RenderEngine } from '../render/RenderEngine';
import { sharedCss } from './sharedCss';

function download(filename: string, url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/**
 * 成片导出工具条:
 *  - 2 倍 PNG(离屏高分辨率重渲染)
 *  - 层配置 JSON(完整工程快照,回读后层序/不透明度一致)
 *  - 配置回读(严格校验,失败弹错)
 */
export class ExportBarElement extends HTMLElement {
  static tag = 'fg-export-bar';

  private store!: ProjectStore;
  private engine!: RenderEngine;

  constructor(store?: ProjectStore, engine?: RenderEngine) {
    super();
    if (store) this.store = store;
    if (engine) this.engine = engine;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (!this.store || !this.engine) return;
    this.render();
  }

  private render(): void {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        ${sharedCss}
        :host { display: block; }
        .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .status { color: var(--muted); font-size: 12px; margin-left: auto; }
        .status b { color: var(--accent); font-variant-numeric: tabular-nums; }
        input[type="file"] { display: none; }
      </style>
      <div class="bar">
        <button class="primary" data-role="png">导出 2× PNG</button>
        <button data-role="json">导出层配置 JSON</button>
        <button data-role="load">回读配置</button>
        <input type="file" data-role="file" accept="application/json,.json" />
        <span class="status">图元 <b data-role="count">0</b> · FPS <b data-role="fps">--</b> · <span data-role="backend"></span></span>
      </div>`;
    this.wire();
    this.refreshCount();
    this.store.emitter.on('ornament:add', () => this.refreshCount());
    this.store.emitter.on('ornament:remove', () => this.refreshCount());
    this.store.emitter.on('project:load', () => this.refreshCount());
    this.engine.onFps = (fps) => {
      const el = root.querySelector('[data-role="fps"]');
      if (el) el.textContent = String(fps);
    };
    const be = root.querySelector('[data-role="backend"]');
    if (be) be.textContent = this.engine.backend === 'webgpu' ? 'WebGPU' : 'WebGL2 回退';
  }

  private refreshCount(): void {
    const el = this.shadowRoot!.querySelector('[data-role="count"]');
    if (el) el.textContent = String(this.store.ornaments.length);
  }

  private wire(): void {
    const root = this.shadowRoot!;
    root.querySelector('[data-role="png"]')!.addEventListener('click', async () => {
      const url = await this.engine.exportPNG(2);
      download(`fengguan-${Date.now()}.png`, url);
    });
    root.querySelector('[data-role="json"]')!.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this.store.toJSON(), null, 2)], { type: 'application/json' });
      download(`fengguan-config-${Date.now()}.json`, URL.createObjectURL(blob));
    });
    const fileInput = root.querySelector<HTMLInputElement>('[data-role="file"]')!;
    root.querySelector('[data-role="load"]')!.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const cfg = JSON.parse(await file.text());
        this.store.loadJSON(cfg);
        alert('配置回读成功:层序、不透明度与全部饰片已恢复。');
      } catch (err) {
        alert(`配置回读失败:${(err as Error).message}`);
      }
      fileInput.value = '';
    });
  }
}
