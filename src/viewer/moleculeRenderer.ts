import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { ColorScheme, DisplayMode, Molecule } from "../chem/types";
import { getElement } from "../chem/elements";
import { quatFromUnitVectorsToRef } from "./mathUtils";

/** 每个实例缓冲批次的最大实例数：实例缓冲分批上传 GPU，避免单次大块上传造成卡顿 */
export const BATCH_SIZE = 8192;

const BALL_SCALE = 0.45; // 球棍模式球半径 = 共价半径 * 0.45
const MIN_BALL = 0.2;
const BOND_RADIUS = [0, 0.11, 0.19, 0.27]; // 单/双/三键半径（Å），用粗细区分键级
const HIGHLIGHT: [number, number, number] = [1.0, 0.6, 0.1];
const CAP_EPS = 0.004; // 封口圆盘沿保留侧法线的微小偏移，避免 z-fighting

export interface ClipPlaneInfo {
  nx: number; ny: number; nz: number; d: number; // 保留 dot(n, p) >= d 的一侧
}

export interface AtomBondInfo {
  index: number;
  element: string;
  order: number;
  length: number;
}

export interface AtomInfo {
  index: number;
  element: string;
  x: number; y: number; z: number;
  bonds: AtomBondInfo[];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.8, 0.8, 0.8];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** 手写 TRS 组合（行向量约定，平移在第 4 行），避免频繁分配 Matrix 对象 */
function composeTRS(
  buf: Float32Array, off: number,
  sx: number, sy: number, sz: number,
  qx: number, qy: number, qz: number, qw: number,
  tx: number, ty: number, tz: number,
): void {
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  buf[off] = (1 - (yy + zz)) * sx;
  buf[off + 1] = (xy + wz) * sx;
  buf[off + 2] = (xz - wy) * sx;
  buf[off + 3] = 0;
  buf[off + 4] = (xy - wz) * sy;
  buf[off + 5] = (1 - (xx + zz)) * sy;
  buf[off + 6] = (yz + wx) * sy;
  buf[off + 7] = 0;
  buf[off + 8] = (xz + wy) * sz;
  buf[off + 9] = (yz - wx) * sz;
  buf[off + 10] = (1 - (xx + yy)) * sz;
  buf[off + 11] = 0;
  buf[off + 12] = tx;
  buf[off + 13] = ty;
  buf[off + 14] = tz;
  buf[off + 15] = 1;
}

function writeBallMatrix(buf: Float32Array, off: number, x: number, y: number, z: number, r: number): void {
  buf[off] = r; buf[off + 1] = 0; buf[off + 2] = 0; buf[off + 3] = 0;
  buf[off + 4] = 0; buf[off + 5] = r; buf[off + 6] = 0; buf[off + 7] = 0;
  buf[off + 8] = 0; buf[off + 9] = 0; buf[off + 10] = r; buf[off + 11] = 0;
  buf[off + 12] = x; buf[off + 13] = y; buf[off + 14] = z; buf[off + 15] = 1;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * 单个分子的渲染器：
 * - 原子球：按元素种类排序后分批做 thin-instance 实例化（减少状态切换）
 * - 化学键：圆柱实例化，单/双/三键不同粗细
 * - 剖切：跨平面键截断重建 + 截面封口圆盘
 */
export class MoleculeRenderer {
  readonly molecule: Molecule;
  private scene: Scene;
  private node: TransformNode;
  private displayMode: DisplayMode = "ballstick";
  private colorScheme: ColorScheme = { type: "cpk" };

  // 排序后的实例数据
  private atomOrder!: Int32Array;      // 排序位置 -> 原子索引（按元素种类排序）
  private atomToSorted!: Int32Array;   // 原子索引 -> 排序位置
  private atomPos!: Float32Array;      // 每原子 xyz
  private atomRadius!: Float32Array;   // 每原子当前显示半径
  private atomMatrices!: Float32Array; // 排序顺序
  private atomBaseColor!: Float32Array;// 每原子 rgb（原子索引顺序）
  private atomColors!: Float32Array;   // 排序顺序 rgba（含高亮）

  private bondSorted!: Int32Array;     // 排序位置 -> 键索引（按键级排序）
  private bondMatrices!: Float32Array;
  private bondBaseColor!: Float32Array;
  private bondColors!: Float32Array;
  private atomBonds: number[][] = [];  // 原子 -> 关联键索引

  private atomBatchMeshes: Mesh[] = [];
  private bondBatchMeshes: Mesh[] = [];
  private capAtomMesh: Mesh | null = null;
  private capBondMesh: Mesh | null = null;
  private hbondMesh: LinesMesh | null = null;

  private atomMat!: StandardMaterial;
  private bondMat!: StandardMaterial;
  private capMat!: StandardMaterial;

  private clip: ClipPlaneInfo | null = null;
  private highlighted: { atom: number; bonds: number[] } | null = null;

  constructor(scene: Scene, molecule: Molecule) {
    this.scene = scene;
    this.molecule = molecule;
    this.node = new TransformNode(`mol_${molecule.id}`, scene);
    this.prepareData();
  }

  // ---------------------------------------------------------------- 数据准备

  private prepareData(): void {
    const { atoms, bonds } = this.molecule;
    const n = atoms.length;

    this.atomPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.atomPos[i * 3] = atoms[i].x;
      this.atomPos[i * 3 + 1] = atoms[i].y;
      this.atomPos[i * 3 + 2] = atoms[i].z;
    }

    // 按元素种类排序实例，同种元素连续排布，减少渲染状态切换
    const order = Array.from({ length: n }, (_, i) => i);
    order.sort((a, b) => (atoms[a].element < atoms[b].element ? -1 : atoms[a].element > atoms[b].element ? 1 : 0));
    this.atomOrder = Int32Array.from(order);
    this.atomToSorted = new Int32Array(n);
    for (let k = 0; k < n; k++) this.atomToSorted[this.atomOrder[k]] = k;

    this.atomRadius = new Float32Array(n);
    this.atomMatrices = new Float32Array(n * 16);
    this.atomBaseColor = new Float32Array(n * 3);
    this.atomColors = new Float32Array(n * 4);

    // 键按键级排序
    const nb = bonds.length;
    const bOrder = Array.from({ length: nb }, (_, i) => i);
    bOrder.sort((a, b) => bonds[a].order - bonds[b].order);
    this.bondSorted = Int32Array.from(bOrder);
    this.bondMatrices = new Float32Array(nb * 16);
    this.bondBaseColor = new Float32Array(nb * 3);
    this.bondColors = new Float32Array(nb * 4);

    this.atomBonds = Array.from({ length: n }, () => []);
    bonds.forEach((b, i) => {
      this.atomBonds[b.a].push(i);
      this.atomBonds[b.b].push(i);
    });

    this.updateRadii();
    this.recomputeBaseColors();
  }

  private updateRadii(): void {
    const atoms = this.molecule.atoms;
    for (let i = 0; i < atoms.length; i++) {
      const el = getElement(atoms[i].element);
      this.atomRadius[i] =
        this.displayMode === "spacefill" ? el.vdw : Math.max(MIN_BALL, el.covalent * BALL_SCALE);
    }
  }

  private recomputeBaseColors(): void {
    const atoms = this.molecule.atoms;
    const custom = this.colorScheme.type === "custom" ? hexToRgb(this.colorScheme.color) : null;
    for (let i = 0; i < atoms.length; i++) {
      const c = custom ?? getElement(atoms[i].element).color;
      this.atomBaseColor[i * 3] = c[0];
      this.atomBaseColor[i * 3 + 1] = c[1];
      this.atomBaseColor[i * 3 + 2] = c[2];
    }
    // 键颜色：两端原子颜色的均值调暗
    const bonds = this.molecule.bonds;
    for (let bi = 0; bi < bonds.length; bi++) {
      const a = bonds[bi].a * 3;
      const b = bonds[bi].b * 3;
      this.bondBaseColor[bi * 3] = (this.atomBaseColor[a] + this.atomBaseColor[b]) * 0.5 * 0.55;
      this.bondBaseColor[bi * 3 + 1] = (this.atomBaseColor[a + 1] + this.atomBaseColor[b + 1]) * 0.5 * 0.55;
      this.bondBaseColor[bi * 3 + 2] = (this.atomBaseColor[a + 2] + this.atomBaseColor[b + 2]) * 0.5 * 0.55;
    }
    // 重置当前颜色缓冲（清掉高亮）
    this.highlighted = null;
    for (let k = 0; k < atoms.length; k++) {
      const i = this.atomOrder[k];
      this.atomColors[k * 4] = this.atomBaseColor[i * 3];
      this.atomColors[k * 4 + 1] = this.atomBaseColor[i * 3 + 1];
      this.atomColors[k * 4 + 2] = this.atomBaseColor[i * 3 + 2];
      this.atomColors[k * 4 + 3] = 1;
    }
    for (let k = 0; k < bonds.length; k++) {
      const bi = this.bondSorted[k];
      this.bondColors[k * 4] = this.bondBaseColor[bi * 3];
      this.bondColors[k * 4 + 1] = this.bondBaseColor[bi * 3 + 1];
      this.bondColors[k * 4 + 2] = this.bondBaseColor[bi * 3 + 2];
      this.bondColors[k * 4 + 3] = 1;
    }
  }

  // ---------------------------------------------------------------- 构建

  async build(): Promise<void> {
    const n = this.molecule.atoms.length;
    const nb = this.molecule.bonds.length;

    this.atomMat = new StandardMaterial(`atomMat_${this.molecule.id}`, this.scene);
    this.atomMat.specularColor = new Color3(0.22, 0.22, 0.22);
    this.bondMat = new StandardMaterial(`bondMat_${this.molecule.id}`, this.scene);
    this.bondMat.specularColor = new Color3(0.15, 0.15, 0.15);
    this.capMat = new StandardMaterial(`capMat_${this.molecule.id}`, this.scene);
    this.capMat.backFaceCulling = false;
    this.capMat.specularColor = new Color3(0.05, 0.05, 0.05);

    // 模板网格（不直接渲染，仅作为几何来源）
    const sphereSrc = MeshBuilder.CreateSphere(`sphereSrc_${this.molecule.id}`, { diameter: 2, segments: 12 }, this.scene);
    sphereSrc.material = this.atomMat;
    sphereSrc.setEnabled(false);
    const cylSrc = MeshBuilder.CreateCylinder(`cylSrc_${this.molecule.id}`, { height: 1, diameter: 2, tessellation: 12 }, this.scene);
    cylSrc.material = this.bondMat;
    cylSrc.setEnabled(false);

    this.buildAtomMatrices();

    // 原子批次：分批创建并上传实例缓冲，批间让出主线程保持界面响应
    for (let s = 0; s < n; s += BATCH_SIZE) {
      const e = Math.min(s + BATCH_SIZE, n);
      const mesh = sphereSrc.clone(`atoms_${this.molecule.id}_${s}`);
      mesh.parent = this.node;
      mesh.setEnabled(true);
      mesh.isPickable = true;
      mesh.thinInstanceEnablePicking = true;
      mesh.metadata = { renderer: this, kind: "atom", offset: s };
      mesh.thinInstanceSetBuffer("matrix", this.atomMatrices.subarray(s * 16, e * 16), 16, true);
      mesh.thinInstanceSetBuffer("color", this.atomColors.subarray(s * 4, e * 4), 4, false);
      this.atomBatchMeshes.push(mesh);
      await nextFrame();
    }

    this.buildBondMatrices();

    for (let s = 0; s < nb; s += BATCH_SIZE) {
      const e = Math.min(s + BATCH_SIZE, nb);
      const mesh = cylSrc.clone(`bonds_${this.molecule.id}_${s}`);
      mesh.parent = this.node;
      mesh.setEnabled(true);
      mesh.isPickable = false;
      mesh.metadata = { renderer: this, kind: "bond", offset: s };
      mesh.thinInstanceSetBuffer("matrix", this.bondMatrices.subarray(s * 16, e * 16), 16, true);
      mesh.thinInstanceSetBuffer("color", this.bondColors.subarray(s * 4, e * 4), 4, false);
      this.bondBatchMeshes.push(mesh);
      await nextFrame();
    }

    sphereSrc.dispose();
    cylSrc.dispose();
  }

  private buildAtomMatrices(): void {
    const n = this.molecule.atoms.length;
    for (let k = 0; k < n; k++) {
      const i = this.atomOrder[k];
      writeBallMatrix(
        this.atomMatrices, k * 16,
        this.atomPos[i * 3], this.atomPos[i * 3 + 1], this.atomPos[i * 3 + 2],
        this.atomRadius[i],
      );
    }
  }

  private buildBondMatrices(): void {
    const bonds = this.molecule.bonds;
    const clip = this.clip;
    const q = new Quaternion(0, 0, 0, 1);
    for (let k = 0; k < bonds.length; k++) {
      const bi = this.bondSorted[k];
      const b = bonds[bi];
      const ai = b.a * 3;
      const bj = b.b * 3;
      let x0 = this.atomPos[ai], y0 = this.atomPos[ai + 1], z0 = this.atomPos[ai + 2];
      let x1 = this.atomPos[bj], y1 = this.atomPos[bj + 1], z1 = this.atomPos[bj + 2];
      let hidden = false;

      if (clip) {
        // 跨平面键截断重建：只保留 dot(n,p) >= d 的一侧
        const sa = clip.nx * x0 + clip.ny * y0 + clip.nz * z0 - clip.d;
        const sb = clip.nx * x1 + clip.ny * y1 + clip.nz * z1 - clip.d;
        if (sa < 0 && sb < 0) {
          hidden = true;
        } else if (sa < 0) {
          // a 端被裁掉：把 a 端收缩到平面交点
          const t = sb / (sb - sa);
          x0 = x1 + (x0 - x1) * t; y0 = y1 + (y0 - y1) * t; z0 = z1 + (z0 - z1) * t;
        } else if (sb < 0) {
          const t = sa / (sa - sb);
          x1 = x0 + (x1 - x0) * t; y1 = y0 + (y1 - y0) * t; z1 = z0 + (z1 - z0) * t;
        }
      }

      const off = k * 16;
      if (hidden) {
        writeBallMatrix(this.bondMatrices, off, 0, -1e6, 0, 0.00001);
        continue;
      }
      let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) {
        writeBallMatrix(this.bondMatrices, off, 0, -1e6, 0, 0.00001);
        continue;
      }
      dx /= len; dy /= len; dz /= len;
      quatFromUnitVectorsToRef(0, 1, 0, dx, dy, dz, q);
      const r = BOND_RADIUS[Math.min(3, Math.max(1, b.order))];
      composeTRS(
        this.bondMatrices, off,
        r, len, r,
        q.x, q.y, q.z, q.w,
        (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2,
      );
    }
  }

  // ---------------------------------------------------------------- 剖切

  /** 更新剖切平面：重建跨平面键，并生成截面封口 */
  updateClip(clip: ClipPlaneInfo | null): void {
    this.clip = clip;
    this.buildBondMatrices();
    for (let s = 0; s < this.bondBatchMeshes.length; s++) {
      const start = s * BATCH_SIZE;
      const e = Math.min(start + BATCH_SIZE, this.molecule.bonds.length);
      this.bondBatchMeshes[s].thinInstanceSetBuffer("matrix", this.bondMatrices.subarray(start * 16, e * 16), 16, true);
    }
    this.rebuildCaps();
  }

  private rebuildCaps(): void {
    const clip = this.clip;
    if (!clip) {
      if (this.capAtomMesh) this.capAtomMesh.setEnabled(false);
      if (this.capBondMesh) this.capBondMesh.setEnabled(false);
      return;
    }
    const { nx, ny, nz, d } = clip;
    const n = this.molecule.atoms.length;

    // 原子球截面：|sd| < r 时在平面上放圆盘封口
    const capMat4 = new Float32Array(n * 16);
    const capCol = new Float32Array(n * 4);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const x = this.atomPos[i * 3], y = this.atomPos[i * 3 + 1], z = this.atomPos[i * 3 + 2];
      const sd = nx * x + ny * y + nz * z - d;
      const r = this.atomRadius[i];
      if (Math.abs(sd) >= r) continue;
      const cr = Math.sqrt(r * r - sd * sd);
      const off = count * 16;
      // 圆盘在 XY 平面、法线 +Z，缩放到 (cr, cr, 1) 并朝向剖切面法线
      const q = capQuat(nx, ny, nz);
      composeTRS(capMat4, off, cr, cr, 1, q.x, q.y, q.z, q.w,
        x - nx * sd + nx * CAP_EPS, y - ny * sd + ny * CAP_EPS, z - nz * sd + nz * CAP_EPS);
      capCol[count * 4] = this.atomBaseColor[i * 3] * 0.8;
      capCol[count * 4 + 1] = this.atomBaseColor[i * 3 + 1] * 0.8;
      capCol[count * 4 + 2] = this.atomBaseColor[i * 3 + 2] * 0.8;
      capCol[count * 4 + 3] = 1;
      count++;
    }
    this.uploadCaps("atom", capMat4, capCol, count);

    // 跨平面键的截面封口
    const bonds = this.molecule.bonds;
    const nb = bonds.length;
    const capBMat = new Float32Array(nb * 16);
    const capBCol = new Float32Array(nb * 4);
    let bcount = 0;
    for (let bi = 0; bi < nb; bi++) {
      const b = bonds[bi];
      const ai = b.a * 3, bj = b.b * 3;
      const x0 = this.atomPos[ai], y0 = this.atomPos[ai + 1], z0 = this.atomPos[ai + 2];
      const x1 = this.atomPos[bj], y1 = this.atomPos[bj + 1], z1 = this.atomPos[bj + 2];
      const sa = nx * x0 + ny * y0 + nz * z0 - d;
      const sb = nx * x1 + ny * y1 + nz * z1 - d;
      if ((sa >= 0 && sb >= 0) || (sa < 0 && sb < 0)) continue;
      const t = sa / (sa - sb);
      const cxp = x0 + (x1 - x0) * t + nx * CAP_EPS;
      const cyp = y0 + (y1 - y0) * t + ny * CAP_EPS;
      const czp = z0 + (z1 - z0) * t + nz * CAP_EPS;
      const r = BOND_RADIUS[Math.min(3, Math.max(1, b.order))] * 1.02;
      const q = capQuat(nx, ny, nz);
      composeTRS(capBMat, bcount * 16, r, r, 1, q.x, q.y, q.z, q.w, cxp, cyp, czp);
      capBCol[bcount * 4] = Math.min(1, this.bondBaseColor[bi * 3] * 1.6 + 0.1);
      capBCol[bcount * 4 + 1] = Math.min(1, this.bondBaseColor[bi * 3 + 1] * 1.6 + 0.1);
      capBCol[bcount * 4 + 2] = Math.min(1, this.bondBaseColor[bi * 3 + 2] * 1.6 + 0.1);
      capBCol[bcount * 4 + 3] = 1;
      bcount++;
    }
    this.uploadCaps("bond", capBMat, capBCol, bcount);
  }

  private uploadCaps(kind: "atom" | "bond", mats: Float32Array, cols: Float32Array, count: number): void {
    let mesh = kind === "atom" ? this.capAtomMesh : this.capBondMesh;
    if (count === 0) {
      if (mesh) mesh.setEnabled(false);
      return;
    }
    if (!mesh) {
      const disc = MeshBuilder.CreateDisc(`capSrc_${this.molecule.id}_${kind}`, { radius: 1, tessellation: 24 }, this.scene);
      disc.material = this.capMat;
      disc.parent = this.node;
      disc.isPickable = false;
      if (kind === "atom") this.capAtomMesh = disc;
      else this.capBondMesh = disc;
      mesh = disc;
    }
    mesh.setEnabled(true);
    mesh.thinInstanceSetBuffer("matrix", mats.subarray(0, count * 16), 16, false);
    mesh.thinInstanceSetBuffer("color", cols.subarray(0, count * 4), 4, false);
  }

  // ---------------------------------------------------------------- 氢键

  /** 用一条 LineSystem 画所有氢键虚线（手工切分 dash，避免每条键一个网格） */
  setHBonds(pairs: Array<[number, number]> | null): void {
    if (this.hbondMesh) {
      this.hbondMesh.dispose();
      this.hbondMesh = null;
    }
    if (!pairs || pairs.length === 0) return;
    const dash = 0.14, gap = 0.09;
    const lines: Vector3[][] = [];
    for (const [a, b] of pairs) {
      const ax = this.atomPos[a * 3], ay = this.atomPos[a * 3 + 1], az = this.atomPos[a * 3 + 2];
      const bx = this.atomPos[b * 3], by = this.atomPos[b * 3 + 1], bz = this.atomPos[b * 3 + 2];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) continue;
      const step = dash + gap;
      for (let s = 0; s < len; s += step) {
        const e = Math.min(s + dash, len);
        const t0 = s / len, t1 = e / len;
        lines.push([
          new Vector3(ax + dx * t0, ay + dy * t0, az + dz * t0),
          new Vector3(ax + dx * t1, ay + dy * t1, az + dz * t1),
        ]);
      }
    }
    if (lines.length === 0) return;
    const mesh = MeshBuilder.CreateLineSystem(`hbonds_${this.molecule.id}`, { lines }, this.scene);
    mesh.color = new Color3(0.35, 0.9, 1.0);
    mesh.alpha = 0.9;
    mesh.isPickable = false;
    mesh.parent = this.node;
    this.hbondMesh = mesh;
  }

  // ---------------------------------------------------------------- 外观设置

  setDisplayMode(mode: DisplayMode): void {
    if (this.displayMode === mode) return;
    this.displayMode = mode;
    this.updateRadii();
    this.buildAtomMatrices();
    const n = this.molecule.atoms.length;
    for (let s = 0; s < this.atomBatchMeshes.length; s++) {
      const start = s * BATCH_SIZE;
      const e = Math.min(start + BATCH_SIZE, n);
      this.atomBatchMeshes[s].thinInstanceSetBuffer("matrix", this.atomMatrices.subarray(start * 16, e * 16), 16, true);
    }
    const bondsVisible = mode === "ballstick";
    for (const m of this.bondBatchMeshes) m.setEnabled(bondsVisible);
    if (this.clip) this.rebuildCaps();
  }

  setColorScheme(scheme: ColorScheme): void {
    this.colorScheme = scheme;
    this.recomputeBaseColors();
    this.uploadAllColors();
    if (this.clip) this.rebuildCaps();
  }

  private uploadAllColors(): void {
    const n = this.molecule.atoms.length;
    for (let s = 0; s < this.atomBatchMeshes.length; s++) {
      const start = s * BATCH_SIZE;
      const e = Math.min(start + BATCH_SIZE, n);
      this.atomBatchMeshes[s].thinInstanceSetBuffer("color", this.atomColors.subarray(start * 4, e * 4), 4, false);
    }
    const nb = this.molecule.bonds.length;
    for (let s = 0; s < this.bondBatchMeshes.length; s++) {
      const start = s * BATCH_SIZE;
      const e = Math.min(start + BATCH_SIZE, nb);
      this.bondBatchMeshes[s].thinInstanceSetBuffer("color", this.bondColors.subarray(start * 4, e * 4), 4, false);
    }
  }

  setVisible(v: boolean): void {
    this.node.setEnabled(v);
  }

  // ---------------------------------------------------------------- 拾取高亮

  /** 高亮原子及其相邻键；返回原子信息用于面板显示 */
  setHighlight(atomIndex: number | null): AtomInfo | null {
    // 先恢复旧高亮
    if (this.highlighted) {
      const prev = this.highlighted;
      const k = this.atomToSorted[prev.atom];
      this.atomColors[k * 4] = this.atomBaseColor[prev.atom * 3];
      this.atomColors[k * 4 + 1] = this.atomBaseColor[prev.atom * 3 + 1];
      this.atomColors[k * 4 + 2] = this.atomBaseColor[prev.atom * 3 + 2];
      for (const bi of prev.bonds) {
        const sk = this.sortedBondPos(bi);
        this.bondColors[sk * 4] = this.bondBaseColor[bi * 3];
        this.bondColors[sk * 4 + 1] = this.bondBaseColor[bi * 3 + 1];
        this.bondColors[sk * 4 + 2] = this.bondBaseColor[bi * 3 + 2];
      }
      this.highlighted = null;
    }
    if (atomIndex === null) {
      this.uploadAllColors();
      return null;
    }
    const k = this.atomToSorted[atomIndex];
    this.atomColors[k * 4] = HIGHLIGHT[0];
    this.atomColors[k * 4 + 1] = HIGHLIGHT[1];
    this.atomColors[k * 4 + 2] = HIGHLIGHT[2];
    const bondIdxs = this.atomBonds[atomIndex];
    for (const bi of bondIdxs) {
      const sk = this.sortedBondPos(bi);
      this.bondColors[sk * 4] = HIGHLIGHT[0];
      this.bondColors[sk * 4 + 1] = HIGHLIGHT[1];
      this.bondColors[sk * 4 + 2] = HIGHLIGHT[2];
    }
    this.highlighted = { atom: atomIndex, bonds: [...bondIdxs] };
    this.uploadAllColors();
    return this.getAtomInfo(atomIndex);
  }

  private bondPosCache: Int32Array | null = null;
  private sortedBondPos(bondIndex: number): number {
    if (!this.bondPosCache) {
      this.bondPosCache = new Int32Array(this.molecule.bonds.length);
      for (let k = 0; k < this.bondSorted.length; k++) this.bondPosCache[this.bondSorted[k]] = k;
    }
    return this.bondPosCache[bondIndex];
  }

  getAtomInfo(atomIndex: number): AtomInfo {
    const atoms = this.molecule.atoms;
    const a = atoms[atomIndex];
    const bonds: AtomBondInfo[] = this.atomBonds[atomIndex].map((bi) => {
      const b = this.molecule.bonds[bi];
      const other = b.a === atomIndex ? b.b : b.a;
      const o = atoms[other];
      const dx = a.x - o.x, dy = a.y - o.y, dz = a.z - o.z;
      return {
        index: other,
        element: o.element,
        order: b.order,
        length: Math.sqrt(dx * dx + dy * dy + dz * dz),
      };
    });
    return { index: atomIndex, element: a.element, x: a.x, y: a.y, z: a.z, bonds };
  }

  /** 拾取结果 -> 原子索引 */
  atomIndexFromPick(mesh: Mesh, thinInstanceIndex: number): number | null {
    const meta = mesh.metadata;
    if (!meta || meta.renderer !== this || meta.kind !== "atom") return null;
    const sorted = meta.offset + thinInstanceIndex;
    if (sorted < 0 || sorted >= this.atomOrder.length) return null;
    return this.atomOrder[sorted];
  }

  isAtomBatch(mesh: Mesh): boolean {
    return !!mesh.metadata && mesh.metadata.renderer === this && mesh.metadata.kind === "atom";
  }

  // ---------------------------------------------------------------- 清理

  dispose(): void {
    for (const m of this.atomBatchMeshes) m.dispose();
    for (const m of this.bondBatchMeshes) m.dispose();
    this.capAtomMesh?.dispose();
    this.capBondMesh?.dispose();
    this.hbondMesh?.dispose();
    this.atomMat?.dispose();
    this.bondMat?.dispose();
    this.capMat?.dispose();
    this.node.dispose();
  }
}

const _capQ = new Quaternion(0, 0, 0, 1);
function capQuat(nx: number, ny: number, nz: number): Quaternion {
  return quatFromUnitVectorsToRef(0, 0, 1, nx, ny, nz, _capQ);
}
