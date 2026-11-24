import { Container, Graphics } from 'pixi.js';
import type { Ornament } from '../core/types';
import type { ProjectStore } from '../core/ProjectStore';
import { crownPolyline } from '../core/crown';
import type { OrnamentEditor } from './OrnamentEditor';

const ORNAMENT_SIZE = 150;
const HANDLE_SIZE = 14;

/**
 * 编辑器覆盖层:冠面参考线、选中框、旋转/缩放手柄、压盖关系标注。
 * 纯 2D 矢量绘制,每帧根据 store/editor 状态重画(图元数量级下开销可忽略)。
 */
export class OverlayView {
  private root = new Container();
  private gfx = new Graphics();
  private crownGfx = new Graphics();

  constructor(private store: ProjectStore, private editor: OrnamentEditor) {
    this.root.addChild(this.crownGfx);
    this.root.addChild(this.gfx);
  }

  get container(): Container {
    return this.root;
  }

  redraw(): void {
    this.drawCrown();
    this.drawSelection();
  }

  private drawCrown(): void {
    const g = this.crownGfx;
    g.clear();
    const pts = crownPolyline(this.store.crown);
    g.setStrokeStyle({ width: 2, color: 0xffd98a, alpha: 0.75, cap: 'round' });
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();
    // 控制点
    for (const p of [this.store.crown.p0, this.store.crown.p1, this.store.crown.p2]) {
      g.circle(p.x, p.y, 5).fill({ color: 0xffd98a, alpha: 0.9 });
    }
  }

  private drawSelection(): void {
    const g = this.gfx;
    g.clear();
    const id = this.editor.selectedId;
    if (!id) return;
    const o = this.store.ornaments.find((q) => q.id === id);
    if (!o) return;

    const half = (ORNAMENT_SIZE * o.scale) / 2;
    const corners = [
      { lx: -half, ly: -half },
      { lx: half, ly: -half },
      { lx: half, ly: half },
      { lx: -half, ly: half },
    ].map((c) => this.toWorld(o, c.lx, c.ly));

    g.setStrokeStyle({ width: 1.5, color: 0x66e1ff, alpha: 0.95 });
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
    g.closePath();
    g.stroke();

    // 缩放手柄(右下)
    const sp = this.toWorld(o, half, half);
    g.rect(sp.x - HANDLE_SIZE / 2, sp.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
      .fill({ color: 0x0b2530 })
      .setStrokeStyle({ width: 1.5, color: 0x66e1ff })
      .stroke();

    // 旋转手柄(顶部上方)
    const rp = this.toWorld(o, 0, -half - 26);
    const tp = this.toWorld(o, 0, -half);
    g.setStrokeStyle({ width: 1.2, color: 0x66e1ff, alpha: 0.8 });
    g.moveTo(tp.x, tp.y).lineTo(rp.x, rp.y).stroke();
    g.circle(rp.x, rp.y, HANDLE_SIZE / 2)
      .fill({ color: 0x0b2530 })
      .setStrokeStyle({ width: 1.5, color: 0x66e1ff })
      .stroke();

    // 压盖关系:重叠图元描边 + 文字标注
    const rel = this.editor.overlapRelations(id);
    for (const up of rel.above) this.drawRelationMarker(up, 0xff7a6b, '压');
    for (const down of rel.below) this.drawRelationMarker(down, 0x8be36b, '被压');
  }

  private drawRelationMarker(o: Ornament, color: number, _label: string): void {
    const g = this.gfx;
    const half = (ORNAMENT_SIZE * o.scale) / 2;
    const c = Math.abs(Math.cos(o.rotation));
    const s = Math.abs(Math.sin(o.rotation));
    const ext = half * (c + s);
    g.setStrokeStyle({ width: 2, color, alpha: 0.9 });
    g.rect(o.x - ext, o.y - ext, ext * 2, ext * 2).stroke();
  }

  private toWorld(o: Ornament, lx: number, ly: number): { x: number; y: number } {
    const c = Math.cos(o.rotation);
    const s = Math.sin(o.rotation);
    return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
  }
}
