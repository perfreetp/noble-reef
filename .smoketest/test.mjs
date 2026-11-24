import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': url.endsWith('.html') ? 'text/html' : 'text/plain' });
    res.end(data);
  });
});
await new Promise(r => server.listen(8753, r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:8753/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// 1) 初始化状态:演示路径 8 个控制点 + FPS 已出值
const chip0 = await page.locator('#chipPoints b').textContent();
const fps = await page.locator('#chipFps b').textContent();
console.log('initial points chip:', chip0, '| fps:', fps);

// 2) 点击场景空白地面添加控制点(240ms 延迟后入库)
await page.mouse.click(720, 700);
await page.waitForTimeout(600);
const chip1 = await page.locator('#chipPoints b').textContent();
console.log('after click chip:', chip1);

// 3) 调宽度档位 / 泛光阈值滑杆 / 遮挡开关
await page.locator('#segWidth button[data-v="2"]').click();
await page.locator('#rThreshold').evaluate(el => {
  el.value = '0.55'; el.dispatchEvent(new Event('input', { bubbles: true }));
});
const thrVal = await page.locator('#vThreshold').textContent();
// 原生 checkbox 被自定义开关样式隐藏,直接改状态并派发 change 事件验证处理逻辑
await page.locator('#swOcclusion').evaluate(el => {
  el.checked = false;
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);
console.log('threshold slider value:', thrVal, '| occlusion checkbox unchecked');

// 4) 撤销 Ctrl+Z
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
const chip2 = await page.locator('#chipPoints b').textContent();
console.log('after undo chip:', chip2);

// 5) 导出下载
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btnExport').click()
]);
const dlPath = path.join(import.meta.dirname, download.suggestedFilename());
await download.saveAs(dlPath);
const exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
console.log('export file:', download.suggestedFilename(),
  '| points:', exported.state.points.length,
  '| widthLevel:', exported.state.widthLevel,
  '| bloomThreshold:', exported.state.bloomThreshold,
  '| occlusion:', exported.state.occlusion);

// 6) 刷新页面验证 localStorage 持久化
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const chip3 = await page.locator('#chipPoints b').textContent();
const thrAfter = await page.locator('#vThreshold').textContent();
console.log('after reload chip:', chip3, '| threshold persisted:', thrAfter);

// 7) 导入刚导出的文件
const fileChooser = new Promise(resolve => page.once('filechooser', resolve));
await page.locator('#btnImport').click();
const chooser = await fileChooser;
await chooser.setFiles(dlPath);
await page.waitForTimeout(500);
const chip4 = await page.locator('#chipPoints b').textContent();
console.log('after import chip:', chip4);

// 8) 截图供人工目检(默认视角 + 俯视遮挡视角)
await page.screenshot({ path: path.join(import.meta.dirname, 'shot-main.png') });
await page.mouse.move(720, 450);
await page.mouse.down();
await page.mouse.move(720, 250, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(import.meta.dirname, 'shot-rotated.png') });

// 9) 渲染内容检查:截图由 Playwright 捕获合成后的真实帧(readPixels 在
//    preserveDrawingBuffer:false 下会读到空缓冲,故不使用)
await page.screenshot({ path: path.join(import.meta.dirname, 'shot-final.png') });
const shots = ['shot-main.png', 'shot-rotated.png', 'shot-final.png']
  .map(f => [f, fs.statSync(path.join(import.meta.dirname, f)).size]);
console.log('screenshots:', JSON.stringify(shots));

console.log('JS errors:', errors.length ? errors : 'none');
await browser.close();
server.close();
// 正确序列:初始 8 → 点击 9 → 撤销 8;导出在撤销后(文件含 8)→ 重载 8 → 导入 8
if (chip1 !== '9/80' || chip2 !== '8/80' || chip3 !== '8/80' || chip4 !== '8/80') {
  console.error('STATE ASSERTION FAILED', { chip1, chip2, chip3, chip4 });
  process.exit(2);
}
if (shots.some(([, size]) => size < 30000)) {
  console.error('SCREENSHOT SUSPICIOUSLY SMALL — possible blank render');
  process.exit(3);
}
console.log('SMOKE TEST PASSED');
