// 颜色工具（输入输出均为 #rrggbb 字符串）

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function lighten(hex: string, t = 0.35): string {
  return mixColor(hex, '#ffffff', t);
}

export function darken(hex: string, t = 0.3): string {
  return mixColor(hex, '#000000', t);
}

export function withAlpha(hex: string, alpha: number): number {
  const [r, g, b] = hexToRgb(hex);
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}
