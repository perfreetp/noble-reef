import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rect, coverRect, clampInside, scaleAround, applyGapConstraints,
  snapRect, clampToPage, focusFromRect, intersects
} from '../src/lib/geometry.js';

test('coverRect: 横图填满竖槽，高度贴合、宽度溢出', () => {
  const frame = rect(0, 0, 100, 200);
  const r = coverRect(frame, { w: 300, h: 200 }, { x: 0.5, y: 0.5 });
  assert.equal(r.h, 200);
  assert.equal(r.w, 300);
  assert.ok(r.x <= 0 && r.x + r.w >= 100);
});

test('coverRect: 焦点靠边时夹紧，不露白边', () => {
  const frame = rect(0, 0, 100, 100);
  const r = coverRect(frame, { w: 200, h: 100 }, { x: 0, y: 0.5 });
  assert.equal(r.x, 0); // 左边缘对齐
  const r2 = coverRect(frame, { w: 200, h: 100 }, { x: 1, y: 0.5 });
  assert.equal(r2.x + r2.w, 100); // 右边缘对齐
});

test('clampInside: 平移超界自动回弹到合法位置', () => {
  const frame = rect(0, 0, 100, 100);
  // 150×150 的图合法 x∈[-50,0]、y∈[-50,0]
  const r = rect(20, -60, 150, 150);
  const out = clampInside(frame, r);
  assert.equal(out.x, 0);    // 左露白 → 贴左边
  assert.equal(out.y, -50);  // 右露白 → 贴右边
  // 覆盖完整
  assert.ok(out.x <= frame.x && out.y <= frame.y);
  assert.ok(out.x + out.w >= frame.x + frame.w);
  assert.ok(out.y + out.h >= frame.y + frame.h);
});

test('scaleAround: 以槽位中心缩放后仍覆盖裁切框', () => {
  const frame = rect(0, 0, 100, 100);
  const base = coverRect(frame, { w: 200, h: 100 });
  const out = scaleAround(base, frame, 2);
  assert.ok(out.w >= frame.w && out.h >= frame.h);
  assert.ok(out.x <= 0 && out.y <= 0);
});

test('focusFromRect 与 coverRect 往返一致（中心焦点）', () => {
  const frame = rect(10, 20, 80, 120);
  const image = { w: 400, h: 300 };
  const r = coverRect(frame, image, { x: 0.5, y: 0.5 });
  const focus = focusFromRect(frame, r);
  assert.ok(Math.abs(focus.x - 0.5) < 1e-9);
  assert.ok(Math.abs(focus.y - 0.5) < 1e-9);
});

test('applyGapConstraints: 重叠槽位被推开，满足最小间距', () => {
  const a = rect(0, 0, 50, 50);
  const b = rect(52, 0, 50, 50); // 间距仅 2
  const out = applyGapConstraints(b, [a], 10);
  const gap = out.x - (a.x + a.w);
  assert.ok(gap >= 10 - 1e-9, `实际间距 ${gap}`);
  assert.equal(out.y, b.y);
  assert.equal(out.w, b.w);
});

test('applyGapConstraints: 间距足够时不移动', () => {
  const a = rect(0, 0, 50, 50);
  const b = rect(80, 0, 50, 50);
  const out = applyGapConstraints(b, [a], 10);
  assert.deepEqual(out, b);
});

test('snapRect: 靠近边缘时吸附并返回参考线', () => {
  const target = rect(0, 0, 100, 100);
  const moving = rect(102, 0, 50, 50); // 左边 102，距目标右边 100 差 2
  const out = snapRect(moving, [target], 6);
  assert.equal(out.x, 100);
  assert.ok(out.guides.some((g) => g.axis === 'v'));
});

test('snapRect: 超出阈值不吸附', () => {
  const target = rect(0, 0, 100, 100);
  const moving = rect(120, 130, 50, 50);
  const out = snapRect(moving, [target], 6);
  assert.equal(out.x, 120);
  assert.equal(out.y, 130);
  assert.equal(out.guides.length, 0);
});

test('clampToPage: 槽位限制在页面安全区内', () => {
  const area = rect(0, 0, 200, 280);
  const out = clampToPage(rect(180, 260, 50, 50), area);
  assert.equal(out.x, 150);
  assert.equal(out.y, 230);
});

test('intersects 基本判断', () => {
  assert.equal(intersects(rect(0, 0, 10, 10), rect(5, 5, 10, 10)), true);
  assert.equal(intersects(rect(0, 0, 10, 10), rect(20, 20, 10, 10)), false);
});
