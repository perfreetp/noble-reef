import type { RodDef, Vec2 } from '../types';
import { ROD_RANGE } from '../types';

/**
 * 单根操纵杆的操纵盘(Web Component)。
 *
 * 圆盘内拖动,自动夹到半径极限;pointer events 原生支持多点触控,
 * 三个盘各持各的 pointerId,可 3 杆同时拖动。
 * 向外派发 rod-input / rod-release(detail 为世界单位坐标)。
 */
export class RodPad extends HTMLElement {
  private root: ShadowRoot;
  private knob!: HTMLDivElement;
  private pad!: HTMLDivElement;
  private pointerId: number | null = null;
  private def!: RodDef;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display: flex; flex-direction: column; align-items: center; gap: 6px; user-select: none; }
        .name { font-size: 12px; color: var(--ink, #e8d8c0); letter-spacing: 1px; }
        .pad {
          position: relative; width: 96px; height: 96px; border-radius: 50%;
          background: radial-gradient(circle at 50% 40%, #2a2018, #171009);
          border: 1px solid #6b5136;
          box-shadow: inset 0 2px 10px rgba(0,0,0,.7), 0 2px 6px rgba(0,0,0,.5);
          touch-action: none; cursor: grab;
        }
        .pad:active { cursor: grabbing; }
        .cross { position: absolute; inset: 0; pointer-events: none; }
        .cross::before, .cross::after {
          content: ''; position: absolute; background: rgba(201,168,120,.25);
        }
        .cross::before { left: 50%; top: 8%; bottom: 8%; width: 1px; }
        .cross::after { top: 50%; left: 8%; right: 8%; height: 1px; }
        .knob {
          position: absolute; width: 26px; height: 26px; border-radius: 50%;
          left: 50%; top: 50%; margin: -13px 0 0 -13px;
          background: radial-gradient(circle at 35% 30%, #e8c08a, #a5743f 70%);
          border: 1px solid #f0d4a4;
          box-shadow: 0 2px 8px rgba(0,0,0,.6);
          transform: translate3d(0,0,0);
          pointer-events: none;
        }
      </style>
      <div class="name"></div>
      <div class="pad">
        <div class="cross"></div>
        <div class="knob"></div>
      </div>
    `;
    this.pad = this.root.querySelector('.pad')!;
    this.knob = this.root.querySelector('.knob')!;
    this.root.querySelector('.name')!.textContent = this.def?.label ?? '';
    this.pad.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  setRod(def: RodDef): void {
    this.def = def;
    if (this.isConnected) {
      this.root.querySelector('.name')!.textContent = def.label;
      this.setKnob({ x: def.home.x / ROD_RANGE, y: def.home.y / ROD_RANGE });
    }
  }

  /** 姿态切换时由外部驱动旋钮位置(归一化坐标) */
  setKnob(n: Vec2): void {
    this.knob.style.transform = `translate3d(${n.x * 38}px, ${-n.y * 38}px, 0)`;
  }

  get rodId(): string {
    return this.def.id;
  }

  get dragging(): boolean {
    return this.pointerId !== null;
  }

  private toLocal(e: PointerEvent): Vec2 {
    const rect = this.pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const scale = rect.width / 2 / ROD_RANGE;
    return { x: (e.clientX - cx) / scale, y: -(e.clientY - cy) / scale };
  }

  private onDown(e: PointerEvent): void {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.pad.setPointerCapture(e.pointerId);
    this.dispatch(this.toLocal(e));
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.dispatch(this.toLocal(e));
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.dispatchEvent(
      new CustomEvent('rod-release', { bubbles: true, composed: true, detail: { id: this.def.id } }),
    );
  }

  private dispatch(p: Vec2): void {
    const len = Math.hypot(p.x, p.y);
    const k = len > ROD_RANGE ? ROD_RANGE / len : 1;
    const clamped = { x: p.x * k, y: p.y * k };
    this.setKnob({ x: clamped.x / ROD_RANGE, y: clamped.y / ROD_RANGE });
    this.dispatchEvent(
      new CustomEvent('rod-input', {
        bubbles: true,
        composed: true,
        detail: { id: this.def.id, pos: clamped },
      }),
    );
  }
}
