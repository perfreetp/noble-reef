/**
 * 色温（开尔文）→ sRGB(0..1) 转换。
 * 基于 Tanner Helland 经典查表算法，输出 sRGB 编码值（非线性）。
 */
export function kelvinToSRGB(kelvin: number): [number, number, number] {
  const temp = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  const clamp255 = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return [clamp255(r), clamp255(g), clamp255(b)];
}

/** sRGB(0..1) → 线性光 */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 色温 → 线性 RGB（供 three.js 着色器 uniform 使用） */
export function kelvinToLinear(kelvin: number): [number, number, number] {
  const [r, g, b] = kelvinToSRGB(kelvin);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}
