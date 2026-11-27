// Mock implementation of @ctrip/vampire-core for desktop development.
// The real package ships native (.node) bindings compiled against Node.js ABI
// that are incompatible with Electron's bundled Node, so we stub the parts the
// app actually imports (qconfig + triplog).

interface MockQConfigObject {
  get: <E = unknown>(key?: string) => Promise<E>;
  getSync: <E = unknown>(key?: string) => E;
  on: (event: 'change', listener: (data: unknown) => void) => { dispose: () => void };
  once: (event: 'change', listener: (data: unknown) => void) => { dispose: () => void };
}

const noopDisposable = { dispose: () => {} };

const mockQConfigObject: MockQConfigObject = {
  get: async () => ({}) as never,
  getSync: () => ({}) as never,
  on: () => noopDisposable,
  once: () => noopDisposable,
};

export const qconfig = {
  getConfig: (_key: string): MockQConfigObject => mockQConfigObject,
};

export const triplog = {
  custom: (_data: unknown) => {},
  setTraceContext: (_name: string, _value: string) => {},
};

export const getCache = () => null;

export class Cache {
  get(_key: string) {
    return null;
  }
  set(_key: string, _value: unknown, _ttl?: number) {
    return Promise.resolve();
  }
  delete(_key: string) {
    return Promise.resolve();
  }
}

export const toolkits = {};

export default {
  Cache,
  getCache,
  qconfig,
  toolkits,
  triplog,
};
