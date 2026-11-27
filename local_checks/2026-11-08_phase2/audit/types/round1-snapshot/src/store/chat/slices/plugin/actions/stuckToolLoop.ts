import { type UIChatMessage } from '@lobechat/types';

/**
 * After this many consecutive identical tool failures we stop the agent loop instead of
 * re-invoking the model again, to avoid a tool that keeps rejecting the call (e.g. a server-side
 * validation error) burning turns indefinitely until the user manually aborts.
 */
export const STUCK_TOOL_FAILURE_LIMIT = 3;

/**
 * A tool result counts as a failure if it carries a structured plugin error, or if its content is
 * an `{ "error": ... }` payload. The latter covers tools (like the Feishu MCP) whose transport call
 * succeeds but whose result body is itself an error — those never set `pluginError`.
 *
 * A result the user manually aborted or rejected doesn't count, even if it carries a stale
 * `pluginError` left over from the in-flight call: that's a human breaking the loop on purpose, not
 * the model blindly repeating itself, and it also acts as a natural boundary for the streak below.
 */
const isErroredToolResult = (message: UIChatMessage): boolean => {
  if (message.role !== 'tool') return false;
  if (
    message.pluginIntervention?.status === 'aborted' ||
    message.pluginIntervention?.status === 'rejected'
  ) {
    return false;
  }
  if (message.pluginError != null) return true;

  const { content } = message;
  if (typeof content !== 'string') return false;

  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown> | null;
    return !!parsed && typeof parsed === 'object' && Boolean(parsed.error);
  } catch {
    return false;
  }
};

/**
 * Count how many of the most recent tool results are the *same failing call* repeated: the same
 * tool invoked with the same arguments, erroring each time. A success or a changed call (different
 * arguments) resets the streak. Keying on arguments — rather than the error text — means a model
 * stuck re-sending the identical call is caught even when the error body carries noise like a
 * varying log_id, while a model genuinely trying different inputs is left alone.
 *
 * The scan stops at the last `stuckToolLoopBreak` checkpoint — the marker message this same
 * circuit breaker created the previous time it fired. Without that boundary, once a streak ever
 * reaches the limit, no *new* tool message ever gets appended after it (the breaker returns before
 * invoking the model again), so the same stale streak would keep tripping the breaker on every
 * later, unrelated turn forever.
 */
export const countTrailingIdenticalToolFailures = (
  messages: UIChatMessage[],
): { count: number; toolName?: string } => {
  let count = 0;
  let signature: string | null = null;
  let toolName: string | undefined;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.metadata?.stuckToolLoopBreak) break;
    if (message.role !== 'tool') continue;
    if (!isErroredToolResult(message)) break;

    const apiName = message.plugin?.apiName ?? '';
    const sig = `${message.plugin?.identifier ?? ''}::${apiName}::${message.plugin?.arguments ?? ''}`;
    if (signature === null) {
      signature = sig;
      toolName = apiName || message.plugin?.identifier;
    } else if (sig !== signature) {
      break;
    }

    count += 1;
  }

  return { count, toolName };
};
