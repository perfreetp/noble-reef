/**
 * App bootstrap: wires store, geometry worker, viewport and panels together.
 */

import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GeometryClient } from './js/geometryClient.js';
import { Store } from './js/store.js';
import { Viewport } from './js/viewport.js';
import { TYPES } from './geometry/solids.js';
import {
  renderCategoryTabs,
  renderLibrary,
  markPlacing,
  renderTree,
  renderInspector,
  renderCoach,
  renderStatusBar,
  escape,
} from './js/panels.js';
import { icon, initToasts, toast, setPressed } from './js/ui.js';
import { buildCollisionExport, buildObjExport } from './js/exporters.js';
import {
  createDemoDoc,
  addMembersToGroup,
  createEmptyDoc,
  addElement,
  updateElement,
  updateGroup,
  deleteElements,
  duplicateElement,
  mergeElements,
  subtractElements,
  removeCutter,
  ungroup,
  translateGroup,
  groupOfElement,
  elementById,
  groupById,
  elementDisplayName,
  groupDisplayName,
  findOverlapClusters,
  normalizeDoc,
  serializeDoc,
  defaultsOf,
} from './model/doc.js';
import { clamp, debounce, fmt, downloadBlob, timestampName, round } from './util.js';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'grind.skatepark.autosave.v1';

const doc = loadInitialDoc();
const store = new Store(doc);
const client = new GeometryClient();
initToasts($('#toasts'));

const viewport = new Viewport($('#scene'), {
  onSelect: (id, mods) => selectEntity(id, mods),
  onBackground: () => {
    if (store.state.placingType) return;
    store.clearSelection();
  },
  onPlaceConfirm: (type, ground, shift) => placeAt(type, ground, shift),
  onPlaceHover: (ground) => hoverGhost(ground),
  onDragStart: (id, ground) => beginDrag(id, ground),
  onDrag: (id, dx, dz) => updateDrag(id, dx, dz),
  onGroupPreview: (groupId, dx, dz) => previewGroupDrag(groupId, dx, dz),
  onInteractionStart: () => store.beginTransaction('移动'),
  onInteractionEnd: () => finishInteraction(),
  onTransformMove: (id, pos) => gizmoMove(id, pos),
  onTransformRotate: (id, deg) => gizmoRotate(id, deg),
  onScaleStart: (id) => beginScale(id),
  onTransformScale: (id, s) => gizmoScale(id, s),
  onFocusElement: (id) => viewport.focusElement(id),
  onCameraStart: () => {},
});

viewport.setSettings(store.doc.settings);

const dom = {
  categoryTabs: $('#category-tabs'),
  library: $('#library'),
  tree: $('#tree'),
  treeCount: $('#tree-count'),
  inspector: $('#inspector'),
  projectName: $('#project-name'),
  saveState: $('#save-state'),
  saveStateEl: $('#save-state'),
  undo: $('#btn-undo'),
  redo: $('#btn-redo'),
  snap: $('#btn-snap'),
  snapStep: $('#snap-step'),
  edgeSnap: $('#btn-edge-snap'),
  chipEdges: $('#chip-edges'),
  chipGrid: $('#chip-grid'),
  chipCollision: $('#chip-collision'),
  chipCutters: $('#chip-cutters'),
  statusHint: $('#status-hint'),
  engineDot: $('#engine-dot'),
  engineStatus: $('#engine-status'),
  coach: $('#coach'),
  coachBody: $('#coach-body'),
  loading: $('#loading'),
  stat: {
    elements: $('#stat-elements'),
    groups: $('#stat-groups'),
    tris: $('#stat-tris'),
    edges: $('#stat-edges'),
    ms: $('#stat-ms'),
    ops: $('#stat-ops'),
    treeCount: $('#tree-count'),
  },
};

setupTopBar();
setupViewportChips();
setupGizmoRail();
setupHelpDialog();
setupMobileDrawers();
setupKeyboard();

let rebuildScheduled = false;
const autosave = debounce(persistLocal, 900);

/* ------------------------------------------------------------------ */
/* Geometry pipeline                                                   */
/* ------------------------------------------------------------------ */

client.on('ready', () => {
  store.set({ engine: 'ready', engineMessage: '就绪' }, 'engine');
  scheduleRebuild(true);
});

client.on('fatal', (msg) => {
  store.set({ engine: 'error', engineMessage: msg.message }, 'engine');
  dom.loading.classList.add('done');
  setTimeout(() => dom.loading.setAttribute('hidden', ''), 500);
  toast(msg.message, 'err', 9000);
});

client.start();

function scheduleRebuild(immediate = false) {
  if (rebuildScheduled) return;
  rebuildScheduled = true;
  const run = () => {
    rebuildScheduled = false;
    rebuild();
  };
  if (immediate) run();
  else requestAnimationFrame(run);
}

let buildToken = 0;
async function rebuild() {
  if (store.state.engine !== 'ready') return;
  const token = ++buildToken;
  const snapshot = structuredClone(store.doc);
  const opts = { sharpAngle: store.doc.settings.sharpAngle ?? 40 };
  try {
    const { payload } = await client.build(snapshot, opts);
    if (token !== buildToken) return;
    const overlaps = findOverlapClusters(store.doc, payload.worldBounds, {
      groupBounds: payload.groupBounds,
    });
    store.state.payload = payload;
    store.state.buildEpoch = (store.state.buildEpoch || 0) + 1;
    store.state.overlaps = overlaps;
    store.state.stats = payload.stats;
    store.state.buildError = '';
    if (store.state.engine !== 'ready') store.set({ engine: 'ready' }, 'engine');
    viewport.setPayload(payload);
    viewport.setSelected(store.state.selection);
    const overlapHighlight = new Set(overlaps.flatMap((c) => c.ids));
    viewport.setOverlaps([...overlapHighlight]);
    if (payload.groupErrors?.length) {
      const first = payload.groupErrors[0];
      const g = groupById(store.doc, first.groupId);
      toast(`合并组「${g ? groupDisplayName(store.doc, g) : '?'}」失败：${first.message}`, 'err', 5200);
    }
    dom.loading.classList.add('done');
    setTimeout(() => dom.loading.setAttribute('hidden', ''), 520);
    renderAll();
    autosave();
  } catch (err) {
    if (token !== buildToken) return;
    const message = err?.message || String(err);
    if (message === 'superseded') return;
    store.state.buildError = message;
    store.set({ engine: 'error', engineMessage: message }, 'engine');
    toast(`几何构建失败：${message}`, 'err', 6000);
    renderAll();
  }
}

/* ------------------------------------------------------------------ */
/* Rendering the UI                                                    */
/* ------------------------------------------------------------------ */

function renderAll() {
  renderStatusBar(dom.stat, store.doc, store.state);
  renderPanels();
  syncTopBar();
  renderEngine();
}

let panelFrame = 0;
function renderPanels() {
  if (panelFrame) return;
  panelFrame = requestAnimationFrame(() => {
    panelFrame = 0;
    renderCategoryTabs(dom.categoryTabs, store.state.category, (key) => {
      store.set({ category: key }, 'category');
      renderPanels();
    });
    renderLibrary(dom.library, store.state.category, {
      placingType: store.state.placingType,
      onPlace: (type) => startPlacing(type),
      onHover: () => {},
    });
    renderTree(dom.tree, store.doc, store.state, treeHandlers);
    renderInspector(dom.inspector, store.doc, store.state, inspectorHandlers);
    renderCoach(dom.coach, dom.coachBody, store.doc, store.state, {
      onMerge: (ids) => doMerge(ids),
      onMergeIntoGroup: (groupId, ids) => doMergeIntoGroup(groupId, ids),
      onSelectIds: (ids) => selectMany(ids),
    });
    renderStatusBar(dom.stat, store.doc, store.state);
    dom.statusHint.textContent = store.state.statusHint;
  });
}

function renderEngine() {
  const { engine, engineMessage } = store.state;
  dom.engineDot.classList.toggle('ok', engine === 'ready');
  dom.engineDot.classList.toggle('err', engine === 'error');
  dom.engineStatus.textContent =
    engine === 'ready' ? `几何引擎 · manifold-3d` : engine === 'error' ? '引擎错误' : '引擎载入中…';
  dom.engineStatus.title = engineMessage || '';
}

function syncTopBar() {
  if (document.activeElement !== dom.projectName) dom.projectName.value = store.doc.name;
  dom.undo.disabled = !store.canUndo();
  dom.redo.disabled = !store.canRedo();
  const s = store.doc.settings;
  dom.snapStep.textContent = fmt(s.snapStep, 2);
  setPressed(dom.snap, s.snapEnabled);
  setPressed(dom.edgeSnap, s.edgeSnap);
  setPressed(dom.chipGrid, s.showGrid);
  setPressed(dom.chipEdges, s.showEdges);
  setPressed(dom.chipCollision, s.showCollision);
  setPressed(dom.chipCutters, s.showCutterGhosts);
  const state = store.state.dirty ? 'dirty' : 'saved';
  dom.saveStateEl.className = `save-state ${state}`;
  dom.saveStateEl.textContent = store.state.dirty ? '未保存' : '已保存';
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

const treeHandlers = {
  onSelectElement: (id, e) => {
    if (e?.shiftKey || e?.metaKey || e?.ctrlKey) store.setSelection([id], { toggle: true });
    else selectEntity(id);
  },
  onSelectGroup: (id, e) => {
    if (e?.shiftKey) store.setSelection([id], { toggle: true });
    else store.setSelection([id]);
  },
  onFocus: (id) => viewport.focusElement(id),
};

const inspectorHandlers = {
  onRename: (id, name) => store.commit(updateElement(store.doc, id, { name }).doc, { label: '重命名' }),
  onRenameGroup: (id, name) => store.commit(updateGroup(store.doc, id, { name }).doc, { label: '重命名合并组' }),
  onParam: (id, patch, live) => {
    const next = updateElement(store.doc, id, { params: patch }).doc;
    if (live && store.tx) store.live(next);
    else store.commit(next, { label: '调整尺寸' });
  },
  onPosition: (id, pos) => store.commit(updateElement(store.doc, id, { position: pos }).doc, { label: '移动元素' }),
  onRotation: (id, deg, live) => {
    const next = updateElement(store.doc, id, { rotationY: deg }).doc;
    if (live && store.tx) store.live(next);
    else store.commit(next, { label: '旋转元素' });
  },
  onGestureStart: (label) => {
    if (!store.tx) store.beginTransaction(label || '调整');
  },
  onGestureEnd: () => {
    if (store.tx) store.commitTransaction();
  },
  onDuplicate: (id) => {
    try {
      const { doc: next, element } = duplicateElement(store.doc, id);
      store.commit(next, { label: '复制元素', selection: [element.id] });
      toast(`已复制「${elementDisplayName(element)}」`, 'ok', 2200);
    } catch (err) {
      toast(err.message, 'err');
    }
  },
  onDelete: (ids) => doDelete(ids),
  onMerge: () => doMerge(),
  onMergeIntoGroup: (groupId, ids) => doMergeIntoGroup(groupId, ids),
  onSubtract: () => doSubtract(),
  onUngroup: (groupId) => doUngroup(groupId),
  onDeleteGroup: (groupId) => doDelete([groupId]),
  onSelectGroup: (groupId) => store.setSelection([groupId]),
  onNudgeGroup: (groupId, delta) =>
    store.commit(translateGroup(store.doc, groupId, delta), { label: '移动合并组' }),
  onRemoveCutter: (groupId, id) => {
    store.commit(removeCutter(store.doc, groupId, id), { label: '移除切割体' });
    toast('已移除切割体', 'ok', 2200);
    scheduleRebuild(true);
  },
  onRemoveMember: (groupId, id) => {
    const g = groupById(store.doc, groupId);
    if (!g) return;
    if (g.members.length <= 1) {
      toast('组内只剩一个实体，请直接解组', 'info');
      return;
    }
    const next = structuredClone(store.doc);
    const gg = next.groups.find((x) => x.id === groupId);
    gg.members = gg.members.filter((m) => m !== id);
    if (!gg.members.length) next.groups = next.groups.filter((x) => x.id !== groupId);
    store.commit(next, { label: '移出合并组' });
    scheduleRebuild(true);
  },
  onSelectElement: (id, opts) => {
    if (opts?.additive) store.setSelection([id], { additive: true });
    else selectEntity(id);
  },
  onClearSelection: () => store.clearSelection(),
  onLoadDemo: () => {
    const next = createDemoDoc();
    next.settings = store.doc.settings;
    store.commit(next, { label: '载入示例', selection: [] });
    renderAll();
    scheduleRebuild(true);
    setTimeout(() => viewport.frameAll(), 150);
  },
};

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

function selectEntity(id, mods = {}) {
  if (store.state.placingType) cancelPlacing();
  // Merged members keep their own selection (so the inspector edits their
  // parameters); the viewport resolves their highlight to the group chunk.
  store.setSelection([id], mods);
  if (mods.toggle && store.state.overlaps.length === 0) return;
}

function selectMany(ids) {
  store.setSelection(ids);
}

store.subscribe((state, reason) => {
  if (reason === 'doc' || reason === 'doc-live') {
    scheduleRebuild(reason === 'doc');
    renderAll();
    if (reason === 'doc') autosave();
  } else if (reason === 'selection') {
    viewport.setSelected(state.selection);
    const id = state.selection[0];
    if (id) {
      const el = elementById(store.doc, id);
      const g = groupById(store.doc, id);
      state.statusHint = el
        ? `${elementDisplayName(el)} · ${TYPES[el.type].name}`
        : g
          ? `合并组「${groupDisplayName(store.doc, g)}」`
          : '已选择';
    } else {
      state.statusHint = '选择一个元素开始编辑';
    }
    renderAll();
  } else if (reason === 'settings') {
    viewport.setSettings(state.doc.settings);
    renderAll();
    autosave();
  } else if (reason === 'engine') {
    renderAll();
  } else {
    renderAll();
  }
});

/* ------------------------------------------------------------------ */
/* Placing                                                            */
/* ------------------------------------------------------------------ */

function startPlacing(type) {
  const def = TYPES[type];
  if (!def) return;
  if (store.state.placingType === type) {
    cancelPlacing();
    return;
  }
  store.state.placingType = type;
  viewport.beginPlacing(type);
  markPlacing(dom.library, type);
  store.set({ statusHint: `放置「${def.name}」：在地面上点击落位，Esc 或右键取消` }, 'placement');
}

function cancelPlacing() {
  if (!store.state.placingType) return;
  store.state.placingType = null;
  viewport.endPlacing();
  markPlacing(dom.library, null);
  store.set({ statusHint: '选择一个元素开始编辑' }, 'placement');
}

function ghostLocalBounds(type) {
  const def = TYPES[type];
  if (!def) return null;
  // Use the last built local bounds if present; otherwise estimate from defaults.
  const defaults = defaultsOf(type);
  const est = estimateBounds(type, defaults);
  return est;
}

function hoverGhost(ground) {
  const type = store.state.placingType;
  if (!type) return;
  const rot = referenceRotation(ground);
  const pos = snapPlacement(type, ground);
  viewport.showGhost(type, pos, rot, ghostLocalBounds(type));
}

function placeAt(type, ground, keepPlacing) {
  const rot = referenceRotation();
  const pos = snapPlacement(type, ground);
  try {
    const { doc: next, element } = addElement(store.doc, type, { position: pos, rotationY: rot });
    store.commit(next, { label: `放置 ${TYPES[type].name}`, selection: [element.id] });
    toast(`已放置「${TYPES[type].name}」`, 'ok', 1800);
    if (!keepPlacing) cancelPlacing();
    else hoverGhost(ground);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/** Face new elements toward the camera, rounded to 15°. */
function referenceRotation() {
  const cam = viewport.camera.position;
  const target = viewport.controls.target;
  let deg = (Math.atan2(cam.x - target.x, cam.z - target.z) * 180) / Math.PI + 180;
  deg = Math.round(deg / 15) * 15;
  return ((deg % 360) + 360) % 360 > 180 ? deg - 360 : deg;
}

function snapPlacement(type, ground) {
  const s = store.doc.settings;
  const step = s.snapEnabled ? s.snapStep : 1e-4;
  const snap = (v) => Math.round((Math.round(v / step) * step) * 1e6) / 1e6;
  return [snap(ground.x), 0, snap(ground.z)];
}

function estimateBounds(type, params) {
  const p = params;
  switch (type) {
    case 'bank':
      return { min: [-p.width / 2, 0, -p.length / 2], max: [p.width / 2, p.height, p.length / 2] };
    case 'kicker':
      return { min: [-p.width / 2, 0, -p.length / 2], max: [p.width / 2, p.height, p.length / 2] };
    case 'quarter':
      return {
        min: [-p.width / 2, 0, -(p.radius + 0.3 + p.deck) / 2],
        max: [p.width / 2, p.radius + p.extension, (p.radius + 0.3 + p.deck) / 2],
      };
    case 'roller':
      return { min: [-p.width / 2, 0, -p.length / 2], max: [p.width / 2, p.height, p.length / 2] };
    case 'stairs': {
      const d = p.steps * p.tread;
      return { min: [-p.width / 2, 0, -d / 2], max: [p.width / 2, p.steps * p.rise, d / 2] };
    }
    case 'ledge':
      return { min: [-p.width / 2, 0, -p.length / 2], max: [p.width / 2, p.height, p.length / 2] };
    case 'funbox':
      return { min: [-p.width / 2, 0, -p.length / 2], max: [p.width / 2, p.height, p.length / 2] };
    case 'rail':
      return { min: [-0.1, 0, -p.length / 2], max: [0.1, p.height + p.radius, p.length / 2] };
    default:
      return { min: [-p.width / 2, 0, -p.length / 2], max: [p.width / 2, p.height, p.length / 2] };
  }
}

/* ------------------------------------------------------------------ */
/* Drag                                                               */
/* ------------------------------------------------------------------ */

let dragCtx = null;
function beginDrag(id, ground) {
  const el = elementById(store.doc, id);
  const group = groupById(store.doc, id);
  if (!el && !group) return false;
  if (group) {
    dragCtx = { kind: 'group', id, startPositions: group.members.map((mid) => {
      const m = elementById(store.doc, mid);
      return m ? { id: mid, position: [...m.position] } : null;
    }).filter(Boolean), grab: ground.clone() };
  } else {
    dragCtx = { kind: 'element', id, start: [...el.position], grab: ground.clone(), last: [...el.position] };
  }
  store.beginTransaction(group ? '移动合并组' : '移动元素');
  store.setSelection([id]);
  viewport.controls.enabled = false;
  return true;
}

function updateDrag(id, dx, dz) {
  if (!dragCtx) return null;
  if (dragCtx.kind === 'element') {
    const el = elementById(store.doc, dragCtx.id);
    if (!el) return null;
    dragCtx.pending = [dragCtx.start[0] + dx, dragCtx.start[1], dragCtx.start[2] + dz];
    return { preview: true, kind: 'element', dx, dz };
  }
  dragCtx.pending = [dx, dz];
  return { preview: true, kind: 'group', dx, dz };
}

/** Live preview for a dragged group: shift every member chunk. */
function previewGroupDrag(groupId, dx, dz) {
  const g = groupById(store.doc, groupId);
  if (!g || !dragCtx) return;
  for (const mid of g.members) {
    const entry = viewport.chunks.get(mid);
    if (entry) entry.mesh.position.set(dx, 0, dz);
  }
}

function finishInteraction() {
  if (scaleCtx) {
    scaleCtx = null;
    viewport.endDragPreview();
    store.commitTransaction();
    scheduleRebuild(true);
    return;
  }
  const ctx = dragCtx;
  dragCtx = null;
  viewport.controls.enabled = true;
  if (ctx && ctx.pending) {
    if (ctx.kind === 'element') {
      const el = elementById(store.doc, ctx.id);
      if (el) {
        const snapped = viewport.snapAgainstNeighbours(ctx.id, viewport.snapVec(ctx.pending));
        const next = updateElement(store.doc, ctx.id, { position: snapped }).doc;
        store.live(next);
      }
    } else {
      const g = groupById(store.doc, ctx.id);
      if (g) {
        const [dx, dz] = ctx.pending;
        let sx = viewport.snapScalar(dx);
        let sz = viewport.snapScalar(dz);
        if (Math.abs(sx) < 1e-6 && Math.abs(sz) < 1e-6) {
          sx = dx;
          sz = dz;
        }
        if (sx !== 0 || sz !== 0) store.live(translateGroup(store.doc, ctx.id, [sx, 0, sz]));
      }
    }
  } else {
    viewport.endDragPreview();
  }
  viewport.endDragPreview();
  store.commitTransaction();
  scheduleRebuild(true);
}

/* ------------------------------------------------------------------ */
/* Gizmo                                                              */
/* ------------------------------------------------------------------ */

function gizmoMove(id, position) {
  const el = elementById(store.doc, id);
  const group = groupById(store.doc, id);
  if (el) {
    const snapped = viewport.snapVec(position);
    store.live(updateElement(store.doc, id, { position: snapped }).doc);
  } else if (group) {
    const target = store.state.payload?.targets?.[id];
    if (!target) return;
    const dx = position[0] - target.position[0];
    const dz = position[2] - target.position[2];
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return;
    const next = structuredClone(store.doc);
    for (const mid of group.members) {
      const m = next.elements.find((e) => e.id === mid);
      if (!m) continue;
      m.position[0] += dx;
      m.position[2] += dz;
    }
    store.live(next);
  }
}

let scaleCtx = null;

function beginScale(id) {
  const el = elementById(store.doc, id);
  if (!el) return;
  scaleCtx = { id, params: { ...el.params } };
  store.beginTransaction('调整尺寸');
}

/** Map gizmo handle scale onto the element's own parametric dimensions. */
function gizmoScale(id, s) {
  const el = elementById(store.doc, id);
  if (!el || !scaleCtx) return;
  const def = TYPES[el.type];
  const params = { ...scaleCtx.params };
  const wAxis = Math.abs(s.x) > 1e-3 ? s.x : 1;
  const hAxis = Math.abs(s.y) > 1e-3 ? s.y : 1;
  const dAxis = Math.abs(s.z) > 1e-3 ? s.z : 1;
  for (const p of def.params) {
    if (p.key === 'width') params[p.key] = scaleCtx.params[p.key] * wAxis;
    else if (p.key === 'height' || p.key === 'rise' || p.key === 'radius') params[p.key] = scaleCtx.params[p.key] * hAxis;
    else if (p.key === 'length' || p.key === 'tread') params[p.key] = scaleCtx.params[p.key] * dAxis;
    else if (p.key === 'steps') continue;
  }
  store.live(updateElement(store.doc, id, { params }).doc);
}

function gizmoRotate(id, deg) {
  const el = elementById(store.doc, id);
  if (!el) return;
  const rounded = Math.round(deg / 5) * 5;
  store.live(updateElement(store.doc, id, { rotationY: rounded }).doc);
}

/* ------------------------------------------------------------------ */
/* Boolean ops                                                        */
/* ------------------------------------------------------------------ */

function doMerge(explicitIds) {
  const ids = explicitIds || store.state.selection;
  const elementIds = ids.filter((id) => elementById(store.doc, id));
  if (elementIds.length < 2) {
    toast('请至少选择两个元素再合并', 'info');
    return;
  }
  try {
    const { doc: next, group } = mergeElements(store.doc, elementIds);
    store.commit(next, { label: '并集合并', selection: [group.id] });
    store.state.dismissedOverlap = group.id;
    toast(`已合并 ${elementIds.length} 个元素为流形实体`, 'ok', 2600);
    renderAll();
    scheduleRebuild(true);
  } catch (err) {
    toast(err.message, 'err', 4200);
  }
}

function doMergeIntoGroup(groupId, ids) {
  try {
    const { doc: next, group } = addMembersToGroup(store.doc, groupId, ids);
    store.commit(next, { label: '并入合并组', selection: [group.id] });
    toast(`已把 ${ids.length} 个元素并入「${groupDisplayName(next, group)}」`, 'ok', 2800);
    renderAll();
    scheduleRebuild(true);
  } catch (err) {
    toast(err.message, 'err', 4200);
  }
}

function doSubtract() {
  const ids = store.state.selection;
  if (ids.length < 2) {
    toast('差集需要先选中基准元素，再 Shift 点选切割体', 'info', 4200);
    return;
  }
  const elements = ids.map((id) => elementById(store.doc, id)).filter(Boolean);
  if (elements.length !== ids.length) {
    toast('差集目前只支持元素（请先解组）', 'err', 4200);
    return;
  }
  const baseId = ids[0];
  const cutterIds = ids.slice(1);
  try {
    const { doc: next, group } = subtractElements(store.doc, baseId, cutterIds);
    store.commit(next, { label: '差集挖除', selection: [group.id] });
    toast(`已从基准体减去 ${cutterIds.length} 个切割体`, 'ok', 2600);
    renderAll();
    scheduleRebuild(true);
  } catch (err) {
    toast(err.message, 'err', 4200);
  }
}

function doUngroup(groupId) {
  try {
    const g = groupById(store.doc, groupId);
    const next = ungroup(store.doc, groupId);
    store.commit(next, { label: '解组', selection: g ? [...g.members] : [] });
    toast('已解组', 'ok', 1800);
    renderAll();
    scheduleRebuild(true);
  } catch (err) {
    toast(err.message, 'err');
  }
}

function doDelete(ids) {
  if (!ids.length) return;
  const groupIds = ids.filter((id) => groupById(store.doc, id));
  const elementIds = ids.filter((id) => elementById(store.doc, id));
  let next = store.doc;
  const labels = [];
  for (const gid of groupIds) {
    const g = groupById(next, gid);
    if (!g) continue;
    for (const mid of [...g.members, ...g.cutters]) if (!elementIds.includes(mid)) elementIds.push(mid);
    labels.push('删除合并组');
  }
  // Deleting the last / only member of a group removes the group too.
  if (elementIds.length) {
    next = deleteElements(next, elementIds);
    labels.push('删除元素');
  }
  const removed = store.doc.elements.length - next.elements.length;
  store.commit(next, { label: labels[0] || '删除', selection: [] });
  toast(`已删除 ${removed} 个元素`, 'ok', 2000);
  renderAll();
  scheduleRebuild(true);
}

/* ------------------------------------------------------------------ */
/* Top bar                                                            */
/* ------------------------------------------------------------------ */

function setupTopBar() {
  dom.projectName.value = store.doc.name;
  dom.projectName.addEventListener('change', () => {
    const name = dom.projectName.value.trim() || '未命名场地';
    const next = { ...store.doc, name, updatedAt: new Date().toISOString() };
    store.commit(next, { label: '重命名场地' });
    autosave();
  });
  dom.projectName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') dom.projectName.blur();
    e.stopPropagation();
  });

  dom.undo.addEventListener('click', () => {
    const label = store.undo();
    if (label) {
      toast(`撤销：${label}`, 'info', 1600);
      scheduleRebuild(true);
    }
  });
  dom.redo.addEventListener('click', () => {
    const label = store.redo();
    if (label) {
      toast(`重做：${label}`, 'info', 1600);
      scheduleRebuild(true);
    }
  });

  dom.snap.addEventListener('click', () => {
    store.setSettings({ snapEnabled: !store.doc.settings.snapEnabled });
  });
  dom.edgeSnap.addEventListener('click', () => {
    store.setSettings({ edgeSnap: !store.doc.settings.edgeSnap });
  });

  $('#btn-view-fit').addEventListener('click', () => viewport.frameAll());

  const newBtn = $('#btn-new');
  const newMenu = (() => {
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.hidden = true;
    menu.style.width = '236px';
    menu.style.left = '0';
    menu.style.right = 'auto';
    menu.innerHTML = `
      <button data-new="empty"><b>空白场地</b><span>从零开始搭建</span></button>
      <button data-new="demo"><b>示例场地</b><span>载入「街角广场」</span></button>`;
    newBtn.parentElement.style.position = 'relative';
    newBtn.parentElement.appendChild(menu);
    return menu;
  })();
  newBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    newMenu.hidden = !newMenu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!newMenu.hidden && !newMenu.contains(e.target) && e.target !== newBtn) newMenu.hidden = true;
  });
  newMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-new]');
    if (!btn) return;
    newMenu.hidden = true;
    if (btn.dataset.new === 'empty') {
      const next = createEmptyDoc('新场地');
      next.settings = store.doc.settings;
      store.commit(next, { label: '新建场地', selection: [] });
      toast('已新建空白场地', 'ok', 2000);
    } else {
      const next = createDemoDoc();
      next.settings = store.doc.settings;
      store.commit(next, { label: '载入示例', selection: [] });
      toast('已载入示例场地「街角广场」', 'ok', 2400);
    }
    store.state.overlaps = [];
    renderAll();
    scheduleRebuild(true);
    setTimeout(() => viewport.frameAll(), 150);
  });

  $('#btn-help').addEventListener('click', () => $('#help-dialog').showModal());

  const exportBtn = $('#btn-export');
  const exportMenu = $('#export-menu');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!exportMenu.hidden && !exportMenu.contains(e.target) && e.target !== exportBtn) exportMenu.hidden = true;
  });
  exportMenu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-export]');
    if (!btn) return;
    exportMenu.hidden = true;
    await runExport(btn.dataset.export);
  });

  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  });
}

function setupViewportChips() {
  dom.chipEdges.addEventListener('click', () => store.setSettings({ showEdges: !store.doc.settings.showEdges }));
  dom.chipGrid.addEventListener('click', () => store.setSettings({ showGrid: !store.doc.settings.showGrid }));
  dom.chipCollision.addEventListener('click', () => {
    const next = !store.doc.settings.showCollision;
    store.setSettings({ showCollision: next });
    if (next) toast('绿色线框为碰撞网格，供轨迹检测使用', 'info', 3600);
  });
  dom.chipCutters.addEventListener('click', () => {
    store.setSettings({ showCutterGhosts: !store.doc.settings.showCutterGhosts });
  });
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      for (const other of document.querySelectorAll('[data-view]')) other.dataset.active = 'false';
      btn.dataset.active = 'true';
      viewport.setView(btn.dataset.view);
    });
  }
}

function setupGizmoRail() {
  for (const btn of document.querySelectorAll('[data-gizmo]')) {
    btn.addEventListener('click', () => {
      store.state.gizmo = btn.dataset.gizmo;
      for (const other of document.querySelectorAll('[data-gizmo]')) other.dataset.active = 'false';
      btn.dataset.active = 'true';
      viewport.setGizmoMode(btn.dataset.gizmo);
    });
  }
}

function setupMobileDrawers() {
  const tabbar = document.getElementById('mobile-tabbar');
  const left = document.getElementById('panel-left');
  const right = document.getElementById('panel-right');
  if (!tabbar) return;
  const closer = () => {
    left.classList.remove('open');
    right.classList.remove('open');
    for (const b of tabbar.querySelectorAll('button')) b.dataset.active = 'false';
  };
  tabbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mobile]');
    if (!btn) return;
    const which = btn.dataset.mobile;
    const target = which === 'library' ? left : right;
    const wasOpen = target.classList.contains('open');
    closer();
    if (!wasOpen) {
      target.classList.add('open');
      btn.dataset.active = 'true';
    }
  });
  // Tapping the canvas closes drawers.
  document.getElementById('scene')?.addEventListener('pointerdown', () => {
    if (window.matchMedia('(max-width: 900px)').matches) closer();
  });
  window.__closeMobileDrawers = closer;
}

function setupHelpDialog() {
  const dlg = $('#help-dialog');
  const body = $('#help-body');
  const rows = [
    ['放置元素', '点击元素库 → 地面点击'],
    ['连续放置', '放置时按住 Shift'],
    ['取消放置', 'Esc'],
    ['移动元素', '直接拖动'],
    ['旋转 / 尺寸', 'R / T'],
    ['吸附 0.1 m', 'S'],
    ['全览视角', 'F'],
    ['复制 / 删除', 'Ctrl+D / Delete'],
    ['撤销 / 重做', 'Ctrl+Z / Ctrl+Shift+Z'],
    ['多选合并', 'Shift 点选 → 合并'],
    ['差集', '先选基准，再 Shift 选切割体'],
    ['视角平移 / 缩放', '右键拖动 / 滚轮'],
  ];
  body.innerHTML = `<div class="help-grid">${rows
    .map(([k, v]) => `<div><span>${escape(k)}</span><kbd>${escape(v)}</kbd></div>`)
    .join('')}</div>`;
  window.addEventListener('keydown', (e) => {
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      dlg.showModal();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                           */
/* ------------------------------------------------------------------ */

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

    if (e.key === 'Escape') {
      if (store.state.placingType) cancelPlacing();
      else store.clearSelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      const label = e.shiftKey ? store.redo() : store.undo();
      if (label) {
        toast(`${e.shiftKey ? '重做' : '撤销'}：${label}`, 'info', 1500);
        scheduleRebuild(true);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      const label = store.redo();
      if (label) {
        toast(`重做：${label}`, 'info', 1500);
        scheduleRebuild(true);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const id = store.state.selection[0];
      if (id && elementById(store.doc, id)) {
        try {
          const { doc: next, element } = duplicateElement(store.doc, id);
          store.commit(next, { label: '复制元素', selection: [element.id] });
        } catch (err) {
          toast(err.message, 'err');
        }
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) return;

    switch (e.key.toLowerCase()) {
      case 'g':
        setGizmo('translate');
        break;
      case 'r':
        setGizmo('rotate');
        break;
      case 't':
        setGizmo('scale');
        break;
      case 's':
        store.setSettings({ snapEnabled: !store.doc.settings.snapEnabled });
        toast(store.doc.settings.snapEnabled ? '吸附已开启 (0.1 m)' : '吸附已关闭', 'info', 1400);
        break;
      case 'f':
        viewport.frameAll();
        break;
      case 'delete':
      case 'backspace':
        if (store.state.selection.length) {
          e.preventDefault();
          doDelete(store.state.selection);
        }
        break;
      case 'm':
        if (store.state.selection.length >= 2) doMerge();
        break;
      case '?':
        $('#help-dialog').showModal();
        break;
      default:
        break;
    }
  });
}

function setGizmo(mode) {
  store.state.gizmo = mode;
  for (const btn of document.querySelectorAll('[data-gizmo]')) {
    btn.dataset.active = btn.dataset.gizmo === mode ? 'true' : 'false';
  }
  viewport.setGizmoMode(mode);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

function loadInitialDoc() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.elements)) return normalizeDoc(parsed);
    }
  } catch (err) {
    console.warn('[grind] autosave unreadable', err);
  }
  return createDemoDoc();
}

function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDoc(store.doc));
    store.markSaved();
    syncTopBar();
  } catch (err) {
    console.warn('[grind] autosave failed', err);
  }
}

/* ------------------------------------------------------------------ */
/* Import / export                                                    */
/* ------------------------------------------------------------------ */

async function runExport(kind) {
  try {
    if (kind === 'project') {
      exportProject();
      return;
    }
    if (!store.state.payload) {
      toast('几何尚未就绪，请稍候', 'info');
      return;
    }
    const payload = store.state.payload;
    if (kind === 'stl') {
      exportStl(payload);
    } else if (kind === 'glb') {
      await exportGlb(payload);
    } else if (kind === 'collision') {
      exportCollision(payload);
    }
  } catch (err) {
    toast(`导出失败：${err.message}`, 'err', 6000);
  }
}

function exportProject() {
  const blob = new Blob([serializeDoc(store.doc)], { type: 'application/json' });
  downloadBlob(blob, timestampName('skatepark', 'grind.json'));
  toast('已导出项目文件（含几何与布局）', 'ok', 2800);
}

/** Build a three.js scene with only the park solids, for STL/GLB export. */
function buildExportScene(payload) {
  const scene = new THREE.Scene();
  for (const chunk of payload.chunks) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(chunk.positions.slice(), 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(chunk.normals.slice(), 3));
    geom.setAttribute('color', new THREE.BufferAttribute(chunk.colors.slice(), 3));
    geom.setIndex(new THREE.BufferAttribute(chunk.indices.slice(), 1));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = chunk.id;
    scene.add(mesh);
  }
  return scene;
}

function exportStl(payload) {
  const scene = buildExportScene(payload);
  const exporter = new STLExporter();
  const result = exporter.parse(scene, { binary: true });
  const blob = new Blob([result], { type: 'model/stl' });
  downloadBlob(blob, timestampName('skatepark', 'stl'));
  toast('已导出 STL 模型（合并后的实体网格）', 'ok', 3000);
}

async function exportGlb(payload) {
  const scene = buildExportScene(payload);
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(scene, { binary: true });
  const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
  downloadBlob(blob, timestampName('skatepark', 'glb'));
  toast('已导出 glTF 模型', 'ok', 3000);
}

async function exportCollision(payload) {
  const { json, obj } = buildCollisionExport(store.doc, payload);
  downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), timestampName('collision', 'json'));
  downloadBlob(new Blob([obj], { type: 'text/plain' }), timestampName('collision', 'obj'));
  toast(`已导出碰撞网格：${json.totals.colliders} 个碰撞体 / ${json.totals.triangles} 三角面`, 'ok', 4200);
}


async function importDocObject(parsed) {
  const next = normalizeDoc(parsed);
  store.commit(next, { label: '导入项目', selection: [] });
  store.state.overlaps = [];
  toast(`已导入「${next.name}」：${next.elements.length} 个元素，${next.groups.length} 个合并组`, 'ok', 4200);
  renderAll();
  scheduleRebuild(true);
  setTimeout(() => viewport.frameAll(), 180);
  return next;
}

async function importFile(file) {
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('不是有效的 JSON 文件');
    }
    await importDocObject(parsed);
  } catch (err) {
    toast(`导入失败：${err.message}`, 'err', 6000);
  }
}

/* ------------------------------------------------------------------ */
/* First paint                                                        */
/* ------------------------------------------------------------------ */

renderAll();
viewport.setGizmoMode('translate');
window.__grind = {
  store,
  viewport,
  client,
  rebuild,
  selectEntity,
  exportProject: () => exportProject(),
  buildCollisionExport: () => buildCollisionExport(store.doc, store.state.payload),
  importDoc: (raw) => importDocObject(raw),
};
