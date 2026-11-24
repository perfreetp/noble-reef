<script lang="ts">
  import { model } from '../lib/hair/model';
  import { commitGroupCreate, commitGroupDissolve } from '../lib/hair/history';
  import { activeGroupId, modelVersion, selection } from '../lib/state/stores';

  let groupList: { id: string; name: string; count: number }[] = [];
  $: if ($modelVersion >= 0) {
    groupList = [...model.groups.values()].map((g) => ({
      id: g.id,
      name: g.name,
      count: g.memberIds.length,
    }));
  }

  let nextName = 1;

  function makeGroup() {
    const ids = [...$selection];
    if (ids.length < 2) return;
    const gid = commitGroupCreate(`发束组 ${nextName++}`, ids);
    activeGroupId.set(gid);
  }

  function selectGroup(id: string) {
    const g = model.groups.get(id);
    if (!g) return;
    selection.set(new Set(g.memberIds));
    activeGroupId.set(id);
  }

  function dissolve(id: string) {
    commitGroupDissolve(id);
    if ($activeGroupId === id) activeGroupId.set(null);
  }
</script>

<section class="panel">
  <h3>分组</h3>
  <button disabled={$selection.size < 2} on:click={makeGroup}>
    将选中 {$selection.size} 束成组
  </button>
  {#if groupList.length === 0}
    <p class="hint">暂无分组。多选发束后可成组，组内调整互相联动。</p>
  {:else}
    <ul>
      {#each groupList as g (g.id)}
        <li class:active={$activeGroupId === g.id}>
          <button class="name" on:click={() => selectGroup(g.id)}>
            {g.name}（{g.count}）
          </button>
          <button class="danger" title="解散组" on:click={() => dissolve(g.id)}>解散</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if $activeGroupId}
    <button class="link" on:click={() => activeGroupId.set(null)}>退出组编辑</button>
  {/if}
</section>

<style>
  .panel {
    padding: 10px 12px;
    border-bottom: 1px solid #333;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 13px;
    color: #ddd;
  }
  .hint {
    margin: 6px 0 0;
    font-size: 11px;
    color: #888;
  }
  button {
    background: #2c2f36;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  li {
    display: flex;
    gap: 6px;
    margin: 3px 0;
  }
  li.active .name {
    border-color: #ff8c1a;
    color: #ff8c1a;
  }
  .name {
    flex: 1;
    text-align: left;
  }
  .danger {
    color: #ff7a7a;
  }
  .link {
    margin-top: 6px;
    background: none;
    border: none;
    color: #7ab3ff;
    padding: 0;
  }
</style>
