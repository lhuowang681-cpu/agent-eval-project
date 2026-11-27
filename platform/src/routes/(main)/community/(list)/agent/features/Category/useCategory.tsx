import {
  BarChart2Icon,
  BriefcaseIcon,
  CodeIcon,
  LayoutPanelTop,
  MegaphoneIcon,
  PaletteIcon,
  SearchIcon,
  ShapesIcon,
  UsersIcon,
  VideoIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AssistantCategory } from '@/types/discover';

export const useCategory = () => {
  const { t } = useTranslation('discover');

  return useMemo(
    () => [
      {
        icon: LayoutPanelTop,
        key: AssistantCategory.All,
        label: t('category.assistant.all'),
      },
      {
        icon: BarChart2Icon,
        key: AssistantCategory.DataAnalytics,
        label: t('category.assistant.data-analytics'),
      },
      {
        icon: BriefcaseIcon,
        key: AssistantCategory.ProductManager,
        label: t('category.assistant.product-manager'),
      },
      {
        icon: VideoIcon,
        key: AssistantCategory.NewMedia,
        label: t('category.assistant.new-media'),
      },
      {
        icon: MegaphoneIcon,
        key: AssistantCategory.Marketing,
        label: t('category.assistant.marketing'),
      },
      {
        icon: CodeIcon,
        key: AssistantCategory.Coding,
        label: t('category.assistant.coding'),
      },
      {
        icon: PaletteIcon,
        key: AssistantCategory.Designer,
        label: t('category.assistant.designer'),
      },
      {
        icon: SearchIcon,
        key: AssistantCategory.UserResearch,
        label: t('category.assistant.user-research'),
      },
      {
        icon: UsersIcon,
        key: AssistantCategory.HrFinance,
        label: t('category.assistant.hr-finance'),
      },
      {
        icon: ShapesIcon,
        key: AssistantCategory.Other,
        label: t('category.assistant.other'),
      },
    ],
    [t],
  );
};

export const useCategoryItem = (key?: AssistantCategory) => {
  const items = useCategory();
  if (!key) return;
  return items.find((item) => item.key === key);
};
