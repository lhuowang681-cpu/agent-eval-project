// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketAgents } from '../schemas/marketAgent';
import { MarketAgentModel } from './marketAgent';

/**
 * Walk a Drizzle SQL/condition object and collect the column names that are
 * directly referenced as operands (without recursing into a column's `.table`
 * handle, which would otherwise enumerate every column of the table).
 */
const collectReferencedColumns = (obj: any): string[] => {
  const names = new Set<string>();
  const seen = new WeakSet();
  const walk = (o: any, depth = 0) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 12) return;
    seen.add(o);
    const isColumn = typeof o.name === 'string' && typeof o.table === 'object';
    if (isColumn) names.add(o.name);
    for (const k of Object.keys(o)) {
      if (isColumn && k === 'table') continue;
      try {
        walk(o[k], depth + 1);
      } catch {
        // ignore
      }
    }
  };
  walk(obj);
  return [...names];
};

// Collect every literal bound into a Drizzle SQL expression's Param nodes,
// so we can assert "the WHERE clause binds visibility='public'" without
// coupling to a specific SQL shape. Mirrors the helper in share.test.ts.
const boundValues = (node: any): any[] => {
  const acc: any[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (n?.constructor?.name === 'Param') acc.push(n.value);
    const chunks = n?.queryChunks;
    if (Array.isArray(chunks)) chunks.forEach((c: any) => walk(c));
  };
  walk(node);
  return acc;
};

// Recurse a Drizzle SQL expression's queryChunks tree and report whether the
// given column reference appears anywhere.
const referencesColumn = (node: any, column: any): boolean => {
  if (node == null) return false;
  if (node === column) return true;
  const chunks = node?.queryChunks;
  if (Array.isArray(chunks)) {
    return chunks.some((c: any) => referencesColumn(c, column));
  }
  return false;
};

describe('MarketAgentModel.getList', () => {
  const model = new MarketAgentModel({} as any, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out non-public visibility (unlisted/bundled) from the public list', async () => {
    const captured: any[] = [];
    // The count query (`select({ count })`) terminates at `.where(...)` and
    // must resolve to `[{ count: n }]`; the page query continues through
    // orderBy/limit/offset. Route them to separate chains by branching on the
    // select argument so each terminal returns a sane value.
    const countResult = [{ count: 0 }];
    const countChain = {
      from: vi.fn(() => countChain),
      where: vi.fn((w: any) => {
        captured.push(w);
        return countResult;
      }),
    };
    const chain = {
      from: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      where: vi.fn((w: any) => {
        captured.push(w);
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      offset: vi.fn(() => chain),
    };
    (model as any).db = {
      select: vi.fn((arg: any) =>
        arg && typeof arg === 'object' && 'count' in arg ? countChain : chain,
      ),
    } as any;

    await model.getList({ page: 1, pageSize: 20 });

    // Both the page query and the count query go through `.where(...)`.
    expect(captured.length).toBeGreaterThan(0);
    const cols = captured.flatMap(collectReferencedColumns);
    // The public list must filter on visibility = 'public' so that
    // unlisted / bundled shares never enter the listing.
    expect(cols).toContain('visibility');
    // Hard constraint: the bound value must be 'public' — a regression that
    // binds e.g. 'unlisted' here would leak private shares into the listing.
    const bound = captured.flatMap(boundValues);
    expect(bound).toContain('public');
  });
});

describe('MarketAgentModel.findByDisplayName', () => {
  const model = new MarketAgentModel({} as any, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters by visibility = public (excludes unlisted/bundled name matches)', async () => {
    const captured: any[] = [];
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn((w: any) => {
        captured.push(w);
        return chain;
      }),
      limit: vi.fn(async () => [{ identifier: 'agt_x' }]),
    };
    (model as any).db = { select: vi.fn(() => chain) } as any;

    await model.findByDisplayName('My Agent');

    expect(captured.length).toBeGreaterThan(0);
    const cols = captured.flatMap(collectReferencedColumns);
    expect(cols).toContain('visibility');
    // The bound value must be 'public' — a name collision check that matched
    // unlisted/bundled agents would wrongly block publishing.
    const bound = captured.flatMap(boundValues);
    expect(bound).toContain('public');
    // Also still scopes by the normalized display name.
    expect(referencesColumn(captured[0], marketAgents.title)).toBe(true);
  });

  it('returns undefined for an empty display name without querying', async () => {
    (model as any).db = { select: vi.fn() } as any;
    const res = await model.findByDisplayName('   ');
    expect(res).toBeUndefined();
    expect((model as any).db.select).not.toHaveBeenCalled();
  });

  it('adds an identifier exclusion when excludeIdentifier is provided', async () => {
    const captured: any[] = [];
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn((w: any) => {
        captured.push(w);
        return chain;
      }),
      limit: vi.fn(async () => []),
    };
    (model as any).db = { select: vi.fn(() => chain) } as any;

    await model.findByDisplayName('My Agent', 'agt_exclude');

    expect(captured.length).toBeGreaterThan(0);
    const cols = captured.flatMap(collectReferencedColumns);
    expect(cols).toContain('identifier');
    expect(captured.flatMap(boundValues)).toContain('agt_exclude');
  });
});
