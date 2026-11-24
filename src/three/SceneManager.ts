import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PlateKind, buildPlateGeometry } from './plates';
import {
  HeadSize,
  SauceGeoOptions,
  buildSauceGeometry,
  createSauceMaterial,
  updateSauceMaterial,
} from './sauce';

export type LightPreset = 'top' | 'rim' | 'warm';
export type Tool = 'draw' | 'select';

export const LIGHT_LABELS: Record<LightPreset, string> = {
  top: '顶部柔光',
  rim: '侧逆光',
  warm: '暖色餐桌灯',
};

export interface PathTransform {
  x: number;
  z: number;
  rot: number; // 弧度
  scale: number;
}

export interface SaucePath {
  id: string;
  name: string;
  color: string;
  viscosity: number;
  width: HeadSize;
  points: [number, number][];
  transform: PathTransform;
  createdAt: number;
}

export interface Snapshot {
  plate: PlateKind;
  light: LightPreset;
  tool: Tool;
  color: string;
  viscosity: number;
  head: HeadSize;
  paths: SaucePath[];
  selectedId: string | null;
  drawing: boolean;
  maxPaths: number;
}

const STORAGE_KEY = 'sauce-plater-v1';
export const MAX_PATHS = 24;

interface PersistState {
  plate: PlateKind;
  light: LightPreset;
  color: string;
  viscosity: number;
  head: HeadSize;
  paths: SaucePath[];
}

let uidCounter = 0;
function uid(): string {
  return `p${Date.now().toString(36)}_${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private plateMesh: THREE.Mesh;
  private sauceGroup = new THREE.Group();
  private lightRig = new THREE.Group();
  private clock = new THREE.Clock();
  private raf = 0;
  private resizeObs: ResizeObserver;

  // 状态
  private plate: PlateKind = 'flat';
  private light: LightPreset = 'top';
  private tool: Tool = 'draw';
  private color = '#7a1f2b';
  private viscosity = 1.0;
  private head: HeadSize = 'medium';
  private paths: SaucePath[] = [];
  private selectedId: string | null = null;

  private meshById = new Map<string, THREE.Mesh>();
  private matById = new Map<string, THREE.MeshPhysicalMaterial>();
  private flow = new Map<string, number>(); // 流动进度 0..1

  // 挤出中的笔划
  private openStroke: SaucePath | null = null;
  private isPointerDown = false;
  private moving = false;
  private moveLast: THREE.Vector3 | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private onState: (s: Snapshot) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x2b2724);
    this.scene.fog = new THREE.Fog(0x2b2724, 9, 18);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    this.camera.position.set(0, 3.4, 3.6);
    this.camera.lookAt(0, 0.1, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.1, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    // 左键留给挤出/选择,右键旋转视角,滚轮缩放
    (this.controls.mouseButtons as { LEFT: unknown }).LEFT = null;

    // 环境反射(酱汁高光的基础)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 桌面
    const table = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: 0x4a3f36, roughness: 0.9 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.145;
    table.receiveShadow = true;
    this.scene.add(table);

    this.scene.add(this.sauceGroup);
    this.scene.add(this.lightRig);

    // 盘面
    this.plateMesh = new THREE.Mesh(
      buildPlateGeometry(this.plate),
      new THREE.MeshStandardMaterial({ color: 0xf3eee6, roughness: 0.32, metalness: 0 }),
    );
    this.plateMesh.receiveShadow = true;
    this.scene.add(this.plateMesh);

    this.restore();
    this.applyLightPreset(this.light);
    this.rebuildPlate();
    this.rebuildAllSauces();

    // 事件
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('contextmenu', this.onContextMenu);

    this.resizeObs = new ResizeObserver(() => this.resize());
    if (canvas.parentElement) this.resizeObs.observe(canvas.parentElement);
    this.resize();

    this.emit();
    this.animate();
  }

  // ---------- 公开 API ----------

  getSnapshot(): Snapshot {
    return {
      plate: this.plate,
      light: this.light,
      tool: this.tool,
      color: this.color,
      viscosity: this.viscosity,
      head: this.head,
      paths: this.paths.map((p) => ({ ...p, transform: { ...p.transform } })),
      selectedId: this.selectedId,
      drawing: this.openStroke !== null,
      maxPaths: MAX_PATHS,
    };
  }

  setPlate(kind: PlateKind): void {
    if (kind === this.plate) return;
    this.plate = kind;
    this.rebuildPlate();
    this.rebuildAllSauces(); // 已有酱汁自动贴合新盘面高度场
    this.save();
    this.emit();
  }

  setLight(preset: LightPreset): void {
    this.light = preset;
    this.applyLightPreset(preset);
    this.save();
    this.emit();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool === 'select') this.finishStroke();
    this.emit();
  }

  /** 左侧面板材质设置;若有选中路径则同步应用到该路径 */
  setMaterialPrefs(prefs: { color?: string; viscosity?: number; head?: HeadSize }): void {
    if (prefs.color !== undefined) this.color = prefs.color;
    if (prefs.viscosity !== undefined) this.viscosity = prefs.viscosity;
    if (prefs.head !== undefined) this.head = prefs.head;
    const sel = this.paths.find((p) => p.id === this.selectedId);
    if (sel) {
      if (prefs.color !== undefined) sel.color = prefs.color;
      if (prefs.viscosity !== undefined) sel.viscosity = prefs.viscosity;
      if (prefs.head !== undefined) sel.width = prefs.head;
      const mat = this.matById.get(sel.id);
      if (mat) updateSauceMaterial(mat, sel.color, sel.viscosity);
      this.rebuildPathMesh(sel, this.paths.indexOf(sel));
    }
    this.save();
    this.emit();
  }

  selectPath(id: string | null): void {
    this.selectedId = id;
    this.updateSelectionHighlight();
    this.emit();
  }

  deletePath(id: string): void {
    const i = this.paths.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.paths.splice(i, 1);
    this.disposePathMesh(id);
    this.flow.delete(id);
    if (this.selectedId === id) this.selectedId = null;
    // 层序变化,重建剩余酱汁的高度遮挡
    this.rebuildAllSauces();
    this.save();
    this.emit();
  }

  setSelectedTransform(t: Partial<PathTransform>): void {
    const sel = this.paths.find((p) => p.id === this.selectedId);
    if (!sel) return;
    Object.assign(sel.transform, t);
    this.rebuildPathMesh(sel, this.paths.indexOf(sel));
    this.save();
    this.emit();
  }

  exportPNG(): void {
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `plating_${this.plate}_${Date.now()}.png`;
    a.click();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('dblclick', this.onDblClick);
    window.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    this.renderer.dispose();
  }

  // ---------- 灯光预设 ----------

  private applyLightPreset(preset: LightPreset): void {
    for (const c of [...this.lightRig.children]) {
      this.lightRig.remove(c);
      if (c instanceof THREE.Light) c.dispose();
    }
    const add = (l: THREE.Light) => this.lightRig.add(l);

    if (preset === 'top') {
      // 顶部柔光:大面积顶光 + 均匀环境
      const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8078, 0.55);
      add(hemi);
      const key = new THREE.DirectionalLight(0xfff6ec, 1.7);
      key.position.set(0.6, 5.2, 1.0);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -3;
      key.shadow.camera.right = 3;
      key.shadow.camera.top = 3;
      key.shadow.camera.bottom = -3;
      key.shadow.radius = 6;
      key.shadow.bias = -0.0004;
      add(key);
      const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
      fill.position.set(-3, 2, -2);
      add(fill);
      this.renderer.toneMappingExposure = 1.0;
    } else if (preset === 'rim') {
      // 侧逆光:低角度后侧强光勾勒轮廓,正面弱补光
      const amb = new THREE.AmbientLight(0x2e3440, 0.5);
      add(amb);
      const rim = new THREE.DirectionalLight(0xeef2ff, 2.6);
      rim.position.set(-4.2, 2.2, -3.2);
      rim.castShadow = true;
      rim.shadow.mapSize.set(2048, 2048);
      rim.shadow.camera.left = -3;
      rim.shadow.camera.right = 3;
      rim.shadow.camera.top = 3;
      rim.shadow.camera.bottom = -3;
      rim.shadow.bias = -0.0004;
      add(rim);
      const fill = new THREE.DirectionalLight(0xfff0e0, 0.28);
      fill.position.set(2.5, 1.6, 3.5);
      add(fill);
      this.renderer.toneMappingExposure = 0.95;
    } else {
      // 暖色餐桌灯:暖点光 + 昏暗氛围
      const amb = new THREE.AmbientLight(0x40342a, 0.55);
      add(amb);
      const lamp = new THREE.PointLight(0xffb066, 28, 0, 2);
      lamp.position.set(1.6, 3.0, 1.8);
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(1024, 1024);
      lamp.shadow.bias = -0.0004;
      add(lamp);
      const warm = new THREE.DirectionalLight(0xffd9a0, 0.5);
      warm.position.set(2, 4, 1);
      add(warm);
      this.renderer.toneMappingExposure = 1.05;
    }
  }

  // ---------- 盘面与酱汁网格 ----------

  private rebuildPlate(): void {
    this.plateMesh.geometry.dispose();
    this.plateMesh.geometry = buildPlateGeometry(this.plate);
  }

  private transformedPoints(p: SaucePath): [number, number][] {
    const { x, z, rot, scale } = p.transform;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    return p.points.map(([px, pz]) => {
      const sx = px * scale;
      const sz = pz * scale;
      return [sx * cos - sz * sin + x, sx * sin + sz * cos + z] as [number, number];
    });
  }

  private rebuildPathMesh(p: SaucePath, layer: number): void {
    const old = this.meshById.get(p.id);
    if (old) {
      this.sauceGroup.remove(old);
      old.geometry.dispose();
    }
    let mat = this.matById.get(p.id);
    if (!mat) {
      mat = createSauceMaterial(p.color, p.viscosity);
      this.matById.set(p.id, mat);
    }
    const opts: SauceGeoOptions = {
      viscosity: p.viscosity,
      width: p.width,
      plate: this.plate,
      layer,
      flow: this.flow.get(p.id) ?? 1,
    };
    const mesh = new THREE.Mesh(buildSauceGeometry(this.transformedPoints(p), opts), mat);
    mesh.castShadow = true;
    mesh.userData.pathId = p.id;
    this.meshById.set(p.id, mesh);
    this.sauceGroup.add(mesh);
    this.updateSelectionHighlight();
  }

  private rebuildAllSauces(): void {
    this.paths.forEach((p, i) => this.rebuildPathMesh(p, i));
    if (this.openStroke) this.rebuildPathMesh(this.openStroke, this.paths.length);
  }

  private disposePathMesh(id: string): void {
    const mesh = this.meshById.get(id);
    if (mesh) {
      this.sauceGroup.remove(mesh);
      mesh.geometry.dispose();
      this.meshById.delete(id);
    }
    const mat = this.matById.get(id);
    if (mat) {
      mat.dispose();
      this.matById.delete(id);
    }
  }

  private updateSelectionHighlight(): void {
    for (const [id, mat] of this.matById) {
      const selected = id === this.selectedId;
      mat.emissive.set(selected ? 0x333311 : 0x000000);
      mat.emissiveIntensity = selected ? 0.6 : 0;
    }
  }

  // ---------- 交互 ----------

  private onContextMenu = (e: Event) => e.preventDefault();

  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private raycastPlate(e: PointerEvent): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObject(this.plateMesh, false);
    return hits.length ? hits[0].point : null;
  }

  private raycastSauce(e: PointerEvent): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects(this.sauceGroup.children, false);
    return hits.length ? (hits[0].object.userData.pathId as string) : null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.isPointerDown = true;
    if (this.tool === 'draw') {
      const hit = this.raycastPlate(e);
      if (!hit) return;
      if (!this.openStroke) {
        this.openStroke = {
          id: uid(),
          name: '',
          color: this.color,
          viscosity: this.viscosity,
          width: this.head,
          points: [[hit.x, hit.z]],
          transform: { x: 0, z: 0, rot: 0, scale: 1 },
          createdAt: Date.now(),
        };
        this.flow.set(this.openStroke.id, 0.35);
        this.rebuildPathMesh(this.openStroke, this.paths.length);
        this.emit();
      }
      // 笔划未收尾时,再次按下从上次终点继续挤出
    } else {
      const id = this.raycastSauce(e);
      this.selectedId = id;
      this.updateSelectionHighlight();
      if (id) {
        this.moving = true;
        this.moveLast = this.raycastPlate(e);
      }
      this.emit();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isPointerDown) return;
    if (this.tool === 'draw' && this.openStroke) {
      const hit = this.raycastPlate(e);
      if (!hit) return;
      const pts = this.openStroke.points;
      const last = pts[pts.length - 1];
      const minDist = Math.max(0.025, 0.06 * (this.openStroke.width === 'thin' ? 0.7 : this.openStroke.width === 'thick' ? 1.3 : 1));
      if (Math.hypot(hit.x - last[0], hit.z - last[1]) >= minDist) {
        pts.push([hit.x, hit.z]);
        this.rebuildPathMesh(this.openStroke, this.paths.length);
      }
    } else if (this.tool === 'select' && this.moving && this.selectedId && this.moveLast) {
      const hit = this.raycastPlate(e);
      if (!hit) return;
      const sel = this.paths.find((p) => p.id === this.selectedId);
      if (!sel) return;
      sel.transform.x += hit.x - this.moveLast.x;
      sel.transform.z += hit.z - this.moveLast.z;
      this.moveLast = hit.clone();
      this.rebuildPathMesh(sel, this.paths.indexOf(sel));
    }
  };

  private onPointerUp = (): void => {
    this.isPointerDown = false;
    if (this.moving) {
      this.moving = false;
      this.moveLast = null;
      this.save();
      this.emit();
    }
  };

  private onDblClick = (): void => {
    this.finishStroke();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') {
      if (this.openStroke) {
        this.disposePathMesh(this.openStroke.id);
        this.flow.delete(this.openStroke.id);
        this.openStroke = null;
        this.emit();
      } else {
        this.selectPath(null);
      }
    } else if (e.key === 'Enter') {
      this.finishStroke();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      this.deletePath(this.selectedId);
    }
  };

  /** 双击/Enter 收尾:把开放笔划落为一条正式路径 */
  private finishStroke(): void {
    const s = this.openStroke;
    if (!s) return;
    this.openStroke = null;
    if (s.points.length === 0) {
      this.disposePathMesh(s.id);
      return;
    }
    s.name = `酱汁 ${this.paths.length + 1}`;
    // 超过 24 条时替换最早的一条
    while (this.paths.length >= MAX_PATHS) {
      const oldest = this.paths.shift()!;
      this.disposePathMesh(oldest.id);
      this.flow.delete(oldest.id);
      if (this.selectedId === oldest.id) this.selectedId = null;
    }
    this.flow.set(s.id, 0.35); // 从头播放流动铺开动画
    this.paths.push(s);
    this.rebuildAllSauces();
    this.save();
    this.emit();
  }

  // ---------- 流动动画 ----------

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    let animating = false;
    const tick = (p: SaucePath, layer: number) => {
      const f = this.flow.get(p.id);
      if (f !== undefined && f < 1) {
        // 粘度越高流动越慢
        const nf = Math.min(1, f + (dt * 0.9) / p.viscosity);
        this.flow.set(p.id, nf);
        this.rebuildPathMesh(p, layer);
        animating = true;
      }
    };
    this.paths.forEach((p, i) => tick(p, i));
    if (this.openStroke) tick(this.openStroke, this.paths.length);
    if (animating) {
      // 动画期间每帧已重建网格
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  // ---------- 持久化 ----------

  private save(): void {
    const state: PersistState = {
      plate: this.plate,
      light: this.light,
      color: this.color,
      viscosity: this.viscosity,
      head: this.head,
      paths: this.paths,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 存储不可用时忽略 */
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as PersistState;
      if (s.plate) this.plate = s.plate;
      if (s.light) this.light = s.light;
      if (s.color) this.color = s.color;
      if (s.viscosity) this.viscosity = s.viscosity;
      if (s.head) this.head = s.head;
      if (Array.isArray(s.paths)) {
        this.paths = s.paths.slice(0, MAX_PATHS).map((p) => ({
          ...p,
          transform: Object.assign({ x: 0, z: 0, rot: 0, scale: 1 }, p.transform),
        }));
        for (const p of this.paths) this.flow.set(p.id, 1); // 恢复的路径直接到位
      }
    } catch {
      /* 数据损坏时从空盘开始 */
    }
  }

  // ---------- 其他 ----------

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private emit(): void {
    this.onState(this.getSnapshot());
  }
}
