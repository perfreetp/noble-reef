import type { Pose, RigConfig, RodDef, Vec2 } from '../types';
import { MAX_POSES } from '../types';
import { RodPad } from './rod-pad';
import { PosePanel } from './pose-panel';
import { ConfigPanel } from './config-panel';

/**
 * 皮影联动台总面板(Web Component)。
 *
 * Shadow DOM 内组织三个操纵盘、姿态库、杆件绑定、背光与文件操作;
 * 与渲染层只通过 CustomEvent / 公共方法通信:
 *   出:rod-input, rod-release, pose-save, pose-apply, pose-rename,
 *       pose-delete, binding-change, light-change, export, import, reset
 *   入:setConfig(), syncKnobs(), setStats(), setActivePose()
 */
export class ControlPanel extends HTMLElement {
  private root: ShadowRoot;
  private pads: RodPad[] = [];
  private posePanel!: PosePanel;
  private configPanel!: ConfigPanel;
  private lightSlider!: HTMLInputElement;
  private fpsEl!: HTMLElement;
  private maskEl!: HTMLElement;
  private fileInput!: HTMLInputElement;
  private cfg!: RigConfig;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host {
          --ink: #e8d8c0;
          display: flex; flex-direction: column; gap: 12px;
          height: 100%; box-sizing: border-box; padding: 14px;
          background: linear-gradient(180deg, #1a120b, #100b06);
          color: var(--ink); font: 13px/1.5 "PingFang SC", "Microsoft YaHei", sans-serif;
          overflow-y: auto;
        }
        header { font-size: 15px; letter-spacing: 3px; color: #e8c08a; text-align: center; margin-bottom: 2px; }
        section { border: 1px solid #3a2c1c; border-radius: 10px; padding: 10px; background: rgba(23,16,9,.45); }
        h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #c9a878; letter-spacing: 2px; }
        .pads { display: flex; justify-content: space-around; gap: 8px; }
        .row { display: flex; align-items: center; gap: 8px; }
        input[type=range] { flex: 1; accent-color: #c98f4a; }
        .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        button {
          font: inherit; font-size: 12px; padding: 7px 6px; border-radius: 6px;
          border: 1px solid #6b5136; background: #241a10; color: var(--ink); cursor: pointer;
        }
        button:hover { background: #342615; }
        button:disabled { opacity: .4; cursor: not-allowed; }
        .stats { display: flex; justify-content: space-between; font-size: 11px; color: #a98f6d; }
        .tabs { display: flex; gap: 6px; }
        .tabs button { flex: 1; }
        .tabs button.on { background: #5a3d1e; border-color: #a5743f; }
        .tabpane { display: none; }
        .tabpane.on { display: block; }
        .hint { font-size: 10px; color: #8a7458; margin: 6px 0 0; }
      </style>
      <header>皮影操纵杆联动台</header>

      <section>
        <h3>操纵杆 · 最多 3 根 · 支持同时拖动</h3>
        <div class="pads" id="pads"></div>
        <p class="hint">圆盘边缘即极限位置,关节被限位顶住;松手后阻尼回弹。</p>
      </section>

      <section>
        <h3>背光强度</h3>
        <div class="row">
          <input type="range" id="light" min="0" max="2" step="0.05" value="1" />
          <span id="lightVal" style="width:38px;text-align:right">1.00</span>
        </div>
      </section>

      <section>
        <div class="tabs">
          <button class="on" data-tab="pose">姿态库</button>
          <button data-tab="bind">杆件绑定</button>
        </div>
        <div class="tabpane on" id="pane-pose"><pose-panel></pose-panel></div>
        <div class="tabpane" id="pane-bind"><config-panel></config-panel></div>
      </section>

      <section>
        <h3>配置文件</h3>
        <div class="btns">
          <button id="export">导出 JSON 分享</button>
          <button id="import">导入 JSON</button>
          <button id="reset" style="grid-column: 1 / -1">恢复默认影偶</button>
        </div>
        <input type="file" id="file" accept="application/json,.json" hidden />
        <p class="hint">导出内容:挂点层级、杆件绑定、姿态列表与背光强度。</p>
      </section>

      <section>
        <div class="stats">
          <span id="fps">FPS: --</span>
          <span id="mask">遮罩重算: -- ms</span>
        </div>
      </section>
    `;

    this.posePanel = this.root.querySelector('pose-panel')!;
    this.configPanel = this.root.querySelector('config-panel')!;
    this.lightSlider = this.root.querySelector('#light')!;
    this.fpsEl = this.root.querySelector('#fps')!;
    this.maskEl = this.root.querySelector('#mask')!;
    this.fileInput = this.root.querySelector('#file')!;

    this.lightSlider.addEventListener('input', () => {
      const v = Number(this.lightSlider.value);
      this.root.querySelector('#lightVal')!.textContent = v.toFixed(2);
      this.emit('light-change', { value: v });
    });
    this.root.querySelector('#export')!.addEventListener('click', () => this.emit('export'));
    this.root.querySelector('#import')!.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', async () => {
      const f = this.fileInput.files?.[0];
      if (f) this.emit('import', { file: f });
      this.fileInput.value = '';
    });
    this.root.querySelector('#reset')!.addEventListener('click', () => this.emit('reset'));

    this.root.querySelectorAll('.tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.root.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b === btn));
        const tab = (btn as HTMLElement).dataset.tab!;
        this.root.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('on', p.id === `pane-${tab}`));
      });
    });
  }

  setConfig(cfg: RigConfig): void {
    this.cfg = cfg;
    const padsHost = this.root.querySelector('#pads')!;
    padsHost.innerHTML = '';
    this.pads = [];
    cfg.rods.forEach((rod) => {
      const pad = document.createElement('rod-pad') as RodPad;
      padsHost.appendChild(pad);
      pad.setRod(rod);
      this.pads.push(pad);
    });
    this.posePanel.setPoses(cfg.poses, null);
    this.configPanel.setRods(cfg.rods);
    this.lightSlider.value = String(cfg.lightIntensity);
    this.root.querySelector('#lightVal')!.textContent = cfg.lightIntensity.toFixed(2);
  }

  /** 每帧把杆件实际位置回写到旋钮(姿态补间时旋钮随之平滑移动) */
  syncKnobs(positions: Record<string, Vec2>): void {
    for (const pad of this.pads) {
      const p = positions[pad.rodId];
      if (p && !pad.dragging) pad.setKnob(p);
    }
  }

  setStats(fps: number, maskMs: number): void {
    this.fpsEl.textContent = `FPS: ${fps.toFixed(0)}`;
    this.fpsEl.style.color = fps >= 30 ? '#9bc98f' : '#e08a6a';
    this.maskEl.textContent = `遮罩重算: ${maskMs.toFixed(2)} ms`;
  }

  setActivePose(id: string | null): void {
    this.posePanel.setPoses(this.cfg.poses, id);
  }

  refreshPoses(poses: Pose[]): void {
    this.cfg.poses = poses;
    this.posePanel.setPoses(poses, null);
  }

  refreshRods(rods: RodDef[]): void {
    this.cfg.rods = rods;
    this.configPanel.setRods(rods);
  }

  setLightValue(v: number): void {
    this.lightSlider.value = String(v);
    this.root.querySelector('#lightVal')!.textContent = v.toFixed(2);
  }

  get padCount(): number {
    return this.pads.length;
  }

  get poseCapacity(): number {
    return MAX_POSES;
  }

  private emit(name: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }
}

export function registerComponents(): void {
  if (!customElements.get('rod-pad')) customElements.define('rod-pad', RodPad);
  if (!customElements.get('pose-panel')) customElements.define('pose-panel', PosePanel);
  if (!customElements.get('config-panel')) customElements.define('config-panel', ConfigPanel);
  if (!customElements.get('control-panel')) customElements.define('control-panel', ControlPanel);
}
