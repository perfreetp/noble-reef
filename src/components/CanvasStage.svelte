<script lang="ts">
  import { onMount } from 'svelte';
  import { PlazaEngine } from '../lib/engine/plaza-engine';
  import { getEngine, registerEngine } from '../lib/engine-registry';
  import { ui } from '../lib/ui-state.svelte';
  import { store } from '../lib/store.svelte';
  import { player } from '../lib/player.svelte';
  let host: HTMLDivElement;
  let ready = $state(false);
  let errorMsg = $state('');

  // 调试钩子挂在模块单例上，不随组件重挂载/HMR 丢失
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __player?: unknown; __store__?: unknown; __ui__?: unknown };
    w.__player = player;
    w.__store__ = store;
    w.__ui__ = ui;
  }

  onMount(() => {
    let inst: PlazaEngine | undefined;
    (async () => {
      try {
        inst = new PlazaEngine(host, {
          onHoverNozzle: () => {}
        });
        await inst.init();
        inst.fitView();
        registerEngine(inst);
        (window as unknown as { __engine?: unknown }).__engine = inst;
        ready = true;
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      registerEngine(null);
      inst?.destroy();
    };
  });
</script>

<div class="stage" class:ready>
  <div class="canvas-host" bind:this={host}></div>

  {#if errorMsg}
    <div class="error">
      <b>画布初始化失败</b>
      <p>{errorMsg}</p>
    </div>
  {/if}

  <!-- 左下角视图控制 -->
  <div class="view-controls">
    <button title="放大" onclick={() => getEngine()?.zoomBy(1.25)}>＋</button>
    <button title="缩小" onclick={() => getEngine()?.zoomBy(0.8)}>－</button>
    <button title="适配水池" onclick={() => getEngine()?.fitView()}>⛶ 适配</button>
  </div>

  <!-- 操作提示 -->
  <div class="hint-bar">
    {#if ui.page === 'layout'}
      <span>左键拖动喷头改位 · 黄色手柄调朝向 · 空白处框选 · 右键/空格+拖动平移 · 滚轮缩放 · Shift 拖动吸附网格/角度步进</span>
    {:else if ui.page === 'config'}
      <span>拖动白色手柄调整水池范围，蓝色手柄整体平移 · 落点随喷头朝向与射程变化</span>
    {:else if ui.page === 'preview'}
      <span>水舞播放中：激活分组喷头高亮并显示水柱，落点沿朝向偏移</span>
    {:else}
      <span>在节拍轨道上拖动绘制色块，单击色块切换强度</span>
    {/if}
    <span class="spacer"></span>
    <span class="tag">v{store.version}</span>
  </div>
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .canvas-host {
    position: absolute;
    inset: 0;
  }
  .canvas-host :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .view-controls {
    position: absolute;
    left: 12px;
    bottom: 44px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 5;
  }
  .view-controls button {
    width: 40px;
    padding: 6px 0;
  }
  .hint-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 32px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    background: rgba(13, 20, 30, 0.82);
    border-top: 1px solid var(--line);
    color: var(--text-2);
    font-size: 11px;
    z-index: 5;
    pointer-events: none;
  }
  .hint-bar .spacer {
    flex: 1;
  }
  .error {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--bg-0);
  }
  .error p {
    color: var(--danger);
    max-width: 480px;
  }
</style>
