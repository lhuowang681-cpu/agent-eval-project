globalThis.fetch = (() => { throw new Error('Network fetch disabled in isolated audit tests'); }) as typeof fetch;
