import type { ProjectStore } from '../core/ProjectStore';
import type { RenderEngine } from '../render/RenderEngine';
import type { AssetLibrary } from '../render/assets';
import type { OrnamentEditor } from '../editor/OrnamentEditor';
import type { OverlayView } from '../editor/OverlayView';
import { AssetPanelElement } from './AssetPanel';
import { LayerPanelElement } from './LayerPanel';
import { PropertyPanelElement } from './PropertyPanel';
import { ExportBarElement } from './ExportBar';
import { CanvasViewElement } from './CanvasView';
import { sharedCss } from './sharedCss';

/**
 * 工作台外壳:三栏布局 + 顶部工具条。
 * 左:素材面板  中:画布  右:图层管理 + 饰片属性
 *
 * 子组件用普通 div 占位,再以显式 new(注入依赖)替换 ——
 * 避免浏览器对自定义标签无参自动升级(组件依赖无法无参构造)。
 */
export class StudioShellElement extends HTMLElement {
  static tag = 'fg-studio';

  constructor(
    private store?: ProjectStore,
    private engine?: RenderEngine,
    private lib?: AssetLibrary,
    private editor?: OrnamentEditor,
    private overlay?: OverlayView,
  ) {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (!this.store || !this.engine || !this.lib || !this.editor || !this.overlay) return;
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        ${sharedCss}
        :host {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          grid-template-columns: 240px minmax(420px, 1fr) 280px;
          grid-template-areas:
            "top top top"
            "left center right";
          gap: 12px;
          padding: 12px;
          min-width: 1080px;
          min-height: 100vh;
          background: var(--bg);
        }
        .top { grid-area: top; }
        .left { grid-area: left; overflow-y: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
        .center { grid-area: center; overflow: auto; min-width: 0; }
        .right { grid-area: right; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
        header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .logo { font-weight: 700; letter-spacing: 2px; color: var(--gold); }
      </style>
      <div class="top card">
        <header>
          <span class="logo">凤冠珠光层叠合成台</span>
          <span class="tag">原生 TypeScript · Web Components · PixiJS WebGPU</span>
          <div style="flex:1"></div>
          <div data-slot="export"></div>
        </header>
      </div>
      <aside class="left"><div data-slot="assets"></div></aside>
      <main class="center"><div data-slot="canvas"></div></main>
      <aside class="right">
        <div class="card"><div data-slot="layers"></div></div>
        <div class="card"><div data-slot="props"></div></div>
      </aside>`;

    this.mount('[data-slot="assets"]', new AssetPanelElement(this.lib));
    this.mount('[data-slot="layers"]', new LayerPanelElement(this.store));
    this.mount('[data-slot="props"]', new PropertyPanelElement(this.store, this.editor));
    this.mount('[data-slot="export"]', new ExportBarElement(this.store, this.engine));
    const canvasView = new CanvasViewElement(this.store, this.engine, this.editor, this.overlay);
    this.mount('[data-slot="canvas"]', canvasView);
    canvasView.attachEngineCanvas();
  }

  private mount(selector: string, el: HTMLElement): void {
    const slot = this.shadowRoot!.querySelector(selector);
    if (!slot) throw new Error(`工作台占位缺失: ${selector}`);
    slot.replaceWith(el);
  }
}
