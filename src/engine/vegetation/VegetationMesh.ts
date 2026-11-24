import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlantInstance } from './scatter';
import type { TerrainModel } from '../terrain/TerrainModel';

/** 低模树：圆柱树干 + 两层圆锥树冠，合并为单个 BufferGeometry */
const createTreeGeometry = (): THREE.BufferGeometry => {
  const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6).translate(0, 0.8, 0);
  const cone1 = new THREE.ConeGeometry(1.2, 2.4, 7).translate(0, 2.6, 0);
  const cone2 = new THREE.ConeGeometry(0.9, 1.8, 7).translate(0, 3.8, 0);
  return mergeGeometries([trunk, cone1, cone2], false)!;
};

const createShrubGeometry = (): THREE.BufferGeometry =>
  new THREE.IcosahedronGeometry(1, 0).scale(1.1, 0.8, 1.1);

export class VegetationMesh {
  readonly group = new THREE.Group();
  private readonly treeMesh: THREE.InstancedMesh;
  private readonly shrubMesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private plants: PlantInstance[] = [];

  constructor(private readonly model: TerrainModel, maxCount: number) {
    this.group.name = 'vegetation';
    const treeGeo = createTreeGeometry();
    const shrubGeo = createShrubGeometry();
    const treeMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    const shrubMat = new THREE.MeshStandardMaterial({ color: 0x5e8c46, roughness: 0.9, flatShading: true });
    this.treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, maxCount);
    this.shrubMesh = new THREE.InstancedMesh(shrubGeo, shrubMat, maxCount);
    for (const m of [this.treeMesh, this.shrubMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      this.group.add(m);
    }
  }

  setPlants(plants: PlantInstance[]): void {
    this.plants = plants;
    this.rewriteMatrices();
  }

  getPlants(): PlantInstance[] {
    return this.plants;
  }

  /** 全量重写实例矩阵（不合格实例缩放到 0） */
  rewriteMatrices(): void {
    let treeCount = 0;
    let shrubCount = 0;
    for (const p of this.plants) {
      const mesh = p.kind === 'tree' ? this.treeMesh : this.shrubMesh;
      const idx = p.kind === 'tree' ? treeCount++ : shrubCount++;
      const y = this.model.sampleHeightBilinear(p.x, p.z);
      const s = p.eligible ? p.scale : 0;
      this.dummy.position.set(p.x, y, p.z);
      this.dummy.rotation.set(0, p.rotationY, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(idx, this.dummy.matrix);
    }
    this.treeMesh.count = treeCount;
    this.shrubMesh.count = shrubCount;
    this.treeMesh.instanceMatrix.needsUpdate = true;
    this.shrubMesh.instanceMatrix.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.treeMesh.geometry.dispose();
    this.shrubMesh.geometry.dispose();
    (this.treeMesh.material as THREE.Material).dispose();
    (this.shrubMesh.material as THREE.Material).dispose();
    this.treeMesh.dispose();
    this.shrubMesh.dispose();
  }
}
