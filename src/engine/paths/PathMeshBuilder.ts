import * as THREE from 'three';
import {
  PATH_SURFACE_OFFSET,
  RAIL_HEIGHT_DEFAULT,
  RAIL_POST_INTERVAL,
  SKIRT_OFFSET,
} from '../../config/constants';
import type { PathState } from '../../types/project';
import type { SampledPath } from './pathSampling';
import type { TerrainModel } from '../terrain/TerrainModel';

export interface PathRenderObjects {
  group: THREE.Group;
  dispose: () => void;
}

/** 由采样点与切线求水平法向 */
const horizontalNormal = (t: { x: number; y: number; z: number }): THREE.Vector3 =>
  new THREE.Vector3(t.z, 0, -t.x).normalize();

/** 路面三角带 */
const buildTread = (sampled: SampledPath, width: number, color: number): THREE.Mesh => {
  const n = sampled.points.length;
  const positions = new Float32Array(n * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = sampled.points[i]!;
    const normal = horizontalNormal(sampled.tangents[i]!);
    const lx = p.x + normal.x * (width / 2);
    const lz = p.z + normal.z * (width / 2);
    const rx = p.x - normal.x * (width / 2);
    const rz = p.z - normal.z * (width / 2);
    positions.set([lx, p.y, lz, rx, p.y, rz], i * 6);
    if (i < n - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

/** 护坡：路面边缘顶 → 外侧贴地点的斜裙，两侧各一条 */
const buildSkirts = (
  sampled: SampledPath,
  width: number,
  model: TerrainModel,
): THREE.Mesh => {
  const n = sampled.points.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const side of [1, -1]) {
    const baseVertex = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const p = sampled.points[i]!;
      const normal = horizontalNormal(sampled.tangents[i]!).multiplyScalar(side);
      const edgeX = p.x + normal.x * (width / 2);
      const edgeZ = p.z + normal.z * (width / 2);
      const outX = edgeX + normal.x * SKIRT_OFFSET;
      const outZ = edgeZ + normal.z * SKIRT_OFFSET;
      const groundY = model.sampleHeightBilinear(outX, outZ);
      positions.push(edgeX, p.y - 0.02, edgeZ, outX, groundY, outZ);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = baseVertex + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8d7a61,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
};

/** 护栏：立柱 InstancedMesh + 两道横杆 TubeGeometry */
const buildRailing = (
  sampled: SampledPath,
  width: number,
  railHeight: number,
): { group: THREE.Group; dispose: () => void } => {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, railHeight, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5d4630, roughness: 0.8 });
  disposables.push(postGeo, postMat);

  // 每 RAIL_POST_INTERVAL 米在两侧各立一柱
  const postPositions: THREE.Vector3[] = [];
  let nextDist = 0;
  for (let i = 0; i < sampled.points.length; i++) {
    const d = sampled.cumLen[i]!;
    if (d + 1e-6 < nextDist) continue;
    nextDist = d + RAIL_POST_INTERVAL;
    const p = sampled.points[i]!;
    const normal = horizontalNormal(sampled.tangents[i]!);
    for (const side of [1, -1]) {
      postPositions.push(
        new THREE.Vector3(
          p.x + normal.x * side * (width / 2),
          p.y + railHeight / 2,
          p.z + normal.z * side * (width / 2),
        ),
      );
    }
  }
  const posts = new THREE.InstancedMesh(postGeo, postMat, postPositions.length);
  const m = new THREE.Matrix4();
  postPositions.forEach((p, i) => {
    m.makeTranslation(p.x, p.y, p.z);
    posts.setMatrixAt(i, m);
  });
  posts.castShadow = true;
  group.add(posts);

  // 横杆：沿两侧边缘的 3D 曲线
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6e5438, roughness: 0.8 });
  disposables.push(railMat);
  for (const side of [1, -1]) {
    const edgePts: THREE.Vector3[] = sampled.points.map((p, i) => {
      const normal = horizontalNormal(sampled.tangents[i]!).multiplyScalar(side);
      return new THREE.Vector3(
        p.x + normal.x * (width / 2),
        p.y + railHeight,
        p.z + normal.z * (width / 2),
      );
    });
    const curve = new THREE.CatmullRomCurve3(edgePts, false, 'centripetal');
    for (const ratio of [0.55, 1.0]) {
      const tube = new THREE.TubeGeometry(
        curve,
        Math.min(edgePts.length * 2, 400),
        0.04,
        5,
        false,
      );
      const rail = new THREE.Mesh(tube, railMat);
      rail.position.y = railHeight * (ratio - 1);
      rail.castShadow = true;
      disposables.push(tube);
      group.add(rail);
    }
  }
  return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
};

/** 超限坡度段红色高亮窄带 */
const buildSlopeHighlight = (sampled: SampledPath, width: number): THREE.Mesh | null => {
  if (!sampled.slopeFlags.some(Boolean)) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < sampled.slopeFlags.length; i++) {
    if (!sampled.slopeFlags[i]) continue;
    const base = positions.length / 3;
    for (const k of [i, i + 1]) {
      const p = sampled.points[k]!;
      const normal = horizontalNormal(sampled.tangents[k]!);
      positions.push(
        p.x + normal.x * width * 0.32,
        p.y + PATH_SURFACE_OFFSET + 0.06,
        p.z + normal.z * width * 0.32,
        p.x - normal.x * width * 0.32,
        p.y + PATH_SURFACE_OFFSET + 0.06,
        p.z - normal.z * width * 0.32,
      );
    }
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff3322,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
};

/** 构建一条路径的完整渲染对象 */
export const buildPathObjects = (
  path: PathState,
  sampled: SampledPath,
  model: TerrainModel,
): PathRenderObjects => {
  const group = new THREE.Group();
  group.name = `path-${path.id}`;
  const disposables: { dispose: () => void }[] = [];

  const tread = buildTread(sampled, path.style.width, path.style.color);
  group.add(tread);
  disposables.push(tread.geometry, tread.material as THREE.Material);

  if (path.style.hasWall) {
    const skirts = buildSkirts(sampled, path.style.width, model);
    group.add(skirts);
    disposables.push(skirts.geometry, skirts.material as THREE.Material);
  }

  let railing: ReturnType<typeof buildRailing> | null = null;
  if (path.style.hasRail) {
    railing = buildRailing(sampled, path.style.width, path.style.railHeight || RAIL_HEIGHT_DEFAULT);
    group.add(railing.group);
    disposables.push({ dispose: railing.dispose });
  }

  const highlight = buildSlopeHighlight(sampled, path.style.width);
  if (highlight) {
    group.add(highlight);
    disposables.push(highlight.geometry, highlight.material as THREE.Material);
  }

  return {
    group,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
};
