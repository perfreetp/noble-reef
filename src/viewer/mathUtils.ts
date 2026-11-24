import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * 计算把单位向量 from 旋转到单位向量 to 的四元数，写入 ref。
 * 处理反向（180°）退化情况。
 */
export function quatFromUnitVectorsToRef(
  fx: number, fy: number, fz: number,
  tx: number, ty: number, tz: number,
  ref: Quaternion,
): Quaternion {
  const d = fx * tx + fy * ty + fz * tz;
  if (d < -0.999999) {
    // 反向：任取一个与 from 垂直的轴转 180°
    let ax = 1, ay = 0, az = 0;
    if (Math.abs(fx) > 0.9) { ax = 0; ay = 1; az = 0; }
    // axis = normalize(cross(from, a))
    let cx = fy * az - fz * ay;
    let cy = fz * ax - fx * az;
    let cz = fx * ay - fy * ax;
    const l = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    cx /= l; cy /= l; cz /= l;
    ref.set(cx, cy, cz, 0);
    return ref;
  }
  // q = (cross(from,to), 1+d)，归一化
  const cx = fy * tz - fz * ty;
  const cy = fz * tx - fx * tz;
  const cz = fx * ty - fy * tx;
  const w = 1 + d;
  const l = Math.sqrt(cx * cx + cy * cy + cz * cz + w * w) || 1;
  ref.set(cx / l, cy / l, cz / l, w / l);
  return ref;
}

export function vec3(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}
