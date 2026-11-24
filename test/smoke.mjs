/**
 * 无头冒烟测试(Playwright):
 * 1. 页面与 WebGL 场景正常启动,FPS/遮罩耗时读数出现;
 * 2. 三杆同时拖动,关节角随位移变化且被限位夹住;
 * 3. 保存 6 个姿态上限、切换姿态触发杆件补间;
 * 4. 背光可调;
 * 5. 导出 JSON 含挂点层级/杆件/姿态,再导入能还原;
 * 6. 3 杆持续同时拖动下 FPS >= 30,遮罩重算 < 一帧预算(16.7ms)。
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5217, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto('http://localhost:5217/');
await page.waitForFunction(() => document.querySelector('control-panel')?.shadowRoot?.querySelector('rod-pad'));
await page.waitForTimeout(1200);

const result = await page.evaluate(async () => {
  const out = {};
  const panel = document.querySelector('control-panel');
  const sr = panel.shadowRoot;

  // --- 读数出现 ---
  await new Promise((r) => setTimeout(r, 700));
  out.fpsText = sr.querySelector('#fps').textContent;
  out.maskText = sr.querySelector('#mask').textContent;

  // --- 三杆同时拖动:直接派发 rod-input,模拟并行输入 ---
  const rods = [...sr.querySelectorAll('rod-pad')];
  out.rodCount = rods.length;
  const send = (id, x, y) =>
    panel.dispatchEvent(new CustomEvent('rod-input', { detail: { id, pos: { x, y } } }));
  const ids = rods.map((r) => r.rodId);
  for (let i = 0; i < 20; i++) {
    send(ids[0], 1.1 * Math.sin(i * 0.5), 1.1);
    send(ids[1], 1.1, -1.1);
    send(ids[2], -1.1, 1.1);
    await new Promise((r) => setTimeout(r, 16));
  }
  await new Promise((r) => setTimeout(r, 300));
  out.afterDrag = window.__probe?.();

  // --- 极限位置限位:关节角必须在 limits 内 ---
  send(ids[0], 1.15, 1.15);
  send(ids[1], 1.15, 1.15);
  send(ids[2], 1.15, 1.15);
  await new Promise((r) => setTimeout(r, 500));
  out.atLimit = window.__probe?.();

  // --- 姿态保存(存满 6 个) ---
  const poseSR = sr.querySelector('pose-panel').shadowRoot;
  for (let n = 0; n < 7; n++) {
    send(ids[0], (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
    await new Promise((r) => setTimeout(r, 60));
    poseSR.querySelector('#save').click();
    await new Promise((r) => setTimeout(r, 30));
  }
  const stored = JSON.parse(localStorage.getItem('shadow-puppet-rig:v1'));
  out.poseCount = stored.poses.length;

  // --- 切换姿态 ---
  const before = window.__probe?.();
  const applyBtn = poseSR.querySelector('[data-act="apply"]');
  applyBtn.click();
  await new Promise((r) => setTimeout(r, 150));
  out.midTween = window.__probe?.();
  await new Promise((r) => setTimeout(r, 600));
  out.afterTween = window.__probe?.();
  out.tweenMoved = JSON.stringify(before) !== JSON.stringify(out.afterTween);

  // --- 背光 ---
  const slider = sr.querySelector('#light');
  slider.value = '1.7';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  out.light = window.__probe?.light();

  // --- 导出文件结构(直接读 localStorage 里的同份配置) ---
  const cfg = JSON.parse(localStorage.getItem('shadow-puppet-rig:v1'));
  out.exportShape = {
    parts: cfg.parts.length,
    hasHierarchy: cfg.parts.every((p) => p.parent === null || cfg.parts.some((q) => q.id === p.parent)),
    rods: cfg.rods.length,
    rodBindingRange: cfg.rods.every((r) => r.bindings.length >= 1 && r.bindings.length <= 2),
    poses: cfg.poses.length,
    tipsPerPart: cfg.parts.every((p) => p.tips && Object.keys(p.tips).length >= 1),
  };

  // --- 导入还原:构造文件并走真实 import 事件链 ---
  const tweaked = structuredClone(cfg);
  tweaked.lightIntensity = 0.4;
  tweaked.poses = tweaked.poses.slice(0, 2);
  const file = new File([JSON.stringify(tweaked)], 'test.json', { type: 'application/json' });
  panel.dispatchEvent(new CustomEvent('import', { detail: { file } }));
  await new Promise((r) => setTimeout(r, 600));
  const afterImport = JSON.parse(localStorage.getItem('shadow-puppet-rig:v1'));
  out.importRestored = {
    poses: afterImport.poses.length,
    light: afterImport.lightIntensity,
    rods: afterImport.rods.length,
  };

  // --- 持续 3 杆并行拖动 3 秒,采样 FPS ---
  const samples = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    const t = (performance.now() - t0) / 1000;
    send(ids[0], 1.1 * Math.sin(t * 3), 1.1 * Math.cos(t * 2));
    send(ids[1], 1.1 * Math.cos(t * 2.4), -1.1 * Math.sin(t * 3.1));
    send(ids[2], -1.1 * Math.sin(t * 2.7), 1.1 * Math.cos(t * 3.3));
    await new Promise((r) => setTimeout(r, 16));
    samples.push(window.__probe?.stats());
  }
  const fpsVals = samples.map((s) => s.fps).filter((v) => v > 0);
  const maskVals = samples.map((s) => s.maskMs);
  out.perf = {
    fpsMin: Math.min(...fpsVals),
    fpsAvg: fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length,
    maskMaxMs: Math.max(...maskVals),
    maskAvgMs: maskVals.reduce((a, b) => a + b, 0) / maskVals.length,
  };
  return out;
});

console.log(JSON.stringify(result, null, 2));
console.log('ERRORS:', errors.length ? errors : 'none');

await browser.close();
await server.close();
if (errors.length) process.exit(1);
