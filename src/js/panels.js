/** Side panels: element library, scene tree, inspector. */

import { TYPES, TYPE_LIST } from '../geometry/solids.js';
import {
  elementById,
  elementDisplayName,
  groupDisplayName,
  docStats,
  defaultsOf,
  looseElements,
} from '../model/doc.js';
import { clamp, fmt } from '../util.js';
import { icon, typeIcon } from './ui.js';

const CATEGORIES = [
  { key: 'ramp', label: '坡道' },
  { key: 'street', label: '台阶 / 台子' },
  { key: 'rail', label: '栏杆' },
];

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

export function renderCategoryTabs(host, active, onPick) {
  host.innerHTML = '';
  for (const cat of CATEGORIES) {
    const btn = document.createElement('button');
    btn.className = 'cat-tab';
    btn.textContent = cat.label;
    btn.dataset.active = cat.key === active ? 'true' : 'false';
    btn.addEventListener('click', () => onPick(cat.key));
    host.appendChild(btn);
  }
}

export function renderLibrary(host, category, { placingType, onPlace, onHover }) {
  host.innerHTML = '';
  const items = TYPE_LIST.filter((t) => t.category === category);
  for (const def of items) {
    const card = document.createElement('button');
    card.className = 'lib-card';
    card.dataset.type = def.key;
    card.dataset.placing = placingType === def.key ? 'true' : 'false';
    card.title = `${def.name} · ${def.hint}`;
    card.innerHTML = `
      <span class="lib-thumb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${def.icon}" /></svg></span>
      <span class="lib-name">${def.name}</span>
      <span class="lib-en">${def.en}</span>
    `;
    card.addEventListener('click', () => onPlace(def.key));
    card.addEventListener('mouseenter', () => onHover?.(def.key));
    card.addEventListener('mouseleave', () => onHover?.(null));
    host.appendChild(card);
  }
}

export function markPlacing(host, type) {
  for (const card of host.querySelectorAll('.lib-card')) {
    card.dataset.placing = card.dataset.type === type ? 'true' : 'false';
  }
}

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

export function renderTree(host, doc, state, handlers) {
  const selected = new Set(state.selection);
  const overlapIds = new Set();
  for (const cluster of state.overlaps) for (const id of cluster.ids) overlapIds.add(id);

  const scrollTop = host.scrollTop;
  host.innerHTML = '';

  const groupedIds = new Set();
  for (const g of doc.groups) {
    for (const id of g.members) groupedIds.add(id);
    for (const id of g.cutters) groupedIds.add(id);
  }

  // Groups first, then loose elements — matches how the scene reads.
  for (const group of doc.groups) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-group';

    const head = document.createElement('div');
    head.className = 'tree-group-head';
    head.dataset.selected = selected.has(group.id) ? 'true' : 'false';
    head.dataset.overlap = group.cutters.length ? 'true' : 'false';
    head.innerHTML = `
      <span class="tree-icon">${icon('group')}</span>
      <span class="tree-name">${escape(groupDisplayName(doc, group))}</span>
      <span class="tree-meta">${group.members.length}${group.cutters.length ? `−${group.cutters.length}` : ''}</span>
    `;
    head.addEventListener('click', (e) => handlers.onSelectGroup(group.id, e));
    wrap.appendChild(head);

    for (const id of group.members) {
      const el = elementById(doc, id);
      if (!el) continue;
      wrap.appendChild(memberRow(el, 'base', handlers));
    }
    for (const id of group.cutters) {
      const el = elementById(doc, id);
      if (!el) continue;
      wrap.appendChild(memberRow(el, 'cut', handlers));
    }
    host.appendChild(wrap);
  }

  const loose = doc.elements.filter((el) => !groupedIds.has(el.id));
  for (const el of loose) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.selected = selected.has(el.id) ? 'true' : 'false';
    row.dataset.overlap = overlapIds.has(el.id) ? 'true' : 'false';
    row.innerHTML = `
      <span class="tree-icon">${typeIcon(el.type)}</span>
      <span class="tree-name">${escape(elementDisplayName(el))}</span>
      <span class="tree-meta">${TYPES[el.type]?.en || ''}</span>
    `;
    row.addEventListener('click', (e) => handlers.onSelectElement(el.id, e));
    row.addEventListener('dblclick', () => handlers.onFocus?.(el.id));
    host.appendChild(row);
  }

  if (!doc.elements.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = '还没有场地元素。<br />从上方元素库点选一个开始。';
    host.appendChild(empty);
  }

  host.scrollTop = scrollTop;
}

function memberRow(el, role, handlers) {
  const row = document.createElement('div');
  row.className = 'tree-row tree-member';
  row.innerHTML = `
    <span class="tree-icon">${typeIcon(el.type)}</span>
    <span class="tree-name">${escape(elementDisplayName(el))}</span>
    <span class="tree-meta" style="color:${role === 'cut' ? 'var(--danger)' : 'var(--text-3)'}">${role === 'cut' ? '差集' : ''}</span>
  `;
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onSelectElement(el.id, e);
  });
  return row;
}

/* ------------------------------------------------------------------ */
/* Inspector                                                           */
/* ------------------------------------------------------------------ */

function selectionKindOf(doc, selection) {
  if (!selection.length) return 'none';
  if (selection.length > 1) return 'multi';
  const id = selection[0];
  if (doc.groups.some((g) => g.id === id)) return 'group';
  if (doc.elements.some((e) => e.id === id)) return 'element';
  return 'none';
}

export function renderInspector(host, doc, state, handlers) {
  const kind = selectionKindOf(doc, state.selection);
  const scrollTop = host.scrollTop;
  host.innerHTML = '';

  if (kind === 'none') {
    host.appendChild(emptyInspector(doc, state, handlers));
  } else if (kind === 'multi') {
    host.appendChild(multiInspector(doc, state, handlers));
  } else if (kind === 'group') {
    host.appendChild(groupInspector(doc, state, handlers));
  } else {
    host.appendChild(elementInspector(doc, state, handlers));
  }
  host.scrollTop = scrollTop;
}

function emptyInspector(doc, state, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'insp-empty';
  wrap.innerHTML = `
    <h3>开始搭建</h3>
    <p>点击左侧元素库放置坡道、栏杆或台阶，在地面上点一下即可落位；放置时按住 Shift 可以连续布置。</p>
    <p>元素交叠时，视口会给出合并提示，可将它们并集成一个流形实体。</p>
    <p style="margin-top:12px;color:var(--text-3)">
      <kbd>拖动</kbd> 移动 · <kbd>R</kbd> 旋转 · <kbd>S</kbd> 吸附 · <kbd>F</kbd> 全览 · <kbd>Delete</kbd> 删除
    </p>
  `;
  if (!doc.elements.length) {
    const actions = document.createElement('div');
    actions.className = 'btn-row';
    actions.style.marginTop = '14px';
    const btn = document.createElement('button');
    btn.className = 'btn btn-accent';
    btn.textContent = '载入示例场地';
    btn.addEventListener('click', () => handlers.onLoadDemo?.());
    actions.appendChild(btn);
    wrap.appendChild(actions);
  }
  return wrap;
}

function header({ title, subtitle, tags = [], onRename, editable = true }) {
  const head = document.createElement('div');
  head.className = 'insp-head';
  const row = document.createElement('div');
  row.className = 'insp-title-row';
  row.innerHTML = `<span class="tree-icon" style="color:var(--accent)">${icon('layers')}</span>`;
  const input = document.createElement('input');
  input.className = 'insp-title';
  input.value = title;
  input.spellcheck = false;
  input.maxLength = 48;
  if (!editable) input.readOnly = true;
  input.addEventListener('change', () => onRename && onRename(input.value.trim() || title));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    e.stopPropagation();
  });
  row.appendChild(input);
  head.appendChild(row);
  if (subtitle || tags.length) {
    const sub = document.createElement('div');
    sub.className = 'insp-sub';
    if (subtitle) {
      const s = document.createElement('span');
      s.textContent = subtitle;
      sub.appendChild(s);
    }
    for (const tag of tags) {
      const t = document.createElement('span');
      t.className = `tag ${tag.kind || ''}`;
      t.textContent = tag.text;
      sub.appendChild(t);
    }
    head.appendChild(sub);
  }
  return head;
}

function field({ label, value, min, max, step, unit, onInput, integer, onGestureStart, onGestureEnd }) {
  const row = document.createElement('div');
  row.className = 'field';
  const lab = document.createElement('label');
  lab.className = 'field-label';
  lab.textContent = label;
  const range = document.createElement('input');
  range.type = 'range';
  range.min = min;
  range.max = max;
  range.step = step;
  range.value = value;
  const num = document.createElement('input');
  num.className = 'num-input';
  num.type = 'number';
  num.min = min;
  num.max = max;
  num.step = step;
  num.value = fmt(value, step < 0.05 ? 3 : 2);
  if (unit) num.title = `${label} (${unit})`;

  const apply = (v) => {
    let n = Number(v);
    if (!Number.isFinite(n)) return;
    n = clamp(n, Number(min), Number(max));
    if (integer) n = Math.round(n);
    range.value = n;
    num.value = fmt(n, step < 0.05 ? 3 : 2);
    onInput(n);
  };

  // A slider drag is one undo entry, not one per pixel.
  let dragging = false;
  range.addEventListener('pointerdown', () => {
    dragging = true;
    onGestureStart?.();
  });
  range.addEventListener('input', () => apply(range.value));
  const endGesture = () => {
    if (!dragging) return;
    dragging = false;
    onGestureEnd?.();
  };
  range.addEventListener('pointerup', endGesture);
  range.addEventListener('pointercancel', endGesture);
  range.addEventListener('blur', endGesture);
  num.addEventListener('change', () => {
    onGestureStart?.();
    apply(num.value);
    onGestureEnd?.();
  });
  num.addEventListener('keydown', (e) => e.stopPropagation());

  row.append(lab, range, num);
  row._setValue = (v) => {
    range.value = v;
    num.value = fmt(v, step < 0.05 ? 3 : 2);
  };
  return row;
}

function section(title, hint) {
  const box = document.createElement('div');
  box.className = 'field-group';
  const head = document.createElement('div');
  head.className = 'field-group-title';
  head.innerHTML = `<span>${escape(title)}</span>${hint ? `<span class="hint">${escape(hint)}</span>` : ''}`;
  box.appendChild(head);
  return box;
}

function vecField(label, value, onInput, { min = -60, max = 60, step = 0.1 } = {}) {
  const row = document.createElement('div');
  row.className = 'field';
  const lab = document.createElement('span');
  lab.className = 'field-label';
  lab.textContent = label;
  const grid = document.createElement('div');
  grid.className = 'vec3';
  const inputs = [];
  const axes = ['X', 'Y', 'Z'];
  axes.forEach((axis, i) => {
    const cell = document.createElement('div');
    cell.className = 'vec3-cell';
    const tag = document.createElement('span');
    tag.textContent = axis;
    const input = document.createElement('input');
    input.className = 'num-input';
    input.type = 'number';
    input.step = step;
    input.min = i === 1 ? 0 : min;
    input.max = max;
    input.value = fmt(value[i], 2);
    input.addEventListener('change', () => {
      const next = [...value];
      const n = Number(input.value);
      if (Number.isFinite(n)) next[i] = i === 1 ? Math.max(0, n) : clamp(n, min, max);
      onInput(next);
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    cell.append(tag, input);
    grid.appendChild(cell);
    inputs.push(input);
  });
  row.append(lab, grid);
  row.style.gridTemplateColumns = '76px minmax(0, 1fr)';
  row._setValue = (v) => {
    inputs.forEach((inp, i) => {
      if (document.activeElement !== inp) inp.value = fmt(v[i], 2);
    });
  };
  return row;
}

function buttonRow(buttons) {
  const row = document.createElement('div');
  row.className = 'btn-row';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = `btn ${b.kind || ''}`;
    btn.innerHTML = `${b.icon ? icon(b.icon) : ''}<span>${escape(b.label)}</span>`;
    btn.disabled = Boolean(b.disabled);
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  return row;
}

function elementInspector(doc, state, handlers) {
  const id = state.selection[0];
  const el = elementById(doc, id);
  if (!el) return emptyInspector(doc, state, handlers);
  const def = TYPES[el.type];
  const group = doc.groups.find((g) => g.members.includes(id) || g.cutters.includes(id));

  const wrap = document.createElement('div');
  wrap.appendChild(
    header({
      title: elementDisplayName(el),
      subtitle: `${def.name} · ${def.en}`,
      tags: group ? [{ text: '已合并', kind: 'accent' }] : [],
      onRename: (name) => handlers.onRename(id, name),
    }),
  );

  const body = document.createElement('div');
  body.className = 'insp-body';

  // Dimensions
  const dims = section('尺寸', 'm');
  for (const p of def.params) {
    dims.appendChild(
      field({
        label: p.label,
        value: el.params[p.key],
        min: p.min,
        max: p.max,
        step: p.step,
        unit: p.unit,
        integer: p.integer,
        onInput: (v) => handlers.onParam(id, { [p.key]: v }, true),
        onGestureStart: () => handlers.onGestureStart?.('调整尺寸'),
        onGestureEnd: () => handlers.onGestureEnd?.(),
      }),
    );
  }
  body.appendChild(dims);

  // Transform
  const settings = doc.settings || {};
  const xf = section('位置与朝向', settings.snapEnabled ? `吸附 ${fmt(settings.snapStep, 2)} m` : '自由');
  xf.appendChild(vecField('坐标', el.position, (pos) => handlers.onPosition(id, pos)));
  xf.appendChild(
    field({
      label: '旋转',
      value: el.rotationY || 0,
      min: -180,
      max: 180,
      step: 5,
      unit: '°',
      onInput: (v) => handlers.onRotation(id, v, true),
      onGestureStart: () => handlers.onGestureStart?.('旋转元素'),
      onGestureEnd: () => handlers.onGestureEnd?.(),
    }),
  );
  xf.appendChild(
    buttonRow([
      { label: '原地复制', icon: 'duplicate', onClick: () => handlers.onDuplicate(id) },
      { label: '删除', icon: 'trash', kind: 'btn-danger', onClick: () => handlers.onDelete([id]) },
    ]),
  );
  body.appendChild(xf);

  // Boolean / grouping
  const bool = section('布尔合并', group ? '已加入合并组' : '选中多个元素可合并');
  if (group) {
    const note = document.createElement('div');
    note.className = 'section-note';
    note.textContent = group.cutters.includes(id)
      ? '该元素作为切割体，从所在合并组中减去'
      : `该元素是合并组「${groupDisplayName(doc, group)}」的实体部分`;
    bool.appendChild(note);
    bool.appendChild(
      buttonRow([
        { label: '查看合并组', icon: 'group', onClick: () => handlers.onSelectGroup(group.id) },
        { label: '解组', icon: 'ungroup', onClick: () => handlers.onUngroup(group.id) },
      ]),
    );
  } else {
    const note = document.createElement('div');
    note.className = 'section-note';
    note.textContent = '按住 Shift 点选另一个元素，即可与它并集合并，合并后自动重算法线与轮廓';
    bool.appendChild(note);
    bool.appendChild(
      buttonRow([
        { label: '合并所选', icon: 'merge', kind: 'btn-accent', disabled: state.selection.length < 2, onClick: () => handlers.onMerge() },
        { label: '设为切割体', icon: 'cut', disabled: state.selection.length < 2, onClick: () => handlers.onSubtract() },
      ]),
    );
    const hit = (state.overlaps || []).find((c) => c.ids.includes(id) && c.targetGroupId);
    const hitGroup = hit ? doc.groups.find((g) => g.id === hit.targetGroupId) : null;
    if (hitGroup) {
      const warn = document.createElement('div');
      warn.className = 'section-note';
      warn.style.color = 'var(--accent)';
      warn.textContent = `该元素与合并组「${groupDisplayName(doc, hitGroup)}」交叠`;
      bool.appendChild(warn);
      bool.appendChild(
        buttonRow([
          {
            label: '并入该合并组',
            icon: 'merge',
            kind: 'btn-accent',
            onClick: () => handlers.onMergeIntoGroup(hitGroup.id, [id]),
          },
        ]),
      );
    }
  }
  body.appendChild(bool);

  // Geometry readout
  const info = section('几何信息', '实时');
  const bounds = state.payload?.worldBounds?.[id];
  const grid = document.createElement('div');
  grid.className = 'geo-info';
  const size = bounds
    ? [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]]
    : null;
  grid.innerHTML = `
    <div class="geo-cell"><span>占地</span><b>${size ? `${fmt(size[0], 1)} × ${fmt(size[2], 1)}` : '—'}</b></div>
    <div class="geo-cell"><span>高度</span><b>${size ? fmt(size[1], 2) : '—'}</b></div>
  `;
  info.appendChild(grid);
  if (group) {
    const gi = state.payload?.groupInfo?.[group.id];
    if (gi) {
      const cells = document.createElement('div');
      cells.className = 'geo-info';
      cells.innerHTML = `
        <div class="geo-cell"><span>三角面</span><b>${gi.triangles}</b></div>
        <div class="geo-cell"><span>体积</span><b>${fmt(gi.volume, 2)} m³</b></div>
        <div class="geo-cell"><span>亏格</span><b>${gi.genus}</b></div>
        <div class="geo-cell"><span>流形</span><b class="${gi.status === 'NoError' ? 'ok' : 'bad'}">${gi.status === 'NoError' ? '有效' : gi.status}</b></div>
      `;
      info.appendChild(cells);
    }
  }
  body.appendChild(info);

  wrap.appendChild(body);
  return wrap;
}

function groupInspector(doc, state, handlers) {
  const id = state.selection[0];
  const group = doc.groups.find((g) => g.id === id);
  if (!group) return emptyInspector(doc, state, handlers);
  const info = state.payload?.groupInfo?.[id];
  const err = state.payload?.groupErrors?.find((e) => e.groupId === id);

  const wrap = document.createElement('div');
  wrap.appendChild(
    header({
      title: groupDisplayName(doc, group),
      subtitle: '合并组',
      tags: err ? [{ text: '合并失败', kind: 'danger' }] : [{ text: '流形实体', kind: 'accent' }],
      onRename: (name) => handlers.onRenameGroup(id, name),
    }),
  );

  const body = document.createElement('div');
  body.className = 'insp-body';

  if (err) {
    const warn = document.createElement('div');
    warn.className = 'section-note';
    warn.style.color = 'var(--danger)';
    warn.textContent = `合并失败：${err.message}`;
    body.appendChild(warn);
  }

  const members = section('合并成员', `${group.members.length} 并 + ${group.cutters.length} 减`);
  const list = document.createElement('div');
  list.className = 'member-list';
  for (const memberId of group.members) {
    const el = elementById(doc, memberId);
    if (!el) continue;
    list.appendChild(memberChip(el, 'base', handlers, group.id));
  }
  for (const cutId of group.cutters) {
    const el = elementById(doc, cutId);
    if (!el) continue;
    list.appendChild(memberChip(el, 'cut', handlers, group.id));
  }
  members.appendChild(list);
  body.appendChild(members);

  const xf = section('整体调整', '移动整组');
  const bounds = state.payload?.groupBounds?.[id];
  if (bounds) {
    const note = document.createElement('div');
    note.className = 'section-note';
    note.textContent = `包围盒 ${fmt(bounds.max[0] - bounds.min[0], 2)} × ${fmt(bounds.max[1] - bounds.min[1], 2)} × ${fmt(bounds.max[2] - bounds.min[2], 2)} m`;
    xf.appendChild(note);
  }
  xf.appendChild(
    buttonRow([
      { label: '向前', onClick: () => handlers.onNudgeGroup(id, [0, 0, -0.1]) },
      { label: '向左', onClick: () => handlers.onNudgeGroup(id, [-0.1, 0, 0]) },
      { label: '向右', onClick: () => handlers.onNudgeGroup(id, [0.1, 0, 0]) },
      { label: '向后', onClick: () => handlers.onNudgeGroup(id, [0, 0, 0.1]) },
    ]),
  );
  body.appendChild(xf);

  const ops = section('合并操作', '布尔运算');
  if (info) {
    const cells = document.createElement('div');
    cells.className = 'geo-info';
    cells.innerHTML = `
      <div class="geo-cell"><span>三角面</span><b>${info.triangles}</b></div>
      <div class="geo-cell"><span>体积</span><b>${fmt(info.volume, 2)} m³</b></div>
      <div class="geo-cell"><span>亏格</span><b>${info.genus}</b></div>
      <div class="geo-cell"><span>状态</span><b class="${info.status === 'NoError' ? 'ok' : 'bad'}">${info.status === 'NoError' ? '流形正确' : info.status}</b></div>
    `;
    ops.appendChild(cells);
  }
  ops.appendChild(
    buttonRow([
      { label: '解组', icon: 'ungroup', onClick: () => handlers.onUngroup(id) },
      { label: '删除组', icon: 'trash', kind: 'btn-danger', onClick: () => handlers.onDeleteGroup(id) },
    ]),
  );
  body.appendChild(ops);

  wrap.appendChild(body);
  return wrap;
}

function memberChip(el, role, handlers, groupId) {
  const chip = document.createElement('div');
  chip.className = `member-chip ${role === 'cut' ? 'is-cut' : ''}`;
  chip.innerHTML = `
    <span class="tree-icon">${typeIcon(el.type)}</span>
    <span class="name">${escape(elementDisplayName(el))}</span>
    <span class="role ${role}">${role === 'cut' ? '减' : '并'}</span>
  `;
  const x = document.createElement('button');
  x.className = 'mini-x';
  x.textContent = '×';
  x.title = role === 'cut' ? '移除切割体' : '从合并组中移除';
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    if (role === 'cut') handlers.onRemoveCutter(groupId, el.id);
    else handlers.onRemoveMember(groupId, el.id);
  });
  chip.appendChild(x);
  chip.addEventListener('click', () => handlers.onSelectElement(el.id));
  return chip;
}

function multiInspector(doc, state, handlers) {
  const wrap = document.createElement('div');
  const ids = state.selection;
  wrap.appendChild(
    header({
      title: `已选择 ${ids.length} 个元素`,
      subtitle: '可以合并为流形实体',
      editable: false,
      onRename: null,
    }),
  );
  const body = document.createElement('div');
  body.className = 'insp-body';

  const listSection = section('选择内容');
  const list = document.createElement('div');
  list.className = 'member-list';
  for (const id of ids) {
    const el = elementById(doc, id);
    if (!el) {
      const g = doc.groups.find((x) => x.id === id);
      if (!g) continue;
      const chip = document.createElement('div');
      chip.className = 'member-chip';
      chip.innerHTML = `<span class="tree-icon">${icon('group')}</span><span class="name">${escape(groupDisplayName(doc, g))}</span><span class="role">组</span>`;
      list.appendChild(chip);
      continue;
    }
    const chip = document.createElement('div');
    chip.className = 'member-chip';
    chip.innerHTML = `<span class="tree-icon">${typeIcon(el.type)}</span><span class="name">${escape(elementDisplayName(el))}</span><span class="role">${TYPES[el.type].en}</span>`;
    chip.addEventListener('click', () => handlers.onSelectElement(el.id, { additive: false }));
    list.appendChild(chip);
  }
  listSection.appendChild(list);
  body.appendChild(listSection);

  const overlaps = state.overlaps.filter((c) => c.ids.some((id) => ids.includes(id)) && c.targetGroupId);
  const targetGroup = overlaps.length
    ? doc.groups.find((g) => g.id === overlaps[0].targetGroupId)
    : null;
  const looseOnly = ids.filter((id) => elementById(doc, id));
  const note = document.createElement('div');
  note.className = 'section-note';
  if (targetGroup && looseOnly.length) {
    note.textContent = `所选元素与合并组「${groupDisplayName(doc, targetGroup)}」交叠：可以并入该组合成一个流形模型，或单独合并为新组。`;
  } else if (overlaps.length) {
    note.textContent = '所选元素彼此交叠，可以执行并集生成流形实体；用差集可以挖出碗池或切口。';
  } else {
    note.textContent = '所选元素没有交叠，并集后仍会成为一个流形实体（相邻面会被缝合）。';
  }
  body.appendChild(note);

  body.appendChild(
    buttonRow([
      { label: '并集合并', icon: 'merge', kind: 'btn-accent', onClick: () => handlers.onMerge() },
      { label: '差集挖除', icon: 'cut', onClick: () => handlers.onSubtract() },
    ]),
  );
  if (targetGroup && looseOnly.length) {
    body.appendChild(
      buttonRow([
        {
          label: `并入「${groupDisplayName(doc, targetGroup)}」`,
          icon: 'group',
          kind: 'btn-accent',
          onClick: () => handlers.onMergeIntoGroup(targetGroup.id, looseOnly),
        },
      ]),
    );
  }
  body.appendChild(
    buttonRow([
      { label: '删除所选', icon: 'trash', kind: 'btn-danger', onClick: () => handlers.onDelete(ids) },
      { label: '清除选择', onClick: () => handlers.onClearSelection() },
    ]),
  );

  wrap.appendChild(body);
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Coach panel (overlap prompt)                                        */
/* ------------------------------------------------------------------ */

export function renderCoach(host, bodyHost, doc, state, handlers) {
  const clusters = state.overlaps || [];
  if (!clusters.length) {
    host.hidden = true;
    return;
  }
  const sel = new Set(state.selection);
  const relevant =
    clusters.find((c) => c.ids.some((id) => sel.has(id))) ||
    clusters.slice().sort((a, b) => b.ids.length - a.ids.length)[0];
  if (!relevant) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  bodyHost.innerHTML = '';

  const single = relevant.ids.length;
  const group = relevant.targetGroupId ? doc.groups.find((g) => g.id === relevant.targetGroupId) : null;
  const looseIds = relevant.ids.filter((id) => !relevant.groupIds.includes(id));

  const title = document.createElement('div');
  title.className = 'coach-title';
  title.textContent = group
    ? `${looseIds.length} 个元素与「${groupDisplayName(doc, group)}」交叠`
    : `${single} 个元素互相交叠`;
  bodyHost.appendChild(title);

  const text = document.createElement('div');
  text.className = 'coach-body';
  text.textContent = group
    ? '并入后会与原实体缝合为一个流形模型，内部相交面自动移除。'
    : '并集会把它们缝合为一个流形实体，交叠部分的内部面会被移除。';
  bodyHost.appendChild(text);

  const ul = document.createElement('ul');
  ul.className = 'coach-list';
  if (group) {
    const li = document.createElement('li');
    li.textContent = `合并组 · ${groupDisplayName(doc, group)}`;
    ul.appendChild(li);
  }
  for (const id of looseIds.slice(0, 4)) {
    const el = elementById(doc, id);
    if (!el) continue;
    const li = document.createElement('li');
    li.textContent = elementDisplayName(el);
    ul.appendChild(li);
  }
  if (looseIds.length > 4) {
    const li = document.createElement('li');
    li.textContent = `另外 ${looseIds.length - 4} 件…`;
    ul.appendChild(li);
  }
  bodyHost.appendChild(ul);

  const actions = document.createElement('div');
  actions.className = 'coach-actions';
  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'btn btn-accent';
  mergeBtn.innerHTML = `${icon('merge')}<span>${group ? '并入合并组' : '合并这些元素'}</span>`;
  mergeBtn.addEventListener('click', () => {
    if (group) handlers.onMergeIntoGroup(group.id, looseIds);
    else handlers.onMerge(relevant.ids);
  });
  const selectBtn = document.createElement('button');
  selectBtn.className = 'btn';
  selectBtn.textContent = '选中它们';
  selectBtn.addEventListener('click', () => handlers.onSelectIds(relevant.ids));
  actions.append(mergeBtn, selectBtn);
  bodyHost.appendChild(actions);
}

/* ------------------------------------------------------------------ */
/* Status helpers                                                      */
/* ------------------------------------------------------------------ */

export function renderStatusBar(els, doc, state) {
  const stats = docStats(doc);
  els.elements.textContent = stats.elements;
  els.groups.textContent = stats.groups;
  els.tris.textContent = state.payload?.stats ? state.payload.stats.triangles.toLocaleString('en-US') : '0';
  els.edges.textContent = state.payload?.stats ? state.payload.stats.edgeSegments.toLocaleString('en-US') : '0';
  els.ms.textContent = state.payload?.stats ? state.payload.stats.buildMs : '0';
  els.ops.textContent = stats.mergeOps;
  els.ops.title = `本项目累计记录 ${stats.mergeOps} 次并集/差集`;
  if (els.treeCount) els.treeCount.textContent = `${stats.elements} 件 · ${stats.groups} 组`;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { escape };
