import type { Ornament } from '../core/types';
import type { ProjectStore } from '../core/ProjectStore';
import { snapToCrown } from '../core/crown';

export interface PickHit {
  ornament: Ornament;
  /** 命中点相对图元中心的本地坐标(未旋转) */
  localX: number;
  localY: number;
}

const HANDLE_SIZE = 14;

export type DragMode = 'move' | 'rotate' | 'scale';

export interface DragState {
  mode: DragMode;
  ornamentId: string;
  startPointerX: number;
  startPointerY: number;
  startX: number;
  startY: number;
  startRotation: number;
  startScale: number;
  /** 旋转手柄交互时,起始指针角度 */
  startPointerAngle: number;
  /** 是否启用冠面吸附(移动时) */
  snapping: boolean;
}

/**
 * 图元拾取与变换交互。
 * 拾取走 CPU 反向变换(与 BatchGeometryBuilder 的正向变换严格互逆),
 * 不依赖 Pixi 事件,适配自绘批 mesh。
 */
export class OrnamentEditor {
  /** 当前选中的图元 id */
  selectedId: string | null = null;
  /** 悬停图元 id,用于压盖提示 */
  hoverId: string | null = null;
  /** 正在进行的拖拽 */
  drag: DragState | null = null;

  /** 选择变化回调(UI 刷新属性面板) */
  onSelect: ((id: string | null) => void) | null = null;
  /** 图元被修改回调(驱动 store 更新) */
  onTransform: ((id: string, patch: Partial<Ornament>) => void) | null = null;

  constructor(private store: ProjectStore) {}

  /** 画布坐标拾取;优先返回层内 depth 最大(最靠上)的命中图元 */
  pick(px: number, py: number): PickHit | null {
    const hits: PickHit[] = [];
    for (const o of this.store.ornaments) {
      const local = this.toLocal(o, px, py);
      // 图元为边长 150 * scale 的正方形(见 ORNAMENT_SIZE)
      const half = (150 * o.scale) / 2;
      if (Math.abs(local.x) <= half && Math.abs(local.y) <= half) {
        hits.push({ ornament: o, localX: local.x, localY: local.y });
      }
    }
    if (hits.length === 0) return null;
    // 层间顺序优先(数组上层覆盖下层),同层按 depth
    const orderIndex = new Map(this.store.layers.map((l, i) => [l.id, i]));
    hits.sort((a, b) => {
      const la = orderIndex.get(a.ornament.layer)!;
      const lb = orderIndex.get(b.ornament.layer)!;
      if (la !== lb) return lb - la;
      return b.ornament.depth - a.ornament.depth;
    });
    return hits[0];
  }

  /** 世界坐标 -> 图元本地坐标 */
  toLocal(o: Ornament, px: number, py: number): { x: number; y: number } {
    const dx = px - o.x;
    const dy = py - o.y;
    const c = Math.cos(-o.rotation);
    const s = Math.sin(-o.rotation);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  /** 选中图元的变换手柄命中测试(屏幕坐标) */
  pickHandle(px: number, py: number): DragMode | null {
    if (!this.selectedId) return null;
    const o = this.store.ornaments.find((q) => q.id === this.selectedId);
    if (!o) return null;
    const half = (150 * o.scale) / 2;
    // 旋转手柄:顶部上方
    const rotatePos = this.handleWorld(o, 0, -half - 26);
    if (Math.hypot(px - rotatePos.x, py - rotatePos.y) <= HANDLE_SIZE) return 'rotate';
    // 缩放手柄:右下角
    const scalePos = this.handleWorld(o, half, half);
    if (Math.hypot(px - scalePos.x, py - scalePos.y) <= HANDLE_SIZE) return 'scale';
    return null;
  }

  private handleWorld(o: Ornament, lx: number, ly: number): { x: number; y: number } {
    const c = Math.cos(o.rotation);
    const s = Math.sin(o.rotation);
    return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.onSelect?.(id);
  }

  beginDrag(px: number, py: number, snapping: boolean): void {
    const handle = this.pickHandle(px, py);
    if (handle && this.selectedId) {
      const o = this.store.ornaments.find((q) => q.id === this.selectedId)!;
      this.drag = {
        mode: handle,
        ornamentId: o.id,
        startPointerX: px,
        startPointerY: py,
        startX: o.x,
        startY: o.y,
        startRotation: o.rotation,
        startScale: o.scale,
        startPointerAngle: Math.atan2(py - o.y, px - o.x),
        snapping,
      };
      return;
    }
    const hit = this.pick(px, py);
    if (hit) {
      this.select(hit.ornament.id);
      this.drag = {
        mode: 'move',
        ornamentId: hit.ornament.id,
        startPointerX: px,
        startPointerY: py,
        startX: hit.ornament.x,
        startY: hit.ornament.y,
        startRotation: hit.ornament.rotation,
        startScale: hit.ornament.scale,
        startPointerAngle: 0,
        snapping,
      };
    } else {
      this.select(null);
    }
  }

  updateDrag(px: number, py: number): void {
    const d = this.drag;
    if (!d) return;
    const o = this.store.ornaments.find((q) => q.id === d.ornamentId);
    if (!o) return;

    if (d.mode === 'move') {
      const rawX = d.startX + (px - d.startPointerX);
      const rawY = d.startY + (py - d.startPointerY);
      if (d.snapping) {
        const snapped = snapToCrown(this.store.crown, rawX, rawY, d.startRotation);
        this.onTransform?.(o.id, { x: snapped.x, y: snapped.y, rotation: snapped.rotation });
      } else {
        this.onTransform?.(o.id, { x: rawX, y: rawY });
      }
    } else if (d.mode === 'rotate') {
      const angle = Math.atan2(py - o.y, px - o.x);
      let rotation = d.startRotation + (angle - d.startPointerAngle);
      // 吸附到 15° 刻度(按住 Shift 由调用方传入时已处理,这里做默认刻度)
      rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
      this.onTransform?.(o.id, { rotation });
    } else {
      const dist = Math.hypot(px - o.x, py - o.y);
      const startDist = Math.hypot(d.startPointerX - o.x, d.startPointerY - o.y);
      const scale = Math.min(4, Math.max(0.2, d.startScale * (dist / Math.max(1, startDist))));
      this.onTransform?.(o.id, { scale });
    }
  }

  endDrag(): void {
    this.drag = null;
  }

  /**
   * 计算当前选中图元的压盖关系:
   * 返回与它面积重叠的图元,按「谁压谁」排序(上层在前)。
   */
  overlapRelations(id: string): { above: Ornament[]; below: Ornament[] } {
    const target = this.store.ornaments.find((q) => q.id === id);
    if (!target) return { above: [], below: [] };
    const orderIndex = new Map(this.store.layers.map((l, i) => [l.id, i]));
    const above: Ornament[] = [];
    const below: Ornament[] = [];
    for (const o of this.store.ornaments) {
      if (o.id === id || !this.aabbOverlap(target, o)) continue;
      const cmp = this.compareZ(target, o, orderIndex);
      if (cmp < 0) above.push(o);
      else below.push(o);
    }
    return { above, below };
  }

  /** 返回正数表示 a 在上,负数表示 b 在上 */
  private compareZ(
    a: Ornament,
    b: Ornament,
    orderIndex: Map<string, number>,
  ): number {
    const la = orderIndex.get(a.layer)!;
    const lb = orderIndex.get(b.layer)!;
    if (la !== lb) return la - lb;
    return a.depth - b.depth;
  }

  /** 旋转正方形的 AABB 重叠检测(保守判定,够用于压盖提示) */
  private aabbOverlap(a: Ornament, b: Ornament): boolean {
    const boxA = this.worldAabb(a);
    const boxB = this.worldAabb(b);
    return !(
      boxA.maxX < boxB.minX ||
      boxA.minX > boxB.maxX ||
      boxA.maxY < boxB.minY ||
      boxA.minY > boxB.maxY
    );
  }

  private worldAabb(o: Ornament): { minX: number; minY: number; maxX: number; maxY: number } {
    const half = (150 * o.scale) / 2;
    const c = Math.abs(Math.cos(o.rotation));
    const s = Math.abs(Math.sin(o.rotation));
    const extX = half * (c + s);
    const extY = half * (c + s);
    return { minX: o.x - extX, minY: o.y - extY, maxX: o.x + extX, maxY: o.y + extY };
  }
}
