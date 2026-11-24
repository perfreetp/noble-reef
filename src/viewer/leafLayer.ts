import {
  BufferAttribute,
  InstancedBufferAttribute,
  BufferGeometry,
  Color,
  SRGBColorSpace,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { FoliageData, FoliageParams } from '../core/types';
import type { TreeRig } from '../core/pose';
import { leafGeometryArrays } from '../core/foliage';

function leafGeometry(): BufferGeometry {
  const { positions, indices } = leafGeometryArrays();
  const geo = new BufferGeometry();
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    // Flat normal per triangle: cheap and reads well on a small leaf.
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      normals[i + k * 3] = nx;
      normals[i + k * 3 + 1] = ny;
      normals[i + k * 3 + 2] = nz;
    }
  }
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * One instanced draw call for the whole canopy. Leaves are re-sorted back-to-front
 * against the camera every time either the pose or the camera changes, which is what
 * keeps the semi-transparent layers from tearing into each other where pads overlap.
 */
export class LeafLayer {
  readonly mesh: InstancedMesh;
  readonly material: MeshStandardMaterial;
  private data: FoliageData = { leaves: [], byDepth: {} };
  private rig: TreeRig | null = null;
  private worldPos: Float32Array = new Float32Array(0);
  private worldMat: Matrix4[] = [];
  private order: Uint32Array = new Uint32Array(0);
  private depth: Float32Array = new Float32Array(0);
  private capacity = 0;
  private dirty = true;
  private needsSort = true;
  private readonly tmpQ = new Quaternion();
  private readonly tmpQ2 = new Quaternion();
  private readonly tmpM = new Matrix4();
  private readonly tmpS = new Vector3();
  private readonly tmpP = new Vector3();
  sortMs = 0;
  updateMs = 0;

  constructor(maxLeaves = 4000) {
    this.material = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.66,
      metalness: 0,
      transparent: true,
      opacity: 0.86,
      side: 2,
      depthWrite: false,
      alphaTest: 0.02,
    });
    this.mesh = new InstancedMesh(leafGeometry(), this.material, maxLeaves);
    this.mesh.instanceMatrix.setUsage(35048); // DynamicDrawUsage
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.capacity = maxLeaves;
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(maxLeaves * 3), 3);
  }

  setFoliage(data: FoliageData, rig: TreeRig, params: FoliageParams): void {
    this.data = data;
    this.rig = rig;
    const n = data.leaves.length;
    this.mesh.count = Math.min(n, this.capacity);
    if (this.worldPos.length < n * 3) this.worldPos = new Float32Array(n * 3);
    if (this.order.length < n) {
      this.order = new Uint32Array(n);
      this.depth = new Float32Array(n);
    }
    while (this.worldMat.length < n) this.worldMat.push(new Matrix4());
    this.applyParams(params);
    this.dirty = true;
    this.needsSort = true;
  }


  private inspectFade = false;
  private baseOpacity = 0.86;

  applyParams(params: FoliageParams): void {
    this.baseOpacity = params.opacity;
    this.material.opacity = params.opacity * (this.inspectFade ? 0.5 : 1);
    const base = new Color();
    const leaves = this.mesh.instanceColor;
    if (!leaves) return;
    const colors = leaves.array as Float32Array;
    const n = Math.min(this.mesh.count, this.data.leaves.length);
    for (let i = 0; i < n; i++) {
      const leaf = this.data.leaves[i];
      // Vary hue slightly around the base and let older pads (deeper order) sit a touch
      // darker, which is what gives a canopy depth instead of one flat green.
      const hueShift = (leaf.tone - 0.5) * 0.06 - (leaf.depth - 2) * 0.008;
      const sat = 0.38 + leaf.tone * 0.26;
      const light = 0.17 + leaf.tone * 0.13 + (leaf.depth === 1 ? 0.04 : leaf.depth === 2 ? 0.018 : 0);
      base.setHSL((params.hue + hueShift + 1) % 1, sat, light, SRGBColorSpace);
      colors[i * 3] = base.r;
      colors[i * 3 + 1] = base.g;
      colors[i * 3 + 2] = base.b;
    }
    leaves.needsUpdate = true;
  }

  /** Pose changed: recompute world transforms. */
  markDirty(): void {
    this.dirty = true;
    this.needsSort = true;
  }

  /** Camera moved: transforms stay, only the draw order changes. */
  markNeedsSort(): void {
    this.needsSort = true;
  }

  update(cameraPos: Vector3, force = false): void {
    if (!this.rig || !this.mesh.count) return;
    const t0 = performance.now();
    if (this.dirty) {
      this.rebuildWorld();
      this.dirty = false;
    }
    const t1 = performance.now();
    this.updateMs = t1 - t0;
    if (this.needsSort || force) {
      this.resort(cameraPos);
      this.needsSort = false;
    }
    this.sortMs = performance.now() - t1;
  }

  private rebuildWorld(): void {
    const rig = this.rig!;
    const leaves = this.data.leaves;
    const n = Math.min(leaves.length, this.capacity);
    const p = this.tmpP;
    const pose = new Quaternion();
    const restQuat = new Quaternion();
    const delta = new Quaternion();
    for (let i = 0; i < n; i++) {
      const leaf = leaves[i];
      rig.deformPoint(leaf.node, leaf.offset[0], leaf.offset[1], leaf.offset[2], p);
      rig.nodeQuat(leaf.node, pose);
      restQuat.set(
        rig.restQuat[leaf.node * 4], rig.restQuat[leaf.node * 4 + 1],
        rig.restQuat[leaf.node * 4 + 2], rig.restQuat[leaf.node * 4 + 3],
      );
      delta.copy(pose).multiply(restQuat.invert()).multiply(this.tmpQ.set(...leaf.quat));
      this.tmpS.set(leaf.size, leaf.size, leaf.size);
      this.tmpM.compose(p, delta, this.tmpS);
      this.worldMat[i].copy(this.tmpM);
      this.worldPos[i * 3] = p.x;
      this.worldPos[i * 3 + 1] = p.y;
      this.worldPos[i * 3 + 2] = p.z;
      this.order[i] = i;
    }
  }

  private resort(cameraPos: Vector3): void {
    const n = Math.min(this.data.leaves.length, this.capacity);
    const w = this.worldPos;
    const camX = cameraPos.x;
    const camY = cameraPos.y;
    const camZ = cameraPos.z;
    for (let i = 0; i < n; i++) {
      const dx = w[i * 3] - camX;
      const dy = w[i * 3 + 1] - camY;
      const dz = w[i * 3 + 2] - camZ;
      this.depth[i] = dx * dx + dy * dy + dz * dz;
    }
    // Farthest first => back-to-front blending for a transparent material.
    const order = this.order.subarray(0, n);
    const depth = this.depth;
    const arr = Array.from(order);
    arr.sort((a, b) => depth[b] - depth[a]);
    const buf = this.mesh.instanceMatrix.array as Float32Array;
    const wm = this.worldMat;
    for (let i = 0; i < n; i++) {
      const src = wm[arr[i]].elements;
      const off = i * 16;
      buf[off] = src[0]; buf[off + 1] = src[1]; buf[off + 2] = src[2]; buf[off + 3] = src[3];
      buf[off + 4] = src[4]; buf[off + 5] = src[5]; buf[off + 6] = src[6]; buf[off + 7] = src[7];
      buf[off + 8] = src[8]; buf[off + 9] = src[9]; buf[off + 10] = src[10]; buf[off + 11] = src[11];
      buf[off + 12] = src[12]; buf[off + 13] = src[13]; buf[off + 14] = src[14]; buf[off + 15] = src[15];
      order[i] = arr[i];
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Inspect mode thins the canopy so the balance diagram behind it stays readable. */
  setInspectFade(on: boolean): void {
    this.inspectFade = on;
    this.material.opacity = Math.min(1, this.baseOpacity * (on ? 0.5 : 1));
    this.material.needsUpdate = true;
  }


  get needsSortFlag(): boolean {
    return this.needsSort;
  }

  get count(): number {
    return this.mesh.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
