/**
 * 零依赖 CDP 冒烟驱动:导航 -> 等待 #smoke 含 SMOKE_OK/BOOT_FAILED -> 拉取 DOM。
 * 用法: node tools/cdp-smoke.mjs <url> [timeoutMs]
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5199/smoke.html';
const timeoutMs = Number(process.argv[3] ?? 60000);

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = list.find((t) => t.type === 'page') ?? list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();

await new Promise((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = reject;
});

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });

const deadline = Date.now() + timeoutMs;
let result = '';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  const res = await send('Runtime.evaluate', {
    expression: `document.getElementById('smoke')?.textContent ?? 'PENDING'`,
    returnByValue: true,
  });
  result = res.result.value;
  if (result.includes('SMOKE_OK') || result.includes('BOOT_FAILED')) break;
}

// 截图(可视结果)
const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs');
fs.writeFileSync('.smoke/shot.png', Buffer.from(shot.data, 'base64'));

console.log(result);
ws.close();
process.exit(result.includes('SMOKE_OK') ? 0 : 1);
