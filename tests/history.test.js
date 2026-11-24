import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/lib/history.js';
import { newAlbum } from '../src/lib/templates.js';

test('History: commit 后可 undo/redo 还原状态', () => {
  let state = newAlbum();
  const h = new History();
  const get = () => state;
  const set = (d) => { state = d; };

  const firstName = state.variables.names;
  h.commit('修改文字', get, set, (d) => { d.variables.names = '王五 & 赵六'; });
  assert.equal(state.variables.names, '王五 & 赵六');
  h.undo(get, set);
  assert.equal(state.variables.names, firstName);
  h.redo(get, set);
  assert.equal(state.variables.names, '王五 & 赵六');
});

test('History: 相同 coalesceKey 在窗口内合并为一条', () => {
  let state = { v: 0 };
  const h = new History();
  const get = () => state;
  const set = (d) => { state = d; };
  h.commit('输入', get, set, (d) => { d.v = 1; }, 'input');
  h.commit('输入', get, set, (d) => { d.v = 2; }, 'input');
  h.commit('输入', get, set, (d) => { d.v = 3; }, 'input');
  assert.equal(h.canUndo, true);
  h.undo(get, set);
  assert.equal(state.v, 0); // 一次撤销回到初始
});

test('History: 不同 key 不合并，undo 后 redo 栈清空', () => {
  let state = { a: 0, b: 0 };
  const h = new History();
  const get = () => state;
  const set = (d) => { state = d; };
  h.commit('A', get, set, (d) => { d.a = 1; }, 'a');
  h.commit('B', get, set, (d) => { d.b = 1; }, 'b');
  h.undo(get, set);
  assert.deepEqual(state, { a: 1, b: 0 });
  h.commit('C', get, set, (d) => { d.a = 9; }, 'c');
  assert.equal(h.canRedo, false);
});

test('History: 无变化的 commit 不入栈', () => {
  let state = { v: 1 };
  const h = new History();
  const get = () => state;
  const set = (d) => { state = d; };
  h.commit('空操作', get, set, () => {});
  assert.equal(h.canUndo, false);
});

test('History: 页序调整可撤销还原', () => {
  let state = newAlbum();
  const h = new History();
  const get = () => state;
  const set = (d) => { state = d; };
  const firstId = state.pages[0].id;
  h.commit('调整页序', get, set, (d) => {
    const [p] = d.pages.splice(0, 1);
    d.pages.push(p);
  });
  assert.notEqual(state.pages[0].id, firstId);
  h.undo(get, set);
  assert.equal(state.pages[0].id, firstId);
});
