import * as THREE from 'three';

/** 天球半径(世界单位) */
export const R = 100;
/** 等距柱状投影平面半宽 / 半高 */
export const EQ_W = 200;
export const EQ_H = 100;

/** 所有图层共享的 uniform:0 = 球面投影,1 = 等距柱状投影 */
export const sharedUniforms = {
  uProjection: { value: 0 },
};

/** GLSL:把球面方向重采样到目标投影,输出世界坐标 */
export const PROJECT_GLSL = /* glsl */ `
uniform float uProjection;
vec3 skyProject(vec3 worldPos) {
  if (uProjection < 0.5) return worldPos;
  vec3 dir = normalize(worldPos);
  float lon = atan(dir.z, dir.x);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  return vec3(lon / 3.14159265 * ${EQ_W.toFixed(1)},
              lat / 1.5707963 * ${EQ_H.toFixed(1)}, 0.0);
}
`;

/** CPU 侧同一投影函数,用于文字标注等需要显式定位的对象 */
export function projectDirCPU(dir, mode, out = new THREE.Vector3()) {
  if (mode === 0) return out.copy(dir).multiplyScalar(R);
  const lon = Math.atan2(dir.z, dir.x);
  const lat = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  return out.set((lon / Math.PI) * EQ_W, (lat / (Math.PI / 2)) * EQ_H, 0);
}
