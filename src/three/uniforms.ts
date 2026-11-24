import * as THREE from 'three';
import type { WBGains } from '../types';
import { MAX_LIGHTS_GLSL } from './shaders';

/**
 * 所有水下材质共享同一份 uniform 对象（值持有在 three 层，
 * 避免 4 灯 × 多材质逐帧产生大量对象分配）。
 */
export interface UniformsHandle {
  shared: Record<string, THREE.IUniform>;
  setLights: (
    positions: THREE.Vector3[],
    colors: THREE.Color[],
    intensities: number[],
    enabled: number[],
    count: number,
  ) => void;
  setWater: (absorption: WBGains, backscatterColor: WBGains, backscatterDensity: number, ambient: WBGains) => void;
  setWBGain: (g: WBGains) => void;
  setExposure: (e: number) => void;
}

export function createSharedUniforms(): UniformsHandle {
  const shared: Record<string, THREE.IUniform> = {
    uLightCount: { value: 0 },
    uLightPos: { value: Array.from({ length: MAX_LIGHTS_GLSL }, () => new THREE.Vector3()) },
    uLightColor: { value: Array.from({ length: MAX_LIGHTS_GLSL }, () => new THREE.Color()) },
    uLightIntensity: { value: new Array(MAX_LIGHTS_GLSL).fill(0) },
    uLightEnabled: { value: new Array(MAX_LIGHTS_GLSL).fill(0) },
    uAbsorption: { value: new THREE.Vector3() },
    uBackscatterColor: { value: new THREE.Vector3() },
    uBackscatterDensity: { value: 0 },
    uAmbient: { value: new THREE.Vector3() },
    // 仅输出 Pass 使用，放在共享表里无妨
    uWBGain: { value: new THREE.Vector3(1, 1, 1) },
    uExposure: { value: 1 },
  };

  return {
    shared,
    setLights(positions, colors, intensities, enabled, count) {
      shared.uLightCount.value = count;
      const pos = shared.uLightPos.value as THREE.Vector3[];
      const col = shared.uLightColor.value as THREE.Color[];
      const inten = shared.uLightIntensity.value as number[];
      const en = shared.uLightEnabled.value as number[];
      for (let i = 0; i < MAX_LIGHTS_GLSL; i++) {
        if (i < count) {
          pos[i].copy(positions[i]);
          col[i].copy(colors[i]);
          inten[i] = intensities[i];
          en[i] = enabled[i];
        } else {
          en[i] = 0;
          inten[i] = 0;
        }
      }
    },
    setWater(absorption, backscatterColor, backscatterDensity, ambient) {
      (shared.uAbsorption.value as THREE.Vector3).set(absorption.r, absorption.g, absorption.b);
      (shared.uBackscatterColor.value as THREE.Vector3).set(
        backscatterColor.r,
        backscatterColor.g,
        backscatterColor.b,
      );
      shared.uBackscatterDensity.value = backscatterDensity;
      (shared.uAmbient.value as THREE.Vector3).set(ambient.r, ambient.g, ambient.b);
    },
    setWBGain(g) {
      (shared.uWBGain.value as THREE.Vector3).set(g.r, g.g, g.b);
    },
    setExposure(e) {
      shared.uExposure.value = e;
    },
  };
}
