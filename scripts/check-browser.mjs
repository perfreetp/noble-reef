/**
 * 无头浏览器运行时冒烟检查（CDP，无第三方依赖）。
 * 用法：先启动 dev server，再 node scripts/check-browser.mjs
 */
const { spawn } = await import('node:child_process')
import { setTimeout as sleep } from 'node:timers/promises'

const URL = process.env.APP_URL ?? 'http://localhost:5217/'
const PORT = 9333
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const proc = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=C:/Users/Administrator/AppData/Local/Temp/chrome-smoke-profile',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

try {
  let targets
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      targets = await res.json()
      break
    } catch {
      await sleep(250)
    }
  }
  if (!targets) throw new Error('Chrome 远程调试端口未就绪')
  const pageTarget = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))

  let id = 0
  const pending = new Map()
  const logs = []
  const exceptions = []
  const networkResponses = new Map()
  const notFound = []

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
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args?.map((a) => a.value ?? a.description ?? a.type).join(' ')
      logs.push(`[console.${msg.params.type}] ${text}`)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      const frames = d.stackTrace?.callFrames
        ?.map((f) => `    at ${f.functionName || '(anon)'} (${f.url}:${f.lineNumber}:${f.columnNumber})`)
        .join('\n')
      exceptions.push([d.text, d.exception?.description, frames].filter(Boolean).join('\n'))
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      exceptions.push(`[browser] ${msg.params.entry.text}`)
    }
    if (msg.method === 'Network.responseReceived') {
      networkResponses.set(msg.params.requestId, {
        status: msg.params.response.status,
        url: msg.params.response.url,
      })
    }
    if (msg.method === 'Network.loadingFinished') {
      const r = networkResponses.get(msg.params.requestId)
      if (r && r.status >= 400) notFound.push(`${r.status} ${r.url}`)
    }
  }

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__rejections = [];
      window.addEventListener('unhandledrejection', e => {
        window.__rejections.push({ reason: String(e.reason), stack: e.reason?.stack || null });
      });`,
  })
  await send('Page.navigate', { url: URL })

  // 等待 worker 计算与渲染稳定
  await sleep(9000)

  const state = await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.querySelector('.render-canvas');
      return {
        canvasSize: canvas ? [canvas.width, canvas.height] : null,
        svgDots: document.querySelectorAll('.layout-svg .antenna').length,
        baselineLabels: document.querySelectorAll('.layout-svg .baseline-label').length,
        metrics: [...document.querySelectorAll('.metric')].map(m => m.innerText.replace(/\\n/g, ' ')),
        badge: document.querySelector('.engine-badge')?.innerText,
        profileSize: (() => { const c = document.querySelector('.profile-canvas'); return c ? [c.width, c.height] : null })(),
        title: document.title,
      };
    })()`,
    returnByValue: true,
  })

  const value = state.result.result.value
  const rej = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__rejections)',
    returnByValue: true,
  })
  value.rejections = JSON.parse(rej.result.result.value)
  console.log('页面状态:', JSON.stringify(value, null, 2))
  console.log('\nConsole 输出:')
  console.log(logs.length ? logs.join('\n') : '(无)')
  console.log('\n未捕获异常:')
  console.log(exceptions.length ? exceptions.join('\n---\n') : '(无)')
  console.log('\n4xx/5xx 资源:')
  console.log(notFound.length ? notFound.join('\n') : '(无)')

  ws.close()
  const ok = exceptions.length === 0 && value.canvasSize?.[0] > 0
  console.log(ok ? '\n浏览器冒烟检查通过' : '\n浏览器冒烟检查失败')
  process.exit(ok ? 0 : 1)
} finally {
  proc.kill()
}
