import * as THREE from 'three';

export type PlateKind = 'flat' | 'bowl' | 'slanted';

export const PLATE_RADIUS = 2;

export const PLATE_LABELS: Record<PlateKind, string> = {
  flat: '平盘',
  bowl: '浅碗',
  slanted: '斜口盘',
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 盘面高度场:给定盘面局部坐标 (x,z),返回盘面表面高度 y */
export function plateHeight(kind: PlateKind, x: number, z: number): number {
  const r = Math.hypot(x, z);
  switch (kind) {
    case 'flat':
      // 中心平整,边缘微微上翘的圈足盘沿
      return 0.02 * smoothstep(0, 1.5, r) + 0.16 * smoothstep(1.5, 1.95, r);
    case 'bowl': {
      // 浅碗:中心凹陷,抛物面上升
      const t = Math.min(r / PLATE_RADIUS, 1);
      return 0.34 * t * t;
    }
    case 'slanted': {
      // 斜口盘:一侧抬高的倾斜盘面 + 盘沿
      const rim = 0.14 * smoothstep(1.5, 1.95, r);
      return rim + 0.2 * (x / PLATE_RADIUS) + 0.2;
    }
  }
}

/** 构建盘体几何:高度场上表面 + 侧壁 + 底面 */
export function buildPlateGeometry(kind: PlateKind): THREE.BufferGeometry {
  const R = PLATE_RADIUS;
  const rings = 64;
  const sectors = 128;
  const bottomY = -0.14;
  const pos: number[] = [];
  const idx: number[] = [];

  // 上表面(径向网格)
  for (let i = 0; i <= rings; i++) {
    const r = (R * i) / rings;
    for (let j = 0; j < sectors; j++) {
      const a = (j / sectors) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pos.push(x, plateHeight(kind, x, z), z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = i * sectors + j;
      const b = i * sectors + ((j + 1) % sectors);
      const c = (i + 1) * sectors + j;
      const d = (i + 1) * sectors + ((j + 1) % sectors);
      idx.push(a, b, c, b, d, c);
    }
  }

  // 侧壁
  const wallStart = pos.length / 3;
  for (let j = 0; j < sectors; j++) {
    const a = (j / sectors) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    pos.push(x, plateHeight(kind, x, z), z);
    pos.push(x, bottomY, z);
  }
  for (let j = 0; j < sectors; j++) {
    const t0 = wallStart + j * 2;
    const b0 = wallStart + j * 2 + 1;
    const t1 = wallStart + ((j + 1) % sectors) * 2;
    const b1 = wallStart + ((j + 1) % sectors) * 2 + 1;
    idx.push(t0, t1, b0, b0, t1, b1);
  }

  // 底面
  const centerIdx = pos.length / 3;
  pos.push(0, bottomY, 0);
  const ringStart = pos.length / 3;
  for (let j = 0; j < sectors; j++) {
    const a = (j / sectors) * Math.PI * 2;
    pos.push(Math.cos(a) * R, bottomY, Math.sin(a) * R);
  }
  for (let j = 0; j < sectors; j++) {
    idx.push(centerIdx, ringStart + j, ringStart + ((j + 1) % sectors));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
