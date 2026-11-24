import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAlbum, instantiatePage, TEMPLATES } from '../src/lib/templates.js';
import { slotFrame, computeFillRect } from '../src/lib/layout.js';
import { MIN_SLOT_SIZE, ZONE } from '../src/lib/constants.js';
import { clampInside } from '../src/lib/geometry.js';

test('文档不变量：多页实例化后槽位 id 全局唯一', () => {
  const doc = newAlbum();
  for (const tpl of TEMPLATES) doc.pages.push(instantiatePage(tpl.id));
  const ids = new Set();
  let count = 0;
  for (const p of doc.pages) {
    for (const s of [...p.photoSlots, ...p.textSlots]) {
      assert.ok(!ids.has(s.id), `槽位 id 重复: ${s.id}`);
      ids.add(s.id);
      count += 1;
    }
  }
  assert.equal(ids.size, count);
});

test('文档不变量：填充后任意 gutter 下图片始终覆盖裁切框', () => {
  const doc = newAlbum();
  const page = doc.pages[0];
  const slot = page.photoSlots[0];
  const image = { w: 1200, h: 1800 };
  slot.fill = { imageId: 'img1', focus: { x: 0.3, y: 0.7 }, zoom: 2.4, pan: { x: 5, y: -7 } };
  for (const gutter of [0, 6, 12, 30]) {
    const frame = slotFrame(slot, gutter);
    const r = computeFillRect(frame, image, slot.fill);
    const clamped = clampInside(frame, r);
    assert.ok(clamped.x <= frame.x + 1e-9, `gutter=${gutter} 左边露白`);
    assert.ok(clamped.y <= frame.y + 1e-9, `gutter=${gutter} 上边露白`);
    assert.ok(clamped.x + clamped.w >= frame.x + frame.w - 1e-9, `gutter=${gutter} 右边露白`);
    assert.ok(clamped.y + clamped.h >= frame.y + frame.h - 1e-9, `gutter=${gutter} 下边露白`);
  }
});

test('文档不变量：跨页槽位在 gutter 范围内宽度连续非负', () => {
  const page = instantiatePage('banner-1');
  const slot = page.photoSlots[0];
  assert.equal(slot.zone, ZONE.SPREAD);
  for (const gutter of [0, 1, 6, 30]) {
    const f = slotFrame(slot, gutter);
    assert.ok(f.w >= MIN_SLOT_SIZE);
    assert.ok(f.h >= MIN_SLOT_SIZE);
  }
});

test('文档不变量：每个对开页都有左右两个页码槽且解析为连续奇偶页', () => {
  const doc = newAlbum();
  for (const tpl of TEMPLATES) doc.pages.push(instantiatePage(tpl.id));
  doc.pages.forEach((p, i) => {
    const left = p.textSlots.filter((s) => s.zone === ZONE.LEFT && s.variable === 'page');
    const right = p.textSlots.filter((s) => s.zone === ZONE.RIGHT && s.variable === 'page');
    assert.equal(left.length, 1);
    assert.equal(right.length, 1);
  });
});

test('缩放倍数被限制在 [1,6]，平移被夹回裁切框', () => {
  const frame = { x: 0, y: 0, w: 100, h: 100 };
  const image = { w: 300, h: 200 };
  const wild = { imageId: 'x', focus: { x: 0.5, y: 0.5 }, zoom: 99, pan: { x: 500, y: -500 } };
  const r = computeFillRect(frame, image, wild);
  const c = clampInside(frame, r);
  assert.ok(c.x <= 0 && c.y <= 0);
  assert.ok(c.x + c.w >= 100 && c.y + c.h >= 100);
});
