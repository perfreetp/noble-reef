import * as THREE from 'three';
import { radiusAt } from './curve';

/**
 * 变截面管几何构建：沿中心线扫掠圆形截面，半径随 t 收缩。
 * 手写而非 TubeGeometry，因为需要根部粗、梢端细的发束形态。
 */
export function buildTaperedTube(
  points: THREE.Vector3[],
  thickness: number,
  radialSegments = 5,
): { positions: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const n = points.length;
  const ringVerts = radialSegments + 1;
  const vertCount = n * ringVerts;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint16Array((n - 1) * radialSegments * 6);

  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const ref = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = points[i]!;
    // 切线
    if (i === 0) tangent.subVectors(points[1]!, p);
    else if (i === n - 1) tangent.subVectors(p, points[i - 1]!);
    else tangent.subVectors(points[i + 1]!, points[i - 1]!);
    tangent.normalize();
    // 截面法向框架
    ref.set(0, 1, 0);
    if (Math.abs(tangent.y) > 0.9) ref.set(1, 0, 0);
    normal.crossVectors(tangent, ref).normalize();
    binormal.crossVectors(tangent, normal).normalize();

    const r = radiusAt(thickness, t);
    for (let j = 0; j <= radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      radial
        .set(
          normal.x * cos + binormal.x * sin,
          normal.y * cos + binormal.y * sin,
          normal.z * cos + binormal.z * sin,
        )
        .normalize();
      const vi = (i * ringVerts + j) * 3;
      positions[vi] = p.x + radial.x * r;
      positions[vi + 1] = p.y + radial.y * r;
      positions[vi + 2] = p.z + radial.z * r;
      normals[vi] = radial.x;
      normals[vi + 1] = radial.y;
      normals[vi + 2] = radial.z;
    }
  }

  let ii = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      indices[ii++] = a;
      indices[ii++] = b;
      indices[ii++] = a + 1;
      indices[ii++] = b;
      indices[ii++] = b + 1;
      indices[ii++] = a + 1;
    }
  }
  return { positions, normals, indices };
}
