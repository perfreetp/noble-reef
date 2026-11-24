// 画布深度交互：拖动喷头、旋转、框选、删除撤销（直接读 store 断言）
import { chromium } from 'playwright';
const errors: string[] = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const box = (await page.locator('canvas').first().boundingBox())!;

async function getNozzle(id: string) {
  return page.evaluate((nid) => {
    const w = window as unknown as {
      __store__: { doc: { nozzles: { id: string; x: number; y: number; angle: number }[] } };
    };
    return w.__store__.doc.nozzles.find((n) => n.id === nid);
  }, id);
}

// 取中心泉一个喷头的屏幕坐标
const target = await page.evaluate(() => {
  const w = window as unknown as {
    __engine: { viewport: { toScreen(x: number, y: number): { x: number; y: number } } };
    __store__: { doc: { nozzles: { id: string; x: number; y: number }[] } };
  };
  const n = w.__store__.doc.nozzles.find((x) => x.groupId === 'grp_center') ?? w.__store__.doc.nozzles[0];
  const s = w.__engine.viewport.toScreen(n.x, n.y);
  return { id: n.id, x: n.x, y: n.y, sx: s.x, sy: s.y };
});
console.log('目标喷头:', JSON.stringify(target));

// 放大后重新取屏幕坐标
await page.evaluate(() => {
  (window as unknown as { __engine: { zoomBy(f: number): void } }).__engine.zoomBy(1.5);
});
await page.waitForTimeout(400);
const t2 = await page.evaluate((id) => {
  const w = window as unknown as {
    __engine: { viewport: { toScreen(x: number, y: number): { x: number; y: number } } };
    __store__: { doc: { nozzles: { id: string; x: number; y: number }[] } };
  };
  const n = w.__store__.doc.nozzles.find((x) => x.id === id)!;
  return w.__engine.viewport.toScreen(n.x, n.y);
}, target.id);

// 1. 点击选中（toScreen 为 canvas 相对坐标，鼠标事件需加 canvas 盒偏移）
await page.mouse.click(t2.x + box.x, t2.y + box.y);
await page.waitForTimeout(300);
const selSize1 = await page.evaluate(() => {
  const w = window as unknown as { __ui__: { selection: Set<string> } };
  return w.__ui__.selection.size;
});
console.log('单击选中数量:', selSize1);
if (selSize1 !== 1) errors.push(`单击应选中 1 个喷头，实际 ${selSize1}`);

// 2. 拖动移动
const before = await getNozzle(target.id);
const mx = t2.x + box.x;
const my = t2.y + box.y;
await page.mouse.move(mx, my);
await page.mouse.down();
await page.mouse.move(mx + 90, my + 50, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
const after = await getNozzle(target.id);
console.log(`拖动: (${before!.x.toFixed(0)},${before!.y.toFixed(0)}) → (${after!.x.toFixed(0)},${after!.y.toFixed(0)})`);
if (Math.abs(after!.x - before!.x) < 5 && Math.abs(after!.y - before!.y) < 5) {
  errors.push('喷头拖动后坐标未变化');
}

// 3. 角度滑杆
const angleRange = page.locator('.panel-section', { hasText: '喷头属性' }).locator('input[type="range"]').first();
await angleRange.fill('180');
await angleRange.dispatchEvent('input', { bubbles: true });
await page.waitForTimeout(200);
const ang = await getNozzle(target.id);
console.log('朝向改为:', ang!.angle);
if (Math.abs(ang!.angle - 180) > 0.1) errors.push(`朝向未更新为 180，实际 ${ang!.angle}`);

// 4. 框选：起点取确定无喷头的水池外空白区（默认喷头都在半径 760 内，取 x=-1100 外侧），
//    拖向中心覆盖中心泉（-90..90）
const rb = await page.evaluate(() => {
  const w = window as unknown as {
    __engine: { viewport: { toScreen(x: number, y: number): { x: number; y: number } } };
  };
  const a = w.__engine.viewport.toScreen(-1150, -150);
  const b = w.__engine.viewport.toScreen(120, 150);
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
});
// 确认起点无喷头
const originClear = await page.evaluate((p) => {
  const w = window as unknown as {
    __engine: { viewport: { toScreen(x: number, y: number): { x: number; y: number } } };
    __store__: { doc: { nozzles: { x: number; y: number }[] } };
  };
  return !w.__store__.doc.nozzles.some((n) => {
    const s = w.__engine.viewport.toScreen(n.x, n.y);
    return Math.hypot(s.x - p.x, s.y - p.y) <= 12;
  });
}, { x: rb.ax, y: rb.ay });
console.log('框选起点为空白:', originClear);
await page.mouse.move(rb.ax + box.x, rb.ay + box.y);
await page.mouse.down();
await page.mouse.move(rb.bx + box.x, rb.by + box.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const selSize2 = await page.evaluate(() => {
  const w = window as unknown as { __ui__: { selection: Set<string> } };
  return w.__ui__.selection.size;
});
console.log('框选选中数量:', selSize2);
if (selSize2 < 2) errors.push(`框选应选中多个喷头，实际 ${selSize2}`);

// 5. Delete 删除框选的喷头 + 撤销恢复
const selectedIds = await page.evaluate(() => {
  const w = window as unknown as { __ui__: { selection: Set<string> } };
  return [...w.__ui__.selection];
});
const countNozzles = () =>
  page.evaluate(
    () => (window as unknown as { __store__: { doc: { nozzles: unknown[] } } }).__store__.doc.nozzles.length
  );
const countBeforeDel = await countNozzles();
await page.keyboard.press('Delete');
await page.waitForTimeout(200);
const countAfterDel = await countNozzles();
const anyStillThere = await page.evaluate((ids) => {
  const w = window as unknown as { __store__: { doc: { nozzles: { id: string }[] } } };
  return ids.some((id) => w.__store__.doc.nozzles.some((n) => n.id === id));
}, selectedIds);
console.log(`Delete: 喷头数 ${countBeforeDel} → ${countAfterDel}（删除 ${selectedIds.length} 个），残留=${anyStillThere}`);
if (anyStillThere) errors.push('Delete 未删除全部框选喷头');
if (countAfterDel !== countBeforeDel - selectedIds.length) errors.push('Delete 数量不符');

await page.getByRole('button', { name: /撤销/ }).click();
await page.waitForTimeout(200);
const countAfterUndo = await countNozzles();
console.log('撤销后喷头数:', countAfterUndo, '（应恢复为', countBeforeDel, '）');
if (countAfterUndo !== countBeforeDel) errors.push('撤销未恢复删除的喷头');

console.log('\n错误:', errors.length ? errors : '无');
await browser.close();
process.exit(errors.length ? 1 : 0);
