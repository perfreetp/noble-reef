import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeBubbleDino, makeSentinel, makeStarFigure } from './builtinModels';

export interface LibraryModelInfo {
  id: string;
  name: string;
  description: string;
  tag: string;
}

export const LIBRARY_MODELS: LibraryModelInfo[] = [
  {
    id: 'builtin-neko',
    name: '星愿人形手办',
    description: '闭合车削曲面，截面规则，适合练习分模线和 4–6 个榫卯。',
    tag: '经典站姿',
  },
  {
    id: 'builtin-mecha',
    name: '机甲哨兵立柱',
    description: '阶梯硬表面与宽窄截面，可验证薄壁避让和冲突标红。',
    tag: '硬表面',
  },
  {
    id: 'builtin-dino',
    name: '泡泡圆仔',
    description: '圆润宽腹曲面，截面变化柔和，适合测试网格排布。',
    tag: '圆润曲面',
  },
];

const registry = new Map<string, THREE.BufferGeometry>();

export function registerGeometry(id: string, geometry: THREE.BufferGeometry) {
  registry.set(id, geometry);
}

export function getGeometry(id: string): THREE.BufferGeometry | undefined {
  return registry.get(id);
}

function transformed(
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
  m.compose(new THREE.Vector3(...position), q, new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  return g;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = parts.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.normal) ng.computeVertexNormals();
    if (!ng.attributes.uv) {
      ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    }
    ng.deleteAttribute('color');
    return ng;
  });
  const merged = mergeGeometries(normalized, false);
  if (!merged) throw new Error('无法合并内置模型部件');
  return merged;
}

function makeNeko(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(transformed(new THREE.CylinderGeometry(36, 40, 8, 48), [0, 4, 0]));
  parts.push(transformed(new THREE.CylinderGeometry(34, 36, 5, 48), [0, 10.5, 0]));

  parts.push(transformed(new THREE.CapsuleGeometry(7.5, 24, 8, 20), [-10, 27, 1]));
  parts.push(transformed(new THREE.CapsuleGeometry(7.5, 24, 8, 20), [10, 27, 1]));
  parts.push(transformed(new THREE.SphereGeometry(9, 24, 16), [-10, 15, 5], [0, 0, 0], [1.25, 0.55, 1.5]));
  parts.push(transformed(new THREE.SphereGeometry(9, 24, 16), [10, 15, 5], [0, 0, 0], [1.25, 0.55, 1.5]));

  parts.push(transformed(new THREE.CylinderGeometry(18, 29, 30, 40, 1, false), [0, 45, 0]));
  parts.push(transformed(new THREE.CapsuleGeometry(16, 24, 10, 28), [0, 64, 0], [0, 0, 0], [1.05, 1, 0.82]));

  parts.push(transformed(new THREE.CapsuleGeometry(6, 25, 8, 18), [-22, 64, 0], [0, 0, 0.22]));
  parts.push(transformed(new THREE.CapsuleGeometry(6, 25, 8, 18), [22, 64, 0], [0, 0, -0.22]));
  parts.push(transformed(new THREE.SphereGeometry(6.5, 18, 12), [-26, 49, 1], [0, 0, 0], [1, 0.8, 1]));
  parts.push(transformed(new THREE.SphereGeometry(6.5, 18, 12), [26, 49, 1], [0, 0, 0], [1, 0.8, 1]));

  parts.push(transformed(new THREE.SphereGeometry(21, 36, 24), [0, 94, 0], [0, 0, 0], [1.02, 1.04, 0.96]));
  parts.push(transformed(new THREE.SphereGeometry(21.5, 32, 20), [0, 96, -5], [0, 0, 0], [1.04, 1.08, 0.92]));
  parts.push(transformed(new THREE.SphereGeometry(3.2, 16, 10), [-7, 97, 18.5]));
  parts.push(transformed(new THREE.SphereGeometry(3.2, 16, 10), [7, 97, 18.5]));

  parts.push(transformed(new THREE.ConeGeometry(7.5, 18, 24), [-12, 115, 0], [0.12, 0, 0.18]));
  parts.push(transformed(new THREE.ConeGeometry(7.5, 18, 24), [12, 115, 0], [0.12, 0, -0.18]));

  // A small rear hair tuft gives the raycast/BVH path a non-trivial silhouette.
  parts.push(transformed(new THREE.ConeGeometry(9, 28, 24), [0, 88, -18], [-0.72, 0, 0]));
  return normalizeGeometry(mergeParts(parts), 128);
}

function makeMecha(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(transformed(new THREE.CylinderGeometry(38, 42, 9, 8), [0, 4.5, 0]));
  parts.push(transformed(new THREE.BoxGeometry(15, 34, 16), [-12, 27, 0]));
  parts.push(transformed(new THREE.BoxGeometry(15, 34, 16), [12, 27, 0]));
  parts.push(transformed(new THREE.BoxGeometry(20, 10, 24), [-12, 12, 4]));
  parts.push(transformed(new THREE.BoxGeometry(20, 10, 24), [12, 12, 4]));

  parts.push(transformed(new THREE.BoxGeometry(42, 38, 24), [0, 61, 0]));
  parts.push(transformed(new THREE.BoxGeometry(30, 18, 28), [0, 65, 2]));
  parts.push(transformed(new THREE.BoxGeometry(48, 12, 20), [0, 82, 0]));

  parts.push(transformed(new THREE.BoxGeometry(13, 34, 14), [-31, 61, 0], [0, 0, -0.12]));
  parts.push(transformed(new THREE.BoxGeometry(13, 34, 14), [31, 61, 0], [0, 0, 0.12]));
  parts.push(transformed(new THREE.SphereGeometry(10, 20, 14), [-27, 80, 0]));
  parts.push(transformed(new THREE.SphereGeometry(10, 20, 14), [27, 80, 0]));

  parts.push(transformed(new THREE.BoxGeometry(24, 22, 22), [0, 98, 0]));
  parts.push(transformed(new THREE.BoxGeometry(18, 7, 4), [0, 99, 12]));
  parts.push(transformed(new THREE.CylinderGeometry(2, 2, 24, 12), [10, 115, 0]));
  parts.push(transformed(new THREE.SphereGeometry(4, 16, 10), [10, 128, 0]));

  parts.push(transformed(new THREE.BoxGeometry(10, 28, 8), [0, 58, -15]));
  return normalizeGeometry(mergeParts(parts), 132);
}

function makeDino(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(transformed(new THREE.SphereGeometry(28, 32, 22), [0, 48, 0], [0, 0, 0], [1.05, 1.18, 0.9]));
  parts.push(transformed(new THREE.SphereGeometry(20, 28, 18), [0, 82, 10], [0, 0, 0], [1.05, 1, 0.95]));
  parts.push(transformed(new THREE.SphereGeometry(15, 24, 16), [0, 78, 27], [0, 0, 0], [1.25, 0.72, 1.05]));

  parts.push(transformed(new THREE.SphereGeometry(11, 22, 14), [-18, 25, 4], [0, 0, 0], [0.9, 1.25, 1]));
  parts.push(transformed(new THREE.SphereGeometry(11, 22, 14), [18, 25, 4], [0, 0, 0], [0.9, 1.25, 1]));
  parts.push(transformed(new THREE.SphereGeometry(13, 18, 12), [-18, 12, 10], [0, 0, 0], [1.25, 0.55, 1.5]));
  parts.push(transformed(new THREE.SphereGeometry(13, 18, 12), [18, 12, 10], [0, 0, 0], [1.25, 0.55, 1.5]));

  parts.push(transformed(new THREE.ConeGeometry(13, 48, 24), [0, 43, -34], [-1.18, 0, 0]));
  parts.push(transformed(new THREE.ConeGeometry(8, 28, 20), [0, 52, -58], [-1.35, 0, 0]));

  for (let i = 0; i < 5; i++) {
    const z = 18 - i * 13;
    const y = 105 - i * 9;
    parts.push(transformed(new THREE.ConeGeometry(6 - i * 0.55, 16 - i, 16), [0, y, z]));
  }

  parts.push(transformed(new THREE.SphereGeometry(4, 16, 10), [-8, 87, 25]));
  parts.push(transformed(new THREE.SphereGeometry(4, 16, 10), [8, 87, 25]));
  return normalizeGeometry(mergeParts(parts), 118);
}

export function createBuiltinGeometry(id: string): THREE.BufferGeometry {
  let raw: THREE.BufferGeometry;
  if (id === 'builtin-mecha') raw = makeSentinel();
  else if (id === 'builtin-dino') raw = makeBubbleDino();
  else raw = makeStarFigure();
  const g = normalizeGeometry(raw, 124);
  registerGeometry(id, g);
  return g;
}

export function ensureLibraryRegistered() {
  for (const m of LIBRARY_MODELS) {
    if (!registry.has(m.id)) createBuiltinGeometry(m.id);
  }
}

export function normalizeGeometry(input: THREE.BufferGeometry, targetHeight = 110): THREE.BufferGeometry {
  let g = input.index ? input.toNonIndexed() : input.clone();
  if (!g.attributes.normal) g.computeVertexNormals();

  g.computeBoundingBox();
  const box = g.boundingBox ?? new THREE.Box3();
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(size.y, 0.001);
  const scale = targetHeight / height;
  const center = box.getCenter(new THREE.Vector3());

  g.translate(-center.x, -box.min.y, -center.z);
  g.scale(scale, scale, scale);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

function mergeObject3D(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const geoms: THREE.BufferGeometry[] = [];
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const source = mesh.geometry;
    if (!source) return;
    const g = source.index ? source.toNonIndexed() : source.clone();
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    geoms.push(g);
  });
  if (!geoms.length) throw new Error('文件中没有找到可导出的三角网格');
  const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
  if (!merged) throw new Error('合并导入网格失败，属性可能不一致');
  return merged;
}

export async function importModelFile(file: File): Promise<{ id: string; name: string; geometry: THREE.BufferGeometry; format: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  let raw: THREE.BufferGeometry;
  let format = ext.toUpperCase();

  if (ext === 'stl') {
    const loader = new STLLoader();
    raw = loader.parse(await readFileBuffer(file));
  } else if (ext === 'obj') {
    const text = await file.text();
    const object = new OBJLoader().parse(text);
    raw = mergeObject3D(object);
  } else if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    const data = ext === 'glb' ? await readFileBuffer(file) : await file.text();
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      loader.parse(
        data as ArrayBuffer | string,
        '',
        (result) => resolve(result),
        (error) => reject(error instanceof Error ? error : new Error('GLTF 解析失败')),
      );
    });
    raw = mergeObject3D(gltf.scene);
    format = ext === 'glb' ? 'GLB' : 'GLTF';
  } else {
    throw new Error('暂支持 STL / OBJ / GLB / GLTF 文件');
  }

  const geometry = normalizeGeometry(raw);
  const id = `import-${file.name.replace(/[^\w一-龥-]+/g, '-')}-${Math.round(performance.now())}`;
  registerGeometry(id, geometry);
  return { id, name: file.name.replace(/\.[^.]+$/, ''), geometry, format };
}

export function geometryInfo(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const box = g.boundingBox ?? new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 120, 100));
  const size = box.getSize(new THREE.Vector3());
  return {
    triangleCount: Math.round(g.attributes.position.count / 3),
    minY: box.min.y,
    maxY: box.max.y,
    sizeX: size.x,
    sizeZ: size.z,
  };
}
