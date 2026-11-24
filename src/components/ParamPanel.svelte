<script lang="ts">
  import { get } from 'svelte/store';
  import { model } from '../lib/hair/model';
  import { endDragSnapshot } from '../lib/hair/history';
  import { PARAM_LIMITS, type HairBundle, type ParamKey } from '../lib/hair/types';
  import { activeGroupId, modelVersion, selection } from '../lib/state/stores';

  const PARAM_LABELS: { key: ParamKey; label: string }[] = [
    { key: 'length', label: '长度' },
    { key: 'thickness', label: '粗细' },
    { key: 'curl', label: '卷曲度' },
    { key: 'direction', label: '弯曲方向' },
    { key: 'tilt', label: '下垂角' },
    { key: 'fluff', label: '蓬松度' },
  ];

  // 目标集合：组优先，其次选中
  let targetIds: string[] = [];
  let targetLabel = '';
  $: if ($modelVersion >= 0) {
    const gid = $activeGroupId;
    if (gid && model.groups.has(gid)) {
      targetIds = [...(model.groups.get(gid)?.memberIds ?? [])];
      targetLabel = `组「${model.groups.get(gid)?.name}」（${targetIds.length} 束，联动调整）`;
    } else {
      targetIds = [...$selection];
      targetLabel =
        targetIds.length === 0
          ? '未选中发束'
          : targetIds.length === 1
            ? '单束调整'
            : `${targetIds.length} 束（按相对关系联动）`;
    }
  }

  function bundleOf(id: string): HairBundle | undefined {
    return model.bundles.get(id);
  }

  // _v 仅为建立对 $modelVersion 的响应式依赖，使外部修改（梳子/撤销等）后滑杆刷新
  function displayValue(key: ParamKey, _v: number): number {
    const first = targetIds[0] ? bundleOf(targetIds[0]) : undefined;
    return first ? first.params[key] : 0;
  }

  // 一次滑杆拖动 = 一条历史记录：首次 input 时记录各束初值，change 时提交
  let session: { key: ParamKey; before: Map<string, HairBundle | null>; start: Map<string, number> } | null = null;

  function onInput(key: ParamKey, e: Event) {
    if (targetIds.length === 0) return;
    const newVal = Number((e.target as HTMLInputElement).value);
    if (!session || session.key !== key) {
      session = {
        key,
        before: model.snapshot(targetIds),
        start: new Map(targetIds.map((id) => [id, bundleOf(id)?.params[key] ?? 0])),
      };
    }
    const firstStart = session.start.get(targetIds[0]!) ?? 0;
    const delta = newVal - firstStart;
    const lim = PARAM_LIMITS[key];
    for (const id of targetIds) {
      const start = session.start.get(id) ?? 0;
      model.setParam(id, key, Math.min(lim.max, Math.max(lim.min, start + delta)));
    }
  }

  function onCommit(key: ParamKey) {
    if (!session || session.key !== key) return;
    endDragSnapshot('参数调整', targetIds, session.before);
    session = null;
  }
</script>

<section class="panel">
  <h3>发束参数</h3>
  <p class="hint">{targetLabel}</p>
  {#each PARAM_LABELS as { key, label } (key)}
    {@const lim = PARAM_LIMITS[key]}
    <label class="row">
      <span>{label}</span>
      <input
        type="range"
        min={lim.min}
        max={lim.max}
        step={lim.step}
        value={displayValue(key, $modelVersion)}
        disabled={targetIds.length === 0}
        on:input={(e) => onInput(key, e)}
        on:change={() => onCommit(key)}
      />
      <em>{displayValue(key, $modelVersion).toFixed(key === 'direction' || key === 'tilt' ? 0 : 2)}</em>
    </label>
  {/each}
</section>

<style>
  .panel {
    padding: 10px 12px;
    border-bottom: 1px solid #333;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 13px;
    color: #ddd;
  }
  .hint {
    margin: 0 0 8px;
    font-size: 11px;
    color: #888;
  }
  .row {
    display: grid;
    grid-template-columns: 52px 1fr 40px;
    align-items: center;
    gap: 8px;
    margin: 4px 0;
    font-size: 12px;
    color: #bbb;
  }
  .row em {
    font-style: normal;
    text-align: right;
    color: #eee;
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    width: 100%;
  }
</style>
