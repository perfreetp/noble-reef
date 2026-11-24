<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { player } from '../lib/player.svelte';
  import { ui } from '../lib/ui-state.svelte';

  // rAF 刷新进度显示
  let pct = $state(0);
  let beatNow = $state(0);
  let raf = 0;
  $effect(() => {
    const loop = () => {
      raf = requestAnimationFrame(loop);
      pct = player.progress * 100;
      beatNow = player.currentBeatIndex;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  });

  function onSeek(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    player.seekFraction(v / 100);
  }

  function fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const elapsed = $derived((pct / 100) * player.durationSec);
  const activeMap = $derived(store.activeGroupsAtBeat(beatNow));
</script>

<aside class="dock">
  <div class="dock-head">
    <h2>水舞预览</h2>
    <span class="tag">{store.doc.bpm} BPM · {fmt(player.durationSec)}</span>
  </div>

  <div class="panel-section">
    <h3>播放控制</h3>
    <div class="transport">
      <button onclick={() => player.stop()}>⏹</button>
      <button class="primary big" onclick={() => (player.playing ? player.pause() : player.play())}>
        {player.playing ? '⏸' : '▶'}
      </button>
      <button onclick={() => player.seekFraction(0)}>⏮</button>
    </div>

    <label class="check">
      <input type="checkbox" bind:checked={player.loop} />
      循环播放
    </label>

    <label class="field" style="margin-top:10px">
      <span>进度 <b>{fmt(elapsed)} / {fmt(player.durationSec)}</b></span>
      <input type="range" min="0" max="100" step="0.1" value={pct} oninput={onSeek} />
    </label>
    <p class="hint">拖动进度条可跳转任意节拍；第 {beatNow + 1} 拍 / 共 {store.totalBeats} 拍。</p>
  </div>

  <div class="panel-section">
    <h3>显示选项</h3>
    <label class="check">
      <input type="checkbox" bind:checked={ui.showLanding} />
      显示水柱落点
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={ui.showGrid} />
      显示网格
    </label>
  </div>

  <div class="panel-section grow">
    <h3>当前激活分组</h3>
    <div class="active-list">
      {#each store.doc.groups as g (g.id)}
        {@const intensity = activeMap.get(g.id)}
        <div class="active-row" class:on={intensity !== undefined && intensity > 0}>
          <span class="dot" style="background:{g.color}"></span>
          <span class="gname">{g.name}</span>
          {#if intensity !== undefined && intensity > 0}
            <div class="meter">
              <div class="fill" style="width:{intensity * 100}%; background:{g.color}"></div>
            </div>
            <b>{Math.round(intensity * 100)}%</b>
          {:else}
            <span class="off">关闭</span>
          {/if}
        </div>
      {/each}
    </div>
    <p class="hint">画布中激活分组的喷头实时高亮，水柱高度随强度变化，落点按喷头朝向偏移。</p>
  </div>
</aside>

<style>
  .dock {
    position: absolute;
    top: 12px;
    right: 12px;
    bottom: 44px;
    width: 300px;
    display: flex;
    flex-direction: column;
    background: rgba(19, 28, 42, 0.94);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(6px);
    z-index: 10;
    overflow-y: auto;
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
  .grow {
    flex: 1;
  }
  .transport {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-bottom: 12px;
  }
  .transport button {
    width: 52px;
    height: 42px;
    font-size: 16px;
  }
  .transport .big {
    width: 68px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-1);
    margin-bottom: 8px;
    cursor: pointer;
  }
  .check input {
    width: auto;
  }
  .active-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .active-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--bg-1);
    opacity: 0.45;
    transition: opacity 0.1s;
  }
  .active-row.on {
    opacity: 1;
    background: rgba(31, 157, 240, 0.1);
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .gname {
    width: 62px;
    flex-shrink: 0;
    font-size: 12px;
  }
  .meter {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.08s linear;
  }
  .off {
    flex: 1;
    text-align: right;
    color: var(--text-2);
    font-size: 11px;
  }
  b {
    font-size: 11px;
    min-width: 38px;
    text-align: right;
  }
</style>
