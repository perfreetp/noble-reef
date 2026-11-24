import type { Atom, Bond, Molecule } from "./types";
import { normalizeElement } from "./elements";

/** XYZ / 多帧 XYZ */
export function parseXYZ(text: string, name: string): Molecule[] {
  const lines = text.split(/\r?\n/);
  const mols: Molecule[] = [];
  let i = 0;
  while (i < lines.length) {
    const n = parseInt((lines[i] ?? "").trim(), 10);
    if (Number.isNaN(n)) {
      i++;
      continue;
    }
    const comment = (lines[i + 1] ?? "").trim();
    const atoms: Atom[] = [];
    for (let k = 0; k < n; k++) {
      const parts = (lines[i + 2 + k] ?? "").trim().split(/\s+/);
      if (parts.length < 4) continue;
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
      atoms.push({ element: normalizeElement(parts[0]), x, y, z });
    }
    mols.push({ id: "", name: comment || name, atoms, bonds: [] });
    i += n + 2;
  }
  return mols;
}

/** PDB（ATOM/HETATM + CONECT） */
export function parsePDB(text: string, name: string): Molecule[] {
  const atoms: Atom[] = [];
  const serialToIndex = new Map<number, number>();
  const conect: Array<[number, number]> = [];
  for (const line of text.split(/\r?\n/)) {
    const rec = line.slice(0, 6).trim();
    if (rec === "ATOM" || rec === "HETATM") {
      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
      let el = line.slice(76, 78).trim();
      if (!el) el = line.slice(12, 16).trim().replace(/^[0-9]+/, "");
      const serial = parseInt(line.slice(6, 11), 10);
      if (!Number.isNaN(serial)) serialToIndex.set(serial, atoms.length);
      atoms.push({ element: normalizeElement(el), x, y, z, name: line.slice(12, 16).trim(), serial });
    } else if (rec === "CONECT") {
      const a = parseInt(line.slice(6, 11), 10);
      for (const c of [11, 16, 21, 26]) {
        const b = parseInt(line.slice(c, c + 5), 10);
        if (!Number.isNaN(a) && !Number.isNaN(b)) conect.push([a, b]);
      }
    }
  }
  const bonds: Bond[] = [];
  const seen = new Set<string>();
  for (const [sa, sb] of conect) {
    const a = serialToIndex.get(sa);
    const b = serialToIndex.get(sb);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bonds.push({ a, b, order: 1 });
  }
  return atoms.length ? [{ id: "", name, atoms, bonds }] : [];
}

/** MOL (V2000) 单个结构块 */
export function parseMOL(block: string, name: string): Molecule | null {
  const lines = block.split(/\r?\n/);
  if (lines.length < 4) return null;
  const title = lines[0].trim() || name;
  const counts = lines[3];
  if (counts.includes("V3000")) {
    throw new Error(`「${title}」是 V3000 格式，暂仅支持 V2000`);
  }
  const na = parseInt(counts.slice(0, 3), 10);
  const nb = parseInt(counts.slice(3, 6), 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) return null;
  const atoms: Atom[] = [];
  for (let k = 0; k < na; k++) {
    const l = lines[4 + k] ?? "";
    const x = parseFloat(l.slice(0, 10));
    const y = parseFloat(l.slice(10, 20));
    const z = parseFloat(l.slice(20, 30));
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
    atoms.push({ element: normalizeElement(l.slice(31, 34)), x, y, z });
  }
  const bonds: Bond[] = [];
  for (let k = 0; k < nb; k++) {
    const l = lines[4 + na + k] ?? "";
    const a = parseInt(l.slice(0, 3), 10) - 1;
    const b = parseInt(l.slice(3, 6), 10) - 1;
    const t = parseInt(l.slice(6, 9), 10);
    if (a >= 0 && b >= 0 && a < atoms.length && b < atoms.length) {
      bonds.push({ a, b, order: t >= 1 && t <= 3 ? t : 1 });
    }
  }
  return { id: "", name: title, atoms, bonds };
}

/** SDF：按 $$$$ 拆成多个结构 */
export function parseSDF(text: string, name: string): Molecule[] {
  const out: Molecule[] = [];
  const blocks = text.split(/\$\$\$\$/);
  let idx = 0;
  for (const b of blocks) {
    if (!b.trim()) continue;
    idx++;
    const mol = parseMOL(b, `${name} #${idx}`);
    if (mol && mol.atoms.length) out.push(mol);
  }
  return out;
}

/** 按扩展名/内容自动识别格式 */
export function parseMoleculeFile(filename: string, text: string): Molecule[] {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xyz") return parseXYZ(text, filename);
  if (ext === "pdb" || ext === "ent") return parsePDB(text, filename);
  if (ext === "mol") {
    const m = parseMOL(text, filename);
    return m ? [m] : [];
  }
  if (ext === "sdf") return parseSDF(text, filename);
  // 无扩展名时按内容嗅探
  if (/^(ATOM  |HETATM)/m.test(text)) return parsePDB(text, filename);
  if (text.includes("V2000")) {
    const m = parseMOL(text, filename);
    return m ? [m] : [];
  }
  return parseXYZ(text, filename);
}
