import type {
  FoliageData,
  FoliageParams,
  MassBalance,
  PotParams,
  PotResult,
  Project,
  ShapeState,
  Skeleton,
  TreeParams,
} from '../core/types';
import { buildSkeleton, DEFAULT_TREE, limbKindLabel } from '../core/skeleton';
import { TreeRig } from '../core/pose';
import { clampFoliage, generateFoliage, leafCountByDepth, DEFAULT_FOLIAGE } from '../core/foliage';
import { clampPot, combineMass, DEFAULT_POT, STYLES } from '../core/pot';
import { buildProject, downloadProject, parseProject, ProjectFormatError } from '../io/project';
import { LocalStore, type SavedState } from '../io/storage';
import { Viewer, type ViewerMode } from '../viewer/viewer';
import type { PotRequest, PotResponse } from '../workers/pot.worker';

export interface PerfSample {
  poseMs: number;
  foliageMs: number;
  balanceMs: number;
  totalMs: number;
  leafSortMs: number;
  leafUpdateMs: number;
  potMs: number;
}

export interface AppState {
  tree: TreeParams;
  shape: ShapeState;
  foliage: FoliageParams;
  pot: PotParams;
  skeleton: Skeleton;
  leaves: FoliageData;
  potResult: PotResult | null;
  balance: MassBalance | null;
  mode: ViewerMode;
  selectedControl: number | null;
  perf: PerfSample;
  potBusy: boolean;
  lastError: string | null;
}

export type Listener = (state: AppState) => void;
export type PartialListener<T> = (value: T) => void;

const WOOD_DENSITY = 0.62; // g/cm^3, dried hardwood
const LEAF_GRAM = 0.045;

/**
 * Owns the tree, the shape state, the foliage cache and the pot worker. Every interactive
 * path here runs the same order: pose -> foliage -> wood mass -> balance, then publishes a
 * single state object so the panels and viewer stay in step.
 */
export class App {
  readonly viewer: Viewer;
  private store = new LocalStore();
  private worker: Worker;

  private tree: TreeParams;
  private shape: ShapeState;
  private foliageParams: FoliageParams;
  private potParams: PotParams;
  private skeleton: Skeleton;
  private leaves: FoliageData;

  private potResult: PotResult | null = null;
  private potRequestId = 0;
  private potBusy = false;
  private potPendingTimer: number | null = null;
  private balance: MassBalance | null = null;
  private mode: ViewerMode = 'shape';
  private selectedControl: number | null = null;

  private perf: PerfSample = {
    poseMs: 0, foliageMs: 0, balanceMs: 0, totalMs: 0, leafSortMs: 0, leafUpdateMs: 0, potMs: 0,
  };

  private listeners = new Set<Listener>();
  private deformationCounter = 0;
  private foliageSig = '';
  private lastError: string | null = null;
  private potFallback = false;
  private dragRaf = 0;
  private dragQueued = false;

  constructor(container: HTMLElement) {
    const saved = this.store.load();
    this.tree = saved?.tree ?? { ...DEFAULT_TREE };
    this.shape = saved?.shape ?? { bends: {}, twists: {}, pruned: [] };
    this.foliageParams = clampFoliage(saved?.foliage ?? { ...DEFAULT_FOLIAGE });
    this.potParams = clampPot(saved?.pot ?? { ...DEFAULT_POT });
    this.skeleton = buildSkeleton(this.tree);

    this.viewer = new Viewer(container, this.skeleton);
    this.viewer.rig.setShape(this.shape);
    this.leaves = generateFoliage(this.skeleton, this.viewer.rig, this.foliageParams);
    this.viewer.setFoliage(this.leaves, this.foliageParams);
    this.viewer.setCallbacks({
      onControlDragStart: () => this.onDragStart(),
      onControlDrag: () => this.onDragMove(),
      onControlDragEnd: () => this.onDragEnd(),
      onHoverChange: (hit) => {
        if (hit?.node !== undefined) this.setSelectedControl(hit.node, false);
      },
      onLimbClick: (limb) => this.pruneLimb(limb),
      onLimbHover: () => undefined,
    });

    this.worker = new Worker(new URL('../workers/pot.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<PotResponse>) => this.onPotResult(ev.data);
    this.worker.onerror = (ev) => {
      this.lastError = `盆钵计算失败：${ev.message}`;
      this.potBusy = false;
      this.emit();
    };

    this.recomputeBalance();
    this.viewer.frameAll();
    this.requestPot(0);
    this.store.onSaved = () => this.emit();
  }

  // ------------------------------------------------------------------
  // Subscriptions
  // ------------------------------------------------------------------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private snapshot(): AppState {
    return {
      tree: this.tree,
      shape: this.shape,
      foliage: this.foliageParams,
      pot: this.potParams,
      skeleton: this.skeleton,
      leaves: this.leaves,
      potResult: this.potResult,
      balance: this.balance,
      mode: this.mode,
      selectedControl: this.selectedControl,
      perf: { ...this.perf },
      potBusy: this.potBusy,
      lastError: this.lastError,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  // ------------------------------------------------------------------
  // Accessors used by the UI
  // ------------------------------------------------------------------

  get state(): AppState {
    return this.snapshot();
  }

  get storageSupported(): boolean {
    return this.store.supported;
  }

  get savedAgo(): string {
    return this.store.savedAgo();
  }

  get isPotFallback(): boolean {
    return this.potFallback;
  }

  get treeRig(): TreeRig {
    return this.viewer.rig;
  }

  get leafData(): FoliageData {
    return this.leaves;
  }

  // ------------------------------------------------------------------
  // Modes + selection
  // ------------------------------------------------------------------

  setMode(mode: ViewerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.viewer.setMode(mode);
    if (mode !== 'shape') {
      this.selectedControl = null;
      this.viewer.setSelectedControl(null);
    }
    this.emit();
  }

  setSelectedControl(node: number | null, announce = true): void {
    if (this.selectedControl === node) return;
    this.selectedControl = node;
    this.viewer.setSelectedControl(node);
    if (announce) this.emit();
  }

  // ------------------------------------------------------------------
  // Drag pipeline
  // ------------------------------------------------------------------

  private onDragStart(): void {
    this.viewer.setMode('shape');
  }

  /** Coalesce pointer moves into one pose evaluation per animation frame. */
  private onDragMove(): void {
    if (this.dragQueued) return;
    this.dragQueued = true;
    this.dragRaf = requestAnimationFrame(() => {
      this.dragQueued = false;
      this.rebuildFromPose();
    });
  }

  private onDragEnd(): void {
    if (this.dragRaf) cancelAnimationFrame(this.dragRaf);
    this.dragQueued = false;
    this.rebuildFromPose();
    this.schedulePot();
    this.persistSoon();
  }

  /**
   * The hot path: re-sweep the tube, rebuild foliage bindings, recompute mass and balance.
   * Everything here is O(nodes + leaves) with preallocated buffers.
   */
  rebuildFromPose(): void {
    const t0 = performance.now();
    this.shape = this.viewer.rig.getShape();
    this.viewer.rebuildTree();
    const t1 = performance.now();
    // Leaf bind data depends only on the skeleton, the pruning set and the foliage params —
    // never on the pose — so a drag reuses it and just lets the leaf layer re-deform.
    const sig = this.foliageSignature();
    if (sig !== this.foliageSig) {
      this.foliageSig = sig;
      this.leaves = generateFoliage(this.skeleton, this.viewer.rig, this.foliageParams);
      this.viewer.setFoliage(this.leaves, this.foliageParams);
    } else {
      this.viewer.leaves.markDirty();
    }
    const t2 = performance.now();
    this.recomputeBalance();
    const t3 = performance.now();
    this.deformationCounter++;
    this.perf = {
      ...this.perf,
      poseMs: t1 - t0,
      foliageMs: t2 - t1,
      balanceMs: t3 - t2,
      totalMs: t3 - t0,
      leafSortMs: this.viewer.leaves.sortMs,
      leafUpdateMs: this.viewer.leaves.updateMs,
    };
    this.emit();
  }

  /** Changes whenever the leaf set itself would change, so regeneration can be skipped. */
  private foliageSignature(): string {
    const f = this.foliageParams;
    return [
      this.skeleton.seed,
      this.skeleton.nodes.length,
      this.skeleton.limbs.length,
      [...this.viewer.rig.prunedList()].sort((a, b) => a - b).join('.'),
      f.density, f.size, f.hue, f.fluff, f.seed,
    ].join('|');
  }

  private recomputeBalance(): void {
    const rig = this.viewer.rig;
    const wood = rig.woodMass(WOOD_DENSITY);
    const leafMass = this.leaves.leaves.length * LEAF_GRAM;
    const leafCom = [0, 0, 0] as [number, number, number];
    let count = 0;
    for (const leaf of this.leaves.leaves) {
      leafCom[0] += leaf.offset[0];
      leafCom[1] += leaf.offset[1];
      leafCom[2] += leaf.offset[2];
      count++;
    }
    if (count) {
      leafCom[0] /= count;
      leafCom[1] /= count;
      leafCom[2] /= count;
    }
    this.balance = combineMass(
      {
        treeMass: wood.mass,
        treeCom: [wood.com.x, wood.com.y, wood.com.z],
        leafMass,
        leafCom,
        treeBaseY: this.viewer.soilY,
      },
      this.potResult
        ? {
          mass: this.potResult.mass,
          com: this.potResult.com,
          support: this.potResult.support,
          balance: this.potResult.balance,
        }
        : null,
    );
    this.viewer.setBalance(this.balance);
  }

  // ------------------------------------------------------------------
  // Skeleton regeneration (tree params)
  // ------------------------------------------------------------------

  setTreeParam<K extends keyof TreeParams>(key: K, value: TreeParams[K]): void {
    if (this.tree[key] === value) return;
    this.tree = { ...this.tree, [key]: value };
    this.regenerateSkeleton();
  }

  setTreeParams(patch: Partial<TreeParams>): void {
    this.tree = { ...this.tree, ...patch };
    this.regenerateSkeleton();
  }

  regenerateSkeleton(): void {
    this.skeleton = buildSkeleton(this.tree);
    const freshRig = new TreeRig(this.skeleton);
    this.viewer.setRig(freshRig);
    this.selectedControl = null;
    this.shape = freshRig.getShape();
    this.leaves = generateFoliage(this.skeleton, freshRig, this.foliageParams);
    this.viewer.setFoliage(this.leaves, this.foliageParams);
    this.foliageSig = this.foliageSignature();
    this.recomputeBalance();
    this.emit();
    this.persistSoon();
  }

  reroll(seed?: number): void {
    const next = seed ?? Math.floor(Math.random() * 100000);
    this.setTreeParams({ seed: next });
  }

  // ------------------------------------------------------------------
  // Foliage
  // ------------------------------------------------------------------

  setFoliageParam<K extends keyof FoliageParams>(key: K, value: FoliageParams[K]): void {
    this.foliageParams = clampFoliage({ ...this.foliageParams, [key]: value });
    if (key === 'opacity') {
      this.viewer.refreshLeafParams(this.foliageParams);
      this.emit();
      return;
    }
    const t0 = performance.now();
    this.leaves = generateFoliage(this.skeleton, this.viewer.rig, this.foliageParams);
    this.viewer.setFoliage(this.leaves, this.foliageParams);
    this.foliageSig = this.foliageSignature();
    this.recomputeBalance();
    this.perf = { ...this.perf, foliageMs: performance.now() - t0 };
    this.emit();
    this.persistSoon();
  }

  // ------------------------------------------------------------------
  // Pruning
  // ------------------------------------------------------------------

  pruneLimb(limbId: number): void {
    if (limbId <= 0) return;
    const limb = this.skeleton.limbs[limbId];
    if (!limb) return;
    this.viewer.rig.pruneLimb(limbId);
    this.afterShapeEdit();
  }

  restoreLimb(limbId: number): void {
    this.viewer.rig.restoreLimb(limbId);
    this.afterShapeEdit();
  }

  private afterShapeEdit(): void {
    this.shape = this.viewer.rig.getShape();
    this.viewer.rebuildTree();
    this.leaves = generateFoliage(this.skeleton, this.viewer.rig, this.foliageParams);
    this.viewer.setFoliage(this.leaves, this.foliageParams);
    this.foliageSig = this.foliageSignature();
    this.recomputeBalance();
    this.schedulePot();
    this.emit();
    this.persistSoon();
  }

  // ------------------------------------------------------------------
  // Pot
  // ------------------------------------------------------------------

  setPotParam<K extends keyof PotParams>(key: K, value: PotParams[K]): void {
    this.potParams = clampPot({ ...this.potParams, [key]: value });
    this.schedulePot();
    this.emit();
    this.persistSoon();
  }

  setPotStyle(style: PotParams['style']): void {
    this.potParams = clampPot({ ...this.potParams, style });
    this.schedulePot();
    this.emit();
    this.persistSoon();
  }

  private schedulePot(delay = 90): void {
    if (this.potPendingTimer !== null) clearTimeout(this.potPendingTimer);
    this.potPendingTimer = window.setTimeout(() => {
      this.potPendingTimer = null;
      this.requestPot();
    }, delay);
  }

  /** Rebuild the pot off the main thread, feeding it the current tree mass. */
  requestPot(delayOverride?: number): void {
    void delayOverride;
    const t0 = performance.now();
    const wood = this.viewer.rig.woodMass(WOOD_DENSITY);
    const leafMass = this.leaves.leaves.length * LEAF_GRAM;
    const treeMass = wood.mass + leafMass;
    const treeComLocal: [number, number, number] = [0, 0, 0];
    if (treeMass > 0) {
      treeComLocal[0] = (wood.com.x * wood.mass) / treeMass;
      treeComLocal[1] = (wood.com.y * wood.mass + this.leafComY() * leafMass) / treeMass;
      treeComLocal[2] = (wood.com.z * wood.mass) / treeMass;
    }
    const req: PotRequest = {
      id: ++this.potRequestId,
      params: this.potParams,
      treeMass,
      treeCom: treeComLocal,
      treeBaseY: this.viewer.soilY,
      balanceGain: this.potParams.balanceGain,
    };
    this.potBusy = true;
    this.worker.postMessage(req);
    this.perf = { ...this.perf, potMs: performance.now() - t0 };
  }

  private leafComY(): number {
    if (!this.leaves.leaves.length) return 0;
    let y = 0;
    for (const leaf of this.leaves.leaves) y += leaf.offset[1];
    return y / this.leaves.leaves.length;
  }

  private onPotResult(res: PotResponse): void {
    if (res.id < this.potRequestId) return;
    this.potBusy = false;
    this.potFallback = res.fallback;
    const hadPot = this.potResult !== null;
    this.potResult = {
      id: res.id,
      params: res.params,
      balance: res.balance,
      mass: res.mass,
      mesh: res.mesh,
      cavity: res.cavity,
      support: res.support,
      volume: res.volume,
      com: res.com,
      buildMs: res.buildMs,
    };
    this.viewer.setPot(this.potResult);
    if (!hadPot) this.viewer.frameAll();
    this.recomputeBalance();
    this.perf = { ...this.perf, potMs: res.buildMs };
    this.emit();
  }

  // ------------------------------------------------------------------
  // Persistence / export / import
  // ------------------------------------------------------------------

  private persistSoon(): void {
    if (!this.store.supported) return;
    const state: SavedState = {
      tree: this.tree,
      shape: this.shape,
      foliage: this.foliageParams,
      pot: this.potParams,
      savedAt: new Date().toISOString(),
    };
    this.store.save(state);
  }

  flushPersist(): void {
    this.store.flush();
  }

  buildProject(): Project {
    return buildProject({
      tree: this.tree,
      shape: this.shape,
      foliage: this.foliageParams,
      pot: this.potParams,
      skeleton: this.skeleton,
      leaves: this.leaves.leaves,
      leavesByDepth: leafCountByDepth(this.leaves.leaves),
      potResult: this.potResult,
      balance: this.balance,
      camera: this.viewer.getCameraState(),
    });
  }

  exportFile(): Project {
    const project = this.buildProject();
    downloadProject(project);
    return project;
  }

  async importFile(file: File): Promise<void> {
    const text = await file.text();
    this.importText(text);
  }

  importText(text: string): void {
    let loaded;
    try {
      loaded = parseProject(text);
    } catch (err) {
      if (err instanceof ProjectFormatError) {
        this.lastError = err.message;
        this.emit();
        throw err;
      }
      throw err;
    }
    this.tree = loaded.tree;
    this.foliageParams = clampFoliage(loaded.foliage);
    this.potParams = clampPot(loaded.pot);
    this.skeleton = buildSkeleton(this.tree);
    const rig = new TreeRig(this.skeleton);
    rig.setShape(loaded.shape);
    this.viewer.setRig(rig);
    this.selectedControl = null;
    this.shape = rig.getShape();
    this.viewer.rebuildTree();
    this.leaves = generateFoliage(this.skeleton, rig, this.foliageParams);
    this.viewer.setFoliage(this.leaves, this.foliageParams);
    this.foliageSig = this.foliageSignature();
    this.recomputeBalance();
    if (loaded.camera) this.viewer.setCameraState(loaded.camera.position, loaded.camera.target);
    this.requestPot();
    this.emit();
    this.persistSoon();
  }

  resetAll(): void {
    this.viewer.rig.resetShape();
    this.tree = { ...DEFAULT_TREE };
    this.foliageParams = clampFoliage({ ...DEFAULT_FOLIAGE });
    this.potParams = clampPot({ ...DEFAULT_POT });
    this.skeleton = buildSkeleton(this.tree);
    const rig = new TreeRig(this.skeleton);
    this.viewer.setRig(rig);
    this.selectedControl = null;
    this.shape = rig.getShape();
    this.viewer.rebuildTree();
    this.leaves = generateFoliage(this.skeleton, rig, this.foliageParams);
    this.viewer.setFoliage(this.leaves, this.foliageParams);
    this.foliageSig = this.foliageSignature();
    this.recomputeBalance();
    this.viewer.frameAll();
    this.requestPot();
    this.emit();
    this.persistSoon();
  }

  resetSelected(): void {
    const node = this.selectedControl;
    if (node === null) return;
    this.viewer.rig.resetNode(node);
    this.afterShapeEdit();
  }

  // ------------------------------------------------------------------
  // Misc
  // ------------------------------------------------------------------

  frameAll(): void {
    this.viewer.frameAll();
  }

  potStyles(): typeof STYLES {
    return STYLES;
  }

  limbLabel(limbId: number): string {
    const limb = this.skeleton.limbs[limbId];
    if (!limb) return '—';
    return `${limbKindLabel(limb.kind)} #${limbId}`;
  }

  dispose(): void {
    this.worker.terminate();
    this.store.flush();
    this.viewer.dispose();
  }

  // Small helpers used by panels that would otherwise reach into core modules.
  static readonly WOOD_DENSITY = WOOD_DENSITY;
  static readonly LEAF_GRAM = LEAF_GRAM;
}
