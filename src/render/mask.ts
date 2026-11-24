import * as THREE from 'three';
import type { PartId } from '../types';
import type { Rig } from '../puppet/rig';
import { buildFilledGeometry } from '../puppet/shapes';

/**
 * 镂空透光遮罩 pass。
 *
 * 单层遮罩无法区分"影偶外部"和"镂空内部"(两者都是空),
 * 因此每帧重算两张纹理:
 *
 *   silhouette RT —— 渲染填实几何(无孔同轮廓),
 *                    白=影偶外部,黑=皮革区域;
 *   cutout RT     —— 渲染带 Shape holes 的真实几何,
 *                    黑=镂空孔内部,白=其余区域。
 *
 * 灯幕 shader 组合两张图:外部=暖光幕光,皮革=近黑影,镂空=高亮光斑。
 * 重算就是两次简单几何的正交绘制(各 6 个网格),一帧内完成。
 *
 * 遮罩网格放在独立 overlay 扁平场景,每帧从骨架源网格复制
 * 世界 position/quaternion/scale,让 three.js 正常更新矩阵,
 * 与主场景的材质/可见性完全解耦。
 */
export class MaskPass {
  private silhouette: THREE.WebGLRenderTarget;
  private cutout: THREE.WebGLRenderTarget;
  private blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  private overlay = new THREE.Scene();
  private filledMeshes: THREE.Mesh[] = [];
  private holedMeshes: THREE.Mesh[] = [];
  private sourceMeshes: THREE.Mesh[] = [];
  private lastCostMs = 0;

  constructor(rig: Rig, width: number, height: number) {
    const opts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    };
    this.silhouette = new THREE.WebGLRenderTarget(width, height, opts);
    this.cutout = new THREE.WebGLRenderTarget(width, height, opts);

    const ids: PartId[] = rig.partIdsInOrder;
    rig.meshes.forEach((src, i) => {
      this.sourceMeshes.push(src);
      const filled = new THREE.Mesh(buildFilledGeometry(ids[i]), this.blackMat.clone());
      filled.frustumCulled = false;
      this.overlay.add(filled);
      this.filledMeshes.push(filled);

      const holed = new THREE.Mesh(src.geometry, this.blackMat.clone());
      holed.frustumCulled = false;
      this.overlay.add(holed);
      this.holedMeshes.push(holed);
    });
  }

  get silhouetteTexture(): THREE.Texture {
    return this.silhouette.texture;
  }

  get cutoutTexture(): THREE.Texture {
    return this.cutout.texture;
  }

  get costMs(): number {
    return this.lastCostMs;
  }

  resize(width: number, height: number): void {
    this.silhouette.setSize(width, height);
    this.cutout.setSize(width, height);
  }

  /**
   * 从源网格复制世界变换。源网格处于嵌套 pivot 层级,
   * matrixWorld 已是世界矩阵;overlay 网格在扁平场景根下,
   * 直接取其世界 position/quaternion/scale 即可正确摆放。
   */
  private syncTransforms(): void {
    for (let i = 0; i < this.sourceMeshes.length; i++) {
      const src = this.sourceMeshes[i];
      src.getWorldPosition(this.filledMeshes[i].position);
      src.getWorldQuaternion(this.filledMeshes[i].quaternion);
      src.getWorldScale(this.filledMeshes[i].scale);
      src.getWorldPosition(this.holedMeshes[i].position);
      src.getWorldQuaternion(this.holedMeshes[i].quaternion);
      src.getWorldScale(this.holedMeshes[i].scale);
    }
  }

  private drawSet(
    gl: THREE.WebGLRenderer,
    camera: THREE.OrthographicCamera,
    target: THREE.WebGLRenderTarget,
    meshes: THREE.Mesh[],
  ): void {
    this.overlay.children.forEach((c) => (c.visible = false));
    meshes.forEach((m) => (m.visible = true));
    gl.setRenderTarget(target);
    gl.setClearColor(0xffffff, 1);
    gl.clear(true, true, true);
    gl.render(this.overlay, camera);
  }

  /** 姿态变化后重算遮罩,返回本次耗时(ms) */
  render(gl: THREE.WebGLRenderer, camera: THREE.OrthographicCamera): number {
    const t0 = performance.now();
    this.syncTransforms();
    this.overlay.updateMatrixWorld(true);
    this.drawSet(gl, camera, this.silhouette, this.filledMeshes);
    this.drawSet(gl, camera, this.cutout, this.holedMeshes);
    gl.setRenderTarget(null);
    this.lastCostMs = performance.now() - t0;
    return this.lastCostMs;
  }

  dispose(): void {
    this.silhouette.dispose();
    this.cutout.dispose();
    this.blackMat.dispose();
    for (const m of this.filledMeshes) m.geometry.dispose();
  }
}
