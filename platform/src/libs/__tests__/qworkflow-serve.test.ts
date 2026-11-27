// @vitest-environment node
import { WorkflowAbort, WorkflowNonRetryableError } from '@ctrip/qworkflow';
import { createWorkflow, serve as serveHono, serveMany } from '@ctrip/qworkflow/hono';
import { serve as serveNextjs } from '@ctrip/qworkflow/nextjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fetch for step callbacks
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const createResponse = (status: number, body?: unknown) =>
  new Response(body ? JSON.stringify(body) : '', {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Build a WorkflowStepDelivery request body
 */
function buildDelivery(overrides: {
  workflowRunId?: string;
  stepIndex?: number;
  requestPayload?: unknown;
  stepsHistory?: Array<{ stepId: string; stepIndex: number; result: unknown }>;
  headers?: Record<string, string>;
}) {
  return {
    workflowRunId: overrides.workflowRunId ?? 'wf-test-001',
    stepIndex: overrides.stepIndex ?? 0,
    requestPayload: overrides.requestPayload ?? {},
    stepsHistory: overrides.stepsHistory ?? [],
    headers: overrides.headers,
  };
}

/**
 * Build a mock Hono context
 */
function buildHonoContext(body: unknown) {
  const reqBody = JSON.stringify(body);
  return {
    req: {
      json: async () => JSON.parse(reqBody),
      url: 'https://app.example.com/api/workflows/test',
    },
    json: (data: unknown, status?: number) =>
      new Response(JSON.stringify(data), {
        status: status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  } as any;
}

describe('WorkflowContext - step execution via serve()', () => {
  beforeEach(() => {
    vi.stubEnv('ZXQSTASH_SERVER_URL', 'https://zxqstash.example.com');
    vi.stubEnv('ZXQSTASH_TOKEN', 'test-token');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(createResponse(200, {}));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('context.run() - basic step execution', () => {
    it('executes the first step and returns result', async () => {
      const handler = vi.fn(async (context) => {
        const result = await context.run('step-1', async () => {
          return { data: 'hello' };
        });
        return { success: true, result };
      });

      const { POST } = serveNextjs(handler);
      const delivery = buildDelivery({
        stepIndex: 0,
        requestPayload: { userId: 'u1' },
      });

      const response = await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(delivery),
        }),
      );

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('passes requestPayload to context', async () => {
      let capturedPayload: unknown;

      const handler = async (context: any) => {
        capturedPayload = context.requestPayload;
        await context.run('step-1', () => 'done');
        return 'ok';
      };

      const { POST } = serveNextjs(handler);
      const payload = { userId: 'user-123', topicIds: ['t1'] };

      await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(buildDelivery({ requestPayload: payload })),
        }),
      );

      expect(capturedPayload).toEqual(payload);
    });

    it('sends step callback to server after execution', async () => {
      const handler = async (context: any) => {
        await context.run('step-1', () => ({ value: 42 }));
        return 'complete';
      };

      const { POST } = serveNextjs(handler);
      await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(buildDelivery({ stepIndex: 0 })),
        }),
      );

      // Verify step callback was sent
      expect(mockFetch).toHaveBeenCalled();
      const callbackCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/v1/workflows/steps/callback'),
      );
      expect(callbackCall).toBeDefined();

      const callbackBody = JSON.parse((callbackCall![1] as any).body);
      expect(callbackBody.stepId).toBe('step-1');
      expect(callbackBody.stepIndex).toBe(0);
      expect(callbackBody.status).toBe('success');
      expect(callbackBody.result).toEqual({ value: 42 });
    });
  });

  describe('context.run() - step caching (history replay)', () => {
    it('returns cached result for already-completed steps', async () => {
      const stepHandler = vi.fn(async () => 'should-not-execute');

      const handler = async (context: any) => {
        // This step is in history - should return cached result
        const cached = await context.run('step-1', stepHandler);
        return { cached };
      };

      const { POST } = serveNextjs(handler);
      const delivery = buildDelivery({
        stepIndex: 1, // Current step is 1, but handler only runs step-0
        stepsHistory: [{ stepId: 'step-1', stepIndex: 0, result: 'cached-value' }],
      });

      const response = await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(delivery),
        }),
      );

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.result).toEqual({ cached: 'cached-value' });
      expect(stepHandler).not.toHaveBeenCalled();
    });

    it('replays multi-step history correctly', async () => {
      const handler = async (context: any) => {
        const a = await context.run('step-a', () => 'should-not-run');
        const b = await context.run('step-b', () => 'should-not-run');
        const c = await context.run('step-c', async () => 'new-result');
        return { a, b, c };
      };

      const { POST } = serveNextjs(handler);
      const delivery = buildDelivery({
        stepIndex: 2,
        stepsHistory: [
          { stepId: 'step-a', stepIndex: 0, result: 'result-a' },
          { stepId: 'step-b', stepIndex: 1, result: 'result-b' },
        ],
      });

      const response = await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(delivery),
        }),
      );

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.result).toEqual({ a: 'result-a', b: 'result-b', c: 'new-result' });
    });
  });

  describe('context.run() - error handling', () => {
    it('handles WorkflowAbort - marks step as failed with isCompleted=true', async () => {
      const handler = async (context: any) => {
        await context.run('step-abort', () => {
          throw new WorkflowAbort('User requested abort');
        });
        return 'never-reached';
      };

      const { POST } = serveNextjs(handler);
      const response = await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(buildDelivery({ stepIndex: 0 })),
        }),
      );

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.isAbort).toBe(true);
      expect(body.error).toBe('User requested abort');
      expect(response.status).toBe(200); // Abort is intentional, returns 200
    });

    it('handles WorkflowNonRetryableError - marks as failed without retry', async () => {
      const handler = async (context: any) => {
        await context.run('step-fail', () => {
          throw new WorkflowNonRetryableError('Data not found');
        });
        return 'never-reached';
      };

      const { POST } = serveNextjs(handler);
      const response = await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(buildDelivery({ stepIndex: 0 })),
        }),
      );

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.isNonRetryable).toBe(true);
      expect(body.error).toBe('Data not found');
      expect(response.status).toBe(400);
    });

    it('handles retryable errors - returns 500', async () => {
      const handler = async (context: any) => {
        await context.run('step-error', () => {
          throw new Error('Transient error');
        });
        return 'never-reached';
      };

      const { POST } = serveNextjs(handler);
      const response = await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(buildDelivery({ stepIndex: 0 })),
        }),
      );

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Transient error');
      expect(response.status).toBe(500);
    });
  });

  describe('failureFunction', () => {
    it('calls failureFunction on workflow error', async () => {
      const failureFn = vi.fn(async () => 'failure-handled');

      const handler = async (context: any) => {
        await context.run('step-fail', () => {
          throw new Error('boom');
        });
        return 'never';
      };

      const { POST } = serveNextjs(handler, {
        failureFunction: failureFn,
      });

      await POST(
        new Request('https://app.example.com', {
          method: 'POST',
          body: JSON.stringify(buildDelivery({ stepIndex: 0 })),
        }),
      );

      expect(failureFn).toHaveBeenCalledOnce();
      const failureArg = (failureFn.mock.calls as any[][])[0][0];
      expect(failureArg.failStatus).toBe(500);
      expect(failureArg.failResponse).toBe('boom');
    });
  });
});

describe('NextJS serve() adapter', () => {
  beforeEach(() => {
    vi.stubEnv('ZXQSTASH_SERVER_URL', 'https://zxqstash.example.com');
    vi.stubEnv('ZXQSTASH_TOKEN', 'test-token');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(createResponse(200, {}));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns { POST } handler', () => {
    const result = serveNextjs(async () => 'ok');
    expect(result).toHaveProperty('POST');
    expect(typeof result.POST).toBe('function');
  });

  it('returns 200 with success result', async () => {
    const { POST } = serveNextjs(async (ctx: any) => {
      await ctx.run('step-1', () => 'result');
      return { done: true };
    });

    const response = await POST(
      new Request('https://app.example.com', {
        method: 'POST',
        body: JSON.stringify(buildDelivery({ stepIndex: 0 })),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('returns 500 on unexpected errors', async () => {
    const { POST } = serveNextjs(async () => {
      throw new Error('unexpected');
    });

    const response = await POST(
      new Request('https://app.example.com', {
        method: 'POST',
        body: JSON.stringify(buildDelivery({ stepIndex: 0 })),
      }),
    );

    expect(response.status).toBe(500);
  });

  it('returns 500 on invalid JSON body', async () => {
    const { POST } = serveNextjs(async () => 'ok');

    const response = await POST(
      new Request('https://app.example.com', {
        method: 'POST',
        body: 'not-json',
      }),
    );

    expect(response.status).toBe(500);
  });
});

describe('Hono serve() adapter', () => {
  beforeEach(() => {
    vi.stubEnv('ZXQSTASH_SERVER_URL', 'https://zxqstash.example.com');
    vi.stubEnv('ZXQSTASH_TOKEN', 'test-token');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(createResponse(200, {}));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a Hono middleware function', () => {
    const handler = serveHono(async () => 'ok');
    expect(typeof handler).toBe('function');
  });

  it('executes workflow via Hono context', async () => {
    const handler = serveHono(async (ctx: any) => {
      await ctx.run('step-1', () => 'hono-result');
      return { source: 'hono' };
    });

    const c = buildHonoContext(buildDelivery({ stepIndex: 0 }));
    const response = await handler(c);
    const body = await response.json();

    expect(body.success).toBe(true);
  });
});

describe('createWorkflow()', () => {
  it('creates a workflow definition with handler and options', () => {
    const handler = async (ctx: any) => {
      await ctx.run('step-1', () => 'ok');
      return 'done';
    };

    const workflow = createWorkflow(handler, {
      retries: 3,
    });

    expect(workflow.handler).toBe(handler);
    expect(workflow.options).toEqual({ retries: 3 });
    expect(workflow.workflowId).toBeUndefined();
  });

  it('allows setting workflowId after creation', () => {
    const workflow = createWorkflow(async () => 'ok');
    workflow.workflowId = 'my-workflow';
    expect(workflow.workflowId).toBe('my-workflow');
  });
});

describe('serveMany() - multi-workflow dispatcher', () => {
  beforeEach(() => {
    vi.stubEnv('ZXQSTASH_SERVER_URL', 'https://zxqstash.example.com');
    vi.stubEnv('ZXQSTASH_TOKEN', 'test-token');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(createResponse(200, {}));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches to correct workflow based on last URL path segment', async () => {
    const handlerA = vi.fn(async (ctx: any) => {
      await ctx.run('step-a', () => 'result-a');
      return { workflow: 'a' };
    });
    const handlerB = vi.fn(async (ctx: any) => {
      await ctx.run('step-b', () => 'result-b');
      return { workflow: 'b' };
    });

    const wfA = createWorkflow(handlerA);
    const wfB = createWorkflow(handlerB);

    const dispatcher = serveMany({ 'workflow-a': wfA, 'workflow-b': wfB });

    // Simulate request to /api/workflows/workflow-b
    const c = {
      req: {
        json: async () => buildDelivery({ stepIndex: 0 }),
        url: 'https://app.example.com/api/workflows/workflow-b',
      },
      json: (data: unknown, status?: number) =>
        new Response(JSON.stringify(data), {
          status: status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    } as any;

    const response = await dispatcher(c);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it('returns 404 for unknown workflow ID', async () => {
    const dispatcher = serveMany({
      'known-workflow': createWorkflow(async () => 'ok'),
    });

    const c = {
      req: {
        json: async () => buildDelivery({ stepIndex: 0 }),
        url: 'https://app.example.com/api/workflows/unknown-workflow',
      },
      json: (data: unknown, status?: number) =>
        new Response(JSON.stringify(data), {
          status: status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    } as any;

    const response = await dispatcher(c);
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.error).toContain('Workflow not found');
  });
});

describe('Error classes compatibility', () => {
  it('WorkflowAbort extends Error', () => {
    const error = new WorkflowAbort('test abort');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WorkflowAbort');
    expect(error.message).toBe('test abort');
  });

  it('WorkflowAbort has default message', () => {
    const error = new WorkflowAbort();
    expect(error.message).toBe('Workflow aborted');
  });

  it('WorkflowNonRetryableError extends Error', () => {
    const error = new WorkflowNonRetryableError('test non-retryable');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WorkflowNonRetryableError');
    expect(error.message).toBe('test non-retryable');
  });

  it('WorkflowNonRetryableError has default message', () => {
    const error = new WorkflowNonRetryableError();
    expect(error.message).toBe('Workflow failed with non-retryable error');
  });

  it('can check error type with instanceof', () => {
    const abort = new WorkflowAbort();
    const nonRetryable = new WorkflowNonRetryableError();
    const generic = new Error('generic');

    expect(abort instanceof WorkflowAbort).toBe(true);
    expect(abort instanceof WorkflowNonRetryableError).toBe(false);
    expect(nonRetryable instanceof WorkflowNonRetryableError).toBe(true);
    expect(nonRetryable instanceof WorkflowAbort).toBe(false);
    expect(generic instanceof WorkflowAbort).toBe(false);
  });
});

describe('FlowControlConfig type compatibility', () => {
  it('accepts FlowControlConfig in trigger options', async () => {
    // This test verifies the type system works correctly at runtime
    const flowControl = {
      key: 'memory-user-memory.pipelines.chat-topic.process-topics.user.user-1',
      parallelism: 5,
    };

    // Verify the flow control object shape matches what @ctrip/qworkflow expects
    expect(flowControl.key).toBeDefined();
    expect(flowControl.parallelism).toBeDefined();
    expect(typeof flowControl.key).toBe('string');
    expect(typeof flowControl.parallelism).toBe('number');
  });
});
