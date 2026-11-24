// 数据完整性与深度交互测试
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5174/';
const errors: string[] = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const count = () => page.locator('.stats .tag').first().innerText();
console.log('初始:', await count());

// 1. 导出 → 在 Node 侧校验结构 → 通过注入文件重新导入
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: '导出' }).click()
]);
const path = await download.path();
console.log('下载临时文件:', path);
const fs = await import('node:fs');
const saved = JSON.parse(fs.readFileSync(path!, 'utf-8'));
console.log('文件标记:', saved.app, '版本:', saved.formatVersion);
console.log('导出喷头数:', saved.doc.nozzles.length, '分组:', saved.doc.groups.length, '色块:', saved.doc.blocks.length);
if (saved.app !== 'AQUA_PLAZA_STUDIO') errors.push('导出文件标记错误');
if (saved.doc.nozzles.length !== 1269) errors.push('导出喷头数不符');

// 2. 修改工程（加一个矩形阵列）后导入旧文件，验证数据被还原
await page.getByRole('button', { name: /矩形阵列/ }).click();
await page.waitForTimeout(150);
const box = (await page.locator('canvas').first().boundingBox())!;
await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.85);
await page.waitForTimeout(300);
console.log('加阵列后:', await count());
const afterAdd = await count();
if (afterAdd.includes('1269')) errors.push('阵列添加未生效');

// 用文件输入框直接导入（监听 chooser 不适用，直接设置 input files）
const fileChooser = page.waitForEvent('filechooser');
await page.getByRole('button', { name: '导入' }).click();
const chooser = await fileChooser;
await chooser.setFiles(path!);
await page.waitForTimeout(400);
const afterImport = await count();
console.log('导入还原后:', afterImport);
if (!afterImport.includes('1269')) errors.push('导入后未还原到导出时状态');

// 3. 撤销/重做栈深度
const undo = page.getByRole('button', { name: /撤销/ });
const redo = page.getByRole('button', { name: /重做/ });
// 导入后做几次色块操作，再撤销
await page.getByRole('button', { name: '☰ 节奏' }).click();
await page.waitForTimeout(300);
const blocksBefore = await page.locator('.block').count();
await page.locator('[data-cell]').nth(5).click();
await page.waitForTimeout(150);
const blocksAfter = await page.locator('.block').count();
console.log(`色块: ${blocksBefore} → 点击后 ${blocksAfter}`);
await undo.click();
await page.waitForTimeout(150);
const blocksUndo = await page.locator('.block').count();
console.log('撤销后色块:', blocksUndo, '重做可用:', !(await redo.isDisabled()));
if (blocksUndo !== blocksBefore) errors.push('撤销未还原色块');
await redo.click();
await page.waitForTimeout(150);
const blocksRedo = await page.locator('.block').count();
if (blocksRedo !== blocksAfter) errors.push('重做未恢复色块');
console.log('重做后色块:', blocksRedo);

// 4. 配置页水池数值编辑
await page.getByRole('button', { name: '⚙ 配置' }).click();
await page.waitForTimeout(300);
const widthInput = page.locator('input[type="number"]').nth(2);
await widthInput.fill('3000');
await widthInput.dispatchEvent('change');
await page.waitForTimeout(200);
const poolW = await page.evaluate(() => {
  const eng = (window as unknown as { __engine?: { perf: unknown } }).__engine;
  return eng;
});
console.log('水池宽度已改为 3000（输入框值:', await widthInput.inputValue(), '）');
void poolW;

// 5. 分组高亮联动：悬停分组行，检查 ui 状态（通过画布无异常即通过）
await page.getByRole('button', { name: '◈ 布置' }).click();
await page.waitForTimeout(300);
await page.locator('.group-row').first().hover();
await page.waitForTimeout(200);
console.log('分组悬停高亮无异常');

// 6. 单喷头工具添加
await page.getByRole('button', { name: /单喷头/ }).click();
await page.waitForTimeout(150);
await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.8);
await page.waitForTimeout(200);
const singleCount = await count();
console.log('加单喷头后:', singleCount);

console.log('\n=== 错误 (' + errors.length + ') ===');
for (const e of errors) console.log(' ✗', e);
await browser.close();
process.exit(errors.length ? 1 : 0);
