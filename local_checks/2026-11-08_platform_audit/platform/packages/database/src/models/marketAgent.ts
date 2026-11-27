import { and, count, desc, eq, getTableColumns, isNull, ne, or, sql } from 'drizzle-orm';

import type { NewMarketAgent } from '../schemas/marketAgent';
import { marketAgents } from '../schemas/marketAgent';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';

export class MarketAgentModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  getList = async (params: {
    keyword?: string;
    category?: string;
    page: number;
    pageSize: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => {
    const { keyword, category, page, pageSize, sortBy } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [
      eq(marketAgents.visibility, 'public'),
      eq(marketAgents.status, 'published'),
      isNull(marketAgents.deletedAt),
    ];

    if (category) conditions.push(eq(marketAgents.category, category));
    if (keyword) {
      conditions.push(
        sql`(${marketAgents.title} ILIKE ${`%${keyword}%`} OR ${marketAgents.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);

    const orderBy =
      sortBy === 'installCount'
        ? desc(marketAgents.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketAgents.updatedAt)
          : desc(
              sql`${marketAgents.installCount} + (extract(epoch from now()) - extract(epoch from ${marketAgents.updatedAt})) / 86400 * 0.5`,
            );

    const [data, totalResult] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(marketAgents),
          publisherName: users.fullName,
          publisherUsername: users.username,
        })
        .from(marketAgents)
        .leftJoin(users, eq(marketAgents.publisherId, users.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketAgents).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  getMyList = async (params: {
    keyword?: string;
    page: number;
    pageSize: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => {
    const { keyword, page, pageSize, sortBy } = params;
    const offset = (page - 1) * pageSize;

    // Query all items published by the current user, including delisted ones
    const conditions = [eq(marketAgents.publisherId, this.userId)];

    if (keyword) {
      conditions.push(
        sql`(${marketAgents.title} ILIKE ${`%${keyword}%`} OR ${marketAgents.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);

    const orderBy =
      sortBy === 'installCount'
        ? desc(marketAgents.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketAgents.updatedAt)
          : desc(marketAgents.updatedAt);

    const [data, totalResult] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(marketAgents),
          publisherName: users.fullName,
          publisherUsername: users.username,
        })
        .from(marketAgents)
        .leftJoin(users, eq(marketAgents.publisherId, users.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketAgents).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  getDetail = async (identifier: string) => {
    // Allow publisher to view their own delisted items
    const conditions = [eq(marketAgents.identifier, identifier)];
    if (this.userId) {
      conditions.push(
        or(eq(marketAgents.status, 'published'), eq(marketAgents.publisherId, this.userId)),
      );
    } else {
      conditions.push(eq(marketAgents.status, 'published'));
    }

    const [result] = await this.db
      .select({
        ...getTableColumns(marketAgents),
        publisherName: users.fullName,
        publisherUsername: users.username,
      })
      .from(marketAgents)
      .leftJoin(users, eq(marketAgents.publisherId, users.id))
      .where(and(...conditions))
      .limit(1);
    return result;
  };

  findByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .select()
      .from(marketAgents)
      .where(eq(marketAgents.identifier, identifier))
      .limit(1);
    return result;
  };

  findByDisplayName = async (displayName: string, excludeIdentifier?: string) => {
    const normalizedName = displayName.trim().toLowerCase();
    if (!normalizedName) return undefined;

    const conditions = [
      eq(marketAgents.visibility, 'public'),
      eq(marketAgents.status, 'published'),
      isNull(marketAgents.deletedAt),
      sql`lower(trim(${marketAgents.title})) = ${normalizedName}`,
    ];

    if (excludeIdentifier) {
      conditions.push(ne(marketAgents.identifier, excludeIdentifier));
    }

    const [result] = await this.db
      .select()
      .from(marketAgents)
      .where(and(...conditions))
      .limit(1);

    return result;
  };

  create = async (data: Omit<NewMarketAgent, 'publisherId'>) => {
    const [result] = await this.db
      .insert(marketAgents)
      .values({ ...data, publisherId: this.userId })
      .returning();
    return result;
  };

  updateByIdentifier = async (identifier: string, data: Partial<NewMarketAgent>) => {
    const [result] = await this.db
      .update(marketAgents)
      .set({
        ...data,
        version: sql`${marketAgents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(marketAgents.identifier, identifier), eq(marketAgents.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  delist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketAgents)
      .set({
        status: 'unpublished',
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(marketAgents.identifier, identifier), eq(marketAgents.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  /**
   * Hard-delete an 'unlisted' record owned by the current user. Used to reclaim
   * the share-only market row minted by createAgentShare once its last active
   * share is revoked. The visibility guard keeps real listings (public/bundled)
   * safe.
   */
  deleteUnlistedByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .delete(marketAgents)
      .where(
        and(
          eq(marketAgents.identifier, identifier),
          eq(marketAgents.publisherId, this.userId),
          eq(marketAgents.visibility, 'unlisted'),
        ),
      )
      .returning();
    return result;
  };

  relist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketAgents)
      .set({
        status: 'published',
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(marketAgents.identifier, identifier), eq(marketAgents.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  incrementInstallCount = async (identifier: string) => {
    await this.db
      .update(marketAgents)
      .set({ installCount: sql`${marketAgents.installCount} + 1` })
      .where(eq(marketAgents.identifier, identifier));
  };
}
