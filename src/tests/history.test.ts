import { describe, it, expect } from 'vitest';
import { HistoryStack, type HistoryAdapter } from '../store/history';
import { HISTORY_LIMIT } from '../config/constants';
import type { SliceKey } from '../types/project';

interface MiniState {
  heights: Float32Array;
  label: string;
}

const makeHarness = (): {
  history: HistoryStack;
  state: MiniState;
  mutateHeights: (fn: (h: Float32Array) => void, label: string) => void;
  mutateLabel: (label: string) => void;
} => {
  const state: MiniState = { heights: new Float32Array([1, 2, 3, 4]), label: 'init' };
  const adapter: HistoryAdapter = {
    getSlice: (key: SliceKey) =>
      key === 'terrain' ? state.heights : structuredClone({ label: state.label }),
    applySlices: (slices) => {
      if (slices.terrain) state.heights = slices.terrain as Float32Array;
      if (slices.paths) state.label = (slices.paths as { label: string }).label;
    },
  };
  const history = new HistoryStack(adapter);

  return {
    history,
    state,
    mutateHeights: (fn, label) => {
      const token = history.begin(label, ['terrain']);
      // 模拟 stroke：克隆工作数组 → 就地修改 → 提交
      const working = state.heights.slice();
      state.heights = working;
      fn(working);
      history.commit(token);
    },
    mutateLabel: (label) => {
      const token = history.begin('改标签', ['paths']);
      state.label = label;
      history.commit(token);
    },
  };
};

describe('HistoryStack 撤销重做', () => {
  it('stroke 合并为一条历史，undo/redo 往返恢复', () => {
    const h = makeHarness();
    h.mutateHeights((arr) => arr.fill(9), '抬升');
    expect(h.history.canUndo()).toBe(true);
    expect(h.state.heights[0]).toBe(9);
    h.history.undo();
    expect(Array.from(h.state.heights)).toEqual([1, 2, 3, 4]);
    expect(h.history.canRedo()).toBe(true);
    h.history.redo();
    expect(h.state.heights[0]).toBe(9);
  });

  it(`第 ${HISTORY_LIMIT + 1} 条操作淘汰最旧记录`, () => {
    const h = makeHarness();
    for (let i = 0; i < HISTORY_LIMIT + 1; i++) {
      h.mutateHeights((arr) => {
        arr[0] = i + 10;
      }, `op${i}`);
    }
    // 连续 undo 只能回到第 2 条操作后的状态（最旧的 op0 已被淘汰）
    for (let i = 0; i < HISTORY_LIMIT; i++) h.history.undo();
    expect(h.state.heights[0]).toBe(10); // op1 写入值
    expect(h.history.canUndo()).toBe(false);
  });

  it('新操作清空 redo 栈', () => {
    const h = makeHarness();
    h.mutateHeights((a) => (a[0] = 5), 'a');
    h.history.undo();
    expect(h.history.canRedo()).toBe(true);
    h.mutateHeights((a) => (a[1] = 7), 'b');
    expect(h.history.canRedo()).toBe(false);
  });

  it('非地形切片深拷贝快照互不污染', () => {
    const h = makeHarness();
    h.mutateLabel('v1');
    h.mutateLabel('v2');
    h.history.undo();
    expect(h.state.label).toBe('v1');
  });

  it('cancel 回滚且不入栈', () => {
    const h = makeHarness();
    const token = h.history.begin('临时', ['terrain']);
    h.state.heights = h.state.heights.slice();
    h.state.heights[0] = 99;
    h.history.cancel(token);
    expect(h.state.heights[0]).toBe(1);
    expect(h.history.canUndo()).toBe(false);
  });

  it('clear 后无可撤销', () => {
    const h = makeHarness();
    h.mutateHeights((a) => (a[0] = 1), 'x');
    h.history.clear();
    expect(h.history.canUndo()).toBe(false);
    expect(h.history.canRedo()).toBe(false);
  });
});
