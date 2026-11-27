import { AssistantCategory } from './assistants';
import { McpCategory } from './mcp';
import { SkillCategory } from './skills';

/** Publish-time categories (excludes filter-only "all") */
export const ASSISTANT_PUBLISH_CATEGORIES = [
  AssistantCategory.DataAnalytics,
  AssistantCategory.ProductManager,
  AssistantCategory.NewMedia,
  AssistantCategory.Marketing,
  AssistantCategory.Coding,
  AssistantCategory.Designer,
  AssistantCategory.UserResearch,
  AssistantCategory.HrFinance,
  AssistantCategory.Other,
] as const;

export const SKILL_PUBLISH_CATEGORIES = [
  SkillCategory.DataAnalytics,
  SkillCategory.ProductPlanning,
  SkillCategory.ContentCreation,
  SkillCategory.Marketing,
  SkillCategory.OpsAnalytics,
  SkillCategory.DesignCreation,
  SkillCategory.ResearchInsight,
  SkillCategory.ReportWriting,
  SkillCategory.DeepThinking,
  SkillCategory.Other,
] as const;

export const MCP_PUBLISH_CATEGORIES = [
  McpCategory.DataStorage,
  McpCategory.Collaboration,
  McpCategory.InfoFetch,
  McpCategory.Coding,
  McpCategory.BusinessSystem,
  McpCategory.UserFeedback,
  McpCategory.DesignAssets,
  McpCategory.ProjectManagement,
  McpCategory.Other,
] as const;

export type AssistantPublishCategory = (typeof ASSISTANT_PUBLISH_CATEGORIES)[number];
export type SkillPublishCategory = (typeof SKILL_PUBLISH_CATEGORIES)[number];
export type McpPublishCategory = (typeof MCP_PUBLISH_CATEGORIES)[number];

export const isValidAssistantPublishCategory = (value: string): value is AssistantPublishCategory =>
  (ASSISTANT_PUBLISH_CATEGORIES as readonly string[]).includes(value);

export const isValidSkillPublishCategory = (value: string): value is SkillPublishCategory =>
  (SKILL_PUBLISH_CATEGORIES as readonly string[]).includes(value);

export const isValidMcpPublishCategory = (value: string): value is McpPublishCategory =>
  (MCP_PUBLISH_CATEGORIES as readonly string[]).includes(value);
