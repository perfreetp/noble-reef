import { Quaternion, Vector3 } from 'three';
import type { ShapeState, Skeleton, V3 } from './types';
import { visibleLimbSet } from './skeleton';
import { clamp, DEG } from './math';

const UP = new Vector3(0, 1, 0);
const TMP_UP = new Vector3(0, 1, 0);

/**
 * Poses the skeleton. A joint's local user rotation (bend x twist) propagates to all
 * descendants, so shaping one joint re-curves the whole subtree above it — and any
 * branch whose attach point sits above the joint follows along.
 *
 * Controls store their rotation under their own node id, and the handle for a control
 * is drawn at its first child joint — i.e. at the far end of the bone it rotates.
 */
export class TreeRig {
  readonly skel: Skeleton;
  private bend = new Map<number, Quaternion>();
  private twist = new Map<number, number>();
  private pruned = new Set<number>();

  readonly restPos: Float32Array;
  readonly restQuat: Float32Array;
  readonly localPos: Float32Array;
  readonly localRestQuat: Float32Array;
  readonly parent: Int32Array;
  readonly firstChild: Int32Array;

  /** For each node, which control's twist it partially applies and by how much. */
  readonly twistSources: { control: number; weight: number }[][];

  readonly pos: Float32Array;
  readonly quat: Float32Array;
  readonly visible: Uint8Array;
  readonly limbVisible: Uint8Array;

  private tUp = new Vector3(0, 1, 0);

  constructor(skel: Skeleton) {
    this.skel = skel;
    const n = skel.nodes.length;
    this.restPos = new Float32Array(n * 3);
    this.restQuat = new Float32Array(n * 4);
    this.localPos = new Float32Array(n * 3);
    this.localRestQuat = new Float32Array(n * 4);
    this.parent = new Int32Array(n);
    this.firstChild = new Int32Array(n).fill(-1);
    this.twistSources = Array.from({ length: n }, () => [] as { control: number; weight: number }[]);
    this.pos = new Float32Array(n * 3);
    this.quat = new Float32Array(n * 4);
    this.visible = new Uint8Array(n);
    this.limbVisible = new Uint8Array(skel.limbs.length);

    for (const node of skel.nodes) {
      this.parent[node.id] = node.parent;
      if (node.parent >= 0 && this.firstChild[node.parent] < 0) this.firstChild[node.parent] = node.id;
      this.restPos[node.id * 3] = node.restPos[0];
      this.restPos[node.id * 3 + 1] = node.restPos[1];
      this.restPos[node.id * 3 + 2] = node.restPos[2];
    }

    // Rest world orientation: +Y points along the joint's outgoing bone, or along the
    // incoming one for a tip joint.
    const q = new Quaternion();
    const dir = new Vector3();
    for (const node of skel.nodes) {
      const i = node.id;
      const child = this.firstChild[i];
      if (child >= 0) {
        dir.set(
          this.restPos[child * 3] - this.restPos[i * 3],
          this.restPos[child * 3 + 1] - this.restPos[i * 3 + 1],
          this.restPos[child * 3 + 2] - this.restPos[i * 3 + 2],
        );
      } else if (node.parent >= 0) {
        dir.set(
          this.restPos[i * 3] - this.restPos[node.parent * 3],
          this.restPos[i * 3 + 1] - this.restPos[node.parent * 3 + 1],
          this.restPos[i * 3 + 2] - this.restPos[node.parent * 3 + 2],
        );
      } else {
        dir.set(0, 1, 0);
      }
      if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
      q.setFromUnitVectors(UP, dir.normalize());
      this.restQuat[i * 4] = q.x;
      this.restQuat[i * 4 + 1] = q.y;
      this.restQuat[i * 4 + 2] = q.z;
      this.restQuat[i * 4 + 3] = q.w;
    }

    // Rest local offsets in the parent frame.
    const pq = new Quaternion();
    const pqInv = new Quaternion();
    const d = new Vector3();
    const lq = new Quaternion();
    for (const node of skel.nodes) {
      const i = node.id;
      if (node.parent < 0) {
        this.localPos[i * 3] = node.restPos[0];
        this.localPos[i * 3 + 1] = node.restPos[1];
        this.localPos[i * 3 + 2] = node.restPos[2];
        this.localRestQuat[i * 4 + 3] = 1;
        continue;
      }
      const p = node.parent;
      pq.set(this.restQuat[p * 4], this.restQuat[p * 4 + 1], this.restQuat[p * 4 + 2], this.restQuat[p * 4 + 3]);
      pqInv.copy(pq).invert();
      d.set(
        this.restPos[i * 3] - this.restPos[p * 3],
        this.restPos[i * 3 + 1] - this.restPos[p * 3 + 1],
        this.restPos[i * 3 + 2] - this.restPos[p * 3 + 2],
      ).applyQuaternion(pqInv);
      this.localPos[i * 3] = d.x;
      this.localPos[i * 3 + 1] = d.y;
      this.localPos[i * 3 + 2] = d.z;
      lq.set(this.restQuat[i * 4], this.restQuat[i * 4 + 1], this.restQuat[i * 4 + 2], this.restQuat[i * 4 + 3]);
      lq.premultiply(pqInv);
      this.localRestQuat[i * 4] = lq.x;
      this.localRestQuat[i * 4 + 1] = lq.y;
      this.localRestQuat[i * 4 + 2] = lq.z;
      this.localRestQuat[i * 4 + 3] = lq.w;
    }
    this.computeTwistSources();
    // Nodes always evaluate in id order, which is parent-before-child.
    this.refreshVisibility();
    this.evaluate();
  }

  /**
   * A twist is stored on one control joint, but putting the whole angle into a single bone
   * shears the bark into a visible diagonal band. Instead the angle is spread over a short
   * run of joints past the control with a smooth falloff: the branch turns gradually, and
   * anything attached above still ends up rotated by the full amount.
   */
  private computeTwistSources(): void {
    for (const list of this.twistSources) list.length = 0;
    const skel = this.skel;
    const SPREAD = 5;
    for (const limb of skel.limbs) {
      const nodes = limb.nodes;
      for (let i = 0; i < nodes.length; i++) {
        const nodeId = nodes[i];
        const node = skel.nodes[nodeId];
        if (!node.control) continue;
        const available = nodes.length - i;
        if (available <= 1) {
          // Terminal joint: lean on the incoming bone so the tip still turns.
          const parent = node.parent;
          if (parent >= 0) {
            this.twistSources[nodeId].push({ control: nodeId, weight: 0.55 });
            this.twistSources[parent].push({ control: nodeId, weight: 0.45 });
          } else {
            this.twistSources[nodeId].push({ control: nodeId, weight: 1 });
          }
          continue;
        }
        const count = Math.min(SPREAD, available);
        let sum = 0;
        const weights: number[] = [];
        for (let j = 0; j < count; j++) {
          const w = Math.exp(-j / 1.9);
          weights.push(w);
          sum += w;
        }
        for (let j = 0; j < count; j++) {
          this.twistSources[nodes[i + j]].push({ control: nodeId, weight: weights[j] / sum });
        }
      }
    }
  }

  // ---- Shape state ------------------------------------------------------

  setShape(shape: ShapeState): void {
    this.bend.clear();
    this.twist.clear();
    for (const [k, v] of Object.entries(shape.bends)) {
      const q = new Quaternion(v[0], v[1], v[2], v[3]);
      if (q.lengthSq() > 1e-12) this.bend.set(Number(k), q.normalize());
    }
    for (const [k, v] of Object.entries(shape.twists)) if (v) this.twist.set(Number(k), v);
    this.pruned = new Set(shape.pruned);
    this.refreshVisibility();
    this.evaluate();
  }

  getShape(): ShapeState {
    const bends: ShapeState['bends'] = {};
    for (const [id, q] of this.bend) {
      if (Math.abs(q.w) > 0.99999) continue;
      bends[id] = [q.x, q.y, q.z, q.w];
    }
    const twists: Record<string, number> = {};
    for (const [id, t] of this.twist) if (Math.abs(t) >= 0.1) twists[id] = Math.round(t * 10) / 10;
    return { bends, twists, pruned: [...this.pruned] };
  }

  resetShape(): void {
    this.bend.clear();
    this.twist.clear();
    this.pruned.clear();
    this.refreshVisibility();
    this.evaluate();
  }

  resetNode(nodeId: number): void {
    this.bend.delete(nodeId);
    this.twist.delete(nodeId);
    this.evaluate();
  }

  bendAmount(nodeId: number): number {
    const q = this.bend.get(nodeId);
    return q ? (2 * Math.acos(clamp(Math.abs(q.w), -1, 1))) / DEG : 0;
  }

  twistAmount(nodeId: number): number {
    return this.twist.get(nodeId) ?? 0;
  }

  setTwist(nodeId: number, degrees: number): void {
    this.twist.set(nodeId, clamp(degrees, -180, 180));
    this.evaluate();
  }

  // ---- Pruning ----------------------------------------------------------

  isPruned(limbId: number): boolean {
    return this.pruned.has(limbId);
  }

  /** Removed either directly or because an ancestor limb is gone. */
  isLimbGone(limbId: number): boolean {
    return !this.limbVisible[limbId];
  }

  pruneLimb(limbId: number): void {
    if (limbId <= 0) return;
    this.pruned.add(limbId);
    this.refreshVisibility();
    this.evaluate();
  }

  restoreLimb(limbId: number): void {
    this.pruned.delete(limbId);
    this.refreshVisibility();
    this.evaluate();
  }

  setPruned(ids: readonly number[]): void {
    this.pruned = new Set(ids.filter((id) => id > 0));
    this.refreshVisibility();
    this.evaluate();
  }

  prunedList(): number[] {
    return [...this.pruned];
  }

  private refreshVisibility(): void {
    const set = visibleLimbSet(this.skel.limbs, [...this.pruned]);
    this.limbVisible.fill(0);
    for (const id of set) this.limbVisible[id] = 1;
    for (const node of this.skel.nodes) this.visible[node.id] = this.limbVisible[node.limb] ? 1 : 0;
  }

  // ---- Pose -------------------------------------------------------------

  private tmpTwist = new Quaternion();

  private localUser(nodeId: number, out: Quaternion): Quaternion {
    out.identity();
    const b = this.bend.get(nodeId);
    if (b) out.copy(b);
    const sources = this.twistSources[nodeId];
    if (sources && sources.length) {
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        const deg = this.twist.get(src.control);
        if (deg === undefined || Math.abs(deg) < 0.02) continue;
        out.multiply(this.tmpTwist.setFromAxisAngle(UP, deg * src.weight * DEG));
      }
    }
    return out;
  }

  evaluate(): void {
    const n = this.skel.nodes.length;
    const userQ = new Quaternion();
    const parentQ = new Quaternion();
    const restLocal = new Quaternion();
    const offset = new Vector3();
    const out = new Quaternion();
    for (let i = 0; i < n; i++) {
      const p = this.parent[i];
      if (p < 0) {
        for (let k = 0; k < 4; k++) this.quat[i * 4 + k] = this.restQuat[i * 4 + k];
        for (let k = 0; k < 3; k++) this.pos[i * 3 + k] = this.restPos[i * 3 + k];
        continue;
      }
      parentQ.set(this.quat[p * 4], this.quat[p * 4 + 1], this.quat[p * 4 + 2], this.quat[p * 4 + 3]);
      offset.set(this.localPos[i * 3], this.localPos[i * 3 + 1], this.localPos[i * 3 + 2]).applyQuaternion(parentQ);
      this.pos[i * 3] = this.pos[p * 3] + offset.x;
      this.pos[i * 3 + 1] = this.pos[p * 3 + 1] + offset.y;
      this.pos[i * 3 + 2] = this.pos[p * 3 + 2] + offset.z;

      restLocal.set(
        this.localRestQuat[i * 4], this.localRestQuat[i * 4 + 1],
        this.localRestQuat[i * 4 + 2], this.localRestQuat[i * 4 + 3],
      );
      this.localUser(i, userQ);
      out.copy(parentQ).multiply(restLocal).multiply(userQ);
      this.quat[i * 4] = out.x;
      this.quat[i * 4 + 1] = out.y;
      this.quat[i * 4 + 2] = out.z;
      this.quat[i * 4 + 3] = out.w;
    }
  }

  nodePos(id: number, out = new Vector3()): Vector3 {
    return out.set(this.pos[id * 3], this.pos[id * 3 + 1], this.pos[id * 3 + 2]);
  }

  nodeQuat(id: number, out = new Quaternion()): Quaternion {
    return out.set(this.quat[id * 4], this.quat[id * 4 + 1], this.quat[id * 4 + 2], this.quat[id * 4 + 3]);
  }

  restNodePos(id: number, out = new Vector3()): Vector3 {
    return out.set(this.restPos[id * 3], this.restPos[id * 3 + 1], this.restPos[id * 3 + 2]);
  }

  /** Posed point = pos + quat * restQuat^-1 * (rest - restPos). */
  deformPoint(nodeId: number, x: number, y: number, z: number, out = new Vector3()): Vector3 {
    const q = this.nodeQuat(nodeId);
    const rq = new Quaternion(
      this.restQuat[nodeId * 4], this.restQuat[nodeId * 4 + 1],
      this.restQuat[nodeId * 4 + 2], this.restQuat[nodeId * 4 + 3],
    ).invert();
    out.set(
      x - this.restPos[nodeId * 3],
      y - this.restPos[nodeId * 3 + 1],
      z - this.restPos[nodeId * 3 + 2],
    ).applyQuaternion(rq).applyQuaternion(q);
    out.x += this.pos[nodeId * 3];
    out.y += this.pos[nodeId * 3 + 1];
    out.z += this.pos[nodeId * 3 + 2];
    return out;
  }

  deformDir(nodeId: number, x: number, y: number, z: number, out = new Vector3()): Vector3 {
    const q = this.nodeQuat(nodeId);
    const rq = new Quaternion(
      this.restQuat[nodeId * 4], this.restQuat[nodeId * 4 + 1],
      this.restQuat[nodeId * 4 + 2], this.restQuat[nodeId * 4 + 3],
    ).invert();
    return out.set(x, y, z).applyQuaternion(rq).applyQuaternion(q);
  }

  /** Handle for a control: the far end of the bone that control rotates. */
  handlePos(nodeId: number, out = new Vector3()): Vector3 {
    const child = this.firstChild[nodeId];
    if (child >= 0) return this.nodePos(child, out);
    return this.nodePos(nodeId, out);
  }

  restHandlePos(nodeId: number, out = new Vector3()): Vector3 {
    const child = this.firstChild[nodeId];
    if (child >= 0) return this.restNodePos(child, out);
    return this.restNodePos(nodeId, out);
  }

  /**
   * Rotate `nodeId` so its outgoing bone points at `target`. The bone keeps its length,
   * which is what makes dragging feel like pulling a branch rather than stretching it.
   */
  dragBend(nodeId: number, target: Vector3, maxDeg = 95): void {
    const p = this.parent[nodeId];
    if (p < 0) return;
    const parentQ = new Quaternion(this.quat[p * 4], this.quat[p * 4 + 1], this.quat[p * 4 + 2], this.quat[p * 4 + 3]);
    const restLocal = new Quaternion(
      this.localRestQuat[nodeId * 4], this.localRestQuat[nodeId * 4 + 1],
      this.localRestQuat[nodeId * 4 + 2], this.localRestQuat[nodeId * 4 + 3],
    );
    const A = parentQ.multiply(restLocal);
    const prevBend = this.bend.get(nodeId);
    const prevTwist = this.twist.get(nodeId) ?? 0;
    const user = new Quaternion();
    if (prevBend) user.copy(prevBend);
    if (prevTwist) user.multiply(new Quaternion().setFromAxisAngle(UP, prevTwist * DEG));

    const pivot = this.nodePos(nodeId);
    const current = this.tUp.clone().applyQuaternion(A.clone().multiply(user)).normalize();
    const desired = target.clone().sub(pivot);
    if (desired.lengthSq() < 1e-7) return;
    desired.normalize();
    const worldRot = new Quaternion().setFromUnitVectors(current, desired);
    const localRot = A.clone().invert().multiply(worldRot).multiply(A);
    const newBend = localRot.multiply(prevBend ?? new Quaternion());

    const angle = 2 * Math.acos(clamp(Math.abs(newBend.w), -1, 1));
    if (angle > maxDeg * DEG) {
      const axis = new Vector3(newBend.x, newBend.y, newBend.z);
      if (axis.lengthSq() < 1e-12) axis.set(1, 0, 0);
      axis.normalize();
      const sign = newBend.w < 0 ? -1 : 1;
      newBend.setFromAxisAngle(axis, (sign * maxDeg * DEG) / 2);
    }
    this.bend.set(nodeId, newBend.normalize());
    this.evaluate();
  }

  // ---- Mass -------------------------------------------------------------

  /** Mass-weighted centre of the visible wood; radii drive the per-segment volume. */
  woodMass(density = 1): { mass: number; com: Vector3; perSegment: Float32Array } {
    const n = this.skel.nodes.length;
    const per = new Float32Array(n);
    const com = new Vector3();
    let total = 0;
    const a = new Vector3();
    const b = new Vector3();
    for (let i = 0; i < n; i++) {
      const node = this.skel.nodes[i];
      if (node.parent < 0 || !this.visible[i] || !this.visible[node.parent]) continue;
      this.nodePos(i, b);
      this.nodePos(node.parent, a);
      const len = a.distanceTo(b);
      const r1 = this.skel.nodes[node.parent].radius;
      const r2 = node.radius;
      const vol = (Math.PI * len * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
      const m = vol * density;
      per[i] = m;
      total += m;
      com.addScaledVector(a.clone().add(b).multiplyScalar(0.5), m);
    }
    if (total > 0) com.divideScalar(total);
    return { mass: total, com, perSegment: per };
  }

  basePos(out = new Vector3()): Vector3 {
    return this.nodePos(0, out);
  }

  /** Stable ordering: nodes evaluate parent-first. */
  get nodeCount(): number {
    return this.skel.nodes.length;
  }
}

