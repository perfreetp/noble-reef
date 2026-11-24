/**
 * 三类珠光着色器的 GLSL(WebGL2)与 WGSL(WebGPU)双实现。
 *
 * 绑定约定(两后端保持同名):
 *  - group 0 globalUniforms / group 1 localUniforms:由 Pixi Mesh 管线自动挂载
 *    (GPU 端按绑定名识别;GL 端走 group 100/101,uniform 按名匹配)
 *  - group 2 自定义资源:
 *      binding 0 uMaterials(UBO)
 *      binding 1 uColorTex   基色贴图
 *      binding 2 uDataTex    法线/滤镜像贴图
 *      binding 3 uSampler
 *
 * 渲染目标为 MRT:
 *  - location(0) 预乘 RGBA
 *  - location(1) r/g = 法线 xy,b = 层内深度(0..1),a = 覆盖度
 */

export interface ShaderChunks {
  glsl: { vertex: string; fragment: string };
  wgsl: { vertex: string; fragment: string };
}

/* ---------------- GLSL 公共部分 ---------------- */

const GLSL_HEADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aDepth;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
out vec2 vUV;
out float vDepth;
void main(void) {
  vUV = aUV;
  vDepth = aDepth;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}`;

const GLSL_LIB = `
uniform sampler2D uColorTex;
uniform sampler2D uDataTex;
// 松散 uniform(与 UniformGroup 的键名一致);Pixi GL 后端按名同步。
// 注意:不要用嵌套 struct 实例,Pixi 的 GL 松散 uniform 同步无法写入其成员。
uniform vec4 uParams;    // x: 强度/折射率相关  y: 光泽锐度  z/w: 保留
uniform vec4 uTint;      // 调色调
uniform vec4 uLightDir;  // 归一化光向(xy 屏幕空间,z 保留)

in vec2 vUV;
in float vDepth;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outData;

vec3 decodeN(vec2 e) {
  vec2 xy = e * 2.0 - 1.0;
  float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
  return normalize(vec3(xy, z));
}
// 各向异性高光:Ward 型,cos2/sin2 滤镜像给出切线场
float anisotropicSpec(vec3 n, vec3 l, vec3 v, vec2 filt, float sharp) {
  vec2 cs = filt * 2.0 - 1.0;
  float phi = 0.5 * atan(cs.y, cs.x);
  vec3 t = normalize(vec3(cos(phi), sin(phi), 0.18));
  vec3 b = normalize(cross(n, t));
  vec3 h = normalize(l + v);
  float ndh = max(dot(n, h), 1e-4);
  float tdh = dot(t, h) / ndh;
  float bdh = dot(b, h) / ndh;
  float a2 = max(sharp, 1e-3);
  float d = exp(-(tdh * tdh + bdh * bdh) / a2) / (3.14159265 * a2);
  float ndl = max(dot(n, l), 0.0);
  return ndl * d;
}
float rimFromAlpha(float a, vec2 uv) {
  vec2 px = vec2(1.0) / vec2(textureSize(uColorTex, 0));
  float gx = texture(uColorTex, uv + vec2(px.x, 0.0)).a
           - texture(uColorTex, uv - vec2(px.x, 0.0)).a;
  float gy = texture(uColorTex, uv + vec2(0.0, px.y)).a
           - texture(uColorTex, uv - vec2(0.0, px.y)).a;
  return clamp(length(vec2(gx, gy)) * 2.2, 0.0, 1.0);
}`;

const GLSL_TAIL = `
void main(void) {
  vec4 base = texture(uColorTex, vUV);
  vec3 l = normalize(uLightDir.xyz);
  vec3 v = vec3(0.0, 0.0, 1.0);
  // 不用 early-return:保持与 WGSL 一致的 uniform 控制流(采样都在分支外)
  vec4 shade = shadeFragment(base, vUV, l, v);
  float mask = step(0.001, base.a);
  outColor = vec4(shade.rgb * shade.a * mask, base.a * mask);
  outData = vec4(writeNormal(vUV, base) * mask, vDepth * mask, base.a * mask);
}`;

/* ---------------- WGSL 公共部分 ---------------- */

const WGSL_HEADER = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(2) depth: f32,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>, @location(2) aDepth: f32) -> VSOutput {
  var mvp = globalUniforms.uProjectionMatrix
      * globalUniforms.uWorldTransformMatrix
      * localUniforms.uTransformMatrix;
  return VSOutput(
    vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0),
    aUV,
    aDepth
  );
}`;

const WGSL_LIB = `
struct MaterialUniforms {
  uParams: vec4<f32>,
  uTint: vec4<f32>,
  uLightDir: vec4<f32>,
};
@group(2) @binding(0) var<uniform> uMaterials: MaterialUniforms;
@group(2) @binding(1) var uColorTex: texture_2d<f32>;
@group(2) @binding(2) var uDataTex: texture_2d<f32>;
@group(2) @binding(3) var uSampler: sampler;

fn decodeN(e: vec2<f32>) -> vec3<f32> {
  let xy = e * 2.0 - 1.0;
  let z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
  return normalize(vec3<f32>(xy.x, xy.y, z));
}
fn anisotropicSpec(n: vec3<f32>, l: vec3<f32>, v: vec3<f32>, filt: vec2<f32>, sharp: f32) -> f32 {
  let cs = filt * 2.0 - 1.0;
  let phi = 0.5 * atan2(cs.y, cs.x);
  let t = normalize(vec3<f32>(cos(phi), sin(phi), 0.18));
  let b = normalize(cross(n, t));
  let h = normalize(l + v);
  let ndh = max(dot(n, h), 1e-4);
  let tdh = dot(t, h) / ndh;
  let bdh = dot(b, h) / ndh;
  let a2 = max(sharp, 1e-3);
  let d = exp(-(tdh * tdh + bdh * bdh) / a2) / (3.14159265 * a2);
  return max(dot(n, l), 0.0) * d;
}
fn rimFromAlpha(a: f32, uv: vec2<f32>) -> f32 {
  let dim = vec2<f32>(textureDimensions(uColorTex));
  let px = vec2<f32>(1.0) / dim;
  let gx = textureSample(uColorTex, uSampler, uv + vec2<f32>(px.x, 0.0)).a
         - textureSample(uColorTex, uSampler, uv - vec2<f32>(px.x, 0.0)).a;
  let gy = textureSample(uColorTex, uSampler, uv + vec2<f32>(0.0, px.y)).a
         - textureSample(uColorTex, uSampler, uv - vec2<f32>(0.0, px.y)).a;
  return clamp(length(vec2<f32>(gx, gy)) * 2.2, 0.0, 1.0);
}`;

/* ---------------- 1. 点翠:各向异性光泽 ---------------- */

const KINGFISHER_GLSL = `
vec4 shadeFragment(vec4 base, vec2 uv, vec3 l, vec3 v) {
  vec2 filt = texture(uDataTex, uv).xy;
  // 翠片微凸:用滤镜像梯度近似一个弱法线
  vec3 n = normalize(vec3((filt - 0.5) * 0.6, 1.0));
  float spec = anisotropicSpec(n, l, v, filt, uParams.y);
  float sheen = pow(max(dot(n, l), 0.0), 3.0) * 0.35;
  vec3 iridescent = base.rgb * uTint.rgb;
  vec3 col = iridescent * (0.55 + 0.45 * max(dot(n, l), 0.0))
           + vec3(0.55, 0.85, 1.0) * spec * uParams.x
           + vec3(0.3, 0.7, 0.8) * sheen;
  return vec4(col, base.a);
}
vec2 writeNormal(vec2 uv, vec4 base) {
  vec2 filt = texture(uDataTex, uv).xy;
  return normalize(vec3((filt - 0.5) * 0.6, 1.0)).xy * 0.5 + 0.5;
}`;

const KINGFISHER_WGSL = `
fn shadeFragment(base: vec4<f32>, uv: vec2<f32>, l: vec3<f32>, v: vec3<f32>) -> vec4<f32> {
  let filt = textureSample(uDataTex, uSampler, uv).xy;
  let n = normalize(vec3<f32>((filt - 0.5) * 0.6, 1.0));
  let spec = anisotropicSpec(n, l, v, filt, uMaterials.uParams.y);
  let sheen = pow(max(dot(n, l), 0.0), 3.0) * 0.35;
  let iridescent = base.rgb * uMaterials.uTint.rgb;
  let col = iridescent * (0.55 + 0.45 * max(dot(n, l), 0.0))
          + vec3<f32>(0.55, 0.85, 1.0) * spec * uMaterials.uParams.x
          + vec3<f32>(0.3, 0.7, 0.8) * sheen;
  return vec4<f32>(col, base.a);
}`;

/* ---------------- 2. 珠串:折射(层内渲染) ---------------- */

const PEARL_GLSL = `
vec4 shadeFragment(vec4 base, vec2 uv, vec3 l, vec3 v) {
  vec3 n = decodeN(texture(uDataTex, uv).xy);
  float ndl = max(dot(n, l), 0.0);
  // 珍珠虹彩 + 高光
  float spec = pow(max(dot(normalize(l + v), n), 0.0), 24.0);
  vec3 irid = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + ndl * 0.6));
  vec3 col = base.rgb * (0.6 + 0.4 * ndl) + irid * 0.18 + vec3(1.0) * spec * 0.9;
  return vec4(col, base.a);
}
vec2 writeNormal(vec2 uv, vec4 base) {
  return texture(uDataTex, uv).xy;
}`;

const PEARL_WGSL = `
fn shadeFragment(base: vec4<f32>, uv: vec2<f32>, l: vec3<f32>, v: vec3<f32>) -> vec4<f32> {
  let n = decodeN(textureSample(uDataTex, uSampler, uv).xy);
  let ndl = max(dot(n, l), 0.0);
  let spec = pow(max(dot(normalize(l + v), n), 0.0), 24.0);
  let irid = vec3<f32>(0.5) + 0.5 * cos(6.28318 * (vec3<f32>(0.0, 0.33, 0.67) + ndl * 0.6));
  let col = base.rgb * (0.6 + 0.4 * ndl) + irid * 0.18 + vec3<f32>(1.0) * spec * 0.9;
  return vec4<f32>(col, base.a);
}`;

/* ---------------- 3. 金银錾片:金属高光 + 边缘亮边 ---------------- */

const METAL_GLSL = `
vec4 shadeFragment(vec4 base, vec2 uv, vec3 l, vec3 v) {
  vec3 n = decodeN(texture(uDataTex, uv).xy);
  float ndl = max(dot(n, l), 0.0);
  float spec = pow(max(dot(normalize(l + v), n), 0.0), 18.0);
  float rim = rimFromAlpha(base.a, uv);
  // 金属:基色乘漫反射、强高光,边缘亮边
  vec3 col = base.rgb * (0.35 + 0.65 * ndl) * uTint.rgb
           + base.rgb * spec * 1.4
           + vec3(1.0, 0.95, 0.78) * rim * uParams.x;
  return vec4(col, base.a);
}
vec2 writeNormal(vec2 uv, vec4 base) {
  return texture(uDataTex, uv).xy;
}`;

const METAL_WGSL = `
fn shadeFragment(base: vec4<f32>, uv: vec2<f32>, l: vec3<f32>, v: vec3<f32>) -> vec4<f32> {
  let n = decodeN(textureSample(uDataTex, uSampler, uv).xy);
  let ndl = max(dot(n, l), 0.0);
  let spec = pow(max(dot(normalize(l + v), n), 0.0), 18.0);
  let rim = rimFromAlpha(base.a, uv);
  let col = base.rgb * (0.35 + 0.65 * ndl) * uMaterials.uTint.rgb
          + base.rgb * spec * 1.4
          + vec3<f32>(1.0, 0.95, 0.78) * rim * uMaterials.uParams.x;
  return vec4<f32>(col, base.a);
}`;

export type MaterialKind = 'kingfisher' | 'pearl' | 'metal';

const FRAG_BODY: Record<MaterialKind, { glsl: string; wgsl: string }> = {
  kingfisher: { glsl: KINGFISHER_GLSL, wgsl: KINGFISHER_WGSL },
  pearl: { glsl: PEARL_GLSL, wgsl: PEARL_WGSL },
  metal: { glsl: METAL_GLSL, wgsl: METAL_WGSL },
};

/**
 * WGSL 的 MRT 第二附件:主片元函数需要同时返回两个 location。
 * 用结构体输出包一层,并在片元末尾写 outData。
 */
function wgslFragmentWithMRT(kind: MaterialKind): string {
  const normalExpr =
    kind === 'kingfisher'
      ? `normalize(vec3<f32>((filt - 0.5) * 0.6, 1.0)).xy * 0.5 + 0.5`
      : `textureSample(uDataTex, uSampler, vUV).xy`;
  const preamble =
    kind === 'kingfisher'
      ? `let filt = textureSample(uDataTex, uSampler, vUV).xy;`
      : ``;
  return `
struct FragOut {
  @location(0) color: vec4<f32>,
  @location(1) data: vec4<f32>,
};
@fragment
fn mainFragment(@location(0) vUV: vec2<f32>, @location(2) vDepth: f32) -> FragOut {
  // 所有纹理采样都在 uniform 控制流(无分支)中完成,满足 WGSL 校验
  let base = textureSample(uColorTex, uSampler, vUV);
  ${preamble}
  let l = normalize(uMaterials.uLightDir.xyz);
  let v = vec3<f32>(0.0, 0.0, 1.0);
  let shade = shadeFragment(base, vUV, l, v);
  let mask = step(0.001, base.a);
  var out: FragOut;
  out.color = vec4<f32>(shade.rgb * shade.a * mask, base.a * mask);
  out.data = vec4<f32>(${normalExpr} * mask, vDepth * mask, base.a * mask);
  return out;
}`;
}

export function buildMaterialShader(kind: MaterialKind): ShaderChunks {
  const body = FRAG_BODY[kind];
  return {
    glsl: {
      vertex: GLSL_HEADER,
      // vUV/vDepth 与 out 声明均在 GLSL_LIB 中,这里不重复
      fragment: `#version 300 es
precision highp float;
${GLSL_LIB}
${body.glsl}
${GLSL_TAIL}`,
    },
    wgsl: {
      vertex: WGSL_HEADER,
      fragment: `
${WGSL_LIB}
${body.wgsl}
${wgslFragmentWithMRT(kind)}`,
    },
  };
}
