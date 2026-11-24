import type { Pose } from '../types';
import { MAX_POSES } from '../types';

/**
 * 姿态库(最多 6 个)。保存当前杆件位置、点击切换、重命名与删除,
 * 切换由父级通过 pose-apply 事件触发平滑过渡。
 */
export class PosePanel extends HTMLElement {
  private root: ShadowRoot;
  private listEl!: HTMLDivElement;
  private poses: Pose[] = [];
  private activeId: string | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        .row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        button {
          font: inherit; font-size: 12px; padding: 6px 8px; border-radius: 6px;
          border: 1px solid #6b5136; background: #241a10; color: var(--ink, #e8d8c0);
          cursor: pointer;
        }
        button:hover { background: #342615; }
        .save { flex: 1; background: #5a3d1e; border-color: #a5743f; }
        .slot {
          position: relative; min-height: 52px; padding: 6px; border-radius: 8px;
          border: 1px dashed #6b5136; background: rgba(23,16,9,.6);
          display: flex; flex-direction: column; gap: 4px; justify-content: space-between;
        }
        .slot.filled { border-style: solid; }
        .slot.active { border-color: #e8c08a; box-shadow: 0 0 8px rgba(232,192,138,.45); }
        .slot .label { font-size: 12px; text-align: center; word-break: break-all; }
        .slot .ops { display: flex; gap: 4px; }
        .slot .ops button { flex: 1; padding: 2px 0; font-size: 10px; }
        .empty { font-size: 11px; color: #8a7458; text-align: center; margin: 0; }
      </style>
      <div class="row">
        <button class="save" id="save">◆ 保存当前姿态</button>
        <span class="empty" id="counter"></span>
      </div>
      <div class="grid" id="grid"></div>
    `;
    this.listEl = this.root.querySelector('#grid')!;
    this.root.querySelector('#save')!.addEventListener('click', () => {
      if (this.poses.length >= MAX_POSES) return;
      this.dispatchEvent(new CustomEvent('pose-save', { bubbles: true, composed: true }));
    });
    this.render();
  }

  setPoses(poses: Pose[], activeId: string | null): void {
    this.poses = poses;
    this.activeId = activeId;
    if (this.isConnected) this.render();
  }

  private render(): void {
    this.root.querySelector('#counter')!.textContent = `${this.poses.length}/${MAX_POSES}`;
    const saveBtn = this.root.querySelector('#save') as HTMLButtonElement;
    saveBtn.disabled = this.poses.length >= MAX_POSES;
    this.listEl.innerHTML = '';
    for (let i = 0; i < MAX_POSES; i++) {
      const p = this.poses[i];
      const slot = document.createElement('div');
      slot.className = `slot ${p ? 'filled' : ''} ${p && p.id === this.activeId ? 'active' : ''}`;
      if (!p) {
        slot.innerHTML = `<span class="empty">空位 ${i + 1}</span>`;
      } else {
        slot.innerHTML = `
          <span class="label" title="${p.name}">${p.name}</span>
          <div class="ops">
            <button data-act="apply">切换</button>
            <button data-act="rename">改名</button>
            <button data-act="delete">删</button>
          </div>`;
        slot.querySelector('[data-act="apply"]')!.addEventListener('click', () => {
          this.dispatchEvent(
            new CustomEvent('pose-apply', { bubbles: true, composed: true, detail: { id: p.id } }),
          );
        });
        slot.querySelector('[data-act="rename"]')!.addEventListener('click', () => {
          const name = window.prompt('姿态名称', p.name);
          if (name && name.trim()) {
            this.dispatchEvent(
              new CustomEvent('pose-rename', {
                bubbles: true,
                composed: true,
                detail: { id: p.id, name: name.trim() },
              }),
            );
          }
        });
        slot.querySelector('[data-act="delete"]')!.addEventListener('click', () => {
          this.dispatchEvent(
            new CustomEvent('pose-delete', { bubbles: true, composed: true, detail: { id: p.id } }),
          );
        });
      }
      this.listEl.appendChild(slot);
    }
  }
}
