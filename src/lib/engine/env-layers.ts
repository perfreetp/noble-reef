import { Container, Graphics } from 'pixi.js';
import type { RectArraySpec, RingArraySpec } from '../types';
import { angleVec } from '../util';

const GRID_STEPS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

/** 自适应网格：缩放变化时重绘，屏内网格线数量保持有界 */
export class GridLayer extends Graphics {
  private lastKey = '';

  redraw(opts: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    scale: number;
    baseGrid: number;
  }) {
    if (opts.baseGrid <= 0) {
      this.clear();
      this.lastKey = '';
      return;
    }
    const worldW = opts.right - opts.left;
    // 选一个让屏内线条数 <= 48 的步长
    let step = opts.baseGrid;
    for (const s of GRID_STEPS) {
      if (s >= opts.baseGrid && worldW / s <= 48) {
        step = s;
        break;
      }
      step = s;
    }
    const key = `${step}|${Math.round(opts.left / step)}|${Math.round(opts.top / step)}|${Math.round(
      opts.right / step
    )}|${Math.round(opts.bottom / step)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.clear();
    const startX = Math.floor(opts.left / step) * step;
    const endX = Math.ceil(opts.right / step) * step;
    const startY = Math.floor(opts.top / step) * step;
    const endY = Math.ceil(opts.bottom / step) * step;

    // 世界坐标 0 轴线稍亮
    const lineW = Math.max(1 / opts.scale, 0.8);
    for (let x = startX; x <= endX; x += step) {
      const major = Math.round(x / step) % 5 === 0;
      this.moveTo(x, startY)
        .lineTo(x, endY)
        .stroke({ width: lineW, color: major ? 0xffffff : 0xffffff, alpha: major ? 0.22 : 0.1 });
    }
    for (let y = startY; y <= endY; y += step) {
      const major = Math.round(y / step) % 5 === 0;
      this.moveTo(startX, y)
        .lineTo(endX, y)
        .stroke({ width: lineW, color: major ? 0xffffff : 0xffffff, alpha: major ? 0.22 : 0.1 });
    }
  }

  invalidate() {
    this.lastKey = '';
  }
}

/** 广场底色 + 水池范围 */
export class PlazaLayer extends Graphics {
  private lastKey = '';

  redraw(opts: {
    worldExtent: number;
    plazaColor: number;
    poolColor: number;
    pool: { x: number; y: number; width: number; height: number };
    scale: number;
  }) {
    const { pool } = opts;
    const key = `${opts.worldExtent}|${opts.plazaColor}|${opts.poolColor}|${pool.x},${pool.y},${pool.width},${pool.height}|${opts.scale.toFixed(3)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.clear();

    const e = opts.worldExtent;
    this.rect(-e, -e, e * 2, e * 2).fill({ color: opts.plazaColor });

    // 水池
    this.rect(pool.x, pool.y, pool.width, pool.height).fill({ color: opts.poolColor, alpha: 0.92 });
    // 池岸描边（屏幕恒定宽度）
    const w = Math.max(1.5 / opts.scale, 1);
    this.rect(pool.x, pool.y, pool.width, pool.height).stroke({
      width: w,
      color: 0xe8f1f5,
      alpha: 0.85
    });
  }

  invalidate() {
    this.lastKey = '';
  }
}

export type PoolHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'center';

export function poolHandlePositions(pool: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { id: PoolHandleId; x: number; y: number }[] {
  const cx = pool.x + pool.width / 2;
  const cy = pool.y + pool.height / 2;
  const l = pool.x;
  const r = pool.x + pool.width;
  const t = pool.y;
  const b = pool.y + pool.height;
  return [
    { id: 'nw', x: l, y: t },
    { id: 'n', x: cx, y: t },
    { id: 'ne', x: r, y: t },
    { id: 'e', x: r, y: cy },
    { id: 'se', x: r, y: b },
    { id: 's', x: cx, y: b },
    { id: 'sw', x: l, y: b },
    { id: 'w', x: l, y: cy },
    { id: 'center', x: cx, y: cy }
  ];
}

/** 覆盖物：水池手柄、框选矩形、旋转手柄、阵列放置预览 */
export class OverlayLayer extends Container {
  private handleWorldSize = 24;
  private scaleSafe = 1;

  constructor() {
    super();
  }

  setHandleWorldSize(px: number, scale: number) {
    this.handleWorldSize = px / scale;
  }

  setScale(scale: number) {
    this.scaleSafe = scale;
  }

  private namedGraphics(name: string): Graphics {
    let g = this.getChildByName(name) as Graphics | null;
    if (!g) {
      g = new Graphics();
      g.label = name;
      this.addChild(g);
    }
    return g;
  }

  drawPoolHandles(pool: { x: number; y: number; width: number; height: number }, visible: boolean) {
    const g = this.namedGraphics('poolHandles');
    g.clear();
    g.visible = visible;
    if (!visible) return;
    const s = this.handleWorldSize;
    for (const h of poolHandlePositions(pool)) {
      const isCenter = h.id === 'center';
      g.rect(h.x - s / 2, h.y - s / 2, s, s)
        .fill({ color: isCenter ? 0x1f9df0 : 0xffffff, alpha: 0.95 })
        .stroke({ width: Math.max(1 / this.scaleSafe, 0.8), color: 0x145aaa });
    }
  }

  drawRubberBand(rect: { x: number; y: number; width: number; height: number } | null) {
    const g = this.namedGraphics('rubber');
    g.clear();
    if (!rect) return;
    g.rect(rect.x, rect.y, rect.width, rect.height)
      .fill({ color: 0x1f9df0, alpha: 0.12 })
      .stroke({ width: Math.max(1 / this.scaleSafe, 0.8), color: 0x1f9df0, alpha: 0.9 });
  }

  drawRotateHandle(nozzle: { x: number; y: number; angle: number } | null, radiusWorld: number) {
    const g = this.namedGraphics('rotate');
    g.clear();
    if (!nozzle) return;
    const v = angleVec(nozzle.angle);
    const hx = nozzle.x + v.x * radiusWorld;
    const hy = nozzle.y + v.y * radiusWorld;
    g.moveTo(nozzle.x, nozzle.y)
      .lineTo(hx, hy)
      .stroke({ width: Math.max(1.5 / this.scaleSafe, 1), color: 0xffd34d, alpha: 0.95 });
    const s = radiusWorld * 0.28;
    g.circle(hx, hy, s)
      .fill({ color: 0xffd34d, alpha: 0.95 })
      .stroke({ width: Math.max(1 / this.scaleSafe, 0.8), color: 0x8a6d00 });
  }

  drawGhost(
    ghost: { kind: 'rect'; spec: RectArraySpec } | { kind: 'ring'; spec: RingArraySpec } | null,
    at: { x: number; y: number } | null,
    scale: number
  ) {
    const g = this.namedGraphics('ghost');
    g.clear();
    if (!ghost || !at) return;
    const dotR = Math.max(6 / scale, 2);
    if (ghost.kind === 'rect') {
      const s = ghost.spec;
      const rot = (s.angle * Math.PI) / 180;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const totalW = (s.cols - 1) * s.spacingX;
      const totalH = (s.rows - 1) * s.spacingY;
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const lx = c * s.spacingX - totalW / 2;
          const ly = r * s.spacingY - totalH / 2;
          const x = at.x + lx * cos - ly * sin;
          const y = at.y - lx * sin - ly * cos;
          g.circle(x, y, dotR).fill({ color: 0x1f9df0, alpha: 0.55 });
        }
      }
    } else {
      const s = ghost.spec;
      const span = s.fullCircle ? 360 : s.sweep;
      const denom = s.fullCircle ? s.count : Math.max(s.count - 1, 1);
      for (let i = 0; i < s.count; i++) {
        const t = s.count === 1 ? 0 : i / denom;
        const a = s.startAngle + span * t;
        const v = angleVec(a);
        g.circle(at.x + v.x * s.radius, at.y + v.y * s.radius, dotR).fill({
          color: 0x1f9df0,
          alpha: 0.55
        });
      }
      // 半径参考线
      g.moveTo(at.x, at.y)
        .lineTo(at.x + s.radius, at.y)
        .stroke({ width: Math.max(1 / scale, 0.6), color: 0x1f9df0, alpha: 0.4 });
    }
  }

  clearAll() {
    this.drawRubberBand(null);
    this.drawRotateHandle(null, 0);
    this.drawGhost(null, null, 1);
    this.drawPoolHandles({ x: 0, y: 0, width: 0, height: 0 }, false);
  }
}
