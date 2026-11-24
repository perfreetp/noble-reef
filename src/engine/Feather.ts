import * as THREE from 'three';
import { FeatherParams, GAP_WARN_MM } from './types';
import { buildFeatherGeometry } from './featherGeometry';
import { makeFeatherTexture } from './featherTextures';
import { createFeatherMaterial, GLOSS_LEVELS, SharedOptics } from './featherMaterial';
import { crownFrame, crownRadiusAt } from './crownSurface';

const _m = new THREE.Matrix4();

/**
 * 单根羽枝实例:几何、纹理、材质都可独立重建,
 * 参数改动只重算这一根,不触碰其他羽枝与冠面。
 */
export class Feather {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.CanvasTexture;
  sortZ = 0;
  private wrapRadius = 70;

  constructor(
    public params: FeatherParams,
    private shared: SharedOptics,
  ) {
    this.texture = makeFeatherTexture(params.textureIndex, params.density, params.grainDir);
    this.material = createFeatherMaterial(shared, this.texture);
    this.mesh = new THREE.Mesh(this.buildGeometry(), this.material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData.featherId = params.id;
    this.updatePlacement();
    this.updateOptics();
  }

  private buildGeometry(): THREE.BufferGeometry {
    const p = this.params;
    this.wrapRadius = crownRadiusAt(p.u, p.v) + p.gap;
    return buildFeatherGeometry({
      length: p.length,
      width: p.width,
      curvature: p.curvature,
      segments: p.segments,
      wrapRadius: this.wrapRadius,
      seed: p.id * 97 + 11,
    });
  }

  /** 仅几何参数变化时调用 */
  rebuildGeometry(): void {
    const old = this.mesh.geometry;
    this.mesh.geometry = this.buildGeometry();
    old.dispose();
  }

  /** 仅放置参数(u/v/旋转/镜像/间隙)变化时调用 */
  updatePlacement(): void {
    const p = this.params;
    const { P, N, Tu, Tv } = crownFrame(p.u, p.v);
    const right = Tu.clone();
    const up = Tv.clone();
    right.applyAxisAngle(N, p.rotation);
    up.applyAxisAngle(N, p.rotation);
    if (p.mirrored) right.negate();
    const pos = P.clone().addScaledVector(N, p.gap);
    _m.makeBasis(right, up, N);
    _m.setPosition(pos);
    this.mesh.matrix.copy(_m);
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  /** 仅光学参数变化时调用 */
  updateOptics(): void {
    const p = this.params;
    const u = this.material.uniforms;
    u.uFiberAngle.value = p.fiberAngle;
    u.uHueShift.value = p.hueShift;
    u.uGloss.value = GLOSS_LEVELS[p.glossLevel];
    u.uWarn.value = p.gap > GAP_WARN_MM ? 1 : 0;
  }

  /** 纹理参数(编号/密度/丝理)变化时调用 */
  regenTexture(): void {
    const p = this.params;
    const tex = makeFeatherTexture(p.textureIndex, p.density, p.grainDir);
    this.material.uniforms.uMap.value = tex;
    this.texture.dispose();
    this.texture = tex;
  }

  /** 选中高亮 */
  setSelected(on: boolean): void {
    this.material.uniforms.uIrid.value = on ? 0.75 : 0.5;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
