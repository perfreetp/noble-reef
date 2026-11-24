<script>
  import { store } from '../lib/store.svelte.js';
  import { ZONE } from '../lib/constants.js';

  let { slot } = $props();

  const isSpread = $derived(!!slot.spread);
  const r = $derived(slot.spread ?? slot.rect);

  function update(field) {
    return (e) => {
      const v = Number(e.target.value);
      if (Number.isNaN(v)) return;
      store.resizeSlot(store.pageIndex, slot.id, { [field]: v });
    };
  }

  const fields = $derived(
    isSpread
      ? [
          ['x1', '距左页左边'],
          ['x2', '距右页右边'],
          ['y', '上边距'],
          ['h', '高度']
        ]
      : [
          ['x', slot.zone === ZONE.LEFT ? '左页内 X' : '右页内 X'],
          ['y', 'Y'],
          ['w', '宽度'],
          ['h', '高度']
        ]
  );
</script>

<div class="field">
  <label>槽位{isSpread ? '跨页' : '页内'}几何（mm）</label>
  <div class="geo-grid">
    {#each fields as [key, label]}
      <div class="geo-item">
        <span class="geo-label">{label}</span>
        <input type="number" step="1" min="0" value={r[key]} onchange={update(key)} />
      </div>
    {/each}
  </div>
</div>

<style>
  .geo-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .geo-item { display: flex; flex-direction: column; gap: 2px; }
  .geo-label { font-size: 10px; color: var(--ink-2); }
  .geo-item input { padding: 4px 8px; font-size: 12px; }
</style>
