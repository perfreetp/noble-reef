import { Card, chips, el, slider, syncChips, syncSlider, syncToggle, toggle } from './dom';
import type { App } from '../app/app';
import type { AppState } from '../app/app';
import type { ViewerMode } from '../viewer/viewer';

export interface ModeBar {
  root: HTMLElement;
  setMode(mode: ViewerMode): void;
}

const MODES: { id: ViewerMode; label: string; hint: string }[] = [
  { id: 'shape', label: '骨架塑形', hint: '拖动控制点弯曲枝干 · 按住 Shift 拖动扭转 · 滚轮缩放' },
  { id: 'prune', label: '分枝修剪', hint: '点击任意枝干将其剪除 · 下游枝叶同步消失 · 可在右侧恢复' },
  { id: 'inspect', label: '审视重心', hint: '观察重心投影与盆钵支撑面 · 拖动可重新取景' },
];

export function createModeBar(app: App): ModeBar {
  const row = el('div', { class: 'mode-switch', role: 'tablist' });
  const buttons = MODES.map((mode) => {
    const btn = el('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': String(mode.id === 'shape'),
      title: mode.hint,
      text: mode.label,
    }) as HTMLButtonElement;
    btn.addEventListener('click', () => app.setMode(mode.id));
    row.appendChild(btn);
    return { id: mode.id, btn };
  });
  return {
    root: row,
    setMode(mode) {
      for (const b of buttons) b.btn.setAttribute('aria-selected', String(b.id === mode));
    },
  };
}

export function modeHint(mode: ViewerMode): string {
  return MODES.find((m) => m.id === mode)?.hint ?? '';
}

export function createStageHud(mode: ViewerMode): HTMLElement {
  return el('div', { class: 'hud' }, [
    el('div', { class: 'hud-title', text: '视图' }),
    el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '拖动' }), el('span', { class: 'hud-val', text: '旋转视角' })]),
    el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '滚轮' }), el('span', { class: 'hud-val', text: '缩放' })]),
    el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: 'Shift+拖动' }), el('span', { class: 'hud-val', text: mode === 'shape' ? '扭转枝干' : '—' })]),
  ]);
}

// ---------------------------------------------------------------------------
// Left: tree generation + shaping
// ---------------------------------------------------------------------------

export class ShapePanel {
  readonly root: HTMLElement;
  private cards: Card[] = [];
  private treeSliders: Partial<Record<keyof import('../core/types').TreeParams, HTMLElement>> = {};
  private branchList: HTMLElement;
  private selectedCard: Card;
  private selectedTitle: HTMLElement;
  private emptyNote!: HTMLElement;
  private emptyWrap!: HTMLElement;
  private detailWrap!: HTMLElement;
  private bendFill!: HTMLElement;
  private bendValue!: HTMLElement;
  private twistFill!: HTMLElement;
  private twistValue!: HTMLElement;
  private twistSliderField!: HTMLElement;
  private pruneSelectedBtn!: HTMLButtonElement;
  private lastSelected: number | null = null;
  private branchSig = '';

  constructor(private app: App) {
    this.root = el('div');

    const gen = new Card({ title: '树干生成', accent: 'seed', id: 'gen' });
    gen.setBody([
      el('p', { class: 'hint', html: '改变种子即可重新生成整株树形。<strong>31 个控制点</strong>分布在主干、一级枝与二级枝上。' }),
      this.makeSeedRow(),
      slider({ label: '主干高度', min: 24, max: 56, step: 0.5, value: app.state.tree.height, format: (v) => `${v.toFixed(0)} cm`, onInput: (v) => app.setTreeParam('height', v) }),
      slider({ label: '弯曲程度', min: 0, max: 1.6, step: 0.02, value: app.state.tree.trunkBend, format: (v) => v.toFixed(2), onInput: (v) => app.setTreeParam('trunkBend', v) }),
      slider({ label: '主干粗度', min: 1.4, max: 4.5, step: 0.05, value: app.state.tree.trunkRadius, format: (v) => `${v.toFixed(1)} cm`, onInput: (v) => app.setTreeParam('trunkRadius', v) }),
      slider({ label: '一级枝数量', min: 3, max: 9, step: 1, value: app.state.tree.primaryCount, format: (v) => `${v.toFixed(0)}`, onInput: (v) => app.setTreeParam('primaryCount', v) }),
      slider({ label: '枝长', min: 6, max: 18, step: 0.25, value: app.state.tree.primaryLength, format: (v) => `${v.toFixed(1)} cm`, onInput: (v) => app.setTreeParam('primaryLength', v) }),
      slider({ label: '开张角度', min: 0.3, max: 1.2, step: 0.01, value: app.state.tree.branchSpread, format: (v) => v.toFixed(2), onInput: (v) => app.setTreeParam('branchSpread', v) }),
      slider({ label: '下垂感', min: 0, max: 0.9, step: 0.01, value: app.state.tree.droop, format: (v) => v.toFixed(2), onInput: (v) => app.setTreeParam('droop', v) }),
      slider({ label: '细枝层次', min: 1, max: 3, step: 1, value: app.state.tree.detail, format: (v) => `${v.toFixed(0)} 级`, onInput: (v) => app.setTreeParam('detail', v) }),
    ]);
    // Keep references to the generation sliders so external changes (import / reset) can
    // update them without rebuilding the card — rebuilding would kill an in-flight drag.
    const genSliders = gen.body.querySelectorAll('input[type=range]');
    const genKeys: (keyof typeof app.state.tree)[] = [
      'height', 'trunkBend', 'trunkRadius', 'primaryCount', 'primaryLength',
      'branchSpread', 'droop', 'detail',
    ];
    genKeys.forEach((key, i) => {
      const field = genSliders[i]?.closest('.field');
      if (field) this.treeSliders[key] = field as HTMLElement;
    });
    this.cards.push(gen);

    const sel = new Card({ title: '选中控制点', accent: '—', id: 'sel' });
    this.selectedTitle = sel.accentElement() ?? el('span', { style: { display: 'none' } });
    this.selectedCard = sel;
    this.emptyNote = el('p', { class: 'empty-note', text: '在视图中悬停或点击控制点（浅蓝色球）以查看与编辑。' });
    this.bendFill = el('div', { class: 'meter-fill', style: { width: '0%' } });
    this.bendValue = el('span', { class: 'meter-val', text: '0°' });
    this.twistFill = el('div', { class: 'meter-fill', style: { width: '0%' } });
    this.twistValue = el('span', { class: 'meter-val', text: '0°' });
    this.twistSliderField = slider({
      label: '扭转角度',
      min: -180,
      max: 180,
      step: 1,
      value: 0,
      format: (v) => `${v.toFixed(0)}°`,
      onInput: (v) => {
        const rig = this.app.treeRig;
        const nodeId = this.app.state.selectedControl;
        if (nodeId === null) return;
        rig.setTwist(nodeId, v);
        this.app.rebuildFromPose();
      },
    });
    this.pruneSelectedBtn = el('button', { class: 'btn small danger', type: 'button', text: '剪除所在枝' }) as HTMLButtonElement;
    this.pruneSelectedBtn.addEventListener('click', () => {
      const nodeId = this.app.state.selectedControl;
      if (nodeId === null) return;
      const limb = this.app.state.skeleton.nodes[nodeId].limb;
      if (limb > 0) this.app.pruneLimb(limb);
    });
    const resetBtn = el('button', { class: 'btn small', type: 'button', text: '重置此点' });
    resetBtn.addEventListener('click', () => this.app.resetSelected());
    this.emptyWrap = el('div', {});
    this.detailWrap = el('div', {}, [
      el('div', { class: 'meter-row' }, [
        el('span', { class: 'meter-label', text: '弯曲' }),
        el('div', { class: 'meter-track' }, [this.bendFill]),
        this.bendValue,
      ]),
      el('div', { class: 'meter-row' }, [
        el('span', { class: 'meter-label', text: '扭转' }),
        el('div', { class: 'meter-track' }, [this.twistFill]),
        this.twistValue,
      ]),
      this.twistSliderField,
      el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [resetBtn, this.pruneSelectedBtn]),
    ]);
    this.emptyWrap.appendChild(this.emptyNote);
    this.detailWrap.style.display = 'none';
    sel.setBody([this.emptyWrap, this.detailWrap]);
    this.cards.push(sel);

    const branches = new Card({ title: '分枝层级', accent: '', id: 'branches' });
    this.branchList = el('div', { class: 'rows' });
    branches.setBody([
      el('p', { class: 'hint', text: '剪除的枝干会连同下游枝叶一起消失，整树重心随即重算。' }),
      this.branchList,
    ]);
    this.cards.push(branches);

    for (const card of this.cards) this.root.appendChild(card.root);
  }

  private makeSeedRow(): HTMLElement {
    const input = el('input', {
      type: 'number',
      value: String(this.app.state.tree.seed),
      min: '0',
      max: '999999',
      style: { width: '86px' },
    }) as HTMLInputElement;
    input.className = 'seed-input';
    input.addEventListener('change', () => {
      const v = Math.max(0, Math.floor(Number(input.value) || 0));
      this.app.setTreeParams({ seed: v });
    });
    const reroll = el('button', { class: 'btn small', type: 'button', text: '随机' });
    reroll.addEventListener('click', () => {
      this.app.reroll();
      input.value = String(this.app.state.tree.seed);
    });
    const row = el('div', { class: 'field' }, [
      el('div', { class: 'field-head' }, [el('span', { class: 'field-label', text: '种子' }), el('span', { class: 'field-value', text: '0–999999' })]),
      el('div', { style: { display: 'flex', gap: '6px' } }, [input, reroll]),
    ]);
    (row as any).__seedInput = input;
    return row;
  }

  update(state: AppState): void {
    // Generation sliders: sync values, but never fight a slider the user is dragging.
    for (const [key, field] of Object.entries(this.treeSliders)) {
      if (!field) continue;
      const input = field.querySelector('input') as HTMLInputElement | null;
      if (!input || document.activeElement === input) continue;
      syncSlider(field, state.tree[key as keyof typeof state.tree] as number);
    }
    const seedInput = this.root.querySelector('.seed-input') as HTMLInputElement | null;
    if (seedInput && document.activeElement !== seedInput) seedInput.value = String(state.tree.seed);

    // Selected control: update text + meters in place so a slider drag is never interrupted.
    const nodeId = state.selectedControl;
    const node = nodeId === null ? null : state.skeleton.nodes[nodeId];
    if (!node) {
      this.emptyWrap.style.display = '';
      this.detailWrap.style.display = 'none';
      this.selectedTitle.textContent = '—';
    } else {
      const rig = this.app.treeRig;
      const bend = rig.bendAmount(node.id);
      const twist = rig.twistAmount(node.id);
      this.emptyWrap.style.display = 'none';
      this.detailWrap.style.display = '';
      const depthLabel = node.depth === 0 ? '主干' : node.depth === 1 ? '一级枝' : node.depth === 2 ? '二级枝' : '细枝';
      this.selectedTitle.textContent = `#${node.id} · ${depthLabel}`;
      this.bendFill.style.width = `${Math.min(100, (bend / 95) * 100).toFixed(0)}%`;
      this.bendValue.textContent = `${bend.toFixed(0)}°`;
      this.twistFill.style.width = `${Math.min(100, (Math.abs(twist) / 180) * 100).toFixed(0)}%`;
      this.twistValue.textContent = `${twist.toFixed(0)}°`;
      const input = this.twistSliderField.querySelector('input') as HTMLInputElement | null;
      if (input && document.activeElement !== input) syncSlider(this.twistSliderField, Math.round(twist));
      this.pruneSelectedBtn.disabled = node.limb === 0;
    }
    this.lastSelected = nodeId;

    // Branch list. It only depends on the prune set and the limb layout, so rebuilding it on
    // every drag frame would waste the frame budget — diff first.
    const rig = this.app.treeRig;
    const visible = state.skeleton.limbs.filter((l) => l.kind !== 'trunk' && l.kind !== 'twig');
    const prunedSet = new Set(state.shape.pruned);
    const sig = `${state.skeleton.limbs.length}|${state.shape.pruned.slice().sort().join(',')}|${state.skeleton.nodes.length}`;
    if (sig === this.branchSig) {
      const prunedCount = state.shape.pruned.length;
      this.cards.find((c) => c.root.dataset.card === 'branches')?.setAccent(prunedCount ? `已剪 ${prunedCount}` : `${visible.length} 条`);
      return;
    }
    this.branchSig = sig;
    const rows: HTMLElement[] = [];
    for (const limb of visible) {
      const gone = !rig.limbVisible[limb.id];
      const directlyPruned = prunedSet.has(limb.id);
      const dot = el('span', { class: 'dot', style: { background: limb.kind === 'primary' ? '#7cc47a' : '#6ba7c9' } });
      const name = el('span', { class: 'name', text: `${limb.kind === 'primary' ? '一级枝' : '二级枝'} #${limb.id}` });
      const meta = el('span', { class: 'meta', text: gone ? (directlyPruned ? '已剪除' : '父枝已剪') : `${limb.nodes.length} 节` });
      const btn = el('button', { class: 'mini-btn', type: 'button', text: gone ? '恢复' : '剪除' }) as HTMLButtonElement;
      if (gone && !directlyPruned) {
        btn.disabled = true;
        btn.textContent = '—';
      } else {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (gone) this.app.restoreLimb(limb.id);
          else this.app.pruneLimb(limb.id);
        });
      }
      const row = el('div', { class: `row${nodeId !== null && state.skeleton.nodes[nodeId]?.limb === limb.id ? ' selected' : ''}` }, [dot, name, meta, btn]);
      const tip = limb.nodes[limb.nodes.length - 1];
      row.addEventListener('click', () => {
        const controlTip = state.skeleton.controls.includes(tip) ? tip : limb.nodes.find((n) => state.skeleton.controls.includes(n));
        if (controlTip !== undefined) this.app.setSelectedControl(controlTip);
      });
      if (gone) row.style.opacity = '0.5';
      rows.push(row);
    }
    this.branchList.replaceChildren(...rows);
    const prunedCount = state.shape.pruned.length;
    this.cards.find((c) => c.root.dataset.card === 'branches')?.setAccent(prunedCount ? `已剪 ${prunedCount}` : `${visible.length} 条`);
  }
}

// ---------------------------------------------------------------------------
// Foliage controls
// ---------------------------------------------------------------------------

export class FoliagePanel {
  readonly root: HTMLElement;
  private cards: Card[] = [];
  private statsEl: HTMLElement;
  private depthBars: HTMLElement;
  private depthSig = '';

  constructor(private app: App) {
    this.root = el('div');
    this.statsEl = el('div', { class: 'stat-grid' });
    this.depthBars = el('div');

    const params = new Card({ title: '枝叶生成', accent: '', id: 'foliage' });
    params.setBody([
      el('p', { class: 'hint', html: '叶簇按骨架自动铺设，<strong>叶片数与分枝层级相关</strong>——一级枝叶团最大，细枝最密。半透明叶片按深度排序绘制，避免穿插。' }),
      slider({ label: '叶量密度', min: 0.3, max: 3.2, step: 0.05, value: app.state.foliage.density, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => app.setFoliageParam('density', v) }),
      slider({ label: '叶片大小', min: 0.6, max: 3, step: 0.05, value: app.state.foliage.size, format: (v) => `${v.toFixed(2)}`, onInput: (v) => app.setFoliageParam('size', v) }),
      slider({ label: '叶色色相', min: 0, max: 1, step: 0.01, value: app.state.foliage.hue, format: (v) => `${(v * 360).toFixed(0)}°`, onInput: (v) => app.setFoliageParam('hue', v) }),
      slider({ label: '叶团蓬松', min: 0, max: 1, step: 0.02, value: app.state.foliage.fluff, format: (v) => v.toFixed(2), onInput: (v) => app.setFoliageParam('fluff', v) }),
      slider({ label: '透明度', min: 0.3, max: 1, step: 0.01, value: app.state.foliage.opacity, format: (v) => `${(v * 100).toFixed(0)}%`, onInput: (v) => app.setFoliageParam('opacity', v) }),
    ]);
    this.cards.push(params);

    const stats = new Card({ title: '叶量分布', accent: 'depth', id: 'leafstats' });
    stats.setBody([this.statsEl, this.depthBars]);
    this.cards.push(stats);

    for (const c of this.cards) this.root.appendChild(c.root);
  }

  update(state: AppState): void {
    const byDepth = state.leaves.byDepth;
    const total = state.leaves.leaves.length;
    const depthNames: Record<number, string> = { 1: '一级枝叶', 2: '二级枝叶', 3: '细枝叶' };
    this.statsEl.replaceChildren(
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: '叶片总数' }), el('div', { class: 'v', text: String(total) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: '绘制批次' }), el('div', { class: 'v', text: '1 批', html: '1 <small>批</small>' })]),
    );
    const sig = `${byDepth[1] ?? 0}|${byDepth[2] ?? 0}|${byDepth[3] ?? 0}`;
    if (sig !== this.depthSig) {
      this.depthSig = sig;
      const max = Math.max(1, ...[1, 2, 3].map((d) => byDepth[d] ?? 0));
      const rows: HTMLElement[] = [];
      for (const d of [1, 2, 3]) {
        const n = byDepth[d] ?? 0;
        rows.push(el('div', { class: 'meter-row' }, [
          el('span', { class: 'meter-label', text: depthNames[d] }),
          el('div', { class: 'meter-track' }, [el('div', { class: 'meter-fill', style: { width: `${((n / max) * 100).toFixed(1)}%` } })]),
          el('span', { class: 'meter-val', text: String(n) }),
        ]));
      }
      this.depthBars.replaceChildren(...rows);
    }
    this.cards.find((c) => c.root.dataset.card === 'leafstats')?.setAccent(`${total} 片`);
  }
}

// ---------------------------------------------------------------------------
// Right: pot + balance
// ---------------------------------------------------------------------------

export class PotPanel {
  readonly root: HTMLElement;
  private cards: Card[] = [];
  private balanceBody: HTMLElement;
  private massBody: HTMLElement;
  private statusBadge: HTMLElement;
  private marker: HTMLElement;
  private marginText: HTMLElement;
  private tipText: HTMLElement;
  private potInfo: HTMLElement;
  private massSig = '';
  private styleChips!: HTMLElement;
  private autoBalanceToggle!: HTMLElement;
  private grooveToggle!: HTMLElement;

  constructor(private app: App) {
    this.root = el('div');

    const balanceCard = new Card({ title: '重心与稳定', accent: '', id: 'balance' });
    this.statusBadge = el('span', { class: 'badge stable', text: '稳定' });
    this.marker = el('div', { class: 'marker' });
    this.marginText = el('span', { class: 'hud-val', text: '—' });
    this.tipText = el('span', { class: 'hud-val', text: '—' });
    this.massBody = el('div', { class: 'rows' });
    const bar = el('div', { class: 'balance-bar' }, [el('div', { class: 'center' }), this.marker]);
    this.balanceBody = el('div', {}, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } }, [
        this.statusBadge,
        el('span', { class: 'field-label', text: '合成重心投影' }),
      ]),
      bar,
      el('div', { class: 'balance-legend' }, [el('span', { text: '外倾' }), el('span', { text: '盆沿' }), el('span', { text: '中心' }), el('span', { text: '盆沿' }), el('span', { text: '外倾' })]),
      el('div', { class: 'hud', style: { marginTop: '9px', background: 'transparent', border: 'none', padding: '0' } }, [
        el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '支撑裕度' }), this.marginText]),
        el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '倾覆角' }), this.tipText]),
      ]),
    ]);
    balanceCard.setBody([this.balanceBody, this.massBody]);
    this.cards.push(balanceCard);

    const potCard = new Card({ title: '盆钵造型', accent: '', id: 'pot' });
    this.potInfo = el('div', { class: 'hint' });
    this.styleChips = chips(
      app.potStyles().map((s) => ({ value: s.id, label: s.label })),
      app.state.pot.style,
      (v) => app.setPotStyle(v),
    );
    this.autoBalanceToggle = toggle({
      label: '自动配重（调整重心）',
      checked: app.state.pot.autoBalance,
      onChange: (v) => app.setPotParam('autoBalance', v),
    });
    potCard.setBody([
      el('p', { class: 'hint', html: '盆钵由 <strong>manifold-3d</strong> 进行实体布尔运算：外壁挖空、圈足、排水孔与装饰刻线均为真实几何。' }),
      this.styleChips,
      el('div', { style: { height: '10px' } }),
      slider({ label: '盆口半径', min: 9, max: 32, step: 0.25, value: app.state.pot.topRadius, format: (v) => `${v.toFixed(1)} cm`, onInput: (v) => app.setPotParam('topRadius', v) }),
      slider({ label: '盆高', min: 5, max: 26, step: 0.25, value: app.state.pot.height, format: (v) => `${v.toFixed(1)} cm`, onInput: (v) => app.setPotParam('height', v) }),
      slider({ label: '壁厚', min: 0.45, max: 2.6, step: 0.05, value: app.state.pot.wall, format: (v) => `${v.toFixed(2)} cm`, onInput: (v) => app.setPotParam('wall', v) }),
      slider({ label: '底径比例', min: 0.42, max: 1.0, step: 0.01, value: app.state.pot.baseRatio, format: (v) => `${(v * 100).toFixed(0)}%`, onInput: (v) => app.setPotParam('baseRatio', v) }),
      slider({ label: '腹部鼓度', min: 0, max: 0.5, step: 0.01, value: app.state.pot.belly, format: (v) => v.toFixed(2), onInput: (v) => app.setPotParam('belly', v) }),
      slider({ label: '圈足高度', min: 0, max: 5, step: 0.1, value: app.state.pot.footHeight, format: (v) => `${v.toFixed(1)} cm`, onInput: (v) => app.setPotParam('footHeight', v) }),
      slider({ label: '排水孔', min: 0, max: 5, step: 0.1, value: app.state.pot.drainage, format: (v) => (v < 0.25 ? '无' : `${v.toFixed(1)} cm`), onInput: (v) => app.setPotParam('drainage', v) }),
      el('div', { style: { height: '6px' } }),
      (this.grooveToggle = toggle({ label: '装饰刻线 / 莲瓣', checked: app.state.pot.groove, onChange: (v) => app.setPotParam('groove', v) })),
      this.autoBalanceToggle,
      this.potInfo,
    ]);
    this.cards.push(potCard);

    for (const c of this.cards) this.root.appendChild(c.root);
  }

  update(state: AppState): void {
    // Keep the style chips and the auto-balance switch honest after import / reset.
    syncChips(this.styleChips, state.pot.style);
    syncToggle(this.autoBalanceToggle, state.pot.autoBalance);
    syncToggle(this.grooveToggle, state.pot.groove);
    const b = state.balance;
    const badge = this.statusBadge;
    if (!b) {
      badge.className = 'badge marginal';
      badge.textContent = '计算中';
      return;
    }
    badge.className = `badge ${b.status}`;
    badge.textContent = b.status === 'stable' ? '稳定' : b.status === 'marginal' ? '临界' : '倾向倾覆';
    // Marker: 0% at far edge, 50% at centre.
    const supportR = this.supportRadius(state);
    const pct = Math.max(0, Math.min(100, 50 + (b.margin / Math.max(1e-3, supportR)) * 50));
    this.marker.style.left = `${pct.toFixed(1)}%`;
    this.marginText.textContent = `${b.margin >= 0 ? '' : '-'}${Math.abs(b.margin).toFixed(1)} cm`;
    this.tipText.textContent = `${b.tipAngle.toFixed(1)}°`;
    // Mass rows are cheap but still DOM work: only redraw when a value actually moved.
    const sig = [b.treeMass, b.woodMass, b.leafMass, b.potMass, b.totalMass, b.totalCom[1]]
      .map((v) => Math.round(v * 10)).join(',');
    if (sig !== this.massSig) {
      this.massSig = sig;
      const rows = el('div', { class: 'rows', style: { marginTop: '9px' } }, [
        massRow('树体质量', b.treeMass),
        massRow('　木质', b.woodMass),
        massRow('　叶片', b.leafMass),
        massRow('盆钵质量', b.potMass),
        massRow('总质量', b.totalMass),
        massRow('重心高度', b.totalCom[1], ' cm'),
      ]);
      this.massBody.replaceChildren(rows);
    }
    const pot = state.potResult;
    if (pot) {
      this.potInfo.replaceChildren(
        el('div', { class: 'meter-row' }, [
          el('span', { class: 'meter-label', text: '盆体' }),
          el('span', { class: 'meter-val', style: { width: 'auto', flex: '1' }, text: `${(pot.volume / 1000).toFixed(2)} L · ${pot.mesh.indices.length / 3} 面` }),
          el('span', { class: 'meter-val', text: `${pot.buildMs.toFixed(0)} ms` }),
        ]),
      );
      const card = this.cards.find((c) => c.root.dataset.card === 'pot');
      card?.setAccent(`${(pot.mass / 1000).toFixed(2)} kg`);
    } else {
      this.potInfo.textContent = state.potBusy ? '盆钵布尔运算中…' : '盆钵待生成';
    }
  }

  private supportRadius(state: AppState): number {
    const pot = state.potResult;
    if (!pot || !pot.support.length) return 10;
    let r = 0;
    for (const [x, z] of pot.support) r = Math.max(r, Math.hypot(x, z));
    return Math.max(1, r);
  }
}

function massRow(label: string, grams: number, unit = ''): HTMLElement {
  return el('div', { class: 'hud-row' }, [
    el('span', { class: 'hud-key', text: label }),
    el('span', { class: 'hud-val', text: unit ? grams.toFixed(1) + unit : grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${grams.toFixed(0)} g` }),
  ]);
}
