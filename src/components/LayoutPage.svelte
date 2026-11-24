<script lang="ts">
  import GroupPanel from './GroupPanel.svelte';
  import ArrayTool from './ArrayTool.svelte';
  import NozzleInspector from './NozzleInspector.svelte';
  import { store } from '../lib/store.svelte';
  import { ui } from '../lib/ui-state.svelte';

  let ungrouped = $derived(store.doc.nozzles.filter((n) => !n.groupId).length);
</script>

<aside class="dock">
  <div class="dock-head">
    <h2>布置页</h2>
    <span class="tag">共 {store.nozzleCount} 喷头{ungrouped ? ` · ${ungrouped} 未分组` : ''}</span>
  </div>
  <div class="dock-body">
    <ArrayTool />
    <GroupPanel />
    <NozzleInspector />
  </div>
  <div class="dock-foot">
    <button class="ghost" onclick={() => {
      if (confirm('清空全部喷头？此操作可撤销。')) {
        store.removeNozzles(new Set(store.doc.nozzles.map((n) => n.id)));
        ui.clearSelection();
      }
    }}>清空喷头</button>
    <button class="ghost" onclick={() => confirm('恢复内置演示工程？当前内容会进入撤销栈。') && store.resetToDefault()}>
      重置演示
    </button>
  </div>
</aside>

<style>
  .dock {
    position: absolute;
    top: 12px;
    right: 12px;
    bottom: 44px;
    width: 320px;
    display: flex;
    flex-direction: column;
    background: rgba(19, 28, 42, 0.94);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(6px);
    z-index: 10;
  }
  .dock-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .dock-body {
    flex: 1;
    overflow-y: auto;
  }
  .dock-foot {
    display: flex;
    gap: 6px;
    padding: 10px 14px;
    border-top: 1px solid var(--line);
  }
  .dock-foot button {
    flex: 1;
  }
</style>
