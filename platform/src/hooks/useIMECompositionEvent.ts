import type { CompositionEvent } from 'react';
import { useCallback, useRef } from 'react';

interface IMECompositionEventOptions {
  onCompositionEnd?: (e: CompositionEvent) => void;
  onCompositionStart?: (e: CompositionEvent) => void;
}

/**
 * Hook to track IME composition state (e.g. Chinese input).
 * Use this to avoid triggering Enter key handlers during composition.
 *
 * WebKit/Safari may fire `compositionend` before the `keydown` for Enter that commits
 * the candidate, so `isComposingRef` is already false when Enter runs. We set
 * `suppressPostCompositionEnterRef` until the next microtask so that Enter handler
 * can treat it as still part of the IME commit.
 */
export const useIMECompositionEvent = (mergeProps?: IMECompositionEventOptions) => {
  const isComposingRef = useRef(false);
  /** True from `compositionend` until the next microtask (WebKit Enter-after-commit). */
  const suppressPostCompositionEnterRef = useRef(false);
  const mergePropsRef = useRef(mergeProps);
  mergePropsRef.current = mergeProps;

  const onCompositionEnd = useCallback((e: CompositionEvent) => {
    isComposingRef.current = false;
    suppressPostCompositionEnterRef.current = true;
    queueMicrotask(() => {
      suppressPostCompositionEnterRef.current = false;
    });
    mergePropsRef.current?.onCompositionEnd?.(e);
  }, []);

  const onCompositionStart = useCallback((e: CompositionEvent) => {
    isComposingRef.current = true;
    mergePropsRef.current?.onCompositionStart?.(e);
  }, []);

  return {
    compositionProps: {
      onCompositionEnd,
      onCompositionStart,
    },
    isComposingRef,
    suppressPostCompositionEnterRef,
  };
};
