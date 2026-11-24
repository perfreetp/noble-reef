<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { ui } from '../lib/ui-state.svelte';

  const cfg = $derived(store.doc.config);
  const pool = $derived(cfg.pool);

  function setPool(field: 'x' | 'y' | 'width' | 'height', value: number) {
    store.updatePool({ [field]: value });
  }
</script>

<aside class="dock">
  <div class="dock-head">
    <h2>广场与水池配置</h2>
  </div>

  <div class="panel-section">
    <h3>外观颜色</h3>
    <label class="field color-field">
      <span>广场底色</span>
      <input type="color" value={cfg.plazaColor} onchange={(e) => store.updateConfig({ plazaColor: e.currentTarget.value })} />
      <code>{cfg.plazaColor}</code>
    </label>
    <label class="field color-field">
      <span>水池底色</span>
      <input type="color" value={cfg.poolColor} onchange={(e) => store.updateConfig({ poolColor: e.currentTarget.value })} />
      <code>{cfg.poolColor}</code>
    </label>
  </div>

  <div class="panel-section">
    <h3>水池范围（厘米）</h3>
    <label class="check" style="margin-bottom:10px">
      <input type="checkbox" bind:checked={ui.poolEditing} />
      显示画布编辑手柄（拖动手柄调整，蓝点整体平移）
    </label>
    <div class="grid2">
      <label class="field"><span>左上角 X <b>{Math.round(pool.x)}</b></span>
        <input type="number" value={pool.x} onchange={(e) => setPool('x', Number(e.currentTarget.value))} />
      </label>
      <label class="field"><span>左上角 Y <b>{Math.round(pool.y)}</b></span>
        <input type="number" value={pool.y} onchange={(e) => setPool('y', Number(e.currentTarget.value))} />
      </label>
      <label class="field"><span>宽度 <b>{Math.round(pool.width)}</b></span>
        <input type="number" min="200" value={pool.width} onchange={(e) => setPool('width', Math.max(200, Number(e.currentTarget.value)))} />
      </label>
      <label class="field"><span>高度 <b>{Math.round(pool.height)}</b></span>
        <input type="number" min="200" value={pool.height} onchange={(e) => setPool('height', Math.max(200, Number(e.currentTarget.value)))} />
      </label>
    </div>
  </div>

  <div class="panel-section">
    <h3>水柱与网格</h3>
    <label class="field"><span>水柱最大射程(cm) <b>{cfg.jetRange}</b></span>
      <input type="range" min="50" max="1200" step="10" value={cfg.jetRange} oninput={(e) => store.updateConfig({ jetRange: Number(e.currentTarget.value) })} />
    </label>
    <label class="field"><span>网格间距(cm) <b>{cfg.gridSize}</b> · 0=关闭</span>
      <input type="range" min="0" max="1000" step="10" value={cfg.gridSize} oninput={(e) => store.updateConfig({ gridSize: Number(e.currentTarget.value) })} />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={ui.showLanding} />
      显示全部喷头落点预览（随朝向与射程变化）
    </label>
    <p class="hint">
      落点位置 = 喷头坐标 + 朝向单位向量 × 射程。预览页播放时，实际落点距离再乘以当前节拍喷水强度。
    </p>
  </div>

  <div class="panel-section grow">
    <h3>当前工程统计</h3>
    <ul class="stats">
      <li>喷头总数：<b>{store.nozzleCount}</b></li>
      <li>分组数量：<b>{store.doc.groups.length}</b></li>
      <li>时间轴色块：<b>{store.doc.blocks.length}</b></li>
      <li>节拍轨道：{store.doc.barCount} 小节 × {store.doc.beatsPerBar} 拍 = <b>{store.totalBeats}</b> 轨</li>
      <li>水池面积：<b>{(pool.width * pool.height / 10000).toFixed(1)} m²</b></li>
    </ul>
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
    overflow-y: auto;
  }
  .dock-head {
    padding: 12px 14px 8px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .grow {
    flex: 1;
  }
  .color-field {
    display: grid;
    grid-template-columns: 1fr 46px 80px;
    align-items: center;
    gap: 8px;
  }
  .color-field span {
    margin: 0;
  }
  .color-field code {
    font-size: 11px;
    color: var(--text-2);
    background: var(--bg-1);
    padding: 4px 6px;
    border-radius: 4px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 10px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-1);
    cursor: pointer;
  }
  .check input {
    width: auto;
  }
  .stats {
    margin: 0;
    padding-left: 18px;
    color: var(--text-1);
    line-height: 2;
    font-size: 12px;
  }
  .stats b {
    color: var(--text-0);
  }
</style>
