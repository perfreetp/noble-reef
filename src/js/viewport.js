/**
 * Three.js viewport.
 *
 * Renders worker-produced chunks (world-space baked geometry) and provides
 * picking, layout dragging, snapping, selection highlights and a transform
 * gizmo driven by invisible proxy objects (so the baked meshes never get
 * double-transformed).
 *
 * The viewport owns no document state; it reports intent via callbacks.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const DRAG_THRESHOLD = 4;

export class Viewport {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.settings = { snapEnabled: true, snapStep: 0.1, edgeSnap: true };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101316);
    this.scene.fog = new THREE.Fog(0x101316, 55, 130);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 220);
    this.camera.position.set(12, 10, 14);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.maxPolarAngle = Math.PI * 0.494;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 90;
    this.controls.target.set(0, 0.8, 0);
    this.controls.zoomSpeed = 0.85;
    this.controls.addEventListener('start', () => {
      if (this.cb.onCameraStart) this.cb.onCameraStart();
    });

    this._buildScene();

    this.chunkGroup = new THREE.Group();
    this.collisionGroup = new THREE.Group();
    this.collisionGroup.visible = false;
    this.ghostGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();
    this.scene.add(this.chunkGroup, this.collisionGroup, this.ghostGroup, this.overlayGroup);

    this.chunks = new Map(); // chunkId -> { mesh, edges, payload, colorForBand }
    this.overlayMeshes = new Map();
    this.proxy = new THREE.Object3D();
    this.scene.add(this.proxy);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.payload = null;
    this.selectedIds = [];
    this.overlapIds = new Set();
    this.hoverId = null;
    this.placingType = null;
    this.gizmoMode = 'translate';
    this.interaction = null; // { kind: 'drag'|'gizmo', id, ... }
    this.lastPointer = { x: 0, y: 0 };

    this._buildGizmo();
    this._bindEvents();
    this._observeResize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /* --------------------------------------------------------------- scene */

  _buildScene() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envMap = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.5;

    this.scene.add(new THREE.HemisphereLight(0xa8bccf, 0x3a2f22, 0.7));

    const key = new THREE.DirectionalLight(0xfff4e2, 2.35);
    key.position.set(11, 18, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 80;
    key.shadow.camera.left = -26;
    key.shadow.camera.right = 26;
    key.shadow.camera.top = 26;
    key.shadow.camera.bottom = -26;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x87a6cc, 0.75);
    rim.position.set(-12, 8, -14);
    this.scene.add(rim);

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x23272c,
      roughness: 0.94,
      metalness: 0.03,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Faint concrete slab under the build area, so the working plane reads.
    const slab = new THREE.Mesh(
      new THREE.CircleGeometry(26, 72),
      new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.9, metalness: 0.04 }),
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = 0.008;
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.slab = slab;

    // Minor 0.5 m grid, major 1 m grid, plus highlighted ground axes.
    this.grid = new THREE.GridHelper(80, 160, 0x3a434c, 0x2b3238);
    this.grid.position.y = 0.012;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.5;
    this.grid.material.depthWrite = false;
    this.grid.renderOrder = 1;
    this.scene.add(this.grid);

    const gridMajor = new THREE.GridHelper(80, 80, 0x66727f, 0x49525b);
    gridMajor.position.y = 0.018;
    gridMajor.material.transparent = true;
    gridMajor.material.opacity = 0.6;
    gridMajor.material.depthWrite = false;
    gridMajor.renderOrder = 2;
    this.scene.add(gridMajor);
    this.gridMajor = gridMajor;

    const axes = new THREE.Group();
    const axisX = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x8c5a4a, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    axisX.rotation.x = -Math.PI / 2;
    axisX.position.set(0, 0.022, 0);
    const axisZ = new THREE.Mesh(
      new THREE.PlaneGeometry(0.02, 80),
      new THREE.MeshBasicMaterial({ color: 0x4a6c8c, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    axisZ.rotation.x = -Math.PI / 2;
    axisZ.position.set(0, 0.022, 0);
    axes.add(axisX, axisZ);
    this.scene.add(axes);
    this.gridAxes = axes;

    this.solidMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.66,
      metalness: 0.05,
      envMapIntensity: 0.95,
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x0d0f11,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials = {
      select: new THREE.MeshBasicMaterial({
        color: 0xf2bb45,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        // Drawn over the solid so the tint reads on top-down views too.
        depthTest: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      selectEdge: new THREE.LineBasicMaterial({
        color: 0xffd066,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
      overlap: new THREE.MeshBasicMaterial({
        color: 0xe0675a,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      hover: new THREE.MeshBasicMaterial({
        color: 0xdfe6ec,
        transparent: true,
        opacity: 0.085,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    };
  }

  _buildGizmo() {
    this.transform = new TransformControls(this.camera, this.canvas);
    this.transform.enabled = false;
    this.transform.getHelper().visible = false;
    this.transform.setMode('translate');
    this.transform.setSize(0.82);
    this.transform.setSpace('world');
    this.transform.setTranslationSnap(0.1);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(5));
    this.scene.add(this.transform.getHelper());

    this.transform.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) {
        this.interaction = { kind: 'gizmo', id: this.selectedIds[0], mode: this.gizmoMode };
        if (this.gizmoMode === 'translate') {
          this._gizmoStart = this.proxy.position.clone();
        } else if (this.gizmoMode === 'rotate') {
          this._gizmoStartRot = this.proxy.rotation.y;
        } else if (this.gizmoMode === 'scale') {
          this.proxy.scale.set(1, 1, 1);
          this.cb.onScaleStart?.(this.selectedIds[0]);
        }
        if (this.cb.onInteractionStart) this.cb.onInteractionStart();
      } else if (this.interaction && this.interaction.kind === 'gizmo') {
        this.interaction = null;
        if (this.cb.onInteractionEnd) this.cb.onInteractionEnd();
      }
    });

    this.transform.addEventListener('objectChange', () => {
      if (!this.interaction || this.interaction.kind !== 'gizmo') return;
      const id = this.interaction.id;
      if (!id) return;
      if (this.gizmoMode === 'translate') {
        const p = this.proxy.position;
        const snapped = this.snapVec([p.x, Math.max(0, p.y), p.z]);
        this.cb.onTransformMove?.(id, snapped);
      } else if (this.gizmoMode === 'rotate') {
        const deg = THREE.MathUtils.radToDeg(this.proxy.rotation.y);
        this.cb.onTransformRotate?.(id, deg);
      } else if (this.gizmoMode === 'scale') {
        const s = this.proxy.scale;
        this.cb.onTransformScale?.(id, { x: s.x, y: s.y, z: s.z });
      }
    });
  }

  /* -------------------------------------------------------------- resize */

  _observeResize() {
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement);
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------ geometry */

  setPayload(payload) {
    this.payload = payload;
    const first = this.chunks.size === 0;
    const hadBounds = Boolean(this._framedOnce);

    for (const child of [...this.chunkGroup.children]) {
      this.chunkGroup.remove(child);
      disposeDeep(child);
    }
    this.chunks.clear();

    for (const chunk of payload.chunks) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(chunk.colors, 3));
      geom.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      geom.computeBoundingSphere();

      const mesh = new THREE.Mesh(geom, this.solidMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.chunkId = chunk.id;
      mesh.userData.isGroup = chunk.isGroup;
      this.chunkGroup.add(mesh);

      const edgeGeom = new THREE.BufferGeometry();
      edgeGeom.setAttribute('position', new THREE.BufferAttribute(chunk.edges, 3));
      const edges = new THREE.LineSegments(edgeGeom, this.edgeMaterial);
      edges.renderOrder = 1;
      mesh.add(edges);

      this.chunks.set(chunk.id, { mesh, edges, chunk });
    }

    this._rebuildCutterGhosts(payload);
    this._rebuildCollisionPreview();
    this.applySettings(this.settings);
    this.refreshOverlays();
    if (first && payload.parkBounds) {
      this.frameAll();
      this._framedOnce = true;
      // The canvas may still be laying out on first paint (aspect 1).
      requestAnimationFrame(() => this.frameAll());
      setTimeout(() => this.frameAll(), 220);
    }
  }

  /** Translucent volumes of elements used as boolean cutters. */
  _rebuildCutterGhosts(payload) {
    if (!this.cutterGroup) {
      this.cutterGroup = new THREE.Group();
      this.cutterGroup.renderOrder = 4;
      this.scene.add(this.cutterGroup);
    }
    for (const child of [...this.cutterGroup.children]) {
      this.cutterGroup.remove(child);
      disposeDeep(child);
    }
    for (const chunk of payload.cutterChunks || []) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
      geom.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe0675a,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        wireframe: true,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData.chunkId = chunk.id;
      mesh.userData.groupId = chunk.groupId;
      this.cutterGroup.add(mesh);
    }
    this.cutterGroup.visible = this.settings.showCutterGhosts === true;
  }

  _rebuildCollisionPreview() {
    for (const child of [...this.collisionGroup.children]) {
      this.collisionGroup.remove(child);
      disposeDeep(child);
    }
    if (!this.payload) return;
    for (const chunk of this.payload.chunks) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
      geom.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      const mat = new THREE.MeshBasicMaterial({
        color: chunk.isGroup ? 0x4ed6a4 : 0x5ea8d6,
        wireframe: true,
        transparent: true,
        opacity: chunk.isGroup ? 0.34 : 0.2,
        depthWrite: false,
        toneMapped: false,
      });
      this.collisionGroup.add(new THREE.Mesh(geom, mat));
    }
  }

  /* --------------------------------------------------------------- layout */

  setSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.applySettings(settings);
  }

  applySettings(settings) {
    if (!settings) return;
    if ('showGrid' in settings) {
      this.grid.visible = !!settings.showGrid;
      this.gridMajor.visible = !!settings.showGrid;
      this.gridAxes.visible = !!settings.showGrid;
    }
    if ('showEdges' in settings) {
      for (const entry of this.chunks.values()) entry.edges.visible = !!settings.showEdges;
    }
    if ('showCollision' in settings) this.collisionGroup.visible = !!settings.showCollision;
    if ('snapEnabled' in settings || 'snapStep' in settings) {
      const step = Number(this.settings.snapStep) || 0.1;
      this.transform.setTranslationSnap(this.settings.snapEnabled ? step : null);
    }
    if ('showCutterGhosts' in settings) this._updateCutterGhosts();
  }

  _updateCutterGhosts() {
    if (this.cutterGroup) this.cutterGroup.visible = this.settings.showCutterGhosts === true;
  }

  /**
   * Elements baked into a merged group have no chunk of their own; highlight
   * the group chunk instead so selection is always visible.
   */
  resolveChunkId(id) {
    if (this.chunks.has(id)) return id;
    const gid = this.payload?.memberGroups?.[id];
    if (gid && this.chunks.has(gid)) return gid;
    return null;
  }

  setSelected(ids) {
    this.selectedIds = [...ids];
    this.refreshOverlays();
    this._positionGizmo();
  }


  /** Keep the gizmo anchored without rebuilding overlays (live drags). */
  syncGizmo() {
    this._positionGizmo();
  }

  setOverlaps(ids) {
    const next = new Set(ids);
    let changed = next.size !== this.overlapIds.size;
    if (!changed) for (const id of next) if (!this.overlapIds.has(id)) changed = true;
    this.overlapIds = next;
    if (changed) this.refreshOverlays();
  }

  setHover(id) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.refreshOverlays();
  }

  refreshOverlays() {
    for (const child of [...this.overlayGroup.children]) {
      this.overlayGroup.remove(child);
      disposeDeep(child);
    }
    this.overlayMeshes.clear();
    const add = (id, mat, scale, kind, edge = false) => {
      const chunkId = this.resolveChunkId(id);
      const entry = chunkId ? this.chunks.get(chunkId) : null;
      if (!entry) return;
      const geom = entry.mesh.geometry.clone();
      let obj;
      if (edge) {
        // Reuse the worker's crease edges: an EdgesGeometry pass would also
        // trace every tessellation line on curved surfaces.
        const edgeGeom = new THREE.BufferGeometry();
        edgeGeom.setAttribute('position', new THREE.BufferAttribute(entry.chunk.edges.slice(), 3));
        obj = new THREE.LineSegments(edgeGeom, mat);
      } else {
        obj = new THREE.Mesh(geom, mat);
      }
      obj.scale.setScalar(scale);
      obj.userData.kind = kind;
      obj.renderOrder = 3;
      this.overlayGroup.add(obj);
      this.overlayMeshes.set(`${kind}:${id}`, obj);
      return obj;
    };

    for (const id of this.overlapIds) {
      if (!this.selectedIds.includes(id)) add(id, this.materials.overlap, 1, 'overlap');
    }
    if (this.hoverId && !this.selectedIds.includes(this.hoverId)) {
      add(this.hoverId, this.materials.hover, 1, 'hover');
    }
    for (const id of this.selectedIds) {
      const mesh = add(id, this.materials.select, 1, 'select');
      if (mesh) add(id, this.materials.selectEdge, 1.004, 'selectEdge', true);
    }
  }

  _positionGizmo() {
    const id = this.selectedIds.length === 1 ? this.selectedIds[0] : null;
    if (!this.gizmoEnabled || !id || this.gizmoMode === 'drag' || this.interaction?.kind === 'gizmo') {
      if (!id || this.gizmoMode === 'scale') this.transform.detach();
      return;
    }
    if (!this.resolveChunkId(id)) {
      this.transform.detach();
      return;
    }
    const chunkId = this.resolveChunkId(id);
    const target = this.payload?.targets?.[chunkId];
    const bounds =
      this.payload?.worldBounds?.[id] ||
      this.payload?.groupBounds?.[chunkId] ||
      this.payload?.worldBounds?.[chunkId];
    if (!target && !bounds) {
      this.transform.detach();
      return;
    }
    const cx = target ? target.position[0] : (bounds.min[0] + bounds.max[0]) / 2;
    const cz = target ? target.position[2] : (bounds.min[2] + bounds.max[2]) / 2;
    const cy = target ? target.position[1] : bounds.min[1];
    this.proxy.position.set(cx, cy, cz);
    this.proxy.rotation.set(0, THREE.MathUtils.degToRad(target ? target.rotationY : 0), 0);
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld(true);
    if (this.transform.object !== this.proxy) this.transform.attach(this.proxy);
  }

  /** Live preview while dragging in the document (no rebuild yet). */
  setProxyTransform(id, position, rotationY) {
    if (this.transform.object !== this.proxy) return;
    if (position) this.proxy.position.set(position[0], position[1], position[2]);
    if (rotationY !== undefined) this.proxy.rotation.y = THREE.MathUtils.degToRad(rotationY);
    this.proxy.updateMatrixWorld(true);
  }

  setGizmoMode(mode) {
    this.gizmoMode = mode;
    this.transform.setSpace(mode === 'scale' ? 'local' : 'world');
    // 'translate' means direct pointer dragging; rotation and scale use the
    // gizmo handles.
    this.gizmoEnabled = mode === 'rotate' || mode === 'scale';
    this.transform.enabled = this.gizmoEnabled;
    this.transform.getHelper().visible = this.gizmoEnabled;
    if (!this.gizmoEnabled) {
      this.transform.detach();
    } else {
      this.transform.setMode(mode);
      this._positionGizmo();
    }
  }

  /* --------------------------------------------------------- drag preview */

  /**
   * Visually shift a chunk while dragging without rebuilding geometry.
   * `base` is the element origin the chunk was baked at; `target` the new one.
   */
  dragPreview(id, base, target, rotationY) {
    const entry = this.chunks.get(id);
    const dx = target[0] - base[0];
    const dy = target[1] - base[1];
    const dz = target[2] - base[2];
    if (entry) {
      entry.mesh.position.set(dx, dy, dz);
      entry.edges.computeLineDistances?.();
    }
    const overlay = this.overlayMeshes;
    for (const [key, obj] of overlay) {
      if (!key.endsWith(`:${id}`)) continue;
      obj.position.set(dx, dy, dz);
    }
    if (this.transform.object === this.proxy) {
      this.proxy.position.set(target[0], target[1], target[2]);
      if (rotationY !== undefined) this.proxy.rotation.y = THREE.MathUtils.degToRad(rotationY);
      this.proxy.updateMatrixWorld(true);
    }
  }

  dragPreviewDelta(id, dx, dz) {
    const entry = this.chunks.get(id);
    if (entry) entry.mesh.position.set(dx, 0, dz);
    for (const [key, obj] of this.overlayMeshes) {
      if (key.endsWith(`:${id}`)) obj.position.set(dx, 0, dz);
    }
  }

  endDragPreview() {
    for (const entry of this.chunks.values()) entry.mesh.position.set(0, 0, 0);
    for (const obj of this.overlayMeshes.values()) obj.position.set(0, 0, 0);
    this._positionGizmo();
  }

  /* ------------------------------------------------------------- placing */

  beginPlacing(type) {
    this.placingType = type;
    this.canvas.style.cursor = 'crosshair';
  }

  endPlacing() {
    this.placingType = null;
    this.canvas.style.cursor = '';
    this.clearGhost();
  }

  showGhost(type, position, rotationY, localBounds) {
    this.clearGhost();
    if (!localBounds) return;
    const w = Math.max(0.1, localBounds.max[0] - localBounds.min[0]);
    const h = Math.max(0.1, localBounds.max[1] - localBounds.min[1]);
    const d = Math.max(0.1, localBounds.max[2] - localBounds.min[2]);
    const cy = (localBounds.min[1] + localBounds.max[1]) / 2;
    const geom = new THREE.BoxGeometry(w, h, d);
    geom.translate(0, cy, 0);
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: 0xf2bb45, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    const fill = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d).translate(0, cy, 0),
      new THREE.MeshBasicMaterial({
        color: 0xf2bb45,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const group = new THREE.Group();
    group.add(box, fill);
    group.position.set(position[0], position[1], position[2]);
    group.rotation.y = THREE.MathUtils.degToRad(rotationY || 0);
    this.ghostGroup.add(group);
  }

  clearGhost() {
    for (const child of [...this.ghostGroup.children]) {
      this.ghostGroup.remove(child);
      disposeDeep(child);
    }
  }

  /* ------------------------------------------------------------- snapping */

  snapScalar(v) {
    const step = Number(this.settings.snapStep) || 0.1;
    if (!this.settings.snapEnabled) return Math.round(v * 1e4) / 1e4;
    return Math.round((Math.round(v / step) * step) * 1e6) / 1e6;
  }

  snapVec(v) {
    return [this.snapScalar(v[0]), Math.max(0, this.snapScalar(v[1])), this.snapScalar(v[2])];
  }

  /**
   * Snap a moving element's footprint against other elements' bounds.
   * Returns a world-space position (element origin at footprint centre).
   */
  snapAgainstNeighbours(id, position) {
    const out = [...position];
    if (!this.settings.edgeSnap || !this.settings.snapEnabled) return out;
    const own = this.payload?.worldBounds?.[id];
    if (!own) return out;
    const w = own.max[0] - own.min[0];
    const d = own.max[2] - own.min[2];
    const step = Number(this.settings.snapStep) || 0.1;
    const tol = step * 0.75;
    let bestX = null;
    let bestZ = null;
    for (const [otherId, b] of Object.entries(this.payload?.worldBounds || {})) {
      if (otherId === id) continue;
      const candX = [
        b.max[0] + w / 2,
        b.min[0] - w / 2,
        (b.min[0] + b.max[0]) / 2,
      ];
      const candZ = [
        b.max[2] + d / 2,
        b.min[2] - d / 2,
        (b.min[2] + b.max[2]) / 2,
      ];
      for (const cx of candX) {
        const dist = Math.abs(cx - out[0]);
        if (dist < tol && (!bestX || dist < bestX.dist)) bestX = { value: cx, dist };
      }
      for (const cz of candZ) {
        const dist = Math.abs(cz - out[2]);
        if (dist < tol && (!bestZ || dist < bestZ.dist)) bestZ = { value: cz, dist };
      }
    }
    if (bestX) out[0] = bestX.value;
    if (bestZ) out[2] = bestZ.value;
    return out;
  }

  /* --------------------------------------------------------------- events */

  _setPointer(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  pick(clientX, clientY) {
    this._setPointer(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.chunkGroup.children, false);
    if (!hits.length) return null;
    return { id: hits[0].object.userData.chunkId, point: hits[0].point.clone() };
  }

  pickGround(clientX, clientY) {
    this._setPointer(clientX, clientY);
    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, point)) return point;
    return null;
  }

  _bindEvents() {
    const el = this.canvas;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.transform.axis) return; // gizmo grabbed
      this.lastPointer = { x: e.clientX, y: e.clientY };

      if (this.placingType) {
        const ground = this.pickGround(e.clientX, e.clientY);
        if (ground) this.cb.onPlaceConfirm?.(this.placingType, ground, e.shiftKey);
        return;
      }

      const hit = this.pick(e.clientX, e.clientY);
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;

      if (hit) {
        this._pending = {
          id: hit.id,
          x: e.clientX,
          y: e.clientY,
          point: hit.point,
          additive,
          moved: false,
        };
        if (additive) {
          this.cb.onSelect?.(hit.id, { toggle: true });
          this._pending = null;
        }
      } else {
        this._pending = { id: null, x: e.clientX, y: e.clientY, additive, moved: false };
        if (!additive) this.cb.onBackground?.();
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (this._pending && this._pending.id && !this._pending.moved) {
        const dx = e.clientX - this._pending.x;
        const dy = e.clientY - this._pending.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          const ground = this.pickGround(e.clientX, e.clientY) || this._pending.point;
          const started = this.cb.onDragStart?.(this._pending.id, ground);
          if (started) {
            this._pending.moved = true;
            el.setPointerCapture?.(e.pointerId);
            this.interaction = {
              kind: 'drag',
              id: this._pending.id,
              pointerId: e.pointerId,
              grabPoint: ground.clone(),
            };
          } else {
            this._pending = null;
          }
        }
      }

      if (this.interaction && this.interaction.kind === 'drag') {
        const ground = this.pickGround(e.clientX, e.clientY);
        if (ground) {
          const dx = ground.x - this.interaction.grabPoint.x;
          const dz = ground.z - this.interaction.grabPoint.z;
          const consumed = this.cb.onDrag?.(this.interaction.id, dx, dz);
          if (consumed?.preview) {
            if (consumed.kind === 'group') this.cb.onGroupPreview?.(this.interaction.id, dx, dz);
            else this.dragPreviewDelta(this.interaction.id, consumed.dx, consumed.dz);
          }
        }
        return;
      }

      if (this.placingType) {
        const ground = this.pickGround(e.clientX, e.clientY);
        if (ground) this.cb.onPlaceHover?.(ground);
        return;
      }

      if (!this._pending) {
        const hit = this.pick(e.clientX, e.clientY);
        const id = hit ? hit.id : null;
        if (id !== this.hoverId) {
          this.setHover(id);
          el.style.cursor = id ? (this.gizmoMode === 'rotate' ? 'pointer' : 'grab') : '';
        }
      }
    });

    const finish = (e) => {
      if (this.interaction && this.interaction.kind === 'drag') {
        el.releasePointerCapture?.(this.interaction.pointerId);
        this.endDragPreview();
        this.interaction = null;
        this.cb.onInteractionEnd?.();
        this._pending = null;
        return;
      }
      if (this._pending && this._pending.id && !this._pending.moved && !this._pending.additive) {
        this.cb.onSelect?.(this._pending.id, {});
      }
      this._pending = null;
    };

    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('pointerleave', () => {
      if (!this.interaction) {
        this.setHover(null);
        el.style.cursor = '';
      }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // Double-click frames the element.
    el.addEventListener('dblclick', (e) => {
      if (this.placingType) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this.cb.onFocusElement?.(hit.id);
    });
  }

  /* --------------------------------------------------------------- camera */

  /**
   * Distance that fits a bounding sphere in the smaller of the two FOVs, so
   * portrait phones (very narrow horizontal FOV) still see the whole park.
   */
  _fitDistance(radius, margin = 1.06) {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.15, this.camera.aspect || 1));
    const fov = Math.min(vFov, hFov);
    return Math.max(1.6, (radius * margin) / Math.sin(fov / 2));
  }

  _focusBox(bounds, dir = new THREE.Vector3(0.78, 0.66, 0.86)) {
    if (!bounds) return;
    const center = new THREE.Vector3(
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    );
    const radius = Math.max(
      0.9,
      Math.hypot(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      ) / 2,
    );
    const dist = this._fitDistance(radius, 0.95);
    const pos = center.clone().add(dir.clone().normalize().multiplyScalar(dist));
    this.camera.position.copy(pos);
    this.controls.target.copy(center);
    this.controls.update();
  }

  frameAll() {
    const b = this.payload?.parkBounds;
    this._focusBox(b || { min: [-6, 0, -6], max: [6, 2, 6] });
  }

  focusElement(id) {
    const b = this.payload?.worldBounds?.[id] || this.payload?.groupBounds?.[id];
    if (b) this._focusBox(b);
  }

  setView(kind) {
    const b = this.payload?.parkBounds || { min: [-6, 0, -6], max: [6, 2, 6] };
    const center = new THREE.Vector3(
      (b.min[0] + b.max[0]) / 2,
      (b.min[1] + b.max[1]) / 2,
      (b.min[2] + b.max[2]) / 2,
    );
    const size = Math.max(4, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
    const dirs = {
      iso: new THREE.Vector3(0.72, 0.62, 0.82),
      top: new THREE.Vector3(0.001, 1, 0.001),
      front: new THREE.Vector3(0, 0.12, 1),
      side: new THREE.Vector3(1, 0.12, 0),
    };
    const dir = (dirs[kind] || dirs.iso).clone().normalize();
    const dist = this._fitDistance(size / 2, 0.92);
    this.controls.target.copy(center);
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    this.controls.update();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.transform.dispose();
    this.renderer.dispose();
  }
}

function disposeDeep(obj) {
  obj.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (child.material && !Array.isArray(child.material)) {
      if (!child.material.userData?.shared) child.material.dispose?.();
    }
  });
}
