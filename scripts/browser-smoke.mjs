import puppeteer from 'puppeteer-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'http://127.0.0.1:4177/';

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1680,1000',
  ],
  defaultViewport: { width: 1680, height: 1000 },
});

const page = await browser.newPage();
const messages = [];
page.on('console', (msg) => messages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => messages.push(`[pageerror] ${err.stack || err.message}`));
page.on('requestfailed', (req) => messages.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`));

try {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.viewport-host canvas', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));

  await page.evaluate(() => [...document.querySelectorAll('.step-button')].find((b) => b.textContent.includes('分模轮廓'))?.click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('生成示例环形折线'))?.click());
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: 'scripts/shot-parting.png' });

  await page.evaluate(() => [...document.querySelectorAll('.step-button')].find((b) => b.textContent.includes('榫卯'))?.click());
  await new Promise((r) => setTimeout(r, 2500));
  const tenonText = await page.evaluate(() => document.querySelector('.control-drawer')?.innerText ?? '');
  await page.screenshot({ path: 'scripts/shot-tenon.png' });

  await page.evaluate(() => [...document.querySelectorAll('.step-button')].find((b) => b.textContent.includes('壁厚'))?.click());
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => [...document.querySelectorAll('.toggle-row')].find((b) => b.textContent.includes('启用抽壳'))?.click());
  await new Promise((r) => setTimeout(r, 3500));
  await page.screenshot({ path: 'scripts/shot-wall.png' });

  await page.evaluate(() => [...document.querySelectorAll('.step-button')].find((b) => b.textContent.includes('导出'))?.click());
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'scripts/shot-export.png' });
  const body = await page.evaluate(() => document.body.innerText);

  const result = {
    hasCanvas: !!await page.$('.viewport-host canvas'),
    tenonSummary: tenonText.match(/当前\s*\d+\s*个柱位[^\n]*/)?.[0] ?? tenonText.match(/\d+\s*个柱位冲突[^\n]*/)?.[0] ?? null,
    hasBom: body.includes('分件清单') && body.includes('cm³'),
    hasExportButtons: body.includes('导出下模 STL'),
    errorCount: messages.filter((m) => m.includes('[pageerror]') || m.includes('[requestfailed]')).length,
    messages: messages.slice(-80),
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.errorCount > 0) process.exitCode = 2;
} finally {
  await browser.close();
}
