'use client';

import { Select } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCategory as useMcpCategory } from '@/hooks/useMCPCategory';
import { useSkillCategory } from '@/hooks/useSkillCategory';
import { useCategory as useAssistantCategory } from '@/routes/(main)/community/(list)/agent/features/Category/useCategory';
import {
  ASSISTANT_PUBLISH_CATEGORIES,
  MCP_PUBLISH_CATEGORIES,
  SKILL_PUBLISH_CATEGORIES,
} from '@/types/discover';

export type MarketCategoryResourceType = 'agent' | 'skill' | 'mcp';

interface CategorySelectProps {
  onChange: (value: string) => void;
  resourceType: MarketCategoryResourceType;
  value?: string;
}

const CategorySelect = memo<CategorySelectProps>(({ resourceType, value, onChange }) => {
  const { t } = useTranslation('discover');
  const assistantCategories = useAssistantCategory();
  const skillCategories = useSkillCategory();
  const mcpCategories = useMcpCategory();

  const options = useMemo(() => {
    const publishKeys =
      resourceType === 'agent'
        ? ASSISTANT_PUBLISH_CATEGORIES
        : resourceType === 'skill'
          ? SKILL_PUBLISH_CATEGORIES
          : MCP_PUBLISH_CATEGORIES;

    const source =
      resourceType === 'agent'
        ? assistantCategories
        : resourceType === 'skill'
          ? skillCategories
          : mcpCategories;

    return publishKeys.map((key) => {
      const item = source.find((c) => c.key === key);
      return { label: item?.label ?? key, value: key };
    });
  }, [assistantCategories, mcpCategories, resourceType, skillCategories]);

  return (
    <Select
      options={options}
      placeholder={t('publish.category.label')}
      style={{ width: '100%' }}
      value={value}
      onChange={onChange}
    />
  );
});

CategorySelect.displayName = 'CategorySelect';

export default CategorySelect;
