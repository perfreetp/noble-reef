import * as THREE from 'three';
import { createEffect } from 'solid-js';
import { projectStore } from '../../store/projectStore';
import { createFacilityMesh } from './facilityGeometry';
import type { FacilityInstance } from '../../types/project';

/** 设施管理器：mesh 增删改、占地预览圈、选中描边环 */
export class FacilityManager {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly preview: THREE.Mesh;
  private readonly selectionRing: THREE.Mesh;

  constructor() {
    this.group.name = 'facilities';
    const previewMat = new THREE.MeshBasicMaterial({
      color: 0x36d399,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.preview = new THREE.Mesh(new THREE.CircleGeometry(1, 40), previewMat);
    this.preview.rotation.x = -Math.PI / 2;
    this.preview.visible = false;
    this.group.add(this.preview);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.08, 48),
      new THREE.MeshBasicMaterial({ color: 0xffc23a, side: THREE.DoubleSide, depthTest: false }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 998;
    this.group.add(this.selectionRing);

    createEffect(() => {
      void JSON.stringify(projectStore.facilities);
      this.sync();
    });
  }

  showPreview(radius: number, x: number, y: number, z: number, valid: boolean): void {
    this.preview.visible = true;
    this.preview.scale.setScalar(radius);
    this.preview.position.set(x, y + 0.25, z);
    (this.preview.material as THREE.MeshBasicMaterial).color.set(valid ? 0x36d399 : 0xf87272);
  }

  hidePreview(): void {
    this.preview.visible = false;
  }

  showSelectionRing(f: FacilityInstance): void {
    const r = f.footprint.shape === 'circle' ? f.footprint.radius : Math.max(f.footprint.w, f.footprint.d) / 2;
    this.selectionRing.visible = true;
    this.selectionRing.scale.setScalar(r);
    this.selectionRing.position.set(f.x, f.baseHeight + 0.3, f.z);
  }

  hideSelectionRing(): void {
    this.selectionRing.visible = false;
  }

  allMeshes(): THREE.Group[] {
    return [...this.meshes.values()];
  }

  findFacilityId(obj: THREE.Object3D): string | null {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur.userData && typeof cur.userData.facilityId === 'string') return cur.userData.facilityId;
      cur = cur.parent;
    }
    return null;
  }

  private sync(): void {
    const live = new Set(projectStore.facilityOrder);
    for (const [id, g] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(g);
        this.disposeGroup(g);
        this.meshes.delete(id);
      }
    }
    for (const id of projectStore.facilityOrder) {
      const f = projectStore.facilities[id]!;
      const existing = this.meshes.get(id);
      if (existing) {
        existing.position.set(f.x, f.baseHeight, f.z);
        existing.rotation.y = f.rotation;
        continue;
      }
      const g = createFacilityMesh(f.type);
      g.userData.facilityId = id;
      g.position.set(f.x, f.baseHeight, f.z);
      g.rotation.y = f.rotation;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.userData.facilityId = id;
        }
      });
      this.group.add(g);
      this.meshes.set(id, g);
    }
  }

  private disposeGroup(g: THREE.Group): void {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
    });
  }

  dispose(): void {
    for (const g of this.meshes.values()) this.disposeGroup(g);
    this.preview.geometry.dispose();
    (this.preview.material as THREE.Material).dispose();
    this.selectionRing.geometry.dispose();
    (this.selectionRing.material as THREE.Material).dispose();
  }
}
