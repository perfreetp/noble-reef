import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
} from 'postprocessing';
import { sharedUniforms, projectDirCPU, R, EQ_W, EQ_H } from './projection.js';
import { createStars } from './stars.js';
import { createConstellations } from './constellations.js';
import { createHorizon } from './horizon.js';
import { createMilkyWay } from './milkyway.js';
import { gmstRadians, stateToDate } from '../astro.js';

export const STAR_COUNT = 8000;

export function createEngine(container, { onFps } = {}) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020409);

  // --- 相机:球面投影用透视相机,等距柱状投影用正交相机 ---
  const perspCam = new THREE.PerspectiveCamera(
    50, container.clientWidth / container.clientHeight, 1, 3000
  );
  perspCam.position.set(0, 70, 300);
  const orthoCam = new THREE.OrthographicCamera(
    -EQ_W - 8, EQ_W + 8, EQ_H + 8, -EQ_H - 8, 1, 1000
  );
  orthoCam.position.set(0, 0, 400);
  orthoCam.lookAt(0, 0, 0);

  const controls = new OrbitControls(perspCam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 130;
  controls.maxDistance = 900;

  // --- 图层 ---
  const skyGroup = new THREE.Group(); // 随恒星时整体旋转的天球
  scene.add(skyGroup);

  const stars = createStars(STAR_COUNT);
  skyGroup.add(stars.points);

  const constellations = createConstellations();
  skyGroup.add(constellations.group);

  const milkyway = createMilkyWay();
  skyGroup.add(milkyway.mesh);

  const horizon = createHorizon(); // 固定在观测者坐标系
  scene.add(horizon.group);

  // --- 后期合成:每帧完成全部图层叠加 ---
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, perspCam);
  composer.addPass(renderPass);
  const effectPass = new EffectPass(
    perspCam,
    new BloomEffect({
      intensity: 0.85,
      luminanceThreshold: 0.22,
      luminanceSmoothing: 0.35,
      mipmapBlur: true,
    }),
    new VignetteEffect({ offset: 0.28, darkness: 0.62 })
  );
  composer.addPass(effectPass);

  // --- 运行时状态 ---
  const rt = {
    lst: 0,
    projection: 0, // 0 球面 / 1 等距柱状
  };

  function applySize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    perspCam.aspect = w / h;
    perspCam.updateProjectionMatrix();
    stars.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    stars.material.uniforms.uScale.value =
      h / (2 * Math.tan((perspCam.fov * Math.PI) / 360));
  }
  applySize();
  const resizeObserver = new ResizeObserver(applySize);
  resizeObserver.observe(container);

  /** 文字标注按当前投影重新定位(等距柱状模式下每帧跟随恒星时) */
  const tmpV = new THREE.Vector3();
  function relayoutLabels() {
    const eq = rt.projection === 1;
    skyGroup.updateMatrixWorld();
    horizon.group.updateMatrixWorld(true);
    for (const { sprite, dir } of constellations.labels) {
      if (!eq) {
        sprite.position.copy(dir).multiplyScalar(R + 6);
      } else {
        tmpV.copy(dir).applyQuaternion(skyGroup.quaternion);
        projectDirCPU(tmpV, 1, tmpV);
        sprite.position.copy(skyGroup.worldToLocal(tmpV));
      }
    }
    for (const { sprite, dir, localParent } of horizon.labels) {
      if (!eq) {
        sprite.position.copy(dir).multiplyScalar(R + 10);
      } else {
        tmpV.copy(dir).applyQuaternion(localParent.quaternion);
        projectDirCPU(tmpV, 1, tmpV);
        sprite.position.copy(localParent.worldToLocal(tmpV));
      }
    }
  }

  // --- 渲染循环 ---
  let raf = 0;
  let frames = 0;
  let lastFpsT = performance.now();
  function animate() {
    raf = requestAnimationFrame(animate);
    skyGroup.rotation.y = rt.lst; // 恒星时联动:一次矩阵更新驱动所有天球图层
    if (rt.projection === 1) relayoutLabels();
    controls.update();
    composer.render();
    frames++;
    const now = performance.now();
    if (now - lastFpsT >= 500) {
      onFps?.(Math.round((frames * 1000) / (now - lastFpsT)));
      frames = 0;
      lastFpsT = now;
    }
  }
  animate();

  return {
    /** 日期(年内第几天) + 时刻(小时) -> 恒星时,所有天球图层联动 */
    setTime(dayOfYear, timeHours) {
      rt.lst = gmstRadians(stateToDate(dayOfYear, timeHours));
    },
    setLatitude(latDeg) {
      horizon.setLatitude(latDeg);
      if (rt.projection === 1) relayoutLabels();
    },
    setProjection(mode) {
      rt.projection = mode === 'equirect' ? 1 : 0;
      sharedUniforms.uProjection.value = rt.projection;
      const cam = rt.projection === 1 ? orthoCam : perspCam;
      renderPass.mainCamera = cam;
      effectPass.mainCamera = cam;
      controls.enabled = rt.projection === 0;
      horizon.disc.visible = rt.projection === 0; // 地面圆盘不参与等距柱状重采样
      relayoutLabels();
    },
    setLayerVisible(name, visible) {
      const map = {
        stars: stars.points,
        constellations: constellations.group,
        horizon: horizon.group,
        milkyway: milkyway.mesh,
      };
      if (map[name]) map[name].visible = visible;
    },
    setMilkyWayIntensity(level) {
      milkyway.setIntensity(level);
    },
    dispose() {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
