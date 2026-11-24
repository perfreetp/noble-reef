/**
 * 层间全屏复合着色器(自底向上乒乓)。
 *
 * 输入:
 *  uBelow     已合成的下层累加图(预乘 RGBA)
 *  uBelowMeta 下层累加元数据:r=累计覆盖度  g=最上层序(归一化) b=最上层内深度 a=保留
 *  uLayer     当前层颜色图(预乘 RGBA)
 *  uLayerData 当前层数据图:rg=法线 xy,b=层内深度,a=覆盖度
 *
 * 规则:
 *  - 珠串层:按法线偏移折射采样下层,偏移落点无覆盖时回退正下方,避免拉入背景
 *  - 点翠层:半透明,下层珠光按 (1-a) 透出
 *  - 金银层:近不透明,完全遮蔽其下层(不透出被饰片遮挡的部分)
 *  - 混合模式作用于当前层颜色,再按 alpha 与下层 over 合成
 *  - 输出 MRT:location(0) 新累加颜色,location(1) 新累加元数据
 */

export interface CompositeChunks {
  glsl: { vertex: string; fragment: string };
  wgsl: { vertex: string; fragment: string };
}

const VERT_GLSL = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
out vec2 vUV;
void main(void) {
  vUV = aUV;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}`;

const VERT_WGSL = `
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
};
@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix
      * globalUniforms.uWorldTransformMatrix
      * localUniforms.uTransformMatrix;
  return VSOutput(vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0), aUV);
}`;

/** 混合模式与复合公共库(GLSL) */
const LIB_GLSL = `
uniform sampler2D uBelow;
uniform sampler2D uBelowMeta;
uniform sampler2D uLayer;
uniform sampler2D uLayerData;
// x=不透明度 y=层种类(0翠 1珠 2金) z=折射强度 w=混合模式枚举
uniform vec4 uCompParams;
uniform vec2 uTexel;
uniform float uLayerOrder;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMeta;

vec3 unpremult(vec4 c) { return c.a > 1e-4 ? c.rgb / c.a : vec3(0.0); }

vec3 blendModeMix(vec3 src, vec3 dst, float mode) {
  // 1 add 2 multiply 3 screen 4 overlay 5 soft-light 6 hard-light
  vec3 r;
  if (mode < 0.5) { r = src; }
  else if (mode < 1.5) { r = src + dst; }
  else if (mode < 2.5) { r = src * dst; }
  else if (mode < 3.5) { r = 1.0 - (1.0 - src) * (1.0 - dst); }
  else if (mode < 4.5) {
    vec3 lo = 2.0 * src * dst;
    vec3 hi = 1.0 - 2.0 * (1.0 - src) * (1.0 - dst);
    r = mix(lo, hi, step(0.5, dst));
  } else if (mode < 5.5) {
    vec3 w = (dst - 0.5) * (src - 0.5);
    r = dst - (1.0 - 2.0 * src) * w * 0.5;
  } else {
    vec3 lo = 2.0 * src * dst;
    vec3 hi = 1.0 - 2.0 * (1.0 - src) * (1.0 - dst);
    r = mix(lo, hi, step(0.5, src));
  }
  return clamp(r, 0.0, 1.0);
}

void main(void) {
  vec2 uv = vUV;
  vec4 layerPx = texture(uLayer, uv);
  vec4 dataPx = texture(uLayerData, uv);
  vec4 belowPx = texture(uBelow, uv);
  vec4 belowMeta = texture(uBelowMeta, uv);

  float opacity = uCompParams.x;
  float kind = uCompParams.y;
  float refractStrength = uCompParams.z;
  float mode = uCompParams.w;
  float a = clamp(layerPx.a * opacity, 0.0, 1.0);

  // 珠串折射:按层法线偏移采样下层;落点无覆盖则回退,防止拉入冠面外背景
  vec3 belowRGB = unpremult(belowPx);
  if (kind > 0.5 && kind < 1.5 && a > 0.001) {
    vec2 n2 = dataPx.xy * 2.0 - 1.0;
    vec2 offUv = uv + n2 * refractStrength * uTexel * (0.4 + dataPx.a);
    offUv = clamp(offUv, vec2(0.0), vec2(1.0));
    vec4 offMeta = texture(uBelowMeta, offUv);
    vec4 offBelow = texture(uBelow, offUv);
    vec3 refracted = unpremult(offBelow);
    // 落点无覆盖(背景)时回退正采样,遮挡边界不拖影
    belowRGB = mix(belowRGB, refracted, clamp(offMeta.r * 1.5, 0.0, 1.0));
  }

  vec3 srcRGB = unpremult(layerPx);
  vec3 dstRGB = belowRGB;
  vec3 mixed = blendModeMix(srcRGB, dstRGB, mode);

  // 翠片额外透光项:半透明翠片把下层珠光轻微提亮并染色透出
  if (kind < 0.5 && a > 0.001 && a < 0.999) {
    mixed = mix(mixed, mixed + dstRGB * 0.35, 1.0 - a);
  }

  vec3 outRGB = mixed * a + belowRGB * (1.0 - a);
  outColor = vec4(outRGB, 1.0); // 累加图始终不透明(画布底色在最底层补)

  // 元数据:覆盖度按 over 累计;最上层标记随当前层覆盖刷新
  float cov = a + belowMeta.r * (1.0 - a);
  float topOrder = mix(belowMeta.g, uLayerOrder, step(0.5, a));
  float topDepth = mix(belowMeta.b, dataPx.b, step(0.5, a));
  outMeta = vec4(cov, topOrder, topDepth, 1.0);
}`;

/** 混合模式与复合公共库(WGSL) */
const LIB_WGSL = `
struct CompUniforms {
  uCompParams: vec4<f32>,
  uTexel: vec2<f32>,
  uLayerOrder: f32,
  uPad: f32,
};
@group(2) @binding(0) var<uniform> uComp: CompUniforms;
@group(2) @binding(1) var uBelow: texture_2d<f32>;
@group(2) @binding(2) var uBelowMeta: texture_2d<f32>;
@group(2) @binding(3) var uLayer: texture_2d<f32>;
@group(2) @binding(4) var uLayerData: texture_2d<f32>;
@group(2) @binding(5) var uSampler: sampler;

fn unpremult(c: vec4<f32>) -> vec3<f32> {
  return select(vec3<f32>(0.0), c.rgb / c.a, c.a > 1e-4);
}
fn blendModeMix(src: vec3<f32>, dst: vec3<f32>, mode: f32) -> vec3<f32> {
  var r = src;
  if (mode > 0.5 && mode < 1.5) { r = src + dst; }
  else if (mode > 1.5 && mode < 2.5) { r = src * dst; }
  else if (mode > 2.5 && mode < 3.5) { r = vec3<f32>(1.0) - (vec3<f32>(1.0) - src) * (vec3<f32>(1.0) - dst); }
  else if (mode > 3.5 && mode < 4.5) {
    let lo = 2.0 * src * dst;
    let hi = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - src) * (vec3<f32>(1.0) - dst);
    r = mix(lo, hi, step(vec3<f32>(0.5), dst));
  } else if (mode > 4.5 && mode < 5.5) {
    let w = (dst - vec3<f32>(0.5)) * (src - vec3<f32>(0.5));
    r = dst - (vec3<f32>(1.0) - 2.0 * src) * w * 0.5;
  } else if (mode > 5.5) {
    let lo = 2.0 * src * dst;
    let hi = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - src) * (vec3<f32>(1.0) - dst);
    r = mix(lo, hi, step(vec3<f32>(0.5), src));
  }
  return clamp(r, vec3<f32>(0.0), vec3<f32>(1.0));
}
struct CompOut {
  @location(0) color: vec4<f32>,
  @location(1) metaOut: vec4<f32>,
};
@fragment
fn mainFragment(@location(0) vUV: vec2<f32>) -> CompOut {
  let layerPx = textureSample(uLayer, uSampler, vUV);
  let dataPx = textureSample(uLayerData, uSampler, vUV);
  let belowPx = textureSample(uBelow, uSampler, vUV);
  let belowMeta = textureSample(uBelowMeta, uSampler, vUV);

  let opacity = uComp.uCompParams.x;
  let kind = uComp.uCompParams.y;
  let refractStrength = uComp.uCompParams.z;
  let mode = uComp.uCompParams.w;
  let a = clamp(layerPx.a * opacity, 0.0, 1.0);

  var belowRGB = unpremult(belowPx);
  // 折射采样移出分支(uniform 控制流):恒做偏移采样,再用权重决定是否采用
  let n2 = dataPx.xy * 2.0 - 1.0;
  var offUv = vUV + n2 * refractStrength * uComp.uTexel * (0.4 + dataPx.a);
  offUv = clamp(offUv, vec2<f32>(0.0), vec2<f32>(1.0));
  let offMeta = textureSample(uBelowMeta, uSampler, offUv);
  let offBelow = textureSample(uBelow, uSampler, offUv);
  let refracted = unpremult(offBelow);
  // 仅珠串层(kind≈1)且有覆盖时启用折射;落点无覆盖时权重趋零,自动回退正采样
  let isPearl = step(0.5, kind) * step(kind, 1.5);
  let refractW = isPearl * step(0.001, a) * clamp(offMeta.r * 1.5, 0.0, 1.0);
  belowRGB = mix(belowRGB, refracted, refractW);

  let srcRGB = unpremult(layerPx);
  var mixed = blendModeMix(srcRGB, belowRGB, mode);
  // 翠片半透明透光(无采样,分支安全)
  let isKing = 1.0 - step(0.5, kind);
  let sheenW = isKing * step(0.001, a) * step(a, 0.999);
  mixed = mix(mixed, mixed + belowRGB * 0.35, sheenW * (1.0 - a));

  let outRGB = mixed * a + belowRGB * (1.0 - a);
  var out: CompOut;
  out.color = vec4<f32>(outRGB, 1.0);
  let cov = a + belowMeta.r * (1.0 - a);
  let topOrder = mix(belowMeta.g, uComp.uLayerOrder, step(0.5, a));
  let topDepth = mix(belowMeta.b, dataPx.b, step(0.5, a));
  out.metaOut = vec4<f32>(cov, topOrder, topDepth, 1.0);
  return out;
}`;

export function buildCompositeShader(): CompositeChunks {
  return {
    glsl: {
      vertex: VERT_GLSL,
      fragment: `${VERT_GLSL.includes('#version') ? '' : ''}#version 300 es
precision highp float;
in vec2 vUV;
${LIB_GLSL}`,
    },
    wgsl: {
      vertex: VERT_WGSL,
      fragment: `
${LIB_WGSL}`,
    },
  };
}

/** 混合模式名 -> shader 枚举值(0 normal) */
export const BLEND_MODE_ENUM: Record<string, number> = {
  normal: 0,
  add: 1,
  multiply: 2,
  screen: 3,
  overlay: 4,
  'soft-light': 5,
  'hard-light': 6,
};
