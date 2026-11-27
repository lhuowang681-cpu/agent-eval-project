import { useRef } from 'react';

import { LOADING_FLAT } from '@/const/message';

/**
 * Decide whether Markdown should use fade-in animation while generating.
 * When generation resumes on existing content (e.g. stream continue),
 * skip re-animation to avoid content flicker.
 */
export const useMarkdownAnimated = (
  transitionMode: string,
  generating: boolean,
  content?: string | null,
): boolean => {
  const wasGeneratingRef = useRef(false);
  const skipReanimateRef = useRef(false);

  if (generating && !wasGeneratingRef.current) {
    skipReanimateRef.current = Boolean(content && content !== LOADING_FLAT);
  }
  if (!generating) {
    skipReanimateRef.current = false;
  }
  wasGeneratingRef.current = generating;

  return transitionMode === 'fadeIn' && generating && !skipReanimateRef.current;
};
