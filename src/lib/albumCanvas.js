// Fabric 画布封装：
// - 所有对开页垂直排列在同一画布，支持整体缩放与滚动浏览
// - 当前页可交互：照片平移、Ctrl/⌘+滚轮缩放、焦点拖拽、槽位拖动（吸附+间距回弹）
// - 非当前页仅静态预览，单击切换为当前页
// - 拖拽过程只更新对象属性（requestRenderAll），不重建场景，保证流畅
import { Canvas, FabricImage, Rect, Textbox, Line, Circle } from 'fabric';
import {
  PX_PER_MM, SNAP_DISTANCE, MIN_SLOT_GAP, ZONE, PAGE_W
} from './constants.js';
import {
  spreadMetrics, slotFrame, computeFillRect, fillFromRect,
  markerPosition, dragFocus, resolveText
} from './layout.js';
import { snapRect, applyGapConstraints, clampToPage, clamp, clampInside, rect } from './geometry.js';

const PAD = 40;
const PAGE_BG = '#ffffff';
const GUTTER_BG = '#e9e4dc';
const SLOT_EMPTY = '#f3f0ea';
const SLOT_STROKE = '#c9b8a3';
const SLOT_ACTIVE = '#b8895b';
const GUIDE = '#e0703f';
const FOCUS = '#d94f30';

function scaleAroundPoint(r, frame, factor, center) {
  const nw = clamp(r.w * factor, frame.w, frame.w * 6);
  const nh = clamp(r.h * factor, frame.h, frame.h * 6);
  const nx = center.x - ((center.x - r.x) / r.w) * nw;
  const ny = center.y - ((center.y - r.y) / r.h) * nh;
  return rect(nx, ny, nw, nh);
}

export class AlbumCanvas {
  constructor(canvasEl, store, bus) {
    this.store = store;
    this.bus = bus;
    this.fabric = new Canvas(canvasEl, {
      selection: false,
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      enableRetinaScaling: true,
      backgroundColor: '#ece8e1'
    });
    this.zoom = 1;
    this.spreadTops = [];
    this.imageCache = new Map();
    this.drag = null;
    this.guideObjects = [];
    this._redrawSeq = 0;
    this.px = (v) => v * PX_PER_MM;

    this.fabric.on('mouse:down', (e) => this._onDown(e));
    this.fabric.on('mouse:move', (e) => this._onMove(e));
    this.fabric.on('mouse:up', () => this._onUp());
    this.fabric.on('mouse:dblclick', (e) => this._onDblClick(e));
    this.fabric.on('mouse:wheel', (opt) => this._onWheel(opt));
  }

  // ---- 坐标 -------------------------------------------------------------
  _docPoint(e) {
    const p = this.fabric.getScenePoint(e.e ?? e);
    return { x: p.x / PX_PER_MM, y: p.y / PX_PER_MM };
  }

  _topMm(pageIndex) {
    const m = spreadMetrics(this.store.doc.gutter);
    return (PAD + pageIndex * (m.height * PX_PER_MM + PAD)) / PX_PER_MM;
  }

  _pageAtY(yMm) {
    const m = spreadMetrics(this.store.doc.gutter);
    const step = m.height * PX_PER_MM + PAD;
    const ypx = yMm * PX_PER_MM;
    for (let i = 0; i < this.store.doc.pages.length; i++) {
      const top = PAD + i * step;
      if (ypx >= top && ypx <= top + m.height * PX_PER_MM) return i;
    }
    return -1;
  }

  _hitTest(pointMm, pageIndex) {
    if (pageIndex < 0 || pageIndex !== this.store.selection.pageIndex) return null;
    const page = this.store.doc.pages[pageIndex];
    const local = { x: pointMm.x, y: pointMm.y - this._topMm(pageIndex) };
    for (const slot of page.photoSlots) {
      const f = slotFrame(slot, this.store.doc.gutter);
      if (local.x >= f.x && local.x <= f.x + f.w && local.y >= f.y && local.y <= f.y + f.h) {
        return { slot, kind: slot.fill ? 'photo' : 'empty-slot' };
      }
    }
    for (const slot of page.textSlots) {
      const f = slotFrame(slot, this.store.doc.gutter);
      if (local.x >= f.x && local.x <= f.x + f.w && local.y >= f.y && local.y <= f.y + f.h) {
        return { slot, kind: 'text-slot' };
      }
    }
    return null;
  }

  /** 浏览器原生拖放（照片文件/照片库缩略图）落点 → 照片槽位 */
  slotAtClient(clientX, clientY) {
    const el = this.fabric.upperCanvasEl;
    const rectEl = el.getBoundingClientRect();
    const sceneX = (clientX - rectEl.left + el.parentElement.scrollLeft) / this.zoom;
    const sceneY = (clientY - rectEl.top + el.parentElement.scrollTop) / this.zoom;
    const mm = { x: sceneX / PX_PER_MM, y: sceneY / PX_PER_MM };
    const pageIndex = this._pageAtY(mm.y);
    if (pageIndex < 0) return null;
    const page = this.store.doc.pages[pageIndex];
    const local = { x: mm.x, y: mm.y - this._topMm(pageIndex) };
    const slot = page.photoSlots.find((s) => {
      const f = slotFrame(s, this.store.doc.gutter);
      return local.x >= f.x && local.x <= f.x + f.w && local.y >= f.y && local.y <= f.y + f.h;
    });
    return slot ? { pageIndex, slotId: slot.id } : null;
  }

  // ---- 指针交互 ---------------------------------------------------------
  _onDown(e) {
    const pt = this._docPoint(e);
    const pageIndex = this._pageAtY(pt.y);
    if (pageIndex < 0) return;
    if (pageIndex !== this.store.selection.pageIndex) {
      this.store.select(pageIndex, null);
      this.redraw();
      return;
    }
    const hit = this._hitTest(pt, pageIndex);
    if (!hit) {
      this.store.select(pageIndex, null);
      this.redraw();
      return;
    }
    const local = { x: pt.x, y: pt.y - this._topMm(pageIndex) };
    this.store.select(pageIndex, hit.slot.id);

    if (hit.kind === 'photo') {
      const slot = hit.slot;
      const frame = slotFrame(slot, this.store.doc.gutter);
      const img = this.store.images[slot.fill.imageId];
      if (!img) return;
      const r = computeFillRect(frame, img, slot.fill);
      const marker = markerPosition(frame, r, slot.fill.focus);
      const kind = Math.hypot(local.x - marker.x, local.y - marker.y) <= 4.5 ? 'focus' : 'pan';
      this.drag = {
        type: kind, pageIndex, slot, frame, image: img,
        startLocal: local, startRect: { ...r }, rect: r,
        live: this._liveObjects(slot.id, pageIndex)
      };
    } else {
      const frame = slotFrame(hit.slot, this.store.doc.gutter);
      this.drag = {
        type: 'slot', pageIndex, slot: hit.slot,
        startLocal: local, startFrame: { ...frame }, frame: { ...frame },
        live: this._liveObjects(hit.slot.id, pageIndex)
      };
    }
  }

  /** 找到某槽位当前的 Fabric 活动对象引用 */
  _liveObjects(slotId, pageIndex) {
    const topMm = this._topMm(pageIndex);
    const objs = this.fabric.getObjects().filter((o) => o.data?.slotId === slotId);
    return {
      topMm,
      image: objs.find((o) => o.type === 'image'),
      frame: objs.find((o) => o.type === 'rect' && o.data?.role === 'frame'),
      marker: objs.find((o) => o.type === 'circle'),
      crosses: objs.filter((o) => o.type === 'line' && o.data?.role === 'marker'),
      text: objs.find((o) => o.type === 'textbox' && o.data?.role === 'text'),
      textFrame: objs.find((o) => o.type === 'rect' && o.data?.role === 'text-frame')
    };
  }

  _onMove(e) {
    if (!this.drag) {
      this._updateCursor(e);
      return;
    }
    const pt = this._docPoint(e);
    const local = { x: pt.x, y: pt.y - this._topMm(this.drag.pageIndex) };
    const d = this.drag;

    if (d.type === 'pan' || d.type === 'focus') {
      if (d.type === 'pan') {
        const next = rect(
          d.startRect.x + local.x - d.startLocal.x,
          d.startRect.y + local.y - d.startLocal.y,
          d.startRect.w, d.startRect.h
        );
        d.rect = clampInside(d.frame, next);
      } else {
        const out = dragFocus(d.frame, d.image, d.slot.fill, d.rect, local);
        d.rect = out.rect;
        d.pendingFill = out.fill;
      }
      this._syncPhotoLive(d);
    } else if (d.type === 'slot') {
      const next0 = rect(
        d.startFrame.x + local.x - d.startLocal.x,
        d.startFrame.y + local.y - d.startLocal.y,
        d.startFrame.w, d.startFrame.h
      );
      const page = this.store.doc.pages[d.pageIndex];
      const snapped = snapRect(next0, this._snapTargets(page, d.slot), SNAP_DISTANCE);
      this._setGuides(snapped.guides, d.live.topMm);
      let next = rect(snapped.x, snapped.y, next0.w, next0.h);
      const m = spreadMetrics(this.store.doc.gutter);
      const area = d.slot.zone === ZONE.LEFT
        ? m.leftPage
        : d.slot.zone === ZONE.RIGHT
          ? m.rightPage
          : rect(0, 0, m.width, m.height);
      next = clampToPage(next, area);
      next = applyGapConstraints(next, this._otherFrames(page, d.slot), MIN_SLOT_GAP);
      d.frame = next;
      this._syncSlotLive(d);
    }
    this.fabric.requestRenderAll();
  }

  _syncPhotoLive(d) {
    const { image: fabImg, marker, crosses, topMm } = d.live;
    if (fabImg) {
      fabImg.set({ left: this.px(d.rect.x), top: topMm * PX_PER_MM + this.px(d.rect.y) });
    }
    const focus = d.pendingFill?.focus ?? d.slot.fill.focus;
    const mk = markerPosition(d.frame, d.rect, focus);
    const mx = this.px(mk.x);
    const my = topMm * PX_PER_MM + this.px(mk.y);
    if (marker) marker.set({ left: mx - 7, top: my - 7 });
    if (crosses?.length === 2) {
      crosses[0].set({ x1: mx, y1: my - 10, x2: mx, y2: my + 10 });
      crosses[1].set({ x1: mx - 10, y1: my, x2: mx + 10, y2: my });
    }
  }

  _syncSlotLive(d) {
    const { frame, textFrame, text, topMm } = d.live;
    const target = frame ?? textFrame;
    if (target) {
      target.set({
        left: this.px(d.frame.x),
        top: topMm * PX_PER_MM + this.px(d.frame.y),
        width: this.px(d.frame.w),
        height: this.px(d.frame.h)
      });
    }
    if (text) {
      text.set({
        left: this.px(d.frame.x),
        top: topMm * PX_PER_MM + this.px(d.frame.y),
        width: this.px(d.frame.w)
      });
    }
  }

  _setGuides(guides, topMm) {
    this._clearGuides();
    for (const gd of guides) {
      const points = gd.axis === 'v'
        ? [this.px(gd.pos), topMm * PX_PER_MM + this.px(gd.start),
           this.px(gd.pos), topMm * PX_PER_MM + this.px(gd.end)]
        : [this.px(gd.start), topMm * PX_PER_MM + this.px(gd.pos),
           this.px(gd.end), topMm * PX_PER_MM + this.px(gd.pos)];
      const line = new Line(points, {
        stroke: GUIDE, strokeWidth: 1, selectable: false, evented: false,
        data: { role: 'guide' }
      });
      this.fabric.add(line);
      this.guideObjects.push(line);
    }
  }

  _clearGuides() {
    for (const g of this.guideObjects) this.fabric.remove(g);
    this.guideObjects = [];
  }

  _onUp() {
    if (!this.drag) return;
    const d = this.drag;
    this._clearGuides();
    if (d.type === 'pan') {
      const fill = fillFromRect(d.frame, d.image, d.slot.fill, d.rect);
      if (JSON.stringify(fill) !== JSON.stringify(d.slot.fill)) {
        this.store.updateFill(d.pageIndex, d.slot.id, fill, 'crop:pan');
      } else {
        this.redraw();
      }
    } else if (d.type === 'focus' && d.pendingFill) {
      this.store.updateFill(d.pageIndex, d.slot.id, d.pendingFill, 'crop:focus');
    } else if (d.type === 'slot') {
      this._commitSlotMove(d);
    }
    this.drag = null;
  }

  _onDblClick(e) {
    const pt = this._docPoint(e);
    const pageIndex = this._pageAtY(pt.y);
    const hit = this._hitTest(pt, pageIndex);
    if (hit?.kind === 'empty-slot') this.bus?.requestFill?.(pageIndex, hit.slot.id);
  }

  _onWheel(opt) {
    const e = opt.e;
    const pt = this._docPoint(opt);
    if (e.ctrlKey || e.metaKey) {
      const pageIndex = this._pageAtY(pt.y);
      const hit = this._hitTest(pt, pageIndex);
      if (hit?.kind === 'photo') {
        e.preventDefault();
        const slot = hit.slot;
        const frame = slotFrame(slot, this.store.doc.gutter);
        const img = this.store.images[slot.fill.imageId];
        const r0 = computeFillRect(frame, img, slot.fill);
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
        let next = scaleAroundPoint(r0, frame, factor, pt);
        next = clampInside(frame, next);
        this.store.updateFill(pageIndex, slot.id, fillFromRect(frame, img, slot.fill, next), 'crop:zoom');
        return;
      }
    }
    const el = this.fabric.upperCanvasEl.parentElement;
    el.scrollLeft += e.deltaX;
    el.scrollTop += e.deltaY;
  }

  _updateCursor(e) {
    const pt = this._docPoint(e);
    const hit = this._hitTest(pt, this._pageAtY(pt.y));
    this.fabric.upperCanvasEl.style.cursor =
      hit ? (hit.kind === 'photo' ? 'move' : 'pointer') : 'default';
  }

  // ---- 槽位参考几何 -----------------------------------------------------
  _otherFrames(page, self) {
    const g = this.store.doc.gutter;
    return [...page.photoSlots, ...page.textSlots]
      .filter((s) => s.id !== self.id && (self.zone === ZONE.SPREAD || s.zone === self.zone))
      .map((s) => slotFrame(s, g));
  }

  _snapTargets(page, self) {
    const g = this.store.doc.gutter;
    const m = spreadMetrics(g);
    const out = this._otherFrames(page, self);
    if (self.zone === ZONE.LEFT) {
      out.push(m.leftPage, rect(m.leftPage.x + m.leftPage.w / 2, 0, 0, m.height));
    } else if (self.zone === ZONE.RIGHT) {
      out.push(m.rightPage, rect(m.rightPage.x + m.rightPage.w / 2, 0, 0, m.height));
    } else {
      out.push(
        m.leftPage, m.rightPage,
        rect(m.width / 2, 0, 0, m.height),
        rect(m.gutterRect.x, 0, 0, m.height),
        rect(m.gutterRect.x + g, 0, 0, m.height)
      );
    }
    return out;
  }

  _commitSlotMove(d) {
    const { slot, startFrame, frame, pageIndex } = d;
    if (startFrame.x === frame.x && startFrame.y === frame.y) {
      this.redraw();
      return;
    }
    const g = this.store.doc.gutter;
    if (slot.spread) {
      const m = spreadMetrics(g);
      this.store.moveSlot(pageIndex, slot.id, {
        x1: frame.x,
        x2: m.rightPage.x + m.rightPage.w - (frame.x + frame.w),
        y: frame.y
      });
    } else {
      const offsetX = slot.zone === ZONE.RIGHT ? PAGE_W + g : 0;
      this.store.moveSlot(pageIndex, slot.id, { x: frame.x - offsetX, y: frame.y });
    }
  }

  // ---- 画布缩放 ---------------------------------------------------------
  setZoom(z) {
    this.zoom = clamp(z, 0.25, 2.5);
    this.fabric.setZoom(this.zoom);
    this.fabric.requestRenderAll();
  }

  getZoom() {
    return this.zoom;
  }

  scrollToPage(index) {
    const el = this.fabric.upperCanvasEl.parentElement;
    const top = this.spreadTops[index] ?? 0;
    el.scrollTo({ top: top * this.zoom - PAD, behavior: 'smooth' });
  }

  _canvasPxWidth() {
    return spreadMetrics(this.store.doc.gutter).width * PX_PER_MM + PAD * 2;
  }
  _canvasPxHeight() {
    const m = spreadMetrics(this.store.doc.gutter);
    const n = this.store.doc.pages.length;
    return n * m.height * PX_PER_MM + (n + 1) * PAD;
  }

  // ---- 全量渲染 ---------------------------------------------------------
  async redraw() {
    const seq = ++this._redrawSeq;
    const c = this.fabric;
    this.guideObjects = [];
    const doc = this.store.doc;
    const m = spreadMetrics(doc.gutter);
    c.setDimensions({ width: this._canvasPxWidth(), height: this._canvasPxHeight() });

    const needed = new Set();
    for (const page of doc.pages) {
      for (const s of page.photoSlots) if (s.fill) needed.add(s.fill.imageId);
    }
    await Promise.all([...needed].map((id) => this._loadImage(id)));
    if (seq !== this._redrawSeq) return;

    c.remove(...c.getObjects());
    this.spreadTops = [];
    doc.pages.forEach((page, i) => {
      const topPx = PAD + i * (m.height * PX_PER_MM + PAD);
      this.spreadTops.push(topPx);
      this._drawSpread(page, i, topPx / PX_PER_MM);
    });
    c.setZoom(this.zoom);
    c.requestRenderAll();
  }

  _drawSpread(page, pageIndex, topMm) {
    const c = this.fabric;
    const g = this.store.doc.gutter;
    const m = spreadMetrics(g);
    const active = pageIndex === this.store.selection.pageIndex;
    const oy = topMm * PX_PER_MM;

    for (const pr of [m.leftPage, m.rightPage]) {
      c.add(new Rect({
        left: this.px(pr.x), top: oy + this.px(pr.y),
        width: this.px(pr.w), height: this.px(pr.h),
        fill: PAGE_BG, selectable: false, evented: false,
        shadow: active
          ? 'rgba(60,40,20,0.18) 0 4px 14px'
          : 'rgba(60,40,20,0.10) 0 2px 8px'
      }));
    }
    if (g > 0) {
      c.add(new Rect({
        left: this.px(m.gutterRect.x), top: oy, width: this.px(g), height: this.px(m.height),
        fill: GUTTER_BG, selectable: false, evented: false
      }));
    }

    for (const slot of page.photoSlots) this._drawPhotoSlot(slot, pageIndex, topMm, active);
    for (const slot of page.textSlots) this._drawTextSlot(slot, pageIndex, topMm, active);

    c.add(new Textbox(`${pageIndex * 2 + 1} - ${pageIndex * 2 + 2}`, {
      left: this.px(m.width / 2) - 30, top: oy - 22, width: 60,
      fontSize: 11, fill: '#8a7a66', textAlign: 'center',
      selectable: false, evented: false
    }));
  }

  _drawPhotoSlot(slot, pageIndex, topMm, active) {
    const c = this.fabric;
    const g = this.store.doc.gutter;
    const frame = slotFrame(slot, g);
    const oy = topMm * PX_PER_MM;
    const selected = active && this.store.selection.slotId === slot.id;

    if (!slot.fill) {
      c.add(new Rect({
        left: this.px(frame.x), top: oy + this.px(frame.y),
        width: this.px(frame.w), height: this.px(frame.h),
        fill: SLOT_EMPTY,
        stroke: selected ? SLOT_ACTIVE : SLOT_STROKE,
        strokeWidth: selected ? 2 : 1,
        strokeDashArray: [6, 4], selectable: false, evented: false,
        data: { slotId: slot.id, role: 'frame' }
      }));
      c.add(new Textbox('双击或拖入照片', {
        left: this.px(frame.x), top: oy + this.px(frame.y) + this.px(frame.h) / 2 - 10,
        width: this.px(frame.w), fontSize: 12, fill: '#a99b88',
        textAlign: 'center', selectable: false, evented: false
      }));
      return;
    }

    const imgMeta = this.store.images[slot.fill.imageId];
    const htmlImg = this.imageCache.get(slot.fill.imageId);
    if (!imgMeta || !htmlImg) return;
    const r = computeFillRect(frame, imgMeta, slot.fill);

    c.add(new FabricImage(htmlImg, {
      left: this.px(r.x), top: oy + this.px(r.y),
      width: this.px(r.w), height: this.px(r.h),
      selectable: false, evented: false,
      clipPath: new Rect({
        left: this.px(frame.x), top: oy + this.px(frame.y),
        width: this.px(frame.w), height: this.px(frame.h),
        absolutePositioned: true
      }),
      data: { slotId: slot.id, role: 'image' }
    }));

    c.add(new Rect({
      left: this.px(frame.x), top: oy + this.px(frame.y),
      width: this.px(frame.w), height: this.px(frame.h),
      fill: 'transparent',
      stroke: selected ? SLOT_ACTIVE : SLOT_STROKE,
      strokeWidth: selected ? 2 : 1,
      selectable: false, evented: false,
      data: { slotId: slot.id, role: 'frame' }
    }));

    if (selected) {
      const mk = markerPosition(frame, r, slot.fill.focus);
      const mx = this.px(mk.x);
      const my = oy + this.px(mk.y);
      c.add(new Circle({
        left: mx - 7, top: my - 7, radius: 7,
        fill: 'rgba(217,79,48,0.25)', stroke: FOCUS, strokeWidth: 1.5,
        selectable: false, evented: false,
        data: { slotId: slot.id, role: 'marker' }
      }));
      c.add(new Line([mx, my - 10, mx, my + 10], {
        stroke: FOCUS, strokeWidth: 1, selectable: false, evented: false,
        data: { slotId: slot.id, role: 'marker' }
      }));
      c.add(new Line([mx - 10, my, mx + 10, my], {
        stroke: FOCUS, strokeWidth: 1, selectable: false, evented: false,
        data: { slotId: slot.id, role: 'marker' }
      }));
    }
  }

  _drawTextSlot(slot, pageIndex, topMm, active) {
    const c = this.fabric;
    const frame = slotFrame(slot, this.store.doc.gutter);
    const oy = topMm * PX_PER_MM;
    const selected = active && this.store.selection.slotId === slot.id;
    const text = resolveText(slot, this.store.doc.variables, pageIndex);

    c.add(new Rect({
      left: this.px(frame.x), top: oy + this.px(frame.y),
      width: this.px(frame.w), height: this.px(frame.h),
      fill: 'transparent',
      stroke: selected ? SLOT_ACTIVE : 'transparent',
      strokeWidth: 1.5, selectable: false, evented: false,
      data: { slotId: slot.id, role: 'text-frame' }
    }));
    c.add(new Textbox(text || ' ', {
      left: this.px(frame.x), top: oy + this.px(frame.y),
      width: this.px(frame.w),
      fontSize: Math.max(4, slot.fontSize * PX_PER_MM * 0.72),
      fill: slot.color, fontFamily: slot.fontFamily,
      textAlign: slot.align === 'left' ? 'left' : slot.align === 'right' ? 'right' : 'center',
      selectable: false, evented: false,
      data: { slotId: slot.id, role: 'text' }
    }));
  }

  async _loadImage(id) {
    if (this.imageCache.has(id)) return this.imageCache.get(id);
    const dataUrl = await this.store.imageDataUrl(id);
    if (!dataUrl) {
      this.imageCache.set(id, null);
      return null;
    }
    const img = await new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = dataUrl;
    });
    this.imageCache.set(id, img);
    return img;
  }

  dispose() {
    this.fabric.dispose();
  }
}
