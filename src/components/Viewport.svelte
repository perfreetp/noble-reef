<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import { Scalp } from '../lib/hair/scalp';
  import { HairRenderer } from '../lib/hair/renderer';
  import { model } from '../lib/hair/model';
  import {
    beginDragSnapshot,
    endDragSnapshot,
    commitCreate,
    history,
  } from '../lib/hair/history';
  import { applyBrush, applyComb, emitDirty } from '../lib/hair/tools';
  import { detectIntersections } from '../lib/hair/intersect';
  import {
    activeTool,
    brushRadius,
    intersections,
    selection,
    bumpModelVersion,
  } from '../lib/state/stores';
  import { DEFAULT_PARAMS, HAIR_COLORS, type HairBundle } from '../lib/hair/types';
  import { shared } from '../lib/state/context';
  import { get } from 'svelte/store';

  let container: HTMLDivElement;

  onMount(() => {
    // ---- 渲染基础 ----
    const renderer3 = new THREE.WebGLRenderer({ antialias: true });
    renderer3.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer3.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer3.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c1e22);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      100,
    );
    camera.position.set(0, 0.5, 3.4);

    const controls = new OrbitControls(camera, renderer3.domElement);
    controls.target.set(0, 0.1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.15; // 允许局部放大查看发根衔接
    controls.maxDistance = 10;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x333a44, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 2.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8899ff, 0.5);
    rim.position.set(-2, 1, -2);
    scene.add(rim);

    const scalp = new Scalp();
    scene.add(scalp.group);
    shared.scalp = scalp;

    const hairRenderer = new HairRenderer(model);
    scene.add(hairRenderer.group);
    hairRenderer.rebuildLayout();

    // 新建发束拖拽预览线
    const previewGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const preview = new THREE.Line(
      previewGeo,
      new THREE.LineBasicMaterial({ color: 0xffc060 }),
    );
    preview.visible = false;
    scene.add(preview);

    // ---- 模型变更 -> 渲染 & 面板 ----
    let intersectTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleIntersectionCheck() {
      if (intersectTimer) clearTimeout(intersectTimer);
      intersectTimer = setTimeout(() => {
        const pairs = detectIntersections(model);
        intersections.set(pairs);
        const hot = new Set<string>();
        for (const p of pairs) {
          hot.add(p.a);
          hot.add(p.b);
        }
        hairRenderer.setHighlight(hot);
      }, 250);
    }
    const offModel = model.onChange(({ dirty, structural }) => {
      hairRenderer.onModelChange(dirty, structural);
      bumpModelVersion();
      scheduleIntersectionCheck();
    });
    const offSel = selection.subscribe((s) => hairRenderer.setSelection(s));

    // ---- 拾取 ----
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function setRay(e: PointerEvent): THREE.Ray {
      const rect = renderer3.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray;
    }

    function pickHandle(e: PointerEvent): string | null {
      setRay(e);
      const hits = raycaster.intersectObject(hairRenderer.handles);
      const hit = hits[0];
      if (hit && hit.instanceId !== undefined) {
        return hairRenderer.handleIds()[hit.instanceId] ?? null;
      }
      // 屏幕空间兜底：12px 内最近的手柄
      const rect = renderer3.domElement.getBoundingClientRect();
      const v = new THREE.Vector3();
      let bestId: string | null = null;
      let bestDist = 12;
      const ids = hairRenderer.handleIds();
      for (let i = 0; i < ids.length; i++) {
        const b = model.bundles.get(ids[i]!);
        if (!b) continue;
        v.set(...b.anchor.position).project(camera);
        const sx = ((v.x + 1) / 2) * rect.width;
        const sy = ((1 - v.y) / 2) * rect.height;
        const d = Math.hypot(sx - (e.clientX - rect.left), sy - (e.clientY - rect.top));
        if (d < bestDist) {
          bestDist = d;
          bestId = ids[i]!;
        }
      }
      return bestId;
    }

    // ---- 交互状态机 ----
    type DragState =
      | { kind: 'none' }
      | { kind: 'maybe-click'; x: number; y: number }
      | { kind: 'root'; id: string; before: Map<string, HairBundle | null> }
      | { kind: 'add'; anchorPoint: THREE.Vector3; anchorNormal: THREE.Vector3 }
      | { kind: 'stroke'; tool: 'comb' | 'brush'; before: Map<string, HairBundle | null>; lastX: number; lastY: number };
    let drag: DragState = { kind: 'none' };

    function strokeSnapshot(id: string, before: Map<string, HairBundle | null>) {
      if (!before.has(id)) {
        const snap = model.snapshot([id]);
        before.set(id, snap.get(id) ?? null);
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const tool = get(activeTool);
      if (tool === 'select') {
        const id = pickHandle(e);
        if (id) {
          // 选择逻辑
          let cur = new Set(get(selection));
          if (e.shiftKey) {
            if (cur.has(id)) cur.delete(id);
            else cur.add(id);
          } else if (!cur.has(id)) {
            cur = new Set([id]);
          }
          selection.set(cur);
          drag = { kind: 'root', id, before: beginDragSnapshot([id]) };
          controls.enabled = false;
          renderer3.domElement.setPointerCapture(e.pointerId);
          return;
        }
        drag = { kind: 'maybe-click', x: e.clientX, y: e.clientY };
        return; // 不禁用 OrbitControls，保留旋转视角
      }
      if (tool === 'add') {
        const hit = scalp.projectRay(setRay(e));
        if (!hit) return;
        drag = { kind: 'add', anchorPoint: hit.point, anchorNormal: hit.normal };
        preview.visible = true;
        controls.enabled = false;
        renderer3.domElement.setPointerCapture(e.pointerId);
        return;
      }
      if (tool === 'comb' || tool === 'brush') {
        drag = { kind: 'stroke', tool, before: new Map(), lastX: e.clientX, lastY: e.clientY };
        controls.enabled = false;
        renderer3.domElement.setPointerCapture(e.pointerId);
        return;
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (drag.kind === 'root') {
        const hit = scalp.projectRay(setRay(e));
        if (hit) {
          // 整束跟随：只改锚点，曲线相对发根重算，发根始终贴住曲面
          model.setAnchor(drag.id, {
            position: [hit.point.x, hit.point.y, hit.point.z],
            normal: [hit.normal.x, hit.normal.y, hit.normal.z],
          });
        }
        return;
      }
      if (drag.kind === 'add') {
        // 预览：从锚点沿拖拽方向拉出
        const ray = setRay(e);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camera.getWorldDirection(new THREE.Vector3()).negate(),
          drag.anchorPoint,
        );
        const p = new THREE.Vector3();
        ray.intersectPlane(plane, p);
        if (p) {
          const pos = previewGeo.getAttribute('position') as THREE.BufferAttribute;
          pos.setXYZ(0, drag.anchorPoint.x, drag.anchorPoint.y, drag.anchorPoint.z);
          pos.setXYZ(1, p.x, p.y, p.z);
          pos.needsUpdate = true;
        }
        return;
      }
      if (drag.kind === 'stroke') {
        const ray = setRay(e);
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        const radius = get(brushRadius);
        let affected: string[];
        if (drag.tool === 'comb') {
          // 拖拽方向换算到世界系（相机右/上向量合成）
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const dragDir = right
            .multiplyScalar(dx)
            .addScaledVector(up, -dy);
          if (dragDir.lengthSq() < 1e-8) return;
          dragDir.normalize();
          affected = applyComb(ray, dragDir, radius, 0.35);
        } else {
          affected = applyBrush(ray, radius, 0.4);
        }
        for (const id of affected) strokeSnapshot(id, drag.before);
        emitDirty(affected);
        return;
      }
    }

    function onPointerUp(e: PointerEvent) {
      const d = drag;
      drag = { kind: 'none' };
      controls.enabled = true;
      if (renderer3.domElement.hasPointerCapture(e.pointerId)) {
        renderer3.domElement.releasePointerCapture(e.pointerId);
      }
      if (d.kind === 'maybe-click') {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4 && !e.shiftKey) {
          selection.set(new Set()); // 点击空白取消选择
        }
        return;
      }
      if (d.kind === 'root') {
        endDragSnapshot('拖动发根', [d.id], d.before);
        return;
      }
      if (d.kind === 'add') {
        preview.visible = false;
        const ray = setRay(e);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camera.getWorldDirection(new THREE.Vector3()).negate(),
          d.anchorPoint,
        );
        const p = new THREE.Vector3();
        ray.intersectPlane(plane, p);
        // 拖拽向量决定初始弯曲方向与长度
        const dragVec = p ? p.clone().sub(d.anchorPoint) : new THREE.Vector3();
        const n = d.anchorNormal;
        const tangent = dragVec.clone().addScaledVector(n, -dragVec.dot(n));
        let direction = DEFAULT_PARAMS.direction;
        if (tangent.lengthSq() > 1e-8) {
          tangent.normalize();
          const t1 = new THREE.Vector3();
          const t2 = new THREE.Vector3();
          const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
          t1.crossVectors(n, ref).normalize();
          t2.crossVectors(n, t1).normalize();
          direction = (Math.atan2(tangent.dot(t2), tangent.dot(t1)) * 180) / Math.PI;
          direction = (direction + 360) % 360;
        }
        const length = Math.min(2.5, Math.max(0.3, dragVec.length() * 2.2));
        const color = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)]!;
        const bundle = model.createBundle(
          {
            position: [d.anchorPoint.x, d.anchorPoint.y, d.anchorPoint.z],
            normal: [n.x, n.y, n.z],
          },
          { ...DEFAULT_PARAMS, direction, length },
          color,
        );
        commitCreate(bundle.id);
        selection.set(new Set([bundle.id]));
        return;
      }
      if (d.kind === 'stroke') {
        const ids = [...d.before.keys()];
        if (ids.length) {
          endDragSnapshot(d.tool === 'comb' ? '梳子理顺' : '刷子蓬松', ids, d.before);
        }
        return;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = [...get(selection)];
        if (ids.length) {
          // 删除选中（可撤销）
          const before = model.snapshot(ids);
          model.removeBundles(ids);
          const after = model.snapshot(ids);
          history.push({
            label: '删除发束',
            undo: () => model.restore(before),
            redo: () => model.restore(after),
          });
          selection.set(new Set());
        }
      }
    }

    const el = renderer3.domElement;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer3.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    let raf = 0;
    function loop() {
      raf = requestAnimationFrame(loop);
      controls.update();
      hairRenderer.update();
      renderer3.render(scene, camera);
    }
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offModel();
      offSel();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      controls.dispose();
      hairRenderer.dispose();
      renderer3.dispose();
      container.removeChild(el);
    };
  });
</script>

<div class="viewport" bind:this={container}></div>

<style>
  .viewport {
    position: absolute;
    inset: 0;
  }
  .viewport :global(canvas) {
    display: block;
    touch-action: none;
  }
</style>
