// 布局换算：页内坐标 ↔ 对开页文档坐标，照片填充状态 ↔ 实际渲染矩形
// 文档坐标系：mm，原点在左页左上角；右页随 gutter 偏移。
import { PAGE_W, PAGE_H, VAR, ZONE } from './constants.js';
import { rect, coverRect, clampInside, clamp, scaleAround } from './geometry.js';

export function spreadMetrics(gutter) {
  return {
    gutter,
    width: PAGE_W * 2 + gutter,
    height: PAGE_H,
    leftPage: rect(0, 0, PAGE_W, PAGE_H),
    rightPage: rect(PAGE_W + gutter, 0, PAGE_W, PAGE_H),
    gutterRect: rect(PAGE_W, 0, gutter, PAGE_H)
  };
}

/** 槽位在对开页文档坐标系中的裁切框 */
export function slotFrame(slot, gutter) {
  if (slot.zone === ZONE.LEFT) return { ...slot.rect };
  if (slot.zone === ZONE.RIGHT) {
    return rect(slot.rect.x + PAGE_W + gutter, slot.rect.y, slot.rect.w, slot.rect.h);
  }
  // 跨页槽位：x1 距左页左边，x2 距右页右边
  const s = slot.spread;
  return rect(
    s.x1,
    s.y,
    PAGE_W - s.x1 + gutter + PAGE_W - s.x2,
    s.h
  );
}

export function allPhotoFrames(page, gutter) {
  return page.photoSlots.map((s) => ({ slot: s, frame: slotFrame(s, gutter) }));
}

/**
 * 由填充状态计算图片实际矩形（文档坐标）。
 * fill: { imageId, focus{x,y}, zoom, pan{x,y} }
 * image: { w, h } 自然尺寸
 */
export function computeFillRect(frame, image, fill) {
  if (!fill || !image) return null;
  const focus = fill.focus ?? { x: 0.5, y: 0.5 };
  const base = coverRect(frame, image, focus);
  const zoom = clamp(fill.zoom ?? 1, 1, 6);
  let r = scaleAround(base, frame, zoom);
  const pan = fill.pan ?? { x: 0, y: 0 };
  r = rect(r.x + pan.x, r.y + pan.y, r.w, r.h);
  return clampInside(frame, r);
}

/**
 * 交互结束后，由实际图片矩形反推填充状态（焦点 + 缩放 + 平移）。
 * 保证 computeFillRect 能还原该矩形。
 */
export function fillFromRect(frame, image, currentFill, r) {
  const focus = currentFill?.focus ?? { x: 0.5, y: 0.5 };
  const base = coverRect(frame, image, focus);
  const zoom = clamp(r.w / base.w, 1, 6);
  const scaled = scaleAround(base, frame, zoom);
  return {
    imageId: currentFill?.imageId,
    focus: { ...focus },
    zoom,
    pan: { x: r.x - scaled.x, y: r.y - scaled.y }
  };
}

/** 焦点标记在文档坐标中的位置（夹在裁切框内） */
export function markerPosition(frame, r, focus) {
  if (!r) return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const x = clamp(r.x + focus.x * r.w, frame.x, frame.x + frame.w);
  const y = clamp(r.y + focus.y * r.h, frame.y, frame.y + frame.h);
  return { x, y };
}

/**
 * 拖动焦点标记：图片跟随平移，按指针位置更新归一化焦点与平移量。
 * @param pointer 指针文档坐标
 */
export function dragFocus(frame, image, fill, r, pointer) {
  const marker = markerPosition(frame, r, fill.focus);
  let next = rect(r.x + pointer.x - marker.x, r.y + pointer.y - marker.y, r.w, r.h);
  next = clampInside(frame, next);
  const actualMarker = rect(
    marker.x + (next.x - r.x),
    marker.y + (next.y - r.y),
    0, 0
  );
  const focus = {
    x: clamp((actualMarker.x - next.x) / next.w, 0, 1),
    y: clamp((actualMarker.y - next.y) / next.h, 0, 1)
  };
  const base = coverRect(frame, image, focus);
  const zoom = clamp(r.w / base.w, 1, 6);
  const scaled = scaleAround(base, frame, zoom);
  return {
    fill: {
      imageId: fill.imageId,
      focus,
      zoom,
      pan: { x: next.x - scaled.x, y: next.y - scaled.y }
    },
    rect: next
  };
}

/** 文字槽位解析为实际文本；页码按对开页序号计算 */
export function resolveText(slot, variables, pageIndex) {
  switch (slot.variable) {
    case VAR.NAMES:
      return variables.names ?? '';
    case VAR.DATE:
      return variables.date ?? '';
    case VAR.PAGE:
      return String(slot.zone === ZONE.LEFT ? pageIndex * 2 + 1 : pageIndex * 2 + 2);
    default:
      return '';
  }
}

/** 重排后重算所有页码文本槽（页码由位置决定，无需改数据，这里仅返回受影响数量） */
export function recountPages(pages) {
  return pages.length * 2;
}
