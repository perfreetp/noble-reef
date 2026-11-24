/**
 * 骨架编辑:
 * - 每根枝干渲染为 TubeGeometry
 * - 控制点渲染为可拖拽小球(在垂直于视线的平面内拖动)
 * - 修剪模式下点击枝干/细枝进行修剪
 */
import * as THREE from 'three';
import type { SkeletonData } from '../types';
import type { BranchCurve } from '../core/generator';

export interface SkeletonEditEvents {
  onPointDrag: (branchId: string, pointIndex: number, localPos: THREE.Vector3) => void;
  onDragEnd: () => void;
  onPruneBranch: (branchId: string) => void;
}

export class SkeletonEditor {
  readonly group = new THREE.Group();
  private branchMeshes = new Map<string, THREE.Mesh>();
  private handleGroup = new THREE.Group();
  private handles: THREE.Mesh[] = [];
  private curves: BranchCurve[] = [];
  private skeleton: SkeletonData | null = null;
  private events: SkeletonEditEvents;

  private dragging: { branchId: string; pointIndex: number; plane: THREE.Plane } | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private handleGeo = new THREE.SphereGeometry(0.045, 12, 12);
  private handleMat = new THREE.MeshBasicMaterial({ color: '#ffb347', depthTest: false });
  private activeMat = new THREE.MeshBasicMaterial({ color: '#ff5533', depthTest: false });

  constructor(events: SkeletonEditEvents) {
    this.events = events;
    this.group.add(this.handleGroup);
  }

  /** 重建枝干网格与控制点 */
  rebuild(skeleton: SkeletonData, curves: BranchCurve[], pruned: ReadonlySet<string>): void {
    this.skeleton = skeleton;
    this.curves = curves;
    for (const mesh of this.branchMeshes.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.branchMeshes.clear();
    this.handles = [];
    this.handleGroup.clear();

    for (const bc of curves) {
      const isPruned = pruned.has(bc.id);
      const geo = new THREE.TubeGeometry(bc.curve, 24, bc.radius, 7, false);
      const mat = new THREE.MeshStandardMaterial({
        color: isPruned ? new THREE.Color('#3a3a3a') : new THREE.Color('#6b4e33'),
        roughness: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.branchId = bc.id;
      mesh.castShadow = true;
      this.branchMeshes.set(bc.id, mesh);
      this.group.add(mesh);
    }

    // 控制点(世界坐标 = 枝干局部点 + 附着偏移)
    for (const bc of curves) {
      const data = skeleton.branches.find((b) => b.id === bc.id);
      if (!data) continue;
      const origin = new THREE.Vector3().setFromMatrixPosition(bc.matrix);
      data.points.forEach((p, i) => {
        if (i === 0 && bc.parentId) return; // 子枝干基点由父级 attachT 决定,不可拖
        const h = new THREE.Mesh(this.handleGeo, this.handleMat);
        h.position.set(p[0] + origin.x, p[1] + origin.y, p[2] + origin.z);
        h.userData = { branchId: bc.id, pointIndex: i };
        h.renderOrder = 99;
        this.handles.push(h);
        this.handleGroup.add(h);
      });
    }
  }

  setHandlesVisible(v: boolean): void {
    this.handleGroup.visible = v;
  }

  /** 返回拾取到的枝干 id(修剪用) */
  pickBranch(ndc: THREE.Vector2, camera: THREE.Camera): string | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObjects([...this.branchMeshes.values()], false);
    return hits.length ? (hits[0].object.userData.branchId as string) : null;
  }

  /** 尝试开始拖拽控制点 */
  beginDrag(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObjects(this.handles, false);
    if (!hits.length) return false;
    const handle = hits[0].object as THREE.Mesh;
    handle.material = this.activeMat;
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    this.dragging = {
      branchId: handle.userData.branchId,
      pointIndex: handle.userData.pointIndex,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, handle.position),
    };
    return true;
  }

  /** 拖拽中:返回是否正在拖拽 */
  drag(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    if (!this.dragging || !this.skeleton) return false;
    this.raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragging.plane, hit)) return true;
    const bc = this.curves.find((c) => c.id === this.dragging!.branchId);
    if (!bc) return true;
    const origin = new THREE.Vector3().setFromMatrixPosition(bc.matrix);
    const local = hit.clone().sub(origin);
    // 更新控制点手柄位置并通知外部(节流由调用方控制)
    const handle = this.handles.find(
      (h) =>
        h.userData.branchId === this.dragging!.branchId &&
        h.userData.pointIndex === this.dragging!.pointIndex,
    );
    if (handle) handle.position.copy(hit);
    this.events.onPointDrag(this.dragging.branchId, this.dragging.pointIndex, local);
    return true;
  }

  endDrag(): void {
    if (!this.dragging) return;
    for (const h of this.handles) h.material = this.handleMat;
    this.dragging = null;
    this.events.onDragEnd();
  }

  get isDragging(): boolean {
    return this.dragging !== null;
  }
}
