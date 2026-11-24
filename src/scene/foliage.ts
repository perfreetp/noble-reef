/**
 * 枝叶渲染:
 * - 细枝:InstancedMesh 锥形圆柱,按生长度缩放
 * - 叶片:InstancedMesh 半透明双面叶片,每帧按视深排序实例避免半透明穿插错误
 */
import * as THREE from 'three';
import type { GeneratedTree } from '../core/generator';

const UP = new THREE.Vector3(0, 1, 0);

function createLeafGeometry(): THREE.BufferGeometry {
  // 简单叶片:菱形平面,微弯
  const geo = new THREE.PlaneGeometry(0.09, 0.16, 1, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const taper = 1 - Math.abs(y / 0.08) * 0.75;
    pos.setX(i, pos.getX(i) * taper);
    pos.setZ(i, Math.abs(y) * 0.25); // 微弯
  }
  geo.computeVertexNormals();
  geo.translate(0, 0.08, 0); // 基部对齐原点
  return geo;
}

function createTwigGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.35, 1, 1, 5, 1);
  geo.translate(0, 0.5, 0); // 基部对齐原点,沿 +Y
  return geo;
}

export class FoliageRenderer {
  readonly group = new THREE.Group();
  private twigMesh: THREE.InstancedMesh;
  private leafMesh: THREE.InstancedMesh;
  private tree: GeneratedTree | null = null;

  // 叶片排序 scratch
  private leafDepth: Float32Array = new Float32Array(0);
  private leafOrder: number[] = []; // 复用的排序缓冲,避免每帧分配
  private leafTint: Float32Array = new Float32Array(0); // 每片叶子的色调(源顺序)

  private tmpMatrix = new THREE.Matrix4();
  private tmpPos = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private tmpView = new THREE.Vector3();

  constructor() {
    const twigMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#5d4630'),
      roughness: 0.85,
      metalness: 0,
    });
    this.twigMesh = new THREE.InstancedMesh(createTwigGeometry(), twigMat, 1);
    this.twigMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.twigMesh.castShadow = true;
    this.twigMesh.frustumCulled = false;

    const leafMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ffffff'), // 实际色调由 instanceColor 携带
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
      depthWrite: false, // 半透明:关闭深度写入,依赖 CPU 深度排序
    });
    // 注入简易透光(伪次表面):背光处叶片发亮
    leafMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         // 叶片透光:视线背向光时增加亮度
         vec3 transLight = normalize(vec3(0.4, 0.8, 0.3));
         float backLit = pow(clamp(dot(normalize(vViewPosition), transLight), 0.0, 1.0), 2.0);
         reflectedLight.indirectDiffuse += diffuseColor.rgb * backLit * 0.6;`,
      );
    };
    this.leafMesh = new THREE.InstancedMesh(createLeafGeometry(), leafMat, 1);
    this.leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leafMesh.frustumCulled = false;
    this.leafMesh.renderOrder = 10;

    this.group.add(this.twigMesh, this.leafMesh);
  }

  /** 重建实例缓冲(生长参数变化时调用,2000 细枝 + 叶片,毫秒级完成) */
  rebuild(tree: GeneratedTree): void {
    this.tree = tree;

    this.twigMesh.count = tree.twigs.length;
    if ((this.twigMesh.instanceMatrix.array as Float32Array).length < tree.twigs.length * 16) {
      this.twigMesh.instanceMatrix = new THREE.InstancedBufferAttribute(
        new Float32Array(tree.twigs.length * 16),
        16,
      );
      this.twigMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }

    this.leafMesh.count = tree.leaves.length;
    if ((this.leafMesh.instanceMatrix.array as Float32Array).length < tree.leaves.length * 16) {
      this.leafMesh.instanceMatrix = new THREE.InstancedBufferAttribute(
        new Float32Array(tree.leaves.length * 16),
        16,
      );
      this.leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    // 每片叶子的色调变化
    if (!this.leafMesh.instanceColor || this.leafMesh.instanceColor.count < tree.leaves.length) {
      this.leafMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(Math.max(1, tree.leaves.length) * 3),
        3,
      );
    }
    const c = new THREE.Color();
    this.leafTint = new Float32Array(tree.leaves.length * 3);
    for (let i = 0; i < tree.leaves.length; i++) {
      const leaf = tree.leaves[i];
      c.setHSL(0.29 + leaf.phase * 0.12, 0.55, 0.3 + leaf.phase * 0.35);
      this.leafTint[i * 3] = c.r;
      this.leafTint[i * 3 + 1] = c.g;
      this.leafTint[i * 3 + 2] = c.b;
    }

    this.leafDepth = new Float32Array(tree.leaves.length);
    this.leafOrder = new Array(tree.leaves.length).fill(0);
  }

  /** 每帧:按生长度写细枝矩阵;叶片按视深排序后写矩阵 */
  update(camera: THREE.Camera): void {
    const tree = this.tree;
    if (!tree) return;

    // --- 细枝 ---
    const tm = this.twigMesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < tree.twigs.length; i++) {
      const tw = tree.twigs[i];
      const g = tw.growth;
      const o = i * 16;
      if (g <= 0.001) {
        // 零缩放矩阵
        tm.fill(0, o, o + 16);
        tm[o + 15] = 1;
        continue;
      }
      const len = tw.length * (0.15 + 0.85 * g);
      const rad = tw.radius * (0.3 + 0.7 * g);
      this.tmpScale.set(rad, len, rad);
      this.tmpMatrix.compose(tw.pos, tw.quat, this.tmpScale);
      this.tmpMatrix.toArray(tm, o);
    }
    this.twigMesh.instanceMatrix.needsUpdate = true;

    // --- 叶片:计算世界位置与视深 ---
    const leaves = tree.leaves;
    const twigs = tree.twigs;
    let visible = 0;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const tw = twigs[leaf.twig];
      // 叶片萌发略滞后于所属细枝
      const g = THREE.MathUtils.clamp(tw.growth * 1.25 - leaf.phase - 0.15, 0, 1);
      if (g <= 0.001) continue;
      this.tmpPos
        .copy(UP)
        .applyQuaternion(tw.quat)
        .multiplyScalar(tw.length * (0.15 + 0.85 * tw.growth) * leaf.t)
        .add(tw.pos);
      this.tmpView.copy(this.tmpPos).applyMatrix4(camera.matrixWorldInverse);
      const idx = visible++;
      this.leafOrder[idx] = i;
      this.leafDepth[idx] = this.tmpView.z; // 相机前方为负值
    }

    // 按深度从远到近排序(z 越小越远 → 升序);复用缓冲,仅排序前 visible 项
    const order = this.leafOrder;
    order.length = visible;
    order.sort((a, b) => this.leafDepth[a] - this.leafDepth[b]);

    const lm = this.leafMesh.instanceMatrix.array as Float32Array;
    const lc = this.leafMesh.instanceColor!.array as Float32Array;
    for (let k = 0; k < visible; k++) {
      const srcIdx = order[k];
      const leaf = leaves[srcIdx];
      const tw = twigs[leaf.twig];
      const g = THREE.MathUtils.clamp(tw.growth * 1.25 - leaf.phase - 0.15, 0, 1);
      this.tmpPos
        .copy(UP)
        .applyQuaternion(tw.quat)
        .multiplyScalar(tw.length * (0.15 + 0.85 * tw.growth) * leaf.t)
        .add(tw.pos);
      this.tmpQuat.setFromEuler(new THREE.Euler(leaf.pitch, leaf.yaw, 0, 'YXZ'));
      this.tmpQuat.premultiply(tw.quat);
      const s = leaf.scale * g;
      this.tmpScale.set(s, s, s);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.tmpMatrix.toArray(lm, k * 16);
      // 颜色随排序同步重排
      lc[k * 3] = this.leafTint[srcIdx * 3];
      lc[k * 3 + 1] = this.leafTint[srcIdx * 3 + 1];
      lc[k * 3 + 2] = this.leafTint[srcIdx * 3 + 2];
    }
    this.leafMesh.count = visible;
    this.leafMesh.instanceMatrix.needsUpdate = true;
    this.leafMesh.instanceColor!.needsUpdate = true;
  }

  /** 拾取细枝实例,返回其稳定 key(用于修剪) */
  pickTwig(raycaster: THREE.Raycaster): string | null {
    if (!this.tree) return null;
    const hits = raycaster.intersectObject(this.twigMesh, false);
    for (const h of hits) {
      if (h.instanceId !== undefined && this.tree.twigs[h.instanceId]) {
        const tw = this.tree.twigs[h.instanceId];
        if (tw.growth > 0.05) return tw.key;
      }
    }
    return null;
  }

  dispose(): void {
    this.twigMesh.geometry.dispose();
    (this.twigMesh.material as THREE.Material).dispose();
    this.leafMesh.geometry.dispose();
    (this.leafMesh.material as THREE.Material).dispose();
  }
}
