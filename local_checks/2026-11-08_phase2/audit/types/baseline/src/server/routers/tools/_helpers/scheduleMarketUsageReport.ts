import { MarketUsageRecordModel } from '@/database/models/marketUsageRecord';
import { type LobeChatDatabase } from '@/database/type';

export interface ScheduleMarketUsageReportParams {
  agentId?: string;
  identifier: string;
  serverDB: LobeChatDatabase;
  type: 'agent' | 'skill' | 'mcp';
  userId: string;
}

export const scheduleMarketUsageReport = (params: ScheduleMarketUsageReportParams): void => {
  const { serverDB, userId, type, identifier, agentId } = params;
  if (!userId || !identifier) return;

  void (async () => {
    try {
      const usageModel = new MarketUsageRecordModel(serverDB);
      switch (type) {
        case 'agent': {
          await usageModel.recordAgentUsage(identifier, userId);
          break;
        }
        case 'skill': {
          await usageModel.recordSkillUsage(identifier, userId, agentId);
          break;
        }
        case 'mcp': {
          await usageModel.recordMcpUsage(identifier, userId, agentId);
          break;
        }
      }
    } catch (error) {
      console.error('[scheduleMarketUsageReport] failed:', error);
    }
  })();
};
