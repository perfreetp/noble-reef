import * as THREE from 'three';
import { PlateKind, plateHeight } from './plates';

export type HeadSize = 'thin' | 'medium' | 'thick';

/** 挤出头三档:整条酱汁的基础宽度(世界单位) */
export const HEAD_WIDTHS: Record<HeadSize, number> = {
  thin: 0.06,
  medium: 0.1,
  thick: 0.16,
};

export const HEAD_LABELS: Record<HeadSize, string> = {
  thin: '细',
  medium: '中',
  thick: '粗',
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Pt = [number, number];

/** Chaikin 角切平滑,保留端点;迭代次数越多边缘越圆润 */
function chaikin(pts: Pt[], iterations: number): Pt[] {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    if (p.length < 3) break;
    const out: Pt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** 按固定弧长重采样粒子链 */
function resample(pts: Pt[], ds: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const dx = bx - ax;
    const dz = bz - az;
    let segLen = Math.hypot(dx, dz);
    if (segLen < 1e-6) continue;
    const ux = dx / segLen;
    const uz = dz / segLen;
    while (carry + segLen >= ds) {
      const step = ds - carry;
      ax += ux * step;
      az += uz * step;
      out.push([ax, az]);
      segLen -= step;
      carry = 0;
    }
    carry += segLen;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > ds * 0.3) out.push(last);
  return out;
}

/** 单击挤出的圆点:合成一个小圆环粒子链 */
function blobPoints(center: Pt, r: number): Pt[] {
  const pts: Pt[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r]);
  }
  return pts;
}

export interface SauceGeoOptions {
  viscosity: number; // 0.2 - 2.0
  width: HeadSize;
  plate: PlateKind;
  layer: number; // 叠放层序,决定高度偏移与遮挡
  flow: number; // 0..1 流动进度(粘度越高推进越慢)
}

/**
 * 由粒子链构建酱汁条带网格:
 * 横截面为弧形穹顶(贴合盘面高度场),粘度控制铺展宽度、边缘圆润度与厚度。
 */
export function buildSauceGeometry(rawPts: Pt[], o: SauceGeoOptions): THREE.BufferGeometry {
  const t = Math.min(1, Math.max(0, (o.viscosity - 0.2) / 1.8)); // 归一化粘度
  const baseW = HEAD_WIDTHS[o.width];
  // 低粘度摊得更开,高粘度收拢
  const spread = lerp(1.4, 0.9, t);
  // 流动动画:宽度从 55% 逐渐铺到 100%
  const flowW = 0.55 + 0.45 * o.flow;
  const halfW = (baseW * spread * flowW) / 2;

  let pts: Pt[] = rawPts.length === 1 ? blobPoints(rawPts[0], Math.max(halfW, 0.03)) : rawPts;
  // 粘度越高,平滑迭代越多,边缘越圆润;随流动进度逐渐生效
  const smoothIter = Math.round(lerp(0.5, 4, t) * o.flow);
  pts = chaikin(pts, smoothIter);
  pts = resample(pts, Math.max(0.02, halfW * 0.6));
  if (pts.length < 2) pts = [pts[0], [pts[0][0] + 0.001, pts[0][1]]];

  const C = 7; // 横截面分段
  const k = lerp(1.7, 0.55, t); // 穹顶指数:高粘度更接近半圆
  const thickness = baseW * lerp(0.4, 0.62, t) * (0.6 + 0.4 * o.flow);
  const layerY = o.layer * 0.02; // 每层抬高,叠加酱汁按高度遮挡

  const n = pts.length;
  const positions: number[] = [];
  const idx: number[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const nx = -tz;
    const nz = tx;
    // 两端收尖
    const endT = Math.min(1, Math.min(i, n - 1 - i) / 2.5);
    const taper = Math.sqrt(Math.max(0.04, endT));
    const hw = halfW * taper;
    for (let j = 0; j <= C; j++) {
      const u = (j / C) * 2 - 1; // -1..1
      const px = pts[i][0] + nx * u * hw;
      const pz = pts[i][1] + nz * u * hw;
      const prof = Math.pow(Math.max(0, 1 - u * u), k);
      const y = plateHeight(o.plate, px, pz) + layerY + thickness * prof + 0.004;
      positions.push(px, y, pz);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < C; j++) {
      const a = i * (C + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (C + 1) + j;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 按粘度创建酱汁材质:粘度越高表面越光滑、高光越强 */
export function createSauceMaterial(color: string, viscosity: number): THREE.MeshPhysicalMaterial {
  const t = Math.min(1, Math.max(0, (viscosity - 0.2) / 1.8));
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: lerp(0.78, 0.12, t),
    metalness: 0,
    clearcoat: lerp(0.1, 0.7, t),
    clearcoatRoughness: lerp(0.5, 0.12, t),
    side: THREE.DoubleSide,
  });
}

export function updateSauceMaterial(mat: THREE.MeshPhysicalMaterial, color: string, viscosity: number): void {
  const t = Math.min(1, Math.max(0, (viscosity - 0.2) / 1.8));
  mat.color.set(color);
  mat.roughness = lerp(0.78, 0.12, t);
  mat.clearcoat = lerp(0.1, 0.7, t);
  mat.clearcoatRoughness = lerp(0.5, 0.12, t);
  mat.needsUpdate = true;
}
