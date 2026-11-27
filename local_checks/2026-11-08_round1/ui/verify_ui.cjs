// Real browser UI verification. Credentials come only from environment, never written.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const platform = path.resolve(__dirname, '../../2026-11-08_platform_audit/platform');
const platformRequire = createRequire(path.join(platform, 'package.json'));
const { chromium, expect: baseExpect } = platformRequire('@playwright/test');
const expect = baseExpect.configure({ timeout: 45000 });
const BASE = process.env.BASE_URL || process.argv[2];
const OUT = path.resolve(process.env.UI_OUTPUT || process.argv[3] || path.join(__dirname, 'results'));
if (!BASE || !process.env.LOGIN_EMAIL || !process.env.LOGIN_PASSWORD) throw new Error('Set BASE_URL, LOGIN_EMAIL and LOGIN_PASSWORD');
if (!['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname)) throw new Error('Synthetic tests must run locally');
fs.mkdirSync(OUT, { recursive: true });
const dictionaries = ['en-US', 'zh-CN'].map(locale => JSON.parse(fs.readFileSync(path.join(platform, 'locales', locale, 'eval.json'), 'utf8')));
const escape = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = key => new RegExp(`^(?:${dictionaries.map(d => escape(d[key] || key)).join('|')})$`);
const safeURL = raw => { const u = new URL(raw); return u.origin + u.pathname; };
const redact = raw => String(raw).replaceAll(process.env.LOGIN_PASSWORD, '[password]').replace(/(Bearer\s+)[\w.-]+/gi, '$1[redacted]').replace(/([?&](?:token|code|key|secret|password)=)[^&\s]+/gi, '$1[redacted]');
const result = { startedAt: new Date().toISOString(), baseURL: BASE, steps: [], console: [], pageErrors: [], requestFailed: [], httpErrors: [], method: 'Headless installed Edge, real BetterAuth session, no development auth header' };
let browser, page, heartbeat;
const pendingRequests = new Set();
async function snapshot(label) {
  await page.screenshot({ path: path.join(OUT, label + '.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  fs.writeFileSync(path.join(OUT, label + '.txt'), redact(await page.locator('body').innerText().catch(() => 'unavailable')));
}
async function step(name, fn) {
  result.currentStep = name;
  const started = Date.now();
  try { const data = await fn(); result.steps.push({ name, status: 'passed', milliseconds: Date.now() - started, ...(data || {}) }); await snapshot(name); }
  catch (e) { result.steps.push({ name, status: 'failed', error: redact(e.message), milliseconds: Date.now() - started }); await snapshot(name + '-failed'); throw e; }
  finally { fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2)); }
}
const button = (key, root = page) => root.getByRole('button', { name: text(key) }).first();
const dialog = () => page.getByRole('dialog').last();
async function responseData(response) {
  const body = await response.json();
  const item = Array.isArray(body) ? body[0] : body;
  if (item.error) throw new Error('tRPC operation returned an error: ' + JSON.stringify(item.error?.json?.message || 'unknown'));
  return item.result?.data?.json ?? item.result?.data;
}
async function submitMutation(key, operation, root = dialog()) {
  const pending = page.waitForResponse(r => r.url().includes(operation) && r.request().method() === 'POST');
  await button(key, root).click();
  const response = await pending;
  result.operationRequests ??= [];
  result.operationRequests.push({ operation, httpStatus: response.status(), input: response.request().postDataJSON() });
  if (!response.ok()) throw new Error(operation + ' HTTP ' + response.status());
  return responseData(response);
}
let benchId, datasetId, runId;
const suffix = Date.now();
const benchName = 'Round1 UI ' + suffix;
const dsName = 'UI Dataset ' + suffix;

(async () => {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-first-run', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  result.blockedNonBusinessAssets = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1','localhost'].includes(url.hostname) && (/\.(?:woff2?|ttf|otf)$/.test(url.pathname) || ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))) {
      result.blockedNonBusinessAssets.push(safeURL(url.href));
      return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage();
  heartbeat = setInterval(() => {
    result.pendingRequests = [...pendingRequests].slice(0, 100);
    fs.writeFileSync(path.join(OUT, 'progress.json'), JSON.stringify(result, null, 2));
  }, 10000);
  page.setDefaultTimeout(120000);
  page.on('request', r => pendingRequests.add(safeURL(r.url())));
  page.on('requestfinished', r => pendingRequests.delete(safeURL(r.url())));
  page.on('requestfailed', r => pendingRequests.delete(safeURL(r.url())));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) result.console.push({ type: m.type(), text: redact(m.text()).slice(0, 3000) }); });
  page.on('pageerror', e => result.pageErrors.push(redact(e.message)));
  page.on('requestfailed', r => result.requestFailed.push({ url: safeURL(r.url()), error: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) result.httpErrors.push({ url: safeURL(r.url()), status: r.status() }); });
  if (process.env.BOOTSTRAP_USER === '1') await step('00-api-fixture-setup', async () => {
    const signup = await context.request.post(BASE + '/api/auth/sign-up/email', { timeout: 120000, data: { email: process.env.LOGIN_EMAIL, password: process.env.LOGIN_PASSWORD, name: 'Round1 UI' }, headers: { Origin: BASE } });
    const signin = await context.request.post(BASE + '/api/auth/sign-in/email', { timeout: 120000, data: { email: process.env.LOGIN_EMAIL, password: process.env.LOGIN_PASSWORD }, headers: { Origin: BASE } });
    if (!signin.ok()) throw new Error('Fixture BetterAuth sign-in HTTP ' + signin.status());
    async function api(name, data, mutation = false) {
      const url = BASE + '/trpc/lambda/' + name;
      const response = mutation ? await context.request.post(url, { data: { json: data }, timeout: 120000 }) : await context.request.get(url, { params: { input: JSON.stringify({ json: data }) }, timeout: 120000 });
      if (!response.ok()) throw new Error(name + ' HTTP ' + response.status());
      return responseData(response);
    }
    const session = await (await context.request.get(BASE + '/api/auth/get-session')).json();
    if (!session?.user?.id) throw new Error('Fixture has no authenticated session');
    const agent = await api('agent.getBuiltinAgent', { slug: 'inbox' });
    if (agent.userId && agent.userId !== session.user.id) throw new Error('Fixture Agent user differs from authenticated session (check ENABLE_MOCK_DEV_USER)');
    await api('agent.updateAgentConfig', { agentId: agent.id, value: { model: 'mock-model', provider: 'openai', systemRole: 'Synthetic UI v1', plugins: [] } }, true);
    await context.clearCookies();
    return { signupHTTP: signup.status(), signinHTTP: signin.status(), fixtureAgentId: agent.id, sessionUserId: session.user.id, cookiesClearedBeforeUILogin: true };
  });
  await step('01-signin', async () => {
    if (process.env.AUTH_MODE === 'api') {
      const r = await context.request.post(BASE + '/api/auth/sign-in/email', { data: { email: process.env.LOGIN_EMAIL, password: process.env.LOGIN_PASSWORD }, headers: { Origin: BASE } });
      if (!r.ok()) throw new Error('BetterAuth sign-in HTTP ' + r.status());
    } else {
      await page.goto(BASE + '/signin?callbackUrl=%2Feval', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.locator('input#email').fill(process.env.LOGIN_EMAIL);
      await page.locator('input#email').press('Enter');
      await page.locator('input#password').fill(process.env.LOGIN_PASSWORD);
      await page.locator('input#password').press('Enter');
      await expect.poll(async () => {
        const response = await context.request.get(BASE + '/api/auth/get-session');
        const body = await response.json();
        return Boolean(body?.user?.id);
      }, { timeout: 90000 }).toBe(true);
    }
    const session = await context.request.get(BASE + '/api/auth/get-session');
    const data = await session.json();
    if (!data?.user?.id) throw new Error('No authenticated BetterAuth user session');
    result.authenticatedSession = true;
    result.authMode = process.env.AUTH_MODE || 'UI form';
    await page.goto(BASE + '/eval', { waitUntil: 'commit', timeout: 120000 });
    await expect(button('overview.createBenchmark')).toBeVisible({ timeout: 180000 });
    if (page.url().includes('signin')) throw new Error('Eval redirected to signin');
    return { authMode: process.env.AUTH_MODE || 'UI form', authenticatedSession: true, finalPath: new URL(page.url()).pathname };
  });
  await step('02-create-benchmark', async () => {
    await button('overview.createBenchmark').click();
    await dialog().locator('input#name').fill(benchName);
    const created = await submitMutation('benchmark.create.confirm', 'agentEval.createBenchmark');
    benchId = created.id;
    if (!benchId) throw new Error('No created benchmark ID');
    await page.waitForURL('**/eval/bench/' + benchId);
    await expect(page.getByText(benchName, { exact: true }).first()).toBeVisible();
    return { benchmarkId: benchId };
  });
  await step('03-create-dataset', async () => {
    await button('dataset.actions.addDataset').click();
    await dialog().locator('input#name').fill(dsName);
    await dialog().locator('#evalMode').click();
    await page.getByText(text('evalMode.contains')).last().click();
    const created = await submitMutation('common.create', 'agentEval.createDataset');
    datasetId = created.id;
    if (!datasetId) throw new Error('No created dataset ID');
    await button('common.later', dialog()).click();
    await page.goto(`${BASE}/eval/bench/${benchId}/datasets/${datasetId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(dsName, { exact: true }).first()).toBeVisible();
    return { datasetId };
  });
  await step('04-create-three-cases', async () => {
    for (let i = 1; i <= 3; i++) {
      await button('testCase.actions.add').click();
      await dialog().locator('textarea#input').fill('Synthetic UI question ' + i);
      await dialog().locator('textarea#expected').fill('Mock LLM');
      await submitMutation('common.create', 'agentEval.createTestCase');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('Synthetic UI question ' + i, { exact: true }).first()).toBeVisible();
    }
    return { createdCases: 3 };
  });
  async function createAndStart(version) {
    await page.goto(`${BASE}/eval/bench/${benchId}/datasets/${datasetId}`, { waitUntil: 'domcontentloaded' });
    await button('dataset.detail.addRun').click();
    await dialog().locator('input#name').fill('UI ' + version + ' ' + suffix);
    await dialog().locator('#targetAgentId').click();
    const visibleOptions = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    const option = process.env.AGENT_TITLE ? visibleOptions.filter({ hasText: process.env.AGENT_TITLE }).first() : visibleOptions.first();
    result.selectedAgentVisibleText = await option.innerText();
    await option.click();
    await dialog().getByText(text('run.create.advanced')).click();
    await dialog().locator('input#maxSteps').fill(version === 'v1' ? '8' : '16');
    await dialog().locator('input#timeoutMinutes').fill('1');
    const created = await submitMutation('run.create.createOnly', 'agentEval.createRun');
    runId = created.id;
    await page.waitForURL('**/runs/' + runId);
    await button('run.actions.start').click();
    await submitMutation('run.actions.start', 'agentEval.startRun');
    await expect(page.getByText(text('run.status.completed')).first()).toBeVisible({ timeout: 180000 });
    await expect(page.getByText('3/3', { exact: false }).first()).toBeVisible();
    const toggle = page.getByText(text('run.detail.configSnapshot')).first();
    if (await toggle.isVisible()) await toggle.click();
    return { runId, reportPath: new URL(page.url()).pathname, completed: true, expectedPassedCases: 3, configuredMaxSteps: version === 'v1' ? 8 : 16 };
  }
  await step('05-run-and-report-v1', () => createAndStart('v1'));
  await step('06-edit-dataset-configuration', async () => {
    await page.goto(`${BASE}/eval/bench/${benchId}/datasets/${datasetId}`, { waitUntil: 'domcontentloaded' });
    await button('common.edit').click();
    await dialog().locator('textarea#description').fill('Updated from authenticated UI for second evaluation');
    await submitMutation('common.update', 'agentEval.updateDataset');
    await expect(page.getByText('Updated from authenticated UI for second evaluation', { exact: true })).toBeVisible();
    return { scope: 'dataset description; Agent configuration change is verified separately by HTTP harness' };
  });
  await step('07-run-and-report-v2', () => createAndStart('v2'));
  result.status = 'passed';
})().catch(e => { result.status = 'failed'; result.error = redact(e.message); process.exitCode = 1; }).finally(async () => {
  result.finishedAt = new Date().toISOString();
  clearInterval(heartbeat);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  console.log(JSON.stringify({ status: result.status, steps: result.steps.map(s => ({ name: s.name, status: s.status })), output: OUT }));
});
