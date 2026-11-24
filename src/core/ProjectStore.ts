import { Emitter } from './events';
import {
  type BlendModeName,
  type CrownProfile,
  type LayerConfig,
  type LayerId,
  type Ornament,
  type OrnamentKind,
  type ProjectConfig,
  LAYER_ORDER,
  isLayerId,
} from './types';

export type StoreEvents = {
  'layer:reorder': { from: number; to: number };
  'layer:change': { layerId: LayerId; index: number };
  'ornament:add': { ornament: Ornament };
  'ornament:update': { ornament: Ornament };
  'ornament:remove': { id: string };
  'crown:change': CrownProfile;
  'project:load': ProjectConfig;
};

let idSeq = 0;
/** 稳定且可读的 id(不用 Math.random,保证导出配置可复现) */
export function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq.toString(36)}-${(performance.now() | 0).toString(36)}`;
}

function defaultLayers(): LayerConfig[] {
  return [
    { id: 'kingfisher', name: '点翠底', opacity: 0.85, blendMode: 'normal', visible: true },
    { id: 'pearl', name: '珠串层', opacity: 1, blendMode: 'normal', visible: true },
    { id: 'metal', name: '金银饰片', opacity: 1, blendMode: 'normal', visible: true },
  ];
}

export function defaultCrown(width: number, height: number): CrownProfile {
  return {
    p0: { x: width * 0.12, y: height * 0.72 },
    p1: { x: width * 0.5, y: height * 0.18 },
    p2: { x: width * 0.88, y: height * 0.72 },
    snapStrength: 0.6,
  };
}

const BLEND_NAMES: BlendModeName[] = [
  'normal', 'add', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light',
];

/**
 * 项目状态中心。
 *
 * 增量重合成约定:
 *  - 改单层参数/图元 -> 标记该层及其上层 dirty
 *  - 拖动层序        -> 全链 dirty(透光累计与遮挡关系整体重算)
 */
export class ProjectStore {
  readonly emitter = new Emitter<StoreEvents>();

  readonly canvas: { width: number; height: number };
  layers: LayerConfig[];
  ornaments: Ornament[] = [];
  crown: CrownProfile;

  /** 脏层下确界(数组 index),从此 index 起向上都需重合成;null = 全部干净 */
  private dirtyFrom: number | null = null;
  private fullDirty = true;

  constructor(width = 1600, height = 1000) {
    this.canvas = { width, height };
    this.layers = defaultLayers();
    this.crown = defaultCrown(width, height);
  }

  /** 取走脏标记并结算:返回需要重合成的起始层 index,无变更返回 null */
  consumeDirty(): number | null {
    if (this.fullDirty) {
      this.fullDirty = false;
      this.dirtyFrom = null;
      return 0;
    }
    const d = this.dirtyFrom;
    this.dirtyFrom = null;
    return d;
  }

  private markFrom(index: number): void {
    this.dirtyFrom = this.dirtyFrom === null ? index : Math.min(this.dirtyFrom, index);
  }

  private markLayer(layerId: LayerId): void {
    const i = this.layers.findIndex((l) => l.id === layerId);
    if (i >= 0) this.markFrom(i);
  }

  layerIndex(layerId: LayerId): number {
    return this.layers.findIndex((l) => l.id === layerId);
  }

  /** 拖动层序:数组下标移动,即时生效并触发全链重算 */
  reorder(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.layers.length || to >= this.layers.length) return;
    const [item] = this.layers.splice(from, 1);
    this.layers.splice(to, 0, item);
    this.fullDirty = true; // 层间顺序变化 -> 透光累计/遮挡整体重算
    this.emitter.emit('layer:reorder', { from, to });
  }

  setLayerOpacity(layerId: LayerId, opacity: number): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;
    layer.opacity = Math.min(1, Math.max(0, opacity));
    this.markLayer(layerId);
    this.emitter.emit('layer:change', { layerId, index: this.layerIndex(layerId) });
  }

  setLayerBlend(layerId: LayerId, blendMode: BlendModeName): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;
    layer.blendMode = blendMode;
    this.markLayer(layerId);
    this.emitter.emit('layer:change', { layerId, index: this.layerIndex(layerId) });
  }

  setLayerVisible(layerId: LayerId, visible: boolean): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;
    layer.visible = visible;
    this.markLayer(layerId);
    this.emitter.emit('layer:change', { layerId, index: this.layerIndex(layerId) });
  }

  addOrnament(kind: OrnamentKind, assetId: string, layer: LayerId, x: number, y: number): Ornament {
    const o: Ornament = {
      id: nextId(kind),
      kind,
      assetId,
      layer,
      x,
      y,
      scale: 1,
      rotation: 0,
      depth: 0.5,
    };
    this.ornaments.push(o);
    this.markLayer(layer);
    this.emitter.emit('ornament:add', { ornament: o });
    return o;
  }

  updateOrnament(id: string, patch: Partial<Omit<Ornament, 'id'>>): void {
    const o = this.ornaments.find((q) => q.id === id);
    if (!o) return;
    const prevLayer = o.layer;
    Object.assign(o, patch);
    this.markLayer(prevLayer);
    if (patch.layer && patch.layer !== prevLayer) this.markLayer(patch.layer);
    this.emitter.emit('ornament:update', { ornament: o });
  }

  removeOrnament(id: string): void {
    const i = this.ornaments.findIndex((q) => q.id === id);
    if (i < 0) return;
    const [o] = this.ornaments.splice(i, 1);
    this.markLayer(o.layer);
    this.emitter.emit('ornament:remove', { id });
  }

  ornamentsOf(layerId: LayerId): Ornament[] {
    return this.ornaments.filter((o) => o.layer === layerId);
  }

  setCrown(patch: Partial<CrownProfile>): void {
    Object.assign(this.crown, patch);
    this.fullDirty = true;
    this.emitter.emit('crown:change', this.crown);
  }

  // ---------- 序列化 / 回读 ----------

  toJSON(): ProjectConfig {
    return {
      version: 1,
      canvas: { ...this.canvas },
      layers: this.layers.map((l) => ({ ...l })),
      ornaments: this.ornaments.map((o) => ({ ...o })),
      crown: JSON.parse(JSON.stringify(this.crown)) as CrownProfile,
    };
  }

  /** 回读:严格校验,损坏字段抛错而不是静默吞掉 */
  loadJSON(cfg: unknown): ProjectConfig {
    if (typeof cfg !== 'object' || cfg === null) throw new Error('配置根节点必须是对象');
    const c = cfg as Record<string, unknown>;
    if (c.version !== 1) throw new Error(`不支持的配置版本: ${String(c.version)}`);
    const canvas = c.canvas as { width?: number; height?: number } | undefined;
    if (!canvas || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') {
      throw new Error('canvas.width / canvas.height 缺失');
    }
    const rawLayers = c.layers as LayerConfig[] | undefined;
    if (!Array.isArray(rawLayers) || rawLayers.length !== LAYER_ORDER.length) {
      throw new Error('layers 必须是三层数组');
    }
    const seen = new Set<LayerId>();
    const layers: LayerConfig[] = rawLayers.map((l) => {
      if (!l || !isLayerId(l.id) || seen.has(l.id)) throw new Error('图层 id 非法或重复');
      seen.add(l.id);
      if (typeof l.opacity !== 'number' || l.opacity < 0 || l.opacity > 1) throw new Error(`图层 ${l.id} 不透明度越界`);
      if (!BLEND_NAMES.includes(l.blendMode)) throw new Error(`图层 ${l.id} 混合模式非法: ${String(l.blendMode)}`);
      return { id: l.id, name: String(l.name ?? l.id), opacity: l.opacity, blendMode: l.blendMode, visible: !!l.visible };
    });
    const rawOrns = c.ornaments as Ornament[] | undefined;
    if (!Array.isArray(rawOrns)) throw new Error('ornaments 必须是数组');
    const ornaments: Ornament[] = rawOrns.map((o, i) => {
      if (!o || typeof o.id !== 'string') throw new Error(`ornaments[${i}].id 非法`);
      if (!isLayerId(o.layer)) throw new Error(`ornaments[${i}].layer 非法`);
      const num = (v: unknown, key: string): number => {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`ornaments[${i}].${key} 必须是数值`);
        return v;
      };
      return {
        id: o.id,
        kind: o.kind,
        assetId: String(o.assetId),
        layer: o.layer,
        x: num(o.x, 'x'),
        y: num(o.y, 'y'),
        scale: num(o.scale, 'scale'),
        rotation: num(o.rotation, 'rotation'),
        depth: Math.min(1, Math.max(0, num(o.depth, 'depth'))),
      };
    });
    const crown = c.crown as CrownProfile | undefined;
    if (!crown?.p0 || !crown.p1 || !crown.p2 || typeof crown.snapStrength !== 'number') {
      throw new Error('crown 冠面曲线字段缺失');
    }

    this.canvas.width = canvas.width;
    this.canvas.height = canvas.height;
    this.layers = layers;
    this.ornaments = ornaments;
    this.crown = JSON.parse(JSON.stringify(crown)) as CrownProfile;
    this.fullDirty = true;
    const snapshot = this.toJSON();
    this.emitter.emit('project:load', snapshot);
    return snapshot;
  }
}
