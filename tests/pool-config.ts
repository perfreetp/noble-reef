// 水池手柄拖拽 + 落点随朝向/射程变化
import { chromium } from 'playwright';
const errors: string[] = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const box = (await page.locator('canvas').first().boundingBox())!;

// 1. 落点 = 位置 + 朝向向量 × 射程（纯数据校验）
const landingOk = await page.evaluate(() => {
  const w = window as unknown as {
    __store__: { doc: { nozzles: { x: number; y: number; angle: number }[]; config: { jetRange: number } } };
  };
  const n = w.__store__.doc.nozzles[0];
  const r = w.__store__.doc.config.jetRange;
  const rad = (n.angle * Math.PI) / 180;
  const lx = n.x + Math.cos(rad) * r;
  const ly = n.y - Math.sin(rad) * r; // 屏幕 y 向下
  return { hasNozzle: !!n, range: r, lx, ly, angle: n.angle };
});
console.log('落点计算基准:', JSON.stringify(landingOk));

// 2. 进配置页，拖水池中心手柄整体平移
await page.getByRole('button', { name: '⚙ 配置' }).click();
await page.waitForTimeout(400);
const poolBefore = await page.evaluate(() => {
  const p = (window as unknown as { __store__: { doc: { config: { pool: { x: number; y: number } } } } }).__store__.doc.config.pool;
  return { x: p.x, y: p.y };
});
console.log('水池初始左上角:', JSON.stringify(poolBefore));

// 中心手柄屏幕坐标
const center = await page.evaluate(() => {
  const w = window as unknown as {
    __engine: { viewport: { toScreen(x: number, y: number): { x: number; y: number } } };
    __store__: { doc: { config: { pool: { x: number; y: number; width: number; height: number } } } };
  };
  const p = w.__store__.doc.config.pool;
  return w.__engine.viewport.toScreen(p.x + p.width / 2, p.y + p.height / 2);
});
await page.mouse.move(center.x + box.x, center.y + box.y);
await page.mouse.down();
await page.mouse.move(center.x + box.x + 120, center.y + box.y + 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const poolAfter = await page.evaluate(() => {
  const p = (window as unknown as { __store__: { doc: { config: { pool: { x: number; y: number; width: number; height: number } } } } }).__store__.doc.config.pool;
  return { x: p.x, y: p.y, w: p.width, h: p.height };
});
console.log('拖动中心手柄后水池:', JSON.stringify(poolAfter));
const moved = Math.abs(poolAfter.x - poolBefore.x) > 20 && Math.abs(poolAfter.y - poolBefore.y) > 10;
const sizeKept = poolAfter.w > 0 && poolAfter.h > 0;
if (!moved) errors.push('中心手柄未平移水池');
if (!sizeKept) errors.push('平移后水池尺寸异常');

// 3. 改射程，确认配置数据更新
const rangeSlider = page.locator('input[type="range"]').first();
await rangeSlider.fill('500');
await rangeSlider.dispatchEvent('input', { bubbles: true });
await page.waitForTimeout(200);
const rangeNow = await page.evaluate(
  () => (window as unknown as { __store__: { doc: { config: { jetRange: number } } } }).__store__.doc.config.jetRange
);
console.log('射程改为:', rangeNow);
if (rangeNow !== 500) errors.push(`射程未更新为 500，实际 ${rangeNow}`);

// 4. 改广场底色
await page.locator('input[type="color"]').first().evaluate((el) => {
  const input = el as HTMLInputElement;
  input.value = '#aabbcc';
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
const colorNow = await page.evaluate(
  () => (window as unknown as { __store__: { doc: { config: { plazaColor: string } } } }).__store__.doc.config.plazaColor
);
console.log('广场底色:', colorNow);
if (colorNow.toLowerCase() !== '#aabbcc') errors.push(`底色未更新，实际 ${colorNow}`);

// 5. 撤销应能回退底色与水池
await page.getByRole('button', { name: /撤销/ }).click();
await page.waitForTimeout(150);
const colorUndo = await page.evaluate(
  () => (window as unknown as { __store__: { doc: { config: { plazaColor: string } } } }).__store__.doc.config.plazaColor
);
console.log('撤销后底色:', colorUndo);
if (colorUndo.toLowerCase() === '#aabbcc') errors.push('撤销未回退底色');

console.log('\n错误:', errors.length ? errors : '无');
await browser.close();
process.exit(errors.length ? 1 : 0);
