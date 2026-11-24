import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5218, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:5218/');
await page.waitForFunction(() => document.querySelector('control-panel')?.shadowRoot?.querySelector('rod-pad'));
await page.waitForTimeout(1500);

// 摆一个有表现力的姿态再截图
await page.evaluate(async () => {
  const panel = document.querySelector('control-panel');
  const send = (id, x, y) =>
    panel.dispatchEvent(new CustomEvent('rod-input', { detail: { id, pos: { x, y } } }));
  const rods = [...panel.shadowRoot.querySelectorAll('rod-pad')].map((r) => r.rodId);
  send(rods[0], 0.5, 0.9);   // 头杆:抬头+侧身
  send(rods[1], 0.4, 1.0);   // 左臂上扬
  send(rods[2], -0.4, -1.0); // 右臂下垂
  await new Promise((r) => setTimeout(r, 900));
});
await page.screenshot({ path: 'test/screenshot.png' });
await browser.close();
await server.close();
console.log('saved test/screenshot.png');
