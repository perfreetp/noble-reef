import * as THREE from 'three';
import { mulberry32 } from './util';

export interface FeatherShapeParams {
  /** 长度 mm */
  length: number;
  /** 最大宽度 mm */
  width: number;
  /** 弯曲 -1..1 */
  curvature: number;
  /** 纵向细分段数(最大 64) */
  segments: number;
  /** 贴合冠面的包覆半径 mm */
  wrapRadius: number;
  seed: number;
}

/** 横向列数:边缘列做绒毛抖动,需要足够横向细分表现绒边 */
const ACROSS = 14;

function widthProfile(t: number): number {
  // 基部尖、中部宽、羽尖收
  return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9) * (1 - 0.12 * t);
}

/**
 * 单根羽枝:沿脊线曲线生成片状网格,纵向 segments 段、横向 ACROSS 列。
 * 边缘列施加确定性抖动形成绒毛轮廓;横向按冠面半径包覆弯曲。
 * 切线属性 tangent 沿纤维方向,供各向异性高光使用。
 */
export function buildFeatherGeometry(p: FeatherShapeParams): THREE.BufferGeometry {
  const seg = Math.max(4, Math.min(64, Math.round(p.segments)));
  const rng = mulberry32(p.seed);
  const cols = ACROSS + 1;
  const rows = seg + 1;
  const count = cols * rows;

  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const tan = new Float32Array(count * 3);

  const L = p.length;
  const bend = p.curvature * L * 0.35;
  const wrap = Math.max(30, p.wrapRadius);

  for (let i = 0; i < rows; i++) {
    const t = i / seg;
    const y = t * L;
    const zSpine = bend * t * t;
    const halfW = (widthProfile(t) * p.width) / 2;
    // 脊线切线(纤维方向)
    const tz = 2 * bend * t;
    const tl = Math.hypot(L, tz) || 1;
    const tx = 0, ty = L / tl, tn = tz / tl;

    for (let j = 0; j < cols; j++) {
      const s = (j / ACROSS) * 2 - 1; // -1..1 横向
      let x = s * halfW;
      let z = zSpine;
      // 边缘绒毛:外侧列施加抖动
      const edge = Math.abs(s);
      if (edge > 0.55) {
        const f = (edge - 0.55) / 0.45;
        x += (rng() - 0.5) * f * p.width * 0.10;
        z += (rng() - 0.5) * f * 0.5;
      }
      // 按冠面弧度包覆(抛物线近似)
      z -= (x * x) / (2 * wrap);

      const k = i * cols + j;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      uv[k * 2] = j / ACROSS;
      uv[k * 2 + 1] = t;
      tan[k * 3] = tx;
      tan[k * 3 + 1] = ty;
      tan[k * 3 + 2] = tn;
    }
  }

  const idx: number[] = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < ACROSS; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('tangent', new THREE.BufferAttribute(tan, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
