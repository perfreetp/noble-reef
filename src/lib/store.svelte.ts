import {
  type Block,
  DOC_FILE_MARKER,
  type Doc,
  type Nozzle,
  type NozzleGroup,
  type ProjectFile,
  type RectArraySpec,
  type RingArraySpec
} from './types';
import { buildBlock, buildGroup, buildNozzle, buildRectArray, buildRingArray, createDefaultDoc } from './doc-factory';
import { clamp, uid } from './util';

const HISTORY_LIMIT = 100;

/**
 * 工程中央 Store。
 * 以不可变快照实现撤销/重做：每次提交把当前 doc 深拷贝压栈。
 * 上千喷头的结构化克隆在本规模下为亚毫秒~数毫秒，足够流畅。
 */
export class DocStore {
  // 使用 $state.raw：doc 保持普通对象，structuredClone 可正常深拷贝；
  // 变更后通过整体替换引用来触发 Svelte 响应式更新。
  doc: Doc = $state.raw(createDefaultDoc());
  private past: Doc[] = [];
  private future: Doc[] = [];
  canUndo = $state(false);
  canRedo = $state(false);
  /** 单调递增的版本号，每次提交 +1，供 Pixi 渲染层判断是否需要重建 */
  version = $state(0);
  /** 结构发生变化（喷头/分组增删），渲染层需要重建容器 */
  structureVersion = $state(0);
  /** 播放/高亮状态变化用，不进入历史 */
  private listeners = new Set<() => void>();

  // ---------- 历史 ----------
  private snapshot(): Doc {
    return structuredClone(this.doc);
  }

  private refreshFlags() {
    this.canUndo = this.past.length > 0;
    this.canRedo = this.future.length > 0;
  }

  /**
   * $state.raw 为浅响应式：原地修改后需赋一个新的顶层引用才会通知 Svelte。
   * 浅拷贝成本固定（与喷头数量无关），喷嘴数组等内部引用保持不变，
   * Pixi 渲染层通过 version/structureVersion 自行判断是否重建。
   */
  private touch() {
    this.doc = { ...this.doc };
  }

  /** 提交一次变更（mutator 直接修改 this.doc） */
  commit(mutator: (d: Doc) => void, structural = false) {
    this.past.push(this.snapshot());
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
    mutator(this.doc);
    this.touch();
    this.version++;
    if (structural) this.structureVersion++;
    this.refreshFlags();
    this.emit();
  }

  /** 高频拖拽用：先 begin 拿快照，过程中直接改 doc 并 bump()，结束时 end() */
  beginInteraction() {
    if (this._interactionSnap) return;
    this._interactionSnap = this.snapshot();
    this.past.push(this._interactionSnap);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
  }
  private _interactionSnap: Doc | null = null;

  bump() {
    this.touch();
    this.version++;
    this.emit();
  }

  endInteraction(structural = false) {
    if (!this._interactionSnap) return;
    this._interactionSnap = null;
    this.touch();
    this.version++;
    if (structural) this.structureVersion++;
    this.refreshFlags();
    this.emit();
  }

  cancelInteraction() {
    if (!this._interactionSnap) return;
    this.doc = this._interactionSnap;
    this._interactionSnap = null;
    this.past.pop();
    this.version++;
    this.refreshFlags();
    this.emit();
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.snapshot());
    this.doc = prev;
    this.version++;
    this.structureVersion++;
    this.refreshFlags();
    this.emit();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.doc = next;
    this.version++;
    this.structureVersion++;
    this.refreshFlags();
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  // ---------- 查询 ----------
  get totalBeats(): number {
    return this.doc.beatsPerBar * this.doc.barCount;
  }

  get nozzleCount(): number {
    return this.doc.nozzles.length;
  }

  groupById(id: string): NozzleGroup | undefined {
    return this.doc.groups.find((g) => g.id === id);
  }

  nozzleById(id: string): Nozzle | undefined {
    return this.doc.nozzles.find((n) => n.id === id);
  }

  /** 取某分组在某节拍的强度（无色块=0） */
  intensityAt(groupId: string, beatIndex: number): number {
    const b = this.doc.blocks.find((x) => x.groupId === groupId && x.beatIndex === beatIndex);
    return b ? b.intensity : 0;
  }

  /** 当前节拍下所有激活分组 id -> 强度 */
  activeGroupsAtBeat(beatIndex: number): Map<string, number> {
    const m = new Map<string, number>();
    for (const b of this.doc.blocks) {
      if (b.beatIndex === beatIndex && b.intensity > 0) m.set(b.groupId, b.intensity);
    }
    return m;
  }

  // ---------- 分组 ----------
  addGroup(name?: string): NozzleGroup {
    const g = buildGroup(name ?? `分组 ${this.doc.groups.length + 1}`, this.doc.groups.length);
    this.commit((d) => d.groups.push(g), true);
    return g;
  }

  renameGroup(id: string, name: string) {
    this.commit((d) => {
      const g = d.groups.find((x) => x.id === id);
      if (g) g.name = name;
    });
  }

  recolorGroup(id: string, color: string) {
    this.commit((d) => {
      const g = d.groups.find((x) => x.id === id);
      if (g) g.color = color;
    });
  }

  removeGroup(id: string) {
    this.commit(
      (d) => {
        d.groups = d.groups.filter((g) => g.id !== id);
        d.blocks = d.blocks.filter((b) => b.groupId !== id);
        for (const n of d.nozzles) if (n.groupId === id) n.groupId = '';
      },
      true
    );
  }

  // ---------- 喷头 ----------
  addSingleNozzle(x: number, y: number, groupId = '', angle = 90): Nozzle {
    const n = buildNozzle(x, y, groupId, angle);
    this.commit((d) => d.nozzles.push(n), true);
    return n;
  }

  addRectArray(cx: number, cy: number, spec: RectArraySpec): number {
    const list = buildRectArray(cx, cy, spec);
    this.commit((d) => d.nozzles.push(...list), true);
    return list.length;
  }

  addRingArray(cx: number, cy: number, spec: RingArraySpec): number {
    const list = buildRingArray(cx, cy, spec);
    this.commit((d) => d.nozzles.push(...list), true);
    return list.length;
  }

  removeNozzles(ids: Set<string>) {
    if (ids.size === 0) return;
    this.commit(
      (d) => {
        d.nozzles = d.nozzles.filter((n) => !ids.has(n.id));
      },
      true
    );
  }

  /** 拖拽移动（交互内高频调用，配合 begin/endInteraction） */
  moveNozzle(id: string, x: number, y: number) {
    const n = this.nozzleById(id);
    if (!n) return;
    n.x = Math.round(x * 10) / 10;
    n.y = Math.round(y * 10) / 10;
    this.bump();
  }

  setNozzleAngle(id: string, angle: number) {
    const n = this.nozzleById(id);
    if (!n) return;
    n.angle = ((angle % 360) + 360) % 360;
    this.bump();
  }

  assignGroup(ids: Set<string>, groupId: string) {
    if (ids.size === 0) return;
    this.commit((d) => {
      for (const n of d.nozzles) if (ids.has(n.id)) n.groupId = groupId;
    });
  }

  // ---------- 时间轴色块 ----------
  /** 设置（或删除，intensity<=0）某分组某节拍的色块 */
  setBlock(groupId: string, beatIndex: number, intensity: number) {
    const v = clamp(Math.round(intensity * 100) / 100, 0, 1);
    this.commit((d) => {
      const idx = d.blocks.findIndex((b) => b.groupId === groupId && b.beatIndex === beatIndex);
      if (v <= 0) {
        if (idx >= 0) d.blocks.splice(idx, 1);
      } else if (idx >= 0) {
        d.blocks[idx].intensity = v;
      } else {
        d.blocks.push(buildBlock(groupId, beatIndex, v));
      }
    });
  }

  /** 拖拽绘制过程中使用：不压栈的临时写入，松手时由调用方压一次快照 */
  private painting = false;
  beginPaint() {
    if (this.painting) return;
    this.painting = true;
    this.past.push(this.snapshot());
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
  }

  paintBlock(groupId: string, beatIndex: number, intensity: number) {
    const v = clamp(Math.round(intensity * 100) / 100, 0, 1);
    const d = this.doc;
    const idx = d.blocks.findIndex((b) => b.groupId === groupId && b.beatIndex === beatIndex);
    if (v <= 0) {
      if (idx >= 0) d.blocks.splice(idx, 1);
    } else if (idx >= 0) {
      d.blocks[idx].intensity = v;
    } else {
      d.blocks.push(buildBlock(groupId, beatIndex, v));
    }
    this.touch();
    this.version++;
    this.emit();
  }

  endPaint() {
    if (!this.painting) return;
    this.painting = false;
    this.touch();
    this.version++;
    this.refreshFlags();
    this.emit();
  }

  cancelPaint() {
    if (!this.painting) return;
    this.painting = false;
    const snap = this.past.pop();
    if (snap) this.doc = snap;
    this.version++;
    this.refreshFlags();
    this.emit();
  }

  /** 复制某一小节的全部色块到目标小节（目标小节原有内容被覆盖） */
  copyBar(fromBar: number, toBar: number) {
    this.commit((d) => {
      const startFrom = fromBar * d.beatsPerBar;
      const startTo = toBar * d.beatsPerBar;
      // 先清空目标小节
      d.blocks = d.blocks.filter(
        (b) => b.beatIndex < startTo || b.beatIndex >= startTo + d.beatsPerBar
      );
      // 先快照源小节（遍历的是过滤后的独立数组，避免边遍历边追加）
      const source = d.blocks.filter(
        (b) => b.beatIndex >= startFrom && b.beatIndex < startFrom + d.beatsPerBar
      );
      for (const b of source) {
        d.blocks.push({ ...b, id: uid('blk'), beatIndex: b.beatIndex - startFrom + startTo });
      }
    });
  }

  clearBar(bar: number) {
    this.commit((d) => {
      const start = bar * d.beatsPerBar;
      d.blocks = d.blocks.filter((b) => b.beatIndex < start || b.beatIndex >= start + d.beatsPerBar);
    });
  }

  setTimelineConfig(partial: Partial<Pick<Doc, 'bpm' | 'barCount' | 'beatsPerBar'>>) {
    this.commit((d) => {
      Object.assign(d, partial);
      const maxBeat = d.beatsPerBar * d.barCount;
      d.blocks = d.blocks.filter((b) => b.beatIndex < maxBeat);
    });
  }

  // ---------- 广场配置 ----------
  updateConfig(partial: Partial<Doc['config']>) {
    this.commit((d) => {
      Object.assign(d.config, partial);
    });
  }

  updatePool(partial: Partial<Doc['config']['pool']>) {
    this.commit((d) => {
      Object.assign(d.config.pool, partial);
    });
  }

  // ---------- 导入导出 ----------
  exportFile(): ProjectFile {
    return {
      app: DOC_FILE_MARKER,
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      doc: structuredClone(this.doc)
    };
  }

  exportJSON(): string {
    return JSON.stringify(this.exportFile(), null, 2);
  }

  importJSON(text: string): Doc {
    const data = JSON.parse(text) as ProjectFile;
    if (data.app !== DOC_FILE_MARKER || !data.doc || !Array.isArray(data.doc.nozzles)) {
      throw new Error('文件格式无效：不是水景广场编排工程文件');
    }
    const doc = migrate(data.doc);
    this.past.push(this.snapshot());
    this.future.length = 0;
    this.doc = doc;
    this.version++;
    this.structureVersion++;
    this.refreshFlags();
    this.emit();
    return doc;
  }

  resetToDefault() {
    this.past.push(this.snapshot());
    this.future.length = 0;
    this.doc = createDefaultDoc();
    this.version++;
    this.structureVersion++;
    this.refreshFlags();
    this.emit();
  }
}

function migrate(doc: Doc): Doc {
  // 预留：未来版本升级在这里补字段
  return doc;
}

// 全局单例
export const store = new DocStore();

// 避免 tree-shaking 误判类型引用
export type { Block };
