/**
 * A tool message must NEVER be persisted with empty content: an empty result is
 * silently read by the model as "succeeded with no output", which then cascades
 * (e.g. a follow-up step references a file/output that was never produced, or the
 * model retries blindly with no idea what went wrong).
 *
 * Every call site that turns a `BuiltinToolResult`/`ToolExecutionResult` into a
 * persisted/streamed tool message content string must go through this helper
 * instead of reading `.content` directly, so the fallback can't be forgotten on
 * a new call site.
 */
export const resolveToolMessageContent = (params: {
  content?: string;
  error?: { message?: string };
  toolName: string;
}): string => {
  const { content, error, toolName } = params;

  return (
    content ||
    error?.message ||
    `⚠️ ${toolName} returned no output (possible execution error). Do not assume success — verify or retry before continuing.`
  );
};
