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
await new Promise(r => server.listen(8756, r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8756/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 精确布置:相机贴近障碍箱(4,0.55,3)的 +Z 侧,视线穿过箱子看向光带中段
// 箱中心 (4,0.55,3),尺寸 3x1.1x3;相机放在其后方 (4, 1.0, 7.5),目标点在箱后光带处
await page.evaluate(() => {
  window.__editor.setView([4, 1.0, 8.2], [4, 0.7, -6]);
});
await page.waitForTimeout(800);

async function setOcclusion(on) {
  await page.evaluate((flag) => {
    const el = document.getElementById('swOcclusion');
    el.checked = flag;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, on);
  await page.waitForTimeout(500);
}

// 采样画面中央一块区域(箱子投影所在)的平均亮度
async function centerLuminance() {
  return page.evaluate(() => new Promise(resolve => {
    // 用 2D 截图方式:抓取当前 canvas 到临时图片不可行(缓冲已交换),
    // 改为 Playwright 截图后在外部分析;这里仅返回占位
    resolve(0);
  }));
}
await centerLuminance();

await setOcclusion(true);
await page.screenshot({ path: path.join(import.meta.dirname, 'occ-on.png') });
await setOcclusion(false);
await page.screenshot({ path: path.join(import.meta.dirname, 'occ-off.png') });

// 几何校验:8 控制点 → 环数 = 1 + 20*7 = 141,每环 2 顶点 → 282
const verts = await page.evaluate(() => window.__editor.ribbonVertexCount);
const pts = await page.evaluate(() => window.__editor.state.points.length);
console.log(`points=${pts} ribbon vertices=${verts} (expect ${(1 + 20 * (pts - 1)) * 2})`);

console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.close();
if (errors.length) process.exit(1);
if (verts !== (1 + 20 * (pts - 1)) * 2) { console.error('SUBDIV GEOMETRY MISMATCH'); process.exit(2); }
console.log('OCCLUSION SHOTS + GEOMETRY CHECK DONE');
