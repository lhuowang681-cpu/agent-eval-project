import type { TaskStatus } from '@lobechat/types';
import {
  closeContextMenu,
  type ContextMenuItem,
  copyToClipboard,
  type GenericItemType,
  Icon,
  type MenuInfo,
} from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { CircleDashedIcon, CopyIcon, LinkIcon, PlayIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';

import { taskDetailPath } from '../shared/taskDetailPath';
import { renderMenuExtra } from './menuExtra';
import { STATUS_META, USER_SELECTABLE_STATUSES } from './TaskStatusTag';

type ActiveSubmenu = 'status' | null;

interface TaskItemContextMenu {
  items: ContextMenuItem[];
  onContextMenu: () => void;
}

export interface TaskContextMenuTarget {
  assigneeAgentId?: string | null;
  identifier: string;
  status: string;
}

const RUN_NOW_STATUSES = new Set<TaskStatus>(['backlog', 'completed']);

export interface TaskContextMenuActions {
  buildItems: (task: TaskContextMenuTarget) => ContextMenuItem[];
  installKeyboardHandlers: (task: TaskContextMenuTarget) => void;
}

export const useTaskContextMenuActions = (): TaskContextMenuActions => {
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();
  const appOrigin = useAppOrigin();

  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const updateTask = useTaskStore((s) => s.updateTask);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const runTask = useTaskStore((s) => s.runTask);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const cleanupRef = useRef<(() => void) | null>(null);
  const activeSubmenuRef = useRef<ActiveSubmenu>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  return useMemo<TaskContextMenuActions>(() => {
    const triggerDelete = (identifier: string) => {
      confirmModal({
        content: t('taskDetail.deleteConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('taskDetail.deleteConfirm.ok'),
        onOk: async () => {
          await deleteTask(identifier);
        },
        title: t('taskDetail.deleteConfirm.title'),
      });
    };

    const buildItems = (task: TaskContextMenuTarget): ContextMenuItem[] => {
      const currentStatus = task.status as TaskStatus;

      const statusChildren = USER_SELECTABLE_STATUSES.map((status, index) => {
        const meta = STATUS_META[status];
        const isCurrent = status === currentStatus;
        return {
          extra: renderMenuExtra(String(index + 1), isCurrent),
          icon: <Icon color={meta.color} icon={meta.icon} />,
          key: `status-${status}`,
          label: t(`taskDetail.status.${status}`, { defaultValue: meta.label }),
          onClick: ({ domEvent }: MenuInfo) => {
            domEvent.stopPropagation();
            if (status === currentStatus) return;
            void updateTaskStatus(task.identifier, status);
          },
        } as ContextMenuItem;
      });

      const taskUrl = `${appOrigin}${taskDetailPath(
        task.identifier,
        task.assigneeAgentId ?? undefined,
      )}`;
      const canRunNow = RUN_NOW_STATUSES.has(currentStatus);

      return [
        ...(canRunNow
          ? ([
              {
                icon: <Icon icon={PlayIcon} />,
                key: 'runNow',
                label: t('taskList.contextMenu.runNow'),
                onClick: async ({ domEvent }: MenuInfo) => {
                  domEvent.stopPropagation();
                  if (!task.assigneeAgentId && inboxAgentId) {
                    await updateTask(task.identifier, { assigneeAgentId: inboxAgentId });
                  }
                  await runTask(task.identifier);
                },
              },
              { type: 'divider' },
            ] satisfies GenericItemType[])
          : []),
        {
          children: statusChildren,
          icon: <Icon icon={CircleDashedIcon} />,
          key: 'status',
          label: t('taskList.contextMenu.status'),
          onTitleMouseEnter: () => {
            activeSubmenuRef.current = 'status';
          },
        },
        { type: 'divider' },
        {
          icon: <Icon icon={CopyIcon} />,
          key: 'copyId',
          label: t('taskList.contextMenu.copyId'),
          onClick: async ({ domEvent }: MenuInfo) => {
            domEvent.stopPropagation();
            await copyToClipboard(task.identifier);
            message.success(t('taskList.contextMenu.copyIdSuccess'));
          },
        },
        {
          icon: <Icon icon={LinkIcon} />,
          key: 'copyLink',
          label: t('taskList.contextMenu.copyLink'),
          onClick: async ({ domEvent }: MenuInfo) => {
            domEvent.stopPropagation();
            await copyToClipboard(taskUrl);
            message.success(t('taskList.contextMenu.copyLinkSuccess'));
          },
        },
        { type: 'divider' },
        {
          danger: true,
          icon: <Icon icon={Trash2Icon} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: ({ domEvent }: MenuInfo) => {
            domEvent.stopPropagation();
            triggerDelete(task.identifier);
          },
        },
      ];
    };

    const installKeyboardHandlers = (task: TaskContextMenuTarget) => {
      cleanupRef.current?.();
      activeSubmenuRef.current = null;

      const currentStatus = task.status as TaskStatus;

      const cleanup = () => {
        document.removeEventListener('keydown', keyHandler, true);
        window.removeEventListener('pointerdown', pointerHandler, true);
        window.removeEventListener('contextmenu', contextHandler, true);
        cleanupRef.current = null;
        activeSubmenuRef.current = null;
      };

      const keyHandler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          cleanup();
          return;
        }

        const num = Number.parseInt(event.key, 10);
        if (Number.isNaN(num)) return;
        const idx = num - 1;

        const openSubmenu = activeSubmenuRef.current;
        if (!openSubmenu) return;

        if (openSubmenu === 'status') {
          if (idx < 0 || idx >= USER_SELECTABLE_STATUSES.length) return;
          event.preventDefault();
          event.stopPropagation();
          const nextStatus = USER_SELECTABLE_STATUSES[idx];
          if (nextStatus !== currentStatus) {
            void updateTaskStatus(task.identifier, nextStatus);
          }
          closeContextMenu();
          cleanup();
        }
      };

      const pointerHandler = () => {
        cleanup();
      };

      const contextHandler = () => {
        cleanup();
      };

      document.addEventListener('keydown', keyHandler, true);
      window.addEventListener('pointerdown', pointerHandler, true);
      window.addEventListener('contextmenu', contextHandler, true);

      cleanupRef.current = cleanup;
    };

    return { buildItems, installKeyboardHandlers };
  }, [
    message,
    t,
    appOrigin,
    updateTaskStatus,
    updateTask,
    refreshTaskList,
    deleteTask,
    runTask,
    inboxAgentId,
  ]);
};

export const useTaskItemContextMenu = (task: TaskContextMenuTarget): TaskItemContextMenu => {
  const { buildItems, installKeyboardHandlers } = useTaskContextMenuActions();
  const items = useMemo(() => buildItems(task), [buildItems, task]);
  const onContextMenu = useCallback(
    () => installKeyboardHandlers(task),
    [installKeyboardHandlers, task],
  );
  return { items, onContextMenu };
};
