/**
 * 水下渲染着色器。
 *
 * 管线：
 *   场景 Pass（HDR float target，自定义水下光照材质）
 *     → 每盏灯按距离做 Beer-Lambert 三通道吸收 + 多灯贡献线性叠加
 *   均值 Pass（1x1 mipmap 采样，供自动白平衡）
 *   输出 Pass（相机路径吸收 + 后向散射 → 白平衡增益 → ACES 色调映射 → sRGB）
 */

export const MAX_LIGHTS_GLSL = 4;

/** 共享 uniform 声明（场景材质与输出材质共同使用） */
export const WATER_UNIFORMS_GLSL = /* glsl */ `
#define MAX_LIGHTS ${MAX_LIGHTS_GLSL}
uniform int uLightCount;
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform float uLightIntensity[MAX_LIGHTS];
uniform float uLightEnabled[MAX_LIGHTS];
uniform vec3 uAbsorption;       // 每通道吸收系数 (1/m)，红 > 绿 > 蓝
uniform vec3 uBackscatterColor; // 后向散射颜色（线性）
uniform float uBackscatterDensity;
uniform vec3 uAmbient;          // 已按水体档位调色的环境光
`;

/** 水下物体表面材质：环境 + 多灯 Lambert 漫反射 + Blinn-Phong 高光 */
export const UNDERWATER_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const UNDERWATER_FRAGMENT = /* glsl */ `
precision highp float;

${WATER_UNIFORMS_GLSL}
uniform vec3 uBaseColor;
uniform float uMetalness;
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // 环境项（本身已带水体蓝绿偏色）
  vec3 lit = uBaseColor * uAmbient;
  vec3 specAccum = vec3(0.0);

  // 多盏灯：各自计算吸收后按贡献线性叠加（HDR，允许 >1，交给色调映射防过曝）
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLightCount) break;
    if (uLightEnabled[i] < 0.5) continue;

    vec3 toLight = uLightPos[i] - vWorldPos;
    float dist = max(length(toLight), 1e-4);
    vec3 L = toLight / dist;

    float ndl = max(dot(N, L), 0.0);
    // 软逆平方距离衰减
    float geometric = 1.0 / (1.0 + 0.35 * dist * dist);
    // Beer-Lambert：红光指数衰减最快，距离越远残余光越偏蓝绿
    vec3 transmittance = exp(-uAbsorption * dist);
    vec3 radiance = uLightColor[i] * uLightIntensity[i] * geometric * transmittance;

    lit += uBaseColor * radiance * ndl;

    vec3 H = normalize(L + V);
    float shininess = mix(22.0, 96.0, uMetalness);
    float spec = pow(max(dot(N, H), 0.0), shininess);
    vec3 specTint = mix(vec3(1.0), uBaseColor, uMetalness);
    specAccum += specTint * radiance * spec * 0.45;
  }

  gl_FragColor = vec4(lit + specAccum, 1.0);
}
`;

/** 全屏三角形顶点 */
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const TONEMAP_GLSL = /* glsl */ `
// Narkowicz ACES filmic，平滑压缩 HDR 叠加结果，抑制多灯过曝
vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 linToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
`;

/** 输出 Pass：相机路径吸收 + 后向散射 + 白平衡 + 色调映射 */
export const OUTPUT_FRAGMENT = /* glsl */ `
precision highp float;

${WATER_UNIFORMS_GLSL}
uniform sampler2D tHDR;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform vec3 uWBGain;
uniform float uExposure;
varying vec2 vUv;

${TONEMAP_GLSL}

float viewDistanceFromDepth(float depth) {
  // perspectiveDepthToViewZ
  float viewZ = (uNear * uFar) / ((uFar - uNear) * depth - uFar);
  return -viewZ;
}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  float dist = depth >= 0.99999 ? uFar : viewDistanceFromDepth(depth);

  vec3 hdr = texture2D(tHDR, vUv).rgb;

  // 相机到物体这段水路径的三通道吸收 + 加性后向散射
  vec3 transmittance = exp(-uAbsorption * dist);
  vec3 scatter = uBackscatterColor * (1.0 - exp(-uBackscatterDensity * dist));
  vec3 color = hdr * transmittance + scatter;

  // 白平衡增益（自动或手动）
  color *= uWBGain;
  color *= uExposure;

  color = acesFilm(color);
  color = linToSRGB(color);
  gl_FragColor = vec4(color, 1.0);
}
`;

/** 纯拷贝 Pass（LDR target → 屏幕） */
export const COPY_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tMap, vUv);
}
`;
