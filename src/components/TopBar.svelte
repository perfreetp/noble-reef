<script>
  import { store } from '../lib/store.svelte.js';

  let fileInput = $state(null);
  let showMenu = $state(false);

  async function onExport() {
    try {
      await store.exportFile();
    } catch (err) {
      alert('导出失败：' + (err.message ?? err));
    }
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await store.importFile(file);
    } catch (err) {
      alert(err.message ?? String(err));
    }
  }

  function onNew() {
    if (confirm('新建空白相册将清空当前内容（建议先导出备份），确定继续？')) {
      store.newAlbum();
    }
  }
</script>

<header class="topbar panel-section" style="flex-direction:row;align-items:center;gap:12px;padding:0 14px;">
  <div style="font-weight:700;letter-spacing:.06em;color:var(--accent-dark);white-space:nowrap;">
    婚纱相册排版
  </div>  <div class="field-row" style="flex:0 0 auto;margin-left:8px;">
    <button class="ghost nav-btn" disabled={!store.historyState.canUndo} onclick={() => store.undo()}
      title="撤销 (Ctrl+Z)">↶ 撤销{store.historyState.undoLabel ? `·${store.historyState.undoLabel}` : ''}</button>
    <button class="ghost nav-btn" disabled={!store.historyState.canRedo} onclick={() => store.redo()}
      title="重做 (Ctrl+Shift+Z)">↷ 重做</button>
  </div>

  <div style="flex:1"></div>

  <div class="field-row" style="flex:0 0 auto;gap:8px;">
    <button onclick={onNew}>新建</button>
    <button onclick={() => fileInput?.click()}>导入继续编辑</button>
    <button class="primary" onclick={onExport}>导出相册</button>
    <input type="file" accept=".json,application/json" bind:this={fileInput}
      style="display:none" onchange={onImportFile} />
  </div>
</header>

<style>
  .nav-btn { white-space: nowrap; }
</style>
