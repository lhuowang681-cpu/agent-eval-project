const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const platform = path.resolve(__dirname, '../../../2026-11-08_platform_audit/platform');
const requirePlatform = createRequire(path.join(platform, 'package.json'));
const { chromium, expect: baseExpect } = requirePlatform('@playwright/test');
const expect = baseExpect.configure({ timeout: 45000 });
const BASE = process.env.BASE_URL || 'http://127.0.0.1:13010';
const OUT = path.resolve(process.env.UI_OUTPUT || path.join(__dirname, 'results'));
const email = process.env.LOGIN_EMAIL;
const password = process.env.LOGIN_PASSWORD;
if (!email || !password || !['127.0.0.1','localhost'].includes(new URL(BASE).hostname)) throw new Error('Set local BASE_URL and synthetic LOGIN_EMAIL/LOGIN_PASSWORD');
fs.mkdirSync(OUT, { recursive: true });
const dictionaries = ['en-US', 'zh-CN'].map(locale => requirePlatform(path.join(platform, 'locales', locale, 'eval.json')));
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const label = key => new RegExp('^(?:' + dictionaries.map(d => escape(d[key] || key)).join('|') + ')$');
const redact = value => String(value).replaceAll(password, '[password]').replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]');
const safeURL = value => { const u = new URL(value); return u.origin + u.pathname; };
const result = { startedAt: new Date().toISOString(), baseURL: BASE, steps: [], requests: [], console: [], pageErrors: [], httpErrors: [], failedRequests: [], blockedFonts: [], boundary: 'Real BetterAuth UI login and four actual Judge forms; no Agent or LLM execution' };
let browser, context, page, heartbeat;
const dialog = () => page.getByRole('dialog').last();
const button = (key, root = page) => root.getByRole('button', { name: label(key) }).first();
async function data(response) {
  const body = await response.json();
  const item = Array.isArray(body) ? body[0] : body;
  if (!response.ok() || item.error) throw new Error('API response failed: HTTP ' + response.status());
  return item.result?.data?.json ?? item.result?.data;
}
async function api(name, input, mutation = false) {
  const url = BASE + '/trpc/lambda/' + name;
  return data(mutation ? await context.request.post(url, { data: { json: input }, timeout: 120000 }) : await context.request.get(url, { params: { input: JSON.stringify({ json: input }) }, timeout: 120000 }));
}
async function snapshot(name) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  fs.writeFileSync(path.join(OUT, name + '.txt'), redact(await page.locator('body').innerText().catch(() => 'unavailable')));
}
async function step(name, fn) {
  result.currentStep = name;
  const started = Date.now();
  try { const values = await fn(); result.steps.push({ name, status: 'passed', milliseconds: Date.now() - started, ...values }); await snapshot(name); }
  catch (e) { result.steps.push({ name, status: 'failed', milliseconds: Date.now() - started, error: redact(e.message) }); await snapshot(name + '-failed'); throw e; }
  finally { fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2)); }
}
async function submit(key, operation) {
  const pending = page.waitForResponse(r => r.url().includes(operation) && r.request().method() === 'POST');
  await button(key, dialog()).click();
  const response = await pending;
  result.requests.push({ operation, status: response.status(), input: response.request().postDataJSON() });
  return data(response);
}
async function judgeFields(criteria, timeout) {
  await dialog().locator('#evalConfig_provider').fill('openai');
  await dialog().locator('#evalConfig_model').fill('mock-judge-valid');
  await dialog().locator('#evalConfig_criteria').fill(criteria);
  await dialog().locator('#evalConfig_systemRole').fill('Synthetic UI Judge system instruction ' + timeout);
  await dialog().locator('#evalConfig_timeoutMs').fill(String(timeout));
  await expect(dialog().locator('#evalConfig_judgePrompt')).toHaveValue('');
  await snapshot('filled-judge-form-' + timeout);
  return { provider: 'openai', model: 'mock-judge-valid', criteria, systemRole: 'Synthetic UI Judge system instruction ' + timeout, timeoutMs: timeout };
}
function checkSaved(entity, expected) {
  expect(entity.evalMode).toBe('llm-rubric');
  expect(entity.evalConfig).toMatchObject(expected);
  expect(entity.evalConfig.judgePrompt ?? '').toBe('');
  return { id: entity.id, evalMode: entity.evalMode, savedEvalConfig: entity.evalConfig, judgePromptAbsentOrEmpty: true };
}
let benchmark, dataset, testCase;
const suffix = Date.now();
const inputText = 'Synthetic Judge form question ' + suffix;
(async () => {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-first-run', '--disable-background-networking'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'en-US' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost','127.0.0.1'].includes(url.hostname) && (/\.(woff2?|ttf|otf)$/.test(url.pathname) || ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))) { result.blockedFonts.push(safeURL(url.href)); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on('console', message => { if (['error','warning'].includes(message.type())) result.console.push({ type: message.type(), text: redact(message.text()).slice(0, 2000) }); });
  page.on('pageerror', error => result.pageErrors.push(redact(error.message)));
  page.on('requestfailed', request => result.failedRequests.push({ url: safeURL(request.url()), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) result.httpErrors.push({ url: safeURL(response.url()), status: response.status() }); });
  heartbeat = setInterval(() => fs.writeFileSync(path.join(OUT, 'progress.json'), JSON.stringify(result, null, 2)), 10000);
  await step('00-session-fixture', async () => {
    const signup = await context.request.post(BASE + '/api/auth/sign-up/email', { data: { email, password, name: 'Phase2 UI' }, headers: { Origin: BASE }, timeout: 120000 });
    const signin = await context.request.post(BASE + '/api/auth/sign-in/email', { data: { email, password }, headers: { Origin: BASE }, timeout: 120000 });
    if (!signin.ok()) throw new Error('Fixture password signin HTTP ' + signin.status());
    const session = await (await context.request.get(BASE + '/api/auth/get-session')).json();
    if (!session?.user?.id) throw new Error('Missing real session');
    benchmark = await api('agentEval.createBenchmark', { identifier: 'judge-ui-' + suffix, name: 'Judge UI forms ' + suffix, rubrics: [] }, true);
    if (benchmark.userId && benchmark.userId !== session.user.id) throw new Error('Fixture owner differs from real authenticated user');
    await context.clearCookies();
    return { signupHTTP: signup.status(), signinHTTP: signin.status(), benchmarkId: benchmark.id, realUserId: session.user.id, clearedCookiesBeforeUILogin: true };
  });
  await step('01-real-form-login', async () => {
    await page.goto(BASE + '/signin?callbackUrl=' + encodeURIComponent('/eval/bench/' + benchmark.id), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('input#email').fill(email); await page.locator('input#email').press('Enter');
    await page.locator('input#password').fill(password); await page.locator('input#password').press('Enter');
    await expect.poll(async () => Boolean((await (await context.request.get(BASE + '/api/auth/get-session')).json())?.user?.id), { timeout: 90000 }).toBe(true);
    await page.goto(BASE + '/eval/bench/' + benchmark.id, { waitUntil: 'commit', timeout: 120000 });
    await expect(button('dataset.actions.addDataset')).toBeVisible({ timeout: 180000 });
    return { authenticated: true, authMode: 'Actual two-step UI password form' };
  });
  await step('02-dataset-create-no-judgePrompt', async () => {
    await button('dataset.actions.addDataset').click();
    await dialog().locator('input#name').fill('Judge form dataset ' + suffix);
    await dialog().locator('#evalMode').click(); await page.getByText(label('evalMode.llm-rubric')).last().click();
    const expected = await judgeFields('Evaluate correctness from supplied expected answer 中文 create', 2000);
    const created = await submit('common.create', 'agentEval.createDataset');
    dataset = await api('agentEval.getDataset', { id: created.id });
    const saved = checkSaved(dataset, expected);
    await button('common.later', dialog()).click();
    await page.goto(`${BASE}/eval/bench/${benchmark.id}/datasets/${dataset.id}`, { waitUntil: 'commit', timeout: 120000 });
    await expect(page.getByText(dataset.name, { exact: true }).first()).toBeVisible();
    return saved;
  });
  await step('03-dataset-edit-no-judgePrompt', async () => {
    await button('common.edit').click();
    await expect(dialog().locator('#evalConfig_model')).toHaveValue('mock-judge-valid');
    const expected = await judgeFields('Dataset criteria edited through real form 中文 edit', 3000);
    await submit('common.update', 'agentEval.updateDataset');
    dataset = await api('agentEval.getDataset', { id: dataset.id });
    return checkSaved(dataset, expected);
  });
  await step('04-case-create-no-judgePrompt', async () => {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await button('testCase.actions.add').click();
    await dialog().locator('textarea#input').fill(inputText); await dialog().locator('textarea#expected').fill('Synthetic expected answer');
    await dialog().locator('#evalMode').click(); await page.getByText(label('evalMode.llm-rubric')).last().click();
    const expected = await judgeFields('Case-specific create criteria without legacy prompt', 4000);
    const created = await submit('common.create', 'agentEval.createTestCase');
    testCase = await api('agentEval.getTestCase', { id: created.id });
    await expect(page.getByText(inputText, { exact: true }).first()).toBeVisible();
    return checkSaved(testCase, expected);
  });
  await step('05-case-edit-no-judgePrompt', async () => {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const row = page.locator('tr[data-row-key]').filter({ hasText: inputText });
    await row.locator('button').last().click();
    await page.getByRole('menuitem', { name: label('common.edit') }).click();
    await expect(dialog().locator('#evalConfig_criteria')).toHaveValue('Case-specific create criteria without legacy prompt');
    const expected = await judgeFields('Case-specific criteria updated 中文 final', 5000);
    await submit('common.update', 'agentEval.updateTestCase');
    testCase = await api('agentEval.getTestCase', { id: testCase.id });
    return checkSaved(testCase, expected);
  });
  result.status = 'passed';
})().catch(error => { result.status = 'failed'; result.error = redact(error.message); process.exitCode = 1; }).finally(async () => {
  clearInterval(heartbeat); result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  console.log(JSON.stringify({ status: result.status, steps: result.steps.map(step => ({ name: step.name, status: step.status })), output: OUT }));
});
