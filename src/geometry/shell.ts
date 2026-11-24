import * as THREE from 'three';
import earcut from 'earcut';
import type { ThinCornerWarning, Vec3 } from '../types';
import { ensureBVH } from './bvh';

/**
 * Builds the closed cavity brush used by CSG subtraction. The curved component
 * follows the original vertex normals; the parting-side transition is closed by
 * a short skirt and a planar inner cap parallel to the sealed cut face.
 */
export function buildShellCavityGeometry(
  bodyGeometry: THREE.BufferGeometry,
  loops: Vec3[][],
  h: number,
  thickness: number,
  side: 'lower' | 'upper',
): THREE.BufferGeometry {
  const inwardY = side === 'lower' ? -1 : 1;
  const src = bodyGeometry.index ? bodyGeometry.toNonIndexed() : bodyGeometry;
  const pos = src.attributes.position as THREE.BufferAttribute;
  const normal = src.attributes.normal as THREE.BufferAttribute;

  const positions: number[] = [];
  const normals: number[] = [];

  // Uniform normal offset of all curved outer surfaces.
  for (let i = 0; i < pos.count; i++) {
    const t = thickness;
    positions.push(pos.getX(i) - normal.getX(i) * t, pos.getY(i) - normal.getY(i) * t, pos.getZ(i) - normal.getZ(i) * t);
    normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
  }

  const yInner = h + inwardY * thickness;
  const capNormal = new THREE.Vector3(0, -inwardY, 0);

  for (const loop of loops.slice(0, 8)) {
    if (loop.length < 3) continue;
    const centroid = loop.reduce<THREE.Vector3>((acc, p) => acc.add(new THREE.Vector3(p.x, h, p.z)), new THREE.Vector3()).multiplyScalar(1 / loop.length);

    const top: THREE.Vector3[] = [];
    const inner: THREE.Vector3[] = [];
    for (const p of loop) {
      const radial = new THREE.Vector3(p.x - centroid.x, 0, p.z - centroid.z);
      const dist = radial.length();
      radial.normalize();
      const inset = Math.min(thickness * 0.9, dist * 0.22);
      // Approximate the normal-offset boundary, then connect to a parallel cap.
      top.push(new THREE.Vector3(p.x, h + inwardY * 0.12, p.z));
      inner.push(new THREE.Vector3(p.x - radial.x * inset, yInner, p.z - radial.z * inset));
    }

    // Skirt triangles.
    for (let i = 0; i < loop.length; i++) {
      const j = (i + 1) % loop.length;
      const a = top[i];
      const b = top[j];
      const c = inner[i];
      const d = inner[j];
      for (const v of [a, c, b, b, c, d]) {
        positions.push(v.x, v.y, v.z);
        normals.push(0, 0, 0);
      }
    }

    const flat: number[] = [];
    inner.forEach((p) => flat.push(p.x, p.z));
    let indices: number[] = [];
    try {
      indices = earcut(flat, [], 2);
    } catch {
      indices = [];
    }
    for (const idx of indices) {
      const p = inner[idx];
      positions.push(p.x, yInner, p.z);
      normals.push(capNormal.x, capNormal.y, capNormal.z);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/** Non-CSG normal-offset surface used as a reliable preview/fallback. */
export function buildOffsetShellPreview(
  bodyGeometry: THREE.BufferGeometry,
  thickness: number,
): THREE.BufferGeometry {
  const src = bodyGeometry.index ? bodyGeometry.toNonIndexed() : bodyGeometry;
  const pos = src.attributes.position as THREE.BufferAttribute;
  const normal = src.attributes.normal as THREE.BufferAttribute;
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i) - normal.getX(i) * thickness;
    positions[i * 3 + 1] = pos.getY(i) - normal.getY(i) * thickness;
    positions[i * 3 + 2] = pos.getZ(i) - normal.getZ(i) * thickness;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

export function detectThinCorners(
  geometry: THREE.BufferGeometry,
  threshold: number,
  maxWarnings = 10,
): ThinCornerWarning[] {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const bvh = ensureBVH(src);
  const pos = src.attributes.position as THREE.BufferAttribute;
  const normal = src.attributes.normal as THREE.BufferAttribute | undefined;
  const warnings: ThinCornerWarning[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const faceN = new THREE.Vector3();
  const vertexN = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const ray = new THREE.Ray();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  const triCount = Math.floor(pos.count / 3);
  const stride = Math.max(1, Math.floor(triCount / 1200));

  for (let t = 0; t < triCount; t += stride) {
    const i0 = t * 3;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i0 + 1);
    c.fromBufferAttribute(pos, i0 + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const doubleArea = ab.clone().cross(ac).length();
    const area = doubleArea * 0.5;
    // Lathe poles and imported degenerate fans produce zero-length false corners.
    if (area < 0.8) continue;

    faceN.copy(ab).cross(ac).normalize();
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);

    let cornerish = false;
    let chosen = centroid.clone();
    let worstDot = 1;
    for (let k = 0; k < 3; k++) {
      if (!normal) continue;
      vertexN.fromBufferAttribute(normal, i0 + k).normalize();
      const dot = Math.abs(vertexN.dot(faceN));
      if (dot < worstDot) {
        worstDot = dot;
        chosen = [a, b, c][k].clone();
      }
      if (dot < 0.94) cornerish = true;
    }
    if (!cornerish) continue;

    direction.copy(faceN).negate();
    const samples: number[] = [];
    const directions = [
      direction,
      direction.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.16).normalize(),
      direction.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.16).normalize(),
    ];
    for (const dir of directions) {
      origin.copy(centroid).addScaledVector(dir, 0.45);
      ray.set(origin, dir);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0.25, 180);
      if (hit) samples.push(hit.distance + 0.45);
    }
    if (!samples.length) continue;
    samples.sort((x, y) => x - y);
    const thickness = samples[Math.floor(samples.length / 2)];

    if (thickness < threshold && thickness > 0.6) {
      const tooClose = warnings.some((w) => Math.hypot(w.x - chosen.x, w.y - chosen.y, w.z - chosen.z) < 8);
      if (!tooClose) {
        warnings.push({
          x: chosen.x,
          y: chosen.y,
          z: chosen.z,
          thickness: Math.max(0.8, Math.min(thickness, threshold)),
          required: threshold,
        });
      }
    }
    if (warnings.length >= maxWarnings) break;
  }
  return warnings;
}
