import './styles/app.css';
import { App } from './app/app';
import { registerControls } from './ui/components';
import type { AppState } from './app/app';
import { el } from './ui/dom';
import { toast, modal } from './ui/toast';
import { createModeBar, createStageHud, FoliagePanel, modeHint, PotPanel, ShapePanel } from './ui/panels';

// Custom elements must exist before any panel builds its DOM.
registerControls();

const root = document.getElementById('app')!;
root.innerHTML = '';

const shell = el('div', { class: 'bonsai-shell' });
const stage = el('div', { class: 'stage' });
shell.appendChild(stage);

// --- build the chrome first so the canvas has a sized parent -----------------

const topbar = el('header', { class: 'topbar' });
const brand = el('div', { class: 'brand' }, [
  el('div', { class: 'brand-mark' }),
  el('div', {}, [el('div', { class: 'brand-title', text: '盆景造型台' }), el('div', { class: 'brand-sub', text: 'BONSAI STUDIO' })]),
]);
topbar.appendChild(brand);

const left = el('aside', { class: 'panel panel-left' });
const right = el('aside', { class: 'panel panel-right' });
const statusbar = el('footer', { class: 'statusbar' });
shell.append(topbar, left, right, statusbar);
root.appendChild(shell);

const app = new App(stage);

// --- mode bar ---------------------------------------------------------------

const modeBar = createModeBar(app);
topbar.appendChild(modeBar.root);

const spacer = el('div', { class: 'spacer' });
topbar.appendChild(spacer);

const helpBtn = el('button', { class: 'btn ghost', type: 'button', text: '使用帮助' });
const exportBtn = el('button', { class: 'btn primary', type: 'button', text: '导出文件' });
const importBtn = el('button', { class: 'btn', type: 'button', text: '导入' });
const resetBtn = el('button', { class: 'btn ghost', type: 'button', text: '重置' });
const topActions = el('div', { class: 'top-actions' }, [importBtn, exportBtn, resetBtn, helpBtn]);
topbar.appendChild(topActions);

// --- panels -----------------------------------------------------------------

const shapePanel = new ShapePanel(app);
const foliagePanel = new FoliagePanel(app);
const potPanel = new PotPanel(app);
left.append(shapePanel.root, foliagePanel.root);
right.append(potPanel.root);

// --- stage overlays ---------------------------------------------------------

const loading = el('div', { class: 'loading-veil' }, [
  el('div', {}, [el('div', { class: 'spinner' }), el('div', { text: '正在加载几何内核与生成树木…' })]),
]);
stage.appendChild(loading);

const hudTL = el('div', { class: 'stage-overlay stage-tl' });
const hudTR = el('div', { class: 'stage-overlay stage-tr' });
const helpHint = el('div', { class: 'mode-help', text: modeHint('shape') });
const dropZone = el('div', { class: 'file-drop', text: '松开以导入盆景文件' });
stage.append(hudTL, hudTR, helpHint, dropZone);

const poseHud = createStageHud('shape');
hudTL.appendChild(poseHud);

const perfHud = el('div', { class: 'hud' }, [
  el('div', { class: 'hud-title', text: '实时性能' }),
  el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '拖动一帧' }), el('span', { class: 'hud-val', 'data-perf': 'total', text: '—' })]),
  el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '骨架' }), el('span', { class: 'hud-val', 'data-perf': 'pose', text: '—' })]),
  el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '枝叶' }), el('span', { class: 'hud-val', 'data-perf': 'leaves', text: '—' })]),
  el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '重心' }), el('span', { class: 'hud-val', 'data-perf': 'balance', text: '—' })]),
  el('div', { class: 'hud-row' }, [el('span', { class: 'hud-key', text: '盆钵(后台)' }), el('span', { class: 'hud-val', 'data-perf': 'pot', text: '—' })]),
]);
hudTR.appendChild(perfHud);

const tooltip = el('div', { class: 'tooltip' });
stage.appendChild(tooltip);

// --- status bar -------------------------------------------------------------

const statusSegs = {
  save: el('div', { class: 'seg' }, [el('span', { class: 'status-dot' }), el('span', { 'data-status': 'save', text: '未保存' })]),
  counts: el('div', { class: 'seg' }, [el('span', { 'data-status': 'counts', text: '—' })]),
  balance: el('div', { class: 'seg' }, [el('span', { class: 'status-dot idle' }), el('span', { 'data-status': 'balance', text: '重心计算中' })]),
  perf: el('div', { class: 'seg' }, [el('span', { 'data-status': 'perf', text: '—' })]),
  pot: el('div', { class: 'seg' }, [el('span', { 'data-status': 'pot', text: '盆钵 —' })]),
};
statusbar.append(
  statusSegs.save, el('div', { class: 'divider' }),
  statusSegs.counts, el('div', { class: 'divider' }),
  statusSegs.balance, el('div', { class: 'divider' }),
  statusSegs.perf, el('div', { class: 'divider' }),
  statusSegs.pot,
  el('div', { class: 'spacer' }),
  el('div', { class: 'seg' }, [el('span', { text: 'Manifold WASM · WebGL2' })]),
);

// --- wiring -----------------------------------------------------------------

const perfEls = {
  total: perfHud.querySelector('[data-perf=total]') as HTMLElement,
  pose: perfHud.querySelector('[data-perf=pose]') as HTMLElement,
  leaves: perfHud.querySelector('[data-perf=leaves]') as HTMLElement,
  balance: perfHud.querySelector('[data-perf=balance]') as HTMLElement,
  pot: perfHud.querySelector('[data-perf=pot]') as HTMLElement,
};

function fmtMs(v: number): string {
  return v > 0 ? `${v.toFixed(1)} ms` : '—';
}

function perfClass(v: number): string {
  if (v <= 0) return '';
  if (v < 60) return 'perf-good';
  if (v < 200) return 'perf-warn';
  return 'perf-bad';
}

let lastRenderMode: AppState['mode'] | null = null;

function render(state: AppState): void {
  shapePanel.update(state);
  foliagePanel.update(state);
  potPanel.update(state);
  modeBar.setMode(state.mode);
  if (state.mode !== lastRenderMode) {
    helpHint.textContent = modeHint(state.mode);
    lastRenderMode = state.mode;
  }
  perfEls.total.textContent = fmtMs(state.perf.totalMs);
  perfEls.total.className = `hud-val ${perfClass(state.perf.totalMs)}`;
  perfEls.pose.textContent = fmtMs(state.perf.poseMs);
  perfEls.leaves.textContent = fmtMs(state.perf.foliageMs);
  perfEls.balance.textContent = fmtMs(state.perf.balanceMs);
  perfEls.pot.textContent = fmtMs(state.perf.potMs);

  const saveEl = statusbar.querySelector('[data-status=save]') as HTMLElement;
  saveEl.textContent = app.storageSupported ? app.savedAgo : '本地存储在隐私模式下不可用';
  (statusbar.querySelector('[data-status=counts]') as HTMLElement).textContent =
    `${state.skeleton.controls.length} 控制点 · ${state.skeleton.limbs.length - 1} 枝 · ${state.leaves.leaves.length} 叶`;
  const balEl = statusbar.querySelector('[data-status=balance]') as HTMLElement;
  const balDot = statusSegs.balance.querySelector('.status-dot') as HTMLElement;
  if (state.balance) {
    balEl.textContent = state.balance.status === 'stable' ? '重心稳定' : state.balance.status === 'marginal' ? '重心临界' : '重心出界';
    balDot.className = `status-dot ${state.balance.status === 'stable' ? '' : state.balance.status === 'marginal' ? 'warn' : 'err'}`;
  }
  const perfEl = statusbar.querySelector('[data-status=perf]') as HTMLElement;
  perfEl.textContent = `帧 ${fmtMs(state.perf.totalMs)}`;
  const potEl = statusbar.querySelector('[data-status=pot]') as HTMLElement;
  potEl.textContent = state.potBusy
    ? '盆钵 计算中…'
    : state.potResult
      ? `盆钵 ${state.potResult.params.style} · ${state.potResult.mesh.indices.length / 3} 面`
      : '盆钵 —';
  if (state.lastError) {
    toast(state.lastError, 'error');
    state.lastError = null;
  }
}

app.subscribe(render);

// --- buttons ----------------------------------------------------------------

exportBtn.addEventListener('click', () => {
  const project = app.exportFile();
  const kb = (JSON.stringify(project).length / 1024).toFixed(0);
  toast(`已导出：骨架 ${project.skeleton.nodes.length} 节点 · 叶片 ${project.stats.leaves} 片 · 盆钵网格${project.potData ? '已包含' : '缺失'}（${kb} KB）`, 'success', 3600);
});

importBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await app.importFile(file);
      toast(`已导入 ${file.name}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败', 'error', 3600);
    }
  });
  input.click();
});

resetBtn.addEventListener('click', () => {
  modal('重置作品', (body) => {
    body.append(el('p', { text: '将清除当前所有弯曲、扭转、修剪与盆钵设置，重新生成默认树形。此操作不可撤销。' }));
  }, [
    { label: '取消' },
    {
      label: '确认重置',
      primary: true,
      onClick: () => {
        app.resetAll();
        toast('已重置为默认树形', 'success');
      },
    },
  ]);
});

helpBtn.addEventListener('click', () => {
  modal('盆景造型台 · 使用指南', (body) => {
    body.append(
      (() => {
        const h = el('h4', { text: '骨架塑形' });
        return h;
      })(),
      el('ul', {}, [
        el('li', { html: '拖拽浅蓝色<strong>控制点</strong>弯曲枝干；弯曲沿骨架向下游传播，子枝随父枝形变。' }),
        el('li', { html: '按住 <code>Shift</code> 拖动同一控制点：绕枝轴<strong>扭转</strong>，叶片随之转动。' }),
        el('li', { html: '全树约 <strong>30 个控制点</strong>，绿色表示已弯曲，橙色表示已扭转。' }),
      ]),
      el('h4', { text: '分枝修剪' }),
      el('ul', {}, [
        el('li', { text: '切换到「分枝修剪」，点击任意枝干即可剪除。' }),
        el('li', { text: '下游枝条与叶片同步消失，整树重心立即重算，可在左侧「分枝层级」中恢复。' }),
      ]),
      el('h4', { text: '枝叶生成' }),
      el('ul', {}, [
        el('li', { text: '叶簇沿骨架自动铺设，叶片数量按一级枝 > 二级枝 > 细枝递减，密集处按深度排序绘制。' }),
        el('li', { text: '叶片使用半透明材质，可从背面透出层次。' }),
      ]),
      el('h4', { text: '盆钵与重心' }),
      el('ul', {}, [
        el('li', { text: '盆钵使用 manifold-3d 做挖空、圈足、排水孔与刻线等布尔运算，在后台线程计算。' }),
        el('li', { text: '盆钵重心与整树重心合成后判断稳定倾向；拖动主干时重心指示同步移动。' }),
        el('li', { text: '「自动配重」会在盆底布置钢质配重块，把合成重心拉回支撑面内。' }),
      ]),
      el('h4', { text: '保存与分享' }),
      el('ul', {}, [
        el('li', { text: '编辑内容自动保存在浏览器本地，刷新后自动恢复。' }),
        el('li', { text: '「导出文件」生成包含骨架、枝叶分布与盆钵网格的 JSON，可直接分享给他人导入。' }),
      ]),
    );
  });
});

// --- drag & drop import ------------------------------------------------------

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dropZone.classList.add('active');
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropZone.classList.remove('active');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('active');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.json$/i.test(file.name)) {
    toast('请拖入 .json 盆景文件', 'error');
    return;
  }
  try {
    await app.importFile(file);
    toast(`已导入 ${file.name}`, 'success');
  } catch (err) {
    toast(err instanceof Error ? err.message : '导入失败', 'error', 3600);
  }
});

// --- keyboard ---------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (e.key === '1') app.setMode('shape');
  else if (e.key === '2') app.setMode('prune');
  else if (e.key === '3') app.setMode('inspect');
  else if (e.key === 'f' || e.key === 'F') app.frameAll();
  else if (e.key === 'Escape') app.setSelectedControl(null);
});

// --- lifecycle --------------------------------------------------------------

const ro = new ResizeObserver(() => app.viewer.resize());
ro.observe(stage);

window.addEventListener('beforeunload', () => app.flushPersist());

requestAnimationFrame(() => {
  app.viewer.resize();
  loading.classList.add('gone');
  window.setTimeout(() => loading.remove(), 400);
  toast('已载入工作台 · 拖动控制点开始造型', 'info', 3200);
});

// expose for diagnostics / automated checks
(window as unknown as { bonsai: unknown }).bonsai = { app };

