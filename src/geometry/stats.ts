import * as THREE from 'three';

export function geometryTriangleCount(g: THREE.BufferGeometry | null | undefined): number {
  if (!g) return 0;
  if (g.index) return Math.round(g.index.count / 3);
  return Math.round((g.attributes.position?.count ?? 0) / 3);
}

export function geometryVolumeMm3(g: THREE.BufferGeometry | null | undefined): number {
  if (!g || !g.attributes.position) return 0;
  const p = g.attributes.position as THREE.BufferAttribute;
  const index = g.index;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let sum = 0;

  const readTri = (ia: number, ib: number, ic: number) => {
    a.fromBufferAttribute(p, ia);
    b.fromBufferAttribute(p, ib);
    c.fromBufferAttribute(p, ic);
    sum += a.dot(b.clone().cross(c));
  };

  if (index) {
    for (let i = 0; i < index.count; i += 3) readTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  } else {
    for (let i = 0; i < p.count; i += 3) readTri(i, i + 1, i + 2);
  }
  return Math.abs(sum) / 6;
}

export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
