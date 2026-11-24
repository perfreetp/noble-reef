import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? '/index.html' : req.url.split('?')[0]);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(data);
  });
});
await new Promise(r => server.listen(8757, r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8757/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1) 直接灌入 80 点,验证满载几何规模与重建耗时
const fill = await page.evaluate(() => {
  const E = window.__editor;
  const start = performance.now();
  // 现有演示点先清空(通过 state 访问 + 触发重建)
  E.state.points.length = 0;
  for (let i = 0; i < 80; i++) {
    const a = i / 79 * Math.PI * 4;
    E.addPoint(Math.cos(a) * 12, 0.15 + (i % 5) * 0.4, Math.sin(a) * 12);
  }
  const rebuildMs = performance.now() - start;
  return {
    count: E.state.points.length,
    verts: E.ribbonVertexCount,
    expectVerts: (1 + 20 * 79) * 2,
    rebuildMs
  };
});
console.log('fill result:', JSON.stringify(fill));

// 2) 第 81 个点必须被拒绝
const over = await page.evaluate(() => window.__editor.addPoint(0, 0, 0));
const finalCount = await page.evaluate(() => window.__editor.state.points.length);
console.log('81st addPoint returned:', over, '| final count:', finalCount);

// 3) 满载下稳态帧率(软件渲染仅作回归参照,真实 GPU 远高于此)
await page.waitForTimeout(2500);
const fps = await page.locator('#chipFps b').textContent();
const chip = await page.locator('#chipPoints b').textContent();
console.log('steady FPS at 80 points (software renderer):', fps, '| chip:', chip);

// 4) 满载截图
await page.screenshot({ path: path.join(import.meta.dirname, 'cap-80.png') });

console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.close();
if (errors.length) process.exit(1);
if (fill.count !== 80 || fill.verts !== fill.expectVerts || over !== false || finalCount !== 80) {
  console.error('CAP/GEOMETRY ASSERTION FAILED'); process.exit(2);
}
console.log('CAP + FULL-LOAD TEST PASSED');
