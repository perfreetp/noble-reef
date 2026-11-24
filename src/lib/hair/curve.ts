import * as THREE from 'three';
import type { Anchor, BundleParams } from './types';

/**
 * 由锚点与参数计算发束中心线采样点。
 * 完全确定性：同一 (anchor, params, seed) 必得同一曲线，
 * 撤销/重做与文件重载后形态因此完全一致。
 */

/** 由字符串 id 生成稳定的 0..1 伪随机数（用于蓬松相位等） */
export function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _tmp = new THREE.Vector3();

/** 在法线 n 的切平面上，按方位角 yaw（度）取一个单位切向 */
export function tangentFrame(n: THREE.Vector3, yawDeg: number, outT1: THREE.Vector3, outT2: THREE.Vector3): void {
  // 选一个不平行于 n 的参考向量构造正交基
  const ref = Math.abs(n.y) < 0.9 ? _tmp.set(0, 1, 0) : _tmp.set(1, 0, 0);
  outT1.crossVectors(n, ref).normalize();
  outT2.crossVectors(n, outT1).normalize();
  const yaw = (yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = outT1.x * c + outT2.x * s;
  const y = outT1.y * c + outT2.y * s;
  const z = outT1.z * c + outT2.z * s;
  outT2.set(x, y, z); // outT2 现在是“弯曲方向”切向
}

/**
 * 计算发束中心线。
 * @param segments 采样段数（点数为 segments+1）
 * @returns 长度为 segments+1 的点数组（新分配）
 */
export function computeCurve(
  anchor: Anchor,
  params: BundleParams,
  seed: number,
  segments = 16,
): THREE.Vector3[] {
  const n = new THREE.Vector3(...anchor.normal).normalize();
  const root = new THREE.Vector3(...anchor.position);

  // 初始方向：法线向“弯曲方向”倾斜 tilt 角
  const t1 = new THREE.Vector3();
  const bendDir = new THREE.Vector3();
  tangentFrame(n, params.direction, t1, bendDir);
  const tiltRad = (params.tilt * Math.PI) / 180;
  const dir = new THREE.Vector3()
    .copy(n)
    .multiplyScalar(Math.cos(tiltRad))
    .addScaledVector(bendDir, Math.sin(tiltRad))
    .normalize();

  const points: THREE.Vector3[] = [root.clone()];
  const pos = root.clone();
  const ds = params.length / segments;

  // 卷曲：每段绕垂直于 bendDir 的轴旋转一个角度，卷曲度越大角速度越大
  const curlAxis = new THREE.Vector3().crossVectors(dir, bendDir).normalize();
  if (curlAxis.lengthSq() < 1e-8) curlAxis.copy(t1);
  const curlAngular = params.curl * Math.PI * 1.6; // 整束最大累计转角
  // 蓬松：横向正弦扰动的相位与方向（确定性）
  const phase = seed * Math.PI * 2;
  const fluffDir = new THREE.Vector3().copy(t1);
  const fluffAmp = params.fluff * 0.06 * params.length;

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    // 卷曲旋转（沿曲线累计，越往梢端弯得越多）
    if (curlAngular > 0) {
      _axis.copy(curlAxis);
      dir.applyAxisAngle(_axis, curlAngular / segments);
    }
    // 轻微重力下垂：方向逐步向世界下方靠拢
    _dir.copy(dir).lerp(_down, 0.02).normalize();
    dir.copy(_dir);
    pos.addScaledVector(dir, ds);
    const p = pos.clone();
    if (fluffAmp > 0) {
      const wobble = Math.sin(t * Math.PI * 3 + phase) * fluffAmp * t;
      p.addScaledVector(fluffDir, wobble);
    }
    points.push(p);
  }
  return points;
}

/** 粗细 -> 根部截面半径（世界单位） */
export function baseRadius(thickness: number): number {
  return 0.012 * thickness;
}

/** 沿曲线的半径（根部粗、梢端细的锥形截面） */
export function radiusAt(thickness: number, t: number): number {
  return baseRadius(thickness) * (1 - 0.75 * t);
}
