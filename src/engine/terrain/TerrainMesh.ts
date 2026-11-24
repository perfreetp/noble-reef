import * as THREE from 'three';
import { TERRAIN_EXTENT } from '../../config/constants';
import type { TerrainModel } from './TerrainModel';
import { createTerrainUniforms, injectTerrainShader, type TerrainShaderUniforms } from './terrainShaders';
import type { DirtyRect } from '../../util/dirtyRect';

/** 地形网格：PlaneGeometry 旋转后仅更新 y 与 normal，支持脏矩形局部上传 */
export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly normalAttr: THREE.BufferAttribute;
  private readonly uniforms: TerrainShaderUniforms;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(private readonly model: TerrainModel) {
    const segments = model.size - 1;
    this.geometry = new THREE.PlaneGeometry(TERRAIN_EXTENT, TERRAIN_EXTENT, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);

    this.positionAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    this.normalAttr.setUsage(THREE.DynamicDrawUsage);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);

    this.uniforms = createTerrainUniforms(5);
    this.material = new THREE.MeshStandardMaterial({
      flatShading: true,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    injectTerrainShader(this.material, this.uniforms);

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
    this.writeAllPositions();
    // 拖动中高度变化不重算包围球：预留 200m 高度余量的固定包围球足以覆盖编辑范围
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 60, 0), 620);
    this.strokeBoundingSphere = this.geometry.boundingSphere;
  }

  private readonly strokeBoundingSphere: THREE.Sphere;

  /** PlaneGeometry 顶点顺序与高度场行优先一致（rotateX 后 index = gy*size+gx） */
  private writeAllPositions(): void {
    const pos = this.positionAttr.array as Float32Array;
    for (let i = 0; i < this.model.heights.length; i++) {
      pos[i * 3 + 1] = this.model.heights[i]!;
      const nBase = i * 3;
      this.normalAttr.array[nBase] = this.model.normals[nBase]!;
      this.normalAttr.array[nBase + 1] = this.model.normals[nBase + 1]!;
      this.normalAttr.array[nBase + 2] = this.model.normals[nBase + 2]!;
    }
    this.positionAttr.needsUpdate = true;
    this.normalAttr.needsUpdate = true;
  }

  /** 脏矩形局部更新；无脏矩形时全量 */
  uploadDirty(rect?: DirtyRect): void {
    const pos = this.positionAttr.array as Float32Array;
    const r = rect ?? { minX: 0, minY: 0, maxX: this.model.size - 1, maxY: this.model.size - 1 };
    for (let gy = r.minY; gy <= r.maxY; gy++) {
      for (let gx = r.minX; gx <= r.maxX; gx++) {
        const vi = gy * this.model.size + gx;
        pos[vi * 3 + 1] = this.model.heights[vi]!;
        this.normalAttr.array[vi * 3] = this.model.normals[vi * 3]!;
        this.normalAttr.array[vi * 3 + 1] = this.model.normals[vi * 3 + 1]!;
        this.normalAttr.array[vi * 3 + 2] = this.model.normals[vi * 3 + 2]!;
      }
    }
    this.positionAttr.needsUpdate = true;
    this.normalAttr.needsUpdate = true;
    // 拖动中沿用固定包围球（构造时设置），避免每帧 O(65536) 重算
    this.geometry.boundingSphere = this.strokeBoundingSphere;
  }

  /** stroke 结束/导入后重算精确包围球 */
  endStroke(): void {
    this.geometry.boundingSphere = null;
    this.geometry.computeBoundingSphere();
  }

  setContourInterval(meters: number): void {
    this.uniforms.uContourInterval.value = meters;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
