export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 双线性插值：h00 为 (0,0) 角，h10 为 x 方向另一角，h01/h11 为 z 方向 */
export const bilinearSample = (
  h00: number,
  h10: number,
  h01: number,
  h11: number,
  tx: number,
  tz: number,
): number =>
  lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** 数值 id 生成（时间戳 + 计数器，避免 crypto 在非安全上下文的差异） */
let idCounter = 0;
export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
