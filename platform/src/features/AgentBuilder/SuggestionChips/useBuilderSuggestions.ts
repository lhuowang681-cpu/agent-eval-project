import {
  type BuilderSuggestionItem,
  type BuilderSuggestionMode,
  chainBuilderSuggestion,
} from '@lobechat/prompts';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { aiChatService } from '@/services/aiChat';

interface UseBuilderSuggestionsParams {
  contextSummary: string;
  enabled: boolean;
  locale?: string;
  mode: BuilderSuggestionMode;
  model: string;
  provider: string;
}

interface BuilderSuggestionsResult {
  error: unknown;
  isLoading: boolean;
  /** Discards the current batch and generates a fresh one. */
  refresh: () => void;
  suggestions: BuilderSuggestionItem[];
}

type GenerateEnvelope = { suggestions?: BuilderSuggestionItem[] } | null;

export const useBuilderSuggestions = ({
  mode,
  contextSummary,
  model,
  provider,
  locale,
  enabled,
}: UseBuilderSuggestionsParams): BuilderSuggestionsResult => {
  // Bumping the nonce forces a fresh generation (a changed SWR key) on refresh.
  const [nonce, setNonce] = useState(0);

  const key =
    enabled && contextSummary && model && provider
      ? (['builder-suggestion', mode, contextSummary, nonce] as const)
      : null;

  const { data, isLoading, error } = useSWR(
    key,
    async () => {
      const { messages, schema } = chainBuilderSuggestion({ contextSummary, locale, mode });
      const abortController = new AbortController();
      const envelope = (await aiChatService.generateJSON(
        {
          keyVaultsPayload: '',
          messages,
          model,
          provider,
          schema,
        },
        abortController,
      )) as GenerateEnvelope;

      return (envelope?.suggestions ?? [])
        .filter((s) => s?.title?.trim() && s?.prompt?.trim())
        .slice(0, 3);
    },
    {
      dedupingInterval: 600_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return {
    error,
    isLoading: !!key && isLoading,
    refresh,
    suggestions: data ?? [],
  };
};
