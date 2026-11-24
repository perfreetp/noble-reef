import type { ProjectStore } from '../core/ProjectStore';
import type { Ornament } from '../core/types';
import { LAYER_LABELS } from '../core/types';
import type { OrnamentEditor } from '../editor/OrnamentEditor';
import { sharedCss } from './sharedCss';

/**
 * 属性面板:选中图元的精确数值编辑(位置/缩放/旋转/层内深度),
 * 以及实时压盖关系(谁压在它上面、它压着谁)。
 */
export class PropertyPanelElement extends HTMLElement {
  static tag = 'fg-property-panel';

  private store!: ProjectStore;
  private editor!: OrnamentEditor;

  constructor(store?: ProjectStore, editor?: OrnamentEditor) {
    super();
    if (store) this.store = store;
    if (editor) this.editor = editor;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (!this.store || !this.editor) return;
    this.render();
    this.editor.onSelect = () => this.render();
    this.store.emitter.on('ornament:update', () => {
      if (this.editor.selectedId) this.render();
    });
    this.store.emitter.on('ornament:remove', () => this.render());
  }

  private render(): void {
    const id = this.editor.selectedId;
    const o = id ? this.store.ornaments.find((q) => q.id === id) : undefined;
    const root = this.shadowRoot!;
    if (!o) {
      root.innerHTML = `
        <style>${sharedCss}</style>
        <h3>饰片属性</h3>
        <p class="empty">未选中饰片。在画布点击选择,或从素材面板拖入新饰片。</p>
        <style>.empty { color: var(--muted); font-size: 12px; line-height: 1.7; }</style>`;
      return;
    }
    const rel = this.editor.overlapRelations(o.id);
    root.innerHTML = `
      <style>
        ${sharedCss}
        h3 { margin: 0 0 10px; font-size: 14px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .rel-item {
          display: flex; justify-content: space-between;
          background: var(--panel-2); border: 1px solid var(--line);
          border-radius: 6px; padding: 5px 8px; margin-bottom: 5px; font-size: 12px;
        }
        .rel-item.above { border-left: 3px solid var(--danger); }
        .rel-item.below { border-left: 3px solid var(--ok); }
        .danger { width: 100%; margin-top: 8px; border-color: #6a3030; color: #ffb3aa; }
        h4 { margin: 14px 0 6px; font-size: 12px; color: var(--muted); }
      </style>
      <h3>饰片属性</h3>
      <div class="field"><label>所属图层</label><div class="tag ${o.kind}">${LAYER_LABELS[o.layer]}</div></div>
      <div class="grid2">
        <div class="field"><label>X</label><input type="number" data-k="x" value="${o.x.toFixed(1)}" /></div>
        <div class="field"><label>Y</label><input type="number" data-k="y" value="${o.y.toFixed(1)}" /></div>
        <div class="field"><label>缩放</label><input type="number" data-k="scale" step="0.05" min="0.2" max="4" value="${o.scale.toFixed(2)}" /></div>
        <div class="field"><label>旋转(°)</label><input type="number" data-k="rotationDeg" step="5" value="${((o.rotation * 180) / Math.PI).toFixed(1)}" /></div>
      </div>
      <div class="field">
        <label>层内深度 <span style="color:var(--accent)">${o.depth.toFixed(2)}</span>(越大越靠上)</label>
        <input type="range" data-k="depth" min="0" max="1" step="0.01" value="${o.depth}" />
      </div>
      <h4>压盖关系(重叠 ${rel.above.length + rel.below.length} 个)</h4>
      ${rel.above.map((q) => this.relItem(q, '压在它上方', 'above')).join('') || '<p class="tag">无上压饰片</p>'}
      ${rel.below.map((q) => this.relItem(q, '被它压盖', 'below')).join('') || '<p class="tag">无下盖饰片</p>'}
      <button class="danger" data-role="delete">删除该饰片</button>`;
    this.wire(o);
  }

  private relItem(q: Ornament, text: string, cls: string): string {
    return `<div class="rel-item ${cls}"><span>${q.id.split('-')[0]} · ${LAYER_LABELS[q.layer]}</span><span>${text}</span></div>`;
  }

  private wire(o: Ornament): void {
    const root = this.shadowRoot!;
    root.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((input) => {
      input.addEventListener('change', () => {
        const k = input.dataset.k!;
        const v = Number(input.value);
        if (k === 'rotationDeg') this.store.updateOrnament(o.id, { rotation: (v * Math.PI) / 180 });
        else this.store.updateOrnament(o.id, { [k]: v } as Partial<Ornament>);
      });
    });
    root.querySelector('[data-role="delete"]')!.addEventListener('click', () => {
      this.editor.select(null);
      this.store.removeOrnament(o.id);
    });
  }
}
