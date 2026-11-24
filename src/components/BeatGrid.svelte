<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { ui } from '../lib/ui-state.svelte';
  import { player } from '../lib/player.svelte';
  import { lighten, withAlpha } from '../lib/engine/color';

  const BEAT_W = 56; // px，每拍宽
  const ROW_H = 46;

  let rulerScroll: HTMLDivElement;
  let gridScroll: HTMLDivElement;
  let painting = false;
  let paintValue = 0.6;
  let lastCell = '';

  const totalBeats = $derived(store.totalBeats);
  const groups = $derived(store.doc.groups);

  function syncScroll() {
    rulerScroll.scrollLeft = gridScroll.scrollLeft;
  }

  function cellKey(groupId: string, beat: number) {
    return `${groupId}:${beat}`;
  }

  function cellFromEvent(e: PointerEvent): { groupId: string; beat: number } | null {
    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cell = target?.closest('[data-cell]') as HTMLElement | null;
    if (!cell) return null;
    return { groupId: cell.dataset.group!, beat: Number(cell.dataset.beat) };
  }

  function startPaint(e: PointerEvent, groupId: string, beat: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const current = store.intensityAt(groupId, beat);
    // 点击循环：空 → 0.6 → 1 → 0.3 → 空
    paintValue = current === 0 ? 0.6 : current >= 0.99 ? 0.3 : current > 0.45 ? 1 : 0;
    painting = true;
    lastCell = cellKey(groupId, beat);
    store.beginPaint();
    store.paintBlock(groupId, beat, paintValue);
    gridScroll.setPointerCapture(e.pointerId);
  }

  function movePaint(e: PointerEvent) {
    if (!painting) return;
    const c = cellFromEvent(e);
    if (!c) return;
    const k = cellKey(c.groupId, c.beat);
    if (k === lastCell) return;
    lastCell = k;
    store.paintBlock(c.groupId, c.beat, paintValue);
  }

  function endPaint() {
    if (!painting) return;
    painting = false;
    store.endPaint();
  }

  function barOf(beat: number) {
    return Math.floor(beat / store.doc.beatsPerBar);
  }

  // 播放头位置由 rAF 轻量刷新（不触发整页高频响应式更新）
  let playPct = $state(0);
  let raf = 0;
  $effect(() => {
    const loop = () => {
      raf = requestAnimationFrame(loop);
      playPct = player.progress * 100;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  });

  const currentBeat = $derived(player.currentBeatIndex);
</script>

<div class="timeline-wrap">
  <div class="timeline-head">
    <div class="corner">分组轨道 ＼ 节拍</div>
    <div class="ruler-scroll" bind:this={rulerScroll}>
      <div class="ruler" style="width:{totalBeats * BEAT_W}px">
        {#each Array(totalBeats) as _, beat (beat)}
          <div
            class="ruler-cell"
            class:barline={beat % store.doc.beatsPerBar === 0}
            class:playing={beat === currentBeat && player.playing}
            style="width:{BEAT_W}px"
          >
            {#if beat % store.doc.beatsPerBar === 0}
              <span class="bar-no">小节 {barOf(beat) + 1}</span>
            {/if}
            <span class="beat-no">{beat + 1}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div class="timeline-body">
    <!-- 左侧分组名固定列 -->
    <div class="group-col">
      {#each groups as g (g.id)}
        <div
          class="group-label"
          role="listitem"
          class:hl={ui.hoverGroupId === g.id}
          style="height:{ROW_H}px"
          onmouseenter={() => (ui.hoverGroupId = g.id)}
          onmouseleave={() => (ui.hoverGroupId = '')}
        >
          <span class="dot" style="background:{g.color}"></span>
          <span class="gname">{g.name}</span>
        </div>
      {/each}
      {#if groups.length === 0}
        <div class="empty">请先在布置页创建分组</div>
      {/if}
    </div>

    <!-- 右侧可滚动网格 -->
    <div
      class="grid-scroll"
      role="presentation"
      aria-label="节拍强度网格"
      bind:this={gridScroll}
      onscroll={syncScroll}
      onpointermove={movePaint}
      onpointerup={endPaint}
      onpointercancel={endPaint}
    >
      <div class="grid" style="width:{totalBeats * BEAT_W}px">
        {#if player.playing || player.beatPos > 0}
          <div class="playhead" style="left:{playPct}%"></div>
        {/if}

        {#each groups as g (g.id)}
          <div
            class="track-row"
            role="presentation"
            style="height:{ROW_H}px"
            onmouseenter={() => (ui.hoverGroupId = g.id)}
            onmouseleave={() => (ui.hoverGroupId = '')}
          >
            {#each Array(totalBeats) as _, beat (beat)}
              {@const v = store.intensityAt(g.id, beat)}
              {@const active = beat === currentBeat && v > 0}
              <div
                class="cell"
                role="gridcell"
                tabindex="-1"
                aria-label={`${g.name} 第 ${beat + 1} 拍，强度 ${Math.round(v * 100)}%`}
                class:barline={beat % store.doc.beatsPerBar === 0}
                class:active={active}
                style="width:{BEAT_W}px"
                data-cell
                data-group={g.id}
                data-beat={beat}
                onpointerdown={(e) => startPaint(e, g.id, beat)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    store.beginPaint();
                    store.paintBlock(g.id, beat, store.intensityAt(g.id, beat) === 0 ? 0.6 : 0);
                    store.endPaint();
                  }
                }}
              >
                {#if v > 0}
                  <div
                    class="block"
                    style="
                      background:{withAlpha(g.color, 0.35 + v * 0.6)};
                      border-color:{lighten(g.color, 0.35)};
                      height:{Math.round(28 + v * 62)}%;
                    "
                  >
                    <span>{Math.round(v * 100)}</span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .timeline-wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .timeline-head,
  .timeline-body {
    display: flex;
  }
  .corner {
    width: 170px;
    flex-shrink: 0;
    height: 44px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 11px;
    color: var(--text-2);
    background: var(--bg-1);
    border-bottom: 1px solid var(--line);
    border-right: 1px solid var(--line);
  }
  .ruler-scroll,
  .grid-scroll {
    flex: 1;
    overflow-x: auto;
  }
  .ruler-scroll {
    overflow-y: hidden;
  }
  .grid-scroll {
    overflow-y: auto;
    flex: 1;
  }
  .ruler {
    display: flex;
    height: 44px;
  }
  .ruler-cell {
    position: relative;
    flex-shrink: 0;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    background: var(--bg-1);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ruler-cell.barline {
    border-left: 2px solid #416083;
  }
  .ruler-cell.playing {
    background: rgba(31, 157, 240, 0.25);
  }
  .beat-no {
    font-size: 11px;
    color: var(--text-1);
  }
  .bar-no {
    position: absolute;
    left: 4px;
    top: 2px;
    font-size: 9px;
    color: var(--text-2);
  }
  .timeline-body {
    flex: 1;
    min-height: 0;
  }
  .group-col {
    width: 170px;
    flex-shrink: 0;
    background: var(--bg-1);
    border-right: 1px solid var(--line);
    overflow-y: auto;
  }
  .group-label {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
  }
  .group-label.hl {
    background: rgba(31, 157, 240, 0.16);
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .gname {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid {
    position: relative;
  }
  .track-row {
    display: flex;
    border-bottom: 1px solid var(--line);
  }
  .cell {
    position: relative;
    flex-shrink: 0;
    border-right: 1px solid rgba(44, 64, 89, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: crosshair;
  }
  .cell.barline {
    border-left: 2px solid #35506e;
  }
  .cell:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .cell.active {
    background: rgba(31, 157, 240, 0.18);
  }
  .block {
    width: calc(100% - 6px);
    border: 1px solid;
    border-radius: 4px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 2px;
    transition: height 0.08s;
  }
  .block span {
    font-size: 9px;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--warn);
    z-index: 5;
    pointer-events: none;
    box-shadow: 0 0 8px rgba(241, 143, 1, 0.8);
  }
  .empty {
    padding: 24px 12px;
    color: var(--text-2);
  }
</style>
