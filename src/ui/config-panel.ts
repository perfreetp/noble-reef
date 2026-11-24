import { ALL_TIPS } from '../config';
import type { RodDef } from '../types';

const TIP_LABEL: Record<string, string> = {
  head: '头挂点',
  body: '身挂点',
  leftArm: '左臂挂点',
  rightArm: '右臂挂点',
  leftLeg: '左腿挂点',
  rightLeg: '右腿挂点',
};

/**
 * 杆件绑定配置:每根杆 1~2 个挂点、位移轴向、位移->角度换算系数。
 * 改绑后派发 binding-change,父级重建 RodController 并写入导出文件。
 */
export class ConfigPanel extends HTMLElement {
  private root: ShadowRoot;
  private rods: RodDef[] = [];

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        .rod { border: 1px solid #4a3826; border-radius: 8px; padding: 8px; margin-bottom: 8px; background: rgba(23,16,9,.5); }
        .title { font-size: 12px; color: #c9a878; margin-bottom: 6px; }
        .line { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 11px; }
        select, input[type=number] {
          font: inherit; font-size: 11px; background: #1d140b; color: var(--ink, #e8d8c0);
          border: 1px solid #4a3826; border-radius: 4px; padding: 3px 4px;
        }
        select { flex: 1; min-width: 0; }
        input[type=number] { width: 56px; }
      </style>
      <div id="list"></div>
    `;
    // 事件委托只注册一次,避免每次 render 累积监听器
    this.root.querySelector('#list')!.addEventListener('change', (e) => {
      const el = e.target as HTMLSelectElement | HTMLInputElement;
      if (!el.dataset.field) return;
      const ri = Number(el.dataset.ri);
      const slot = Number(el.dataset.slot);
      const field = el.dataset.field!;
      const rod = this.rods[ri];
      if (!rod) return;
      const bindings = rod.bindings.map((b) => ({ ...b }));
      if (field === 'tip' && el instanceof HTMLSelectElement && !el.value) {
        if (slot === 1) bindings.length = 1; // 清空第二个挂点
      } else {
        const cur = bindings[slot] ?? { tip: ALL_TIPS[0], axis: 'x' as const, scale: 1 };
        if (field === 'tip') cur.tip = (el as HTMLSelectElement).value as typeof cur.tip;
        if (field === 'axis') cur.axis = (el as HTMLSelectElement).value as 'x' | 'y';
        if (field === 'scale') cur.scale = Math.max(-4, Math.min(4, Number((el as HTMLInputElement).value) || 1));
        bindings[slot] = cur;
      }
      if (bindings.length < 1) return;
      rod.bindings = bindings as RodDef['bindings'];
      this.dispatchEvent(
        new CustomEvent('binding-change', { bubbles: true, composed: true, detail: { rods: this.rods } }),
      );
    });
    this.render();
  }

  setRods(rods: RodDef[]): void {
    this.rods = rods.map((r) => structuredClone(r));
    if (this.isConnected) this.render();
  }

  private tipOptions(selected: string | undefined, allowNone: boolean): string {
    const none = allowNone ? `<option value="" ${!selected ? 'selected' : ''}>— 空 —</option>` : '';
    return (
      none +
      ALL_TIPS.map((t) => `<option value="${t}" ${t === selected ? 'selected' : ''}>${TIP_LABEL[t]}</option>`).join('')
    );
  }

  private render(): void {
    const list = this.root.querySelector('#list')!;
    list.innerHTML = '';
    this.rods.forEach((rod, ri) => {
      const box = document.createElement('div');
      box.className = 'rod';
      const [b1, b2] = rod.bindings;
      box.innerHTML = `
        <div class="title">${rod.label}</div>
        <div class="line">
          <span>挂点1</span>
          <select data-ri="${ri}" data-slot="0" data-field="tip">${this.tipOptions(b1?.tip, false)}</select>
          <select data-ri="${ri}" data-slot="0" data-field="axis">
            <option value="x" ${b1?.axis === 'x' ? 'selected' : ''}>横向</option>
            <option value="y" ${b1?.axis === 'y' ? 'selected' : ''}>纵向</option>
          </select>
          <input type="number" step="0.05" data-ri="${ri}" data-slot="0" data-field="scale" value="${b1?.scale ?? 1}" />
        </div>
        <div class="line">
          <span>挂点2</span>
          <select data-ri="${ri}" data-slot="1" data-field="tip">${this.tipOptions(b2?.tip, true)}</select>
          <select data-ri="${ri}" data-slot="1" data-field="axis">
            <option value="x" ${(!b2 || b2.axis === 'x') ? 'selected' : ''}>横向</option>
            <option value="y" ${b2?.axis === 'y' ? 'selected' : ''}>纵向</option>
          </select>
          <input type="number" step="0.05" data-ri="${ri}" data-slot="1" data-field="scale" value="${b2?.scale ?? 1}" />
        </div>`;
      list.appendChild(box);
    });
  }
}
