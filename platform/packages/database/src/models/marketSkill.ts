import { and, count, desc, eq, getTableColumns, isNull, ne, or, sql } from 'drizzle-orm';

import type { NewMarketSkill } from '../schemas/marketSkill';
import { marketSkills } from '../schemas/marketSkill';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';

export class MarketSkillModel {
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
      eq(marketSkills.visibility, 'public'),
      eq(marketSkills.status, 'published'),
      isNull(marketSkills.deletedAt),
    ];

    if (category) conditions.push(eq(marketSkills.category, category));
    if (keyword) {
      conditions.push(
        sql`(${marketSkills.name} ILIKE ${`%${keyword}%`} OR ${marketSkills.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);
    const orderBy =
      sortBy === 'installCount'
        ? desc(marketSkills.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketSkills.updatedAt)
          : desc(
              sql`${marketSkills.installCount} + (extract(epoch from now()) - extract(epoch from ${marketSkills.updatedAt})) / 86400 * 0.5`,
            );

    const [data, totalResult] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(marketSkills),
          publisherName: users.fullName,
          publisherUsername: users.username,
        })
        .from(marketSkills)
        .leftJoin(users, eq(marketSkills.publisherId, users.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketSkills).where(where),
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
    const conditions = [eq(marketSkills.publisherId, this.userId)];

    if (keyword) {
      conditions.push(
        sql`(${marketSkills.name} ILIKE ${`%${keyword}%`} OR ${marketSkills.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);

    const orderBy =
      sortBy === 'installCount'
        ? desc(marketSkills.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketSkills.updatedAt)
          : desc(marketSkills.updatedAt);

    const [data, totalResult] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(marketSkills),
          publisherName: users.fullName,
          publisherUsername: users.username,
        })
        .from(marketSkills)
        .leftJoin(users, eq(marketSkills.publisherId, users.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketSkills).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  getDetail = async (identifier: string) => {
    // Allow publisher to view their own delisted items
    const conditions = [eq(marketSkills.identifier, identifier)];
    if (this.userId) {
      conditions.push(
        or(eq(marketSkills.status, 'published'), eq(marketSkills.publisherId, this.userId)),
      );
    } else {
      conditions.push(eq(marketSkills.status, 'published'));
    }

    const [result] = await this.db
      .select({
        ...getTableColumns(marketSkills),
        publisherName: users.fullName,
        publisherUsername: users.username,
      })
      .from(marketSkills)
      .leftJoin(users, eq(marketSkills.publisherId, users.id))
      .where(and(...conditions))
      .limit(1);
    return result;
  };

  findByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .select()
      .from(marketSkills)
      .where(eq(marketSkills.identifier, identifier))
      .limit(1);
    return result;
  };

  findByDisplayName = async (displayName: string, excludeIdentifier?: string) => {
    const normalizedName = displayName.trim().toLowerCase();
    if (!normalizedName) return undefined;

    const conditions = [
      eq(marketSkills.visibility, 'public'),
      eq(marketSkills.status, 'published'),
      isNull(marketSkills.deletedAt),
      sql`lower(trim(${marketSkills.name})) = ${normalizedName}`,
    ];

    if (excludeIdentifier) {
      conditions.push(ne(marketSkills.identifier, excludeIdentifier));
    }

    const [result] = await this.db
      .select()
      .from(marketSkills)
      .where(and(...conditions))
      .limit(1);

    return result;
  };

  create = async (data: Omit<NewMarketSkill, 'publisherId'>) => {
    const [result] = await this.db
      .insert(marketSkills)
      .values({ ...data, publisherId: this.userId })
      .returning();
    return result;
  };

  updateByIdentifier = async (identifier: string, data: Partial<NewMarketSkill>) => {
    const [result] = await this.db
      .update(marketSkills)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(eq(marketSkills.identifier, identifier), eq(marketSkills.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  makePublic = async (identifier: string) => {
    const [result] = await this.db
      .update(marketSkills)
      .set({ visibility: 'public', updatedAt: new Date() })
      .where(
        and(eq(marketSkills.identifier, identifier), eq(marketSkills.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  delist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketSkills)
      .set({ status: 'unpublished', deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(marketSkills.identifier, identifier), eq(marketSkills.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  relist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketSkills)
      .set({ status: 'published', deletedAt: null, updatedAt: new Date() })
      .where(
        and(eq(marketSkills.identifier, identifier), eq(marketSkills.publisherId, this.userId)),
      )
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
      .delete(marketSkills)
      .where(
        and(
          eq(marketSkills.identifier, identifier),
          eq(marketSkills.publisherId, this.userId),
          eq(marketSkills.visibility, 'unlisted'),
        ),
      )
      .returning();
    return result;
  };

  incrementInstallCount = async (identifier: string) => {
    await this.db
      .update(marketSkills)
      .set({ installCount: sql`${marketSkills.installCount} + 1` })
      .where(eq(marketSkills.identifier, identifier));
  };
}
