/**
 * 核心逻辑冒烟测试（无 DOM）：
 * 曲线确定性、撤销/重做形态一致、分组联动、文件导出/载入还原。
 * 运行：node --experimental-strip-types smoke.ts  （或先 esbuild 打包）
 */
import * as assert from 'node:assert';
import { computeCurve, hashSeed } from './src/lib/hair/curve';
import { model } from './src/lib/hair/model';
import { commitCreate, commitBundleChange, commitGroupCreate, history } from './src/lib/hair/history';
import { exportStyle, parseStyle, loadStyle } from './src/lib/hair/io';
import { detectIntersections } from './src/lib/hair/intersect';
import { DEFAULT_PARAMS } from './src/lib/hair/types';

// svelte/store 在 node 中可用（无 DOM 依赖）
const anchor = { position: [0, 1, 0] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };

// 1. 曲线确定性
const c1 = computeCurve(anchor, DEFAULT_PARAMS, hashSeed('b1'));
const c2 = computeCurve(anchor, DEFAULT_PARAMS, hashSeed('b1'));
assert.deepStrictEqual(c1.map((p) => p.toArray()), c2.map((p) => p.toArray()), '曲线必须确定');
assert.equal(c1.length, 17);

// 2. 新建 + 参数调整 + 撤销/重做形态一致
const b = model.createBundle(anchor, { ...DEFAULT_PARAMS }, '#3b2a1e');
commitCreate(b.id);
const before = model.getCurve(b.id).map((p) => p.toArray());

commitBundleChange('参数调整', [b.id], () => {
  model.setParam(b.id, 'curl', 0.8);
  model.setParam(b.id, 'length', 1.5);
});
const after = model.getCurve(b.id).map((p) => p.toArray());
assert.notDeepStrictEqual(before, after, '参数改变应改变曲线');

history.undo();
assert.deepStrictEqual(model.getCurve(b.id).map((p) => p.toArray()), before, '撤销后形态必须完全恢复');
history.redo();
assert.deepStrictEqual(model.getCurve(b.id).map((p) => p.toArray()), after, '重做后形态必须完全恢复');

// 3. 拖动发根（锚点）撤销
const oldAnchor = JSON.stringify(model.bundles.get(b.id)!.anchor);
commitBundleChange('拖动发根', [b.id], () => {
  model.setAnchor(b.id, { position: [0.2, 0.9, 0.1], normal: [0.2, 0.97, 0.1] });
});
assert.notStrictEqual(JSON.stringify(model.bundles.get(b.id)!.anchor), oldAnchor);
history.undo();
assert.strictEqual(JSON.stringify(model.bundles.get(b.id)!.anchor), oldAnchor, '撤销拖动后锚点恢复');

// 4. 分组联动
const ids: string[] = [];
for (let i = 0; i < 3; i++) {
  const nb = model.createBundle(
    { position: [i * 0.1, 1, 0], normal: [0, 1, 0] },
    { ...DEFAULT_PARAMS, curl: 0.1 * i },
    '#2b2b2b',
  );
  commitCreate(nb.id);
  ids.push(nb.id);
}
const gid = commitGroupCreate('测试组', ids);
const curlsBefore = ids.map((id) => model.bundles.get(id)!.params.curl);
commitBundleChange('组联动', ids, () => model.applyGroupDelta(gid, 'curl', 0.2));
const curlsAfter = ids.map((id) => model.bundles.get(id)!.params.curl);
curlsBefore.forEach((c, i) => assert.ok(Math.abs(curlsAfter[i]! - (c + 0.2)) < 1e-9, '组内按增量联动'));
history.undo(); // 撤销组联动
assert.deepStrictEqual(ids.map((id) => model.bundles.get(id)!.params.curl), curlsBefore);

// 5. 导出 -> 清空 -> 载入还原
const snapshotBundles = JSON.stringify([...model.bundles.values()]);
const json = exportStyle();
model.clear();
assert.equal(model.bundles.size, 0);
loadStyle(parseStyle(json));
assert.strictEqual(JSON.stringify([...model.bundles.values()]), snapshotBundles, '载入后完全还原');
assert.equal(model.groups.size, 1);

// 6. 穿插检测能跑（构造两束同位置必穿插）
model.clear();
const x1 = model.createBundle(anchor, { ...DEFAULT_PARAMS }, '#000000');
const x2 = model.createBundle(anchor, { ...DEFAULT_PARAMS }, '#ffffff');
const pairs = detectIntersections(model);
assert.ok(pairs.some((p) => (p.a === x1.id && p.b === x2.id) || (p.a === x2.id && p.b === x1.id)), '同位发束应报穿插');

console.log('✓ 全部冒烟测试通过');
