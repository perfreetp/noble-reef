<script>
  import { onMount, onDestroy } from 'svelte';
  import { store } from './lib/store.svelte.js';
  import { MIN_GUTTER, MAX_GUTTER } from './lib/constants.js';
  import TopBar from './components/TopBar.svelte';
  import TemplateLibrary from './components/TemplateLibrary.svelte';
  import CanvasView from './components/CanvasView.svelte';
  import PropertyPanel from './components/PropertyPanel.svelte';
  import ThumbnailBar from './components/ThumbnailBar.svelte';

  let ready = $state(false);
  let loadError = $state('');

  // 全局快捷键：撤销/重做
  function onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    }
  }

  onMount(async () => {
    try {
      await store.init();
      ready = true;
    } catch (err) {
      loadError = `初始化失败：${err?.message ?? String(err)}`;
    }
    window.addEventListener('keydown', onKey);
  });

  onDestroy(() => window.removeEventListener('keydown', onKey));
</script>

{#if loadError}
  <div style="padding:40px;font-size:14px;color:var(--danger)">{loadError}</div>
{:else if !ready}
  <div style="height:100%;display:grid;place-items:center;color:var(--ink-2)">正在加载相册…</div>
{:else}
  <div class="app-shell">
    <TopBar />
    <TemplateLibrary />
    <CanvasView />
    <PropertyPanel />
    <ThumbnailBar />
  </div>
{/if}
