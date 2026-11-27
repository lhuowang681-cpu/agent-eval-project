// Inject this through the platform's existing ServiceOptions.runner.
// Default remains the original runner. Sidecar never returns a Diagnostic v1.
export interface ShadowOptions<I> {
  enabled?: boolean;
  timeoutMs?: number;
  shadow: (input: I, signal: AbortSignal) => Promise<unknown>;
  record: (value: unknown) => Promise<void>;
}
export function createShadowRunner<I, D>(base: (input: I) => Promise<D>, options: ShadowOptions<I>) {
  return async (input: I): Promise<D> => {
    const result = await base(input);
    if (!options.enabled) return result;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const sidecar = await options.shadow(structuredClone(input), controller.signal);
          if (!controller.signal.aborted) await options.record(sidecar);
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('shadow_timeout')); }, options.timeoutMs ?? 1000); }),
      ]);
    } catch { /* original result remains authoritative; no scoring callback */ }
    finally { if (timer) clearTimeout(timer); }
    return result;
  };
}
