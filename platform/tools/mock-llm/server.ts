#!/usr/bin/env tsx
/**
 * Offline Mock LLM Server — OpenAI-compatible.
 *
 * Purpose: let the whole agent stack run and be load-tested with **zero network egress**,
 * and make the hard-to-reach branches (forced tool calls, approval gates, context
 * compression, provider errors) deterministic and reproducible.
 *
 * For load testing this is not a compromise but an improvement: a real provider's network
 * jitter and server-side queuing pollute latency readings. Pinning first-token latency and
 * output rate turns the LLM into a controlled constant, so what you measure is the
 * framework's own overhead.
 *
 * Endpoints
 *   POST /v1/chat/completions   streaming + non-streaming
 *   POST /v1/embeddings         deterministic pseudo-vectors
 *   GET  /v1/models             minimal model list
 *   GET  /__mock/scenarios      list built-in scenarios
 *   POST /__mock/config         { scenario?, firstTokenDelayMs?, tokensPerSecond? }
 *   POST /__mock/reset          clear per-conversation turn cursors
 *   GET  /__mock/stats          request counters
 *
 * Usage
 *   bun run tsx tools/mock-llm/server.ts
 *   MOCK_LLM_PORT=8088 MOCK_LLM_SCENARIO=single-tool bun run tsx tools/mock-llm/server.ts
 *
 * Point the app at it with:
 *   OPENAI_PROXY_URL=http://localhost:8088/v1
 *   OPENAI_API_KEY=sk-local-mock
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { defaultScenario, listScenarios, scenarios } from './scenarios';
import { judgeFixture } from './judge';
import { attributionFixture } from './attributionFixture';
import type { MockServerConfig, MockToolCall, MockTurn } from './types';

// ── config ──────────────────────────────────────────────────────────────────

const config: MockServerConfig = {
  embeddingDimensions: Number(process.env.MOCK_LLM_EMBEDDING_DIM ?? 1536),
  firstTokenDelayMs: Number(process.env.MOCK_LLM_FIRST_TOKEN_MS ?? 800),
  port: Number(process.env.MOCK_LLM_PORT ?? 8088),
  scenario: process.env.MOCK_LLM_SCENARIO ?? defaultScenario,
  tokensPerSecond: Number(process.env.MOCK_LLM_TOKENS_PER_SEC ?? 50),
};

const stats = {
  chatCompletions: 0,
  embeddings: 0,
  errors: 0,
  startedAt: Date.now(),
  judgeRequests: [] as Array<{
    model: string;
    hasInput: boolean;
    hasExpected: boolean;
    hasActual: boolean;
    hasCriteria: boolean;
    structured: boolean;
  }>,
};

/**
 * Per-conversation turn cursor. Keyed by a hash of the first user message so that a
 * multi-step agent run (which sends a growing message array) keeps advancing through the
 * scenario instead of replaying turn 0 forever.
 */
const cursors = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const conversationKey = (messages: any[]): string => {
  const firstUser = messages.find((m) => m?.role === 'user');
  const seed =
    typeof firstUser?.content === 'string'
      ? firstUser.content
      : JSON.stringify(firstUser?.content ?? messages[0] ?? '');
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
};

const nextTurn = (messages: any[]): MockTurn => {
  const scenario = scenarios[config.scenario] ?? scenarios[defaultScenario];
  const key = conversationKey(messages);
  const index = cursors.get(key) ?? 0;

  const turn =
    scenario.turns[index] ??
    (scenario.repeatLast !== false ? scenario.turns.at(-1)! : { content: '(scenario exhausted)' });

  cursors.set(key, index + 1);
  return turn;
};

// ── helpers ─────────────────────────────────────────────────────────────────

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

/** Split into small chunks so streaming looks token-ish without a real tokenizer. */
const chunkText = (text: string): string[] => text.match(/[\s\S]{1,4}/g) ?? [];

const buildUsage = (turn: MockTurn, promptText: string) => {
  if (turn.usage) return turn.usage;
  const completion = `${turn.reasoning ?? ''}${turn.content ?? ''}`;
  const prompt = estimateTokens(promptText);
  const output = estimateTokens(completion);
  return { completion_tokens: output, prompt_tokens: prompt, total_tokens: prompt + output };
};

const toOpenAIToolCalls = (calls: MockToolCall[]) =>
  calls.map((call, i) => ({
    function: { arguments: JSON.stringify(call.arguments), name: call.name },
    id: call.id ?? `call_mock_${Date.now()}_${i}`,
    index: i,
    type: 'function' as const,
  }));

const readJson = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Length': Buffer.byteLength(payload),
    'Content-Type': 'application/json',
  });
  res.end(payload);
};

const sendError = (res: ServerResponse, status: number, message: string) => {
  stats.errors += 1;
  sendJson(res, status, {
    error: { code: null, message, param: null, type: 'mock_error' },
  });
};

// ── /v1/chat/completions ────────────────────────────────────────────────────

const handleChatCompletions = async (req: IncomingMessage, res: ServerResponse) => {
  stats.chatCompletions += 1;

  const body = await readJson(req);
  const messages: any[] = body.messages ?? [];
  const model: string = body.model ?? 'mock-model';
  const stream: boolean = body.stream ?? false;

  if (model.startsWith('mock-judge-')) {
    const prompt = JSON.stringify(messages).toLowerCase();
    stats.judgeRequests.push({
      model,
      hasInput: prompt.includes('[question]'),
      hasExpected: prompt.includes('[expected]') || prompt.includes('[correct_answer]'),
      hasActual: prompt.includes('[output]') || prompt.includes('[response]'),
      hasCriteria: prompt.includes('[criteria]'),
      structured: body.response_format?.type === 'json_schema',
    });
    if (stats.judgeRequests.length > 1000) stats.judgeRequests.shift();
  }
  const turn = model === 'mock-attribution-candidate'
    ? attributionFixture(body)
    : model.startsWith('mock-judge-') ? judgeFixture(model, body) : nextTurn(messages);
  const promptText = JSON.stringify(messages);

  // --- injected failures -----------------------------------------------------
  if (turn.error?.kind === 'http') {
    return sendError(res, turn.error.status ?? 500, turn.error.message ?? 'mock error');
  }

  if (turn.error?.kind === 'timeout') {
    await sleep(turn.error.holdMs ?? 120_000);
    res.destroy();
    return;
  }

  const firstTokenDelay = turn.firstTokenDelayMs ?? config.firstTokenDelayMs;
  const tps = turn.tokensPerSecond ?? config.tokensPerSecond;
  const perChunkDelay = tps > 0 ? 1000 / tps : 0;

  const id = `chatcmpl-mock-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const usage = buildUsage(turn, promptText);
  const finishReason = turn.finishReason ?? (turn.toolCalls?.length ? 'tool_calls' : 'stop');

  await sleep(firstTokenDelay);

  // --- non-streaming ---------------------------------------------------------
  if (!stream) {
    return sendJson(res, 200, {
      choices: [
        {
          finish_reason: finishReason,
          index: 0,
          message: {
            content: turn.content ?? null,
            reasoning_content: turn.reasoning,
            role: 'assistant',
            tool_calls: turn.toolCalls?.length ? toOpenAIToolCalls(turn.toolCalls) : undefined,
          },
        },
      ],
      created,
      id,
      model,
      object: 'chat.completion',
      usage,
    });
  }

  // --- streaming -------------------------------------------------------------
  res.writeHead(200, {
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
  });

  const emit = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta, index: 0, ...extra }],
        created,
        id,
        model,
        object: 'chat.completion.chunk',
      })}\n\n`,
    );
  };

  emit({ role: 'assistant' });

  let emitted = 0;

  if (turn.reasoning) {
    for (const chunk of chunkText(turn.reasoning)) {
      emit({ reasoning_content: chunk });
      emitted += 1;
      if (perChunkDelay) await sleep(perChunkDelay);
    }
  }

  if (turn.content) {
    for (const chunk of chunkText(turn.content)) {
      if (turn.error?.kind === 'stream' && emitted >= (turn.error.afterChunks ?? 5)) {
        console.warn(`[mock-llm] aborting stream: ${turn.error.message ?? 'mock stream abort'}`);
        res.destroy();
        stats.errors += 1;
        return;
      }
      emit({ content: chunk });
      emitted += 1;
      if (perChunkDelay) await sleep(perChunkDelay);
    }
  }

  if (turn.toolCalls?.length) {
    emit({ tool_calls: toOpenAIToolCalls(turn.toolCalls) });
  }

  emit({}, { finish_reason: finishReason });

  res.write(
    `data: ${JSON.stringify({
      choices: [],
      created,
      id,
      model,
      object: 'chat.completion.chunk',
      usage,
    })}\n\n`,
  );

  res.write('data: [DONE]\n\n');
  res.end();
};

// ── /v1/embeddings ──────────────────────────────────────────────────────────

/** Deterministic pseudo-vector: same input always yields the same unit-ish vector. */
const fakeEmbedding = (input: string, dimensions: number): number[] => {
  const digest = createHash('sha256').update(input).digest();
  const vec = new Array<number>(dimensions);
  for (let i = 0; i < dimensions; i += 1) {
    vec[i] = (digest[i % digest.length] / 255) * 2 - 1;
  }
  const norm = Math.hypot(...vec) || 1;
  return vec.map((v) => v / norm);
};

const handleEmbeddings = async (req: IncomingMessage, res: ServerResponse) => {
  stats.embeddings += 1;

  const body = await readJson(req);
  const raw = body.input ?? '';
  const inputs: string[] = Array.isArray(raw) ? raw.map(String) : [String(raw)];

  sendJson(res, 200, {
    data: inputs.map((text, index) => ({
      embedding: fakeEmbedding(text, config.embeddingDimensions),
      index,
      object: 'embedding',
    })),
    model: body.model ?? 'mock-embedding',
    object: 'list',
    usage: {
      prompt_tokens: inputs.reduce((n, t) => n + estimateTokens(t), 0),
      total_tokens: inputs.reduce((n, t) => n + estimateTokens(t), 0),
    },
  });
};

// ── router ──────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
  const path = url.pathname;

  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (path.endsWith('/chat/completions') && req.method === 'POST') {
      return await handleChatCompletions(req, res);
    }

    if (path.endsWith('/embeddings') && req.method === 'POST') {
      return await handleEmbeddings(req, res);
    }

    if (path.endsWith('/models') && req.method === 'GET') {
      return sendJson(res, 200, {
        data: [
          { created: 0, id: 'mock-model', object: 'model', owned_by: 'mock' },
          { created: 0, id: 'mock-embedding', object: 'model', owned_by: 'mock' },
        ],
        object: 'list',
      });
    }

    if (path === '/__mock/scenarios') {
      return sendJson(res, 200, { active: config.scenario, scenarios: listScenarios() });
    }

    if (path === '/__mock/config' && req.method === 'POST') {
      const patch = await readJson(req);
      if (patch.scenario && !scenarios[patch.scenario]) {
        return sendError(res, 400, `unknown scenario: ${patch.scenario}`);
      }
      Object.assign(config, patch);
      cursors.clear();
      console.info('[mock-llm] config updated:', config);
      return sendJson(res, 200, { config, ok: true });
    }

    if (path === '/__mock/reset' && req.method === 'POST') {
      cursors.clear();
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/__mock/stats') {
      return sendJson(res, 200, { ...stats, config, uptimeMs: Date.now() - stats.startedAt });
    }

    if (path === '/health') {
      return sendJson(res, 200, { service: 'mock-llm', status: 'ok' });
    }

    return sendError(res, 404, `no mock route for ${req.method} ${path}`);
  } catch (error) {
    console.error('[mock-llm] handler error:', error);
    return sendError(res, 500, error instanceof Error ? error.message : String(error));
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.info(`[mock-llm] listening on http://127.0.0.1:${config.port}`);
  console.info(`[mock-llm] scenario: ${config.scenario}`);
  console.info(
    `[mock-llm] firstTokenDelay=${config.firstTokenDelayMs}ms tokensPerSecond=${config.tokensPerSecond}`,
  );
  console.info(`[mock-llm] point the app at OPENAI_PROXY_URL=http://localhost:${config.port}/v1`);
});
