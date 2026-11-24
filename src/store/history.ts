import { createSignal } from 'solid-js';
import { HISTORY_LIMIT } from '../config/constants';
import type { SliceKey } from '../types/project';

export interface MutationToken {
  label: string;
  keys: SliceKey[];
  before: Partial<Record<SliceKey, unknown>>;
}

interface Entry {
  label: string;
  before: Partial<Record<SliceKey, unknown>>;
  after: Partial<Record<SliceKey, unknown>>;
}

export interface HistoryAdapter {
  /** 取当前切片引用 */
  getSlice: (key: SliceKey) => unknown;
  /** 把快照切片写回 store（terrain 需在此刷新 revision 以触发联动） */
  applySlices: (slices: Partial<Record<SliceKey, unknown>>, direction: 'undo' | 'redo') => void;
}

/**
 * 快照栈 + 切片结构共享。
 * - 地形：调用方在 begin 时把 heights 克隆为新工作数组，旧数组成为不可变快照，
 *   相邻条目共享同一数组引用，20 步稳态内存 ≈ 21 × 256 KiB。
 * - 路径/设施/视点/植被：Solid 不可变更新天然产生新引用，仅捕获引用，零拷贝。
 */
export class HistoryStack {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private readonly canUndoSignal = createSignal(false);
  private readonly canRedoSignal = createSignal(false);
  readonly canUndo = this.canUndoSignal[0];
  readonly canRedo = this.canRedoSignal[0];
  private lastLabel = createSignal<string>('');
  readonly lastActionLabel = this.lastLabel[0];

  constructor(private readonly adapter: HistoryAdapter) {}

  /** 开始一次变更，捕获受影响切片的当前引用 */
  begin(label: string, keys: SliceKey[]): MutationToken {
    const before: Partial<Record<SliceKey, unknown>> = {};
    for (const k of keys) before[k] = this.adapter.getSlice(k);
    return { label, keys, before };
  }

  /** 提交变更，捕获新引用并入栈；新操作清空 redo 栈 */
  commit(token: MutationToken): void {
    const after: Partial<Record<SliceKey, unknown>> = {};
    for (const k of token.keys) after[k] = this.adapter.getSlice(k);
    this.undoStack.push({ label: token.label, before: token.before, after });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.syncSignals(token.label);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.adapter.applySlices(entry.before, 'undo');
    this.redoStack.push(entry);
    this.syncSignals(entry.label);
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.adapter.applySlices(entry.after, 'redo');
    this.undoStack.push(entry);
    this.syncSignals(entry.label);
  }

  /** 放弃进行中的变更：回滚到 begin 前状态，不入栈（拖拽中途离开场景用） */
  cancel(token: MutationToken): void {
    this.adapter.applySlices(token.before, 'undo');
  }

  /** 导入工程后清空历史 */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.syncSignals('');
  }

  private syncSignals(label: string): void {
    this.canUndoSignal[1](this.undoStack.length > 0);
    this.canRedoSignal[1](this.redoStack.length > 0);
    this.lastLabel[1](label);
  }
}
