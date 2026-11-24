import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1500, height: 950 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:4188/', { waitUntil: 'networkidle0' });
await page.waitForSelector('canvas');
await page.evaluate(() => [...document.querySelectorAll('.step-button')].find(b => b.textContent.includes('分模轮廓'))?.click());
await new Promise(r => setTimeout(r, 200));
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('生成示例环形折线'))?.click());
await new Promise(r => setTimeout(r, 800));
const before = await page.evaluate(() => document.body.innerText.match(/当前折线\s*(\d+)\s*点/)?.[1]);
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
await new Promise(r => setTimeout(r, 300));
const afterUndo = await page.evaluate(() => document.body.innerText.match(/当前折线\s*(\d+)\s*点/)?.[1]);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
await new Promise(r => setTimeout(r, 300));
const afterRedo = await page.evaluate(() => document.body.innerText.match(/当前折线\s*(\d+)\s*点/)?.[1]);
console.log({ before, afterUndo, afterRedo, errors });
await browser.close();
if (errors.length || before !== '14' || afterUndo !== '0' || afterRedo !== '14') process.exit(2);
