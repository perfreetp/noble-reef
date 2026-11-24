import { Texture } from 'pixi.js';

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

/** 喷头底座纹理：柔光圆点（运行时按分组着色） */
export function makeNozzleTexture(): Texture {
  const S = 64;
  const [c, ctx] = makeCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(240,244,250,0.98)');
  g.addColorStop(0.82, 'rgba(206,216,228,0.95)');
  g.addColorStop(1, 'rgba(160,174,190,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  // 内圈描边，缩小时仍有轮廓
  ctx.strokeStyle = 'rgba(70,84,102,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  return Texture.from(c);
}

/** 水柱基座（俯视 footprint） */
export function makeWaterBaseTexture(): Texture {
  const S = 64;
  const [c, ctx] = makeCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(225,246,255,0.95)');
  g.addColorStop(0.5, 'rgba(150,216,245,0.55)');
  g.addColorStop(1, 'rgba(120,190,235,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(c);
}

/** 水柱轨迹条（沿朝向拉伸的柔光条，锚点在底端中央） */
export function makeStreakTexture(): Texture {
  const W = 128;
  const H = 16;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(200,238,255,0.05)');
  g.addColorStop(0.25, 'rgba(190,232,255,0.55)');
  g.addColorStop(1, 'rgba(235,250,255,0.95)');
  ctx.fillStyle = g;
  // 梭形
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.quadraticCurveTo(W * 0.5, 0, W, H / 2);
  ctx.quadraticCurveTo(W * 0.5, H, 0, H / 2);
  ctx.closePath();
  ctx.fill();
  return Texture.from(c);
}

/** 落点圆环 */
export function makeLandingTexture(): Texture {
  const S = 64;
  const [c, ctx] = makeCanvas(S);
  ctx.strokeStyle = 'rgba(225,246,255,0.95)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.48);
  g.addColorStop(0, 'rgba(180,228,255,0.35)');
  g.addColorStop(1, 'rgba(180,228,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.48, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(c);
}

/** 选中/手柄方点纹理 */
export function makeHandleTexture(): Texture {
  const S = 32;
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = 'rgba(20,90,170,0.95)';
  ctx.lineWidth = 4;
  const r = 8;
  ctx.beginPath();
  ctx.roundRect(S / 2 - r, S / 2 - r, r * 2, r * 2, 3);
  ctx.fill();
  ctx.stroke();
  return Texture.from(c);
}
