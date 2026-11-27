const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const base = __dirname;
const pack = path.resolve(process.argv[2] || path.join(base, 'study_pack_next'));
const app = path.resolve(base, '../2026-11-08_platform_audit/platform');
const { chromium } = createRequire(path.join(app, 'package.json'))('@playwright/test');
const output = path.join(pack, 'audit');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const result = { boundary: 'Local static course artifact QA only; no platform or model executed.', errors: [], externalRequests: [], steps: [] };
  page.on('pageerror', error => result.errors.push(error.message));
  await page.route(/^https?:/, route => { result.externalRequests.push(route.request().url()); return route.abort(); });
  try {
    await page.goto(pathToFileURL(path.join(pack, 'index.html')).href);
    await page.locator('nav a[href="#doc02"]').click();
    result.steps.push({ name: 'chapter navigation', passed: new URL(page.url()).hash === '#doc02' });
    await page.locator('a[href="#v6"]').first().click();
    result.steps.push({ name: 'version navigation', passed: new URL(page.url()).hash === '#v6' && await page.locator('#v6').evaluate(node => Math.abs(node.getBoundingClientRect().top) < 180) });
    await page.screenshot({ path: path.join(output, 'reader-desktop.png') });
    const evidence = JSON.parse(fs.readFileSync(path.join(pack, 'SOURCE_EVIDENCE.json'), 'utf8')).evidence.find(item => item.id === 'P14');
    await page.goto(pathToFileURL(path.join(pack, 'source_view', 'P14.html')).href + '#L' + evidence.line);
    result.steps.push({ name: 'source line navigation', passed: await page.locator('#L' + evidence.line).isVisible() && (await page.locator('#L' + evidence.line).innerText()).includes('generateJudgeObject') });
    result.passed = result.steps.every(step => step.passed) && result.errors.length === 0 && result.externalRequests.length === 0;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'READER_CHECK.json'), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result));
  process.exitCode = result.passed ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
