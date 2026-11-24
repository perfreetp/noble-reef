import * as THREE from 'three';

/** 生成文字精灵(朝向始终面向相机) */
export function makeTextSprite(text, { fontSize = 30, color = '#9fc5ff', worldH = 7 } = {}) {
  const pad = 14;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  const font = `${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.height = fontSize + pad * 2;
  ctx = c.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = 7;
  ctx.fillStyle = color;
  ctx.fillText(text, c.width / 2, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((worldH * c.width) / c.height, worldH, 1);
  return sprite;
}
