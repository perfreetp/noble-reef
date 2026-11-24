import type { Bond, Molecule } from "./types";
import { getElement, isHBondHeavy } from "./elements";

/** 简单空间哈希网格，用于近邻搜索 */
class SpatialGrid {
  private map = new Map<number, number[]>();
  private cell: number;
  constructor(cell: number) {
    this.cell = cell;
  }
  private key(ix: number, iy: number, iz: number): number {
    return (ix + 512) + (iy + 512) * 2048 + (iz + 512) * 4194304;
  }
  insert(i: number, x: number, y: number, z: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell));
    let arr = this.map.get(k);
    if (!arr) {
      arr = [];
      this.map.set(k, arr);
    }
    arr.push(i);
  }
  /** 遍历 (x,y,z) 周围 27 个格子中的原子索引 */
  forEachNeighbor(x: number, y: number, z: number, cb: (i: number) => void): void {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = this.map.get(this.key(cx + dx, cy + dy, cz + dz));
          if (arr) for (const i of arr) cb(i);
        }
  }
}

/** 基于共价半径的距离判据推断化学键（文件未提供键信息时使用） */
export function inferBonds(mol: Molecule): Bond[] {
  const atoms = mol.atoms;
  const n = atoms.length;
  if (n === 0) return [];
  const radii = new Float64Array(n);
  let maxR = 0.8;
  for (let i = 0; i < n; i++) {
    radii[i] = getElement(atoms[i].element).covalent;
    if (radii[i] > maxR) maxR = radii[i];
  }
  const grid = new SpatialGrid(2 * maxR + 0.6);
  for (let i = 0; i < n; i++) grid.insert(i, atoms[i].x, atoms[i].y, atoms[i].z);
  const bonds: Bond[] = [];
  for (let i = 0; i < n; i++) {
    const a = atoms[i];
    grid.forEachNeighbor(a.x, a.y, a.z, (j) => {
      if (j <= i) return;
      const b = atoms[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const cutoff = radii[i] + radii[j] + 0.45;
      if (dist > 0.4 && dist < cutoff) bonds.push({ a: i, b: j, order: 1 });
    });
  }
  return bonds;
}

/**
 * 氢键检测：N/O/F/S/Cl 重原子对，距离在 [2.2, threshold] Å 之间，
 * 且二者之间没有共价键。返回原子索引对。
 */
export function findHBonds(mol: Molecule, threshold: number): Array<[number, number]> {
  const atoms = mol.atoms;
  const cand: number[] = [];
  for (let i = 0; i < atoms.length; i++) {
    if (isHBondHeavy(atoms[i].element)) cand.push(i);
  }
  const bonded = new Set<string>();
  for (const b of mol.bonds) {
    bonded.add(b.a < b.b ? `${b.a}_${b.b}` : `${b.b}_${b.a}`);
  }
  const grid = new SpatialGrid(Math.max(threshold, 2.5));
  for (const i of cand) grid.insert(i, atoms[i].x, atoms[i].y, atoms[i].z);
  const out: Array<[number, number]> = [];
  const min2 = 2.2 * 2.2;
  const max2 = threshold * threshold;
  for (const i of cand) {
    const a = atoms[i];
    grid.forEachNeighbor(a.x, a.y, a.z, (j) => {
      if (j <= i) return;
      if (bonded.has(i < j ? `${i}_${j}` : `${j}_${i}`)) return;
      const b = atoms[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= min2 && d2 <= max2) out.push([i, j]);
    });
  }
  return out;
}
