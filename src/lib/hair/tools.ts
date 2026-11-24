import * as THREE from 'three';
import { model } from './model';
import { tangentFrame } from './curve';
import { PARAM_LIMITS } from './types';

const _rayPoint = new THREE.Vector3();
const _curvePoint = new THREE.Vector3();
const _toCurve = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

/** 求发束曲线上离射线最近的点，返回距离平方与最近点 */
function closestOnCurve(
  curve: THREE.Vector3[],
  ray: THREE.Ray,
): { distSq: number; point: THREE.Vector3 } {
  let best = Infinity;
  let bestPoint: THREE.Vector3 | null = null;
  for (const p of curve) {
    ray.closestPointToPoint(p, _rayPoint);
    const d = _rayPoint.distanceToSquared(p);
    if (d < best) {
      best = d;
      bestPoint = p;
    }
  }
  return { distSq: best, point: bestPoint ? bestPoint.clone() : new THREE.Vector3() };
}

/**
 * 梳子工具：顺着拖拽方向把散开的发丝理顺。
 * 影响半径内的发束：弯曲方向转向拖拽方向，卷曲度略微降低。
 * @param strength 0..1，本帧作用强度
 */
export function applyComb(
  ray: THREE.Ray,
  dragDir: THREE.Vector3,
  radius: number,
  strength: number,
): string[] {
  const affected: string[] = [];
  const r2 = radius * radius;
  for (const [id, b] of model.bundles) {
    const curve = model.getCurve(id, 10);
    const { distSq, point } = closestOnCurve(curve, ray);
    if (distSq > r2) continue;

    // 距离衰减
    const falloff = 1 - Math.sqrt(distSq) / radius;
    const k = strength * falloff;

    // 把拖拽方向投影到发根切平面，换算为目标方位角
    _n.set(...b.anchor.normal).normalize();
    tangentFrame(_n, 0, _t1, _t2);
    _toCurve.copy(dragDir).addScaledVector(_n, -dragDir.dot(_n));
    if (_toCurve.lengthSq() > 1e-8) {
      _toCurve.normalize();
      const x = _toCurve.dot(_t1);
      const y = _toCurve.dot(_t2);
      const targetYaw = (Math.atan2(y, x) * 180) / Math.PI;
      // 角度插值（处理 360 回绕）
      let delta = targetYaw - b.params.direction;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      b.params.direction = (b.params.direction + delta * k + 360) % 360;
    }
    // 理顺 = 卷曲度与蓬松度缓慢降低
    b.params.curl = Math.max(PARAM_LIMITS.curl.min, b.params.curl - 0.06 * k);
    b.params.fluff = Math.max(PARAM_LIMITS.fluff.min, b.params.fluff - 0.08 * k);
    model.invalidate([id]);
    affected.push(id);
  }
  return affected;
}

/**
 * 刷子工具：局部增加蓬松度。
 */
export function applyBrush(ray: THREE.Ray, radius: number, strength: number): string[] {
  const affected: string[] = [];
  const r2 = radius * radius;
  for (const [id, b] of model.bundles) {
    const curve = model.getCurve(id, 10);
    const { distSq } = closestOnCurve(curve, ray);
    if (distSq > r2) continue;
    const falloff = 1 - Math.sqrt(distSq) / radius;
    b.params.fluff = Math.min(
      PARAM_LIMITS.fluff.max,
      b.params.fluff + 0.12 * strength * falloff,
    );
    model.invalidate([id]);
    affected.push(id);
  }
  return affected;
}

/** 通知模型这些发束被外部直接改过（触发渲染更新） */
export function emitDirty(ids: string[]): void {
  if (ids.length === 0) return;
  model.touch(ids);
}
