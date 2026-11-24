import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { InteractionMode } from './InteractionMode';

/**
 * 渲染引擎单例：WebGLRenderer / Scene / Camera / OrbitControls / rAF 主循环。
 * THREE 对象全部为普通类字段，不进入 Solid 响应式代理。
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();
  private mode: InteractionMode | null = null;
  private rafId = 0;
  private clock = new THREE.Clock();
  private readonly frameCallbacks = new Set<(delta: number, elapsed: number) => void>();
  private resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbfd4e6);
    this.scene.fog = new THREE.Fog(0xbfd4e6, 600, 1400);

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      3000,
    );
    this.camera.position.set(260, 220, 260);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 30;
    this.maxDistanceGuard(900);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7a5e, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
    sun.position.set(180, 260, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -300;
    sun.shadow.camera.right = 300;
    sun.shadow.camera.top = 300;
    sun.shadow.camera.bottom = -300;
    sun.shadow.camera.far = 900;
    this.scene.add(sun);

    this.bindPointerEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.loop();
  }

  private maxDistanceGuard(d: number): void {
    this.controls.maxDistance = d;
  }

  setMode(mode: InteractionMode | null): void {
    this.mode?.onDeactivate?.();
    this.mode = mode;
    this.mode?.onActivate?.();
  }

  getMode(): InteractionMode | null {
    return this.mode;
  }

  /** 注册每帧回调（TourPlayer、植被节流等），返回注销函数 */
  onFrame(cb: (delta: number, elapsed: number) => void): () => void {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
  }

  /** 屏幕像素 → NDC */
  setPointerFromEvent(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  intersectTerrain(terrainMesh: THREE.Object3D): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(terrainMesh, false);
    return hits[0]?.point ?? null;
  }

  intersectObjects(objects: THREE.Object3D[], recursive = true): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(objects, recursive);
    return hits[0] ?? null;
  }

  private bindPointerEvents(): void {
    const el = this.renderer.domElement;
    // 捕获阶段先于 OrbitControls 执行：模式消费事件时阻断镜头旋转
    el.addEventListener(
      'pointerdown',
      (e) => {
        this.setPointerFromEvent(e);
        const consumed = this.mode?.onPointerDown?.(e);
        if (consumed) e.stopImmediatePropagation();
      },
      true,
    );
    el.addEventListener('pointermove', (e) => {
      this.setPointerFromEvent(e);
      this.mode?.onPointerMove?.(e);
    });
    el.addEventListener('pointerup', (e) => {
      this.setPointerFromEvent(e);
      this.mode?.onPointerUp?.(e);
    });
    el.addEventListener('pointerleave', (e) => this.mode?.onPointerLeave?.(e));
    el.addEventListener('wheel', (e) => this.mode?.onWheel?.(e), { passive: true });
  }

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;
    this.controls.update();
    for (const cb of this.frameCallbacks) cb(delta, elapsed);
    this.mode?.onFrame?.(delta, elapsed);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
