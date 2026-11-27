import type { AssistantContentBlock } from '@lobechat/types';

interface IncompleteBannerState {
  blockId: string;
  show: boolean;
}

/**
 * Decide whether the continue-generation banner should show at the end of an assistant group.
 * Hides stale isIncomplete on earlier blocks when the agent already continued in a later block.
 */
export const getIncompleteBannerState = (
  blocks: AssistantContentBlock[],
  groupIsIncomplete?: boolean,
): IncompleteBannerState => {
  const lastBlock = blocks.at(-1);

  if (!lastBlock) return { blockId: '', show: false };

  const anyBlockIncomplete = blocks.some((block) => block.metadata?.isIncomplete);

  if (!anyBlockIncomplete && !groupIsIncomplete) {
    return { blockId: lastBlock.id, show: false };
  }

  if (
    blocks.length > 1 &&
    blocks[0]?.metadata?.isIncomplete &&
    !lastBlock.metadata?.isIncomplete &&
    lastBlock.content?.trim()
  ) {
    return { blockId: lastBlock.id, show: false };
  }

  const incompleteBlock = [...blocks].reverse().find((block) => block.metadata?.isIncomplete);

  return {
    blockId: incompleteBlock?.id ?? lastBlock.id,
    show: true,
  };
};
