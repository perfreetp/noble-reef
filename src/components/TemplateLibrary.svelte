<script>
  import { TEMPLATES } from '../lib/templates.js';
  import { TEMPLATE_KIND } from '../lib/constants.js';
  import { store } from '../lib/store.svelte.js';

  const GROUPS = [
    { kind: TEMPLATE_KIND.SINGLE, label: '单图' },
    { kind: TEMPLATE_KIND.DOUBLE, label: '双图' },
    { kind: TEMPLATE_KIND.TRIPLE, label: '三图' },
    { kind: TEMPLATE_KIND.BANNER, label: '跨页通栏' }
  ];

  // 模板缩略示意（viewBox 400×280 的对开页）
  function shapes(tpl) {
    const built = tpl.build();
    const g = 6;
    const out = [];
    for (const s of built.photoSlots) {
      let r;
      if (s.spread) {
        r = { x: s.spread.x1 * 2, y: s.spread.y * 1, w: 0, h: s.spread.h };
        r.w = 400 - s.spread.x1 * 2 - s.spread.x2 * 2;
      } else {
        const ox = s.zone === 'R' ? 200 + g : 0;
        r = { x: ox + s.rect.x * 2, y: s.rect.y, w: s.rect.w * 2, h: s.rect.h };
      }
      out.push({ ...r, spread: !!s.spread });
    }
    return out;
  }
</script>

<aside class="library panel-section">
  <div class="section-title">版式库</div>
  <div style="overflow:auto;padding:0 12px 16px;flex:1;min-height:0;">
    {#each GROUPS as group}
      <div class="group-label">{group.label}模板</div>
      {#each TEMPLATES.filter((t) => t.kind === group.kind) as tpl}
        {@const card = shapes(tpl)}
        <div class="tpl-card">
          <button class="tpl-thumb" title="点击插入到相册末尾"
            onclick={() => store.addPage(tpl.id)}>
            <svg viewBox="0 0 400 280" preserveAspectRatio="xMidYMid meet">
              <rect x="0" y="0" width="197" height="280" rx="4" fill="#fff" stroke="#c9b8a3" stroke-width="1.5" />
              <rect x="203" y="0" width="197" height="280" rx="4" fill="#fff" stroke="#c9b8a3" stroke-width="1.5" />
              <line x1="200" y1="0" x2="200" y2="280" stroke="#e0d7ca" stroke-width="6" />
              {#each card as r}
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="3"
                  fill={r.spread ? '#cfa97f' : '#e6d8c5'}
                  stroke="#9a6d42" stroke-width="1.2" />
              {/each}
            </svg>
          </button>
          <div class="tpl-name" title={tpl.name}>{tpl.name}</div>
          <button class="apply-btn" onclick={() => store.applyTemplate(store.pageIndex, tpl.id)}
            title="替换当前对开页的版式（尽量保留已填充照片）">
            应用到当前页
          </button>
        </div>
      {/each}
    {/each}
  </div>
</aside>

<style>
  .group-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-dark);
    margin: 10px 2px 6px;
    padding-left: 2px;
    border-left: 3px solid var(--accent);
    padding-left: 7px;
  }
  .tpl-card {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 8px;
    margin-bottom: 10px;
    transition: border-color .15s, box-shadow .15s;
  }
  .tpl-card:hover {
    border-color: var(--accent);
    box-shadow: var(--shadow);
  }
  .tpl-thumb {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: var(--panel-2);
    border-radius: 6px;
    overflow: hidden;
  }
  .tpl-thumb svg { display: block; width: 100%; height: auto; }
  .tpl-name {
    font-size: 12px;
    text-align: center;
    margin: 6px 0 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .apply-btn {
    width: 100%;
    font-size: 11px;
    padding: 4px 0;
    color: var(--accent-dark);
  }
</style>
