<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { player } from '../lib/player.svelte';
  import { ui } from '../lib/ui-state.svelte';
  import BeatGrid from './BeatGrid.svelte';

  let copyFrom = $state(0);
  let copyTo = $state(1);

  // 时间轴参数本地草稿（拖动滑杆流畅），change 时一次性提交进历史
  let bpmDraft = $state(store.doc.bpm);
  let barDraft = $state(store.doc.barCount);
  $effect(() => {
    bpmDraft = store.doc.bpm;
    barDraft = store.doc.barCount;
  });

  const barCount = $derived(store.doc.barCount);

  // 防止复制目标越界
  $effect(() => {
    if (copyFrom >= barCount) copyFrom = barCount - 1;
    if (copyTo >= barCount) copyTo = barCount - 1;
  });

  function doCopy() {
    if (copyFrom === copyTo) return;
    store.copyBar(copyFrom, copyTo);
  }

  function gotoPreview() {
    ui.page = 'preview';
    player.play();
  }
</script>

<aside class="dock">
  <div class="dock-head">
    <h2>节奏编排</h2>
    <span class="tag">{store.doc.bpm} BPM</span>
  </div>

  <div class="panel-section">
    <h3>时间轴设置</h3>
    <label class="field"><span>速度 BPM <b>{bpmDraft}</b></span>
      <input type="range" min="40" max="200" bind:value={bpmDraft} onchange={(e) => store.setTimelineConfig({ bpm: Number(e.currentTarget.value) })} />
    </label>
    <label class="field"><span>每小节节拍数</span>
      <select value={store.doc.beatsPerBar} onchange={(e) => store.setTimelineConfig({ beatsPerBar: Number(e.currentTarget.value) })}>
        <option value={2}>2 拍</option>
        <option value={3}>3 拍</option>
        <option value={4}>4 拍</option>
        <option value={6}>6 拍</option>
        <option value={8}>8 拍</option>
      </select>
    </label>
    <label class="field"><span>小节数 <b>{barDraft}</b></span>
      <input type="range" min="1" max="32" bind:value={barDraft} onchange={(e) => store.setTimelineConfig({ barCount: Number(e.currentTarget.value) })} />
    </label>
    <p class="hint">总时长 {((store.totalBeats / store.doc.bpm) * 60).toFixed(1)} 秒，共 {store.totalBeats} 个节拍。</p>
  </div>

  <div class="panel-section">
    <h3>小节复制</h3>
    <div class="row">
      <label class="mini-field">源
        <input type="number" min="0" max={barCount - 1} bind:value={copyFrom} />
      </label>
      <span>→</span>
      <label class="mini-field">目标
        <input type="number" min="0" max={barCount - 1} bind:value={copyTo} />
      </label>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="primary" onclick={doCopy} disabled={copyFrom === copyTo}>复制整小节</button>
      <button class="danger" onclick={() => confirm(`清空小节 ${copyTo + 1} 的全部色块？`) && store.clearBar(copyTo)}>清空目标小节</button>
    </div>
    <p class="hint">复制会覆盖目标小节中所有轨道的色块。小节编号从 1 开始显示，此处为 0 基索引。</p>
  </div>

  <div class="panel-section grow">
    <h3>色块强度</h3>
    <p class="hint">
      在网格上<strong>按下并拖动</strong>，沿经过的节拍连续绘制同一强度；单击色块在
      <em>60% → 100% → 30% → 清空</em> 间循环。色块高度与数字即喷水强度（0–100%）。
    </p>
    <div class="legend">
      <span><i style="opacity:0.45"></i>低</span>
      <span><i style="opacity:0.7"></i>中</span>
      <span><i style="opacity:1"></i>高</span>
    </div>
  </div>

  <div class="dock-foot">
    <button onclick={() => player.seekBeat(0)}>⏮ 回开头</button>
    <button class="primary" onclick={() => (player.playing ? player.pause() : player.play())}>
      {player.playing ? '⏸ 暂停' : '▶ 试听'}
    </button>
    <button onclick={gotoPreview}>前往预览页</button>
  </div>
</aside>

<div class="grid-host">
  <BeatGrid />
</div>

<style>
  .dock {
    position: absolute;
    top: 12px;
    left: 12px;
    bottom: 44px;
    width: 290px;
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
  .mini-field {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-1);
    font-size: 12px;
  }
  .mini-field input {
    width: 100%;
  }
  .legend {
    display: flex;
    gap: 14px;
    margin-top: 8px;
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-1);
    font-size: 11px;
  }
  .legend i {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: var(--accent);
    display: inline-block;
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
  .grid-host {
    position: absolute;
    inset: 12px 12px 44px 314px;
    background: rgba(15, 22, 34, 0.92);
    border: 1px solid var(--line);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    z-index: 5;
    overflow: hidden;
  }
</style>
