<script lang="ts">
  import { model } from '../lib/hair/model';
  import { commitBundleChange } from '../lib/hair/history';
  import { intersections, selection } from '../lib/state/stores';

  function shortId(id: string): string {
    return id.split('_')[1] ?? id;
  }

  function focusPair(a: string, b: string) {
    selection.set(new Set([a, b]));
  }

  /** 调整选中发束的层级顺序（穿插时决定谁在上） */
  function bumpLayer(delta: number) {
    const ids = [...$selection];
    if (!ids.length) return;
    commitBundleChange('调整层级', ids, () => {
      for (const id of ids) {
        const b = model.bundles.get(id);
        if (b) model.setLayer(id, b.layer + delta);
      }
    });
  }
</script>

<section class="panel">
  <h3>穿插提示（{$intersections.length}）</h3>
  {#if $intersections.length === 0}
    <p class="hint ok">未检测到发束穿插。</p>
  {:else}
    <p class="hint">以下发束存在穿插，可选中后调整层级顺序：</p>
    <ul>
      {#each $intersections.slice(0, 12) as pair (pair.a + pair.b)}
        <li>
          <button on:click={() => focusPair(pair.a, pair.b)}>
            #{shortId(pair.a)} ↔ #{shortId(pair.b)}
            <span class="dim">（间距 {pair.distance.toFixed(3)}）</span>
          </button>
        </li>
      {/each}
      {#if $intersections.length > 12}
        <li class="dim">… 共 {$intersections.length} 处</li>
      {/if}
    </ul>
    <div class="row">
      <button disabled={$selection.size === 0} on:click={() => bumpLayer(1)}>层级上移</button>
      <button disabled={$selection.size === 0} on:click={() => bumpLayer(-1)}>层级下移</button>
    </div>
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
    margin: 0 0 6px;
    font-size: 11px;
    color: #e0a050;
  }
  .hint.ok {
    color: #6fbf6f;
  }
  ul {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    max-height: 140px;
    overflow-y: auto;
  }
  li {
    margin: 2px 0;
  }
  button {
    background: #2c2f36;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .dim {
    color: #888;
  }
  .row {
    display: flex;
    gap: 6px;
  }
</style>
