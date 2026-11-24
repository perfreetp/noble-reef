import * as THREE from 'three';
import { buildTaperedTube } from './geometry';
import { hashSeed } from './curve';
import type { HairModel } from './model';

const CHUNK_SIZE = 64;
const CURVE_SEGMENTS = 14;
const RADIAL_SEGMENTS = 5;
/** 层级间距：穿插的发束按 layer 沿法线微微错开 */
const LAYER_OFFSET = 0.0025;

interface Chunk {
  mesh: THREE.Mesh;
  bundleIds: string[];
}

/**
 * 发束渲染器：把全部发束合并进少量 BufferGeometry（64 束/块），
 * 参数变化只重建所在块，上千束编辑时保持流畅。
 * 发根手柄用 InstancedMesh，一次 draw call，同时负责拾取与拖动。
 */
export class HairRenderer {
  readonly group = new THREE.Group();
  readonly handles: THREE.InstancedMesh;
  /** instanceId -> bundleId */
  private handleIndex: string[] = [];
  private chunks: Chunk[] = [];
  private bundleChunk = new Map<string, number>();
  private dirtyChunks = new Set<number>();
  private material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.15,
  });
  private handleMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
  private selection = new Set<string>();
  private highlight = new Set<string>();

  constructor(private readonly model: HairModel) {
    const handleGeo = new THREE.SphereGeometry(0.018, 10, 8);
    // 预分配容量，count 按实际数量设置
    this.handles = new THREE.InstancedMesh(handleGeo, this.handleMaterial, 8192);
    this.handles.name = 'root-handles';
    this.group.add(this.handles);
  }

  setSelection(ids: Set<string>): void {
    const changed = new Set([...this.selection, ...ids]);
    this.selection = new Set(ids);
    this.markBundlesDirty(changed);
    this.refreshHandleColors();
  }

  setHighlight(ids: Set<string>): void {
    const changed = new Set([...this.highlight, ...ids]);
    this.highlight = new Set(ids);
    this.markBundlesDirty(changed);
  }

  private markBundlesDirty(ids: Iterable<string>): void {
    for (const id of ids) {
      const c = this.bundleChunk.get(id);
      if (c !== undefined) this.dirtyChunks.add(c);
    }
  }

  /** 结构变化后重排分块（O(n)，仅在增/删/载入时调用） */
  rebuildLayout(): void {
    for (const c of this.chunks) {
      c.mesh.geometry.dispose();
      this.group.remove(c.mesh);
    }
    this.chunks = [];
    this.bundleChunk.clear();
    this.dirtyChunks.clear();

    const ids = [...this.model.bundles.keys()];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const slice = ids.slice(i, i + CHUNK_SIZE);
      const geo = new THREE.BufferGeometry();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const index = this.chunks.length;
      this.chunks.push({ mesh, bundleIds: slice });
      for (const id of slice) this.bundleChunk.set(id, index);
      this.dirtyChunks.add(index);
    }
    this.rebuildHandles();
  }

  private rebuildHandles(): void {
    const ids = [...this.model.bundles.keys()];
    this.handleIndex = ids;
    this.handles.count = ids.length;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    ids.forEach((id, i) => {
      const b = this.model.bundles.get(id)!;
      p.set(...b.anchor.position);
      n.set(...b.anchor.normal);
      p.addScaledVector(n, 0.012);
      m.makeTranslation(p.x, p.y, p.z);
      this.handles.setMatrixAt(i, m);
    });
    this.handles.instanceMatrix.needsUpdate = true;
    this.refreshHandleColors();
  }

  private refreshHandleColors(): void {
    const color = new THREE.Color();
    this.handleIndex.forEach((id, i) => {
      if (this.selection.has(id)) color.set(0xff8c1a);
      else if (this.highlight.has(id)) color.set(0xff4040);
      else color.set(0x2f6fdb);
      this.handles.setColorAt(i, color);
    });
    if (this.handles.instanceColor) this.handles.instanceColor.needsUpdate = true;
  }

  /** 每帧调用：重建脏块 */
  update(): void {
    if (this.dirtyChunks.size === 0) return;
    for (const ci of this.dirtyChunks) {
      const chunk = this.chunks[ci];
      if (!chunk) continue;
      this.buildChunkGeometry(chunk);
    }
    this.dirtyChunks.clear();
    // 手柄位置跟随锚点（拖动根部时）
    this.rebuildHandles();
  }

  handleIds(): readonly string[] {
    return this.handleIndex;
  }

  private buildChunkGeometry(chunk: Chunk): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vertBase = 0;
    const color = new THREE.Color();
    const offset = new THREE.Vector3();
    const pts: THREE.Vector3[] = [];

    for (const id of chunk.bundleIds) {
      const b = this.model.bundles.get(id);
      if (!b) continue;
      const curve = this.model.getCurve(id, CURVE_SEGMENTS);
      // 层级错开：沿法线偏移，化解穿插视觉
      offset.set(...b.anchor.normal).multiplyScalar(b.layer * LAYER_OFFSET);
      pts.length = 0;
      for (const p of curve) pts.push(p.clone().add(offset));

      const tube = buildTaperedTube(pts, b.params.thickness, RADIAL_SEGMENTS);
      positions.push(...tube.positions);
      normals.push(...tube.normals);

      color.set(b.color);
      if (this.selection.has(id)) color.lerp(new THREE.Color(0xff8c1a), 0.45);
      else if (this.highlight.has(id)) color.lerp(new THREE.Color(0xff3030), 0.5);
      const vertCount = tube.positions.length / 3;
      // 发根处颜色略深，便于检查发根衔接
      const ringVerts = RADIAL_SEGMENTS + 1;
      for (let v = 0; v < vertCount; v++) {
        const ring = Math.floor(v / ringVerts);
        const shade = ring < 2 ? 0.72 : 1;
        colors.push(color.r * shade, color.g * shade, color.b * shade);
      }
      for (let i = 0; i < tube.indices.length; i++) {
        indices.push(tube.indices[i]! + vertBase);
      }
      vertBase += vertCount;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geo.setIndex(indices);
    chunk.mesh.geometry.dispose();
    chunk.mesh.geometry = geo;
  }

  /** 处理 model 变更事件 */
  onModelChange(dirty: Set<string>, structural: boolean): void {
    if (structural) {
      this.rebuildLayout();
    } else {
      this.markBundlesDirty(dirty);
      this.rebuildHandles();
    }
  }

  dispose(): void {
    for (const c of this.chunks) c.mesh.geometry.dispose();
    this.material.dispose();
    this.handleMaterial.dispose();
    this.handles.geometry.dispose();
  }
}

export { hashSeed };
