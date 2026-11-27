/**
 * Discord Bot configuration for an agent
 */
export interface DiscordBotConfig {
  applicationId: string;
  botToken: string;
  enabled: boolean;
  publicKey: string;
}

/**
 * Slack Bot configuration for an agent
 */
export interface SlackBotConfig {
  botToken: string;
  enabled: boolean;
  signingSecret: string;
}

/**
 * Where an agent run executes — one global target drives both desktop and web.
 *
 * - `none`    : no execution environment — plain chat, no built-in run tools
 * - `auto`    : auto-pick an online device — the only mode that activates a
 *               device the user did not explicitly bind (single online device →
 *               use it; multiple → unrouted/ambiguous, prompt to bind one)
 * - `local`   : in-process spawn on the user's Electron desktop (desktop only)
 * - `device`  : dispatched to an `lh connect` device identified by `boundDeviceId`
 * - `sandbox` : server-spawned cloud sandbox
 *
 * When omitted it resolves to a platform default (`'local'` on desktop, `'none'`
 * on web). See `@/helpers/executionTarget` for the full resolution rules.
 */
export type DeviceExecutionTarget = 'auto' | 'device' | 'local' | 'none' | 'sandbox';

/**
 * Agent agency configuration for external platform bot integrations.
 * Each agent can independently configure its own bot providers.
 */
export interface LobeAgentAgencyConfig {
  /**
   * Device ID of the machine connected via `lh connect`. Used when
   * `executionTarget === 'device'` (or as the legacy device binding when no
   * explicit `executionTarget` is set).
   */
  boundDeviceId?: string;
  discord?: DiscordBotConfig;
  /**
   * Execution target for this agent. When omitted, resolves to a platform
   * default; a legacy `boundDeviceId` without an explicit target is treated as
   * `'device'` so existing device bindings keep working.
   */
  executionTarget?: DeviceExecutionTarget;
  /** External heterogeneous CLI agent provider config, when this agent is backed by one. */
  heterogeneousProvider?: { command?: string; type?: string } | null;
  slack?: SlackBotConfig;
  /**
   * Per-device working directory chosen for this agent. Key = `deviceId` (the
   * local machine uses its own gateway deviceId, so local and remote share one
   * model). Agent-level slot in the resolution precedence:
   *
   *   `topic.metadata.workingDirectory`
   *     > `workingDirByDevice[targetDeviceId]`
   *     > legacy `chatConfig.runtimeEnv.workingDirectory`
   *     > `device.defaultCwd`
   *     > caller fallback (e.g. home dir for in-process runs)
   *
   * Keyed per device so switching the bound device never resolves a path that
   * only exists on another machine. Persisted (server-synced) so the choice
   * follows the user across sessions.
   */
  workingDirByDevice?: Record<string, string>;
}
