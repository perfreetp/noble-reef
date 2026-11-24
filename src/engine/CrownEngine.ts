import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect } from 'postprocessing';
import { Feather } from './Feather';
import { buildCrownGeometry, crownFrame } from './crownSurface';
import { createSharedOptics, SharedOptics } from './featherMaterial';
import {
  CrownConfig,
  FeatherParams,
  LightParams,
  GAP_WARN_MM,
  MAX_FEATHERS,
  clampFeather,
  defaultFeather,
} from './types';
import { clamp } from './util';

export interface HudHover {
  x: number;
  y: number;
  gap: number;
  warn: boolean;
  featherId: number | null;
}

export interface HudInfo {
  fps: number;
  count: number;
  selectedId: number | null;
  hover: HudHover | null;
}

type HudCallback = (h: HudInfo) => void;

const TEX_KEYS = ['textureIndex', 'density', 'grainDir'];
const GEO_KEYS = ['length', 'width', 'curvature', 'segments'];
const PLACE_KEYS = ['u', 'v', 'rotation', 'mirrored', 'gap'];
const OPTIC_KEYS = ['fiberAngle', 'hueShift', 'glossLevel'];

export class CrownEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private shared: SharedOptics = createSharedOptics();
  private dirLight = new THREE.DirectionalLight();
  private crownMesh: THREE.Mesh;
  private hoverArrow: THREE.ArrowHelper;
  private feathers = new Map<number, Feather>();
  private nextId = 1;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private draggingFeather: number | null = null;
  private altDragging = false;
  private lastXY = { x: 0, y: 0 };
  private listeners = new Set<() => void>();
  private version = 0;
  private fps = 60;
  private lastFrame = performance.now();
  private lastHudPush = 0;
  private hover: HudHover | null = null;
  private raf = 0;
  private resizeObs: ResizeObserver;
  private disposed = false;

  light: LightParams = { azimuth: 35, elevation: 45, intensity: 1.2 };
  selectedId: number | null = null;

  constructor(
    private container: HTMLElement,
    private onHud: HudCallback,
  ) {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0b0e14);
    this.scene.fog = new THREE.Fog(0x0b0e14, 320, 700);

    this.camera = new THREE.PerspectiveCamera(40, w / h, 1, 2000);
    this.camera.position.set(0, 42, 235);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 12, 0);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 600;
    this.controls.minDistance = 60;

    // 灯光:平行光随方位/俯仰驱动,另加环境光与轮廓光
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.5));
    this.scene.add(this.dirLight);
    const rim = new THREE.DirectionalLight(0x66aaff, 0.5);
    rim.position.set(-120, 60, -140);
    this.scene.add(rim);
    this.applyLight();

    // 冠体
    this.crownMesh = new THREE.Mesh(
      buildCrownGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0x4a3f28,
        metalness: 0.85,
        roughness: 0.42,
        side: THREE.DoubleSide,
      }),
    );
    this.scene.add(this.crownMesh);

    // 悬停法线指示
    this.hoverArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      10,
      0x37e08b,
      4,
      2.4,
    );
    this.hoverArrow.visible = false;
    this.scene.add(this.hoverArrow);

    // 后期:泛光 + 暗角
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new BloomEffect({ intensity: 0.55, luminanceThreshold: 0.55, luminanceSmoothing: 0.25, mipmapBlur: true }),
        new VignetteEffect({ offset: 0.28, darkness: 0.62 }),
      ),
    );

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('keydown', this.onKeyDown);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);

    this.addDefaultFan();
    this.loop();
  }

  // ---------- 状态订阅(供 React) ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  // ---------- 羽枝管理 ----------

  listFeathers(): FeatherParams[] {
    return [...this.feathers.values()].map((f) => ({ ...f.params }));
  }

  getFeather(id: number): FeatherParams | null {
    const f = this.feathers.get(id);
    return f ? { ...f.params } : null;
  }

  get count(): number {
    return this.feathers.size;
  }

  private createFeather(partial: Partial<FeatherParams>): number {
    if (this.feathers.size >= MAX_FEATHERS) return -1;
    const id = this.nextId++;
    const params = clampFeather({ ...defaultFeather(id), ...partial, id });
    const f = new Feather(params, this.shared);
    this.feathers.set(id, f);
    this.scene.add(f.mesh);
    return id;
  }

  addFeather(partial: Partial<FeatherParams> = {}): number {
    const id = this.createFeather(partial);
    if (id >= 0) {
      this.select(id);
      this.bump();
    }
    return id;
  }

  removeFeather(id: number): void {
    const f = this.feathers.get(id);
    if (!f) return;
    this.scene.remove(f.mesh);
    f.dispose();
    this.feathers.delete(id);
    if (this.selectedId === id) this.select(null);
    this.bump();
  }

  clearFeathers(): void {
    [...this.feathers.keys()].forEach((id) => this.removeFeather(id));
  }

  /**
   * 增量更新:按参数类别只重算受影响的羽枝,
   * 冠面与其他羽枝不动。
   */
  updateFeather(id: number, patch: Partial<FeatherParams>): void {
    const f = this.feathers.get(id);
    if (!f) return;
    Object.assign(f.params, patch);
    f.params = clampFeather(f.params);
    const keys = Object.keys(patch);
    const has = (ks: string[]) => keys.some((k) => ks.includes(k));

    if (has(TEX_KEYS)) f.regenTexture();
    if (has(['u', 'v'])) {
      // 包覆半径随冠面位置变化,需重建该羽枝几何
      f.updatePlacement();
      f.rebuildGeometry();
    } else {
      if (has(GEO_KEYS)) f.rebuildGeometry();
      if (has(PLACE_KEYS)) f.updatePlacement();
    }
    if (has(OPTIC_KEYS) || has(['gap'])) f.updateOptics();
    this.bump();
  }

  select(id: number | null): void {
    if (this.selectedId === id) return;
    const prev = this.selectedId !== null ? this.feathers.get(this.selectedId) : null;
    prev?.setSelected(false);
    this.selectedId = id;
    const cur = id !== null ? this.feathers.get(id) : null;
    cur?.setSelected(true);
    this.bump();
  }

  /** 压力测试:生成 200 根、每根 64 段 */
  spawnStressTest(): void {
    this.clearFeathers();
    const total = MAX_FEATHERS;
    const rows = 4;
    const perRow = total / rows;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < perRow; i++) {
        const u = 0.06 + (0.88 * i) / (perRow - 1);
        const v = 0.18 + r * 0.2 + (i % 2) * 0.03;
        this.createFeather({
          u,
          v,
          segments: 64,
          length: 30 + ((i * 13 + r * 7) % 20),
          textureIndex: (i + r * 6) % 24,
          rotation: (u - 0.5) * -0.9,
          gap: 0.1 + ((i * 7) % 5) * 0.08,
        });
      }
    }
    this.select(null);
    this.bump();
  }

  private addDefaultFan(): void {
    const n = 25;
    for (let i = 0; i < n; i++) {
      const u = 0.18 + (0.64 * i) / (n - 1);
      const center = 1 - Math.abs(u - 0.5) * 2;
      this.createFeather({
        u,
        v: 0.32 + center * 0.08,
        length: 34 + center * 22,
        width: 11 + center * 4,
        textureIndex: i % 24,
        rotation: (u - 0.5) * -1.1,
        hueShift: (i % 3) * 0.04 - 0.04,
        gap: 0.12,
      });
    }
    this.select(null);
  }

  // ---------- 光源 ----------

  setLight(patch: Partial<LightParams>): void {
    Object.assign(this.light, patch);
    this.light.azimuth = ((this.light.azimuth % 360) + 360) % 360;
    this.light.elevation = clamp(this.light.elevation, -10, 90);
    this.light.intensity = clamp(this.light.intensity, 0, 3);
    this.applyLight();
    this.bump();
  }

  private applyLight(): void {
    const az = THREE.MathUtils.degToRad(this.light.azimuth);
    const el = THREE.MathUtils.degToRad(this.light.elevation);
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    this.shared.uLightDir.value.copy(dir);
    this.shared.uLightIntensity.value = this.light.intensity;
    this.dirLight.position.copy(dir).multiplyScalar(300);
    this.dirLight.intensity = this.light.intensity * 1.6;
    this.dirLight.color.setRGB(1, 0.96, 0.88);
  }

  // ---------- 导出 / 导入 ----------

  /** 离屏 2x 渲染 PNG */
  async exportPNG(scale = 2): Promise<Blob> {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const pr = this.renderer.getPixelRatio();
    // 提高像素比 → 离屏缓冲变为 scale 倍,再按原逻辑渲染
    this.renderer.setPixelRatio(scale);
    this.composer.setSize(w, h, false);
    this.composer.render();
    const blob = await new Promise<Blob | null>((res) =>
      this.renderer.domElement.toBlob(res, 'image/png'),
    );
    this.renderer.setPixelRatio(pr);
    this.composer.setSize(w, h, false);
    this.composer.render();
    if (!blob) throw new Error('PNG 编码失败');
    return blob;
  }

  exportJSON(): string {
    const cfg: CrownConfig = {
      version: 1,
      light: { ...this.light },
      feathers: this.listFeathers(),
    };
    return JSON.stringify(cfg, null, 2);
  }

  /** 回读配置:羽光参数逐项还原,与导出时一致 */
  importJSON(text: string): { ok: boolean; message: string } {
    let cfg: CrownConfig;
    try {
      cfg = JSON.parse(text);
    } catch {
      return { ok: false, message: 'JSON 解析失败' };
    }
    if (cfg.version !== 1 || !Array.isArray(cfg.feathers) || !cfg.light) {
      return { ok: false, message: '配置格式不正确' };
    }
    if (cfg.feathers.length > MAX_FEATHERS) {
      return { ok: false, message: `羽枝数量超过上限 ${MAX_FEATHERS}` };
    }
    this.clearFeathers();
    this.nextId = 1;
    for (const raw of cfg.feathers) {
      const params = clampFeather({ ...defaultFeather(this.nextId++), ...raw });
      const f = new Feather(params, this.shared);
      this.feathers.set(params.id, f);
      this.scene.add(f.mesh);
      this.nextId = Math.max(this.nextId, params.id + 1);
    }
    this.setLight(cfg.light);
    this.select(null);
    this.bump();
    return { ok: true, message: `已导入 ${cfg.feathers.length} 根羽枝,羽光参数已还原` };
  }

  // ---------- 交互 ----------

  private setPointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private raycastCrown(): { u: number; v: number; point: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObject(this.crownMesh, false)[0];
    if (!hit || !hit.uv) return null;
    return { u: hit.uv.x, v: hit.uv.y, point: hit.point };
  }

  private nearestFeather(u: number, v: number): Feather | null {
    let best: Feather | null = null;
    let bd = Infinity;
    for (const f of this.feathers.values()) {
      const d = (f.params.u - u) ** 2 + (f.params.v - v) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.setPointer(e);

    if (this.altDragging) {
      const dx = e.clientX - this.lastXY.x;
      const dy = e.clientY - this.lastXY.y;
      this.lastXY = { x: e.clientX, y: e.clientY };
      this.setLight({
        azimuth: this.light.azimuth + dx * 0.5,
        elevation: this.light.elevation + dy * 0.35,
      });
      return;
    }

    if (this.draggingFeather !== null) {
      const hit = this.raycastCrown();
      if (hit) {
        this.updateFeather(this.draggingFeather, { u: hit.u, v: hit.v });
        this.showHover(hit, e);
      }
      return;
    }

    const hit = this.raycastCrown();
    if (hit) this.showHover(hit, e);
    else this.clearHover();
  };

  private showHover(hit: { u: number; v: number; point: THREE.Vector3 }, e: PointerEvent): void {
    const { N } = crownFrame(hit.u, hit.v);
    const near = this.nearestFeather(hit.u, hit.v);
    const gap = near ? near.params.gap : 0;
    const warn = near ? near.params.gap > GAP_WARN_MM : false;
    this.hoverArrow.visible = true;
    this.hoverArrow.position.copy(hit.point);
    this.hoverArrow.setDirection(N);
    (this.hoverArrow as THREE.ArrowHelper).setColor(warn ? 0xff3524 : 0x37e08b);
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.hover = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      gap,
      warn,
      featherId: near ? near.params.id : null,
    };
    this.pushHud();
  }

  private clearHover(): void {
    this.hover = null;
    this.hoverArrow.visible = false;
    this.pushHud();
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.lastXY = { x: e.clientX, y: e.clientY };
    if (e.altKey) {
      // Alt+拖动:连续调整光源方位/俯仰
      this.altDragging = true;
      this.controls.enabled = false;
      return;
    }
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const meshes = [...this.feathers.values()].map((f) => f.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (hit) {
      const id = hit.object.userData.featherId as number;
      this.select(id);
      this.draggingFeather = id;
      this.controls.enabled = false;
    } else {
      this.select(null);
    }
  };

  private onPointerUp = (): void => {
    this.draggingFeather = null;
    this.altDragging = false;
    this.controls.enabled = true;
  };

  private onPointerLeave = (): void => {
    if (this.draggingFeather === null) this.clearHover();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.selectedId === null) return;
    const id = this.selectedId;
    const f = this.feathers.get(id);
    if (!f) return;
    if (e.key === 'm' || e.key === 'M') {
      this.updateFeather(id, { mirrored: !f.params.mirrored });
    } else if (e.key === '[') {
      this.updateFeather(id, { rotation: f.params.rotation - Math.PI / 36 });
    } else if (e.key === ']') {
      this.updateFeather(id, { rotation: f.params.rotation + Math.PI / 36 });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.removeFeather(id);
    }
  };

  // ---------- 渲染循环 ----------

  /** 半透明羽片按视深预排序,避免叠加闪烁 */
  private sortFeathers(): void {
    const arr = [...this.feathers.values()];
    const v = new THREE.Vector3();
    const inv = this.camera.matrixWorldInverse;
    for (const f of arr) {
      f.mesh.getWorldPosition(v).applyMatrix4(inv);
      f.sortZ = v.z;
    }
    arr.sort((a, b) => a.sortZ - b.sortZ); // 远(更负)的先画
    for (let i = 0; i < arr.length; i++) arr[i].mesh.renderOrder = i + 1;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    if (dt > 0) this.fps = this.fps * 0.95 + (1000 / dt) * 0.05;

    this.controls.update();
    this.sortFeathers();
    this.composer.render();

    if (now - this.lastHudPush > 300) {
      this.lastHudPush = now;
      this.pushHud();
    }
  };

  private pushHud(): void {
    this.onHud({
      fps: Math.round(this.fps),
      count: this.feathers.size,
      selectedId: this.selectedId,
      hover: this.hover,
    });
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('keydown', this.onKeyDown);
    this.clearFeathers();
    this.composer.dispose();
    this.renderer.dispose();
    el.parentElement?.removeChild(el);
  }
}
