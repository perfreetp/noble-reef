// 冒烟测试：化学数据层 + 矩阵数学（node 运行，不依赖 Babylon 渲染）
import { SAMPLES } from "../src/chem/samples";
import { parseXYZ, parsePDB, parseMOL } from "../src/chem/parsers";
import { inferBonds, findHBonds } from "../src/chem/bonds";
import { quatFromUnitVectorsToRef } from "../src/viewer/mathUtils";

// mathUtils 依赖 @babylonjs/core 的 Quaternion，node 下可直接导入（纯数学）
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}

// --- 示例结构 ---
const benzene = SAMPLES[0].build();
check("benzene 12 atoms", benzene.atoms.length === 12, `got ${benzene.atoms.length}`);
check("benzene 12 bonds", benzene.bonds.length === 12, `got ${benzene.bonds.length}`);
check("benzene has double bonds", benzene.bonds.some((b) => b.order === 2));

const pe = SAMPLES[1].build();
check("polyethylene atoms", pe.atoms.length === 50 + 50 * 2 + 2, `got ${pe.atoms.length}`);
check("polyethylene bonds", pe.bonds.length === 49 + 100 + 2, `got ${pe.bonds.length}`);

const water = SAMPLES[2].build();
check("water atoms", water.atoms.length >= 1900 * 3, `got ${water.atoms.length}`);
const hb = findHBonds(water, 3.0);
check("water hbonds found", hb.length > 100, `got ${hb.length}`);
const hbNone = findHBonds(water, 2.3);
check("threshold filter works", hbNone.length < hb.length, `${hbNone.length} vs ${hb.length}`);

const nacl = SAMPLES[3].build();
check("nacl ~55k atoms", nacl.atoms.length === 38 ** 3, `got ${nacl.atoms.length}`);
check("nacl bonds", nacl.bonds.length > 75000, `got ${nacl.bonds.length}`);

// --- 解析器 ---
const xyz = parseXYZ("3\nwater\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n", "t.xyz");
check("xyz atoms", xyz[0].atoms.length === 3);
check("xyz infer bonds", inferBonds(xyz[0]).length === 2);

const pdb = parsePDB(
  "HETATM    1  C1  LIG A   1       1.000   2.000   3.000  1.00 20.00           C\n" +
    "HETATM    2  O1  LIG A   1       2.400   2.000   3.000  1.00 20.00           O\n" +
    "CONECT    1    2\n",
  "t.pdb",
);
check("pdb atoms", pdb[0].atoms.length === 2);
check("pdb element", pdb[0].atoms[0].element === "C");
check("pdb conect", pdb[0].bonds.length === 1);

const mol = parseMOL(
  "ethanol\n  test\n\n  2  1  0  0  0  0            999 V2000\n" +
    "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n" +
    "    1.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n" +
    "  1  2  2  0  0  0  0\nM  END\n",
  "t.mol",
);
check("mol atoms", mol?.atoms.length === 2);
check("mol bond order", mol?.bonds[0].order === 2);

// --- 四元数旋转 ---
const q = new Quaternion();
quatFromUnitVectorsToRef(0, 1, 0, 1, 0, 0, q);
// 旋转 (0,1,0) 应得到 (1,0,0)
const v = rotateByQuat(0, 1, 0, q);
check("quat Y->X", Math.abs(v[0] - 1) < 1e-5 && Math.abs(v[1]) < 1e-5, `got ${v}`);
quatFromUnitVectorsToRef(0, 1, 0, 0, -1, 0, q);
const v2 = rotateByQuat(0, 1, 0, q);
check("quat antiparallel", Math.abs(v2[1] + 1) < 1e-5, `got ${v2}`);
quatFromUnitVectorsToRef(0, 0, 1, 0, 1, 0, q);
const v3 = rotateByQuat(0, 0, 1, q);
check("quat Z->Y", Math.abs(v3[1] - 1) < 1e-5, `got ${v3}`);

function rotateByQuat(x: number, y: number, z: number, q: Quaternion): number[] {
  // v' = q * v * q^-1
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
