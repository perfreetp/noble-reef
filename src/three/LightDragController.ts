import * as THREE from 'three';

/**
 * 灯光手柄拖拽：
 *  - 按下手柄时禁用 OrbitControls，在过手柄且平行于相机的平面上拖动；
 *  - Shift + 拖动改为沿世界 Y 轴移动；
 *  - 移动事件直接回写 Solid store（单一数据源），rAF 内再同步到 three 对象。
 */
export class LightDragController {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private hitPoint = new THREE.Vector3();
  private dragOffset = new THREE.Vector3();
  private draggingId: number | null = null;
  private yAxisMode = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private handles: Map<number, THREE.Object3D>,
    private onDrag: (id: number, pos: [number, number, number]) => void,
    private setOrbitEnabled: (enabled: boolean) => void,
  ) {
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
  }

  private updatePointer(e: PointerEvent) {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickHandle(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objects = [...this.handles.values()];
    const hits = this.raycaster.intersectObjects(objects, true);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && obj.userData.lightId === undefined) obj = obj.parent;
    return obj ? (obj.userData.lightId as number) : null;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.updatePointer(e);
    const id = this.pickHandle();
    if (id === null) return;
    const handle = this.handles.get(id)!;
    this.draggingId = id;
    this.yAxisMode = e.shiftKey;
    this.setOrbitEnabled(false);
    this.dom.setPointerCapture(e.pointerId);
    this.dom.style.cursor = 'grabbing';

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    if (this.yAxisMode) {
      this.dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), handle.position);
    } else {
      this.dragPlane.setFromNormalAndCoplanarPoint(camDir, handle.position);
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.hitPoint)) {
      this.dragOffset.copy(this.hitPoint).sub(handle.position);
    } else {
      this.dragOffset.set(0, 0, 0);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    this.updatePointer(e);
    if (this.draggingId === null) {
      this.dom.style.cursor = this.pickHandle() !== null ? 'grab' : '';
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.hitPoint)) return;
    const next = this.hitPoint.clone().sub(this.dragOffset);

    if (this.yAxisMode) {
      const handle = this.handles.get(this.draggingId)!;
      next.x = handle.position.x;
      next.z = handle.position.z;
    }
    next.y = THREE.MathUtils.clamp(next.y, 0.15, 5);
    next.x = THREE.MathUtils.clamp(next.x, -6, 6);
    next.z = THREE.MathUtils.clamp(next.z, -6, 6);
    this.onDrag(this.draggingId, [next.x, next.y, next.z]);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.draggingId === null) return;
    this.draggingId = null;
    this.setOrbitEnabled(true);
    try {
      this.dom.releasePointerCapture(e.pointerId);
    } catch {
      /* 指针已释放 */
    }
    this.dom.style.cursor = '';
  };

  dispose() {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointercancel', this.onPointerUp);
  }
}
