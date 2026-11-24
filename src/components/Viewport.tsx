import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast } from 'three-mesh-bvh';
import type { BufferGeometry } from 'three';
import type { PipelineResult, Vec3 } from '../types';
import type { PlaneSplitResult } from '../geometry/clipPlane';
import { useHistory } from '../state/HistoryContext';
import { ensureBVH } from '../geometry/bvh';
import { projectContour } from '../geometry/contour';
import { buildOffsetShellPreview } from '../geometry/shell';

interface DragState {
  type: 'vertex' | 'height';
  index?: number;
  pointerId: number;
  startClientY: number;
  startHeight: number;
  moved: boolean;
}

interface ViewApi {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
}

function disposeObject3D(root: THREE.Object3D, disposeGeometry = true) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (disposeGeometry && mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
  root.clear();
}

function lineFromPoints(points: THREE.Vector3[], color: number, closed = false, opacity = 1): THREE.Line {
  const pts = closed && points.length > 1 ? [...points, points[0].clone()] : points;
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 30;
  return line;
}

export function Viewport({ geometry, pipeline, preview }: { geometry: BufferGeometry | null; pipeline: PipelineResult | null; preview: PlaneSplitResult | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const history = useHistory();
  const historyRef = useRef(history);
  historyRef.current = history;

  const apiRef = useRef<ViewApi | null>(null);
  const sourceMeshRef = useRef<THREE.Mesh | null>(null);
  const lowerGroupRef = useRef<THREE.Group | null>(null);
  const upperGroupRef = useRef<THREE.Group | null>(null);
  const overlayRef = useRef<THREE.Group | null>(null);
  const warningGroupRef = useRef<THREE.Group | null>(null);
  const vertexHandlesRef = useRef<THREE.Mesh[]>([]);
  const heightHandleRef = useRef<THREE.Mesh | null>(null);
  const markerRingsRef = useRef<THREE.Mesh[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // One-time renderer/scene setup.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1020');
    scene.fog = new THREE.Fog('#0b1020', 380, 820);

    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 2000);
    camera.position.set(145, 115, 185);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 55, 0);
    controls.minDistance = 45;
    controls.maxDistance = 560;
    controls.maxPolarAngle = Math.PI * 0.94;

    apiRef.current = { scene, camera, renderer, controls };

    const hemi = new THREE.HemisphereLight('#dbeafe', '#1e293b', 1.7);
    scene.add(hemi);
    const key = new THREE.DirectionalLight('#ffffff', 2.5);
    key.position.set(120, 220, 130);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -190;
    key.shadow.camera.right = 190;
    key.shadow.camera.top = 230;
    key.shadow.camera.bottom = -90;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 520;
    scene.add(key);
    const rim = new THREE.DirectionalLight('#67e8f9', 1.15);
    rim.position.set(-160, 100, -130);
    scene.add(rim);

    const grid = new THREE.GridHelper(430, 43, '#334155', '#1e293b');
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.02;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(430, 430),
      new THREE.ShadowMaterial({ color: '#000000', opacity: 0.28 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.01;
    floor.receiveShadow = true;
    scene.add(floor);

    const lowerGroup = new THREE.Group();
    const upperGroup = new THREE.Group();
    const overlayGroup = new THREE.Group();
    const warningGroup = new THREE.Group();
    scene.add(lowerGroup, upperGroup, overlayGroup, warningGroup);
    lowerGroupRef.current = lowerGroup;
    upperGroupRef.current = upperGroup;
    overlayRef.current = overlayGroup;
    warningGroupRef.current = warningGroup;

    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    const pointerNdc = new THREE.Vector2();

    const setNdc = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
    };

    const pickModelPoint = (event: PointerEvent): Vec3 | null => {
      const mesh = sourceMeshRef.current;
      if (!mesh) return null;
      setNdc(event);
      const hits = raycaster.intersectObject(mesh, false);
      const hit = hits[0];
      if (!hit) return null;
      return { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      downRef.current = { x: event.clientX, y: event.clientY, t: performance.now() };
      setNdc(event);

      vertexHandlesRef.current = vertexHandlesRef.current.filter((m) => m.parent);
      const handleHits = raycaster.intersectObjects(vertexHandlesRef.current, false);
      if (handleHits.length) {
        const index = handleHits[0].object.userData.vertexIndex as number;
        dragRef.current = { type: 'vertex', index, pointerId: event.pointerId, startClientY: event.clientY, startHeight: historyRef.current.state.cutHeight, moved: false };
        historyRef.current.beginGesture();
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const heightHandle = heightHandleRef.current;
      if (heightHandle) {
        const heightHits = raycaster.intersectObject(heightHandle, false);
        if (heightHits.length) {
          dragRef.current = { type: 'height', pointerId: event.pointerId, startClientY: event.clientY, startHeight: historyRef.current.state.cutHeight, moved: false };
          historyRef.current.beginGesture();
          controls.enabled = false;
          renderer.domElement.setPointerCapture(event.pointerId);
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        setNdc(event);
        const handles = [...vertexHandlesRef.current, heightHandleRef.current].filter(Boolean) as THREE.Object3D[];
        const hits = handles.length ? raycaster.intersectObjects(handles, false) : [];
        renderer.domElement.style.cursor = hits.length ? 'grab' : historyRef.current.state.step === 'parting' ? 'crosshair' : 'default';
        return;
      }

      drag.moved = true;
      const state = historyRef.current.state;
      if (drag.type === 'vertex' && drag.index !== undefined) {
        const p = pickModelPoint(event);
        if (p) {
          const index = drag.index;
          historyRef.current.live((s) => ({
            contour: s.contour.map((point, i) => (i === index ? p : point)),
          }));
        }
      } else if (drag.type === 'height') {
        const distance = camera.position.distanceTo(controls.target);
        const worldPerPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) / Math.max(host.clientHeight, 1);
        const delta = (drag.startClientY - event.clientY) * worldPerPixel;
        const next = THREE.MathUtils.clamp(drag.startHeight + delta, state.minY + 0.5, state.maxY - 0.5);
        historyRef.current.live({ cutHeight: next, cutReady: true });
      }
    };

    const endDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        historyRef.current.endGesture(drag.type === 'height' ? '拖动分模面高度' : '拖动折线顶点');
        dragRef.current = null;
        controls.enabled = true;
        try {
          renderer.domElement.releasePointerCapture(event.pointerId);
        } catch {
          // capture may already be released
        }
        return;
      }

      const down = downRef.current;
      downRef.current = null;
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      const elapsed = performance.now() - down.t;
      if (moved > 6 || elapsed > 1000) return;
      if (historyRef.current.state.step !== 'parting') return;

      const point = pickModelPoint(event);
      if (point) {
        historyRef.current.commit((s) => ({
          contour: [...s.contour, point],
        }), '添加折线点');
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', endDrag);
    renderer.domElement.addEventListener('pointercancel', endDrag);

    const resizeObserver = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = Math.max(host.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(host);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      const t = performance.now() * 0.0035;
      markerRingsRef.current.forEach((ring, i) => {
        const scale = 1 + Math.sin(t + i * 0.73) * 0.09;
        ring.scale.setScalar(scale);
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', endDrag);
      renderer.domElement.removeEventListener('pointercancel', endDrag);
      controls.dispose();
      disposeObject3D(scene);
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
      lowerGroupRef.current = null;
      upperGroupRef.current = null;
      overlayRef.current = null;
      sourceMeshRef.current = null;
    };
  }, []);

  // Install/update source geometry and frame each newly imported/selected model.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !geometry) return;
    ensureBVH(geometry);

    if (!sourceMeshRef.current) {
      const material = new THREE.MeshStandardMaterial({
        color: '#91a7ff',
        roughness: 0.46,
        metalness: 0.05,
        side: THREE.DoubleSide,
        transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.raycast = acceleratedRaycast;
      sourceMeshRef.current = mesh;
      api.scene.add(mesh);
    } else {
      sourceMeshRef.current.geometry = geometry;
      sourceMeshRef.current.raycast = acceleratedRaycast;
    }

    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    api.controls.target.set(center.x, size.y * 0.48, center.z);
    const radius = Math.max(size.x, size.y, size.z);
    api.camera.position.set(radius * 1.15, size.y * 0.92 + 25, radius * 1.45);
    api.camera.near = 0.1;
    api.camera.far = radius * 8;
    api.camera.updateProjectionMatrix();
    api.controls.update();
  }, [geometry, history.state.modelId]);

  // Source mesh visibility / opacity by workflow step.
  useEffect(() => {
    const mesh = sourceMeshRef.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const { step, cutReady } = history.state;
    if (step === 'model') {
      mesh.visible = true;
      mat.opacity = 1;
      mat.depthWrite = true;
    } else if (step === 'parting') {
      mesh.visible = true;
      mat.opacity = cutReady ? 0.16 : 0.82;
      mat.depthWrite = !cutReady;
    } else {
      mesh.visible = false;
    }
  }, [history.state.step, history.state.cutReady, history.state.modelId]);

  // Exploded piece positions.
  useEffect(() => {
    if (lowerGroupRef.current) lowerGroupRef.current.position.y = -history.state.explode * 0.5;
    if (upperGroupRef.current) upperGroupRef.current.position.y = history.state.explode * 0.5;
  }, [history.state.explode]);

  // Build final piece meshes and tenon/wall markers.
  useEffect(() => {
    const lowerGroup = lowerGroupRef.current;
    const upperGroup = upperGroupRef.current;
    const warningGroup = warningGroupRef.current;
    if (!lowerGroup || !upperGroup || !warningGroup) return;

    disposeObject3D(lowerGroup);
    disposeObject3D(upperGroup);
    disposeObject3D(warningGroup);
    markerRingsRef.current = [];

    if (!history.state.cutReady || (!pipeline && !preview)) return;

    const heightStale = !pipeline || Math.abs(pipeline.cutHeight - history.state.cutHeight) > 0.25;
    const lowerGeometry = heightStale ? preview?.lower ?? null : pipeline?.lowerGeometry ?? preview?.lower ?? null;
    const upperGeometry = heightStale ? preview?.upper ?? null : pipeline?.upperGeometry ?? preview?.upper ?? null;

    const lowerMaterial = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      roughness: 0.5,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    const upperMaterial = new THREE.MeshStandardMaterial({
      color: '#c084fc',
      roughness: 0.5,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });

    if (lowerGeometry) {
      const mesh = new THREE.Mesh(lowerGeometry, lowerMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      lowerGroup.add(mesh);
    }
    if (upperGeometry) {
      const mesh = new THREE.Mesh(upperGeometry, upperMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      upperGroup.add(mesh);
    }

    // Normal-offset inner surface preview makes wall thickness legible before/after CSG.
    if (!heightStale && history.state.step === 'wall' && history.state.showInnerShell && pipeline) {
      const innerMat = new THREE.MeshBasicMaterial({ color: '#fbbf24', wireframe: true, transparent: true, opacity: 0.42, depthTest: false });
      if (pipeline.lowerBodyGeometry) {
        const inner = new THREE.Mesh(buildOffsetShellPreview(pipeline.lowerBodyGeometry, history.state.wall.thickness), innerMat);
        inner.renderOrder = 25;
        lowerGroup.add(inner);
      }
      if (pipeline.upperBodyGeometry) {
        const inner = new THREE.Mesh(buildOffsetShellPreview(pipeline.upperBodyGeometry, history.state.wall.thickness), innerMat.clone());
        inner.renderOrder = 25;
        upperGroup.add(inner);
      }
    }

    const h = history.state.cutHeight;
    const r = history.state.tenon.radius;
    const dir = history.state.tenon.side === 'lower' ? 1 : -1;
    if (pipeline && !heightStale) pipeline.tenons.forEach((tenon) => {
      if (history.state.showConflictOnly && !tenon.conflict) return;
      const color = tenon.conflict ? '#ef4444' : '#22d3ee';
      const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.92, depthTest: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.72, r + 1.35, 36), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(tenon.x, h + 0.22, tenon.z);
      ring.renderOrder = 40;
      markerRingsRef.current.push(ring);
      if (history.state.tenon.side === 'lower') lowerGroup.add(ring);
      else upperGroup.add(ring);

      const envelope = new THREE.Mesh(
        new THREE.CylinderGeometry(r + 0.15, r + 0.15, history.state.tenon.depth, 24, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: tenon.conflict ? 0.28 : 0.1, side: THREE.DoubleSide, depthWrite: false }),
      );
      envelope.position.set(tenon.x, h + (dir * history.state.tenon.depth) / 2, tenon.z);
      if (history.state.tenon.side === 'lower') lowerGroup.add(envelope);
      else upperGroup.add(envelope);

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(tenon.conflict ? 2.4 : 1.7, 18, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      dot.position.set(tenon.x, h + dir * history.state.tenon.depth, tenon.z);
      dot.renderOrder = 41;
      if (history.state.tenon.side === 'lower') lowerGroup.add(dot);
      else upperGroup.add(dot);
    });

    if (history.state.step === 'wall' && pipeline && !heightStale) {
      pipeline.thinWarnings.forEach((w) => {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(3.2, 18, 12),
          new THREE.MeshBasicMaterial({ color: '#f97316', transparent: true, opacity: 0.9, depthTest: false }),
        );
        sphere.position.set(w.x, w.y, w.z);
        sphere.renderOrder = 42;
        warningGroup.add(sphere);
      });
    }
  }, [
    pipeline,
    preview,
    history.state.cutReady,
    history.state.step,
    history.state.cutHeight,
    history.state.tenon.radius,
    history.state.tenon.depth,
    history.state.tenon.side,
    history.state.showConflictOnly,
    history.state.showInnerShell,
    history.state.wall.thickness,
  ]);

  // Rebuild drawing aids, projected curve, section loops and height handle.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    disposeObject3D(overlay);
    vertexHandlesRef.current = [];
    heightHandleRef.current = null;

    const s = history.state;
    const h = s.cutHeight;

    if (s.step === 'parting') {
      if (s.contour.length > 0) {
        const raw = lineFromPoints(s.contour.map((p) => new THREE.Vector3(p.x, p.y + 0.25, p.z)), 0xfb923c, s.contourClosed && s.contour.length > 2, 0.95);
        overlay.add(raw);
      }

      const projected = pipeline?.projectedCurve ?? projectContour(s.contour, h, s.contourClosed && s.contour.length >= 3);
      if (projected.length >= 2) {
        const projectedLine = lineFromPoints(projected.map((p) => new THREE.Vector3(p.x, h + 0.35, p.z)), 0x22d3ee, s.contourClosed && s.contour.length >= 3, 0.95);
        overlay.add(projectedLine);
      }

      s.contour.forEach((p, index) => {
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(index === s.contour.length - 1 ? 3.1 : 2.45, 20, 14),
          new THREE.MeshStandardMaterial({ color: index === 0 ? '#facc15' : '#fb923c', emissive: '#7c2d12', emissiveIntensity: 0.35 }),
        );
        handle.position.set(p.x, p.y + 0.4, p.z);
        handle.userData.vertexIndex = index;
        handle.renderOrder = 50;
        overlay.add(handle);
        vertexHandlesRef.current.push(handle);
      });

      const planeSize = Math.max(s.sizeX, s.sizeZ, 120) * 1.45;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(planeSize, planeSize),
        new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = h;
      overlay.add(plane);

      const border = lineFromPoints(
        [
          new THREE.Vector3(-planeSize / 2, h + 0.08, -planeSize / 2),
          new THREE.Vector3(planeSize / 2, h + 0.08, -planeSize / 2),
          new THREE.Vector3(planeSize / 2, h + 0.08, planeSize / 2),
          new THREE.Vector3(-planeSize / 2, h + 0.08, planeSize / 2),
        ],
        0xfacc15,
        true,
        0.7,
      );
      overlay.add(border);

      const handleX = s.sizeX / 2 + 18;
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(5.2, 28, 18),
        new THREE.MeshStandardMaterial({ color: '#facc15', emissive: '#854d0e', emissiveIntensity: 0.5 }),
      );
      handle.position.set(handleX, h, 0);
      handle.userData.dragHeight = true;
      handle.renderOrder = 51;
      overlay.add(handle);
      heightHandleRef.current = handle;

      const stem = lineFromPoints([new THREE.Vector3(handleX, s.minY, 0), new THREE.Vector3(handleX, s.maxY, 0)], 0xfacc15, false, 0.35);
      overlay.add(stem);
    }

    const sectionLoops = preview?.loops ?? pipeline?.sectionLoops ?? [];
    if (s.showSection && s.cutReady && sectionLoops.length) {
      sectionLoops.forEach((loop, i) => {
        const color = i === 0 ? 0x4ade80 : 0xa3e635;
        const sectionLine = lineFromPoints(loop.map((p) => new THREE.Vector3(p.x, h + 0.45, p.z)), color, true, 0.95);
        overlay.add(sectionLine);
      });
    }
  }, [
    history.state.step,
    history.state.contour,
    history.state.contourClosed,
    history.state.cutHeight,
    history.state.cutReady,
    history.state.showSection,
    history.state.sizeX,
    history.state.sizeZ,
    history.state.minY,
    history.state.maxY,
    pipeline?.projectedCurve,
    pipeline?.sectionLoops,
    preview?.loops,
  ]);

  return <div ref={hostRef} className="viewport-host" aria-label="Three.js 手办分件视口" />;
}
