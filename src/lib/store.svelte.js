// 全局状态仓库：相册文档、图片索引、选中态、撤销重做、持久化与导入导出
import { STORAGE_DOC_KEY, DOC_VERSION, MIN_SLOT_SIZE } from './constants.js';
import { newAlbum, instantiatePage, getTemplate, uid } from './templates.js';
import { History } from './history.js';
import { putImage, getAllImages, getImage, readImageFile } from './imageStore.js';
import { slotFrame, computeFillRect, fillFromRect } from './layout.js';
import { scaleAround, clampInside } from './geometry.js';

export class AlbumStore {
  doc = $state(null);
  images = $state({});                 // imageId -> { id, w, h, name }（dataUrl 走 IDB 按需取）
  selection = $state({ pageIndex: 0, slotId: null });
  historyState = $state({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  busy = $state(false);

  history = new History();
  _saveTimer = null;

  constructor() {
    this.history.onChange = () => this._syncHistoryState();
  }

  // ---- 初始化 / 持久化 -------------------------------------------------
  async init() {
    const saved = localStorage.getItem(STORAGE_DOC_KEY);
    if (saved) {
      try {
        this.doc = JSON.parse(saved);
      } catch {
        this.doc = newAlbum();
      }
    } else {
      this.doc = newAlbum();
    }
    let all = [];
    try {
      all = await getAllImages();
    } catch (err) {
      console.warn('读取图片库失败，以空库启动：', err);
    }
    const map = {};
    for (const img of all) map[img.id] = { id: img.id, w: img.w, h: img.h, name: img.name };
    this.images = map;
    this.history.clear(() => this.doc);
    this._syncHistoryState();
  }

  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    if (this.doc) localStorage.setItem(STORAGE_DOC_KEY, JSON.stringify(this.doc));
  }

  _syncHistoryState() {
    this.historyState.canUndo = this.history.canUndo;
    this.historyState.canRedo = this.history.canRedo;
    this.historyState.undoLabel = this.history.labels.undo;
    this.historyState.redoLabel = this.history.labels.redo;
  }

  _get = () => this.doc;
  _set = (d) => {
    this.doc = d;
    this.scheduleSave();
  };

  _commit(label, mutate, coalesceKey = null) {
    this.history.commit(label, this._get, this._set, mutate, coalesceKey);
  }

  // ---- 撤销重做 ---------------------------------------------------------
  undo() {
    this.history.undo(this._get, this._set);
    this._clampSelection();
  }
  redo() {
    this.history.redo(this._get, this._set);
    this._clampSelection();
  }

  _clampSelection() {
    const i = Math.min(this.selection.pageIndex, this.doc.pages.length - 1);
    if (i !== this.selection.pageIndex) this.selection.pageIndex = i;
  }

  // ---- 文字变量（全册联动） ---------------------------------------------
  setVariable(key, value) {
    this._commit('修改文字', (d) => { d.variables[key] = value; }, `var:${key}`);
  }

  setTextStyle(pageIndex, slotId, patch) {
    this._commit('修改文字样式', (d) => {
      const slot = d.pages[pageIndex].textSlots.find((s) => s.id === slotId);
      if (slot) Object.assign(slot, patch);
    });
  }

  // ---- 中缝 -------------------------------------------------------------
  setGutter(value) {
    this._commit('调整中缝', (d) => { d.gutter = value; }, 'gutter');
  }

  // ---- 页面 -------------------------------------------------------------
  addPage(templateId, atIndex = null) {
    this._commit('新增页面', (d) => {
      const page = instantiatePage(templateId);
      const idx = atIndex ?? d.pages.length;
      d.pages.splice(idx, 0, page);
    });
    const idx = atIndex ?? this.doc.pages.length - 1;
    this.selection.pageIndex = idx;
    this.selection.slotId = null;
  }

  removePage(index) {
    if (this.doc.pages.length <= 1) return;
    this._commit('删除页面', (d) => { d.pages.splice(index, 1); });
    this._clampSelection();
  }

  applyTemplate(pageIndex, templateId) {
    this._commit('更换版式', (d) => {
      const old = d.pages[pageIndex];
      const fresh = instantiatePage(templateId);
      // 按顺序尽量保留已填充照片
      fresh.photoSlots.forEach((slot, i) => {
        const prev = old.photoSlots[i];
        if (prev?.fill) slot.fill = JSON.parse(JSON.stringify(prev.fill));
      });
      d.pages[pageIndex] = fresh;
    });
    this.selection.slotId = null;
  }

  movePage(from, to) {
    if (from === to || to < 0 || to >= this.doc.pages.length) return;
    this._commit('调整页序', (d) => {
      const [p] = d.pages.splice(from, 1);
      d.pages.splice(to, 0, p);
    });
    // 选中页跟随移动
    if (this.selection.pageIndex === from) this.selection.pageIndex = to;
    else if (from < this.selection.pageIndex && to >= this.selection.pageIndex) {
      this.selection.pageIndex -= 1;
    } else if (from > this.selection.pageIndex && to <= this.selection.pageIndex) {
      this.selection.pageIndex += 1;
    }
  }

  // ---- 照片 -------------------------------------------------------------
  async addImageFile(file) {
    const data = await readImageFile(file);
    const id = uid('img');
    await putImage({ id, w: data.w, h: data.h, name: data.name, dataUrl: data.dataUrl });
    this.images = { ...this.images, [id]: { id, w: data.w, h: data.h, name: data.name } };
    return id;
  }

  async imageDataUrl(id) {
    const rec = await getImage(id);
    return rec?.dataUrl ?? null;
  }

  fillPhoto(pageIndex, slotId, imageId) {
    this._commit('填充照片', (d) => {
      const slot = d.pages[pageIndex].photoSlots.find((s) => s.id === slotId);
      if (slot) slot.fill = { imageId, focus: { x: 0.5, y: 0.5 }, zoom: 1, pan: { x: 0, y: 0 } };
    });
  }

  clearPhoto(pageIndex, slotId) {
    this._commit('移除照片', (d) => {
      const slot = d.pages[pageIndex].photoSlots.find((s) => s.id === slotId);
      if (slot) slot.fill = null;
    });
  }

  /** 拖拽中的实时更新（合并历史），fill 为完整 fill 对象 */
  updateFill(pageIndex, slotId, fill, coalesceKey = 'crop') {
    this._commit('调整裁切', (d) => {
      const slot = d.pages[pageIndex].photoSlots.find((s) => s.id === slotId);
      if (slot) slot.fill = JSON.parse(JSON.stringify(fill));
    }, coalesceKey);
  }

  /** 以槽位中心为锚点设置缩放倍数，保持当前构图中心不变 */
  zoomPhoto(pageIndex, slotId, zoom) {
    const page = this.doc.pages[pageIndex];
    const slot = page.photoSlots.find((s) => s.id === slotId);
    if (!slot?.fill) return;
    const frame = slotFrame(slot, this.doc.gutter);
    const img = this.images[slot.fill.imageId];
    if (!img) return;
    const current = computeFillRect(frame, img, slot.fill);
    const targetZoom = Math.max(1, Math.min(6, Number(zoom)));
    const factor = targetZoom / (slot.fill.zoom ?? 1);
    const next = clampInside(frame, scaleAround(current, frame, factor));
    this.updateFill(pageIndex, slotId, fillFromRect(frame, img, slot.fill, next), 'crop:zoom-ui');
  }

  /** 键盘/按钮微调平移，自动回弹到合法范围 */
  nudgePhoto(pageIndex, slotId, dx, dy) {
    const page = this.doc.pages[pageIndex];
    const slot = page.photoSlots.find((s) => s.id === slotId);
    if (!slot?.fill) return;
    const frame = slotFrame(slot, this.doc.gutter);
    const img = this.images[slot.fill.imageId];
    if (!img) return;
    const current = computeFillRect(frame, img, slot.fill);
    const next = clampInside(frame, {
      ...current,
      x: current.x + dx,
      y: current.y + dy
    });
    this.updateFill(pageIndex, slotId, fillFromRect(frame, img, slot.fill, next), 'crop:nudge');
  }

  moveSlot(pageIndex, slotId, rectOrSpread) {
    this._commit('调整槽位', (d) => {
      const slot = d.pages[pageIndex].photoSlots.find((s) => s.id === slotId)
        ?? d.pages[pageIndex].textSlots.find((s) => s.id === slotId);
      if (!slot) return;
      if (slot.spread) slot.spread = { ...slot.spread, ...rectOrSpread };
      else slot.rect = { ...slot.rect, ...rectOrSpread };
    }, 'move-slot');
  }

  /** 属性面板直接编辑槽位矩形（含尺寸），自动夹到合法范围 */
  resizeSlot(pageIndex, slotId, patch) {
    this._commit('调整槽位尺寸', (d) => {
      const page = d.pages[pageIndex];
      const slot = page.photoSlots.find((s) => s.id === slotId)
        ?? page.textSlots.find((s) => s.id === slotId);
      if (!slot) return;
      const num = (v) => Math.max(MIN_SLOT_SIZE, Number(v) || MIN_SLOT_SIZE);
      if (slot.spread) {
        const next = { ...slot.spread, ...patch };
        slot.spread = {
          x1: Math.max(0, Number(next.x1) || 0),
          x2: Math.max(0, Number(next.x2) || 0),
          y: Math.max(0, Number(next.y) || 0),
          h: num(next.h)
        };
      } else {
        const next = { ...slot.rect, ...patch };
        slot.rect = {
          x: Math.max(0, Number(next.x) || 0),
          y: Math.max(0, Number(next.y) || 0),
          w: num(next.w),
          h: num(next.h)
        };
      }
    }, 'resize-slot');
  }

  // ---- 选择 -------------------------------------------------------------
  select(pageIndex, slotId = null) {
    this.selection.pageIndex = pageIndex;
    this.selection.slotId = slotId;
  }

  get currentPage() {
    return this.doc?.pages[this.selection.pageIndex] ?? null;
  }

  get pageIndex() {
    return this.selection.pageIndex;
  }

  // ---- 导出 / 导入 ------------------------------------------------------
  async exportFile() {
    this.saveNow();
    const all = await getAllImages();
    const bundle = {
      type: 'wedding-album',
      version: DOC_VERSION,
      exportedAt: new Date().toISOString(),
      doc: this.doc,
      images: all.map(({ id, w, h, name, dataUrl }) => ({ id, w, h, name, dataUrl }))
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `婚纱相册_${this.doc.variables.date || 'album'}.walbum.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async importFile(file) {
    const text = await file.text();
    const bundle = JSON.parse(text);
    if (bundle.type !== 'wedding-album' || !bundle.doc || !Array.isArray(bundle.doc.pages)) {
      throw new Error('文件格式不正确，请选择本工具导出的 .walbum.json 文件');
    }
    this.busy = true;
    try {
      for (const img of bundle.images ?? []) {
        await putImage(img);
      }
      const map = {};
      for (const img of bundle.images ?? []) {
        map[img.id] = { id: img.id, w: img.w, h: img.h, name: img.name };
      }
      this.images = map;
      this.doc = bundle.doc;
      this.selection = { pageIndex: 0, slotId: null };
      this.saveNow();
      this.history.clear(() => this.doc);
      this._syncHistoryState();
    } finally {
      this.busy = false;
    }
  }

  newAlbum() {
    this.doc = newAlbum();
    this.selection = { pageIndex: 0, slotId: null };
    this.saveNow();
    this.history.clear(() => this.doc);
    this._syncHistoryState();
  }

  templateOf(page) {
    return getTemplate(page.templateId);
  }
}

export const store = new AlbumStore();
