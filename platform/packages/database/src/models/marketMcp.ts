import { and, count, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';

import type { NewMarketMcp } from '../schemas/marketMcp';
import { marketMcps } from '../schemas/marketMcp';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';

export class MarketMcpModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  getList = async (params: {
    keyword?: string;
    category?: string;
    connectionType?: string;
    page: number;
    pageSize: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt' | 'createdAt';
  }) => {
    const { keyword, category, connectionType, page, pageSize, sortBy } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [
      eq(marketMcps.visibility, 'public'),
      eq(marketMcps.status, 'published'),
      isNull(marketMcps.deletedAt),
    ];

    if (category) conditions.push(eq(marketMcps.category, category));
    if (connectionType) conditions.push(eq(marketMcps.connectionType, connectionType));
    if (keyword) {
      conditions.push(
        sql`(${marketMcps.name} ILIKE ${`%${keyword}%`} OR ${marketMcps.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);

    // Get user publisher name via join
    const orderBy =
      sortBy === 'installCount'
        ? desc(marketMcps.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketMcps.updatedAt)
          : sortBy === 'createdAt'
            ? desc(marketMcps.createdAt)
            : desc(
                sql`${marketMcps.installCount} + (extract(epoch from now()) - extract(epoch from ${marketMcps.updatedAt})) / 86400 * 0.5`,
              );

    const [data, totalResult] = await Promise.all([
      this.db
        .select({
          ...marketMcps,
          publisherName: users.fullName,
          publisherUsername: users.username,
        })
        .from(marketMcps)
        .leftJoin(users, eq(marketMcps.publisherId, users.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketMcps).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  getMyList = async (params: {
    keyword?: string;
    page: number;
    pageSize: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt' | 'createdAt';
  }) => {
    const { keyword, page, pageSize, sortBy } = params;
    const offset = (page - 1) * pageSize;

    // Query all items published by the current user, including delisted ones
    const conditions = [eq(marketMcps.publisherId, this.userId)];

    if (keyword) {
      conditions.push(
        sql`(${marketMcps.name} ILIKE ${`%${keyword}%`} OR ${marketMcps.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);

    const orderBy =
      sortBy === 'installCount'
        ? desc(marketMcps.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketMcps.updatedAt)
          : sortBy === 'createdAt'
            ? desc(marketMcps.createdAt)
            : desc(marketMcps.updatedAt);

    const [data, totalResult] = await Promise.all([
      this.db
        .select({
          ...marketMcps,
          publisherName: users.fullName,
          publisherUsername: users.username,
        })
        .from(marketMcps)
        .leftJoin(users, eq(marketMcps.publisherId, users.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketMcps).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  getDetail = async (identifier: string) => {
    // Allow publisher to view their own delisted items
    // For non-publishers, only show published items
    const conditions = [eq(marketMcps.identifier, identifier)];
    if (this.userId) {
      // If logged in, show published OR the user's own items (including delisted)
      conditions.push(
        or(eq(marketMcps.status, 'published'), eq(marketMcps.publisherId, this.userId)),
      );
    } else {
      // Not logged in, only show published
      conditions.push(eq(marketMcps.status, 'published'));
    }

    const [result] = await this.db
      .select({
        ...marketMcps,
        publisherName: users.fullName,
        publisherUsername: users.username,
      })
      .from(marketMcps)
      .leftJoin(users, eq(marketMcps.publisherId, users.id))
      .where(and(...conditions))
      .limit(1);
    return result;
  };

  findByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .select()
      .from(marketMcps)
      .where(eq(marketMcps.identifier, identifier))
      .limit(1);
    return result;
  };

  findByDisplayName = async (displayName: string, excludeIdentifier?: string) => {
    const normalizedName = displayName.trim().toLowerCase();
    if (!normalizedName) return undefined;

    const conditions = [
      eq(marketMcps.visibility, 'public'),
      eq(marketMcps.status, 'published'),
      isNull(marketMcps.deletedAt),
      sql`lower(trim(${marketMcps.name})) = ${normalizedName}`,
    ];

    if (excludeIdentifier) {
      conditions.push(ne(marketMcps.identifier, excludeIdentifier));
    }

    const [result] = await this.db
      .select()
      .from(marketMcps)
      .where(and(...conditions))
      .limit(1);

    return result;
  };

  create = async (data: Omit<NewMarketMcp, 'publisherId'>) => {
    const [result] = await this.db
      .insert(marketMcps)
      .values({ ...data, publisherId: this.userId })
      .returning();
    return result;
  };

  updateByIdentifier = async (identifier: string, data: Partial<NewMarketMcp>) => {
    const [result] = await this.db
      .update(marketMcps)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.publisherId, this.userId)))
      .returning();
    return result;
  };

  makePublic = async (identifier: string) => {
    const [result] = await this.db
      .update(marketMcps)
      .set({ visibility: 'public', updatedAt: new Date() })
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.publisherId, this.userId)))
      .returning();
    return result;
  };

  delist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketMcps)
      .set({ status: 'unpublished', deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.publisherId, this.userId)))
      .returning();
    return result;
  };

  /**
   * Hard-delete an 'unlisted' record owned by the current user. Used to reclaim
   * a share-only market row once its last active share is revoked. The
   * visibility guard keeps real listings (public/bundled) safe.
   */
  deleteUnlistedByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .delete(marketMcps)
      .where(
        and(
          eq(marketMcps.identifier, identifier),
          eq(marketMcps.publisherId, this.userId),
          eq(marketMcps.visibility, 'unlisted'),
        ),
      )
      .returning();
    return result;
  };

  relist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketMcps)
      .set({ status: 'published', deletedAt: null, updatedAt: new Date() })
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.publisherId, this.userId)))
      .returning();
    return result;
  };

  incrementInstallCount = async (identifier: string) => {
    await this.db
      .update(marketMcps)
      .set({ installCount: sql`${marketMcps.installCount} + 1` })
      .where(eq(marketMcps.identifier, identifier));
  };
}
