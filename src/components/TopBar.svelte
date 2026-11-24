<script lang="ts">
  import { ui, type PageId } from '../lib/ui-state.svelte';
  import { store } from '../lib/store.svelte';
  import { downloadProject, openImportFile } from '../lib/io';

  const pages: { id: PageId; label: string; icon: string }[] = [
    { id: 'layout', label: '布置', icon: '◈' },
    { id: 'timeline', label: '节奏', icon: '☰' },
    { id: 'preview', label: '预览', icon: '▶' },
    { id: 'config', label: '配置', icon: '⚙' }
  ];

  let nozzleCount = $derived(store.nozzleCount);
</script>

<header class="topbar">
  <div class="brand">
    <span class="logo">💧</span>
    <span>水景广场编排工作室</span>
  </div>

  <nav class="pages">
    {#each pages as p (p.id)}
      <button class:active={ui.page === p.id} onclick={() => (ui.page = p.id)}>
        <span class="icon">{p.icon}</span>
        {p.label}
      </button>
    {/each}
  </nav>

  <div class="stats">
    <span class="tag">喷头 {nozzleCount}</span>
    <span class="tag">分组 {store.doc.groups.length}</span>
    <span class="tag">{store.doc.barCount} 小节 × {store.doc.beatsPerBar} 拍</span>
  </div>

  <div class="actions">
    <button class="ghost" disabled={!store.canUndo} onclick={() => store.undo()} title="撤销 Ctrl+Z">↶ 撤销</button>
    <button class="ghost" disabled={!store.canRedo} onclick={() => store.redo()} title="重做 Ctrl+Y">↷ 重做</button>
    <button onclick={() => openImportFile()}>导入</button>
    <button class="primary" onclick={() => downloadProject(store)}>导出</button>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 52px;
    padding: 0 14px;
    background: linear-gradient(180deg, #182334, #131c2a);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .logo {
    font-size: 18px;
  }
  .pages {
    display: flex;
    gap: 4px;
  }
  .pages button {
    padding: 6px 14px;
  }
  .icon {
    margin-right: 4px;
    opacity: 0.85;
  }
  .stats {
    display: flex;
    gap: 6px;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
</style>
