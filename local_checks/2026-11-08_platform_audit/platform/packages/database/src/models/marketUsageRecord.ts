import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import {
  marketAgents,
  marketAgentUsageRecords,
  marketMcps,
  marketMcpUsageRecords,
  marketSkills,
  marketSkillUsageRecords,
} from '../schemas';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';

export type MarketResourceType = 'agent' | 'skill' | 'mcp';

export interface MarketLeaderboardEntry {
  icon?: string | null;
  identifier: string;
  name: string;
  publisherName: string;
  usageCount: number;
}

export class MarketUsageRecordModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  recordAgentUsage = async (agentIdentifier: string, userId: string) => {
    await this.db.insert(marketAgentUsageRecords).values({ agentIdentifier, userId });
    await this.db
      .update(marketAgents)
      .set({ usageCount: sql`${marketAgents.usageCount} + 1` })
      .where(eq(marketAgents.identifier, agentIdentifier));
  };

  recordSkillUsage = async (skillIdentifier: string, userId: string, agentId?: string) => {
    await this.db.insert(marketSkillUsageRecords).values({
      agentId,
      skillIdentifier,
      userId,
    });
    await this.db
      .update(marketSkills)
      .set({ usageCount: sql`${marketSkills.usageCount} + 1` })
      .where(eq(marketSkills.identifier, skillIdentifier));
  };

  recordMcpUsage = async (mcpIdentifier: string, userId: string, agentId?: string) => {
    await this.db.insert(marketMcpUsageRecords).values({
      agentId,
      mcpIdentifier,
      userId,
    });
    await this.db
      .update(marketMcps)
      .set({ usageCount: sql`${marketMcps.usageCount} + 1` })
      .where(eq(marketMcps.identifier, mcpIdentifier));
  };

  getLeaderboard = async (days = 30, limit = 5) => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [agents, skills, mcps] = await Promise.all([
      this.getTopByType('agent', since, limit),
      this.getTopByType('skill', since, limit),
      this.getTopByType('mcp', since, limit),
    ]);

    return { agents, mcps, skills };
  };

  private getTopByType = async (
    type: MarketResourceType,
    since: Date,
    limit: number,
  ): Promise<MarketLeaderboardEntry[]> => {
    if (type === 'agent') {
      const rows = await this.db
        .select({
          icon: marketAgents.avatar,
          identifier: marketAgentUsageRecords.agentIdentifier,
          publisherName: users.fullName,
          title: marketAgents.title,
          usageCount: count(),
        })
        .from(marketAgentUsageRecords)
        .innerJoin(
          marketAgents,
          eq(marketAgents.identifier, marketAgentUsageRecords.agentIdentifier),
        )
        .leftJoin(users, eq(marketAgents.publisherId, users.id))
        .where(
          and(
            gte(marketAgentUsageRecords.usedAt, since),
            eq(marketAgents.status, 'published'),
            isNull(marketAgents.deletedAt),
          ),
        )
        .groupBy(
          marketAgentUsageRecords.agentIdentifier,
          marketAgents.title,
          marketAgents.avatar,
          users.fullName,
        )
        .orderBy(desc(count()))
        .limit(limit);

      return rows.map((row) => this.toLeaderboardEntry(row));
    }

    if (type === 'skill') {
      const rows = await this.db
        .select({
          icon: marketSkills.icon,
          identifier: marketSkillUsageRecords.skillIdentifier,
          name: marketSkills.name,
          publisherName: users.fullName,
          usageCount: count(),
        })
        .from(marketSkillUsageRecords)
        .innerJoin(
          marketSkills,
          eq(marketSkills.identifier, marketSkillUsageRecords.skillIdentifier),
        )
        .leftJoin(users, eq(marketSkills.publisherId, users.id))
        .where(
          and(
            gte(marketSkillUsageRecords.usedAt, since),
            eq(marketSkills.status, 'published'),
            eq(marketSkills.visibility, 'public'),
            isNull(marketSkills.deletedAt),
          ),
        )
        .groupBy(
          marketSkillUsageRecords.skillIdentifier,
          marketSkills.name,
          marketSkills.icon,
          users.fullName,
        )
        .orderBy(desc(count()))
        .limit(limit);

      return rows.map((row) => this.toLeaderboardEntry(row));
    }

    const rows = await this.db
      .select({
        icon: marketMcps.icon,
        identifier: marketMcpUsageRecords.mcpIdentifier,
        name: marketMcps.name,
        publisherName: users.fullName,
        usageCount: count(),
      })
      .from(marketMcpUsageRecords)
      .innerJoin(marketMcps, eq(marketMcps.identifier, marketMcpUsageRecords.mcpIdentifier))
      .leftJoin(users, eq(marketMcps.publisherId, users.id))
      .where(
        and(
          gte(marketMcpUsageRecords.usedAt, since),
          eq(marketMcps.status, 'published'),
          eq(marketMcps.visibility, 'public'),
          isNull(marketMcps.deletedAt),
        ),
      )
      .groupBy(
        marketMcpUsageRecords.mcpIdentifier,
        marketMcps.name,
        marketMcps.icon,
        users.fullName,
      )
      .orderBy(desc(count()))
      .limit(limit);

    return rows.map((row) => this.toLeaderboardEntry(row));
  };

  private toLeaderboardEntry = (row: {
    icon?: string | null;
    identifier: string;
    name?: string | null;
    publisherName?: string | null;
    title?: string | null;
    usageCount: number | bigint;
  }): MarketLeaderboardEntry => ({
    icon: row.icon,
    identifier: row.identifier,
    name: row.name || row.title || row.identifier,
    publisherName: row.publisherName || 'Community',
    usageCount: Number(row.usageCount) || 0,
  });
}
