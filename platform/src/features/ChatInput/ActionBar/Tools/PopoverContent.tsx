import { type ItemType } from '@lobehub/ui';
import { Flexbox, Icon, usePopoverContext } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Pin, Settings, Store, Zap } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { getActionPanelMaxHeight } from '../components/getActionPanelMaxHeight';
import { ScrollSignalProvider } from './ScrollSignalContext';
import ToolsList from './ToolsList';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
  `,
  footer: css`
    display: flex;
    flex-shrink: 0;
    gap: 14px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorFill};
  `,
  header: css`
    flex-shrink: 0;
    padding-block: 8px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorFill};
  `,
  body: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  statsItem: css`
    display: inline-flex;
    gap: 5px;
    align-items: center;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  iconButton: css`
    cursor: pointer;

    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  storeButton: css`
    cursor: pointer;

    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border: 0;
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface PopoverContentProps {
  autoCount: number;
  items: ItemType[];
  marketHeader: ReactNode;
  onOpenStore: () => void;
  pinnedCount: number;
}

const PopoverContent = memo<PopoverContentProps>(
  ({ autoCount, items, marketHeader, onOpenStore, pinnedCount }) => {
    const { t } = useTranslation('setting');
    const navigate = useNavigate();
    const { close: closePopover } = usePopoverContext();

    return (
      <Flexbox
        className={styles.container}
        gap={0}
        style={{ height: getActionPanelMaxHeight(500) }}
      >
        <Flexbox horizontal align="center" className={styles.header} gap={4}>
          {marketHeader}
        </Flexbox>
        <ScrollSignalProvider className={styles.body} style={{ height: 480, overflowY: 'auto' }}>
          <ToolsList items={items} />
        </ScrollSignalProvider>
        <div className={styles.footer}>
          <span className={styles.statsItem}>
            <Icon icon={Pin} size={12} />
            {pinnedCount}
          </span>
          <span className={styles.statsItem}>
            <Icon icon={Zap} size={12} />
            {autoCount}
          </span>
          <Flexbox horizontal align="center" gap={2} style={{ marginInlineStart: 'auto' }}>
            <button
              className={styles.storeButton}
              type="button"
              onClick={() => {
                closePopover();
                onOpenStore();
              }}
            >
              <Icon icon={Store} size={14} />
              {t('tools.addSkillOrConnector')}
            </button>
            <button
              aria-label={t('tools.plugins.management')}
              className={styles.iconButton}
              type="button"
              onClick={() => {
                closePopover();
                navigate('/settings/skill');
              }}
            >
              <Icon icon={Settings} size={14} />
            </button>
          </Flexbox>
        </div>
      </Flexbox>
    );
  },
);

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;
