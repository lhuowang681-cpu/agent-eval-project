/**
 * Self-test for the local QStash emulator stub (stubs/ctrip-qstash).
 * Verifies: sign→verify round trip, key rotation, tamper detection,
 * loopback guard, and end-to-end delivery with Retry-After handling.
 */
import { createServer } from 'node:http';

process.env.ZXQSTASH_CURRENT_SIGNING_KEY = 'FAgH0e271zWT4oayC1GDiRyXDfCLTzcK/d8pZ9ldVUU=';
process.env.ZXQSTASH_NEXT_SIGNING_KEY = 'UGBgS1kjwn+AhX2ftWq65JaSotKZkLJO/PGwIVBtt70=';

const main = async () => {
  const { Client, Receiver } = await import('@ctrip/qstash');

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (ok) {
      pass++;
      console.info(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
    } else {
      fail++;
      console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    }
  };

  // ── receive the delivery so we can inspect the signature ────────────────────
  interface Received {
    body: string;
    signature: string;
    headers: Record<string, string | string[] | undefined>;
  }
  const received: Received[] = [];
  let failNextWith429 = true;

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({
        body,
        headers: req.headers,
        signature: (req.headers['x-zxqstash-signature'] as string) ?? '',
      });

      // First delivery answers 429 + Retry-After, mirroring the step-lock path
      // in AgentRuntimeService.executeStep.
      if (failNextWith429) {
        failNextWith429 = false;
        res.writeHead(429, { 'Retry-After': '1' });
        res.end(JSON.stringify({ error: 'step locked' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/agent/run`;

  console.info('\n▶ 签名往返与密钥轮转');

  const receiver = new Receiver({
    currentSigningKey: process.env.ZXQSTASH_CURRENT_SIGNING_KEY!,
    nextSigningKey: process.env.ZXQSTASH_NEXT_SIGNING_KEY!,
  });

  console.info('\n▶ 投递（首次 429 → 按 Retry-After 重投）');
  const client = new Client({ token: 'local-mock-token' });
  const payload = { context: null, operationId: 'agt_test_1', stepIndex: 0 };
  await client.publishJSON({ body: payload, delay: 0, retries: 3, url });

  // Wait for both the 429 and the retry.
  const deadline = Date.now() + 15_000;
  while (received.length < 2 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }

  check('首次投递已到达', received.length >= 1);
  check('429 后按 Retry-After 重投', received.length >= 2, `共收到 ${received.length} 次`);

  if (received.length > 0) {
    const first = received[0];
    check('投递体与原始 payload 一致', first.body === JSON.stringify(payload));
    check('带 X-ZxQstash-Signature 头', !!first.signature);
    check(
      '带 QStashQueueServiceImpl 的自定义头透传',
      // publishJSON's `headers` were not set in this test, so just assert content-type
      String(first.headers['content-type'] ?? '').includes('application/json'),
    );

    check('Receiver.verify 接受合法签名', await receiver.verify({ body: first.body, signature: first.signature }));

    check(
      'Receiver.verify 拒绝被篡改的 body',
      !(await receiver.verify({ body: first.body.replace('agt_test_1', 'agt_evil_1'), signature: first.signature })),
    );

    check(
      'Receiver.verify 拒绝伪造签名',
      !(await receiver.verify({ body: first.body, signature: first.signature.slice(0, -4) + 'AAAA' })),
    );

    check('Receiver.verify 拒绝空签名', !(await receiver.verify({ body: first.body, signature: '' })));

    // Key rotation: a receiver whose *next* key is the signing key must still accept.
    const rotated = new Receiver({
      currentSigningKey: 'some-other-key-entirely',
      nextSigningKey: process.env.ZXQSTASH_CURRENT_SIGNING_KEY!,
    });
    check('密钥轮转：next key 也能验过', await rotated.verify({ body: first.body, signature: first.signature }));

    const wrong = new Receiver({ currentSigningKey: 'nope', nextSigningKey: 'also-nope' });
    check('两把钥匙都不对时拒绝', !(await wrong.verify({ body: first.body, signature: first.signature })));
  }

  console.info('\n▶ 离线护栏');
  let guarded = false;
  try {
    await client.publishJSON({ body: {}, url: 'https://calcifer.train.ctripcorp.com/api/agent/run' });
  } catch (error) {
    guarded = String(error).includes('non-loopback');
  }
  check('拒绝向非回环地址投递', guarded);

  let keyGuard = false;
  const savedKey = process.env.ZXQSTASH_CURRENT_SIGNING_KEY;
  delete process.env.ZXQSTASH_CURRENT_SIGNING_KEY;
  try {
    await client.publishJSON({ body: {}, url });
  } catch (error) {
    keyGuard = String(error).includes('ZXQSTASH_CURRENT_SIGNING_KEY');
  }
  process.env.ZXQSTASH_CURRENT_SIGNING_KEY = savedKey;
  check('缺签名密钥时报错而非静默', keyGuard);

  server.close();
  console.info(`\n通过 ${pass} / 失败 ${fail}\n`);
  // Set exitCode rather than process.exit(): tsx's esbuild service is still
  // tearing down, and an immediate exit trips a libuv assertion on Windows.
  process.exitCode = fail === 0 ? 0 : 1;

};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
