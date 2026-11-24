import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  InstancedBufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MassBalance, PotResult, Skeleton, V3 } from '../core/types';
import { TreeRig } from '../core/pose';
import { buildTubeGeometry } from './tube';
import { LeafLayer } from './leafLayer';

export type ViewerMode = 'shape' | 'prune' | 'inspect';

export interface PointerHit {
  kind: 'control' | 'limb';
  node?: number;
  limb?: number;
}

export interface ViewerCallbacks {
  onControlDragStart?(node: number): void;
  onControlDrag?(node: number, event: { shift: boolean }): void;
  onControlDragEnd?(node: number): void;
  onHoverChange?(hit: PointerHit | null, screen: { x: number; y: number } | null): void;
  onLimbClick?(limb: number): void;
  onLimbHover?(limb: number | null): void;
}

const HANDLE_CAPACITY = 128;

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;

  private container: HTMLElement;
  private callbacks: ViewerCallbacks = {};
  /** Holds the wood, leaves, handles and rings so the whole tree can sit on the soil. */
  private treeGroup = new Group();
  private treeY = 0;

  rig: TreeRig;

  /** Swap in a freshly generated skeleton (new seed / imported file). */
  setRig(rig: TreeRig): void {
    this.rig = rig;
    this.selectedControl = null;
    this.hoverNode = null;
    this.rebuildTree();
  }

  private tubeMesh: Mesh;
  private tubeMaterial: MeshStandardMaterial;
  readonly leaves: LeafLayer;
  private potMesh: Mesh;
  private potMaterial: MeshPhysicalMaterial;
  private soilDisc: Mesh;

  private handleMesh: InstancedMesh;
  private handleColors: Float32Array;
  private handleIds: number[] = [];
  private handleMaterial: MeshStandardMaterial;
  private twistRing: Mesh;

  private comGroup = new Group();
  private comBall!: Mesh;
  private comLine!: Line;
  private comGround!: Mesh;
  private supportLine!: Line;
  private supportHull: Vector3[] = [];

  private raycastTargets: Mesh[] = [];
  private raycaster = new Raycaster();
  private pointer = new Vector2();

  private dragging: {
    node: number;
    twistMode: boolean;
    lastX: number;
    twist: number;
  } | null = null;
  private hoverNode: number | null = null;
  private selectedControl: number | null = null;
  private mode: ViewerMode = 'shape';
  private highlightedLimb: number | null = null;
  private limbTriangleStarts: Uint32Array = new Uint32Array(0);
  private limbTriangleLimb: Uint16Array = new Uint16Array(0);

  private raf = 0;
  private needsRender = true;
  private balance: MassBalance | null = null;
  private groundY = 0;
  private labelHost: HTMLElement;
  private labels = new Map<string, HTMLElement>();
  private boundsCenter = new Vector3(0, 22, 0);
  private boundsRadius = 55;

  // Reusable temporaries — the drag path runs every frame and must stay allocation-light.
  private tA = new Vector3();
  private tB = new Vector3();
  private tC = new Vector3();
  private tPlane = new Vector3();
  private tQuatA = new Vector3();

  constructor(container: HTMLElement, skel: Skeleton) {
    this.container = container;
    this.labelHost = document.createElement('div');
    this.labelHost.className = 'label-layer';
    container.appendChild(this.labelHost);

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.className = 'viewport-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x11161b);

    this.camera = new PerspectiveCamera(34, 1, 0.5, 3000);
    this.camera.position.set(74, 54, 92);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 24, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 24;
    this.controls.maxDistance = 460;
    this.controls.maxPolarAngle = Math.PI * 0.497;
    this.controls.update();
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
      this.leaves.markNeedsSort();
    });

    this.addLights();

    const table = new Mesh(
      new PlaneGeometry(3000, 3000),
      new MeshStandardMaterial({ color: 0x181d21, roughness: 0.96 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.05;
    table.receiveShadow = true;
    this.scene.add(table);

    this.potMaterial = new MeshPhysicalMaterial({
      color: 0x6d4436,
      roughness: 0.78,
      metalness: 0.02,
      clearcoat: 0.14,
      clearcoatRoughness: 0.62,
      side: DoubleSide,
    });
    this.potMesh = new Mesh(new BufferGeometry(), this.potMaterial);
    this.potMesh.castShadow = true;
    this.potMesh.receiveShadow = true;
    this.potMesh.name = 'pot';
    this.scene.add(this.potMesh);

    this.soilDisc = new Mesh(
      new BufferGeometry(),
      new MeshStandardMaterial({ color: 0x5b4430, roughness: 0.98, metalness: 0 }),
    );
    this.soilDisc.receiveShadow = true;
    this.soilDisc.visible = false;
    this.scene.add(this.soilDisc);

    this.scene.add(this.treeGroup);
    this.rig = new TreeRig(skel);
    this.tubeMaterial = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02,
      emissive: new Color(0x000000),
    });
    this.tubeMesh = new Mesh(new BufferGeometry(), this.tubeMaterial);
    this.tubeMesh.castShadow = true;
    this.tubeMesh.receiveShadow = true;
    this.tubeMesh.name = 'wood';
    this.treeGroup.add(this.tubeMesh);

    this.leaves = new LeafLayer(4200);
    this.treeGroup.add(this.leaves.mesh);

    this.handleMaterial = new MeshStandardMaterial({
      roughness: 0.32,
      metalness: 0.15,
      emissive: new Color(0x1a2a38),
      emissiveIntensity: 1,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    this.handleMesh = new InstancedMesh(new SphereGeometry(1, 16, 12), this.handleMaterial, HANDLE_CAPACITY);
    this.handleMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.handleColors = new Float32Array(HANDLE_CAPACITY * 3);
    this.handleMesh.instanceColor = new InstancedBufferAttribute(this.handleColors, 3);
    this.handleMesh.count = 0;
    this.handleMesh.frustumCulled = false;
    this.handleMesh.renderOrder = 6;
    this.handleMesh.name = 'handles';
    this.treeGroup.add(this.handleMesh);

    this.twistRing = new Mesh(
      new RingGeometry(0.82, 1, 64),
      new MeshBasicMaterial({ color: 0x8ee0ff, transparent: true, opacity: 0.85, side: DoubleSide, depthTest: false }),
    );
    this.twistRing.visible = false;
    this.twistRing.renderOrder = 24;
    this.treeGroup.add(this.twistRing);

    this.buildComIndicator();

    this.raycastTargets = [this.handleMesh, this.tubeMesh];
    this.attachPointer();
    this.resize();
    this.rebuildTree();
    this.startLoop();
  }

  setCallbacks(cb: ViewerCallbacks): void {
    this.callbacks = cb;
  }

  private keyLight!: DirectionalLight;

  private addLights(): void {
    this.scene.add(new HemisphereLight(0xdce8f4, 0x2a2b26, 1.25));
    const key = new DirectionalLight(0xfff0dc, 2.3);
    key.position.set(62, 104, 48);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 380;
    key.shadow.camera.left = -110;
    key.shadow.camera.right = 110;
    key.shadow.camera.top = 130;
    key.shadow.camera.bottom = -60;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.04;
    this.scene.add(key);
    this.keyLight = key;
    const rim = new DirectionalLight(0x9fc6ea, 0.9);
    rim.position.set(-80, 52, -70);
    this.scene.add(rim);
    // A soft camera-side fill keeps bark readable when orbiting into the shadow side.
    const fill = new DirectionalLight(0xffe9d2, 0.75);
    fill.position.set(38, 34, 96);
    this.scene.add(fill);
    this.scene.add(new AmbientLight(0x4b545c, 0.85));
  }

  private buildComIndicator(): void {
    this.comBall = new Mesh(
      new SphereGeometry(1.05, 22, 16),
      new MeshBasicMaterial({ color: 0xffb545, depthTest: false, transparent: true, opacity: 0.96 }),
    );
    this.comBall.renderOrder = 30;
    this.comGroup.add(this.comBall);

    this.comLine = new Line(
      new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, -1, 0)]),
      new LineBasicMaterial({ color: 0xffb545, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.comLine.renderOrder = 29;
    this.comGroup.add(this.comLine);

    this.comGround = new Mesh(
      new RingGeometry(0.75, 1.5, 36),
      new MeshBasicMaterial({ color: 0xffb545, depthTest: false, transparent: true, opacity: 0.9, side: DoubleSide }),
    );
    this.comGround.rotation.x = -Math.PI / 2;
    this.comGround.renderOrder = 29;
    this.comGroup.add(this.comGround);

    this.supportLine = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0x7fe3a9, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.supportLine.renderOrder = 28;
    this.supportLine.visible = false;
    this.comGroup.add(this.supportLine);

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 72;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(14,19,23,0.88)';
    ctx.beginPath();
    ctx.roundRect(6, 12, 148, 48, 12);
    ctx.fill();
    ctx.strokeStyle = '#ffb545';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#ffd48f';
    ctx.font = '600 28px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('重心', 80, 37);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(3.6, 1.63, 1);
    sprite.position.set(0, 2.1, 0);
    sprite.renderOrder = 31;
    this.comBall.add(sprite);

    this.comGroup.visible = false;
    this.scene.add(this.comGroup);
  }

  // ------------------------------------------------------------------
  // Tree / pose updates
  // ------------------------------------------------------------------

  /** Re-sweeps the wood tube and rebuilds handle + twist ring placement. */
  rebuildTree(): void {
    const data = buildTubeGeometry(this.rig.skel, this.rig);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new BufferAttribute(data.colors, 3));
    geo.setIndex(new BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();

    // Per-triangle limb ids for prune picking.
    const triCount = data.indices.length / 3;
    this.limbTriangleLimb = new Uint16Array(triCount);
    for (let t = 0; t < triCount; t++) {
      this.limbTriangleLimb[t] = data.limbOfVertex[data.indices[t * 3]];
    }

    this.tubeMesh.geometry.dispose();
    this.tubeMesh.geometry = geo;
    this.boundsCenter.copy(data.min).add(data.max).multiplyScalar(0.5);
    this.boundsRadius = Math.max(14, data.max.distanceTo(data.min) * 0.5);
    if (this.highlightedLimb !== null) this.rebuildHighlightOverlay(this.highlightedLimb);
    this.updateHandles();
    this.updateTwistRing();
    this.needsRender = true;
  }

  /** Poses have already been applied; refresh every dependent drawable. */
  updatePose(): void {
    this.rig.evaluate();
    this.rebuildTree();
    this.leaves.markDirty();
    this.needsRender = true;
  }

  setFoliage(data: Parameters<LeafLayer['setFoliage']>[0], params: Parameters<LeafLayer['setFoliage']>[2]): void {
    this.leaves.setFoliage(data, this.rig, params);
    this.needsRender = true;
  }

  refreshLeafParams(params: Parameters<LeafLayer['setFoliage']>[2]): void {
    this.leaves.applyParams(params);
    this.needsRender = true;
  }

  setPot(result: PotResult | null): void {
    if (!result || !result.mesh.positions.length) return;
    const soilY = result.params.height - Math.max(0.5, result.params.wall * 0.55);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(result.mesh.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(result.mesh.normals, 3));
    geo.setIndex(new BufferAttribute(result.mesh.indices, 1));
    geo.computeBoundingSphere();
    this.potMesh.geometry.dispose();
    this.potMesh.geometry = geo;
    this.potMaterial.color.setHex(potColor(result.params.style));
    this.treeY = soilY;
    this.treeGroup.position.y = soilY;
    this.buildSoil(result);
    this.soilDisc.visible = true;
    this.supportHull = result.support.map(([x, z]) => new Vector3(x, 0, z));
    this.updateSupportLine();
    this.needsRender = true;
  }

  /**
   * Soil surface: a filled disc that follows the pot's own inner cavity outline, inset a
   * hair so it tucks under the rim. Using the analytic cavity (not the triangle soup) keeps
   * it correct for every style, including square and hexagonal pots.
   */
  private buildSoil(result: PotResult): void {
    const p = result.params;
    const cavity = result.cavity && result.cavity.length >= 8 ? result.cavity : null;
    const segs = cavity ? cavity.length : 96;
    const outline: [number, number][] = [];
    for (let i = 0; i < segs; i++) {
      if (cavity) {
        const [x, z] = cavity[i];
        outline.push([x * 0.985, z * 0.985]);
      } else {
        const a = (i / segs) * Math.PI * 2;
        const r = (p.topRadius - p.wall) * 0.985;
        outline.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    }
    const soilY = this.treeY;
    const rings = 6;
    const verts: number[] = [];
    const idx: number[] = [];
    // Centre vertex, then concentric rings scaled from the outline, with a slight dome.
    verts.push(0, soilY - 0.9 + Math.min(0.28, p.topRadius * 0.022), 0);
    for (let k = 1; k <= rings; k++) {
      const t = k / rings;
      const dome = (1 - t * t) * Math.min(0.28, p.topRadius * 0.022);
      for (let i = 0; i < segs; i++) {
        const [x, z] = outline[i];
        verts.push(x * t, soilY - 0.9 + dome, z * t);
      }
    }
    const ringBase = (k: number, i: number): number => (k === 0 ? 0 : 1 + (k - 1) * segs + i);
    for (let i = 0; i < segs; i++) {
      const i2 = (i + 1) % segs;
      idx.push(0, ringBase(1, i2), ringBase(1, i));
    }
    for (let k = 1; k < rings; k++) {
      for (let i = 0; i < segs; i++) {
        const i2 = (i + 1) % segs;
        const a0 = ringBase(k, i);
        const a1 = ringBase(k, i2);
        const b0 = ringBase(k + 1, i);
        const b1 = ringBase(k + 1, i2);
        idx.push(a0, a1, b0, a1, b1, b0);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.soilDisc.geometry.dispose();
    this.soilDisc.geometry = geo;
  }

  /** Height of the soil surface (== tree root height in world space). */
  get soilY(): number {
    return this.treeY;
  }

  // ------------------------------------------------------------------
  // Handles
  // ------------------------------------------------------------------

  private updateHandles(): void {
    const skel = this.rig.skel;
    const p = this.tB;
    const show = this.mode === 'shape';
    this.handleMesh.visible = show;
    this.handleIds = [];
    if (!show) {
      this.handleMesh.count = 0;
      return;
    }
    const m = this.handleMesh.instanceMatrix.array as Float32Array;
    let i = 0;
    for (const id of skel.controls) {
      if (!this.rig.visible[id]) continue;
      if (i >= HANDLE_CAPACITY) break;
      this.rig.handlePos(id, p);
      const selected = id === this.selectedControl;
      const hovered = id === this.hoverNode;
      const scale = selected ? 0.6 : hovered ? 0.5 : 0.33;
      const off = i * 16;
      m[off] = scale; m[off + 1] = 0; m[off + 2] = 0; m[off + 3] = 0;
      m[off + 4] = 0; m[off + 5] = scale; m[off + 6] = 0; m[off + 7] = 0;
      m[off + 8] = 0; m[off + 9] = 0; m[off + 10] = scale; m[off + 11] = 0;
      m[off + 12] = p.x; m[off + 13] = p.y; m[off + 14] = p.z; m[off + 15] = 1;

      const bent = this.rig.bendAmount(id) > 1.5;
      const twisted = Math.abs(this.rig.twistAmount(id)) >= 1;
      let cr = 0.84, cg = 0.91, cb = 1.0;
      if (twisted) { cr = 1.0; cg = 0.76; cb = 0.4; }
      else if (bent) { cr = 0.55; cg = 0.92; cb = 0.76; }
      if (selected) { cr = 0.36; cg = 0.86; cb = 1.0; }
      this.handleColors[i * 3] = cr;
      this.handleColors[i * 3 + 1] = cg;
      this.handleColors[i * 3 + 2] = cb;
      this.handleIds.push(id);
      i++;
    }
    this.handleMesh.count = i;
    this.handleMesh.instanceMatrix.needsUpdate = true;
    if (this.handleMesh.instanceColor) this.handleMesh.instanceColor.needsUpdate = true;
  }

  private updateTwistRing(): void {
    const id = this.selectedControl;
    if (id === null || this.mode !== 'shape' || !this.rig.visible[id]) {
      this.twistRing.visible = false;
      return;
    }
    const p = this.rig.nodePos(id, this.tA);
    const q = this.rig.nodeQuat(id);
    const normal = this.tQuatA.set(0, 0, 1).applyQuaternion(q);
    const radius = Math.max(1.5, this.rig.skel.nodes[id].radius * 1.85);
    this.twistRing.position.copy(p);
    this.twistRing.quaternion.copy(q);
    this.twistRing.scale.setScalar(radius);
    this.twistRing.visible = true;
    void normal;
  }

  setSelectedControl(node: number | null): void {
    this.selectedControl = node;
    this.updateHandles();
    this.updateTwistRing();
    this.needsRender = true;
  }

  setMode(mode: ViewerMode): void {
    this.mode = mode;
    if (this.mode !== 'shape') this.hoverNode = null;
    this.updateHandles();
    this.updateTwistRing();
    this.setLimbHighlight(null);
    // Inspect mode turns the whole composition into a balance diagram: the support
    // footprint, plumb line and COM get bigger and the handles step out of the way.
    const inspect = mode === 'inspect';
    this.comBall.scale.setScalar(inspect ? 1.5 : 1);
    this.comGround.scale.setScalar(inspect ? 1.5 : 1);
    this.leaves.setInspectFade(inspect);
    this.needsRender = true;
  }

  getMode(): ViewerMode {
    return this.mode;
  }

  /**
   * Shows which limb the cursor is over. An overlay mesh re-uses the tube geometry but keeps
   * only the triangles of the hovered limb, which reads far more clearly than tinting every
   * branch at once.
   */
  private setLimbHighlight(limb: number | null): void {
    if (this.highlightedLimb === limb) return;
    this.highlightedLimb = limb;
    if (limb !== null && limb > 0) {
      const nodes = this.rig.skel.limbs[limb].nodes;
      this.highlightedLimbRadius = Math.max(0.4, this.rig.skel.nodes[nodes[0]].radius);
    }
    if (this.highlightOverlay) {
      this.highlightOverlay.visible = false;
    }
    if (limb !== null && limb > 0) {
      if (!this.highlightOverlay) {
        const mat = new MeshBasicMaterial({
          color: 0xffa03a,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          // Expand the overlay a hair along its normals so it is never hidden by the
          // branch it is drawing over.
          side: DoubleSide,
        });
        this.highlightOverlay = new Mesh(new BufferGeometry(), mat);
        // A frame-sized scale would distort geometry; use polygon offset instead.
        this.highlightOverlay.renderOrder = 5;
        this.treeGroup.add(this.highlightOverlay);
      }
      this.rebuildHighlightOverlay(limb);
    }
    this.needsRender = true;
  }

  private highlightOverlay: Mesh | null = null;

  private rebuildHighlightOverlay(limb: number): void {
    if (!this.highlightOverlay) return;
    const src = this.tubeMesh.geometry;
    const pos = src.getAttribute('position') as BufferAttribute;
    const normals = src.getAttribute('normal') as BufferAttribute | undefined;
    const index = src.getIndex();
    if (!index) return;
    // Highlight the whole subtree: pruning removes descendants too, so the preview has to
    // show exactly what would disappear.
    const affected = new Set<number>([limb]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of this.rig.skel.limbs) {
        if (l.parentLimb >= 0 && affected.has(l.parentLimb) && !affected.has(l.id)) {
          affected.add(l.id);
          grew = true;
        }
      }
    }
    const idx: number[] = [];
    const tri = index.array;
    for (let t = 0; t < tri.length; t += 3) {
      if (affected.has(this.limbTriangleLimb[t / 3])) idx.push(tri[t], tri[t + 1], tri[t + 2]);
    }
    if (!idx.length) {
      this.highlightOverlay.visible = false;
      return;
    }
    // Push the overlay out along the vertex normals so it sits just proud of the bark.
    const grown = new Float32Array(pos.array.length);
    const lift = 0.035 + this.highlightedLimbRadius * 0.02;
    for (let i = 0; i < pos.count; i++) {
      const nx = normals ? normals.getX(i) : 0;
      const ny = normals ? normals.getY(i) : 1;
      const nz = normals ? normals.getZ(i) : 0;
      grown[i * 3] = pos.getX(i) + nx * lift;
      grown[i * 3 + 1] = pos.getY(i) + ny * lift;
      grown[i * 3 + 2] = pos.getZ(i) + nz * lift;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(grown, 3));
    geo.setIndex(idx);
    this.highlightOverlay.geometry.dispose();
    this.highlightOverlay.geometry = geo;
    this.highlightOverlay.visible = true;
  }

  private highlightedLimbRadius = 1;

  // ------------------------------------------------------------------
  // Balance
  // ------------------------------------------------------------------

  private updateSupportLine(): void {
    const pts: Vector3[] = [];
    if (this.supportHull.length >= 3) {
      for (const p of this.supportHull) pts.push(p.clone());
      pts.push(this.supportHull[0].clone());
    }
    this.supportLine.geometry.dispose();
    this.supportLine.geometry = new BufferGeometry().setFromPoints(pts);
    this.supportLine.position.y = 0.04;
    this.supportLine.visible = pts.length > 2;
    // A translucent fill makes the footprint read at a glance in inspect mode.
    const fill = this.supportFill;
    const shapePts: number[] = [];
    if (this.supportHull.length >= 3) {
      for (let i = 0; i < this.supportHull.length; i++) {
        const a = this.supportHull[i];
        const b = this.supportHull[(i + 1) % this.supportHull.length];
        shapePts.push(0, 0, 0, a.x, 0, a.z, b.x, 0, b.z);
      }
    }
    if (!this.supportFill) {
      const mesh = new Mesh(
        new BufferGeometry(),
        new MeshBasicMaterial({ color: 0x7fe3a9, transparent: true, opacity: 0.12, depthWrite: false, side: DoubleSide }),
      );
      mesh.renderOrder = 27;
      this.comGroup.add(mesh);
      this.supportFill = mesh;
    }
    const fillMesh = this.supportFill;
    fillMesh.geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(shapePts), 3));
    fillMesh.geometry = g;
    fillMesh.position.y = 0.05;
    fillMesh.visible = shapePts.length > 0;
  }

  private supportFill: Mesh | null = null;

  setBalance(balance: MassBalance | null): void {
    this.balance = balance;
    if (!balance) {
      this.comGroup.visible = false;
      this.needsRender = true;
      return;
    }
    this.comGroup.visible = true;
    const [x, y, z] = balance.totalCom;
    if (this.supportFill) this.supportFill.visible = this.supportHull.length >= 3;
    this.comBall.position.set(x, y, z);
    const attr = this.comLine.geometry.getAttribute('position') as BufferAttribute;
    attr.setXYZ(0, x, y, z);
    // Drop the plumb line all the way to the table, so it crosses the pot's support
    // polygon and shows at a glance whether the projection lands inside the footprint.
    attr.setXYZ(1, x, 0.05, z);
    attr.needsUpdate = true;
    this.comLine.geometry.computeBoundingSphere();
    this.comGround.position.set(x, 0.07, z);
    this.supportLine.position.y = this.groundY + 0.04;
    const color = balance.status === 'unstable' ? 0xff6a5a : balance.status === 'marginal' ? 0xffc24d : 0xffb545;
    (this.comBall.material as MeshBasicMaterial).color.setHex(color);
    (this.comLine.material as LineBasicMaterial).color.setHex(color);
    (this.comGround.material as MeshBasicMaterial).color.setHex(color);
    (this.supportLine.material as LineBasicMaterial).color.setHex(balance.status === 'stable' ? 0x7fe3a9 : 0xff8a6a);
    this.needsRender = true;
  }

  // ------------------------------------------------------------------
  // Interaction
  // ------------------------------------------------------------------

  private attachPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    el.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    el.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    el.addEventListener('pointercancel', (e) => this.handlePointerUp(e));
    el.addEventListener('pointerleave', () => {
      if (this.hoverNode !== null) {
        this.hoverNode = null;
        this.updateHandles();
        this.callbacks.onHoverChange?.(null, null);
        this.needsRender = true;
      }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', () => this.leaves.markNeedsSort(), { passive: true });
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  private pickHandle(): number | null {
    if (this.mode !== 'shape' || !this.handleMesh.visible || this.handleMesh.count === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.handleMesh, false);
    if (!hits.length) return null;
    const idx = hits[0].instanceId;
    if (idx === undefined || idx === null) return null;
    return this.handleIds[idx] ?? null;
  }

  private pickLimb(screenPoint?: { x: number; y: number }): number | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.tubeMesh, false);
    if (!hits.length) return null;
    const face = hits[0].faceIndex;
    if (face === undefined || face === null || face >= this.limbTriangleLimb.length) return null;
    const limb = this.limbTriangleLimb[face];
    void screenPoint;
    return limb > 0 ? limb : null;
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.setPointer(e);
    if (this.mode === 'shape') {
      const node = this.pickHandle();
      if (node === null) return;
      this.dragging = {
        node,
        twistMode: e.shiftKey,
        lastX: e.clientX,
        twist: this.rig.twistAmount(node),
      };
      this.selectedControl = node;
      this.updateHandles();
      this.updateTwistRing();
      this.controls.enabled = false;
      try {
        this.renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety; the drag still works without it */
      }
      this.callbacks.onControlDragStart?.(node);
      return;
    }
    if (this.mode === 'prune') {
      const limb = this.pickLimb();
      if (limb !== null) this.callbacks.onLimbClick?.(limb);
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    this.setPointer(e);
    if (this.dragging) {
      const drag = this.dragging;
      if (drag.twistMode || e.shiftKey) {
        if (!drag.twistMode) {
          // Shift pressed mid-drag: switch to twist without restarting the gesture.
          drag.twistMode = true;
          drag.twist = this.rig.twistAmount(drag.node);
          drag.lastX = e.clientX;
        } else {
          drag.twist += (e.clientX - drag.lastX) * 0.9;
          drag.lastX = e.clientX;
          this.rig.setTwist(drag.node, drag.twist);
          this.rebuildTree();
          this.leaves.markDirty();
        }
        this.callbacks.onControlDrag?.(drag.node, { shift: true });
        this.needsRender = true;
        return;
      }
      this.dragToPointer(drag.node);
      this.callbacks.onControlDrag?.(drag.node, { shift: false });
      this.needsRender = true;
      return;
    }

    if (this.mode === 'shape') {
      const node = this.pickHandle();
      if (node !== this.hoverNode) {
        this.hoverNode = node;
        this.updateHandles();
        this.renderer.domElement.style.cursor = node !== null ? 'grab' : 'default';
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.callbacks.onHoverChange?.(
          node !== null ? { kind: 'control', node } : null,
          node !== null ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null,
        );
        this.needsRender = true;
      }
    } else if (this.mode === 'prune') {
      const limb = this.pickLimb();
      this.setLimbHighlight(limb);
      this.renderer.domElement.style.cursor = limb !== null ? 'pointer' : 'default';
      this.callbacks.onLimbHover?.(limb);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    const node = this.dragging.node;
    this.dragging = null;
    this.controls.enabled = true;
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    this.callbacks.onControlDragEnd?.(node);
  }

  /**
   * Slide the cursor on a camera-facing plane through the joint and rotate the joint's
   * bone toward it. Bone length is preserved, so the branch swings instead of stretching.
   */
  private dragToPointer(node: number): void {
    const pivot = this.rig.nodePos(node, this.tA);
    this.camera.getWorldDirection(this.tPlane);
    const planeNormal = this.tPlane.clone().negate();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ray = this.raycaster.ray;
    const denom = ray.direction.dot(planeNormal);
    if (Math.abs(denom) < 1e-5) return;
    const t = this.tB.copy(pivot).sub(ray.origin).dot(planeNormal) / denom;
    if (t <= 0) return;
    const target = this.tC.copy(ray.origin).addScaledVector(ray.direction, t);
    this.rig.dragBend(node, target);
    this.rebuildTree();
    this.leaves.markDirty();
  }

  // ------------------------------------------------------------------
  // Camera + loop
  // ------------------------------------------------------------------

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  frameAll(): void {
    // Frame the composition (tree + pot) using its bounding sphere.
    let minY = this.boundsCenter.y - this.boundsRadius + this.treeY;
    let maxY = this.boundsCenter.y + this.boundsRadius + this.treeY;
    let radius = this.boundsRadius;
    const potGeo = this.potMesh.geometry.attributes.position;
    if (potGeo && potGeo.count > 0) {
      this.potMesh.geometry.computeBoundingSphere();
      const bs = this.potMesh.geometry.boundingSphere;
      if (bs) {
        minY = Math.min(minY, bs.center.y - bs.radius);
        maxY = Math.max(maxY, bs.center.y + bs.radius);
        radius = Math.max(radius, Math.hypot(bs.radius, (bs.center.y - minY)));
      }
    }
    const center = this.tA.set(this.boundsCenter.x, (minY + maxY) * 0.5, this.boundsCenter.z);
    if (!Number.isFinite(center.y)) center.set(0, this.treeY + 20, 0);
    const halfHeight = Math.max(6, (maxY - minY) * 0.5);
    radius = Math.max(radius, halfHeight, Math.hypot(this.boundsCenter.x, this.boundsCenter.z) * 0.5 + 6);
    const halfFov = (this.camera.fov * Math.PI) / 360;
    const dist = (radius / Math.sin(halfFov)) * 0.92;
    const dir = new Vector3(0.62, 0.3, 0.72).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.2, dist * 0.01);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.leaves.markNeedsSort();
    this.needsRender = true;
  }

  setCameraState(position: V3, target: V3): void {
    this.camera.position.set(position[0], position[1], position[2]);
    this.controls.target.set(target[0], target[1], target[2]);
    this.controls.update();
    this.leaves.markNeedsSort();
    this.needsRender = true;
  }

  getCameraState(): { position: V3; target: V3 } {
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
    };
  }

  /** Screen-space anchor of a control handle (world space, includes the soil offset). */
  handleScreen(node: number): { x: number; y: number } | null {
    const p = this.rig.handlePos(node, this.tA);
    p.y += this.treeY;
    p.project(this.camera);
    if (p.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height };
  }

  requestRender(): void {
    this.needsRender = true;
  }

  private startLoop(): void {
    const tick = (): void => {
      this.raf = requestAnimationFrame(tick);
      this.controls.update();
      // A repaint is due when geometry changed, or the camera moved and the leaf order
      // needs re-sorting. Both flags are cleared once they are spent.
      const camMoved = this.leaves.needsSortFlag;
      this.leaves.update(this.camera.position);
      if (this.needsRender || camMoved) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  get stats(): { leaves: number; handles: number; highlighted: number | null } {
    return { leaves: this.leaves.count, handles: this.handleMesh.count, highlighted: this.highlightedLimb };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.leaves.dispose();
    this.tubeMesh.geometry.dispose();
    (this.tubeMesh.material as Material).dispose();
    this.potMesh.geometry.dispose();
    this.potMaterial.dispose();
    this.handleMesh.geometry.dispose();
    this.handleMaterial.dispose();
    this.renderer.dispose();
  }
}

function potColor(style: string): number {
  switch (style) {
    case 'round': return 0x6d4436;
    case 'square': return 0x4c5356;
    case 'oval': return 0x7b5340;
    case 'hex': return 0x5a4658;
    case 'lotus': return 0x6c4d37;
    default: return 0x6b4a3a;
  }
}
