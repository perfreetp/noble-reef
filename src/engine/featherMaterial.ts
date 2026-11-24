import * as THREE from 'three';

/** 光泽锐度三档:丝缎 / 亮泽 / 镜亮 */
export const GLOSS_LEVELS = [24, 64, 160];
export const GLOSS_LABELS = ['丝缎', '亮泽', '镜亮'];

/** 全局共享光照 uniforms:所有羽枝材质引用同一对象,拖光源只改一处。 */
export interface SharedOptics {
  uLightDir: { value: THREE.Vector3 };
  uLightColor: { value: THREE.Color };
  uAmbient: { value: THREE.Color };
  uLightIntensity: { value: number };
}

export function createSharedOptics(): SharedOptics {
  return {
    uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.6).normalize() },
    uLightColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
    uAmbient: { value: new THREE.Color(0.22, 0.26, 0.32) },
    uLightIntensity: { value: 1.2 },
  };
}

const VERT = /* glsl */ `
attribute vec3 tangent;
varying vec3 vN;
varying vec3 vT;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vT = normalize(mat3(modelMatrix) * tangent);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform float uLightIntensity;
uniform float uFiberAngle;
uniform float uHueShift;
uniform float uGloss;
uniform float uIrid;
uniform float uWarn;
varying vec3 vN;
varying vec3 vT;
varying vec2 vUv;
varying vec3 vWorldPos;

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(a), sa = sin(a);
  return clamp(c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca), 0.0, 1.0);
}

void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.02) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  // 纤维方向角:切线绕法线旋转
  float ca = cos(uFiberAngle), sa = sin(uFiberAngle);
  vec3 T = normalize(vT * ca + cross(N, vT) * sa);

  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);

  // 虹彩:视角越掠射,色相偏移越大
  float shift = (uHueShift + uIrid * (1.0 - abs(dot(N, V)))) * 6.2831853;
  vec3 albedo = hueRotate(tex.rgb, shift);

  float ndl = max(dot(N, L), 0.0);

  // Kajiya-Kay 各向异性高光
  float TH = clamp(dot(T, H), -1.0, 1.0);
  float sinTH = sqrt(max(0.0, 1.0 - TH * TH));
  float spec = pow(sinTH, uGloss) * uLightIntensity;
  float sheen = pow(sinTH, max(uGloss * 0.25, 4.0)) * 0.35;

  vec3 specColor = hueRotate(vec3(0.9, 1.0, 0.95), shift + 1.2);
  vec3 col = albedo * (uAmbient + uLightColor * ndl * 0.85 * uLightIntensity)
           + specColor * spec
           + albedo * sheen;

  // 间隙超标红色警示(边缘泛红光)
  float rim = pow(1.0 - abs(dot(N, V)), 2.0);
  col = mix(col, vec3(1.0, 0.14, 0.10), uWarn * (0.30 + 0.70 * rim));

  gl_FragColor = vec4(col, tex.a * 0.96);
}
`;

export function createFeatherMaterial(shared: SharedOptics, map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uMap: { value: map },
      // 共享光照,引用同一对象
      uLightDir: shared.uLightDir,
      uLightColor: shared.uLightColor,
      uAmbient: shared.uAmbient,
      uLightIntensity: shared.uLightIntensity,
      // 每根羽枝独立
      uFiberAngle: { value: 0 },
      uHueShift: { value: 0 },
      uGloss: { value: GLOSS_LEVELS[1] },
      uIrid: { value: 0.5 },
      uWarn: { value: 0 },
    },
  });
}
