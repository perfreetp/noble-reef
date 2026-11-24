import * as THREE from 'three';
import { sharedUniforms, PROJECT_GLSL, R } from './projection.js';

// 银道坐标系(J2000):银北极 赤经 192.8595° 赤纬 +27.1284°
const GP_RA = (192.8595 * Math.PI) / 180;
const GP_DEC = (27.1284 * Math.PI) / 180;

/** 由赤经赤纬(弧度)求银纬(弧度) */
function galacticLatitude(ra, dec) {
  return Math.asin(
    Math.sin(dec) * Math.sin(GP_DEC) +
      Math.cos(dec) * Math.cos(GP_DEC) * Math.cos(ra - GP_RA)
  );
}

/** 程序化生成银河带纹理(等距柱状,直接贴到球面 UV) */
function makeMilkyWayTexture(w = 1024, h = 512) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  // 银心方向(人马座):赤经 266.4° 赤纬 -29°
  const gcRa = (266.4 * Math.PI) / 180;
  const gcDec = (-29 * Math.PI) / 180;

  for (let y = 0; y < h; y++) {
    const dec = (0.5 - y / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const ra = (x / w) * Math.PI * 2;
      const b = galacticLatitude(ra, dec);
      // 银带:银纬 ±10° 高斯衰减
      let v = Math.exp(-(b * b) / (2 * 0.16 * 0.16));
      // 银心增亮
      const dgc = Math.acos(
        Math.min(1,
          Math.sin(dec) * Math.sin(gcDec) +
          Math.cos(dec) * Math.cos(gcDec) * Math.cos(ra - gcRa)
        )
      );
      v += 0.9 * Math.exp(-(dgc * dgc) / (2 * 0.5 * 0.5));
      // 大尺度结构噪声
      const n =
        0.6 +
        0.25 * Math.sin(ra * 7.3 + Math.sin(dec * 9.1) * 2.0) *
          Math.sin(dec * 11.7 + ra * 3.1) +
        0.15 * Math.sin(ra * 23.0 + dec * 17.0);
      v *= Math.max(0, n);
      // 暗裂(银道面附近的尘埃带)
      const lane = Math.exp(-((b + 0.02) * (b + 0.02)) / (2 * 0.03 * 0.03)) *
        (0.5 + 0.5 * Math.sin(ra * 5.0 + 1.7));
      v *= 1 - 0.55 * lane;
      const g = Math.round(255 * Math.min(1, v));
      const i = (y * w + x) * 4;
      d[i] = g; d[i + 1] = g; d[i + 2] = Math.min(255, g + 18); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const VERT = /* glsl */ `
varying vec2 vUv;
${PROJECT_GLSL}
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(skyProject(world.xyz), 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec3 tex = texture2D(uMap, vUv).rgb;
  vec3 tint = vec3(0.72, 0.80, 1.0);
  gl_FragColor = vec4(tex * tint * uIntensity, 1.0);
}
`;

/**
 * 银河图层:半透明带状纹理球壳,与星空图层加法混合。
 * 强度三档:弱 / 标准 / 强。
 */
export function createMilkyWay() {
  const geo = new THREE.SphereGeometry(R - 4, 128, 64);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProjection: sharedUniforms.uProjection,
      uMap: { value: makeMilkyWayTexture() },
      uIntensity: { value: 0.7 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;

  const LEVELS = [0.35, 0.7, 1.25];
  return {
    mesh,
    setIntensity(level) {
      material.uniforms.uIntensity.value = LEVELS[THREE.MathUtils.clamp(level, 0, 2)];
    },
  };
}
