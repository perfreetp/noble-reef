import type { Rig } from './rig';
import type { RodDef, Vec2 } from '../types';
import { ROD_RANGE } from '../types';

interface RodState {
  def: RodDef;
  /** 操纵盘位置(世界单位,长度 ≤ ROD_RANGE) */
  pos: Vec2;
  target: Vec2;
  tween: { from: Vec2; to: Vec2; elapsed: number; duration: number } | null;
  dragging: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 操纵杆控制器。
 *
 * 操纵盘坐标是半径 ROD_RANGE 的圆盘;拖动位移按绑定的 axis/scale
 * 换算成挂点所属部件的局部关节角:
 *
 *   localAngle = restAngle + (rodPos[axis] - home[axis]) * scale
 *
 * 一根杆可驱动 1~2 个挂点;最多 3 根杆,每帧全部求解,
 * 目标角交给 Rig 做限位/回弹/防穿透,因此杆拖到极限时关节被限位顶住,
 * 松手后由阻尼弹簧回到静止位。
 */
export class RodController {
  private rods = new Map<string, RodState>();

  constructor(private rig: Rig, defs: RodDef[]) {
    this.configure(defs);
  }

  configure(defs: RodDef[]): void {
    this.rods.clear();
    for (const def of defs) {
      this.rods.set(def.id, {
        def,
        pos: { ...def.home },
        target: { ...def.home },
        tween: null,
        dragging: false,
      });
    }
  }

  get list(): RodState[] {
    return [...this.rods.values()];
  }

  get(id: string): RodState | undefined {
    return this.rods.get(id);
  }

  /** 归一化坐标 [-1,1](操纵盘 UI 用) */
  normalized(id: string): Vec2 {
    const r = this.rods.get(id);
    if (!r) return { x: 0, y: 0 };
    return { x: r.pos.x / ROD_RANGE, y: r.pos.y / ROD_RANGE };
  }

  /** 指针拖动写入(世界单位,自动夹到圆盘) */
  setInput(id: string, p: Vec2): void {
    const r = this.rods.get(id);
    if (!r) return;
    const len = Math.hypot(p.x, p.y);
    const k = len > ROD_RANGE ? ROD_RANGE / len : 1;
    r.target = { x: p.x * k, y: p.y * k };
    r.tween = null;
    r.dragging = true;
  }

  release(id: string): void {
    const r = this.rods.get(id);
    if (r) r.dragging = false;
  }

  /** 切换姿态:杆件位置平滑过渡(临界阻尼式补间) */
  tweenTo(pose: Record<string, Vec2>, duration = 0.5): void {
    for (const [id, p] of Object.entries(pose)) {
      const r = this.rods.get(id);
      if (!r) continue;
      r.tween = {
        from: { ...r.pos },
        to: { x: p.x * ROD_RANGE, y: p.y * ROD_RANGE },
        elapsed: 0,
        duration,
      };
    }
  }

  cancelTweens(): void {
    for (const r of this.rods.values()) r.tween = null;
  }

  update(dt: number): void {
    const h = Math.min(dt, 1 / 30);
    for (const r of this.rods.values()) {
      if (r.tween) {
        r.tween.elapsed += h;
        const t = clamp(r.tween.elapsed / r.tween.duration, 0, 1);
        const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
        r.pos = {
          x: r.tween.from.x + (r.tween.to.x - r.tween.from.x) * e,
          y: r.tween.from.y + (r.tween.to.y - r.tween.from.y) * e,
        };
        if (t >= 1) r.tween = null;
      } else {
        // 输入与当前位置之间的轻弹簧:拖到极限被圆盘夹住时无抖动,
        // 同时让姿态补间被打断后接管平滑
        const k = 1 - Math.exp(-22 * h);
        r.pos.x += (r.target.x - r.pos.x) * k;
        r.pos.y += (r.target.y - r.pos.y) * k;
      }
    }
    this.solve();
  }

  /** 位移 -> 关节角换算,写入骨架目标 */
  private solve(): void {
    for (const r of this.rods.values()) {
      for (const b of r.def.bindings) {
        const partId = this.rig.tipOwner.get(b.tip);
        if (!partId) continue;
        const part = this.rig.getPart(partId);
        const displacement = (r.pos[b.axis] - r.def.home[b.axis]) * b.scale;
        this.rig.setTarget(partId, part.def.restAngle + displacement);
      }
    }
  }

  /** 当前各杆归一化位置(存姿态用) */
  snapshot(): Record<string, Vec2> {
    const out: Record<string, Vec2> = {};
    for (const r of this.rods.values()) {
      out[r.def.id] = {
        x: clamp(r.pos.x / ROD_RANGE, -1, 1),
        y: clamp(r.pos.y / ROD_RANGE, -1, 1),
      };
    }
    return out;
  }
}
