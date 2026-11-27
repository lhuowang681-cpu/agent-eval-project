import { and, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type { NewShare, ShareItem } from '../schemas/shares';
import { shares } from '../schemas/shares';
import type { LobeChatDatabase } from '../type';

export class ShareModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (data: Omit<NewShare, 'id'>): Promise<ShareItem> => {
    const [result] = await this.db.insert(shares).values(data).returning();
    return result;
  };

  findByToken = async (token: string): Promise<ShareItem | undefined> => {
    const [result] = await this.db.select().from(shares).where(eq(shares.token, token)).limit(1);
    return result;
  };

  findMyList = async (): Promise<ShareItem[]> => {
    return this.db
      .select()
      .from(shares)
      .where(eq(shares.ownerId, this.userId))
      .orderBy(desc(shares.createdAt));
  };

  setRevoked = async (token: string): Promise<void> => {
    await this.db
      .update(shares)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shares.token, token), eq(shares.ownerId, this.userId)));
  };

  /** Count the caller's still-active (not revoked, not expired) shares that
   * point at a given market record. Used to decide whether the underlying
   * share-only market row can be reclaimed on revoke. */
  countActiveByMarketIdentifier = async (
    itemType: string,
    marketIdentifier: string,
  ): Promise<number> => {
    const [result] = await this.db
      .select({ value: count() })
      .from(shares)
      .where(
        and(
          eq(shares.ownerId, this.userId),
          eq(shares.itemType, itemType),
          eq(shares.marketIdentifier, marketIdentifier),
          isNull(shares.revokedAt),
          or(isNull(shares.expiresAt), gt(shares.expiresAt, new Date())),
        ),
      );
    return result?.value ?? 0;
  };

  incrementInstallCount = async (token: string): Promise<void> => {
    await this.db
      .update(shares)
      .set({ installCount: sql`${shares.installCount} + 1` })
      .where(eq(shares.token, token));
  };

  incrementViewCount = async (token: string): Promise<void> => {
    await this.db
      .update(shares)
      .set({ viewCount: sql`${shares.viewCount} + 1` })
      .where(eq(shares.token, token));
  };
}
