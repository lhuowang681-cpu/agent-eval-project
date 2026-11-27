'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, ContextMenuTrigger, Flexbox, type GenericItemType, Icon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { type ResolvedPageData } from '@/features/Electron/titlebar/RecentlyViewed/types';
import { electronStylish } from '@/styles/electron';

import { useStyles } from './styles';

interface TabItemProps {
  index: number;
  isActive: boolean;
  item: ResolvedPageData;
  onActivate: (id: string, url: string) => void;
  onClose: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  totalCount: number;
}

const TabItem = memo<TabItemProps>(
  ({
    item,
    isActive,
    index,
    totalCount,
    onActivate,
    onClose,
    onCloseOthers,
    onCloseLeft,
    onCloseRight,
  }) => {
    const styles = useStyles;
    const { t } = useTranslation('electron');
    const id = item.reference.id;

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id,
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    const handleClick = useCallback(() => {
      if (!isActive) {
        onActivate(id, item.url);
      }
    }, [isActive, onActivate, id, item.url]);

    const handleClose = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onClose(id);
      },
      [onClose, id],
    );

    const contextMenuItems = useCallback(
      (): GenericItemType[] => [
        {
          key: 'closeCurrentTab',
          label: t('tab.closeCurrentTab'),
          onClick: () => onClose(id),
        },
        {
          key: 'closeOtherTabs',
          label: t('tab.closeOtherTabs'),
          onClick: () => onCloseOthers(id),
        },
        { type: 'divider' },
        {
          disabled: index === 0,
          key: 'closeLeftTabs',
          label: t('tab.closeLeftTabs'),
          onClick: () => onCloseLeft(id),
        },
        {
          disabled: index === totalCount - 1,
          key: 'closeRightTabs',
          label: t('tab.closeRightTabs'),
          onClick: () => onCloseRight(id),
        },
      ],
      [t, id, index, totalCount, onClose, onCloseOthers, onCloseLeft, onCloseRight],
    );

    return (
      <ContextMenuTrigger items={contextMenuItems}>
        <Flexbox
          horizontal
          align="center"
          data-active={isActive}
          gap={6}
          ref={setNodeRef}
          style={style}
          className={cx(
            electronStylish.nodrag,
            styles.tab,
            isActive && styles.tabActive,
            isDragging && styles.tabDragging,
          )}
          onClick={handleClick}
          {...attributes}
          {...listeners}
        >
          {item.icon && <Icon className={styles.tabIcon} icon={item.icon} size="small" />}
          <span className={styles.tabTitle}>{item.title}</span>
          <ActionIcon
            className={cx('closeIcon', styles.closeIcon)}
            icon={X}
            size="small"
            onClick={handleClose}
          />
        </Flexbox>
      </ContextMenuTrigger>
    );
  },
);

TabItem.displayName = 'TabItem';

export default TabItem;
