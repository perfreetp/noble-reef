import * as THREE from 'three';
import {
  TOUR_FP_EYE_HEIGHT,
  TOUR_TOP_BACK,
  TOUR_TOP_HEIGHT,
  TOUR_TOP_PITCH_DEG,
} from '../../config/constants';
import type { CameraMode, Viewpoint } from '../../types/project';
import { samplePathAtT, type SampledPath } from '../paths/pathSampling';
import type { TerrainModel } from '../terrain/TerrainModel';

export interface Frame {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
}

/** 沿路径某里程采样相机帧；每帧重采地形高，播放期间地形改动也能跟随 */
export const sampleFrame = (
  sampled: SampledPath,
  t: number,
  mode: CameraMode,
  model: TerrainModel,
  eyeHeight: number = TOUR_FP_EYE_HEIGHT,
): Frame => {
  const { point, tangent } = samplePathAtT(sampled, t);
  const groundY = model.sampleHeightBilinear(point.x, point.z);
  const position = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  if (mode === 'fp') {
    position.set(point.x, groundY + eyeHeight, point.z);
    lookAt.set(
      point.x + tangent.x * 10,
      groundY + eyeHeight + tangent.y * 10,
      point.z + tangent.z * 10,
    );
  } else {
    // 俯瞰：沿切线反方向后退、抬高，固定俯角
    const back = TOUR_TOP_BACK;
    position.set(
      point.x - tangent.x * back,
      groundY + TOUR_TOP_HEIGHT,
      point.z - tangent.z * back,
    );
    const pitch = (TOUR_TOP_PITCH_DEG * Math.PI) / 180;
    const forward = new THREE.Vector3(tangent.x, -Math.tan(pitch), tangent.z).normalize();
    lookAt.copy(position).add(forward.multiplyScalar(20));
    lookAt.y = model.sampleHeightBilinear(lookAt.x, lookAt.z) + 4;
  }
  return { position, lookAt };
};

/** 关键点时间线：累积 durationSec 映射为归一化进度 */
export interface TimelineSegment {
  vp: Viewpoint;
  startT: number;
  endT: number;
  startProgress: number;
  endProgress: number;
}

export const buildTimeline = (viewpoints: Viewpoint[]): TimelineSegment[] => {
  const total = viewpoints.reduce((a, v) => a + Math.max(0.1, v.durationSec), 0);
  let acc = 0;
  return viewpoints.map((vp, i) => {
    const duration = Math.max(0.1, vp.durationSec);
    const startProgress = acc / total;
    acc += duration;
    const seg: TimelineSegment = {
      vp,
      startT: i === 0 ? vp.t : viewpoints[i - 1]!.t,
      endT: vp.t,
      startProgress,
      endProgress: acc / total,
    };
    return seg;
  });
};
