import * as THREE from 'three';
import { raDecToDir } from '../astro.js';
import { sharedUniforms, PROJECT_GLSL, R } from './projection.js';

/** 简单可复现的伪随机数 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** B-V 色指数 -> 近似 RGB */
function bvToColor(bv) {
  const t = THREE.MathUtils.clamp((bv + 0.3) / 1.9, 0, 1);
  return [
    0.65 + 0.35 * t,
    0.72 + 0.26 * Math.sin(t * Math.PI * 0.5),
    1.0 - 0.5 * t * t,
  ];
}

const VERT = /* glsl */ `
attribute float aMag;
attribute vec3 aColor;
uniform float uScale;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vBright;
${PROJECT_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 p = skyProject(world.xyz);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // 星等越高亮度越低:星等 6.5 等比 0 等暗约 400 倍
  vBright = pow(10.0, -0.4 * (aMag - 1.0));
  vColor = aColor;
  float size = clamp(7.2 - aMag, 1.1, 8.0) * uPixelRatio;
  gl_PointSize = uProjection < 0.5
    ? size * uScale / max(1.0, -mv.z)
    : size * 0.55;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vBright;
uniform float uExposure;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.06, d);
  gl_FragColor = vec4(vColor * vBright * uExposure * a, a);
}
`;

/**
 * 星空图层:按星等分级渲染的恒星点云。
 * 位置由赤经赤纬一次性换算到球面坐标,时间联动靠 skyGroup 整体旋转,
 * 因此拖动时间滑杆时每帧只有一次矩阵更新,8000 颗恒星轻松超过 30fps。
 */
export function createStars(count = 8000) {
  const rand = mulberry32(20261124);
  const pos = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const v = [0, 0, 0];

  for (let i = 0; i < count; i++) {
    // 球面均匀分布 -> 赤经赤纬
    const ra = rand() * 24;
    const dec = (Math.asin(rand() * 2 - 1) * 180) / Math.PI;
    raDecToDir(ra, dec, v);
    pos[i * 3] = v[0] * R;
    pos[i * 3 + 1] = v[1] * R;
    pos[i * 3 + 2] = v[2] * R;
    // 星等分布:暗星远多于亮星(近似实际恒星计数)
    const u = rand();
    mag[i] = -1.2 + 7.7 * Math.pow(u, 0.42);
    const [r, g, b] = bvToColor(rand() * 1.9 - 0.3);
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProjection: sharedUniforms.uProjection,
      uScale: { value: 1000 },
      uPixelRatio: { value: 1 },
      uExposure: { value: 1.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}
