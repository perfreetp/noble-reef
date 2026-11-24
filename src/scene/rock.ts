/**
 * 盆钵与岩石:
 * - 岩石:顶点位移的不规则多面体
 * - 苔藓:程序化 FBM 噪声,按法线朝上程度分布;湿度 0..100 驱动颜色与伪次表面散射强度
 */
import * as THREE from 'three';
import type { MossParams } from '../types';

const MOSS_UNIFORMS = {
  uHumidity: { value: 0.65 }, // 0..1
  uCoverage: { value: 0.7 },
  uNoiseScale: { value: 3.2 },
};

const NOISE_GLSL = /* glsl */ `
  vec3 mossMod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mossMod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mossPermute(vec4 x){ return mossMod289(((x*34.0)+1.0)*x); }
  vec4 mossTaylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float mossNoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mossMod289(i);
    vec4 p = mossPermute(mossPermute(mossPermute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = mossTaylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  float mossFbm(vec3 p){
    float f = 0.0, a = 0.5;
    for(int i = 0; i < 4; i++){ f += a * mossNoise(p); p *= 2.1; a *= 0.5; }
    return f * 0.5 + 0.5;
  }
`;

/** 在标准材质上注入苔藓层 */
function injectMoss(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, MOSS_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vMossPos;
         varying vec3 vMossNormal;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
         vMossPos = transformed;
         vMossNormal = normalize(objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uHumidity;
         uniform float uCoverage;
         uniform float uNoiseScale;
         varying vec3 vMossPos;
         varying vec3 vMossNormal;
         ${NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // 苔藓分布:法线朝上程度 × FBM 噪声 × 覆盖度
         float upFacing = clamp(vMossNormal.y, 0.0, 1.0);
         float n = mossFbm(vMossPos * uNoiseScale);
         float mossMask = smoothstep(0.35, 0.75, upFacing * 0.65 + n * 0.5 - (1.0 - uCoverage) * 0.6);
         // 湿度驱动颜色:干燥偏黄褐 → 湿润深绿
         vec3 dryColor = vec3(0.45, 0.42, 0.18);
         vec3 wetColor = vec3(0.08, 0.32, 0.10);
         vec3 mossColor = mix(dryColor, wetColor, uHumidity) * (0.75 + n * 0.5);
         diffuseColor.rgb = mix(diffuseColor.rgb, mossColor, mossMask);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         // 湿度驱动伪次表面散射:湿润苔藓边缘透光
         float sssStrength = uHumidity * mossMask * 0.8;
         vec3 sssColor = mix(vec3(0.2, 0.5, 0.15), vec3(0.35, 0.7, 0.2), uHumidity);
         vec3 viewDirMoss = normalize(vViewPosition);
         float rimGlow = pow(1.0 - clamp(dot(normalize(vNormal), viewDirMoss), 0.0, 1.0), 2.5);
         reflectedLight.indirectDiffuse += sssColor * rimGlow * sssStrength;`,
      );
  };
  // 让 three 为不同参数组合缓存不同 program
  material.customProgramCacheKey = () => 'bonsai-moss';
}

export class RockeryRenderer {
  readonly group = new THREE.Group();
  private rockMaterial: THREE.MeshStandardMaterial;

  constructor() {
    // 盆钵:开口浅盆 = 侧壁 + 盆沿 + 盆底
    const potMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4a3f3a'),
      roughness: 0.6,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 1.9, 0.42, 48, 1, true), potMat);
    wall.position.y = 0.21;
    wall.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.07, 12, 48), potMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.42;
    rim.castShadow = true;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.3, 48), potMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.34;
    floor.receiveShadow = true;
    this.group.add(wall, rim, floor);

    // 岩石:位移球体
    const rockGeo = new THREE.IcosahedronGeometry(0.85, 4);
    const pos = rockGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const d =
        1 +
        0.22 * Math.sin(v.x * 4.1 + v.y * 2.3) * Math.cos(v.z * 3.7) +
        0.1 * Math.sin(v.y * 9.0 + v.x * 5.0);
      v.multiplyScalar(d);
      v.y *= 0.62; // 压扁
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    rockGeo.computeVertexNormals();
    this.rockMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#6b6560'),
      roughness: 0.9,
      metalness: 0,
    });
    injectMoss(this.rockMaterial);
    const rock = new THREE.Mesh(rockGeo, this.rockMaterial);
    rock.position.set(0.15, 0.48, -0.1);
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.group.add(rock);

    // 土面小岛(也带少量苔藓),中央高出水面
    const soilGeo = new THREE.CylinderGeometry(1.35, 1.5, 0.08, 48);
    const soilMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#3a2f24'),
      roughness: 1,
    });
    injectMoss(soilMat);
    const soil = new THREE.Mesh(soilGeo, soilMat);
    soil.position.y = 0.4;
    soil.receiveShadow = true;
    this.group.add(soil);
  }

  updateMoss(params: MossParams): void {
    MOSS_UNIFORMS.uHumidity.value = params.humidity / 100;
    MOSS_UNIFORMS.uCoverage.value = params.coverage;
    MOSS_UNIFORMS.uNoiseScale.value = params.noiseScale;
  }
}
