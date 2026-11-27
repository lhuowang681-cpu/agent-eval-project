import { isDesktop } from '@lobechat/const';
import { type DeviceExecutionTarget, type LobeAgentAgencyConfig } from '@lobechat/types';

import { resolveExecutionTarget } from '@/helpers/executionTarget';

/**
 * Which agent runtime should handle an operation.
 *
 * - `client`: in-browser / in-desktop AgentRuntime, runs the loop in-process
 *   (today's default — tools execute on this client).
 * - `gateway`: the run is handed to the server over the Agent Gateway; the
 *   server runs the loop and routes tools by `executionPlan`
 *   (device / sandbox / local). This is what makes the execution-target choice
 *   actually change where the agent executes.
 *
 * (lobehub also has a `hetero` runtime for Claude Code / Codex CLI agents; this
 * project does not ship heterogeneous agents, so it is intentionally omitted.)
 */
export type AgentRuntimeType = 'client' | 'gateway';

export interface RuntimeSelectionContext {
  /**
   * The agent's agency config — resolved to an effective execution target
   * (platform defaults / coercions applied) inside `selectRuntimeType` so callers
   * don't each re-derive it. A device / auto target forces the gateway runtime.
   */
  agencyConfig?: LobeAgentAgencyConfig;
  /** Override of `isDesktop` for testability. Defaults to the build-time const. */
  isDesktop?: boolean;
  /** Result of `gateway.isGatewayModeEnabled()` (server config + per-agent toggle gated). */
  isGatewayMode: boolean;
  /**
   * Explicit override that wins over automatic selection — sub-agent dispatches
   * inherit the parent operation's runtime instead of re-deciding, so a child
   * spawned inside a gateway run stays on the gateway.
   */
  parentRuntime?: AgentRuntimeType;
}

/**
 * Centralized "which runtime runs this operation" decision, applied at every
 * entry point (sendMessage / regenerate / resume / sub-agent) so routing rules
 * live in one place.
 *
 * Priority: `parentRuntime` > `executionTarget` (device / auto) > `gateway` >
 * `client`.
 *
 * `device` / `auto` ALWAYS route to the gateway, regardless of the per-agent
 * toggle: the client can't dispatch to a remote device or resolve `auto`
 * against online state — only the server can. `sandbox` does NOT force the
 * gateway: the cloud sandbox is reachable as a builtin tool from the in-process
 * client runtime too (the `cloudSandboxExecutor` calls the `execInSandbox`
 * endpoint), so it honours the toggle like `local` / `none` — gateway on →
 * server runs the loop, off → in-process loop with sandbox tools executed
 * server-side. This mirrors lobehub, where a normal agent's sandbox selection
 * never forces server-side dispatch.
 */
export const selectRuntimeType = (ctx: RuntimeSelectionContext): AgentRuntimeType => {
  if (ctx.parentRuntime) return ctx.parentRuntime;

  const target = resolveExecutionTarget(ctx.agencyConfig, {
    isDesktop: ctx.isDesktop ?? isDesktop,
  });
  if (isServerSideTarget(target)) return 'gateway';
  if (ctx.isGatewayMode) return 'gateway';
  return 'client';
};

/**
 * Targets that only the server can satisfy — selecting one forces the gateway
 * runtime regardless of the per-agent toggle. Exposed so the UI can mark the
 * toggle inert while such a target is active (no contradictory "off" state).
 *
 * `sandbox` is intentionally NOT here: the cloud sandbox runs as a builtin tool
 * that the in-process client runtime can invoke (via the `execInSandbox`
 * endpoint), so it does not require the server to run the agent loop. Only
 * `device` (route to a remote machine) and `auto` (auto-activate an online
 * device) are unreachable from the client.
 */
export const isServerSideTarget = (target: DeviceExecutionTarget): boolean =>
  target === 'device' || target === 'auto';
