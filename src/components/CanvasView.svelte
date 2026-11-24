<script>
  import { onMount, onDestroy } from 'svelte';
  import { store } from '../lib/store.svelte.js';
  import { AlbumCanvas } from '../lib/albumCanvas.js';

  let canvasEl = $state(null);
  let scrollEl = $state(null);
  let album = null;
  let zoomPct = $state(100);
  let dropHint = $state(false);
  let fillTarget = $state(null);   // {pageIndex, slotId}
  let imgInput = $state(null);

  // 文档/选择/照片库变化都触发全量重绘；
  // 画布拖拽期间由 AlbumCanvas 自行做对象级轻量同步，此处跳过避免重复重建
  let docVersion = $derived(store.doc);
  let imageVersion = $derived(store.images);
  $effect(() => {
    void docVersion;
    void imageVersion;
    void store.selection.pageIndex;
    void store.selection.slotId;
    if (album && !album.drag) album.redraw();
  });

  onMount(() => {
    album = new AlbumCanvas(canvasEl, store, {
      requestFill: (pageIndex, slotId) => {
        fillTarget = { pageIndex, slotId };
        imgInput?.click();
      }
    });
    album.redraw();
  });

  onDestroy(() => album?.dispose());

  function setZoom(pct) {
    zoomPct = Math.max(25, Math.min(250, pct));
    album?.setZoom(zoomPct / 100);
  }

  async function onImagePicked(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    for (const file of files) {
      const id = await store.addImageFile(file);
      if (fillTarget) {
        store.fillPhoto(fillTarget.pageIndex, fillTarget.slotId, id);
        fillTarget = null;
        break;
      }
      // 否则填入当前页第一个空照片槽
      const page = store.currentPage;
      const empty = page?.photoSlots.find((s) => !s.fill);
      if (empty) store.fillPhoto(store.pageIndex, empty.id, id);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    dropHint = false;
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    const libImageId = e.dataTransfer?.getData('text/x-image-id');
    const hit = album?.slotAtClient(e.clientX, e.clientY) ?? null;

    (async () => {
      let imageId = libImageId;
      if (files.length) {
        imageId = await store.addImageFile(files[0]);
      }
      if (!imageId) return;
      // 优先填充落点槽位；落点不在槽位上时取当前页空槽/选中槽
      let target = hit;
      if (!target) {
        const page = store.currentPage;
        const slot = page?.photoSlots.find((s) => s.id === store.selection.slotId)
          ?? page?.photoSlots.find((s) => !s.fill);
        target = slot ? { pageIndex: store.pageIndex, slotId: slot.id } : null;
      }
      if (target) {
        store.select(target.pageIndex, target.slotId);
        store.fillPhoto(target.pageIndex, target.slotId, imageId);
      }
    })();
  }
</script>

<section class="canvas-wrap panel-section"
  ondragover={(e) => { e.preventDefault(); dropHint = true; }}
  ondragleave={() => (dropHint = false)}
  ondrop={onDrop}>
  <div class="canvas-toolbar">
    <div class="field-row" style="flex:0 0 auto;gap:6px;align-items:center;">
      <button onclick={() => setZoom(zoomPct - 15)} title="缩小">−</button>
      <input type="range" min="25" max="250" step="5" bind:value={zoomPct}
        onchange={() => setZoom(zoomPct)} style="width:120px" />
      <button onclick={() => setZoom(zoomPct + 15)} title="放大">+</button>
      <span class="range-val" style="width:46px">{zoomPct}%</span>
      <button onclick={() => setZoom(100)}>适应</button>
    </div>
    <div style="flex:1"></div>
    <button onclick={() => album?.scrollToPage(store.pageIndex)}>定位当前页</button>
    <button onclick={() => imgInput?.click()}>＋ 导入照片</button>
    <input type="file" accept="image/*" multiple bind:this={imgInput}
      style="display:none" onchange={onImagePicked} />
  </div>

  <div class="canvas-scroll" bind:this={scrollEl} class:drop-hint={dropHint}>
    <canvas bind:this={canvasEl}></canvas>
    {#if dropHint}
      <div class="drop-mask">松开鼠标，照片填入当前页槽位</div>
    {/if}
  </div>

  <div class="canvas-footer hint">
    拖动照片平移 · Ctrl/⌘ + 滚轮以指针为中心缩放 · 拖动红色焦点标记设定裁切焦点 ·
    拖动空槽/文字槽调整位置（自动吸附与间距回弹）· 双击空槽导入照片
  </div>
</section>

<style>
  .canvas-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .canvas-scroll {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg);
  }
  .canvas-scroll.drop-hint { outline: 2px dashed var(--accent); outline-offset: -8px; }
  .canvas-scroll canvas { display: block; }
  .drop-mask {
    position: absolute;
    inset: 20px;
    display: grid;
    place-items: center;
    background: rgba(255, 250, 243, .8);
    border: 2px solid var(--accent);
    border-radius: var(--radius);
    color: var(--accent-dark);
    font-weight: 600;
    pointer-events: none;
  }
  .canvas-footer {
    padding: 6px 12px;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }
</style>
