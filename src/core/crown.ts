import type { CrownProfile } from './types';

export interface Vec2 {
  x: number;
  y: number;
}

function qpoint(c: CrownProfile, t: number): Vec2 {
  const it = 1 - t;
  const a = it * it;
  const b = 2 * it * t;
  const d = t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y,
  };
}

function qtangent(c: CrownProfile, t: number): Vec2 {
  return {
    x: 2 * (1 - t) * (c.p1.x - c.p0.x) + 2 * t * (c.p2.x - c.p1.x),
    y: 2 * (1 - t) * (c.p1.y - c.p0.y) + 2 * t * (c.p2.y - c.p1.y),
  };
}

/**
 * 把自由点投影到冠面脊线:细分搜索 + 牛顿精化,返回最近点、参数 t 与切线。
 * 饰片摆放时按 snapStrength 在「自由位置」与「吸附位置」间插值。
 */
export function projectToCrown(c: CrownProfile, px: number, py: number): { point: Vec2; t: number; tangent: Vec2 } {
  const N = 48;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = qpoint(c, t);
    const d = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  // 牛顿法精化:最小化 |B(t)-P|^2,导数 2(B-P)·B'
  let t = bestT;
  for (let iter = 0; iter < 8; iter++) {
    const p = qpoint(c, t);
    const tan = qtangent(c, t);
    const denom = 2 * (tan.x * tan.x + tan.y * tan.y) + 1e-9;
    const f = 2 * ((p.x - px) * tan.x + (p.y - py) * tan.y);
    t = Math.min(1, Math.max(0, t - f / denom));
  }
  const point = qpoint(c, t);
  const tan = qtangent(c, t);
  const len = Math.hypot(tan.x, tan.y) || 1;
  return { point, t, tangent: { x: tan.x / len, y: tan.y / len } };
}

/** 沿冠面吸附:位置向脊线投影,旋转向切线对齐,强度插值 */
export function snapToCrown(
  c: CrownProfile,
  x: number,
  y: number,
  rotation: number,
): { x: number; y: number; rotation: number; t: number } {
  const { point, tangent, t } = projectToCrown(c, x, y);
  const s = c.snapStrength;
  const surfaceAngle = Math.atan2(tangent.y, tangent.x);
  // 角度插值走最短弧
  let delta = surfaceAngle - rotation;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return {
    x: x + (point.x - x) * s,
    y: y + (point.y - y) * s,
    rotation: rotation + delta * s,
    t,
  };
}

/** 编辑器画冠面参考线用:折线采样点 */
export function crownPolyline(c: CrownProfile, segments = 64): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= segments; i++) pts.push(qpoint(c, i / segments));
  return pts;
}
