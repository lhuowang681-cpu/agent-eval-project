import {
  BarChart2Icon,
  BrainIcon,
  FileTextIcon,
  LayoutPanelTopIcon,
  LightbulbIcon,
  MegaphoneIcon,
  PaletteIcon,
  PenLineIcon,
  SearchIcon,
  ShapesIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SkillCategory } from '@/types/discover';

export const useSkillCategory = () => {
  const { t } = useTranslation('discover');
  return useMemo(
    () => [
      {
        icon: LayoutPanelTopIcon,
        key: SkillCategory.All,
        label: t('skills.categories.all.name'),
        title: t('skills.categories.all.description'),
      },
      {
        icon: BarChart2Icon,
        key: SkillCategory.DataAnalytics,
        label: t('skills.categories.data-analytics.name'),
        title: t('skills.categories.data-analytics.description'),
      },
      {
        icon: LightbulbIcon,
        key: SkillCategory.ProductPlanning,
        label: t('skills.categories.product-planning.name'),
        title: t('skills.categories.product-planning.description'),
      },
      {
        icon: PenLineIcon,
        key: SkillCategory.ContentCreation,
        label: t('skills.categories.content-creation.name'),
        title: t('skills.categories.content-creation.description'),
      },
      {
        icon: MegaphoneIcon,
        key: SkillCategory.Marketing,
        label: t('skills.categories.marketing.name'),
        title: t('skills.categories.marketing.description'),
      },
      {
        icon: BarChart2Icon,
        key: SkillCategory.OpsAnalytics,
        label: t('skills.categories.ops-analytics.name'),
        title: t('skills.categories.ops-analytics.description'),
      },
      {
        icon: PaletteIcon,
        key: SkillCategory.DesignCreation,
        label: t('skills.categories.design-creation.name'),
        title: t('skills.categories.design-creation.description'),
      },
      {
        icon: SearchIcon,
        key: SkillCategory.ResearchInsight,
        label: t('skills.categories.research-insight.name'),
        title: t('skills.categories.research-insight.description'),
      },
      {
        icon: FileTextIcon,
        key: SkillCategory.ReportWriting,
        label: t('skills.categories.report-writing.name'),
        title: t('skills.categories.report-writing.description'),
      },
      {
        icon: BrainIcon,
        key: SkillCategory.DeepThinking,
        label: t('skills.categories.deep-thinking.name'),
        title: t('skills.categories.deep-thinking.description'),
      },
      {
        icon: ShapesIcon,
        key: SkillCategory.Other,
        label: t('skills.categories.other.name'),
        title: t('skills.categories.other.description'),
      },
    ],
    [t],
  );
};

export const useSkillCategoryItem = (key?: string) => {
  const items = useSkillCategory();
  if (!key) return;
  return items.find((item) => item.key === key);
};
