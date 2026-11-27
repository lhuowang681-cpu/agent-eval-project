import { Avatar, Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { type AgentCapabilityItem } from '@/types/discover';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    clickable: css`
      cursor: pointer;

      &:hover {
        .capability-title {
          color: ${cssVar.colorLink};
        }
      }
    `,
    desc: css`
      flex: 1;
      margin: 0 !important;
      font-size: 14px !important;
      color: ${cssVar.colorTextSecondary};
    `,
    noLink: css`
      cursor: default;
    `,
    tag: css`
      flex-shrink: 0;
    `,
    title: css`
      margin: 0 !important;
      font-size: 14px !important;
      font-weight: 500 !important;
    `,
    titleRow: css`
      display: flex;
      gap: 8px;
      align-items: center;
    `,
  };
});

interface CapabilityItemProps {
  item: AgentCapabilityItem;
}

const CapabilityItem = memo<CapabilityItemProps>(({ item }) => {
  const { t } = useTranslation('discover');
  const isPublic = item.visibility === 'public';
  const avatar = item.avatar || (item.kind === 'skill' ? '🧩' : '🔌');
  const bundledLabel = t('skills.bundledTag', { defaultValue: '内置' });

  const content = (
    <Block
      horizontal
      className={cx(isPublic ? styles.clickable : styles.noLink)}
      gap={12}
      padding={12}
      variant={'outlined'}
    >
      <Avatar avatar={avatar} shape={'square'} size={40} style={{ flex: 'none' }} />
      <Flexbox flex={1} gap={6} style={{ overflow: 'hidden' }}>
        <div className={styles.titleRow}>
          <Text ellipsis as={'h2'} className={cx(styles.title, 'capability-title')}>
            {item.name}
          </Text>
          {!isPublic && (
            <Tag className={styles.tag} color="gold" size={'small'}>
              {bundledLabel}
            </Tag>
          )}
        </div>
        <Text as={'p'} className={styles.desc} ellipsis={{ rows: 2 }}>
          {item.description || ''}
        </Text>
      </Flexbox>
    </Block>
  );

  if (!isPublic) return content;

  const href =
    item.kind === 'skill'
      ? `/community/skill/${item.identifier}`
      : `/community/mcp/${item.identifier}`;

  return (
    <Link style={{ color: 'inherit', textDecoration: 'none' }} to={href}>
      {content}
    </Link>
  );
});

export default CapabilityItem;
