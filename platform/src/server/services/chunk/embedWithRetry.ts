import retry from 'async-retry';

interface EmbedWithRetryOptions {
  /** Minimum backoff before the first retry, in ms. Doubles each attempt. */
  minTimeout?: number;
  /** Number of retries after the initial attempt. */
  retries?: number;
}

/**
 * Run an embedding request with exponential-backoff retry.
 *
 * Embedding providers (e.g. the shared LLM proxy) rate-limit under load — during
 * a bulk import many embedding batches hit the provider at once and some return
 * transient `ProviderBizError`s. Retrying with backoff recovers those instead of
 * failing the whole file's embedding task.
 */
export const embedWithRetry = <T>(
  fn: () => Promise<T>,
  options: EmbedWithRetryOptions = {},
): Promise<T> =>
  retry(fn, {
    factor: 2,
    minTimeout: options.minTimeout ?? 1000,
    retries: options.retries ?? 3,
  });
