import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { createEngine } from "./engine";
import { MoleculeRenderer, AtomInfo } from "./moleculeRenderer";
import { ClipPlaneView } from "./clipPlane";
import { parseMoleculeFile } from "../chem/parsers";
import { inferBonds, findHBonds } from "../chem/bonds";
import { SAMPLES } from "../chem/samples";
import type { ClipSettings, ColorScheme, DisplayMode, Molecule } from "../chem/types";

export interface MolMeta {
  id: string;
  name: string;
  atomCount: number;
  bondCount: number;
  visible: boolean;
  colorScheme: ColorScheme;
}

export interface SelectionInfo extends AtomInfo {
  molId: string;
  molName: string;
}

export interface UIState {
  engineType: string;
  fps: number;
  molecules: MolMeta[];
  displayMode: DisplayMode;
  hbond: { enabled: boolean; threshold: number; count: number };
  clip: ClipSettings & { dMin: number; dMax: number };
  selection: SelectionInfo | null;
  loading: string | null;
  error: string | null;
}

interface SettingsFile {
  version: 1;
  displayMode: DisplayMode;
  hbond: { enabled: boolean; threshold: number };
  clip: ClipSettings;
  molecules: Array<{ name: string; visible: boolean; colorScheme: ColorScheme }>;
  camera: { alpha: number; beta: number; radius: number; target: [number, number, number] } | null;
}

let molCounter = 0;

export class ViewerController {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private clipView!: ClipPlaneView;
  private renderers = new Map<string, MoleculeRenderer>();
  private molecules = new Map<string, Molecule>();
  private listeners = new Set<() => void>();
  private version = 0;
  private clipRebuildScheduled = false;
  private fpsTimer: number | null = null;

  state: UIState = {
    engineType: "初始化中…",
    fps: 0,
    molecules: [],
    displayMode: "ballstick",
    hbond: { enabled: false, threshold: 3.0, count: 0 },
    clip: { enabled: false, yaw: 0, pitch: 90, d: 0, dMin: -50, dMax: 50 },
    selection: null,
    loading: null,
    error: null,
  };

  // ------------------------------------------------------------ 生命周期

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const { engine, isWebGPU } = await createEngine(canvas);
    this.engine = engine;
    this.state.engineType = isWebGPU ? "WebGPU" : "WebGL2（回退）";

    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.075, 0.085, 0.11, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2.4, 40, Vector3.Zero(), scene);
    this.camera.attachControl(canvas, true);
    this.camera.wheelPrecision = 5;
    this.camera.pinchPrecision = 50;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 20000;
    this.camera.lowerRadiusLimit = 0.5;
    this.camera.upperRadiusLimit = 5000;

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), scene);
    hemi.intensity = 0.95;
    const dir = new DirectionalLight("dir", new Vector3(-0.4, -1, -0.6), scene);
    dir.intensity = 0.55;

    this.clipView = new ClipPlaneView(scene);
    this.clipView.onChanged = (normal, d) => {
      const yawPitch = this.normalToYawPitch(normal);
      this.state.clip.yaw = yawPitch.yaw;
      this.state.clip.pitch = yawPitch.pitch;
      this.state.clip.d = d;
      this.applyClipPlane();
    };

    // 点击拾取（区分拖拽与点击）
    let downX = 0, downY = 0;
    scene.onPointerObservable.add((pi) => {
      if (pi.type === PointerEventTypes.POINTERDOWN) {
        downX = scene.pointerX;
        downY = scene.pointerY;
      } else if (pi.type === PointerEventTypes.POINTERUP) {
        const dx = scene.pointerX - downX;
        const dy = scene.pointerY - downY;
        if (dx * dx + dy * dy > 36) return; // 拖拽，不拾取
        this.handlePick(scene.pointerX, scene.pointerY);
      }
    });

    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    this.fpsTimer = window.setInterval(() => {
      this.state.fps = Math.round(engine.getFps());
      this.notify();
    }, 1000);
    this.notify();
  }

  dispose(): void {
    if (this.fpsTimer !== null) window.clearInterval(this.fpsTimer);
    this.scene?.dispose();
    this.engine?.dispose();
  }

  // ------------------------------------------------------------ 订阅

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ------------------------------------------------------------ 分子管理

  async addFiles(files: Iterable<File>): Promise<void> {
    for (const file of files) {
      try {
        this.state.loading = `解析 ${file.name}…`;
        this.notify();
        const text = await file.text();
        const mols = parseMoleculeFile(file.name, text);
        if (mols.length === 0) throw new Error("未解析到任何结构");
        for (const mol of mols) await this.addMolecule(mol);
      } catch (e) {
        this.state.error = `${file.name}: ${e instanceof Error ? e.message : String(e)}`;
        this.notify();
      }
    }
    this.state.loading = null;
    this.notify();
  }

  async addSample(sampleId: string): Promise<void> {
    const def = SAMPLES.find((s) => s.id === sampleId);
    if (!def) return;
    this.state.loading = `生成 ${def.label}…`;
    this.notify();
    await new Promise((r) => setTimeout(r)); // 让 loading 提示先渲染
    const mol = def.build();
    await this.addMolecule(mol);
    this.state.loading = null;
    this.notify();
  }

  private async addMolecule(mol: Molecule): Promise<void> {
    mol.id = `mol_${++molCounter}`;
    if (mol.bonds.length === 0 && mol.atoms.length > 1) {
      mol.bonds = inferBonds(mol);
    }
    this.molecules.set(mol.id, mol);
    const renderer = new MoleculeRenderer(this.scene, mol);
    this.renderers.set(mol.id, renderer);
    await renderer.build();
    renderer.setDisplayMode(this.state.displayMode);
    if (this.state.clip.enabled) {
      renderer.updateClip(this.currentClipInfo());
    }
    this.state.molecules = [
      ...this.state.molecules,
      {
        id: mol.id,
        name: mol.name,
        atomCount: mol.atoms.length,
        bondCount: mol.bonds.length,
        visible: true,
        colorScheme: { type: "cpk" },
      },
    ];
    this.frameCamera(false);
    this.refreshHBonds();
    this.notify();
  }

  removeMolecule(id: string): void {
    this.renderers.get(id)?.dispose();
    this.renderers.delete(id);
    this.molecules.delete(id);
    this.state.molecules = this.state.molecules.filter((m) => m.id !== id);
    if (this.state.selection?.molId === id) this.state.selection = null;
    this.refreshHBonds();
    this.notify();
  }

  setVisible(id: string, visible: boolean): void {
    this.renderers.get(id)?.setVisible(visible);
    this.state.molecules = this.state.molecules.map((m) => (m.id === id ? { ...m, visible } : m));
    this.notify();
  }

  setColorScheme(id: string, scheme: ColorScheme): void {
    this.renderers.get(id)?.setColorScheme(scheme);
    this.state.molecules = this.state.molecules.map((m) => (m.id === id ? { ...m, colorScheme: scheme } : m));
    this.notify();
  }

  // ------------------------------------------------------------ 显示模式

  setDisplayMode(mode: DisplayMode): void {
    this.state.displayMode = mode;
    for (const r of this.renderers.values()) r.setDisplayMode(mode);
    this.notify();
  }

  // ------------------------------------------------------------ 氢键

  setHBondEnabled(enabled: boolean): void {
    this.state.hbond.enabled = enabled;
    this.refreshHBonds();
    this.notify();
  }

  setHBondThreshold(threshold: number): void {
    this.state.hbond.threshold = threshold;
    this.refreshHBonds();
    this.notify();
  }

  private refreshHBonds(): void {
    let total = 0;
    for (const [id, renderer] of this.renderers) {
      const mol = this.molecules.get(id);
      if (!mol) continue;
      if (this.state.hbond.enabled) {
        const pairs = findHBonds(mol, this.state.hbond.threshold);
        renderer.setHBonds(pairs);
        total += pairs.length;
      } else {
        renderer.setHBonds(null);
      }
    }
    this.state.hbond.count = total;
  }

  // ------------------------------------------------------------ 剖切

  private yawPitchToNormal(yaw: number, pitch: number): Vector3 {
    const y = (yaw * Math.PI) / 180;
    const p = (pitch * Math.PI) / 180;
    return new Vector3(Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y));
  }

  private normalToYawPitch(n: Vector3): { yaw: number; pitch: number } {
    const pitch = (Math.asin(Math.max(-1, Math.min(1, n.y))) * 180) / Math.PI;
    const yaw = (Math.atan2(n.x, n.z) * 180) / Math.PI;
    return { yaw: Math.round((yaw + 360) % 360), pitch: Math.round(pitch) };
  }

  private currentClipInfo() {
    const c = this.state.clip;
    const n = this.yawPitchToNormal(c.yaw, c.pitch);
    return { nx: n.x, ny: n.y, nz: n.z, d: c.d };
  }

  setClipEnabled(enabled: boolean): void {
    this.state.clip.enabled = enabled;
    this.applyClipPlane();
  }

  setClipOrientation(yaw: number, pitch: number): void {
    this.state.clip.yaw = yaw;
    this.state.clip.pitch = pitch;
    this.applyClipPlane();
  }

  setClipDistance(d: number): void {
    this.state.clip.d = d;
    this.applyClipPlane();
  }

  flipClip(): void {
    const c = this.state.clip;
    c.yaw = (c.yaw + 180) % 360;
    c.pitch = -c.pitch;
    this.applyClipPlane();
  }

  resetClip(): void {
    const c = this.state.clip;
    c.yaw = 0;
    c.pitch = 90;
    c.d = 0;
    this.applyClipPlane();
  }

  private applyClipPlane(): void {
    const c = this.state.clip;
    const normal = this.yawPitchToNormal(c.yaw, c.pitch);
    if (c.enabled) {
      // Babylon Plane：保留 dot(n,p) + d0 >= 0 一侧，d0 = -d
      this.scene.clipPlane = new Plane(normal.x, normal.y, normal.z, -c.d);
    } else {
      this.scene.clipPlane = null as unknown as Plane;
    }
    // 平面可视化（尺寸取场景包围盒对角线）
    const diag = this.sceneDiagonal();
    this.clipView.setVisible(c.enabled);
    if (c.enabled) this.clipView.setState(normal, c.d, diag * 0.9);
    // d 的滑杆范围
    const center = this.sceneCenter();
    const proj = center ? Vector3.Dot(normal, center) : 0;
    c.dMin = Math.floor(proj - diag);
    c.dMax = Math.ceil(proj + diag);
    // 键截断重建 + 封口（rAF 合并，拖动时一帧一次）
    if (!this.clipRebuildScheduled) {
      this.clipRebuildScheduled = true;
      requestAnimationFrame(() => {
        this.clipRebuildScheduled = false;
        const info = c.enabled ? this.currentClipInfo() : null;
        for (const r of this.renderers.values()) r.updateClip(info);
      });
    }
    this.notify();
  }

  private sceneCenter(): Vector3 | null {
    const b = this.computeBounds();
    return b ? b.center : null;
  }

  private sceneDiagonal(): number {
    const b = this.computeBounds();
    return b ? Math.max(10, b.radius * 2) : 30;
  }

  private computeBounds(): { center: Vector3; radius: number } | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let any = false;
    for (const mol of this.molecules.values()) {
      for (const a of mol.atoms) {
        any = true;
        if (a.x < minX) minX = a.x;
        if (a.y < minY) minY = a.y;
        if (a.z < minZ) minZ = a.z;
        if (a.x > maxX) maxX = a.x;
        if (a.y > maxY) maxY = a.y;
        if (a.z > maxZ) maxZ = a.z;
      }
    }
    if (!any) return null;
    const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const radius = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2) / 2;
    return { center, radius: Math.max(radius, 1) };
  }

  frameCamera(animated = true): void {
    void animated;
    const b = this.computeBounds();
    if (!b) return;
    this.camera.target = b.center;
    this.camera.radius = Math.max(6, b.radius * 2.4);
  }

  // ------------------------------------------------------------ 拾取

  private handlePick(x: number, y: number): void {
    const pick = this.scene.pick(x, y, (mesh) => {
      const meta = mesh.metadata as { kind?: string } | null;
      return !!meta && meta.kind === "atom";
    });
    if (pick?.hit && pick.pickedMesh && pick.thinInstanceIndex >= 0) {
      const meta = pick.pickedMesh.metadata as { renderer: MoleculeRenderer };
      const renderer = meta.renderer;
      const atomIndex = renderer.atomIndexFromPick(pick.pickedMesh as Mesh, pick.thinInstanceIndex);
      if (atomIndex !== null) {
        this.select(renderer, atomIndex);
        return;
      }
    }
    this.clearSelection();
  }

  private select(renderer: MoleculeRenderer, atomIndex: number): void {
    // 清掉其它分子的旧高亮
    for (const r of this.renderers.values()) {
      if (r !== renderer) r.setHighlight(null);
    }
    const info = renderer.setHighlight(atomIndex);
    if (!info) return;
    const molId = renderer.molecule.id;
    this.state.selection = {
      ...info,
      molId,
      molName: renderer.molecule.name,
    };
    this.notify();
  }

  clearSelection(): void {
    for (const r of this.renderers.values()) r.setHighlight(null);
    if (this.state.selection) {
      this.state.selection = null;
      this.notify();
    }
  }

  // ------------------------------------------------------------ 视图设置导入导出

  exportSettings(): string {
    const cam = this.camera;
    const settings: SettingsFile = {
      version: 1,
      displayMode: this.state.displayMode,
      hbond: { enabled: this.state.hbond.enabled, threshold: this.state.hbond.threshold },
      clip: {
        enabled: this.state.clip.enabled,
        yaw: this.state.clip.yaw,
        pitch: this.state.clip.pitch,
        d: this.state.clip.d,
      },
      molecules: this.state.molecules.map((m) => ({
        name: m.name,
        visible: m.visible,
        colorScheme: m.colorScheme,
      })),
      camera: {
        alpha: cam.alpha,
        beta: cam.beta,
        radius: cam.radius,
        target: [cam.target.x, cam.target.y, cam.target.z],
      },
    };
    return JSON.stringify(settings, null, 2);
  }

  importSettings(json: string): void {
    const s = JSON.parse(json) as SettingsFile;
    if (s.version !== 1) throw new Error("不支持的设置文件版本");
    this.setDisplayMode(s.displayMode);
    this.state.hbond.enabled = s.hbond.enabled;
    this.state.hbond.threshold = s.hbond.threshold;
    this.refreshHBonds();
    // 按名称匹配分子，应用配色与可见性
    for (const ms of s.molecules ?? []) {
      const meta = this.state.molecules.find((m) => m.name === ms.name);
      if (!meta) continue;
      this.setColorScheme(meta.id, ms.colorScheme);
      this.setVisible(meta.id, ms.visible);
    }
    // 剖切平面
    this.state.clip.enabled = s.clip.enabled;
    this.state.clip.yaw = s.clip.yaw;
    this.state.clip.pitch = s.clip.pitch;
    this.state.clip.d = s.clip.d;
    this.applyClipPlane();
    // 相机
    if (s.camera) {
      this.camera.alpha = s.camera.alpha;
      this.camera.beta = s.camera.beta;
      this.camera.radius = s.camera.radius;
      this.camera.target.set(s.camera.target[0], s.camera.target[1], s.camera.target[2]);
    }
    this.notify();
  }

  clearError(): void {
    this.state.error = null;
    this.notify();
  }
}
