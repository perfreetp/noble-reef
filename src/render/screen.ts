import * as THREE from 'three';

/**
 * 灯幕材质:把双层遮罩合成成皮影灯幕效果。
 *   影偶外部  -> 暖色幕光
 *   皮革区域  -> 近黑剪影
 *   镂空区域  -> 高亮光(随背光强度变化)
 *
 * 遮罩相机为原点对称视锥(半高 uMaskHalf),世界坐标按线性映射采样,
 * 主视区灯幕与 PiP 全屏 quad 使用同一套映射,光斑位置严格一致。
 */
export function createScreenMaterial(
  silhouette: THREE.Texture,
  cutout: THREE.Texture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tSilhouette: { value: silhouette },
      tCutout: { value: cutout },
      uIntensity: { value: 1.0 },
      uMaskHalf: { value: 3.2 },
      uPiP: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSilhouette;
      uniform sampler2D tCutout;
      uniform float uIntensity;
      uniform float uMaskHalf;
      uniform float uPiP;
      varying vec2 vUv;
      varying vec3 vWorld;

      void main() {
        vec2 uv;
        if (uPiP > 0.5) {
          uv = vUv; // PiP 全屏 quad 与遮罩视锥一一对应
        } else {
          // 遮罩渲染的是含根偏移的世界矩阵,与灯幕同处世界坐标系:
          // 灯幕世界点按对称视锥线性映射,即与皮革实体 1:1 对齐。
          uv = vWorld.xy / (2.0 * uMaskHalf) + 0.5;
        }
        // 遮罩视锥外只显示幕布
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          vec3 base = vec3(0.16, 0.11, 0.07);
          gl_FragColor = vec4(base, 1.0);
          return;
        }

        float sil = texture2D(tSilhouette, uv).r;  // 0=皮革 1=外部
        float cut = texture2D(tCutout, uv).r;      // 0=镂空内 1=其他
        vec3 warm = mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.97, 0.86), uv.y);
        vec2 d = uv - 0.5;
        float vignette = 1.0 - 0.35 * dot(d, d);

        vec3 col;
        if (sil < 0.5) {
          if (cut < 0.5) {
            // 镂空透光:背光越强,镂花越亮
            col = warm * clamp(uIntensity, 0.0, 1.8) * 1.15;
          } else {
            // 皮革剪影:近黑,带极弱透皮暖光
            col = vec3(0.012, 0.008, 0.005) + warm * 0.03 * uIntensity;
          }
        } else {
          // 灯幕底光
          col = warm * (0.42 * uIntensity) + vec3(0.05, 0.03, 0.02);
        }
        gl_FragColor = vec4(col * vignette, 1.0);
      }
    `,
    depthWrite: false,
    depthTest: true,
  });
}
