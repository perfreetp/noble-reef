// 撤销/重做：事务式快照栈。
// 每次 commit 保存变更前后的深拷贝；同一 coalesceKey 在窗口内的连续提交合并为一条历史。
import { HISTORY_LIMIT } from './constants.js';

export class History {
  constructor(initial = null) {
    this.past = [];   // { label, before, after, key, time }
    this.future = [];
    this.coalesceMs = 700;
    this.lastKey = null;
    this.lastTime = 0;
    this.onChange = null;
    this._base = initial == null ? null : this._clone(initial);
  }

  _clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /**
   * 执行一次变更并入栈。
   * @param label 历史条目名称
   * @param getState 返回当前状态的函数
   * @param setState 恢复状态的函数
   * @param mutate (draft) => void 在 draft 上直接修改
   * @param coalesceKey 连续相同 key 的提交合并（如拖拽、连续输入）
   */
  commit(label, getState, setState, mutate, coalesceKey = null) {
    const now = Date.now();
    const before = this._clone(getState());
    const draft = this._clone(before);
    mutate(draft);
    setState(draft);
    const after = this._clone(getState());

    if (JSON.stringify(before) === JSON.stringify(after)) return;

    const top = this.past[this.past.length - 1];
    if (
      coalesceKey &&
      top &&
      top.key === coalesceKey &&
      now - top.time < this.coalesceMs
    ) {
      top.after = after;
      top.time = now;
    } else {
      this.past.push({ label, before, after, key: coalesceKey, time: now });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    this.lastKey = coalesceKey;
    this.lastTime = now;
    this._notify();
  }

  undo(getState, setState) {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push(entry);
    setState(this._clone(entry.before));
    this._notify();
  }

  redo(getState, setState) {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push(entry);
    setState(this._clone(entry.after));
    this._notify();
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get labels() {
    return {
      undo: this.past[this.past.length - 1]?.label ?? null,
      redo: this.future[this.future.length - 1]?.label ?? null
    };
  }

  clear(getState) {
    this.past = [];
    this.future = [];
    this._base = this._clone(getState());
    this._notify();
  }

  _notify() {
    this.onChange?.();
  }
}
