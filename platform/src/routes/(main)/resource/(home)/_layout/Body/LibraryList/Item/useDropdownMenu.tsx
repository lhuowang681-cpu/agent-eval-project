import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { FileText, PencilLine, Share2, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import { invalidateMarketPublisherState } from '@/helpers/invalidateMarketPublisherState';
import { useMarketPublisherState } from '@/hooks/useMarketPublisherState';
import { useShowMarket } from '@/hooks/useShowMarket';
import { communityApiService } from '@/services/marketApi';
import { useKnowledgeBaseStore } from '@/store/library';

interface ActionProps {
  description?: string | null;
  id: string;
  marketIdentifier?: string | null;
  marketVisibility?: 'bundled' | 'public' | null;
  name: string;
  onPublish?: () => void;
  toggleEditing: (visible?: boolean) => void;
}

export const useDropdownMenu = ({
  id,
  name,
  description,
  marketIdentifier,
  toggleEditing,
  onPublish,
}: ActionProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['file', 'common', 'discover']);
  const { modal, message } = App.useApp();
  const removeKnowledgeBase = useKnowledgeBaseStore((s) => s.removeKnowledgeBase);
  const { open } = useCreateNewModal();

  const publishState = useMarketPublisherState(
    { marketIdentifier },
    'knowledgeBase',
    Boolean(marketIdentifier),
  );
  const showMarket = useShowMarket();

  const handleDelete = () => {
    if (!id) return;

    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await removeKnowledgeBase(id);
      },
      title: t('library.list.confirmRemoveLibrary'),
    });
  };

  const handleEditDescription = () => {
    open({
      id,
      initialValues: { description: description || '', name },
    });
  };

  const handleMarketAction = useCallback(async () => {
    if (!marketIdentifier) return;

    try {
      if (publishState.action === 'update') {
        await communityApiService.updateKnowledgeBase(marketIdentifier);
        message.success(t('knowledgeBases.updateSuccess', { ns: 'discover' }));
      } else if (publishState.action === 'relist') {
        await communityApiService.relistKnowledgeBaseWithSync(marketIdentifier);
        message.success(t('knowledgeBases.relistSuccess', { ns: 'discover' }));
      }
      await invalidateMarketPublisherState();
    } catch (error) {
      console.error(error);
      message.error(
        publishState.action === 'relist'
          ? t('knowledgeBases.relistFailed', { ns: 'discover' })
          : t('fork.failed', { ns: 'discover' }),
      );
    }
  }, [marketIdentifier, message, publishState.action, t]);

  return useCallback(
    () =>
      [
        {
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            toggleEditing(true);
          },
        },
        {
          icon: <Icon icon={FileText} />,
          key: 'editDescription',
          label: t('edit', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            handleEditDescription();
          },
        },
        ...(showMarket
          ? [
              marketIdentifier && publishState.action !== 'publish'
                ? {
                    icon: <Icon icon={Share2} />,
                    key: 'marketAction',
                    label: t(publishState.labelKey, { ns: 'discover' }),
                    onClick: (info: any) => {
                      info.domEvent?.stopPropagation();
                      handleMarketAction();
                    },
                  }
                : {
                    icon: <Icon icon={Share2} />,
                    key: 'publishToMarket',
                    label: t('knowledgeBases.publishToMarketLabel', { ns: 'discover' }),
                    onClick: (info: any) => {
                      info.domEvent?.stopPropagation();
                      onPublish?.();
                    },
                  },
            ]
          : []),
        { type: 'divider' },
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [
      t,
      id,
      name,
      description,
      marketIdentifier,
      showMarket,
      modal,
      removeKnowledgeBase,
      toggleEditing,
      onPublish,
      open,
      publishState.action,
      publishState.labelKey,
      handleMarketAction,
    ],
  );
};
