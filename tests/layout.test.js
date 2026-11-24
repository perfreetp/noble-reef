import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spreadMetrics, slotFrame, computeFillRect, fillFromRect,
  dragFocus, markerPosition, resolveText
} from '../src/lib/layout.js';
import { instantiatePage, TEMPLATES, newAlbum } from '../src/lib/templates.js';
import { ZONE, VAR } from '../src/lib/constants.js';
import { clampInside } from '../src/lib/geometry.js';

test('spreadMetrics: 中缝改变总宽，右页偏移', () => {
  const m6 = spreadMetrics(6);
  assert.equal(m6.width, 406);
  assert.equal(m6.rightPage.x, 206);
  const m12 = spreadMetrics(12);
  assert.equal(m12.width, 412);
  assert.equal(m12.rightPage.x, 212);
});

test('L/R 槽位坐标随中缝偏移，S 槽位随中缝延展', () => {
  const page = instantiatePage('banner-1');
  const s = page.photoSlots[0];
  assert.equal(s.zone, ZONE.SPREAD);
  const f6 = slotFrame(s, 6);
  const f12 = slotFrame(s, 12);
  assert.equal(f12.w, f6.w + 6);
  assert.equal(f12.x, f6.x);

  const dbl = instantiatePage('double-1');
  const right = dbl.photoSlots.find((x) => x.zone === ZONE.RIGHT);
  assert.equal(slotFrame(right, 6).x, 206 + right.rect.x);
  assert.equal(slotFrame(right, 12).x, 212 + right.rect.x);
});

test('computeFillRect: 默认填充覆盖整个裁切框', () => {
  const frame = { x: 0, y: 0, w: 100, h: 100 };
  const image = { w: 200, h: 100 };
  const fill = { imageId: 'x', focus: { x: 0.5, y: 0.5 }, zoom: 1, pan: { x: 0, y: 0 } };
  const r = computeFillRect(frame, image, fill);
  assert.equal(r.h, 100);
  assert.ok(r.x <= 0 && r.x + r.w >= 100);
});

test('fillFromRect: 平移后状态可还原', () => {
  const frame = { x: 10, y: 10, w: 100, h: 100 };
  const image = { w: 100, h: 200 };
  const fill = { imageId: 'x', focus: { x: 0.5, y: 0.5 }, zoom: 1, pan: { x: 0, y: 0 } };
  const r0 = computeFillRect(frame, image, fill);
  const moved = clampInside(frame, { ...r0, x: r0.x + 15, y: r0.y + 0 });
  const next = fillFromRect(frame, image, fill, moved);
  const back = computeFillRect(frame, image, next);
  assert.ok(Math.abs(back.x - moved.x) < 1e-9);
  assert.ok(Math.abs(back.y - moved.y) < 1e-9);
});

test('dragFocus: 拖动焦点标记时图片跟随且始终覆盖裁切框', () => {
  const frame = { x: 0, y: 0, w: 100, h: 100 };
  const image = { w: 200, h: 100 };
  const fill = { imageId: 'x', focus: { x: 0.5, y: 0.5 }, zoom: 1, pan: { x: 0, y: 0 } };
  const r = computeFillRect(frame, image, fill);
  const out = dragFocus(frame, image, fill, r, { x: 80, y: 50 });
  const restored = computeFillRect(frame, image, out.fill);
  assert.ok(Math.abs(restored.x - out.rect.x) < 1e-9);
  assert.ok(out.rect.x <= 0 && out.rect.x + out.rect.w >= 100);
  assert.ok(out.fill.focus.x >= 0 && out.fill.focus.x <= 1);
});

test('markerPosition: 焦点标记夹在裁切框内', () => {
  const frame = { x: 0, y: 0, w: 100, h: 100 };
  const r = { x: -50, y: 0, w: 200, h: 100 };
  const mk = markerPosition(frame, r, { x: 0, y: 0.5 });
  assert.equal(mk.x, 0);
});

test('resolveText: 页码按对开页序号计算，左奇右偶', () => {
  const variables = { names: '张三 & 李四', date: '2026.10.01' };
  const left = { variable: VAR.PAGE, zone: ZONE.LEFT };
  const right = { variable: VAR.PAGE, zone: ZONE.RIGHT };
  assert.equal(resolveText(left, variables, 0), '1');
  assert.equal(resolveText(right, variables, 0), '2');
  assert.equal(resolveText(left, variables, 3), '7');
  assert.equal(resolveText(right, variables, 3), '8');
  assert.equal(resolveText({ variable: VAR.NAMES }, variables, 0), '张三 & 李四');
});

test('所有模板可实例化，且含页码文字槽与合法槽位', () => {
  for (const tpl of TEMPLATES) {
    const page = instantiatePage(tpl.id);
    assert.equal(page.photoSlots.length, tpl.photoCount);
    assert.ok(page.textSlots.some((s) => s.variable === VAR.PAGE && s.zone === ZONE.LEFT));
    assert.ok(page.textSlots.some((s) => s.variable === VAR.PAGE && s.zone === ZONE.RIGHT));
    for (const s of page.photoSlots) {
      if (s.zone === ZONE.SPREAD) {
        assert.ok(s.spread && s.rect === null);
        assert.ok(s.spread.h > 0);
      } else {
        assert.ok(s.rect && s.rect.w > 0 && s.rect.h > 0);
      }
    }
  }
});

test('newAlbum: 默认两页，变量齐全', () => {
  const a = newAlbum();
  assert.equal(a.pages.length, 2);
  assert.ok(a.variables.names);
  assert.ok(a.variables.date);
});
