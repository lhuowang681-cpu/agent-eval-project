/**
 * Local stub for `@ctrip/qworkflow/hono`.
 *
 * `createWorkflow` registers a handler so `context.invoke(ref)` can resolve it;
 * `serve` / `serveMany` return Hono-compatible handlers that run the workflow inline.
 */
import { createContext, registerWorkflowHandler, type WorkflowHandler } from './index';

export interface WorkflowRef<TPayload = unknown, TResult = unknown> {
  handler: WorkflowHandler<TPayload, TResult>;
  workflowId?: string;
}

export const createWorkflow = <TPayload = unknown, TResult = unknown>(
  handler: WorkflowHandler<TPayload, TResult>,
  options: { workflowId?: string } = {},
): WorkflowRef<TPayload, TResult> => {
  const ref: WorkflowRef<TPayload, TResult> = { handler, workflowId: options.workflowId };
  registerWorkflowHandler(ref, handler as WorkflowHandler<any, any>);
  return ref;
};

type HonoContext = {
  json: (body: unknown, status?: number) => Response;
  req: { json: () => Promise<unknown>; header: () => Record<string, string>; path?: string };
};

const runInline = async (
  handler: WorkflowHandler<any, any>,
  c: HonoContext,
): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    payload = undefined;
  }

  const headers = typeof c.req.header === 'function' ? c.req.header() : {};

  try {
    const result = await handler(createContext(payload, headers));
    return c.json({ result, stub: true, success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[stub:qworkflow/hono] workflow failed:', error);
    return c.json({ error: message, stub: true, success: false }, 500);
  }
};

export const serve = <TPayload = unknown, TResult = unknown>(
  handler: WorkflowHandler<TPayload, TResult> | WorkflowRef<TPayload, TResult>,
  _options: Record<string, unknown> = {},
) => {
  const fn = typeof handler === 'function' ? handler : handler.handler;
  return (c: HonoContext) => runInline(fn as WorkflowHandler<any, any>, c);
};

/**
 * `serveMany` maps workflowId → handler. The real engine routes by the last URL segment;
 * this stub does the same, falling back to the sole entry when there is only one.
 */
export const serveMany = (
  workflows: Record<string, WorkflowRef<any, any> | WorkflowHandler<any, any>>,
  _options: Record<string, unknown> = {},
) => {
  const entries = Object.entries(workflows);

  return (c: HonoContext) => {
    const path = c.req.path ?? '';
    const lastSegment = path.split('/').filter(Boolean).pop() ?? '';

    const matched =
      entries.find(([id]) => id === lastSegment) ??
      (entries.length === 1 ? entries[0] : undefined);

    if (!matched) {
      return c.json(
        {
          available: entries.map(([id]) => id),
          error: `[stub] @ctrip/qworkflow serveMany: no workflow matched "${lastSegment}"`,
          stub: true,
        },
        404,
      );
    }

    const ref = matched[1];
    const fn = typeof ref === 'function' ? ref : ref.handler;
    return runInline(fn as WorkflowHandler<any, any>, c);
  };
};

export default { createWorkflow, serve, serveMany };
