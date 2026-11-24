<script>
  import { store } from '../lib/store.svelte.js';
  import { MIN_GUTTER, MAX_GUTTER, VAR, SLOT } from '../lib/constants.js';
  import PhotoThumb from './PhotoThumb.svelte';
  import SlotGeometry from './SlotGeometry.svelte';

  let photoInput = $state(null);

  const page = $derived(store.currentPage);
  const selectedSlot = $derived(
    page?.photoSlots.find((s) => s.id === store.selection.slotId)
    ?? page?.textSlots.find((s) => s.id === store.selection.slotId)
    ?? null
  );
  const tplName = $derived(store.templateOf(page)?.name ?? '');

  const VAR_LABELS = {
    [VAR.NAMES]: '新人姓名',
    [VAR.DATE]: '日期',
    [VAR.PAGE]: '页码（按页序自动生成）'
  };

  async function pickForSlot() {
    photoInput?.click();
  }
  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedSlot) return;
    const id = await store.addImageFile(file);
    store.fillPhoto(store.pageIndex, selectedSlot.id, id);
  }

  function setZoom(v) {
    if (!selectedSlot?.fill) return;
    store.zoomPhoto(store.pageIndex, selectedSlot.id, Number(v));
  }

  function resetCrop() {
    if (!selectedSlot?.fill) return;
    store.updateFill(store.pageIndex, selectedSlot.id, {
      imageId: selectedSlot.fill.imageId,
      focus: { x: 0.5, y: 0.5 },
      zoom: 1,
      pan: { x: 0, y: 0 }
    }, 'crop:reset');
  }

  function nudge(dx, dy) {
    if (!selectedSlot?.fill) return;
    store.nudgePhoto(store.pageIndex, selectedSlot.id, dx, dy);
  }

  const imageList = $derived(Object.values(store.images));
</script>

<aside class="panel panel-section">
  <div class="section-title">属性面板</div>
  <div class="panel-scroll">

    <!-- 全局变量：全册联动 -->
    <div class="block">
      <h4>全局文字变量</h4>
      <p class="hint">修改后全册所有对应文字槽位自动联动更新</p>
      <div class="field">
        <label>新人姓名</label>
        <input type="text" value={store.doc.variables.names}
          oninput={(e) => store.setVariable(VAR.NAMES, e.target.value)} />
      </div>
      <div class="field">
        <label>日期</label>
        <input type="text" value={store.doc.variables.date}
          oninput={(e) => store.setVariable(VAR.DATE, e.target.value)} />
      </div>
      <div class="field">
        <label>页码</label>
        <div class="small">按页序自动编号：第 {store.pageIndex * 2 + 1} / {store.pageIndex * 2 + 2} 页</div>
      </div>
    </div>

    <!-- 中缝留白 -->
    <div class="block">
      <h4>跨页中缝留白</h4>
      <div class="range-row">
        <input type="range" min={MIN_GUTTER} max={MAX_GUTTER} step="1"
          value={store.doc.gutter}
          oninput={(e) => store.setGutter(Number(e.target.value))} />
        <span class="range-val">{store.doc.gutter}mm</span>
      </div>
      <p class="hint">仅影响跨页通栏照片与右页偏移；通栏照片随中缝自动延展</p>
    </div>

    <!-- 当前页信息 -->
    <div class="block">
      <h4>当前对开页</h4>
      <div class="field-row">
        <div class="small" style="flex:2">版式：{tplName}</div>
        <button onclick={() => store.removePage(store.pageIndex)}
          disabled={store.doc.pages.length <= 1} class="danger">删除本页</button>
      </div>
    </div>

    <!-- 选中槽位 -->
    {#if selectedSlot}
      <div class="block highlight">
        <h4>{selectedSlot.type === SLOT.PHOTO ? '照片槽位' : '文字槽位'}</h4>
        <SlotGeometry slot={selectedSlot} />

        {#if selectedSlot.type === SLOT.PHOTO}
          {#if selectedSlot.fill}
            {@const meta = store.images[selectedSlot.fill.imageId]}
            <div class="small" style="margin-bottom:8px">
              照片：{meta?.name ?? '（未找到图片数据）'}
              {#if meta}<br />原始尺寸 {meta.w} × {meta.h}{/if}
            </div>
            <div class="field">
              <label>缩放（{selectedSlot.fill.zoom?.toFixed(2) ?? '1.00'}×）</label>
              <input type="range" min="1" max="6" step="0.02"
                value={selectedSlot.fill.zoom ?? 1}
                oninput={(e) => setZoom(e.target.value)} />
            </div>
            <div class="field">
              <label>微调平移（mm）</label>
              <div class="field-row" style="justify-content:center">
                <button onclick={() => nudge(-2, 0)}>←</button>
                <button onclick={() => nudge(0, -2)}>↑</button>
                <button onclick={() => nudge(0, 2)}>↓</button>
                <button onclick={() => nudge(2, 0)}>→</button>
              </div>
            </div>
            <div class="field">
              <label>裁切焦点（归一化）</label>
              <div class="small">
                x: {selectedSlot.fill.focus.x.toFixed(2)} ／ y: {selectedSlot.fill.focus.y.toFixed(2)}
                <br />可直接在画布上拖动红色焦点标记
              </div>
            </div>
            <div class="field-row">
              <button onclick={resetCrop}>重置裁切</button>
              <button class="danger" onclick={() => store.clearPhoto(store.pageIndex, selectedSlot.id)}>
                移除照片
              </button>
            </div>
          {:else}
            <p class="hint">空槽位：双击画布槽位、拖入照片，或点击下方按钮选择</p>
            <button class="primary" onclick={pickForSlot}>选择照片填充</button>
            <input type="file" accept="image/*" bind:this={photoInput}
              style="display:none" onchange={onPick} />
          {/if}
        {:else}
          <div class="field">
            <label>绑定变量</label>
            <div class="small">{VAR_LABELS[selectedSlot.variable] ?? selectedSlot.variable}</div>
          </div>
          <div class="field">
            <label for="slot-fontsize">字号（mm）</label>
            <input id="slot-fontsize" type="number" min="3" max="30" step="0.5" value={selectedSlot.fontSize}
              onchange={(e) => store.setTextStyle(store.pageIndex, selectedSlot.id,
                { fontSize: Number(e.target.value) })} />
          </div>
          <div class="field">
            <label for="slot-color">颜色</label>
            <input id="slot-color" type="color" value={selectedSlot.color}
              onchange={(e) => store.setTextStyle(store.pageIndex, selectedSlot.id,
                { color: e.target.value })} />
          </div>
          <div class="field">
            <label for="slot-align">对齐</label>
            <select id="slot-align" value={selectedSlot.align}
              onchange={(e) => store.setTextStyle(store.pageIndex, selectedSlot.id,
                { align: e.target.value })}>
              <option value="left">左对齐</option>
              <option value="center">居中</option>
              <option value="right">右对齐</option>
            </select>
          </div>
          <p class="hint">在画布上可直接拖动该文字槽位，靠近边缘自动吸附</p>
        {/if}
      </div>
    {/if}

    <!-- 相册照片库 -->
    <div class="block">
      <h4>相册照片库（{imageList.length}）</h4>
      {#if imageList.length === 0}
        <p class="hint">还没有照片。通过画布工具栏“导入照片”，或直接把图片拖入画布。</p>
      {:else}
        <div class="img-grid">
          {#each imageList as img (img.id)}
            <PhotoThumb {img} />
          {/each}
        </div>
      {/if}
    </div>
  </div>
</aside>

<style>
  .panel-scroll { overflow: auto; padding: 0 14px 20px; flex: 1; min-height: 0; }
  .block {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .block.highlight { border-color: var(--accent); background: #fffaf3; }
  h4 { margin: 0 0 8px; font-size: 13px; color: var(--accent-dark); }
  .img-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
</style>
