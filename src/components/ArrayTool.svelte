<script lang="ts">
  import { getEngine } from '../lib/engine-registry';
  import { store } from '../lib/store.svelte';
  import { ui, type ToolId } from '../lib/ui-state.svelte';
  import type { RectArraySpec, RingArraySpec } from '../lib/types';

  // 矩形阵列参数（本地草稿，确认放置时才写入工程）
  let rect = $state<RectArraySpec>({
    rows: 6,
    cols: 10,
    spacingX: 120,
    spacingY: 120,
    angle: 0,
    groupId: ''
  });
  let ring = $state<RingArraySpec>({
    count: 24,
    radius: 400,
    startAngle: 0,
    fullCircle: true,
    sweep: 180,
    orientation: 'radial',
    fixedAngle: 90,
    groupId: ''
  });
  let snap = $state(false);

  const tools: { id: ToolId; label: string; icon: string }[] = [
    { id: 'select', label: '选择/拖动', icon: '➤' },
    { id: 'addSingle', label: '单喷头', icon: '◉' },
    { id: 'addRect', label: '矩形阵列', icon: '▦' },
    { id: 'addRing', label: '环形阵列', icon: '◯' }
  ];

  function chooseTool(t: ToolId) {
    ui.tool = t;
    syncGhost();
  }

  function syncGhost() {
    const engine = getEngine();
    if (!engine) return;
    engine.setSnap(snap);
    if (ui.tool === 'addRect') {
      engine.ghostSpec = { kind: 'rect', spec: { ...rect, groupId: ui.activeGroupId } };
    } else if (ui.tool === 'addRing') {
      engine.ghostSpec = { kind: 'ring', spec: { ...ring, groupId: ui.activeGroupId } };
    } else {
      engine.ghostSpec = null;
    }
  }

  // 参数变化时刷新预览
  $effect(() => {
    rect.rows;
    rect.cols;
    rect.spacingX;
    rect.spacingY;
    rect.angle;
    ring.count;
    ring.radius;
    ring.startAngle;
    ring.fullCircle;
    ring.sweep;
    ring.orientation;
    ring.fixedAngle;
    ui.activeGroupId;
    syncGhost();
  });

  const rectCount = $derived(rect.rows * rect.cols);
</script>

<div class="panel-section">
  <h3>布置工具</h3>
  <div class="tool-grid">
    {#each tools as t (t.id)}
      <button class:active={ui.tool === t.id} onclick={() => chooseTool(t.id)}>
        <span class="ticon">{t.icon}</span>
        {t.label}
      </button>
    {/each}
  </div>

  <label class="check">
    <input type="checkbox" bind:checked={snap} onchange={syncGhost} />
    网格吸附（{store.doc.config.gridSize} cm）
  </label>

  {#if ui.tool === 'addRect'}
    <div class="spec">
      <h4>矩形阵列 · 预览 {rectCount} 个</h4>
      <label class="field"><span>列数 X <b>{rect.cols}</b></span>
        <input type="range" min="1" max="80" bind:value={rect.cols} />
      </label>
      <label class="field"><span>行数 Y <b>{rect.rows}</b></span>
        <input type="range" min="1" max="80" bind:value={rect.rows} />
      </label>
      <label class="field"><span>列间距(cm) <b>{rect.spacingX}</b></span>
        <input type="range" min="20" max="1000" step="10" bind:value={rect.spacingX} />
      </label>
      <label class="field"><span>行间距(cm) <b>{rect.spacingY}</b></span>
        <input type="range" min="20" max="1000" step="10" bind:value={rect.spacingY} />
      </label>
      <label class="field"><span>整体旋转角(°) <b>{rect.angle}</b></span>
        <input type="range" min="-180" max="180" bind:value={rect.angle} />
      </label>
    </div>
  {:else if ui.tool === 'addRing'}
    <div class="spec">
      <h4>环形阵列 · 预览 {ring.count} 个</h4>
      <label class="field"><span>喷头数量 <b>{ring.count}</b></span>
        <input type="range" min="1" max="400" bind:value={ring.count} />
      </label>
      <label class="field"><span>半径(cm) <b>{ring.radius}</b></span>
        <input type="range" min="50" max="2000" step="10" bind:value={ring.radius} />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={ring.fullCircle} />
        整圆均布
      </label>
      {#if !ring.fullCircle}
        <label class="field"><span>起始角(°) <b>{ring.startAngle}</b></span>
          <input type="range" min="0" max="359" bind:value={ring.startAngle} />
        </label>
        <label class="field"><span>扫掠角(°) <b>{ring.sweep}</b></span>
          <input type="range" min="10" max="360" bind:value={ring.sweep} />
        </label>
      {/if}
      <label class="field"><span>喷头朝向</span>
        <select bind:value={ring.orientation}>
          <option value="radial">沿半径向外</option>
          <option value="tangent">切线方向</option>
          <option value="fixed">统一固定角</option>
        </select>
      </label>
      {#if ring.orientation === 'fixed'}
        <label class="field"><span>固定角(°) <b>{ring.fixedAngle}</b></span>
          <input type="range" min="0" max="359" bind:value={ring.fixedAngle} />
        </label>
      {/if}
    </div>
  {/if}

  {#if ui.tool !== 'select'}
    <p class="hint">
      在画布上点击位置放置{ui.tool === 'addSingle' ? '喷头' : '阵列'}
      {ui.activeGroupId ? '，归属当前选中分组' : '（未分组，可稍后批量指定）'}。
    </p>
    <button class="ghost full" onclick={() => chooseTool('select')}>完成（返回选择）</button>
  {/if}
</div>

<style>
  .tool-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 10px;
  }
  .tool-grid button {
    padding: 8px 4px;
    font-size: 12px;
  }
  .ticon {
    display: block;
    font-size: 15px;
    margin-bottom: 2px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-1);
    margin-bottom: 8px;
    cursor: pointer;
  }
  .check input {
    width: auto;
  }
  .spec {
    background: var(--bg-1);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px;
    margin-bottom: 8px;
  }
  h4 {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--accent);
  }
  .full {
    width: 100%;
  }
</style>
