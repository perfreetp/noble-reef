// 纯几何工具函数：矩形运算、cover 填充、约束回弹、吸附计算
// 所有坐标单位均为 mm，文档坐标原点在对开页左上角。

export function rect(x = 0, y = 0, w = 0, h = 0) {
  return { x, y, w, h };
}

export function cloneRect(r) {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

export function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function intersection(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || btm <= y) return null;
  return rect(x, y, r - x, btm - y);
}

/**
 * cover 模式计算图片在裁切框内的基础填充矩形。
 * 图片等比缩放到完全覆盖槽位，中心对齐。
 * @param frame 裁切框 {x,y,w,h}
 * @param image 图片自然尺寸 {w,h}
 * @param focus 焦点 {x,y}，归一化 0..1，默认中心
 */
export function coverRect(frame, image, focus = { x: 0.5, y: 0.5 }) {
  const ir = image.w / image.h;
  const fr = frame.w / frame.h;
  let w, h;
  if (ir > fr) {
    h = frame.h;
    w = h * ir;
  } else {
    w = frame.w;
    h = w / ir;
  }
  // 焦点对应的图片点落在槽位中心（基础态），焦点靠边时夹紧防止露出空白
  const x = frame.x + frame.w / 2 - w * clamp(focus.x, 0, 1);
  const y = frame.y + frame.h / 2 - h * clamp(focus.y, 0, 1);
  return clampInside(frame, rect(x, y, w, h));
}

/** 把与框等大或更大的图片矩形夹紧到框内（不允许出现空白边） */
export function clampInside(frame, r) {
  let { x, y } = r;
  if (r.w <= frame.w) x = frame.x + (frame.w - r.w) / 2;
  else x = clamp(x, frame.x + frame.w - r.w, frame.x);
  if (r.h <= frame.h) y = frame.y + (frame.h - r.h) / 2;
  else y = clamp(y, frame.y + frame.h - r.h, frame.y);
  return rect(x, y, r.w, r.h);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * 以焦点为锚点缩放图片矩形。
 * 缩放后自动夹紧回裁切框；焦点在图片上的归一化位置保持不变。
 */
export function scaleAround(r, frame, factor) {
  const fx = frame.x + frame.w / 2;
  const fy = frame.y + frame.h / 2;
  const nw = clamp(r.w * factor, frame.w, frame.w * 6);
  const nh = clamp(r.h * factor, frame.h, frame.h * 6);
  const nx = fx - ((fx - r.x) / r.w) * nw;
  const ny = fy - ((fy - r.y) / r.h) * nh;
  return clampInside(frame, rect(nx, ny, nw, nh));
}

/**
 * 平移后回弹约束：图片必须始终覆盖裁切框。
 * 超出范围时回弹到最近的合法位置。
 */
export function constrainPan(frame, r) {
  return clampInside(frame, r);
}

/**
 * 槽位矩形最小间距约束：把 target 推离 others，保证间距 >= gap。
 * 仅处理同页内槽位（调用方负责过滤），沿最小重叠轴回弹。
 * @returns 调整后的矩形（尺寸不变，仅位置变化）
 */
export function applyGapConstraints(target, others, gap) {
  let r = cloneRect(target);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const o of others) {
      const expanded = rect(o.x - gap, o.y - gap, o.w + gap * 2, o.h + gap * 2);
      const hit = intersection(r, expanded);
      if (!hit) continue;
      // 选重叠最浅的轴推出
      const pushLeft = r.x + r.w - (o.x - gap);
      const pushRight = o.x + o.w + gap - r.x;
      const pushUp = r.y + r.h - (o.y - gap);
      const pushDown = o.y + o.h + gap - r.y;
      const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown);
      if (minPush === pushLeft) r.x -= pushLeft;
      else if (minPush === pushRight) r.x += pushRight;
      else if (minPush === pushUp) r.y -= pushUp;
      else r.y += pushDown;
      moved = true;
    }
    if (!moved) break;
  }
  return r;
}

/**
 * 吸附计算：拖动矩形靠近参考矩形边缘/中心时，返回修正后的位置与命中的参考线。
 * @param r 正在拖动的矩形（槽位或照片）
 * @param targets 参考矩形数组
 * @param threshold 吸附阈值 mm
 * @returns {{x:number,y:number,guides:Array}} guides: {axis:'v'|'h', pos:number, start:number, end:number}
 */
export function snapRect(r, targets, threshold) {
  const rEdgesV = [r.x, r.x + r.w / 2, r.x + r.w];
  const rEdgesH = [r.y, r.y + r.h / 2, r.y + r.h];
  let bestV = null;
  let bestH = null;
  const guides = [];

  for (const t of targets) {
    // 零宽度参考线（页面中线等）只参与边缘对齐，不与矩形中线吸附
    const tEdgesV = t.w === 0 ? [t.x] : [t.x, t.x + t.w / 2, t.x + t.w];
    const tEdgesH = t.h === 0 ? [t.y] : [t.y, t.y + t.h / 2, t.y + t.h];
    for (const re of rEdgesV) {
      for (const te of tEdgesV) {
        const d = Math.abs(re - te);
        if (d <= threshold && (!bestV || d < bestV.d)) {
          bestV = { d, delta: te - re, pos: te, t };
        }
      }
    }
    for (const re of rEdgesH) {
      for (const te of tEdgesH) {
        const d = Math.abs(re - te);
        if (d <= threshold && (!bestH || d < bestH.d)) {
          bestH = { d, delta: te - re, pos: te, t };
        }
      }
    }
  }

  let { x, y } = r;
  if (bestV) {
    x += bestV.delta;
    guides.push({
      axis: 'v',
      pos: bestV.pos,
      start: Math.min(y, bestV.t.y) - 4,
      end: Math.max(y + r.h, bestV.t.y + bestV.t.h) + 4
    });
  }
  if (bestH) {
    y += bestH.delta;
    guides.push({
      axis: 'h',
      pos: bestH.pos,
      start: Math.min(x, bestV ? bestV.t.x : r.x) - 4,
      end: Math.max(x + r.w, (bestV ? bestV.t.x + bestV.t.w : r.x + r.w)) + 4
    });
  }
  return { x, y, guides };
}

/** 限制矩形在页面安全区内（拖动槽位时用） */
export function clampToPage(r, pageArea) {
  const x = clamp(r.x, pageArea.x, pageArea.x + pageArea.w - r.w);
  const y = clamp(r.y, pageArea.y, pageArea.y + pageArea.h - r.h);
  return rect(x, y, r.w, r.h);
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 由图片填充矩形与裁切框反算归一化焦点 */
export function focusFromRect(frame, r) {
  // 焦点（槽位中心）对应图片上的归一化坐标
  const fx = (frame.x + frame.w / 2 - r.x) / r.w;
  const fy = (frame.y + frame.h / 2 - r.y) / r.h;
  return { x: clamp(fx, 0, 1), y: clamp(fy, 0, 1) };
}
