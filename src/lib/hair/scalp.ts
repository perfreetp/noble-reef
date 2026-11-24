import * as THREE from 'three';

/**
 * 头模：程序化椭球头皮 + 简单颈部，供发束锚定与射线吸附。
 * 头皮网格单独一层，便于 raycast 时只命中头皮。
 */
export interface ScalpHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

export class Scalp {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();

  constructor() {
    // 头皮：椭球，顶部略尖，覆盖头顶区域
    const geo = new THREE.SphereGeometry(1, 64, 48);
    geo.scale(0.92, 1.08, 0.98);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd9b08c,
      roughness: 0.75,
      metalness: 0.0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'scalp';
    this.mesh.position.y = 0.1;
    this.group.add(this.mesh);

    // 颈部
    const neckGeo = new THREE.CylinderGeometry(0.32, 0.4, 0.9, 24);
    const neck = new THREE.Mesh(neckGeo, mat);
    neck.position.y = -1.15;
    this.group.add(neck);

    // 双肩示意
    const shoulderGeo = new THREE.SphereGeometry(0.85, 24, 16);
    shoulderGeo.scale(1.6, 0.5, 0.8);
    const shoulders = new THREE.Mesh(
      shoulderGeo,
      new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.9 }),
    );
    shoulders.position.y = -1.7;
    this.group.add(shoulders);
  }

  /**
   * 从 origin 沿 dir 向头皮投射线，返回命中点与表面法线（世界系）。
   * 发根拖动与新建发束都靠它把锚点贴住曲面。
   */
  project(origin: THREE.Vector3, dir: THREE.Vector3): ScalpHit | null {
    this.raycaster.set(origin, dir);
    this.raycaster.far = 10;
    const hits = this.raycaster.intersectObject(this.mesh, false);
    const hit = hits[0];
    if (!hit || !hit.face) return null;
    const normal = hit.face.normal
      .clone()
      .transformDirection(this.mesh.matrixWorld)
      .normalize();
    return { point: hit.point.clone(), normal };
  }

  /** 用指针射线直接求头皮命中 */
  projectRay(ray: THREE.Ray): ScalpHit | null {
    this.raycaster.set(ray.origin, ray.direction);
    this.raycaster.far = 100;
    const hits = this.raycaster.intersectObject(this.mesh, false);
    const hit = hits[0];
    if (!hit || !hit.face) return null;
    const normal = hit.face.normal
      .clone()
      .transformDirection(this.mesh.matrixWorld)
      .normalize();
    return { point: hit.point.clone(), normal };
  }

  /**
   * 把任意空间点吸附到最近的头皮表面（沿其到球心方向的近似法线投射）。
   * 用于文件载入后把锚点重新贴回曲面。
   */
  snapToSurface(point: THREE.Vector3): ScalpHit | null {
    const center = this.mesh.getWorldPosition(new THREE.Vector3());
    const dir = point.clone().sub(center);
    if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
    dir.normalize();
    const origin = center.clone().addScaledVector(dir, 5);
    return this.project(origin, dir.clone().negate());
  }
}
