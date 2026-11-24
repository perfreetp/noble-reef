import * as THREE from 'three';

export interface TerrainShaderUniforms {
  uContourInterval: { value: number };
  uMajorEvery: { value: number };
  uContourColor: { value: THREE.Color };
  uMajorContourColor: { value: THREE.Color };
  uSlopeStops: { value: number };
  uSlopeColors: { value: THREE.Color[] };
  uSlopeBounds: { value: number[] };
}

/** 低多边形风格坡度色带：按 normal.y 从缓到陡 */
export const SLOPE_COLORS = [
  new THREE.Color(0x7fae5a), // 缓坡草地
  new THREE.Color(0xa8b063), // 草-岩过渡
  new THREE.Color(0x9c8466), // 岩土
  new THREE.Color(0x8a7468), // 较陡岩石
  new THREE.Color(0xb0563f), // 超 12° 警示色带
  new THREE.Color(0xe8e8ec), // 陡崖/雪线
];

/** 对应 1-normalY 的边界（normalY 越小越陡） */
export const SLOPE_BOUNDS = [0.0, 0.022, 0.08, 0.18, 0.32, 0.6];

export const createTerrainUniforms = (contourInterval: number): TerrainShaderUniforms => ({
  uContourInterval: { value: contourInterval },
  uMajorEvery: { value: 5 },
  uContourColor: { value: new THREE.Color(0x4d5b3c) },
  uMajorContourColor: { value: new THREE.Color(0x2e3826) },
  uSlopeStops: { value: SLOPE_COLORS.length },
  uSlopeColors: { value: SLOPE_COLORS },
  uSlopeBounds: { value: SLOPE_BOUNDS },
});

/**
 * 在 MeshStandardMaterial 上注入等高线 + 坡度着色，保留 PBR 光照与阴影。
 * flatShading 由材质自身开启（低多边形观感）。
 */
export const injectTerrainShader = (
  material: THREE.MeshStandardMaterial,
  uniforms: TerrainShaderUniforms,
): void => {
  Object.assign(material.userData, uniforms);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.userData);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPos;
         varying vec3 vNormalW;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPos = worldPosition.xyz;
         vNormalW = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uContourInterval;
         uniform float uMajorEvery;
         uniform vec3 uContourColor;
         uniform vec3 uMajorContourColor;
         uniform int uSlopeStops;
         uniform vec3 uSlopeColors[6];
         uniform float uSlopeBounds[6];
         varying vec3 vWorldPos;
         varying vec3 vNormalW;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           // 坡度着色：normal.y = cos(坡角)，1 为平地
           float ny = clamp(normalize(vNormalW).y, 0.0, 1.0);
           float steep = 1.0 - ny;
           vec3 slopeCol = uSlopeColors[0];
           for (int i = 1; i < 6; i++) {
             if (i >= uSlopeStops) break;
             float t = smoothstep(uSlopeBounds[i - 1], uSlopeBounds[i], steep);
             slopeCol = mix(slopeCol, uSlopeColors[i], t);
           }
           // 等高线：fwidth 抗锯齿
           float g = vWorldPos.y / uContourInterval;
           float f = abs(fract(g) - 0.5);
           float aa = fwidth(g) * 1.2 + 1e-4;
           float minor = 1.0 - smoothstep(0.5 - aa, 0.5, f);
           float gm = vWorldPos.y / (uContourInterval * uMajorEvery);
           float fm = abs(fract(gm) - 0.5);
           float major = 1.0 - smoothstep(0.5 - fwidth(gm) * 1.2 - 1e-4, 0.5, fm);
           vec3 lineCol = mix(uContourColor, uMajorContourColor, major);
           float lineWeight = clamp(minor * 0.5 + major * 0.85, 0.0, 1.0);
           diffuseColor.rgb = mix(slopeCol, lineCol, lineWeight);
         }`,
      );
  };
};
