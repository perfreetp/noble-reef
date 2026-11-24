/** 元素表：CPK 颜色、共价半径、范德华半径（单位 Å） */

export interface ElementInfo {
  symbol: string;
  color: [number, number, number];
  covalent: number;
  vdw: number;
}

const DEFAULT_COLOR: [number, number, number] = [0.9, 0.45, 0.75];

const TABLE: Record<string, { color: [number, number, number]; covalent: number; vdw: number }> = {
  H:  { color: [0.96, 0.96, 0.96], covalent: 0.31, vdw: 1.20 },
  He: { color: [0.85, 1.00, 1.00], covalent: 0.28, vdw: 1.40 },
  Li: { color: [0.80, 0.50, 1.00], covalent: 1.28, vdw: 1.82 },
  Be: { color: [0.76, 1.00, 0.00], covalent: 0.96, vdw: 1.53 },
  B:  { color: [1.00, 0.71, 0.71], covalent: 0.84, vdw: 1.92 },
  C:  { color: [0.40, 0.40, 0.40], covalent: 0.76, vdw: 1.70 },
  N:  { color: [0.20, 0.35, 0.97], covalent: 0.71, vdw: 1.55 },
  O:  { color: [0.93, 0.15, 0.15], covalent: 0.66, vdw: 1.52 },
  F:  { color: [0.56, 0.88, 0.31], covalent: 0.57, vdw: 1.47 },
  Ne: { color: [0.70, 0.89, 0.96], covalent: 0.58, vdw: 1.54 },
  Na: { color: [0.67, 0.36, 0.95], covalent: 1.66, vdw: 2.27 },
  Mg: { color: [0.54, 1.00, 0.00], covalent: 1.41, vdw: 1.73 },
  Al: { color: [0.75, 0.65, 0.65], covalent: 1.21, vdw: 1.84 },
  Si: { color: [0.94, 0.78, 0.63], covalent: 1.11, vdw: 2.10 },
  P:  { color: [1.00, 0.50, 0.00], covalent: 1.07, vdw: 1.80 },
  S:  { color: [1.00, 0.90, 0.20], covalent: 1.05, vdw: 1.80 },
  Cl: { color: [0.12, 0.94, 0.12], covalent: 1.02, vdw: 1.75 },
  Ar: { color: [0.50, 0.82, 0.89], covalent: 1.06, vdw: 1.88 },
  K:  { color: [0.56, 0.25, 0.83], covalent: 2.03, vdw: 2.75 },
  Ca: { color: [0.24, 1.00, 0.00], covalent: 1.76, vdw: 2.31 },
  Fe: { color: [0.88, 0.40, 0.20], covalent: 1.24, vdw: 2.00 },
  Cu: { color: [0.78, 0.50, 0.20], covalent: 1.32, vdw: 2.00 },
  Zn: { color: [0.49, 0.50, 0.69], covalent: 1.22, vdw: 2.10 },
  Br: { color: [0.65, 0.16, 0.16], covalent: 1.20, vdw: 1.85 },
  Ag: { color: [0.75, 0.75, 0.75], covalent: 1.45, vdw: 2.11 },
  I:  { color: [0.58, 0.00, 0.83], covalent: 1.39, vdw: 1.98 },
  Au: { color: [1.00, 0.82, 0.14], covalent: 1.36, vdw: 2.14 },
  Hg: { color: [0.72, 0.72, 0.82], covalent: 1.32, vdw: 2.23 },
  Pb: { color: [0.34, 0.35, 0.38], covalent: 1.46, vdw: 2.02 },
};

/** 把 "CL"、"C1"、" C " 之类的写法归一化成标准元素符号 */
export function normalizeElement(raw: string): string {
  let s = raw.trim().replace(/[^A-Za-z]/g, "");
  if (!s) return "?";
  s = s[0].toUpperCase() + (s.length > 1 ? s.slice(1).toLowerCase() : "");
  if (!(s in TABLE) && s.length >= 2) {
    const one = s[0];
    if (one in TABLE) return one;
  }
  return s;
}

export function getElement(symbol: string): ElementInfo {
  const t = TABLE[symbol];
  if (!t) return { symbol, color: DEFAULT_COLOR, covalent: 0.75, vdw: 1.6 };
  return { symbol, color: t.color, covalent: t.covalent, vdw: t.vdw };
}

/** 可作为氢键给体/受体的重原子 */
export function isHBondHeavy(symbol: string): boolean {
  return symbol === "N" || symbol === "O" || symbol === "F" || symbol === "S" || symbol === "Cl";
}
