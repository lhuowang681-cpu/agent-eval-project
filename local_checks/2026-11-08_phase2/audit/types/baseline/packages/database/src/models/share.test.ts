// @vitest-environment node
import { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { shares } from '../schemas/shares';
import { ShareModel } from './share';

describe('ShareModel', () => {
  // Every chainable method returns `chain` so `.values().returning()` etc.
  // compose; the chain itself is thenable so `await <terminal>` resolves to
  // `resolve` (the mocked DB rows). This mirrors how a real Drizzle query is
  // both a chainable builder and an awaitable terminal.
  const buildChain = (resolve: any) => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      values: vi.fn(() => chain),
      set: vi.fn(() => chain),
      returning: vi.fn(() => chain),
      // eslint-disable-next-line unicorn/no-thenable -- thenable chain mocks `await <terminal>` resolving to the rows
      then: (resolveFn: any, rejectFn: any) => Promise.resolve(resolve).then(resolveFn, rejectFn),
    };
    return chain;
  };

  // Recurse a Drizzle SQL expression's queryChunks tree and report whether the
  // given column reference appears anywhere. Lets us assert "the WHERE clause
  // references shares.ownerId" without depending on a specific SQL string shape.
  const referencesColumn = (node: any, column: any): boolean => {
    if (node == null) return false;
    if (node === column) return true;
    const chunks = node?.queryChunks;
    if (Array.isArray(chunks)) {
      return chunks.some((c: any) => referencesColumn(c, column));
    }
    return false;
  };

  // Collect every literal bound into a Drizzle SQL expression's Param nodes,
  // so we can assert "the WHERE clause binds the caller's userId" without
  // coupling to a specific SQL shape.
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create inserts with provided fields and returns the inserted row', async () => {
    const model = new ShareModel({} as any, 'owner-1');
    const chain = buildChain([{ id: 'shr_1', token: 'tok' }]);
    (model as any).db = { insert: vi.fn(() => chain) } as any;

    const row = await model.create({
      token: 'tok',
      ownerId: 'owner-1',
      itemType: 'skill',
      marketIdentifier: 'skl_x',
      name: 'My Skill',
    });

    expect((model as any).db.insert).toHaveBeenCalledWith(expect.anything());
    expect(chain.values).toHaveBeenCalledWith({
      token: 'tok',
      ownerId: 'owner-1',
      itemType: 'skill',
      marketIdentifier: 'skl_x',
      name: 'My Skill',
    });
    // Locks that the inserted row is actually returned — without `.returning()`
    // the awaited result would be undefined / not the inserted row.
    expect(chain.returning).toHaveBeenCalled();
    expect(row.token).toBe('tok');
  });

  it('findByToken selects by token and limits to 1', async () => {
    const model = new ShareModel({} as any, 'owner-1');
    const chain = buildChain([{ id: 'shr_1', token: 'tok' }]);
    (model as any).db = { select: vi.fn(() => chain) } as any;

    const row = await model.findByToken('tok');

    expect((model as any).db.select).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalledWith(expect.anything());
    expect(chain.where).toHaveBeenCalled();
    // The where clause must filter by the token column.
    expect(referencesColumn(chain.where.mock.calls[0][0], shares.token)).toBe(true);
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(row?.token).toBe('tok');
  });

  it('findMyList filters by current userId and orders by createdAt desc', async () => {
    const model = new ShareModel({} as any, 'owner-1');
    const chain = buildChain([{ id: 'shr_1', ownerId: 'owner-1' }]);
    (model as any).db = { select: vi.fn(() => chain) } as any;

    const rows = await model.findMyList();

    expect(chain.from).toHaveBeenCalledWith(expect.anything());
    expect(chain.where).toHaveBeenCalled();
    // Hard constraint: the list is scoped to the caller's ownerId, so a token
    // leak across users can't happen. Asserting the column reference, the bound
    // userId value, guards against an implementation that drops the filter.
    const whereArg = chain.where.mock.calls[0][0];
    expect(referencesColumn(whereArg, shares.ownerId)).toBe(true);
    expect(boundValues(whereArg)).toContain('owner-1');
    expect(chain.orderBy).toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBe('owner-1');
  });

  it('setRevoked sets revokedAt and updatedAt, scoped to token + owner', async () => {
    const model = new ShareModel({} as any, 'owner-1');
    const chain = buildChain([{ id: 'shr_1' }]);
    (model as any).db = { update: vi.fn(() => chain) } as any;

    await model.setRevoked('tok');

    expect((model as any).db.update).toHaveBeenCalledWith(expect.anything());
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        revokedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(chain.where).toHaveBeenCalled();
    // The where clause must combine token + ownerId — the ownerId filter is
    // the authorization boundary that prevents revoking another user's share.
    const whereArg = chain.where.mock.calls[0][0];
    expect(referencesColumn(whereArg, shares.ownerId)).toBe(true);
    expect(referencesColumn(whereArg, shares.token)).toBe(true);
    expect(boundValues(whereArg)).toContain('owner-1');
    expect(boundValues(whereArg)).toContain('tok');
  });

  it('incrementInstallCount bumps installCount for the token via SQL self-increment', async () => {
    const model = new ShareModel({} as any, 'owner-1');
    const chain = buildChain([{ id: 'shr_1' }]);
    (model as any).db = { update: vi.fn(() => chain) } as any;

    await model.incrementInstallCount('tok');

    expect((model as any).db.update).toHaveBeenCalledWith(expect.anything());
    expect(chain.set).toHaveBeenCalled();
    // Guards against a regression that overwrites instead of increments
    // (e.g. `.set({ installCount: 1 })`): the value must be a SQL expression
    // that references the installCount column itself.
    const setArg = chain.set.mock.calls[0][0];
    expect(setArg.installCount).toBeInstanceOf(SQL);
    expect(referencesColumn(setArg.installCount, shares.installCount)).toBe(true);
    expect(chain.where).toHaveBeenCalled();
    expect(referencesColumn(chain.where.mock.calls[0][0], shares.token)).toBe(true);
  });

  it('incrementViewCount bumps viewCount for the token via SQL self-increment', async () => {
    const model = new ShareModel({} as any, 'owner-1');
    const chain = buildChain([{ id: 'shr_1' }]);
    (model as any).db = { update: vi.fn(() => chain) } as any;

    await model.incrementViewCount('tok');

    expect((model as any).db.update).toHaveBeenCalledWith(expect.anything());
    expect(chain.set).toHaveBeenCalled();
    const setArg = chain.set.mock.calls[0][0];
    expect(setArg.viewCount).toBeInstanceOf(SQL);
    expect(referencesColumn(setArg.viewCount, shares.viewCount)).toBe(true);
    expect(chain.where).toHaveBeenCalled();
    expect(referencesColumn(chain.where.mock.calls[0][0], shares.token)).toBe(true);
  });
});
