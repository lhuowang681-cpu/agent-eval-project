/**
 * Local stub for `@ctrip/peta-ai-client`.
 *
 * `resolvePetaLlmGateway` resolves the address of Ctrip's internal Peta LLM gateway,
 * which backs the `tripflow` and `ztrip` providers. Both are unreachable offline.
 *
 * NOTE: `packages/business/const/src/llm.ts` ships `DEFAULT_PROVIDER = 'tripflow'`, so an
 * unmodified checkout hits this on the very first message. Offline setups must point
 * DEFAULT_PROVIDER at a locally-served provider — see PLAN.md §4.5.
 */

export interface PetaGatewayResult {
  baseUrl: string;
  token?: string;
  [key: string]: unknown;
}

export const resolvePetaLlmGateway = async (
  _petaKeyId: string,
  _options?: Record<string, unknown>,
): Promise<PetaGatewayResult> => {
  throw new Error(
    '[stub] @ctrip/peta-ai-client resolvePetaLlmGateway is unavailable offline. ' +
      'The tripflow/ztrip providers need Ctrip’s internal Peta gateway. ' +
      'Set DEFAULT_PROVIDER (packages/business/const/src/llm.ts) to a locally-served provider.',
  );
};

export default { resolvePetaLlmGateway };
