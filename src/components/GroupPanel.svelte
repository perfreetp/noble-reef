<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { ui } from '../lib/ui-state.svelte';

  let newName = $state('');

  function addGroup() {
    const g = store.addGroup(newName.trim() || undefined);
    newName = '';
    ui.activeGroupId = g.id;
  }

  function countOf(id: string): number {
    let n = 0;
    for (const nz of store.doc.nozzles) if (nz.groupId === id) n++;
    return n;
  }

  function setActive(id: string) {
    ui.activeGroupId = ui.activeGroupId === id ? '' : id;
    ui.hoverGroupId = id;
  }
</script>

<div class="panel-section">
  <h3>喷头分组（{store.doc.groups.length}）</h3>
  <div class="group-list">
    {#each store.doc.groups as g (g.id)}
      {@const count = countOf(g.id)}
      <div
        class="group-row"
        role="listitem"
        class:active={ui.activeGroupId === g.id}
        class:hovered={ui.hoverGroupId === g.id}
        onmouseenter={() => (ui.hoverGroupId = g.id)}
        onmouseleave={() => (ui.hoverGroupId = '')}
      >
        <input
          type="color"
          value={g.color}
          oninput={(e) => store.recolorGroup(g.id, e.currentTarget.value)}
          title="分组颜色"
        />
        <input
          class="name"
          value={g.name}
          onchange={(e) => store.renameGroup(g.id, e.currentTarget.value || g.name)}
        />
        <span class="count tag">{count}</span>
        <button class="mini" class:on={ui.activeGroupId === g.id} onclick={() => setActive(g.id)} title="设为新喷头归属组">
          {ui.activeGroupId === g.id ? '✓' : '归'}
        </button>
        <button class="mini danger" onclick={() => confirm(`删除分组「${g.name}」？组内喷头变为未分组，时间轴色块一并删除。`) && store.removeGroup(g.id)} title="删除分组">✕</button>
      </div>
    {/each}
  </div>
  <div class="row add-row">
    <input placeholder="新分组名称" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && addGroup()} />
    <button class="primary" onclick={addGroup}>新建</button>
  </div>
  <p class="hint">悬停分组行，画布中该组喷头实时高亮；「归」设定新阵列/喷头的默认归属。</p>
</div>

<style>
  .group-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-height: 240px;
    overflow-y: auto;
    margin-bottom: 8px;
  }
  .group-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--bg-1);
  }
  .group-row.hovered {
    border-color: var(--line);
  }
  .group-row.active {
    border-color: var(--accent);
    background: rgba(31, 157, 240, 0.12);
  }
  .group-row input[type='color'] {
    width: 26px;
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .count {
    flex-shrink: 0;
    min-width: 34px;
    text-align: center;
  }
  .mini {
    width: 28px;
    height: 26px;
    padding: 0;
    font-size: 12px;
    flex-shrink: 0;
  }
  .mini.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .add-row {
    margin-top: 4px;
  }
</style>
