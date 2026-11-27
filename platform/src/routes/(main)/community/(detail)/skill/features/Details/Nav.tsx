'use client';

import { Flexbox, Icon, Tabs, Tag } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, FileTextIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../DetailProvider';
import { SkillNavKey } from '../types';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  nav: css`
    border-block-end: 1px solid ${cssVar.colorBorder};
  `,
}));

const Nav = memo<{
  activeTab?: SkillNavKey;
  mobile?: boolean;
  setActiveTab?: (_tab: SkillNavKey) => void;
}>(({ mobile, setActiveTab, activeTab = SkillNavKey.Overview }) => {
  const { t } = useTranslation('discover');
  const { resources } = useDetailContext();

  const resourcesCount = Object.keys(resources || {}).length;

  const nav = (
    <Tabs
      activeKey={activeTab}
      compact={mobile}
      items={[
        {
          icon: <Icon icon={BookOpenIcon} size={16} />,
          key: SkillNavKey.Overview,
          label: t('skills.details.overview.title'),
        },
        {
          icon: <Icon icon={SkillsIcon} size={16} />,
          key: SkillNavKey.Skill,
          label: 'SKILL.md',
        },
        {
          icon: <Icon icon={FileTextIcon} size={16} />,
          key: SkillNavKey.Resources,
          label:
            resourcesCount > 1 ? (
              <Flexbox
                horizontal
                align={'center'}
                gap={6}
                style={{
                  display: 'inline-flex',
                }}
              >
                {t('skills.details.resources.title')}
                <Tag>{resourcesCount}</Tag>
              </Flexbox>
            ) : (
              t('skills.details.resources.title')
            ),
        },
      ]}
      onChange={(key) => setActiveTab?.(key as SkillNavKey)}
    />
  );

  return mobile ? (
    nav
  ) : (
    <Flexbox horizontal align={'center'} className={styles.nav} justify={'space-between'}>
      {nav}
    </Flexbox>
  );
});

export default Nav;
