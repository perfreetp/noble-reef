import * as THREE from 'three';

/**
 * 冠体曲面:参数化冠梁带面。
 * u ∈ [0,1] 沿冠梁环向(0.5 为正前),v ∈ [0,1] 沿高度。
 * 正前有隆起的峰,整体为开口圆台带。
 */
export const CROWN = {
  radius: 70,
  arc: Math.PI * 1.5, // 270° 开口冠
  baseY: -8,
  baseH: 26,
  peakH: 30,
};

export function crownPoint(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  const theta = (u - 0.5) * CROWN.arc;
  const d = (u - 0.5) / 0.16;
  const front = Math.exp(-d * d);
  const r = CROWN.radius + 6 * Math.sin(v * Math.PI) + 4 * front * v;
  const y = CROWN.baseY + v * (CROWN.baseH + CROWN.peakH * front);
  return out.set(r * Math.sin(theta), y, r * Math.cos(theta));
}

export interface CrownFrame {
  P: THREE.Vector3;
  N: THREE.Vector3;
  Tu: THREE.Vector3;
  Tv: THREE.Vector3;
}

const _pu = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** 冠面局部标架:位置、外法线、环向切线、高度切线 */
export function crownFrame(u: number, v: number): CrownFrame {
  const P = crownPoint(u, v);
  const e = 0.004;
  const u0 = Math.max(0, u - e), u1 = Math.min(1, u + e);
  const v0 = Math.max(0, v - e), v1 = Math.min(1, v + e);
  crownPoint(u1, v, _pu).sub(crownPoint(u0, v, _a));
  crownPoint(u, v1, _pv).sub(crownPoint(u, v0, _b));
  const N = new THREE.Vector3().crossVectors(_pu, _pv).normalize();
  // 法线朝外(远离冠体中轴)
  if (N.x * P.x + N.z * P.z < 0) N.negate();
  const Tu = _pu.clone().normalize();
  const Tv = new THREE.Vector3().crossVectors(N, Tu).normalize();
  return { P, N, Tu, Tv };
}

/** 冠面该处到冠体中轴的半径,用于羽片包覆弯曲 */
export function crownRadiusAt(u: number, v: number): number {
  const p = crownPoint(u, v, _a);
  return Math.hypot(p.x, p.z);
}

export function buildCrownGeometry(segU = 128, segV = 32): THREE.BufferGeometry {
  const cols = segU + 1;
  const rows = segV + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const p = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const u = j / segU;
      const v = i / segV;
      crownPoint(u, v, p);
      const k = i * cols + j;
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = p.y;
      pos[k * 3 + 2] = p.z;
      uv[k * 2] = u;
      uv[k * 2 + 1] = v;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < segV; i++) {
    for (let j = 0; j < segU; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
