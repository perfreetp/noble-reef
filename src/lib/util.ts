// 轻量 id 生成（不依赖 crypto.randomUUID，便于在任意环境运行）

let counter = 0;

export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.floor(
    Math.random() * 1e6
  ).toString(36)}`;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** 角度归一化到 [0, 360) */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 由朝向角度求单位向量（0 度 = +x 方向，逆时针为正，屏幕 y 向下） */
export function angleVec(deg: number): { x: number; y: number } {
  const r = degToRad(deg);
  return { x: Math.cos(r), y: -Math.sin(r) };
}

export function vecAngle(x: number, y: number): number {
  return normalizeDeg(radToDeg(Math.atan2(-y, x)));
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}
