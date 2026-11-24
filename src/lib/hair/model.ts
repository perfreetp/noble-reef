import * as THREE from 'three';
import { computeCurve, hashSeed } from './curve';
import {
  cloneBundle,
  genId,
  PARAM_LIMITS,
  type Anchor,
  type BundleParams,
  type HairBundle,
  type HairGroup,
  type ParamKey,
} from './types';

export interface ModelChange {
  /** 几何需要重建的发束 */
  dirty: Set<string>;
  /** 结构变化（增/删/载入）：渲染器需要重排分块 */
  structural: boolean;
}

type Listener = (c: ModelChange) => void;

/**
 * 发束数据核心（非响应式）。所有编辑都通过命令层调用这里的方法，
 * 每次变更发出 ModelChange，渲染器据此做增量重建。
 */
export class HairModel {
  readonly bundles = new Map<string, HairBundle>();
  readonly groups = new Map<string, HairGroup>();
  private curveCache = new Map<string, THREE.Vector3[]>();
  private listeners = new Set<Listener>();

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(dirty: Iterable<string>, structural = false): void {
    const change: ModelChange = { dirty: new Set(dirty), structural };
    for (const fn of this.listeners) fn(change);
  }

  /** 发束中心线（带缓存；参数/锚点变更时失效） */
  getCurve(id: string, segments = 16): THREE.Vector3[] {
    const cached = this.curveCache.get(id);
    if (cached) return cached;
    const b = this.bundles.get(id);
    if (!b) return [];
    const curve = computeCurve(b.anchor, b.params, hashSeed(id), segments);
    this.curveCache.set(id, curve);
    return curve;
  }

  invalidate(ids: Iterable<string>): void {
    for (const id of ids) this.curveCache.delete(id);
  }

  /** 外部直接改完参数后调用：失效缓存并通知渲染器 */
  touch(ids: Iterable<string>): void {
    this.invalidate(ids);
    this.emit(ids);
  }

  // ---- 结构操作 ----

  addBundle(bundle: HairBundle): void {
    this.bundles.set(bundle.id, bundle);
    this.emit([bundle.id], true);
  }

  removeBundles(ids: string[]): void {
    for (const id of ids) {
      this.bundles.delete(id);
      this.curveCache.delete(id);
    }
    for (const g of this.groups.values()) {
      g.memberIds = g.memberIds.filter((m) => this.bundles.has(m));
    }
    this.emit(ids, true);
  }

  createBundle(anchor: Anchor, params: BundleParams, color: string): HairBundle {
    const maxLayer = Math.max(0, ...[...this.bundles.values()].map((b) => b.layer));
    const bundle: HairBundle = {
      id: genId('b'),
      anchor,
      params,
      groupId: null,
      layer: maxLayer + 1,
      color,
    };
    this.addBundle(bundle);
    return bundle;
  }

  // ---- 参数 / 锚点变更（命令层负责快照） ----

  setParam(id: string, key: ParamKey, value: number): void {
    const b = this.bundles.get(id);
    if (!b) return;
    const lim = PARAM_LIMITS[key];
    b.params[key] = Math.min(lim.max, Math.max(lim.min, value));
    this.curveCache.delete(id);
    this.emit([id]);
  }

  setAnchor(id: string, anchor: Anchor): void {
    const b = this.bundles.get(id);
    if (!b) return;
    b.anchor = anchor;
    this.curveCache.delete(id);
    this.emit([id]);
  }

  setLayer(id: string, layer: number): void {
    const b = this.bundles.get(id);
    if (!b) return;
    b.layer = layer;
    this.emit([id]);
  }

  /** 组联动：对组内所有成员按同一增量调整（保持相对关系） */
  applyGroupDelta(groupId: string, key: ParamKey, delta: number): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    const lim = PARAM_LIMITS[key];
    for (const mid of g.memberIds) {
      const b = this.bundles.get(mid);
      if (!b) continue;
      b.params[key] = Math.min(lim.max, Math.max(lim.min, b.params[key] + delta));
      this.curveCache.delete(mid);
    }
    this.emit(g.memberIds);
  }

  // ---- 分组 ----

  createGroup(name: string, memberIds: string[]): HairGroup {
    const group: HairGroup = { id: genId('g'), name, memberIds: [...memberIds] };
    this.groups.set(group.id, group);
    for (const id of memberIds) {
      const b = this.bundles.get(id);
      if (b) b.groupId = group.id;
    }
    this.emit(memberIds);
    return group;
  }

  dissolveGroup(groupId: string): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    for (const id of g.memberIds) {
      const b = this.bundles.get(id);
      if (b) b.groupId = null;
    }
    this.groups.delete(groupId);
    this.emit(g.memberIds);
  }

  // ---- 快照（撤销/重做与文件载入用） ----

  snapshot(ids: Iterable<string>): Map<string, HairBundle | null> {
    const snap = new Map<string, HairBundle | null>();
    for (const id of ids) {
      const b = this.bundles.get(id);
      snap.set(id, b ? cloneBundle(b) : null);
    }
    return snap;
  }

  snapshotAll(): { bundles: HairBundle[]; groups: HairGroup[] } {
    return {
      bundles: [...this.bundles.values()].map(cloneBundle),
      groups: [...this.groups.values()].map((g) => ({ ...g, memberIds: [...g.memberIds] })),
    };
  }

  restore(snap: Map<string, HairBundle | null>): void {
    const dirty: string[] = [];
    for (const [id, b] of snap) {
      if (b === null) {
        this.bundles.delete(id);
      } else {
        this.bundles.set(id, cloneBundle(b));
      }
      this.curveCache.delete(id);
      dirty.push(id);
    }
    // 清理组内悬空引用
    for (const g of this.groups.values()) {
      g.memberIds = g.memberIds.filter((m) => this.bundles.has(m));
    }
    this.emit(dirty, true);
  }

  restoreAll(data: { bundles: HairBundle[]; groups: HairGroup[] }): void {
    this.bundles.clear();
    this.groups.clear();
    this.curveCache.clear();
    for (const b of data.bundles) this.bundles.set(b.id, cloneBundle(b));
    for (const g of data.groups) this.groups.set(g.id, { ...g, memberIds: [...g.memberIds] });
    this.emit(this.bundles.keys(), true);
  }

  clear(): void {
    this.restoreAll({ bundles: [], groups: [] });
  }
}

export const model = new HairModel();
