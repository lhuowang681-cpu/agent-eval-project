import {
  CodeIcon,
  DatabaseIcon,
  FigmaIcon,
  LayoutPanelTopIcon,
  MessageSquareHeartIcon,
  MessagesSquareIcon,
  ServerIcon,
  ShapesIcon,
  WorkflowIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { McpCategory } from '@/types/discover';

export const useCategory = () => {
  const { t } = useTranslation('discover');
  return useMemo(
    () => [
      {
        icon: LayoutPanelTopIcon,
        key: McpCategory.All,
        label: t('mcp.categories.all.name'),
        title: t('mcp.categories.all.description'),
      },
      {
        icon: DatabaseIcon,
        key: McpCategory.DataStorage,
        label: t('mcp.categories.data-storage.name'),
        title: t('mcp.categories.data-storage.description'),
      },
      {
        icon: MessagesSquareIcon,
        key: McpCategory.Collaboration,
        label: t('mcp.categories.collaboration.name'),
        title: t('mcp.categories.collaboration.description'),
      },
      {
        icon: WorkflowIcon,
        key: McpCategory.InfoFetch,
        label: t('mcp.categories.info-fetch.name'),
        title: t('mcp.categories.info-fetch.description'),
      },
      {
        icon: CodeIcon,
        key: McpCategory.Coding,
        label: t('mcp.categories.coding.name'),
        title: t('mcp.categories.coding.description'),
      },
      {
        icon: ServerIcon,
        key: McpCategory.BusinessSystem,
        label: t('mcp.categories.business-system.name'),
        title: t('mcp.categories.business-system.description'),
      },
      {
        icon: MessageSquareHeartIcon,
        key: McpCategory.UserFeedback,
        label: t('mcp.categories.user-feedback.name'),
        title: t('mcp.categories.user-feedback.description'),
      },
      {
        icon: FigmaIcon,
        key: McpCategory.DesignAssets,
        label: t('mcp.categories.design-assets.name'),
        title: t('mcp.categories.design-assets.description'),
      },
      {
        icon: WorkflowIcon,
        key: McpCategory.ProjectManagement,
        label: t('mcp.categories.project-management.name'),
        title: t('mcp.categories.project-management.description'),
      },
      {
        icon: ShapesIcon,
        key: McpCategory.Other,
        label: t('mcp.categories.other.name'),
        title: t('mcp.categories.other.description'),
      },
    ],
    [t],
  );
};

export const useCategoryItem = (key?: McpCategory) => {
  const items = useCategory();
  if (!key) return;
  return items.find((item) => item.key === key);
};
