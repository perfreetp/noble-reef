import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FrameStats, SceneState, WBGains } from '../types';
import { MAX_LIGHTS } from '../types';
import { kelvinToLinear } from '../lib/kelvin';
import { WATER_PRESETS, effectiveAbsorption, effectiveBackscatterDensity } from '../lib/water';
import { computeAutoGains, smoothGains } from '../lib/whiteBalance';
import { createSharedUniforms } from './uniforms';
import { buildRobotArm, buildSeabed } from './robotArm';
import { LightDragController } from './LightDragController';
import {
  FULLSCREEN_VERTEX,
  OUTPUT_FRAGMENT,
  COPY_FRAGMENT,
} from './shaders';

const DOWNSAMPLE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 o = uTexel * 0.5;
  vec3 c = texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb
         + texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb
         + texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb
         + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const EXPOSURE = 1.1;
const STATS_INTERVAL = 0.25; // 秒，均值读回与自动白平衡采样间隔

export class UnderwaterEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private uniforms = createSharedUniforms();
  private rafId = 0;
  private disposed = false;

  private hdrTarget: THREE.WebGLRenderTarget;
  private ldrTarget: THREE.WebGLRenderTarget;
  private outputMaterial: THREE.ShaderMaterial;
  private copyMaterial: THREE.ShaderMaterial;
  private downsampleMaterial: THREE.ShaderMaterial;
  private fsScene = new THREE.Scene();
  private fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** 降采样链（HDR half-float / LDR byte 各一组） */
  private hdrChain: THREE.WebGLRenderTarget[] = [];
  private ldrChain: THREE.WebGLRenderTarget[] = [];
  private hdrMeanBuf = new Float32Array(4);
  private ldrMeanBuf = new Uint8ClampedArray(4);
  private floatReadSupported = true;

  private handles = new Map<number, THREE.Group>();
  private drag: LightDragController;
  private resizeObserver: ResizeObserver;

  // 每帧复用的临时对象，避免拖动时产生 GC
  private tmpPos = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3());
  private tmpColor = Array.from({ length: MAX_LIGHTS }, () => new THREE.Color());
  private tmpIntensity = new Array<number>(MAX_LIGHTS).fill(0);
  private tmpEnabled = new Array<number>(MAX_LIGHTS).fill(0);
  private autoGains: WBGains = { r: 1, g: 1, b: 1 };
  private pendingHdrMean: WBGains = { r: 0, g: 0, b: 0 };
  private statsDue = false;
  private lastTime = performance.now();
  private statTimer = 0;
  private fpsTimer = 0;
  private fpsFrames = 0;
  private currentFps = 0;

  constructor(
    private container: HTMLElement,
    private getState: () => SceneState,
    private onStats: (stats: FrameStats) => void,
    private onLightDrag: (id: number, pos: [number, number, number]) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x04141f, 1);
    this.renderer.autoClear = true;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
    this.camera.position.set(3.8, 2.7, 5.0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.6, 1.2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.scene.background = new THREE.Color(0x04141f);

    // 场景内容
    const robot = buildRobotArm(this.uniforms);
    const seabed = buildSeabed(this.uniforms);
    this.scene.add(robot.group, seabed.group);

    // HDR / LDR 渲染目标
    const { width, height } = this.viewSize();
    this.hdrTarget = this.createHDRTarget(width, height);
    this.ldrTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.buildChains(width, height);

    // 输出 / 拷贝 / 降采样材质
    this.outputMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: OUTPUT_FRAGMENT,
      uniforms: {
        ...this.uniforms.shared,
        tHDR: { value: this.hdrTarget.texture },
        tDepth: { value: this.hdrTarget.depthTexture },
        uNear: { value: this.camera.near },
        uFar: { value: this.camera.far },
      },
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      uniforms: { tMap: { value: this.ldrTarget.texture } },
    });
    this.downsampleMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: DOWNSAMPLE_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    });
    const fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.downsampleMaterial);
    this.fsScene.add(fsMesh);

    this.drag = new LightDragController(
      this.camera,
      this.renderer.domElement,
      this.handles as Map<number, THREE.Object3D>,
      this.onLightDrag,
      (enabled) => (this.controls.enabled = enabled),
    );

    // ResizeObserver 覆盖初始布局未完成与后续面板/窗口变化，避免首帧停在 300x150
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.loop();
  }

  private viewSize() {
    const size = this.container.getBoundingClientRect();
    return {
      width: Math.max(2, Math.floor(size.width * this.renderer.getPixelRatio())),
      height: Math.max(2, Math.floor(size.height * this.renderer.getPixelRatio())),
    };
  }

  private createHDRTarget(w: number, h: number) {
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthTexture,
      depthBuffer: true,
    });
  }

  /** 构建逐级 /2 的降采样 ping-pong 链，末端 1x1 即整幅均值 */
  private buildChains(w: number, h: number) {
    for (const rt of [...this.hdrChain, ...this.ldrChain]) rt.dispose();
    this.hdrChain = [];
    this.ldrChain = [];
    let cw = Math.max(1, Math.floor(w / 2));
    let ch = Math.max(1, Math.floor(h / 2));
    while (cw >= 1 && ch >= 1) {
      const isLast = cw === 1 || ch === 1;
      this.hdrChain.push(
        new THREE.WebGLRenderTarget(cw, ch, {
          // 末端用 FloatType：WebGL2 仅保证 RGBA/FLOAT 的 readPixels 回读
          type: isLast ? THREE.FloatType : THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
        }),
      );
      this.ldrChain.push(
        new THREE.WebGLRenderTarget(cw, ch, {
          type: THREE.UnsignedByteType,
          format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
        }),
      );
      if (cw === 1 && ch === 1) break;
      cw = Math.max(1, Math.floor(cw / 2));
      ch = Math.max(1, Math.floor(ch / 2));
    }
  }

  private onResize = () => {
    const rect = this.container.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const { width, height } = this.viewSize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);

    // HDR target 带 depthTexture，尺寸变化时整体重建并重接输出材质
    this.hdrTarget.dispose();
    this.hdrTarget = this.createHDRTarget(width, height);
    this.ldrTarget.setSize(width, height);
    this.outputMaterial.uniforms.tHDR.value = this.hdrTarget.texture;
    this.outputMaterial.uniforms.tDepth.value = this.hdrTarget.depthTexture;
    this.buildChains(width, height);
  };

  /** 灯光手柄（球 + 环），颜色随色温变化 */
  private createHandle(id: number, color: THREE.Color): THREE.Group {
    const group = new THREE.Group();
    group.userData.lightId = id;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 14),
      new THREE.MeshBasicMaterial({ color }),
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.015, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ef }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(sphere, ring);
    this.scene.add(group);
    return group;
  }

  /** 每帧把 Solid store 状态同步到 three 层 */
  private syncState(state: SceneState) {
    const n = Math.min(state.lights.length, MAX_LIGHTS);

    // 手柄增删
    const liveIds = new Set(state.lights.map((l) => l.id));
    for (const [id, group] of this.handles) {
      if (!liveIds.has(id)) {
        this.scene.remove(group);
        group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
        this.handles.delete(id);
      }
    }

    for (let i = 0; i < n; i++) {
      const light = state.lights[i];
      let handle = this.handles.get(light.id);
      const [r, g, b] = kelvinToLinear(light.colorTemp);
      this.tmpColor[i].setRGB(r, g, b);
      if (!handle) {
        handle = this.createHandle(light.id, this.tmpColor[i]);
        this.handles.set(light.id, handle);
      }
      handle.position.set(light.position[0], light.position[1], light.position[2]);
      const scale = light.enabled ? 1 : 0.6;
      handle.scale.setScalar(scale);
      (handle.children[0] as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>).material.color.copy(
        this.tmpColor[i],
      );
      (handle.children[0] as THREE.Mesh).visible = light.enabled;

      this.tmpPos[i].copy(handle.position);
      this.tmpIntensity[i] = light.intensity * 3.2; // UI 0..1 → 光照功率
      this.tmpEnabled[i] = light.enabled ? 1 : 0;
    }

    this.uniforms.setLights(this.tmpPos, this.tmpColor, this.tmpIntensity, this.tmpEnabled, n);

    // 水体参数
    const absorption = effectiveAbsorption(state.water.preset, state.water.depth);
    const preset = WATER_PRESETS[state.water.preset];
    const bsDensity = effectiveBackscatterDensity(state.water.preset, state.water.depth);
    const ambient: WBGains = {
      r: 0.14 * preset.ambientScale,
      g: 0.32 * preset.ambientScale,
      b: 0.46 * preset.ambientScale,
    };
    this.uniforms.setWater(absorption, preset.backscatterColor, bsDensity, ambient);
    this.uniforms.setExposure(EXPOSURE);
  }

  /** 逐级降采样到 1x1 并读回均值 */
  private readMean(
    chain: THREE.WebGLRenderTarget[],
    source: THREE.WebGLRenderTarget,
    buffer: Float32Array | Uint8ClampedArray,
    float: boolean,
  ): number[] {
    let prev = source;
    const mesh = this.fsScene.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    mesh.material = this.downsampleMaterial;
    for (const target of chain) {
      this.downsampleMaterial.uniforms.tSrc.value = prev.texture;
      (this.downsampleMaterial.uniforms.uTexel.value as THREE.Vector2).set(
        1 / prev.width,
        1 / prev.height,
      );
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.fsScene, this.fsCamera);
      prev = target;
    }
    const last = chain[chain.length - 1];
    this.renderer.readRenderTargetPixels(last, 0, 0, 1, 1, buffer as Uint8ClampedArray);
    return float
      ? [buffer[0], buffer[1], buffer[2]]
      : [buffer[0] / 255, buffer[1] / 255, buffer[2] / 255];
  }

  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const state = this.getState();
    this.syncState(state);
    this.controls.update();

    // 1) 场景 → HDR
    this.renderer.setRenderTarget(this.hdrTarget);
    this.renderer.render(this.scene, this.camera);

    // 2) 节流采样 HDR 均值（白平衡之前），float 回读失败则后续回退到 LDR
    this.statTimer += dt;
    this.statsDue = this.statTimer >= STATS_INTERVAL;
    if (this.statsDue) {
      this.statTimer = 0;
      if (this.floatReadSupported) {
        try {
          const m = this.readMean(this.hdrChain, this.hdrTarget, this.hdrMeanBuf, true);
          this.pendingHdrMean = { r: m[0], g: m[1], b: m[2] };
        } catch {
          this.floatReadSupported = false;
        }
      }
    }

    // 3) 白平衡增益（自动用平滑值，手动用 store 值）
    const gains =
      state.whiteBalance.mode === 'auto' ? this.autoGains : state.whiteBalance.manual;
    this.uniforms.setWBGain(gains);

    // 4) 输出 Pass → LDR（相机路径吸收 + 散射 + WB + ACES + sRGB）
    const fsMesh = this.fsScene.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    fsMesh.material = this.outputMaterial;
    this.renderer.setRenderTarget(this.ldrTarget);
    this.renderer.render(this.fsScene, this.fsCamera);

    // 5) LDR 均值读回（面板显示的成片 RGB 均值）；自动白平衡在此处更新
    let ldrMean: WBGains = { r: 0, g: 0, b: 0 };
    if (this.statsDue) {
      const m = this.readMean(this.ldrChain, this.ldrTarget, this.ldrMeanBuf, false);
      ldrMean = { r: m[0], g: m[1], b: m[2] };
      if (state.whiteBalance.mode === 'auto') {
        // 首选白平衡前 HDR 均值；硬件不支持 float 回读时用 LDR 均值近似
        const basis = this.floatReadSupported ? this.pendingHdrMean : ldrMean;
        const target = computeAutoGains(basis);
        this.autoGains = smoothGains(this.autoGains, target, 0.35);
      }
    }

    // 6) 上屏
    fsMesh.material = this.copyMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.fsScene, this.fsCamera);

    // 帧率与统计回调
    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }
    if (this.statsDue) {
      this.onStats({ hdrMean: this.pendingHdrMean, ldrMean, appliedGains: gains, fps: this.currentFps });
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.drag.dispose();
    this.controls.dispose();
    this.hdrTarget.dispose();
    this.ldrTarget.dispose();
    for (const rt of [...this.hdrChain, ...this.ldrChain]) rt.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
