import type { ProjectStore } from '../core/ProjectStore';
import type { RenderEngine } from '../render/RenderEngine';
import type { OrnamentEditor } from '../editor/OrnamentEditor';
import type { OverlayView } from '../editor/OverlayView';
import { LAYER_ACCEPTS, type LayerId, type OrnamentKind } from '../core/types';
import { sharedCss } from './sharedCss';

const KIND_TO_LAYER: Record<OrnamentKind, LayerId> = {
  kingfisher: 'kingfisher',
  pearl: 'pearl',
  champleve: 'metal',
};

/**
 * 画布视图:承载 Pixi canvas,处理
 *  - 素材面板拖放(落点转画布坐标,按种类入层)
 *  - 指针拾取/移动/旋转/缩放(Shift 临时关闭吸附)
 *  - 覆盖层每帧重绘
 */
export class CanvasViewElement extends HTMLElement {
  static tag = 'fg-canvas-view';

  private store!: ProjectStore;
  private engine!: RenderEngine;
  private editor!: OrnamentEditor;
  private overlay!: OverlayView;

  constructor(store?: ProjectStore, engine?: RenderEngine, editor?: OrnamentEditor, overlay?: OverlayView) {
    super();
    if (store) this.store = store;
    if (engine) this.engine = engine;
    if (editor) this.editor = editor;
    if (overlay) this.overlay = overlay;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (!this.store || !this.engine || !this.editor || !this.overlay) return;
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        ${sharedCss}
        :host { display: block; position: relative; }
        .frame {
          position: relative;
          border: 1px solid var(--line);
          border-radius: 10px;
          overflow: hidden;
          background: #0e0b12;
          /* Pixi 会给 canvas 写内联像素尺寸,这里强制按容器缩放 */
          display: flex;
          justify-content: center;
        }
        canvas {
          display: block;
          width: 100% !important;
          height: auto !important;
          max-width: 100%;
          touch-action: none;
        }
        .drop-hint {
          position: absolute; inset: 0;
          display: none; align-items: center; justify-content: center;
          background: rgba(102, 225, 255, .12);
          border: 2px dashed var(--accent);
          color: var(--accent); font-size: 18px; font-weight: 600;
          pointer-events: none;
        }
        .frame.dragover .drop-hint { display: flex; }
        .tip {
          position: absolute; left: 10px; bottom: 8px;
          color: var(--muted); font-size: 11px;
          background: rgba(20,17,24,.75); padding: 4px 8px; border-radius: 6px;
          pointer-events: none;
        }
      </style>
      <div class="frame" data-role="frame">
        <canvas data-role="canvas"></canvas>
        <div class="drop-hint">松手放入饰片</div>
        <div class="tip">拖动移动 · 手柄旋转/缩放 · 按住 Shift 自由摆放(关闭吸附) · Delete 删除</div>
      </div>`;

    this.wireDrop();
    this.wirePointer();
    this.wireKeyboard();
    // 覆盖层挂到 Pixi stage,由引擎 tick 驱动重绘
    this.engine.app.ticker.add(() => this.overlay.redraw());
  }

  /** 把引擎的 canvas 移动进本组件(boot 时调用) */
  attachEngineCanvas(): void {
    const host = this.shadowRoot!.querySelector('[data-role="frame"]')!;
    const engineCanvas = this.engine.app.canvas;
    host.prepend(engineCanvas);
    if (!this.engine.app.stage.children.includes(this.overlay.container)) {
      this.engine.app.stage.addChild(this.overlay.container);
    }
  }

  private canvasPoint(ev: PointerEvent | DragEvent): { x: number; y: number } {
    const canvas = this.engine.app.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = this.store.canvas.width / rect.width;
    const scaleY = this.store.canvas.height / rect.height;
    return {
      x: (ev.clientX - rect.left) * scaleX,
      y: (ev.clientY - rect.top) * scaleY,
    };
  }

  private wireDrop(): void {
    const frame = this.shadowRoot!.querySelector<HTMLElement>('[data-role="frame"]')!;
    frame.addEventListener('dragover', (e) => {
      // 只接受素材拖入,图层排序的拖放不响应
      if (!e.dataTransfer?.types.includes('application/x-fg-asset')) return;
      e.preventDefault();
      frame.classList.add('dragover');
    });
    frame.addEventListener('dragleave', () => frame.classList.remove('dragover'));
    frame.addEventListener('drop', (e) => {
      e.preventDefault();
      frame.classList.remove('dragover');
      const assetId = e.dataTransfer!.getData('application/x-fg-asset');
      const kind = e.dataTransfer!.getData('application/x-fg-kind') as OrnamentKind;
      if (!assetId || !kind) return;
      const layer = KIND_TO_LAYER[kind];
      if (!LAYER_ACCEPTS[layer].includes(kind)) return;
      const { x, y } = this.canvasPoint(e);
      const o = this.store.addOrnament(kind, assetId, layer, x, y);
      this.editor.select(o.id);
    });
  }

  private wirePointer(): void {
    const canvas = () => this.engine.app.canvas;
    canvas().addEventListener('pointerdown', (e) => {
      canvas().setPointerCapture(e.pointerId);
      const p = this.canvasPoint(e);
      this.editor.beginDrag(p.x, p.y, !e.shiftKey);
    });
    canvas().addEventListener('pointermove', (e) => {
      const p = this.canvasPoint(e);
      if (this.editor.drag) {
        this.editor.updateDrag(p.x, p.y);
      } else {
        const hit = this.editor.pick(p.x, p.y);
        this.editor.hoverId = hit?.ornament.id ?? null;
        canvas().style.cursor = hit ? 'move' : 'default';
      }
    });
    const end = (e: PointerEvent): void => {
      if (this.editor.drag) this.editor.endDrag();
      try {
        canvas().releasePointerCapture(e.pointerId);
      } catch {
        /* 指针已释放 */
      }
    };
    canvas().addEventListener('pointerup', end);
    canvas().addEventListener('pointercancel', end);
  }

  private wireKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.editor.selectedId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        const id = this.editor.selectedId;
        this.editor.select(null);
        this.store.removeOrnament(id);
      }
    });
  }
}
