import * as THREE from 'three';
import { createEffect, createMemo } from 'solid-js';
import { projectStore } from '../../store/projectStore';
import { rebuildPath, type SampledPath } from './pathSampling';
import { buildPathObjects, type PathRenderObjects } from './PathMeshBuilder';
import type { TerrainModel } from '../terrain/TerrainModel';

export interface PathRuntime {
  sampled: SampledPath;
  objects: PathRenderObjects;
  handles: THREE.Mesh[];
}

/**
 * 路径管理器：订阅 store 中路径切片与地形 revision，
 * 按需重建采样与渲染对象。控制点拖拽中可调用 rebuildImmediate 实时刷新。
 */
export class PathManager {
  readonly group = new THREE.Group();
  private readonly runtimes = new Map<string, PathRuntime>();
  private readonly handleGeo = new THREE.SphereGeometry(1.1, 12, 10);
  private readonly handleMat = new THREE.MeshStandardMaterial({
    color: 0xffc23a,
    emissive: 0x7a5200,
    roughness: 0.5,
  });

  constructor(private readonly model: TerrainModel) {
    this.group.name = 'paths';
    // 路径切片变化 → 对账重建
    createEffect(() => {
      void projectStore.pathOrder;
      void JSON.stringify(projectStore.paths);
      this.sync(projectStore.pathOrder);
    });
    // 地形 revision 变化 → 全部路径重吸附（y 派生），与上一 effect 去重
    let lastRev = -1;
    createEffect(() => {
      const rev = projectStore.terrain.revision;
      if (rev === lastRev) return;
      lastRev = rev;
      this.sync(projectStore.pathOrder);
    });
  }

  getRuntime(pathId: string): PathRuntime | undefined {
    return this.runtimes.get(pathId);
  }

  allRuntimes(): PathRuntime[] {
    return [...this.runtimes.values()];
  }

  /** 供面板使用的响应式采样摘要 */
  readonly statsMemo = createMemo(() => {
    void projectStore.terrain.revision;
    void JSON.stringify(projectStore.paths);
    const out: Record<string, { totalLen: number; maxSlopeDeg: number; overLimitLength: number; intervalCount: number }> = {};
    for (const id of projectStore.pathOrder) {
      const sampled = rebuildPath(projectStore.paths[id]!, this.model);
      if (sampled) {
        out[id] = {
          totalLen: sampled.totalLen,
          maxSlopeDeg: sampled.maxSlopeDeg,
          overLimitLength: sampled.overLimitLength,
          intervalCount: sampled.slopeIntervals.length,
        };
      }
    }
    return out;
  });

  private sync(order: string[]): void {
    const live = new Set(order);
    for (const [id, rt] of this.runtimes) {
      if (!live.has(id)) {
        this.group.remove(rt.objects.group);
        rt.objects.dispose();
        this.removeHandles(rt.handles);
        this.runtimes.delete(id);
      }
    }
    for (const id of order) {
      const path = projectStore.paths[id]!;
      const sampled = rebuildPath(path, this.model);
      const existing = this.runtimes.get(id);
      if (!sampled) {
        if (existing) {
          this.group.remove(existing.objects.group);
          existing.objects.dispose();
          this.removeHandles(existing.handles);
          this.runtimes.delete(id);
        }
        continue;
      }
      if (existing) {
        this.group.remove(existing.objects.group);
        existing.objects.dispose();
      }
      const objects = buildPathObjects(path, sampled, this.model);
      const handles = this.syncHandles(path.id, existing?.handles ?? [], path.controlPoints.map((c) => c.id));
      this.group.add(objects.group);
      this.runtimes.set(id, { sampled, objects, handles });
    }
  }

  private removeHandles(handles: THREE.Mesh[]): void {
    for (const h of handles) this.group.remove(h);
  }

  /** handle 对账：同 cpId 复用，多余的移除，缺失的新建；避免每次同步泄漏 mesh */
  private syncHandles(pathId: string, prev: THREE.Mesh[], cpIds: string[]): THREE.Mesh[] {
    const byId = new Map(prev.map((m) => [m.userData.cpId as string, m]));
    const next: THREE.Mesh[] = [];
    const keep = new Set<string>();
    for (const cpId of cpIds) {
      keep.add(cpId);
      let mesh = byId.get(cpId);
      if (!mesh) {
        mesh = new THREE.Mesh(this.handleGeo, this.handleMat);
        mesh.userData = { kind: 'controlPoint', pathId, cpId };
        mesh.castShadow = true;
        this.group.add(mesh);
      }
      this.updateHandleTransform(mesh, pathId, cpId);
      next.push(mesh);
    }
    for (const [cpId, mesh] of byId) {
      if (!keep.has(cpId)) this.group.remove(mesh);
    }
    return next;
  }

  /** 拖拽中实时重建单条路径（含 handle 位置） */
  rebuildImmediate(pathId: string): void {
    const path = projectStore.paths[pathId];
    const existing = this.runtimes.get(pathId);
    if (!path || !existing) return;
    const sampled = rebuildPath(path, this.model);
    if (!sampled) return;
    this.group.remove(existing.objects.group);
    existing.objects.dispose();
    existing.objects = buildPathObjects(path, sampled, this.model);
    existing.sampled = sampled;
    this.group.add(existing.objects.group);
    path.controlPoints.forEach((cp, i) => {
      this.updateHandleTransform(existing.handles[i]!, pathId, cp.id);
    });
  }

  private updateHandleTransform(mesh: THREE.Mesh, pathId: string, cpId: string): void {
    const cp = projectStore.paths[pathId]!.controlPoints.find((c) => c.id === cpId);
    if (!cp) return;
    mesh.position.set(cp.x, this.model.sampleHeightBilinear(cp.x, cp.z) + 1.2, cp.z);
  }

  findHandle(mesh: THREE.Object3D): { pathId: string; cpId: string } | null {
    if (mesh.userData && mesh.userData.kind === 'controlPoint') {
      return { pathId: mesh.userData.pathId, cpId: mesh.userData.cpId };
    }
    return null;
  }

  allHandles(): THREE.Mesh[] {
    return [...this.runtimes.values()].flatMap((rt) => rt.handles);
  }

  dispose(): void {
    for (const rt of this.runtimes.values()) {
      rt.objects.dispose();
      this.removeHandles(rt.handles);
    }
    this.handleGeo.dispose();
    this.handleMat.dispose();
  }
}
