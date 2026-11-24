import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PointerDragBehavior } from "@babylonjs/core/Behaviors/Meshes/pointerDragBehavior";
import { quatFromUnitVectorsToRef } from "./mathUtils";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

/**
 * 剖切平面的可视化与拖拽：
 * 半透明平面 + 中央手柄，沿法线方向拖动改变平面位置。
 */
export class ClipPlaneView {
  private planeMesh: Mesh;
  private handleMesh: Mesh;
  private drag: PointerDragBehavior;
  private normal = new Vector3(0, 1, 0);
  private d = 0;
  private size = 30;
  onChanged: ((normal: Vector3, d: number) => void) | null = null;

  constructor(private scene: Scene) {
    const mat = new StandardMaterial("clipPlaneMat", scene);
    mat.emissiveColor = new Color3(0.25, 0.5, 0.85);
    mat.alpha = 0.22;
    mat.backFaceCulling = false;
    mat.disableLighting = true;

    this.planeMesh = MeshBuilder.CreatePlane("clipPlaneView", { size: 1 }, scene);
    this.planeMesh.material = mat;
    this.planeMesh.isPickable = false; // 平面本身不挡拾取，拖动手柄

    const handleMat = new StandardMaterial("clipHandleMat", scene);
    handleMat.emissiveColor = new Color3(0.4, 0.75, 1.0);
    handleMat.disableLighting = true;
    this.handleMesh = MeshBuilder.CreateSphere("clipHandle", { diameter: 1.2, segments: 12 }, scene);
    this.handleMesh.material = handleMat;
    this.handleMesh.isPickable = false;

    this.drag = new PointerDragBehavior({ dragAxis: this.normal.clone() });
    this.drag.moveAttached = true;
    this.drag.onDragObservable.add(() => {
      const p = this.handleMesh.position;
      this.d = p.x * this.normal.x + p.y * this.normal.y + p.z * this.normal.z;
      this.syncPlaneMesh();
      this.onChanged?.(this.normal, this.d);
    });
    this.handleMesh.addBehavior(this.drag);

    this.setVisible(false);
  }

  private syncPlaneMesh(): void {
    const q = new Quaternion();
    quatFromUnitVectorsToRef(0, 0, 1, this.normal.x, this.normal.y, this.normal.z, q);
    this.planeMesh.rotationQuaternion = q;
    this.planeMesh.position.set(this.normal.x * this.d, this.normal.y * this.d, this.normal.z * this.d);
    this.planeMesh.scaling.setAll(this.size);
    this.handleMesh.position.copyFrom(this.planeMesh.position);
    this.handleMesh.scaling.setAll(Math.max(0.8, this.size * 0.03));
  }

  /** 更新平面状态（法线会归一化） */
  setState(normal: Vector3, d: number, size: number): void {
    this.normal = normal.clone();
    this.normal.normalize();
    this.d = d;
    this.size = Math.max(4, size);
    (this.drag as unknown as { dragAxis: Vector3 }).dragAxis = this.normal.clone();
    this.syncPlaneMesh();
  }

  setVisible(v: boolean): void {
    this.planeMesh.setEnabled(v);
    this.handleMesh.setEnabled(v);
    this.handleMesh.isPickable = v;
  }

  dispose(): void {
    this.planeMesh.dispose();
    this.handleMesh.dispose();
  }
}
