import type { Atom, Bond, Molecule } from "./types";

/** 可复现的伪随机数（mulberry32） */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 苯 C6H6：演示单/双键不同粗细 */
function benzene(): Molecule {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const rC = 1.397;
  const rH = 1.397 + 1.09;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    atoms.push({ element: "C", x: rC * Math.cos(a), y: rC * Math.sin(a), z: 0 });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    atoms.push({ element: "H", x: rH * Math.cos(a), y: rH * Math.sin(a), z: 0 });
  }
  for (let i = 0; i < 6; i++) {
    bonds.push({ a: i, b: (i + 1) % 6, order: i % 2 === 0 ? 2 : 1 });
    bonds.push({ a: i, b: 6 + i, order: 1 });
  }
  return { id: "", name: "苯 Benzene (C6H6)", atoms, bonds };
}

/** 聚乙烯链：锯齿碳链 + 四面体氢 */
function polyethylene(units = 50): Molecule {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const Lcc = 1.54;
  const Lch = 1.09;
  const theta = (109.47 * Math.PI) / 180; // 四面体角
  // 碳链方向在 xy 平面内交替偏转
  const dirs: Array<[number, number, number]> = [];
  for (let i = 0; i < units; i++) {
    const ang = (i % 2 === 0 ? 1 : -1) * ((Math.PI - theta) / 2) * 0; // 方向由旋转累积，见下
    void ang;
    dirs.push([0, 0, 0]);
  }
  // 逐步累积方向：初始 +x，每步在 xy 平面内交替旋转 (π-θ)
  let dx = 1, dy = 0;
  const step = Math.PI - theta;
  let px = 0, py = 0, pz = 0;
  const cIdx: number[] = [];
  for (let i = 0; i < units; i++) {
    cIdx.push(atoms.length);
    atoms.push({ element: "C", x: px, y: py, z: pz });
    if (i > 0) bonds.push({ a: cIdx[i - 1], b: cIdx[i], order: 1 });
    dirs[i] = [dx, dy, 0];
    px += dx * Lcc;
    py += dy * Lcc;
    const c = Math.cos(step), s = Math.sin(step) * (i % 2 === 0 ? 1 : -1);
    const ndx = dx * c - dy * s;
    const ndy = dx * s + dy * c;
    dx = ndx;
    dy = ndy;
  }
  // 为每个碳加氢
  const addH = (ci: number, hx: number, hy: number, hz: number) => {
    const c = atoms[ci];
    const len = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    const hi = atoms.length;
    atoms.push({ element: "H", x: c.x + (hx / len) * Lch, y: c.y + (hy / len) * Lch, z: c.z + (hz / len) * Lch });
    bonds.push({ a: ci, b: hi, order: 1 });
  };
  for (let i = 0; i < units; i++) {
    const ci = cIdx[i];
    // 指向前后碳的单位向量之和的反向即氢所在平面内的平分线
    let ux = 0, uy = 0, uz = 0;
    let nb = 0;
    if (i > 0) {
      const d = dirs[i - 1];
      ux -= d[0]; uy -= d[1]; uz -= d[2]; nb++;
    }
    if (i < units - 1) {
      const d = dirs[i];
      ux -= d[0]; uy -= d[1]; uz -= d[2]; nb++;
    }
    let ml = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (ml < 1e-6) { ux = 0; uy = 1; uz = 0; ml = 1; }
    ux /= ml; uy /= ml; uz /= ml;
    // 链所在平面的法线（近似 z）
    const nx = 0, ny = 0, nz = 1;
    // 两个氢：平分线绕法线 ±(θ/2) 旋转（Rodrigues）
    const half = theta / 2;
    for (const sgn of [1, -1]) {
      const cs = Math.cos(half), sn = Math.sin(half) * sgn;
      // v*cos + (n×v)*sin + n*(n·v)*(1-cos)，n·v≈0
      const cx = ny * uz - nz * uy;
      const cy = nz * ux - nx * uz;
      const cz = nx * uy - ny * ux;
      addH(ci, ux * cs + cx * sn, uy * cs + cy * sn, uz * cs + cz * sn);
    }
    // 端点碳补第三个氢（沿链反方向锥面）
    if (i === 0 || i === units - 1) {
      const d = i === 0 ? dirs[0] : dirs[units - 2];
      addH(ci, -d[0] * 0.5, -d[1] * 0.5 + 0.8, -0.4);
      void nb;
    }
  }
  return { id: "", name: `聚乙烯链 Polyethylene (C${units})`, atoms, bonds };
}

/** 水分子团簇：演示氢键虚线 */
function waterCluster(count = 2000, seed = 42): Molecule {
  const rand = rng(seed);
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const L = Math.cbrt(count * 36); // 约 0.83 g/cm³，给拒绝采样留出空间
  const minOO = 2.7;
  const oPos: Array<[number, number, number]> = [];
  // 网格加速的拒绝采样
  const cell = minOO;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number, z: number) =>
    (Math.floor(x / cell) + 64) + (Math.floor(y / cell) + 64) * 256 + (Math.floor(z / cell) + 64) * 65536;
  let attempts = 0;
  while (oPos.length < count && attempts < count * 200) {
    attempts++;
    const x = rand() * L, y = rand() * L, z = rand() * L;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let ok = true;
    outer: for (let ddx = -1; ddx <= 1; ddx++)
      for (let ddy = -1; ddy <= 1; ddy++)
        for (let ddz = -1; ddz <= 1; ddz++) {
          const arr = grid.get((cx + ddx + 64) + (cy + ddy + 64) * 256 + (cz + ddz + 64) * 65536);
          if (!arr) continue;
          for (const j of arr) {
            const p = oPos[j];
            const ddx2 = p[0] - x, ddy2 = p[1] - y, ddz2 = p[2] - z;
            if (ddx2 * ddx2 + ddy2 * ddy2 + ddz2 * ddz2 < minOO * minOO) { ok = false; break outer; }
          }
        }
    if (!ok) continue;
    const k = key(x, y, z);
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(oPos.length);
    oPos.push([x, y, z]);
  }
  const hAngle = (104.5 * Math.PI) / 180;
  const rOH = 0.9572;
  for (const [x, y, z] of oPos) {
    const oi = atoms.length;
    atoms.push({ element: "O", x, y, z });
    // 随机取向的两个 O-H
    let h1x = rand() * 2 - 1, h1y = rand() * 2 - 1, h1z = rand() * 2 - 1;
    let l = Math.sqrt(h1x * h1x + h1y * h1y + h1z * h1z) || 1;
    h1x /= l; h1y /= l; h1z /= l;
    // 与 h1 成 104.5° 的随机向量
    let px = rand() * 2 - 1, py = rand() * 2 - 1, pz = rand() * 2 - 1;
    const dot = px * h1x + py * h1y + pz * h1z;
    px -= dot * h1x; py -= dot * h1y; pz -= dot * h1z;
    l = Math.sqrt(px * px + py * py + pz * pz) || 1;
    px /= l; py /= l; pz /= l;
    const cs = Math.cos(hAngle), sn = Math.sin(hAngle);
    const h2x = h1x * cs + px * sn, h2y = h1y * cs + py * sn, h2z = h1z * cs + pz * sn;
    const h1i = atoms.length;
    atoms.push({ element: "H", x: x + h1x * rOH, y: y + h1y * rOH, z: z + h1z * rOH });
    const h2i = atoms.length;
    atoms.push({ element: "H", x: x + h2x * rOH, y: y + h2y * rOH, z: z + h2z * rOH });
    bonds.push({ a: oi, b: h1i, order: 1 }, { a: oi, b: h2i, order: 1 });
  }
  return { id: "", name: `水分子团簇 Water ×${oPos.length}`, atoms, bonds };
}

/** NaCl 晶体：性能压测（n=38 时约 5.5 万原子、16 万键） */
function naclLattice(n = 38): Molecule {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const a = 2.82; // 最近邻距离 Å
  const idx = (i: number, j: number, k: number) => (i * n + j) * n + k;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        atoms.push({
          element: (i + j + k) % 2 === 0 ? "Na" : "Cl",
          x: i * a, y: j * a, z: k * a,
        });
      }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        if ((i + j + k) % 2 !== 0) continue;
        if (i + 1 < n) bonds.push({ a: idx(i, j, k), b: idx(i + 1, j, k), order: 1 });
        if (j + 1 < n) bonds.push({ a: idx(i, j, k), b: idx(i, j + 1, k), order: 1 });
        if (k + 1 < n) bonds.push({ a: idx(i, j, k), b: idx(i, j, k + 1), order: 1 });
      }
  return { id: "", name: `NaCl 晶体 ${n}³ (性能压测)`, atoms, bonds };
}

export interface SampleDef {
  id: string;
  label: string;
  build: () => Molecule;
}

export const SAMPLES: SampleDef[] = [
  { id: "benzene", label: "苯（单/双键演示）", build: benzene },
  { id: "pe", label: "聚乙烯链（约 200 原子）", build: () => polyethylene(50) },
  { id: "water", label: "水分子团簇 ×2000（氢键演示）", build: () => waterCluster(2000) },
  { id: "nacl", label: "NaCl 晶体 38³（≈5.5 万原子压测）", build: () => naclLattice(38) },
];
