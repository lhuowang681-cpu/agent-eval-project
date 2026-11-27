import { useEffect, useState } from 'react';

import { agentService } from '@/services/agent';

interface AgentOwnershipResult {
  error?: string;
  isOwnAgent: boolean | null;
}

const agentOwnershipCache = new Map<string, { result: boolean; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000;

interface CheckOwnershipParams {
  marketIdentifier?: string;
  skipCache?: boolean;
}

export const checkOwnership = async ({
  marketIdentifier,
  skipCache = false,
}: CheckOwnershipParams): Promise<boolean> => {
  if (!marketIdentifier) return false;

  const cached = agentOwnershipCache.get(marketIdentifier);
  if (!skipCache && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.result;
  }

  const localAgentId = await agentService.getAgentByMarketIdentifier(marketIdentifier);
  const isOwner = Boolean(localAgentId);

  agentOwnershipCache.set(marketIdentifier, {
    result: isOwner,
    timestamp: Date.now(),
  });

  return isOwner;
};

export const useAgentOwnershipCheck = (marketIdentifier?: string): AgentOwnershipResult => {
  const [isOwnAgent, setIsOwnAgent] = useState<boolean | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!marketIdentifier) {
      setIsOwnAgent(null);
      return;
    }

    let cancelled = false;

    checkOwnership({ marketIdentifier })
      .then((result) => {
        if (!cancelled) setIsOwnAgent(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setIsOwnAgent(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [marketIdentifier]);

  return { error, isOwnAgent };
};
