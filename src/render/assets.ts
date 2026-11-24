import { Texture } from 'pixi.js';

/**
 * 程序化素材库:全部贴图由 Canvas 2D 生成,零外部资源依赖。
 * 每个素材包含:
 *  - color:  基色 RGBA(alpha 即饰片剪影)
 *  - normal: 法线 RG(nx/ny 编码到 0..1),珠粒与錾片需要
 *  - filter: 各向异性滤镜像 RG(cos2φ, sin2φ 切线场),仅翠片需要
 */
export interface AssetEntry {
  id: string;
  name: string;
  kind: 'kingfisher' | 'pearl' | 'champleve';
  color: Texture;
  normal: Texture | null;
  filter: Texture | null;
  thumb: string;
}

const SIZE = 256;

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.autoGenerateMipmaps = true;
  t.source.scaleMode = 'linear';
  return t;
}

/** 法线分量 0..1 编码 */
function enc(v: number): number {
  return Math.round((v * 0.5 + 0.5) * 255);
}

// ---------- 翠羽(点翠片) ----------

function featherPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, SIZE * 0.06);
  ctx.bezierCurveTo(SIZE * 0.92, SIZE * 0.3, SIZE * 0.86, SIZE * 0.78, SIZE / 2, SIZE * 0.95);
  ctx.bezierCurveTo(SIZE * 0.14, SIZE * 0.78, SIZE * 0.08, SIZE * 0.3, SIZE / 2, SIZE * 0.06);
  ctx.closePath();
}

function makeKingfisher(id: string, name: string, hueA: string, hueB: string): AssetEntry {
  const [cc, ctx] = makeCanvas();
  featherPath(ctx);
  ctx.save();
  ctx.clip();
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, hueA);
  grad.addColorStop(0.55, hueB);
  grad.addColorStop(1, '#041828');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // 羽枝细纹
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 46; i++) {
    const y = SIZE * 0.1 + i * SIZE * 0.018;
    ctx.strokeStyle = i % 2 ? '#b8f4ff' : '#0a3550';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(SIZE * 0.5, y);
    ctx.quadraticCurveTo(SIZE * 0.7, y + 10, SIZE * 0.88, y + 26);
    ctx.moveTo(SIZE * 0.5, y);
    ctx.quadraticCurveTo(SIZE * 0.3, y + 10, SIZE * 0.12, y + 26);
    ctx.stroke();
  }
  // 羽轴
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#9fe8ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, SIZE * 0.08);
  ctx.lineTo(SIZE / 2, SIZE * 0.94);
  ctx.stroke();
  ctx.restore();

  // 滤镜像:切线场沿羽轴(近似垂直方向 φ≈π/2),羽枝处轻微摆动
  [, ] = [cc, ctx];
  const [fc, fctx] = makeCanvas();
  const fimg = fctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE - 0.5;
      const v = y / SIZE - 0.5;
      const phi = Math.PI / 2 + 0.35 * u + 0.08 * Math.sin(v * 22);
      const i = (y * SIZE + x) * 4;
      fimg.data[i] = Math.round((Math.cos(2 * phi) * 0.5 + 0.5) * 255);
      fimg.data[i + 1] = Math.round((Math.sin(2 * phi) * 0.5 + 0.5) * 255);
      fimg.data[i + 2] = 128;
      fimg.data[i + 3] = 255;
    }
  }
  fctx.putImageData(fimg, 0, 0);

  const color = toTexture(cc);
  const filter = toTexture(fc);
  return { id, name, kind: 'kingfisher', color, filter, normal: null, thumb: cc.toDataURL() };
}

// ---------- 珠粒 ----------

function makePearl(): AssetEntry {
  const [cc, ctx] = makeCanvas();
  const img = ctx.createImageData(SIZE, SIZE);
  const [nc, nctx] = makeCanvas();
  const nimg = nctx.createImageData(SIZE, SIZE);
  const cx = 0.5;
  const cy = 0.5;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE - cx) * 2;
      const v = (y / SIZE - cy) * 2;
      const r2 = u * u + v * v;
      const i = (y * SIZE + x) * 4;
      if (r2 >= 1) {
        img.data[i + 3] = 0;
        nimg.data[i + 3] = 0;
        continue;
      }
      const nz = Math.sqrt(1 - r2);
      // 基色:珍珠白 + 虹彩薄层干涉色
      const irid = 0.5 + 0.5 * Math.sin(9 * Math.sqrt(r2) + 3 * Math.atan2(v, u));
      const shade = 0.55 + 0.45 * nz;
      img.data[i] = Math.min(255, 235 * shade + 34 * irid);
      img.data[i + 1] = Math.min(255, 228 * shade + 22 * (1 - irid));
      img.data[i + 2] = Math.min(255, 232 * shade + 40 * irid);
      img.data[i + 3] = 255;
      nimg.data[i] = enc(u);
      nimg.data[i + 1] = enc(v);
      nimg.data[i + 2] = enc(nz);
      nimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  // 高光点
  const hg = ctx.createRadialGradient(SIZE * 0.36, SIZE * 0.3, 2, SIZE * 0.36, SIZE * 0.3, SIZE * 0.22);
  hg.addColorStop(0, 'rgba(255,255,255,0.95)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return {
    id: 'pearl-round',
    name: '珠粒',
    kind: 'pearl',
    color: toTexture(cc),
    normal: toTexture(nc),
    filter: null,
    thumb: cc.toDataURL(),
  };
}

// ---------- 錾片(金银饰片) ----------

function plaquePath(ctx: CanvasRenderingContext2D): void {
  const r = SIZE * 0.42;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  ctx.beginPath();
  // 海棠形錾片:四段弧
  for (let k = 0; k < 4; k++) {
    const a0 = (k * Math.PI) / 2 + Math.PI / 4;
    const a1 = ((k + 1) * Math.PI) / 2 + Math.PI / 4;
    const am = (a0 + a1) / 2;
    const bx = cx + Math.cos(a0) * r;
    const by = cy + Math.sin(a0) * r;
    const mx = cx + Math.cos(am) * r * 1.22;
    const my = cy + Math.sin(am) * r * 1.22;
    const ex = cx + Math.cos(a1) * r;
    const ey = cy + Math.sin(a1) * r;
    if (k === 0) ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(mx, my, ex, ey);
  }
  ctx.closePath();
}

function makeChampleve(id: string, name: string, gold: boolean): AssetEntry {
  const [cc, ctx] = makeCanvas();
  plaquePath(ctx);
  ctx.save();
  ctx.clip();
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  if (gold) {
    grad.addColorStop(0, '#fff2b0');
    grad.addColorStop(0.4, '#d9a227');
    grad.addColorStop(0.75, '#8a5a12');
    grad.addColorStop(1, '#f6d47a');
  } else {
    grad.addColorStop(0, '#f4f6fa');
    grad.addColorStop(0.45, '#b9c0cc');
    grad.addColorStop(0.8, '#6d7480');
    grad.addColorStop(1, '#e6ebf2');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 錾刻纹:同心卷草
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = gold ? 'rgba(70,40,6,0.9)' : 'rgba(40,46,56,0.9)';
  for (let k = 0; k < 5; k++) {
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 26 + k * 17, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = gold ? 'rgba(255,240,190,0.9)' : 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.4;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, SIZE / 2);
    ctx.quadraticCurveTo(
      SIZE / 2 + Math.cos(a + 0.4) * 60,
      SIZE / 2 + Math.sin(a + 0.4) * 60,
      SIZE / 2 + Math.cos(a) * 105,
      SIZE / 2 + Math.sin(a) * 105,
    );
    ctx.stroke();
  }
  ctx.restore();

  // 法线贴图:平面 + 錾沟下凹
  const [nc, nctx] = makeCanvas();
  const nimg = nctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - SIZE / 2;
      const dy = y - SIZE / 2;
      const r = Math.hypot(dx, dy);
      const groove = Math.sin(r * 0.36) * 0.16; // 同心沟
      const nx = groove * (dx / (r + 1e-3));
      const ny = groove * (dy / (r + 1e-3));
      const i = (y * SIZE + x) * 4;
      nimg.data[i] = enc(nx);
      nimg.data[i + 1] = enc(ny);
      nimg.data[i + 2] = 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  return {
    id,
    name,
    kind: 'champleve',
    color: toTexture(cc),
    normal: toTexture(nc),
    filter: null,
    thumb: cc.toDataURL(),
  };
}

export class AssetLibrary {
  readonly entries = new Map<string, AssetEntry>();

  static createDefault(): AssetLibrary {
    const lib = new AssetLibrary();
    lib.register(makeKingfisher('kingfisher-blue', '翠片·宝蓝', '#0e5f8f', '#18b4c8'));
    lib.register(makeKingfisher('kingfisher-teal', '翠片·雀青', '#0b7a6e', '#37d6b4'));
    lib.register(makePearl());
    lib.register(makeChampleve('champleve-gold', '錾片·金', true));
    lib.register(makeChampleve('champleve-silver', '錾片·银', false));
    return lib;
  }

  register(a: AssetEntry): void {
    this.entries.set(a.id, a);
  }

  get(id: string): AssetEntry {
    const a = this.entries.get(id);
    if (!a) throw new Error(`素材不存在: ${id}`);
    return a;
  }

  byKind(kind: AssetEntry['kind']): AssetEntry[] {
    return [...this.entries.values()].filter((a) => a.kind === kind);
  }

  all(): AssetEntry[] {
    return [...this.entries.values()];
  }
}
