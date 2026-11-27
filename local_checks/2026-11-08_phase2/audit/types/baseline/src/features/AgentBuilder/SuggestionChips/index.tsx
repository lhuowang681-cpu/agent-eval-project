'use client';

import { ActionIcon, Block, Flexbox, Skeleton as LobeSkeleton, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import SuggestQuestions, { type SuggestMode } from '@/features/SuggestQuestions';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import { useBuilderContext } from './useBuilderContext';
import { useBuilderSuggestions } from './useBuilderSuggestions';

interface ChipItemProps {
  prompt: string;
  title: string;
}

const ChipItem = memo<ChipItemProps>(({ title, prompt }) => {
  const mainInputEditor = useChatStore((s) => s.mainInputEditor);

  const handleClick = useCallback(() => {
    mainInputEditor?.instance?.setDocument('markdown', prompt);
    mainInputEditor?.focus();
  }, [prompt, mainInputEditor]);

  return (
    <Block
      clickable
      style={{ borderRadius: cssVar.borderRadiusLG, cursor: 'pointer' }}
      variant={'outlined'}
      onClick={handleClick}
    >
      <Flexbox gap={4} paddingBlock={12} paddingInline={14}>
        <Text ellipsis fontSize={14} style={{ fontWeight: 500 }}>
          {title}
        </Text>
        <Text color={cssVar.colorTextTertiary} ellipsis={{ rows: 2 }} fontSize={12}>
          {prompt}
        </Text>
      </Flexbox>
    </Block>
  );
});

/**
 * Lightweight loading placeholder that keeps the exact chip-card chrome (same
 * Block, border, radius, padding) and only swaps the title/description text for
 * skeleton lines — minimising layout shift (CLS) when real chips arrive.
 */
const ChipSkeleton = memo(() => (
  <Block style={{ borderRadius: cssVar.borderRadiusLG }} variant={'outlined'}>
    <Flexbox gap={8} paddingBlock={12} paddingInline={14}>
      <LobeSkeleton.Button
        active
        size={'small'}
        style={{ borderRadius: 4, height: 14, minWidth: 96, width: 96 }}
      />
      <Flexbox gap={6}>
        <LobeSkeleton.Button
          active
          block
          size={'small'}
          style={{ borderRadius: 4, height: 10, minWidth: '100%' }}
        />
        <LobeSkeleton.Button
          active
          size={'small'}
          style={{ borderRadius: 4, height: 10, minWidth: '60%', width: '60%' }}
        />
      </Flexbox>
    </Flexbox>
  </Block>
));

interface SuggestionChipsProps {
  /** Builtin builder agent id (drives the model used for generation). */
  builderAgentId: string;
  count?: number;
  mode: SuggestMode;
}

/**
 * Context-aware opening suggestions for the Agent / Group Builder. Generates
 * build/configure-oriented chips from the current agent/group config and falls
 * back to the static curated pool while loading, on error, or when there's no
 * usable model.
 */
const SuggestionChips = memo<SuggestionChipsProps>(({ mode, builderAgentId, count = 3 }) => {
  const { t: tCommon } = useTranslation('common');
  const { contextSummary, generationMode, locale } = useBuilderContext(mode);

  const builderConfig = useAgentStore((s) =>
    agentByIdSelectors.getAgentConfigById(builderAgentId)(s),
  );
  const model = builderConfig?.model;
  const provider = builderConfig?.provider;

  const { suggestions, isLoading, refresh } = useBuilderSuggestions({
    contextSummary,
    enabled: !!model && !!provider,
    locale,
    mode: generationMode,
    model: model ?? '',
    provider: provider ?? '',
  });

  // First load with nothing to show yet — card-shaped skeleton that keeps the
  // chip chrome and only loads the text, so there's near-zero layout shift.
  if (isLoading && suggestions.length === 0) {
    return (
      <Flexbox gap={8}>
        {Array.from({ length: count }).map((_, index) => (
          <ChipSkeleton key={index} />
        ))}
      </Flexbox>
    );
  }

  // Dynamic, context-aware chips.
  if (suggestions.length > 0) {
    return (
      <Flexbox gap={12}>
        <Flexbox gap={8}>
          {suggestions.map((item, index) => (
            <ChipItem key={`${item.title}-${index}`} prompt={item.prompt} title={item.title} />
          ))}
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          gap={4}
          style={{ cursor: 'pointer' }}
          onClick={() => refresh()}
        >
          <ActionIcon icon={RefreshCw} size={'small'} />
          <Text color={cssVar.colorTextSecondary} fontSize={12}>
            {tCommon('switch')}
          </Text>
        </Flexbox>
      </Flexbox>
    );
  }

  // Fallback: error / empty / no usable model → static curated pool.
  return <SuggestQuestions count={count} mode={mode} />;
});

export default SuggestionChips;
