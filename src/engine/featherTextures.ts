import * as THREE from 'three';
import { mulberry32 } from './util';
import { TEXTURE_COUNT } from './types';

const W = 256;
const H = 512;

/** 翠羽四大色系:青碧 / 宝蓝 / 松绿 / 紫晶 */
const PALETTES = [
  { deep: '#0a3542', mid: '#0f94a8', bright: '#63e6d4', stripe: 'rgba(3,26,32,0.55)' },
  { deep: '#0a1c56', mid: '#1f56e8', bright: '#86ccff', stripe: 'rgba(4,12,44,0.55)' },
  { deep: '#053526', mid: '#0b9e6c', bright: '#93f2c2', stripe: 'rgba(3,30,20,0.55)' },
  { deep: '#251252', mid: '#6a3fd4', bright: '#d0aaff', stripe: 'rgba(18,8,44,0.55)' },
];

function drawPattern(g: CanvasRenderingContext2D, pattern: number, stripe: string, rng: () => number) {
  g.save();
  switch (pattern) {
    case 0: {
      // 横纹
      const n = 6 + Math.floor(rng() * 5);
      for (let i = 0; i < n; i++) {
        const y = (i + 0.5) * (H / n) + (rng() - 0.5) * 14;
        g.fillStyle = stripe;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x * 0.06 + i) * 5);
        g.lineTo(W, y + 9 + rng() * 8);
        g.lineTo(0, y + 9 + rng() * 8);
        g.closePath();
        g.fill();
      }
      break;
    }
    case 1: {
      // 斜纹
      g.translate(W / 2, H / 2);
      g.rotate(0.5 + rng() * 0.3);
      g.fillStyle = stripe;
      const n = 8 + Math.floor(rng() * 5);
      for (let i = -n; i < n; i++) g.fillRect(-H, i * 46, H * 2, 9 + rng() * 8);
      break;
    }
    case 2: {
      // 折线翎斑
      g.strokeStyle = stripe;
      g.lineWidth = 7 + rng() * 5;
      const n = 7 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const y = (i + 0.6) * (H / n);
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= W; x += 32) g.lineTo(x, y + ((x / 32 + i) % 2 === 0 ? -9 : 9));
        g.stroke();
      }
      break;
    }
    case 3: {
      // 斑点
      g.fillStyle = stripe;
      const n = 60 + Math.floor(rng() * 50);
      for (let i = 0; i < n; i++) {
        const x = rng() * W;
        const y = rng() * H;
        g.beginPath();
        g.ellipse(x, y, 2.5 + rng() * 5, 5 + rng() * 9, (rng() - 0.5) * 0.6, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 4: {
      // 细纵纹
      g.fillStyle = stripe;
      const n = 26 + Math.floor(rng() * 14);
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * (W / n) + (rng() - 0.5) * 4;
        g.fillRect(x, 0, 1.4 + rng() * 1.6, H);
      }
      break;
    }
    default: {
      // 流光晕
      for (let i = 0; i < 5; i++) {
        const x = rng() * W;
        const y = rng() * H;
        const r = 60 + rng() * 90;
        const rg = g.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, 'rgba(255,255,255,0.20)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg;
        g.fillRect(0, 0, W, H);
      }
    }
  }
  g.restore();
}

/**
 * 生成翠羽条纹画布。同一 (index, density, grainDir) 输出确定。
 * density 控制纤维丝数量,grainDir 控制丝理走向(倾斜)。
 */
export function makeFeatherCanvas(index: number, density: number, grainDir: number): HTMLCanvasElement {
  const pal = PALETTES[index % PALETTES.length];
  const pattern = Math.floor(index / PALETTES.length) % 6;
  const rng = mulberry32(index * 7919 + 101);

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  // 基底纵向渐变
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, pal.bright);
  grad.addColorStop(0.45, pal.mid);
  grad.addColorStop(1, pal.deep);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  drawPattern(g, pattern, pal.stripe, rng);

  // 纤维丝理:数量随密度,走向随 grainDir
  const streaks = Math.round(90 + density * 230);
  g.globalAlpha = 0.15;
  g.lineCap = 'round';
  for (let i = 0; i < streaks; i++) {
    const x = rng() * W;
    const light = rng() > 0.45;
    g.strokeStyle = light ? 'rgba(235,255,250,0.55)' : 'rgba(0,18,26,0.6)';
    g.lineWidth = 0.6 + rng() * 1.1;
    const skew = grainDir * 46 + (rng() - 0.5) * 12;
    g.beginPath();
    g.moveTo(x, -4);
    g.quadraticCurveTo(x + skew * 0.5, H * 0.5, x + skew, H + 4);
    g.stroke();
  }
  g.globalAlpha = 1;

  // 边缘绒毛:用 destination-out 啃出绒边与羽尖
  g.globalCompositeOperation = 'destination-out';
  const fz = mulberry32(index * 331 + 7);
  for (let i = 0; i < 300; i++) {
    const side = fz() > 0.5 ? 1 : -1;
    const y = fz() * H;
    const depth = 3 + fz() * 15;
    const x = side > 0 ? W : 0;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - side * depth, y + 2 + fz() * 6);
    g.lineTo(x, y + 7 + fz() * 9);
    g.closePath();
    g.fill();
  }
  // 羽尖碎绒
  for (let i = 0; i < 60; i++) {
    const x = fz() * W;
    const y = fz() * 26;
    g.fillRect(x, y, 1 + fz() * 2, 4 + fz() * 12);
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

export function makeFeatherTexture(index: number, density: number, grainDir: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(makeFeatherCanvas(index, density, grainDir));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export { TEXTURE_COUNT };
