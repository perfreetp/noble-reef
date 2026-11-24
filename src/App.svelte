<script lang="ts">
  import Viewport from './components/Viewport.svelte';
  import ParamPanel from './components/ParamPanel.svelte';
  import GroupPanel from './components/GroupPanel.svelte';
  import IntersectionPanel from './components/IntersectionPanel.svelte';
  import { activeTool, brushRadius, modelVersion, selection, type ToolId } from './lib/state/stores';
  import { history } from './lib/hair/history';
  import { model } from './lib/hair/model';
  import { downloadStyle, loadStyle, parseStyle, StyleParseError } from './lib/hair/io';
  import { generateDemoHair } from './lib/hair/demo';
  import { shared } from './lib/state/context';

  const { canUndo, canRedo, lastLabel } = history;

  const TOOLS: { id: ToolId; label: string; hint: string }[] = [
    { id: 'select', label: '选择/移动', hint: '点击发根手柄选中，拖动沿头皮移动整束；Shift 多选' },
    { id: 'add', label: '新增发束', hint: '在头皮上按下并拖出方向，松手创建发束' },
    { id: 'comb', label: '梳子', hint: '顺着发束拖拽，把散开的发丝理顺' },
    { id: 'brush', label: '刷子', hint: '在发束上涂抹，局部增加蓬松度' },
  ];

  let toolHint = TOOLS[0]!.hint;
  $: toolHint = TOOLS.find((t) => t.id === $activeTool)?.hint ?? '';

  let bundleCount = 0;
  $: if ($modelVersion >= 0) bundleCount = model.bundles.size;

  let fileInput: HTMLInputElement;
  let loadError = '';

  function onExport() {
    downloadStyle();
  }

  function onImportFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    loadError = '';
    file.text().then((text) => {
      try {
        loadStyle(parseStyle(text));
        selection.set(new Set());
      } catch (err) {
        loadError = err instanceof StyleParseError ? err.message : '载入失败';
      }
    });
    (e.target as HTMLInputElement).value = '';
  }

  function onDemo() {
    if (shared.scalp) generateDemoHair(shared.scalp, 1200);
  }

  function onClear() {
    const before = model.snapshotAll();
    model.clear();
    const after = model.snapshotAll();
    history.push({
      label: '清空全部',
      undo: () => model.restoreAll(before),
      redo: () => model.restoreAll(after),
    });
    selection.set(new Set());
  }
</script>

<div class="app">
  <header>
    <div class="tools">
      {#each TOOLS as t (t.id)}
        <button class:active={$activeTool === t.id} on:click={() => activeTool.set(t.id)}>
          {t.label}
        </button>
      {/each}
      {#if $activeTool === 'comb' || $activeTool === 'brush'}
        <label class="radius">
          半径
          <input type="range" min="0.05" max="0.4" step="0.01" bind:value={$brushRadius} />
        </label>
      {/if}
    </div>
    <div class="ops">
      <button disabled={!$canUndo} on:click={() => history.undo()} title={$lastLabel}>撤销</button>
      <button disabled={!$canRedo} on:click={() => history.redo()}>重做</button>
      <span class="sep"></span>
      <button on:click={onExport}>导出发型</button>
      <button on:click={() => fileInput.click()}>载入发型</button>
      <input bind:this={fileInput} type="file" accept=".json,.hairstyle" hidden on:change={onImportFile} />
      <button on:click={onDemo}>演示发量</button>
      <button class="danger" on:click={onClear}>清空</button>
    </div>
  </header>

  <main>
    <div class="view">
      <Viewport />
      <div class="statusbar">
        <span>{toolHint}</span>
        <span>发束：{bundleCount}　选中：{$selection.size}　左键拖动旋转视角 · 滚轮缩放 · Ctrl+Z/Y 撤销重做</span>
      </div>
      {#if loadError}
        <div class="error">{loadError}</div>
      {/if}
    </div>
    <aside>
      <ParamPanel />
      <GroupPanel />
      <IntersectionPanel />
    </aside>
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
    background: #16171a;
    color: #ddd;
    overflow: hidden;
  }
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    background: #202228;
    border-bottom: 1px solid #333;
    gap: 12px;
    flex-wrap: wrap;
  }
  .tools,
  .ops {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  button {
    background: #2c2f36;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: #383c45;
  }
  button.active {
    border-color: #ff8c1a;
    color: #ff8c1a;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button.danger {
    color: #ff7a7a;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: #444;
  }
  .radius {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #bbb;
  }
  main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .view {
    flex: 1;
    position: relative;
    min-width: 0;
  }
  aside {
    width: 280px;
    background: #1d1f24;
    border-left: 1px solid #333;
    overflow-y: auto;
  }
  .statusbar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 10px;
    font-size: 11px;
    color: #999;
    background: rgba(20, 21, 24, 0.85);
    pointer-events: none;
  }
  .error {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: #5a2020;
    color: #ffb0b0;
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
  }
</style>
