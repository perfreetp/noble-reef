import * as THREE from 'three';
import type { PartDef, PartId, TipId, Vec2 } from '../types';
import { buildPartGeometry, leatherMaterial } from './shapes';

interface PartRuntime {
  def: PartDef;
  /** three.js 枢轴节点:位置=父级挂点,rotation.z=相对父级角度 */
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  /** 世界变换(每帧沿层级刷新) */
  worldPos: Vec2;
  worldAngle: number;
  /** 杆件求解出的目标局部角;null 表示该帧无杆驱动,走自由回弹 */
  target: number | null;
  angle: number;
  /** 自由回弹用角速度 */
  vel: number;
  depth: number;
}

const Z_SPACING = 0.03;

/**
 * 影偶运动学骨架。
 *
 * 层级:body 为根,head/双臂/双腿通过 anchor 挂点铰接在父部件上。
 * 每帧流程:
 *   1. RodController 按杆件位移换算各挂点目标角,setTarget 写入;
 *   2. update(dt):被驱动部件做临界阻尼逼近(限位+回弹);未驱动部件做阻尼摆;
 *   3. 沿层级(BFS)刷新 worldPos/worldAngle 与 three.js 节点,
 *      子部件枢轴始终跟随父挂点 —— 铰接不脱开;
 *   4. 限位在角度层强制,配合防穿透的相邻角变化速率限制,部件不会翻折穿透。
 */
export class Rig {
  readonly parts = new Map<PartId, PartRuntime>();
  readonly root = new THREE.Group();
  private order: PartRuntime[] = [];
  /** 挂点 id -> 所属部件 id(用于杆件绑定解析) */
  readonly tipOwner = new Map<TipId, PartId>();

  constructor(defs: PartDef[]) {
    const sharedMat = leatherMaterial();
    for (const def of defs) {
      const pivot = new THREE.Group();
      const geo = buildPartGeometry(def.id);
      const mesh = new THREE.Mesh(geo, sharedMat);
      mesh.castShadow = true;
      pivot.add(mesh);
      pivot.position.set(def.anchor.x, def.anchor.y, 0);
      const rt: PartRuntime = {
        def,
        pivot,
        mesh,
        worldPos: { x: def.anchor.x, y: def.anchor.y },
        worldAngle: def.restAngle,
        target: null,
        angle: def.restAngle,
        vel: 0,
        depth: def.z,
      };
      this.parts.set(def.id, rt);
      for (const tip of Object.keys(def.tips) as TipId[]) this.tipOwner.set(tip, def.id);
    }
    // 挂接父子(父枢轴为子的坐标空间),根为 body
    for (const rt of this.parts.values()) {
      if (rt.def.parent) {
        const parent = this.parts.get(rt.def.parent);
        if (!parent) throw new Error(`部件 ${rt.def.id} 的父级 ${rt.def.parent} 不存在`);
        parent.pivot.add(rt.pivot);
      } else {
        this.root.add(rt.pivot);
      }
    }
    // BFS:保证父的世界变换先于子刷新
    const queue = [this.parts.get('body')!];
    while (queue.length) {
      const rt = queue.shift()!;
      this.order.push(rt);
      for (const child of this.parts.values()) {
        if (child.def.parent === rt.def.id) queue.push(child);
      }
    }
    this.applyHierarchy();
  }

  /** 写入某部件的目标局部角(由杆件换算得到) */
  setTarget(partId: PartId, localAngle: number): void {
    const rt = this.parts.get(partId);
    if (rt) rt.target = localAngle;
  }

  private clampLimit(rt: PartRuntime, a: number): number {
    const [lo, hi] = rt.def.limits;
    return Math.min(hi, Math.max(lo, a));
  }

  update(dt: number): void {
    const h = Math.min(dt, 1 / 30); // 掉帧时钳制步长,保证弹簧稳定

    for (const rt of this.order) {
      if (rt.target !== null) {
        // 被杆驱动:临界阻尼逼近目标,稳态无振荡,到限位即停(等效回弹)
        const k = 1 - Math.exp(-18 * h);
        const prev = rt.angle;
        rt.angle += (this.clampLimit(rt, rt.target) - rt.angle) * k;
        // 防穿透:单帧角变化速率上限,阻止突跳式翻折
        const maxStep = 6 * h;
        if (rt.angle - prev > maxStep) rt.angle = prev + maxStep;
        else if (rt.angle - prev < -maxStep) rt.angle = prev - maxStep;
        rt.angle = this.clampLimit(rt, rt.angle);
        rt.vel = 0;
      } else {
        // 未被驱动:绕静止角的阻尼摆(如未绑杆的腿),松手自然回弹
        const stiffness = 26;
        const damping = 7.5;
        const acc = -stiffness * (rt.angle - rt.def.restAngle) - damping * rt.vel;
        rt.vel += acc * h;
        rt.angle += rt.vel * h;
        const clamped = this.clampLimit(rt, rt.angle);
        if (clamped !== rt.angle) {
          rt.angle = clamped;
          rt.vel = 0; // 撞限位吸能,不弹穿
        }
      }
      rt.pivot.rotation.z = rt.angle;
      rt.target = null;
    }
    this.applyHierarchy();
  }

  /** 沿层级刷新世界位姿:子枢轴 = 父挂点,铰接永不脱开 */
  private applyHierarchy(): void {
    this.root.updateMatrixWorld(true);
    for (const rt of this.order) {
      const p = new THREE.Vector3();
      rt.pivot.getWorldPosition(p);
      rt.worldPos = { x: p.x, y: p.y };
      let angle = 0;
      let node: THREE.Object3D | null = rt.pivot;
      while (node) {
        angle += node.rotation.z;
        node = node.parent;
      }
      rt.worldAngle = angle;
      // 深度错开,避免共面闪烁
      rt.mesh.position.z = rt.depth * Z_SPACING;
    }
  }

  /** 取挂点世界坐标(杆件求解与姿态联动用) */
  tipWorld(tip: TipId): Vec2 {
    const owner = this.tipOwner.get(tip);
    if (!owner) throw new Error(`未知挂点 ${tip}`);
    const rt = this.parts.get(owner)!;
    const local = rt.def.tips[tip]!;
    const c = Math.cos(rt.worldAngle);
    const s = Math.sin(rt.worldAngle);
    return {
      x: rt.worldPos.x + local.x * c - local.y * s,
      y: rt.worldPos.y + local.x * s + local.y * c,
    };
  }

  getPart(partId: PartId): PartRuntime {
    return this.parts.get(partId)!;
  }

  get meshes(): THREE.Mesh[] {
    return this.order.map((r) => r.mesh);
  }

  get partIdsInOrder(): PartId[] {
    return this.order.map((r) => r.def.id);
  }

  dispose(): void {
    for (const rt of this.parts.values()) {
      rt.mesh.geometry.dispose();
    }
    (this.order[0]?.mesh.material as THREE.Material | undefined)?.dispose();
  }
}
