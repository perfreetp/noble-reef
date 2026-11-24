import { CELL_SIZE, GRID_SIZE } from '../../config/constants';
import { bilinearSample, clamp } from '../../util/math';
import type { DirtyRect } from '../../util/dirtyRect';

/**
 * 高度场核心模型：行优先 Float32Array，idx = gy * size + gx。
 * 世界坐标原点在地形中心，x 向右、z 向屏幕下方（与 PlaneGeometry rotateX 后一致）。
 */
export class TerrainModel {
  readonly size: number;
  readonly cellSize: number;
  readonly heights: Float32Array;
  /** 顶点法线（xyz 交错），长度 size*size*3 */
  readonly normals: Float32Array;

  constructor(size = GRID_SIZE, cellSize = CELL_SIZE, heights?: Float32Array) {
    this.size = size;
    this.cellSize = cellSize;
    this.heights = heights ?? new Float32Array(size * size);
    if (this.heights.length !== size * size) {
      throw new Error(`高度场长度应为 ${size * size}，实际 ${this.heights.length}`);
    }
    this.normals = new Float32Array(size * size * 3);
    this.recomputeNormals();
  }

  idx(gx: number, gy: number): number {
    return gy * this.size + gx;
  }

  inBounds(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.size && gy < this.size;
  }

  /** 边界钳制读取 */
  getClamped(gx: number, gy: number): number {
    const x = clamp(gx, 0, this.size - 1);
    const y = clamp(gy, 0, this.size - 1);
    return this.heights[this.idx(x, y)]!;
  }

  worldToGrid(wx: number, wz: number): { gx: number; gy: number } {
    const half = (this.size - 1) / 2;
    return { gx: wx / this.cellSize + half, gy: wz / this.cellSize + half };
  }

  gridToWorld(gx: number, gy: number): { x: number; z: number } {
    const half = (this.size - 1) / 2;
    return { x: (gx - half) * this.cellSize, z: (gy - half) * this.cellSize };
  }

  /** 世界坐标双线性采样高度 */
  sampleHeightBilinear(wx: number, wz: number): number {
    const { gx, gy } = this.worldToGrid(wx, wz);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const tz = gy - y0;
    const h00 = this.getClamped(x0, y0);
    const h10 = this.getClamped(x0 + 1, y0);
    const h01 = this.getClamped(x0, y0 + 1);
    const h11 = this.getClamped(x0 + 1, y0 + 1);
    return bilinearSample(h00, h10, h01, h11, tx, tz);
  }

  /** 格点法线：中心差分 n = normalize(-dx, 2*cellSize, -dz) */
  computeNormalAt(gx: number, gy: number): [number, number, number] {
    const dx = this.getClamped(gx + 1, gy) - this.getClamped(gx - 1, gy);
    const dz = this.getClamped(gx, gy + 1) - this.getClamped(gx, gy - 1);
    const nx = -dx;
    const ny = 2 * this.cellSize;
    const nz = -dz;
    const invLen = 1 / Math.hypot(nx, ny, nz);
    return [nx * invLen, ny * invLen, nz * invLen];
  }

  /** 世界坐标采样法线（四角法线双线性） */
  sampleNormal(wx: number, wz: number): [number, number, number] {
    const { gx, gy } = this.worldToGrid(wx, wz);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const tz = gy - y0;
    const corners: [number, number][] = [
      [x0, y0],
      [x0 + 1, y0],
      [x0, y0 + 1],
      [x0 + 1, y0 + 1],
    ];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const [cx, cy] of corners) {
      const ix = clamp(cx, 0, this.size - 1);
      const iy = clamp(cy, 0, this.size - 1);
      const base = this.idx(ix, iy) * 3;
      const w =
        (ix === x0 ? 1 - tx : tx) * (iy === y0 ? 1 - tz : tz);
      nx += this.normals[base]! * w;
      ny += this.normals[base + 1]! * w;
      nz += this.normals[base + 2]! * w;
    }
    const invLen = 1 / Math.hypot(nx, ny, nz);
    return [nx * invLen, ny * invLen, nz * invLen];
  }

  /** 重算法线；传入脏矩形时只重算扩 1 格区域，否则全量 */
  recomputeNormals(rect?: DirtyRect): void {
    const r =
      rect ??
      ({ minX: 0, minY: 0, maxX: this.size - 1, maxY: this.size - 1 } satisfies DirtyRect);
    for (let gy = r.minY; gy <= r.maxY; gy++) {
      for (let gx = r.minX; gx <= r.maxX; gx++) {
        const [nx, ny, nz] = this.computeNormalAt(gx, gy);
        const base = this.idx(gx, gy) * 3;
        this.normals[base] = nx;
        this.normals[base + 1] = ny;
        this.normals[base + 2] = nz;
      }
    }
  }

  /** 全量替换高度（导入用），随后重算全部法线 */
  replaceHeights(next: Float32Array): void {
    if (next.length !== this.heights.length) throw new Error('高度场长度不一致');
    this.heights.set(next);
    this.recomputeNormals();
  }

  cloneHeights(): Float32Array {
    return this.heights.slice();
  }
}
