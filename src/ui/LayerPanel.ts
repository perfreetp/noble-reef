import type { ProjectStore } from '../core/ProjectStore';
import type { BlendModeName, LayerConfig } from '../core/types';
import { sharedCss } from './sharedCss';

const BLENDS: BlendModeName[] = [
  'normal',
  'add',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
];

const BLEND_LABEL: Record<BlendModeName, string> = {
  normal: '正常',
  add: '叠加(加色)',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '覆盖',
  'soft-light': '柔光',
  'hard-light': '强光',
};

/**
 * 图层管理面板:点翠底 / 珠串层 / 金银饰片。
 *  - 不透明度滑块、混合模式下拉、显隐
 *  - 上下拖动调整层序,松手即调 store.reorder,渲染管线全链即时重算
 */
export class LayerPanelElement extends HTMLElement {
  static tag = 'fg-layer-panel';

  private store!: ProjectStore;

  constructor(store?: ProjectStore) {
    super();
    if (store) this.store = store;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (!this.store) return;
    this.render();
    this.store.emitter.on('layer:reorder', () => this.render());
    this.store.emitter.on('layer:change', () => this.render());
    this.store.emitter.on('project:load', () => this.render());
  }

  private render(): void {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>
        ${sharedCss}
        h3 { margin: 0 0 10px; font-size: 14px; }
        .layer {
          background: var(--panel-2);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 8px;
          cursor: grab;
        }
        .layer.dragging { opacity: .4; }
        .layer.over { border-color: var(--accent); }
        .layer.hidden-layer { opacity: .55; }
        .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .name { font-weight: 600; }
        .order { color: var(--muted); font-size: 11px; }
        .controls { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
        .mini-btns { display: flex; gap: 4px; }
        .mini-btns button { padding: 2px 7px; font-size: 12px; }
        .val { color: var(--accent); font-variant-numeric: tabular-nums; }
        .drag-handle { color: var(--muted); margin-right: 6px; cursor: grab; }
      </style>
      <h3>图层管理</h3>
      <div class="list">
        ${this.store.layers
          .map(
            (l, i) => `
          <div class="layer ${l.visible ? '' : 'hidden-layer'}" data-index="${i}" draggable="true">
            <div class="head">
              <div><span class="drag-handle">⋮⋮</span><span class="name">${l.name}</span></div>
              <span class="order">第 ${i + 1} 层 · ${i === 0 ? '最底' : i === this.store.layers.length - 1 ? '最顶' : '中间'}</span>
            </div>
            <div class="field">
              <label>不透明度 <span class="val" data-role="opacity-val">${Math.round(l.opacity * 100)}%</span></label>
              <input type="range" min="0" max="1" step="0.01" value="${l.opacity}" data-role="opacity" />
            </div>
            <div class="controls">
              <div class="field" style="margin:0">
                <label>混合模式</label>
                <select data-role="blend">
                  ${BLENDS.map(
                    (b) =>
                      `<option value="${b}" ${b === l.blendMode ? 'selected' : ''}>${BLEND_LABEL[b]}</option>`,
                  ).join('')}
                </select>
              </div>
              <div class="mini-btns">
                <button data-role="up" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
                <button data-role="down" ${i === this.store.layers.length - 1 ? 'disabled' : ''} title="下移">↓</button>
                <button data-role="visible" title="显隐">${l.visible ? '👁' : '—'}</button>
              </div>
            </div>
          </div>`,
          )
          .join('')}
      </div>`;
    this.wire();
  }

  private wire(): void {
    const root = this.shadowRoot!;
    root.querySelectorAll<HTMLElement>('.layer').forEach((el) => {
      const index = Number(el.dataset.index);
      const layer: LayerConfig = this.store.layers[index];

      el.querySelector<HTMLInputElement>('[data-role="opacity"]')!.addEventListener('input', (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        this.store.setLayerOpacity(layer.id, v);
      });
      el.querySelector<HTMLSelectElement>('[data-role="blend"]')!.addEventListener('change', (e) => {
        this.store.setLayerBlend(layer.id, (e.target as HTMLSelectElement).value as BlendModeName);
      });
      el.querySelector('[data-role="up"]')!.addEventListener('click', () => this.store.reorder(index, index - 1));
      el.querySelector('[data-role="down"]')!.addEventListener('click', () => this.store.reorder(index, index + 1));
      el.querySelector('[data-role="visible"]')!.addEventListener('click', () =>
        this.store.setLayerVisible(layer.id, !layer.visible),
      );

      // HTML5 拖拽排序
      el.addEventListener('dragstart', (e) => {
        el.classList.add('dragging');
        e.dataTransfer!.setData('application/x-fg-layer', String(index));
        e.dataTransfer!.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('over');
        const from = Number(e.dataTransfer!.getData('application/x-fg-layer'));
        if (Number.isFinite(from) && from !== index) this.store.reorder(from, index);
      });
    });
  }
}
