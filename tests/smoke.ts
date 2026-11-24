// 运行时冒烟测试（无头 Chromium）
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5174/';
const errors: string[] = [];
const warns: string[] = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  if (m.type() === 'warning') warns.push(`warn: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1. 顶栏统计
const stats = await page.locator('.stats').first().innerText();
console.log('顶栏统计:', stats.replace(/\s+/g, ' ').trim());

// 2. 画布存在且有 WebGL canvas
const canvasCount = await page.locator('canvas').count();
console.log('canvas 数量:', canvasCount);
if (canvasCount === 0) errors.push('未创建 canvas');

// 3. 布置页面板
const layoutDock = await page.locator('.dock h2').first().innerText();
console.log('布置页标题:', layoutDock);

// 4. 切换到节奏页
await page.getByRole('button', { name: /节奏/ }).click();
await page.waitForTimeout(400);
const beatCells = await page.locator('[data-cell]').count();
console.log('节拍色块单元格数:', beatCells);
const groups = await page.locator('.group-label').count();
console.log('轨道行数(分组):', groups);

// 5. 在时间轴上绘制一个色块（点击一个空 cell）
const firstCell = page.locator('[data-cell]').first();
await firstCell.click();
await page.waitForTimeout(200);
const blockCount1 = await page.locator('.block').count();
console.log('绘制后色块数:', blockCount1);

// 6. 小节复制：源 0 → 目标 1（复制后目标小节被源内容覆盖，总数应保持或按源拍块数变化）
const copyButtons = page.getByRole('button', { name: '复制整小节' });
await copyButtons.click();
await page.waitForTimeout(200);
const blockCount2 = await page.locator('.block').count();
console.log('复制小节后色块数:', blockCount2, '（目标小节已被源 0 内容覆盖）');

// 7. 切到预览页，点播放
await page.getByRole('button', { name: '▶ 预览' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '▶', exact: true }).click();
await page.waitForTimeout(1200);
const playingText = await page.locator('.transport').innerText();
console.log('播放控件状态包含暂停:', playingText.includes('⏸'));
const activeRows = await page.locator('.active-row.on').count();
console.log('当前激活分组行数:', activeRows);
// 拖动进度
await page.locator('input[type="range"]').last().evaluate((el) => {
  const input = el as HTMLInputElement;
  input.value = '50';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
const progressText = await page.locator('.dock .field span b').first().innerText();
console.log('跳转后时间:', progressText);

// 8. 切到配置页
await page.getByRole('button', { name: /配置/ }).click();
await page.waitForTimeout(400);
const configTitle = await page.locator('.dock h2').innerText();
console.log('配置页标题:', configTitle);
// 改广场底色
await page.locator('input[type="color"]').first().evaluate((el) => {
  const input = el as HTMLInputElement;
  input.value = '#cbb89a';
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);

// 9. 回布置页，用矩形阵列工具
await page.getByRole('button', { name: '◈ 布置' }).click();
await page.waitForTimeout(300);
const before = (await page.locator('.stats .tag').first().innerText()).match(/\d+/)?.[0];
await page.getByRole('button', { name: /矩形阵列/ }).click();
await page.waitForTimeout(200);
// 在水池外的确定空白处点击放置（通过引擎把世界坐标换算成屏幕坐标）
const box = await page.locator('canvas').first().boundingBox();
if (box) {
  const empty = await page.evaluate(() => {
    const w = window as unknown as {
      __engine: { viewport: { toScreen(x: number, y: number): { x: number; y: number } } };
    };
    // 默认喷头都在半径 760 内，取 (-1500, 1100) 水池外空白点
    return w.__engine.viewport.toScreen(-1500, 1100);
  });
  await page.mouse.click(box.x + empty.x, box.y + empty.y);
  await page.waitForTimeout(300);
}
const after = (await page.locator('.stats .tag').first().innerText()).match(/\d+/)?.[0];
console.log(`放置阵列前喷头 ${before} → 后 ${after}`);
if (Number(after) <= Number(before)) errors.push('矩形阵列放置未增加喷头');

// 10. 撤销/重做按钮状态
const undoDisabled = await page.getByRole('button', { name: /撤销/ }).isDisabled();
console.log('撤销按钮可用:', !undoDisabled);
await page.getByRole('button', { name: /撤销/ }).click();
await page.waitForTimeout(200);
const afterUndo = (await page.locator('.stats .tag').first().innerText()).match(/\d+/)?.[0];
console.log('撤销后喷头数:', afterUndo);

// 11. 导出（拦截下载）
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: '导出' }).click()
]);
console.log('导出文件名:', download.suggestedFilename());

// 12. 性能采样（引擎内部 perf，不受无头环境 rAF 节流影响）
await page.getByRole('button', { name: '▶ 预览' }).click();
await page.waitForTimeout(800);
const perf = await page.evaluate(() => {
  const eng = (window as unknown as { __engine?: { perf: { updateMs: number; renderMs: number } } }).__engine;
  return eng?.perf ?? null;
});
console.log('播放帧耗时(ms):', JSON.stringify(perf));
if (perf && (perf.renderMs > 16 || perf.updateMs > 16)) {
  errors.push(`帧耗时超标: update=${perf.updateMs}ms render=${perf.renderMs}ms（阈值各 16ms）`);
}

await browser.close();

console.log('\n=== 警告 (' + warns.length + ') ===');
for (const w of warns.slice(0, 8)) console.log(' ', w);
console.log('\n=== 错误 (' + errors.length + ') ===');
for (const e of errors) console.log(' ', e);
process.exit(errors.length ? 1 : 0);
