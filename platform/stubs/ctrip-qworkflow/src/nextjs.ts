/**
 * Local stub for `@ctrip/qworkflow/nextjs`.
 *
 * `serve()` normally returns a Next.js route handler that participates in the durable
 * workflow protocol (signature verification, step resumption, QStash callbacks). Here it
 * returns a plain handler that parses the JSON body, runs the whole workflow inline, and
 * returns the result.
 */
import { createContext, type WorkflowHandler } from './index';

export interface ServeOptions {
  failureFunction?: (params: { failStatus: number; failResponse: string }) => Promise<void> | void;
  flowControl?: unknown;
  qstashClient?: unknown;
  retries?: number;
  [key: string]: unknown;
}

export const serve = <TPayload = unknown, TResult = unknown>(
  handler: WorkflowHandler<TPayload, TResult>,
  options: ServeOptions = {},
) => {
  const POST = async (request: Request): Promise<Response> => {
    let payload: TPayload;
    try {
      payload = (await request.json()) as TPayload;
    } catch {
      payload = undefined as TPayload;
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    try {
      const result = await handler(createContext<TPayload>(payload, headers));
      return Response.json({ result, stub: true, success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[stub:qworkflow/nextjs] workflow failed:', error);

      await options.failureFunction?.({ failResponse: message, failStatus: 500 });

      return Response.json({ error: message, stub: true, success: false }, { status: 500 });
    }
  };

  return { GET: POST, POST };
};

export default { serve };
