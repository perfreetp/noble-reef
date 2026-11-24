import { writable } from 'svelte/store';
import { model } from './model';
import type { HairBundle, HairGroup } from './types';

interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

const MAX_HISTORY = 200;

class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  /** 供 UI 响应式绑定 */
  readonly canUndo = writable(false);
  readonly canRedo = writable(false);
  readonly lastLabel = writable<string>('');

  private sync(): void {
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
    this.lastLabel.set(this.undoStack.at(-1)?.label ?? '');
  }

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.sync();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.sync();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
    this.sync();
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.sync();
  }
}

export const history = new History();

// ---- 命令构造助手 ----

/**
 * 通用快照命令：记录一组发束在操作前后的完整状态。
 * 恢复时整束写回，保证回退后形态与之前完全一致。
 */
export function commitBundleChange(
  label: string,
  ids: string[],
  mutate: () => void,
): void {
  const before = model.snapshot(ids);
  mutate();
  const after = model.snapshot(ids);
  history.push({
    label,
    undo: () => model.restore(before),
    redo: () => model.restore(after),
  });
}

/** 连续拖动类操作：调用方先拿 before，操作结束后提交 */
export function beginDragSnapshot(ids: string[]): Map<string, HairBundle | null> {
  return model.snapshot(ids);
}

export function endDragSnapshot(
  label: string,
  ids: string[],
  before: Map<string, HairBundle | null>,
): void {
  const after = model.snapshot(ids);
  // 无实际变化则不产生历史记录
  let same = true;
  for (const [id, b] of before) {
    const a = after.get(id);
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      same = false;
      break;
    }
  }
  if (same) return;
  history.push({
    label,
    undo: () => model.restore(before),
    redo: () => model.restore(after),
  });
}

/** 新建发束命令 */
export function commitCreate(bundleId: string): void {
  // 捕获创建后的完整状态供 redo 使用
  const created = model.bundles.get(bundleId);
  if (!created) return;
  const createdSnapshot: HairBundle = {
    ...created,
    anchor: { position: [...created.anchor.position], normal: [...created.anchor.normal] },
    params: { ...created.params },
  };
  history.push({
    label: '新建发束',
    undo: () => model.removeBundles([bundleId]),
    redo: () => model.restore(new Map([[bundleId, createdSnapshot]])),
  });
}

/** 分组命令（成组/解组都可撤销） */
export function commitGroupCreate(name: string, memberIds: string[]): string {
  const before = model.snapshot(memberIds);
  const group = model.createGroup(name, memberIds);
  const groupId = group.id;
  const after = model.snapshot(memberIds);
  history.push({
    label: '成组',
    undo: () => {
      model.dissolveGroup(groupId);
      model.restore(before);
    },
    redo: () => {
      model.restore(after);
      // restore 不恢复组表，需要重建组
      if (!model.groups.has(groupId)) {
        model.groups.set(groupId, { id: groupId, name, memberIds: [...memberIds] });
        for (const id of memberIds) {
          const b = model.bundles.get(id);
          if (b) b.groupId = groupId;
        }
      }
    },
  });
  return groupId;
}

export function commitGroupDissolve(groupId: string): void {
  const g = model.groups.get(groupId);
  if (!g) return;
  const groupCopy: HairGroup = { ...g, memberIds: [...g.memberIds] };
  const before = model.snapshot(g.memberIds);
  model.dissolveGroup(groupId);
  const after = model.snapshot(groupCopy.memberIds);
  history.push({
    label: '解散组',
    undo: () => {
      model.groups.set(groupId, { ...groupCopy, memberIds: [...groupCopy.memberIds] });
      model.restore(before);
    },
    redo: () => {
      model.groups.delete(groupId);
      model.restore(after);
    },
  });
}
