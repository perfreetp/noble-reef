<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from './lib/ui-state.svelte';
  import { store } from './lib/store.svelte';
  import { player } from './lib/player.svelte';
  import TopBar from './components/TopBar.svelte';
  import CanvasStage from './components/CanvasStage.svelte';
  import LayoutPage from './components/LayoutPage.svelte';
  import TimelinePage from './components/TimelinePage.svelte';
  import PreviewPage from './components/PreviewPage.svelte';
  import ConfigPage from './components/ConfigPage.svelte';

  // 全局键盘快捷键
  function onKey(e: KeyboardEvent) {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.page === 'layout') {
      if (ui.selection.size > 0) {
        e.preventDefault();
        store.removeNozzles(ui.selection);
        ui.clearSelection();
      }
      return;
    }
    if (e.key === 'Escape') {
      ui.clearSelection();
      ui.tool = 'select';
      player.pause();
      return;
    }
    if (e.key === '1') ui.page = 'layout';
    if (e.key === '2') ui.page = 'timeline';
    if (e.key === '3') ui.page = 'preview';
    if (e.key === '4') ui.page = 'config';
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="app">
  <TopBar />
  <div class="body">
    <CanvasStage />
    {#if ui.page === 'layout'}
      <LayoutPage />
    {:else if ui.page === 'timeline'}
      <TimelinePage />
    {:else if ui.page === 'preview'}
      <PreviewPage />
    {:else}
      <ConfigPage />
    {/if}
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
  }
</style>
