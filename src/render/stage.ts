import * as THREE from 'three';
import { Rig } from '../puppet/rig';
import { RodController } from '../puppet/rods';
import { MaskPass } from './mask';
import { createScreenMaterial } from './screen';
import type { PartDef, RodDef } from '../types';

const MASK_HALF = 3.2; // 遮罩对称视锥半高/半宽
/** 骨架整体垂直偏移:让影偶几何中心落在世界原点,灯幕映射无需补偿 */
const RIG_Y_OFFSET = -0.8;

/**
 * 舞台模块。
 *
 * 一个 WebGL 上下文、两个视区:
 *  - 主视区:three.js 三维场景。皮革影偶在幕前,由前侧主光照亮可见;
 *    其后方是灯幕平面,遮罩 shader 在幕上投出同姿态的黑色剪影与镂空亮光。
 *  - 左下角 PiP(scissor 视区):纯灯幕视角,即灯幕上的影偶光斑,
 *    与主视区剪影、杆件拖动实时同帧跟随。
 *
 * 每帧:杆件更新 -> 骨架运动学 -> 遮罩重算 -> 主场景 -> PiP。
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.OrthographicCamera;
  private maskCamera: THREE.OrthographicCamera;
  private scene = new THREE.Scene();
  private rig: Rig;
  private rods: RodController;
  private mask: MaskPass;
  private screenMat: THREE.ShaderMaterial;
  private pipScene = new THREE.Scene();
  private pipCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private pipQuad: THREE.Mesh;
  private keyLight: THREE.DirectionalLight;
  private backLight: THREE.PointLight;
  private resizeObs: ResizeObserver;
  private raf = 0;
  private lastT = 0;
  private lightTarget = 1;
  private lightFrom = 1;
  private lightElapsed = 0;
  private lightDuration = 0;
  private frameCount = 0;
  private fpsTimer = 0;
  onStats?: (fps: number, maskMs: number) => void;

  constructor(parent: HTMLElement, parts: PartDef[], rodDefs: RodDef[], light: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'none';
    parent.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x150e07, 1);

    // 主相机与遮罩相机同视锥(原点对称,半高 MASK_HALF),
    // 保证灯幕上的剪影与皮革实体 1:1 重合
    this.camera = new THREE.OrthographicCamera(-MASK_HALF, MASK_HALF, MASK_HALF, -MASK_HALF, 0.1, 50);
    this.camera.position.set(0, 0, 8);
    this.maskCamera = new THREE.OrthographicCamera(-MASK_HALF, MASK_HALF, MASK_HALF, -MASK_HALF, 0.1, 50);
    this.maskCamera.position.set(0, 0, 8);

    // 前侧主光:照亮幕前皮革(灯幕在影偶身后,不参与实体照明)
    this.keyLight = new THREE.DirectionalLight(0xffe6c2, 2.0);
    this.keyLight.position.set(2.5, 4, 7);
    this.scene.add(this.keyLight);
    this.scene.add(new THREE.AmbientLight(0x6b4e35, 0.85));

    // 背光:概念光源,强度驱动灯幕 shader 与幕前暖调补光
    this.backLight = new THREE.PointLight(0xffc887, light * 6, 12);
    this.backLight.position.set(0, 0, 5);
    this.scene.add(this.backLight);

    // 影偶骨架(幕前,z 为正);整体下移让几何中心对齐世界原点
    this.rig = new Rig(parts);
    this.rig.root.position.set(0, RIG_Y_OFFSET, 0);
    this.scene.add(this.rig.root);
    this.rods = new RodController(this.rig, rodDefs);

    // 遮罩:方形 RT + 固定方形视锥
    const { maskSize } = this.canvasSize();
    this.mask = new MaskPass(this.rig, maskSize, maskSize);
    this.screenMat = createScreenMaterial(this.mask.silhouetteTexture, this.mask.cutoutTexture);
    this.screenMat.uniforms.uIntensity.value = light;
    this.screenMat.uniforms.uMaskHalf.value = MASK_HALF;

    // 主视区灯幕:影偶后方的大幕,投同姿态剪影
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2 * MASK_HALF, 2 * MASK_HALF), this.screenMat);
    screen.position.set(0, 0, -2.5);
    this.scene.add(screen);

    // PiP:独立场景全屏 quad,纯灯幕光斑视角
    this.pipQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.screenMat);
    this.pipScene.add(this.pipQuad);
    this.pipQuad.onBeforeRender = () => {
      this.screenMat.uniforms.uPiP.value = 1;
    };

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(parent);
    this.resize();

    this.lastT = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  get rigController(): Rig {
    return this.rig;
  }

  get rodController(): RodController {
    return this.rods;
  }

  private canvasSize(): { width: number; height: number; maskSize: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    return { width, height, maskSize: Math.max(2, Math.min(width, height)) };
  }

  private resize(): void {
    const { width, height, maskSize } = this.canvasSize();
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    // 固定高度,横向按比例扩宽;遮罩相机保持方形视锥不动
    const aspect = width / height;
    this.camera.left = -MASK_HALF * aspect;
    this.camera.right = MASK_HALF * aspect;
    this.camera.top = MASK_HALF;
    this.camera.bottom = -MASK_HALF;
    this.camera.updateProjectionMatrix();
    this.mask.resize(maskSize, maskSize);
  }

  /** 背光强度(0~2):带动灯幕 shader 与补光 */
  setLight(v: number, animated = false): void {
    this.lightTarget = v;
    if (animated) {
      this.lightFrom = this.screenMat.uniforms.uIntensity.value as number;
      this.lightElapsed = 0;
      this.lightDuration = 0.4;
    } else {
      this.applyLight(v);
    }
  }

  get light(): number {
    return this.screenMat.uniforms.uIntensity.value as number;
  }

  private applyLight(v: number): void {
    this.screenMat.uniforms.uIntensity.value = v;
    this.backLight.intensity = v * 6;
  }

  private loop(now: number): void {
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;

    if (this.lightDuration > 0) {
      this.lightElapsed += dt;
      const t = Math.min(this.lightElapsed / this.lightDuration, 1);
      this.applyLight(this.lightFrom + (this.lightTarget - this.lightFrom) * (1 - (1 - t) ** 3));
      if (t >= 1) this.lightDuration = 0;
    }

    // 1) 杆件 -> 目标角;2) 骨架限位/回弹/铰接刷新
    this.rods.update(dt);
    this.rig.update(dt);

    // 3) 姿态变化后重算镂空透光遮罩(两次正交绘制,同一帧内完成)
    const maskMs = this.mask.render(this.renderer, this.maskCamera);

    const size = this.canvasSize();

    // 4) 主视区:皮革影偶 + 身后灯幕(灯幕 depthTest,影偶在前自然遮挡)
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.width, size.height);
    this.renderer.clear(true, true, true);
    this.screenMat.uniforms.uPiP.value = 0;
    this.renderer.render(this.scene, this.camera);

    // 5) PiP:纯灯幕光斑
    const dpr = Math.min(window.devicePixelRatio, 2);
    const pipW = Math.min(240 * dpr, size.width * 0.42);
    const pipH = pipW;
    const pad = 14 * dpr;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(pad, pad, pipW, pipH);
    this.renderer.setViewport(pad, pad, pipW, pipH);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.pipScene, this.pipCamera);
    this.renderer.setScissorTest(false);
    this.screenMat.uniforms.uPiP.value = 0;

    this.frameCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      const fps = this.frameCount / this.fpsTimer;
      this.frameCount = 0;
      this.fpsTimer = 0;
      this.onStats?.(fps, maskMs);
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  /** 导入/重置后用新配置重建骨架、杆件与遮罩 */
  rebuild(parts: PartDef[], rodDefs: RodDef[]): void {
    this.scene.remove(this.rig.root);
    this.rig.dispose();
    this.mask.dispose();
    this.rig = new Rig(parts);
    this.rig.root.position.set(0, RIG_Y_OFFSET, 0);
    this.scene.add(this.rig.root);
    const { maskSize } = this.canvasSize();
    this.mask = new MaskPass(this.rig, maskSize, maskSize);
    this.screenMat.uniforms.tSilhouette.value = this.mask.silhouetteTexture;
    this.screenMat.uniforms.tCutout.value = this.mask.cutoutTexture;
    this.rods.configure(rodDefs);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.mask.dispose();
    this.rig.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
