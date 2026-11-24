/**
 * 场景总控:
 * - three.js 渲染器 + postprocessing(Bloom / SMAA / Vignette)
 * - 三点布光 + 水面平面反射
 * - 骨架编辑交互(拖控制点)与修剪交互
 * - 生长时间轴驱动
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
  SMAAEffect,
} from 'postprocessing';
import type { BonsaiSceneData } from '../types';
import { generateTree, updateGrowth, type GeneratedTree } from '../core/generator';
import { FoliageRenderer } from './foliage';
import { RockeryRenderer } from './rock';
import { WaterRenderer } from './water';
import { SkeletonEditor } from './skeletonEditor';

export interface SceneCallbacks {
  onFps: (fps: number) => void;
  onPointDrag: (branchId: string, pointIndex: number, local: [number, number, number]) => void;
  onDragEnd: () => void;
  onPruneBranch: (branchId: string) => void;
  onPruneTwig: (key: string) => void;
  getState: () => {
    data: BonsaiSceneData;
    prunedTwigs: ReadonlySet<string>;
    time: number;
    playing: boolean;
    pruneMode: boolean;
    editing: boolean;
  };
  setTime: (t: number) => void;
}

const TREE_OFFSET_Y = 0.44; // 树种在盆面高度

export class BonsaiScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloomEffect: BloomEffect;

  private keyLight = new THREE.DirectionalLight();
  private fillLight = new THREE.DirectionalLight();
  private rimLight = new THREE.DirectionalLight();
  private ambient = new THREE.AmbientLight();

  private rockery = new RockeryRenderer();
  private water: WaterRenderer;
  private foliage = new FoliageRenderer();
  private skeletonEditor: SkeletonEditor;
  private treeGroup = new THREE.Group();
  private comMarkers = new THREE.Group();

  private tree: GeneratedTree | null = null;
  private cb: SceneCallbacks;
  private raf = 0;
  private lastT = 0;
  private fpsEma = 60;
  private disposed = false;
  private ndc = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();

  constructor(private canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.cb = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // 抗锯齿交给 SMAA
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(3.2, 2.6, 4.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.4, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 14;

    this.scene.background = new THREE.Color('#10151a');
    this.scene.fog = new THREE.Fog('#10151a', 9, 22);

    // 三点布光
    this.keyLight.position.set(4, 6, 3);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -4;
    this.keyLight.shadow.camera.right = 4;
    this.keyLight.shadow.camera.top = 5;
    this.keyLight.shadow.camera.bottom = -2;
    this.fillLight.position.set(-5, 3, 2);
    this.rimLight.position.set(-1, 4, -5);
    this.scene.add(this.keyLight, this.fillLight, this.rimLight, this.ambient);

    // 地面
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(16, 48),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a2027'), roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.scene.add(this.rockery.group);
    this.water = new WaterRenderer(2.05, 0.4);
    this.scene.add(this.water.mesh);

    this.treeGroup.position.y = TREE_OFFSET_Y;
    this.treeGroup.add(this.foliage.group);
    this.scene.add(this.treeGroup);

    this.skeletonEditor = new SkeletonEditor({
      onPointDrag: (branchId, pointIndex, local) =>
        this.cb.onPointDrag(branchId, pointIndex, [local.x, local.y, local.z]),
      onDragEnd: () => this.cb.onDragEnd(),
      onPruneBranch: (id) => this.cb.onPruneBranch(id),
    });
    this.skeletonEditor.group.position.y = TREE_OFFSET_Y;
    this.scene.add(this.skeletonEditor.group);
    this.comMarkers.position.y = TREE_OFFSET_Y;
    this.scene.add(this.comMarkers);

    // 后期处理
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomEffect = new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.7 });
    const smaa = new SMAAEffect({});
    const vignette = new VignetteEffect({ offset: 0.25, darkness: 0.55 });
    this.composer.addPass(new EffectPass(this.camera, this.bloomEffect, smaa, vignette));

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.lastT = performance.now();
    this.loop();
  }

  /** 骨架或生长参数变化:整树重建实例缓冲 */
  rebuild(): void {
    const { data, prunedTwigs } = this.cb.getState();
    const t0 = performance.now();
    this.tree = generateTree(
      data.skeleton,
      data.growth,
      new Set(data.pruned),
      prunedTwigs,
    );
    this.foliage.rebuild(this.tree);
    this.skeletonEditor.rebuild(data.skeleton, this.tree.branchCurves, new Set(data.pruned));
    updateGrowth(this.tree, this.cb.getState().time);
    this.updateComMarkers();
    console.info(`[bonsai] 重建 ${this.tree.twigs.length} 细枝 / ${this.tree.leaves.length} 叶片,耗时 ${(performance.now() - t0).toFixed(1)}ms`);
  }

  applyLighting(): void {
    const { lighting } = this.cb.getState().data;
    this.keyLight.color.set(lighting.keyColor);
    this.keyLight.intensity = lighting.keyIntensity;
    this.fillLight.color.set(lighting.fillColor);
    this.fillLight.intensity = lighting.fillIntensity;
    this.rimLight.color.set(lighting.rimColor);
    this.rimLight.intensity = lighting.rimIntensity;
    this.ambient.intensity = lighting.ambient;
    this.water.setReflectionStrength(lighting.reflectionStrength);
    this.bloomEffect.intensity = lighting.bloom;
  }

  applyMoss(): void {
    this.rockery.updateMoss(this.cb.getState().data.moss);
  }

  setEditing(editing: boolean): void {
    this.skeletonEditor.setHandlesVisible(editing);
  }

  private updateComMarkers(): void {
    this.comMarkers.clear();
    if (!this.tree) return;
    const geo = new THREE.SphereGeometry(0.03, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: '#ff4466', depthTest: false });
    for (const [, com] of this.tree.centersOfMass) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(com);
      m.renderOrder = 98;
      this.comMarkers.add(m);
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.updateNdc(e);
    const state = this.cb.getState();
    if (state.pruneMode) {
      // 修剪:优先细枝,其次骨架枝干(射线为世界空间,实例矩阵已含树组偏移)
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const twigKey = this.foliage.pickTwig(this.raycaster);
      if (twigKey) {
        this.cb.onPruneTwig(twigKey);
        return;
      }
      const branchId = this.skeletonEditor.pickBranch(this.ndc, this.camera);
      if (branchId) this.cb.onPruneBranch(branchId);
      return;
    }
    if (state.editing && this.skeletonEditor.beginDrag(this.ndc, this.camera)) {
      this.controls.enabled = false;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.skeletonEditor.isDragging) return;
    this.updateNdc(e);
    this.skeletonEditor.drag(this.ndc, this.camera);
  };

  private onPointerUp = (): void => {
    if (this.skeletonEditor.isDragging) {
      this.skeletonEditor.endDrag();
      this.controls.enabled = true;
    }
  };

  private updateNdc(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private onResize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  };

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;

    // FPS(指数滑动平均)
    if (dt > 0) {
      this.fpsEma = this.fpsEma * 0.95 + (1 / dt) * 0.05;
      if (Math.random() < 0.05) this.cb.onFps(Math.round(this.fpsEma));
    }

    const state = this.cb.getState();
    // 时间轴推进
    if (state.playing) {
      const next = state.time + dt * 0.08; // 全程约 12 秒
      this.cb.setTime(next > 1 ? 0 : next);
    }
    if (this.tree) {
      updateGrowth(this.tree, state.time);
      this.foliage.update(this.camera);
    }

    this.controls.update();
    this.water.update(this.renderer, this.scene, this.camera, now / 1000);
    this.composer.render();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
    this.foliage.dispose();
    this.water.dispose();
    this.renderer.dispose();
  }
}
