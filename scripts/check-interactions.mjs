/**
 * 交互联动测试（CDP）：模拟天线增删拖、频率/指向变更，验证基线数、指标与导出联动。
 * 前置：dev server 已启动。node scripts/check-interactions.mjs
 */
const { spawn } = await import('node:child_process')
import { setTimeout as sleep } from 'node:timers/promises'

const URL = process.env.APP_URL ?? 'http://localhost:5217/'
const PORT = 9334
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const proc = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=C:/Users/Administrator/AppData/Local/Temp/chrome-interact-profile',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const fail = []
const ok = []
function check(name, cond, detail = '') {
  ;(cond ? ok : fail).push(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  let targets
  for (let i = 0; i < 40; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      break
    } catch {
      await sleep(250)
    }
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL })
  await sleep(6000)

  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value

  // 1. 初始 9 天线 / 36 基线
  let stat = await evalJs(`[...document.querySelectorAll('.stat-row span')].map(s=>s.innerText).join('|')`)
  check('初始 9 天线 36 基线', stat.includes('9') && stat.includes('36'), stat)

  // 2. 在 SVG 空白处点击添加一副天线
  await evalJs(`(() => {
    const svg = document.querySelector('.layout-svg');
    const r = svg.getBoundingClientRect();
    const ev = new PointerEvent('pointerdown', { clientX: r.left + r.width*0.2, clientY: r.top + r.height*0.3, bubbles: true, button: 0 });
    svg.dispatchEvent(ev);
  })()`)
  await sleep(500)
  const n10 = await evalJs(`document.querySelectorAll('.layout-svg .antenna').length`)
  check('点击空白添加天线（→10 副）', n10 === 10, `实际 ${n10}`)
  const bl45 = await evalJs(`[...document.querySelectorAll('.stat-row span')].map(s=>s.innerText).find(t=>t.includes('基线'))`)
  check('基线数联动为 45', bl45?.includes('45'), bl45)

  // 3. 拖拽天线：派发 pointerdown→move→up 序列
  const dragOk = await evalJs(`(async () => {
    const svg = document.querySelector('.layout-svg');
    const r = svg.getBoundingClientRect();
    const dot = svg.querySelector('.antenna .hit');
    const before = dot.parentElement.querySelector('.ant-coord').textContent;
    const dr = dot.getBoundingClientRect();
    dot.dispatchEvent(new PointerEvent('pointerdown', { clientX: dr.x+5, clientY: dr.y+5, bubbles: true, button: 0 }));
    for (let k = 1; k <= 5; k++) {
      svg.dispatchEvent(new PointerEvent('pointermove', { clientX: dr.x + 20*k, clientY: dr.y + 10*k, bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
    }
    svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const after = dot.parentElement.querySelector('.ant-coord').textContent;
    return before !== after;
  })()`)
  check('拖拽改变天线坐标', dragOk === true)

  // 4. 删除一副天线（点 del 按钮）
  await evalJs(`document.querySelector('.antenna .del-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(400)
  const n9 = await evalJs(`document.querySelectorAll('.layout-svg .antenna').length`)
  check('删除天线（→9 副）', n9 === 9, `实际 ${n9}`)

  // 5. 频率联动：改频率后 HPBW 数值应变化
  const hpbwBefore = await evalJs(`document.querySelectorAll('.metric .m-value')[0].textContent`)
  await evalJs(`(() => {
    const slider = document.querySelectorAll('.slider')[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, '1200');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(1200)
  const hpbwAfter = await evalJs(`document.querySelectorAll('.metric .m-value')[0].textContent`)
  check('频率变化联动 HPBW 重算', hpbwBefore !== hpbwAfter, `${hpbwBefore} → ${hpbwAfter}`)

  // 6. 指向角联动：拖 θ 滑杆，两次读取引擎内球的旋转四元数（通过 DOM 无法直读，改测指标不报错且 profile 重绘）
  await evalJs(`(() => {
    const slider = document.querySelectorAll('.slider')[1];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, '45');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(1200)
  const thetaVal = await evalJs(`document.querySelectorAll('.num-input')[1].value`)
  const profileW = await evalJs(`document.querySelector('.profile-canvas').width`)
  check('指向角更新且剖面画布保持渲染', thetaVal === '45' && profileW > 0, `θ=${thetaVal}`)

  // 7. localStorage 持久化
  const stored = await evalJs(`!!localStorage.getItem('array-beam-renderer:v1')`)
  check('状态写入 localStorage', stored === true)
  const storedJson = await evalJs(`(() => { const d = JSON.parse(localStorage.getItem('array-beam-renderer:v1')); return JSON.stringify({ n: d.antennas.length, f: d.frequencyMHz, th: d.theta0Deg }); })()`)
  check('持久化内容正确', JSON.parse(storedJson).n === 9 && JSON.parse(storedJson).f === 1200, storedJson)

  // 8. 导出按钮可用（拦截下载，验证生成的 Blob 内容）
  const exportCheck = await evalJs(`(async () => {
    let captured = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:test'; };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { /* 阻止真实下载 */ };
    const buttons = [...document.querySelectorAll('.export-panel .btn')].map(b => b.textContent.trim());
    document.querySelectorAll('.export-panel .btn')[0].click();   // 天线 CSV
    await new Promise(r => setTimeout(r, 100));
    const csv = await (captured ?? new Blob()).text();
    document.querySelectorAll('.export-panel .btn')[2].click();   // 方向图 CSV
    await new Promise(r => setTimeout(r, 100));
    const pcsv = await (captured ?? new Blob()).text();
    URL.createObjectURL = origCreate;
    HTMLAnchorElement.prototype.click = origClick;
    return { buttons, csvHead: csv.split('\\n')[0], csvRows: csv.split('\\n').length, pHead: pcsv.split('\\n')[0], pRows: pcsv.split('\\n').length };
  })()`)
  check('四个导出按钮就位', exportCheck.buttons.length === 4, exportCheck.buttons.join(','))
  check('天线 CSV 含表头与 9 行数据', exportCheck.csvHead === 'id,x_m,y_m' && exportCheck.csvRows === 10, `${exportCheck.csvRows} 行`)
  check('方向图 CSV 含 9344 行采样', exportCheck.pHead === 'theta_deg,phi_deg,gain_db' && exportCheck.pRows === 1 + 73 * 128, `${exportCheck.pRows} 行`)

  console.log([...ok, ...fail].join('\n'))
  console.log(fail.length ? `\n${fail.length} 项失败` : '\n交互测试全部通过')
  ws.close()
  process.exit(fail.length ? 1 : 0)
} finally {
  proc.kill()
}
