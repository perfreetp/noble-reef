<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { ui } from '../lib/ui-state.svelte';

  // 单选时的代表喷头
  let first = $derived(ui.selection.size === 1 ? store.nozzleById([...ui.selection][0]) : null);

  let angleDraft = $state(0);
  // 选择变化时同步草稿
  $effect(() => {
    if (first) angleDraft = first.angle;
  });

  function applyAngle(v: number) {
    if (!first) return;
    // 单个喷头的角度调整直接走一次提交
    store.commit((d) => {
      const n = d.nozzles.find((x) => x.id === first.id);
      if (n) n.angle = ((v % 360) + 360) % 360;
    });
  }

  function assignAll(groupId: string) {
    store.assignGroup(ui.selection, groupId);
  }

  function rotateAll(delta: number) {
    store.commit((d) => {
      for (const n of d.nozzles) {
        if (ui.selection.has(n.id)) n.angle = (n.angle + delta + 360) % 360;
      }
    });
  }

  function nudge(dx: number, dy: number) {
    store.commit((d) => {
      for (const n of d.nozzles) {
        if (ui.selection.has(n.id)) {
          n.x = Math.round((n.x + dx) * 10) / 10;
          n.y = Math.round((n.y + dy) * 10) / 10;
        }
      }
    });
  }
</script>

<div class="panel-section">
  <h3>喷头属性（{ui.selection.size}）</h3>

  {#if ui.selection.size === 0}
    <p class="hint">点击或框选喷头进行编辑。拖动喷头移动位置，拖动黄色圆点手柄调整朝向。</p>
  {:else}
    {#if first}
      <label class="field"><span>X 坐标(cm) <b>{Math.round(first.x)}</b></span>
        <input type="number" value={first.x} onchange={(e) => store.commit((d) => {
          const n = d.nozzles.find((x) => x.id === first.id);
          if (n) n.x = Number(e.currentTarget.value);
        })} />
      </label>
      <label class="field"><span>Y 坐标(cm) <b>{Math.round(first.y)}</b></span>
        <input type="number" value={first.y} onchange={(e) => store.commit((d) => {
          const n = d.nozzles.find((x) => x.id === first.id);
          if (n) n.y = Number(e.currentTarget.value);
        })} />
      </label>
      <label class="field"><span>朝向角度(°) <b>{Math.round(first.angle)}</b></span>
        <input type="range" min="0" max="359" bind:value={angleDraft} oninput={(e) => applyAngle(Number(e.currentTarget.value))} />
      </label>
      <div class="row">
        <button onclick={() => rotateAll(-15)}>↺ 15°</button>
        <button onclick={() => rotateAll(15)}>↻ 15°</button>
        <span class="spacer"></span>
        <button onclick={() => nudge(0, -store.doc.config.gridSize)}>↑</button>
        <button onclick={() => nudge(0, store.doc.config.gridSize)}>↓</button>
        <button onclick={() => nudge(-store.doc.config.gridSize, 0)}>←</button>
        <button onclick={() => nudge(store.doc.config.gridSize, 0)}>→</button>
      </div>
    {:else}
      <p class="hint">已选 {ui.selection.size} 个喷头，可批量指定分组或旋转。</p>
      <div class="row" style="margin-bottom:8px">
        <button onclick={() => rotateAll(-15)}>↺ 15°</button>
        <button onclick={() => rotateAll(15)}>↻ 15°</button>
      </div>
    {/if}

    <label class="field"><span>批量指定分组</span>
      <select onchange={(e) => assignAll(e.currentTarget.value)} value={first?.groupId ?? ''}>
        <option value="">— 未分组 —</option>
        {#each store.doc.groups as g (g.id)}
          <option value={g.id}>{g.name}</option>
        {/each}
      </select>
    </label>

    <div class="row">
      <span class="spacer"></span>
      <button class="danger" onclick={() => {
        store.removeNozzles(ui.selection);
        ui.clearSelection();
      }}>删除选中（Del）</button>
    </div>
  {/if}
</div>
