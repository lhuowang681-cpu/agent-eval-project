import { and, count, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';

import type { NewMarketKnowledgeBase } from '../schemas/marketKnowledgeBase';
import { marketKnowledgeBases } from '../schemas/marketKnowledgeBase';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';

export class MarketKnowledgeBaseModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  getList = async (params: {
    keyword?: string;
    page: number;
    pageSize: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => {
    const { keyword, page, pageSize, sortBy } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [
      eq(marketKnowledgeBases.visibility, 'public'),
      eq(marketKnowledgeBases.status, 'published'),
      isNull(marketKnowledgeBases.deletedAt),
    ];

    if (keyword) {
      conditions.push(
        sql`(${marketKnowledgeBases.name} ILIKE ${`%${keyword}%`} OR ${marketKnowledgeBases.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);
    const orderBy =
      sortBy === 'installCount'
        ? desc(marketKnowledgeBases.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketKnowledgeBases.updatedAt)
          : desc(
              sql`${marketKnowledgeBases.installCount} + (extract(epoch from now()) - extract(epoch from ${marketKnowledgeBases.updatedAt})) / 86400 * 0.5`,
            );

    const [data, totalResult] = await Promise.all([
      this.db
        .select({
          ...marketKnowledgeBases,
          publisherName: users.fullName,
        })
        .from(marketKnowledgeBases)
        .leftJoin(users, eq(marketKnowledgeBases.publisherId, users.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketKnowledgeBases).where(where),
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

    const conditions = [eq(marketKnowledgeBases.publisherId, this.userId)];

    if (keyword) {
      conditions.push(
        sql`(${marketKnowledgeBases.name} ILIKE ${`%${keyword}%`} OR ${marketKnowledgeBases.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);
    const orderBy =
      sortBy === 'installCount'
        ? desc(marketKnowledgeBases.installCount)
        : desc(marketKnowledgeBases.updatedAt);

    const [data, totalResult] = await Promise.all([
      this.db
        .select({
          ...marketKnowledgeBases,
          publisherName: users.fullName,
        })
        .from(marketKnowledgeBases)
        .leftJoin(users, eq(marketKnowledgeBases.publisherId, users.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketKnowledgeBases).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  getDetail = async (identifier: string) => {
    const conditions = [eq(marketKnowledgeBases.identifier, identifier)];
    if (this.userId) {
      conditions.push(
        or(
          eq(marketKnowledgeBases.status, 'published'),
          eq(marketKnowledgeBases.publisherId, this.userId),
        )!,
      );
    } else {
      conditions.push(eq(marketKnowledgeBases.status, 'published'));
    }

    const [result] = await this.db
      .select({
        ...marketKnowledgeBases,
        publisherName: users.fullName,
      })
      .from(marketKnowledgeBases)
      .leftJoin(users, eq(marketKnowledgeBases.publisherId, users.id))
      .where(and(...conditions))
      .limit(1);
    return result;
  };

  findByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .select()
      .from(marketKnowledgeBases)
      .where(eq(marketKnowledgeBases.identifier, identifier))
      .limit(1);
    return result;
  };

  findByDisplayName = async (displayName: string, excludeIdentifier?: string) => {
    const normalizedName = displayName.trim().toLowerCase();
    if (!normalizedName) return undefined;

    const conditions = [
      eq(marketKnowledgeBases.visibility, 'public'),
      eq(marketKnowledgeBases.status, 'published'),
      isNull(marketKnowledgeBases.deletedAt),
      sql`lower(trim(${marketKnowledgeBases.name})) = ${normalizedName}`,
    ];

    if (excludeIdentifier) {
      conditions.push(ne(marketKnowledgeBases.identifier, excludeIdentifier));
    }

    const [result] = await this.db
      .select()
      .from(marketKnowledgeBases)
      .where(and(...conditions))
      .limit(1);

    return result;
  };

  create = async (data: Omit<NewMarketKnowledgeBase, 'publisherId'>) => {
    const [result] = await this.db
      .insert(marketKnowledgeBases)
      .values({ ...data, publisherId: this.userId })
      .returning();
    return result;
  };

  updateByIdentifier = async (identifier: string, data: Partial<NewMarketKnowledgeBase>) => {
    const [result] = await this.db
      .update(marketKnowledgeBases)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(marketKnowledgeBases.identifier, identifier),
          eq(marketKnowledgeBases.publisherId, this.userId),
        ),
      )
      .returning();
    return result;
  };

  makePublic = async (identifier: string) => {
    const [result] = await this.db
      .update(marketKnowledgeBases)
      .set({ visibility: 'public', updatedAt: new Date() })
      .where(
        and(
          eq(marketKnowledgeBases.identifier, identifier),
          eq(marketKnowledgeBases.publisherId, this.userId),
        ),
      )
      .returning();
    return result;
  };

  delist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketKnowledgeBases)
      .set({ status: 'unpublished', deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(marketKnowledgeBases.identifier, identifier),
          eq(marketKnowledgeBases.publisherId, this.userId),
        ),
      )
      .returning();
    return result;
  };

  relist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketKnowledgeBases)
      .set({ status: 'published', deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(marketKnowledgeBases.identifier, identifier),
          eq(marketKnowledgeBases.publisherId, this.userId),
        ),
      )
      .returning();
    return result;
  };

  incrementInstallCount = async (identifier: string) => {
    await this.db
      .update(marketKnowledgeBases)
      .set({ installCount: sql`${marketKnowledgeBases.installCount} + 1` })
      .where(eq(marketKnowledgeBases.identifier, identifier));
  };
}
