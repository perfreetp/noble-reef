<script>
  import { store } from '../lib/store.svelte.js';
  import { spreadMetrics, slotFrame, resolveText } from '../lib/layout.js';

  let dragFrom = $state(null);
  let dragOver = $state(null);

  function onDragStart(e, index) {
    dragFrom = index;
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e, index) {
    e.preventDefault();
    dragOver = index;
  }
  function onDrop(e, index) {
    e.preventDefault();
    if (dragFrom !== null && dragFrom !== index) store.movePage(dragFrom, index);
    dragFrom = null;
    dragOver = null;
  }
  function onDragEnd() {
    dragFrom = null;
    dragOver = null;
  }

  function frameOf(page, slot) {
    return slotFrame(slot, store.doc.gutter);
  }
</script>

<section class="thumbs panel-section">
  <div style="display:flex;align-items:center;padding:8px 14px 4px;">
    <div class="section-title" style="padding:0;">页面缩略图（拖动重排，页码自动更新）</div>
    <div style="flex:1"></div>
    <span class="small">共 {store.doc.pages.length} 个对开页 / {store.doc.pages.length * 2} 页</span>
  </div>

  <div class="thumb-scroll">
    {#each store.doc.pages as page, index (page.id)}
      {@const m = spreadMetrics(store.doc.gutter)}
      <div class="thumb-card"
        class:active={index === store.pageIndex}
        class:dragging={dragFrom === index}
        class:dragover={dragOver === index && dragFrom !== index}
        draggable="true"
        ondragstart={(e) => onDragStart(e, index)}
        ondragover={(e) => onDragOver(e, index)}
        ondrop={(e) => onDrop(e, index)}
        ondragend={onDragEnd}
        onclick={() => { store.select(index, null); }}
        role="button" tabindex="0">
        <div class="thumb-no">{index * 2 + 1}–{index * 2 + 2}</div>
        <svg viewBox="0 0 {m.width} {m.height}" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width="200" height={m.height} fill="#fff" stroke="#c9b8a3" stroke-width="1" />
          <rect x={200 + m.gutter} y="0" width="200" height={m.height} fill="#fff" stroke="#c9b8a3" stroke-width="1" />
          {#if m.gutter > 0}
            <rect x="200" y="0" width={m.gutter} height={m.height} fill="#e9e4dc" />
          {/if}
          {#each page.photoSlots as slot}
            {@const f = frameOf(page, slot)}
            <rect x={f.x} y={f.y} width={f.w} height={f.h}
              fill={slot.fill ? '#cfa97f' : '#f3f0ea'}
              stroke={slot.fill ? '#9a6d42' : '#c9b8a3'}
              stroke-width=".8"
              stroke-dasharray={slot.fill ? 'none' : '3 2'} />
          {/each}
          {#each page.textSlots as slot}
            {@const f = frameOf(page, slot)}
            <text x={f.x + f.w / 2} y={f.y + f.h * .7}
              text-anchor="middle" font-size="7" fill="#7c7061">
              {resolveText(slot, store.doc.variables, index).slice(0, 12)}
            </text>
          {/each}
        </svg>
        <div class="thumb-actions">
          <button class="mini danger" title="删除该对开页"
            disabled={store.doc.pages.length <= 1}
            onclick={(e) => { e.stopPropagation(); store.removePage(index); }}>
            删除
          </button>
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .thumb-scroll {
    display: flex;
    gap: 12px;
    padding: 6px 14px 12px;
    overflow-x: auto;
    flex: 1;
    min-height: 0;
  }
  .thumb-card {
    flex: 0 0 auto;
    width: 132px;
    background: #fff;
    border: 2px solid var(--line);
    border-radius: 8px;
    padding: 6px;
    cursor: grab;
    transition: border-color .15s, transform .15s, opacity .15s;
    position: relative;
  }
  .thumb-card:hover { border-color: var(--accent); }
  .thumb-card.active { border-color: var(--accent-dark); box-shadow: var(--shadow); }
  .thumb-card.dragging { opacity: .4; }
  .thumb-card.dragover { transform: translateX(4px); border-style: dashed; }
  .thumb-no {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent-dark);
    text-align: center;
    margin-bottom: 4px;
  }
  .thumb-card svg { display: block; width: 100%; height: auto; background: var(--panel-2); border-radius: 4px; }
  .thumb-actions { margin-top: 4px; text-align: center; }
  button.mini { font-size: 11px; padding: 2px 10px; }
</style>
