import * as THREE from 'three';
import type { PartId } from '../types';

/** 一个镂空孔洞(部件局部坐标) */
interface Hole {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/**
 * 各部件轮廓与镂空纹样。
 * 轮廓按"枢轴在原点"绘制:身体的枢轴在髋部、头在颈根、四肢在肩/髋。
 * 镂空用 Shape.holes 描述,经 mask pass 渲染成透光孔。
 */
export function buildPartGeometry(partId: PartId): THREE.BufferGeometry {
  switch (partId) {
    case 'body':
      return makeGeometry(bodyShape(), bodyHoles());
    case 'head':
      return makeGeometry(headShape(), headHoles());
    case 'leftArm':
    case 'rightArm':
      return makeGeometry(armShape(), armHoles());
    case 'leftLeg':
    case 'rightLeg':
      return makeGeometry(legShape(), legHoles());
  }
}

/**
 * 填实几何:与部件同轮廓但不含镂空孔,供遮罩 pass 1 渲染实体剪影
 * (单靠带孔几何无法区分"影偶外部"与"镂空内部")。
 */
export function buildFilledGeometry(partId: PartId): THREE.BufferGeometry {
  switch (partId) {
    case 'body':
      return makeGeometry(bodyShape(), []);
    case 'head':
      return makeGeometry(headShape(), []);
    case 'leftArm':
    case 'rightArm':
      return makeGeometry(armShape(), []);
    case 'leftLeg':
    case 'rightLeg':
      return makeGeometry(legShape(), []);
  }
}

function makeGeometry(shape: THREE.Shape, holes: Hole[]): THREE.BufferGeometry {
  for (const h of holes) {
    const hole = new THREE.Path();
    hole.absellipse(h.x, h.y, h.rx, h.ry, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape, 12);
  geo.computeVertexNormals();
  return geo;
}

/** 躯干:长袍,枢轴在髋部(0,0),向上延伸到 2.05 的颈根 */
function bodyShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.26, 0);
  s.quadraticCurveTo(-0.42, 0.2, -0.4, 0.7); // 袍摆放宽
  s.quadraticCurveTo(-0.38, 1.2, -0.3, 1.6);
  s.quadraticCurveTo(-0.28, 1.9, -0.2, 2.05); // 左肩颈
  s.lineTo(0.2, 2.05); // 右肩颈
  s.quadraticCurveTo(0.28, 1.9, 0.3, 1.6);
  s.quadraticCurveTo(0.38, 1.2, 0.4, 0.7);
  s.quadraticCurveTo(0.42, 0.2, 0.26, 0);
  s.quadraticCurveTo(0, -0.08, -0.26, 0);
  return s;
}

function bodyHoles(): Hole[] {
  return [
    { x: -0.12, y: 0.5, rx: 0.05, ry: 0.14 },
    { x: 0.12, y: 0.5, rx: 0.05, ry: 0.14 },
    { x: 0, y: 0.95, rx: 0.08, ry: 0.08 },
    { x: -0.1, y: 1.35, rx: 0.04, ry: 0.08 },
    { x: 0.1, y: 1.35, rx: 0.04, ry: 0.08 },
    { x: 0, y: 1.7, rx: 0.05, ry: 0.07 },
  ];
}

/** 头:下颌在颈根(0,0),含头顶与帽饰;单连续轮廓 */
function headShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.16, 0);
  s.quadraticCurveTo(-0.24, 0.14, -0.22, 0.32);
  s.quadraticCurveTo(-0.2, 0.5, -0.18, 0.55); // 左头顶
  s.lineTo(-0.08, 0.55); // 帽檐左
  s.lineTo(-0.06, 0.72); // 帽冠左
  s.lineTo(0.06, 0.72); // 帽冠右
  s.lineTo(0.08, 0.55); // 帽檐右
  s.lineTo(0.18, 0.55); // 右头顶
  s.quadraticCurveTo(0.2, 0.5, 0.22, 0.32);
  s.quadraticCurveTo(0.24, 0.14, 0.16, 0);
  s.quadraticCurveTo(0, -0.06, -0.16, 0);
  return s;
}

function headHoles(): Hole[] {
  return [
    { x: -0.09, y: 0.32, rx: 0.04, ry: 0.03 }, // 左眼
    { x: 0.09, y: 0.32, rx: 0.04, ry: 0.03 }, // 右眼
    { x: 0, y: 0.16, rx: 0.03, ry: 0.05 }, // 嘴
    { x: 0, y: 0.63, rx: 0.025, ry: 0.032 }, // 帽花
  ];
}

/** 手臂:窄袖管,枢轴在肩(0,0),长 1.15;镜像由缩放 x 处理 */
function armShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.07, 0);
  s.quadraticCurveTo(-0.085, -0.5, -0.06, -1.0);
  s.quadraticCurveTo(-0.05, -1.12, 0, -1.15);
  s.quadraticCurveTo(0.05, -1.12, 0.06, -1.0);
  s.quadraticCurveTo(0.085, -0.5, 0.07, 0);
  s.quadraticCurveTo(0, 0.04, -0.07, 0);
  return s;
}

function armHoles(): Hole[] {
  return [
    { x: 0, y: -0.32, rx: 0.032, ry: 0.1 },
    { x: 0, y: -0.62, rx: 0.03, ry: 0.09 },
    { x: 0, y: -0.92, rx: 0.025, ry: 0.05 },
  ];
}

/** 腿:窄裤管加靴,枢轴在髋(0,0),长约 1.2 */
function legShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.08, 0);
  s.quadraticCurveTo(-0.1, -0.55, -0.075, -1.0);
  s.lineTo(-0.06, -1.16); // 靴筒
  s.lineTo(0.14, -1.16); // 靴尖
  s.quadraticCurveTo(0.17, -1.1, 0.08, -1.08);
  s.lineTo(0.065, -1.0);
  s.quadraticCurveTo(0.1, -0.55, 0.08, 0);
  s.quadraticCurveTo(0, 0.04, -0.08, 0);
  return s;
}

function legHoles(): Hole[] {
  return [
    { x: 0, y: -0.35, rx: 0.032, ry: 0.1 },
    { x: 0, y: -0.68, rx: 0.03, ry: 0.09 },
    { x: 0, y: -0.97, rx: 0.025, ry: 0.05 },
  ];
}

/** 影偶皮革材质(主场景观察用) */
export function leatherMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x9a6a35,
    roughness: 0.72,
    metalness: 0.06,
    side: THREE.DoubleSide,
  });
}
