/**
 * Local stub for `@ctrip/qworkflow`.
 *
 * The real package is a durable workflow engine: each `context.run(name, fn)` becomes a
 * separately-queued, separately-retried step delivered over QStash. This stub collapses
 * that into plain sequential in-process execution.
 *
 * What you keep: the workflow's control flow and business logic run end to end, so smoke
 * tests and functional assertions still hold.
 *
 * What you lose — do NOT draw reliability conclusions from runs on this stub:
 *   - durability (a crash mid-workflow loses everything; the real engine resumes)
 *   - per-step retry and backoff
 *   - parallel step execution
 *   - flow control / rate limiting
 *   - cross-request step boundaries (everything runs inside one HTTP request, so long
 *     workflows can hit the server's request timeout)
 */

export class WorkflowAbort extends Error {
  stepName?: string;

  constructor(stepName?: string, message = 'Workflow aborted') {
    super(message);
    this.name = 'WorkflowAbort';
    this.stepName = stepName;
  }
}

export class WorkflowNonRetryableError extends Error {
  constructor(message = 'Workflow failed (non-retryable)') {
    super(message);
    this.name = 'WorkflowNonRetryableError';
  }
}

export interface FlowControlConfig {
  key?: string;
  parallelism?: number;
  rate?: number;
  period?: string | number;
}

export interface WorkflowContext<TPayload = unknown> {
  /** Sequential in-process execution — no durability, no retry. */
  run: <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;
  /** Invokes another workflow handler directly, in the same process. */
  invoke: <T = unknown>(workflow: unknown, payload?: unknown) => Promise<T>;
  requestPayload: TPayload;
  workflowRunId: string;
  headers: Record<string, string>;
}

export type WorkflowHandler<TPayload = unknown, TResult = unknown> = (
  context: WorkflowContext<TPayload>,
) => Promise<TResult> | TResult;

/** Registry so `context.invoke(workflowRef)` can resolve a handler created by `createWorkflow`. */
const handlerRegistry = new WeakMap<object, WorkflowHandler<any, any>>();

export const registerWorkflowHandler = (ref: object, handler: WorkflowHandler<any, any>) => {
  handlerRegistry.set(ref, handler);
};

export const resolveWorkflowHandler = (
  ref: unknown,
): WorkflowHandler<any, any> | undefined => {
  if (ref && typeof ref === 'object' && handlerRegistry.has(ref as object)) {
    return handlerRegistry.get(ref as object);
  }
  if (typeof ref === 'function') return ref as WorkflowHandler<any, any>;
  if (ref && typeof ref === 'object' && typeof (ref as any).handler === 'function') {
    return (ref as any).handler;
  }
  return undefined;
};

let runCounter = 0;

export const createContext = <TPayload>(
  requestPayload: TPayload,
  headers: Record<string, string> = {},
): WorkflowContext<TPayload> => {
  const workflowRunId = `stub-wfr-${Date.now()}-${(runCounter += 1)}`;

  const context: WorkflowContext<TPayload> = {
    headers,
    invoke: async <T>(workflow: unknown, payload?: unknown): Promise<T> => {
      const handler = resolveWorkflowHandler(workflow);
      if (!handler) {
        throw new Error(
          '[stub] @ctrip/qworkflow context.invoke could not resolve the target workflow. ' +
            'Pass a handler created by createWorkflow(), or a plain function.',
        );
      }
      return (await handler(createContext(payload, headers))) as T;
    },
    requestPayload,
    run: async <T>(_name: string, fn: () => Promise<T> | T): Promise<T> => fn(),
    workflowRunId,
  };

  return context;
};

export interface ClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  token?: string;
}

export class Client {
  constructor(_options: ClientOptions = {}) {}

  async trigger(_params: Record<string, unknown>): Promise<{ workflowRunId: string }> {
    throw new Error(
      '[stub] @ctrip/qworkflow Client.trigger is not available offline. ' +
        'Invoke the workflow route directly instead of dispatching through the queue.',
    );
  }
}

export default { Client, WorkflowAbort, WorkflowNonRetryableError };
