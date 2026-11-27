import { ActionIcon, Button, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { theme } from 'antd';
import { InfoIcon, MoreVerticalIcon, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { useServerConfigStore } from '@/store/serverConfig';
import { KnowledgeType } from '@/types/knowledgeBase';

interface ActionsProps {
  enabled?: boolean;
  id: string;
  type: KnowledgeType;
}

const Actions = memo<ActionsProps>(({ id, type, enabled }) => {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();

  const mobile = useServerConfigStore((s) => s.isMobile);
  const [
    addFilesToAgent,
    addKnowledgeBasesToAgent,
    removeFilesFromAgent,
    removeKnowledgeBasesFromAgent,
  ] = useAgentStore((s) => [
    s.addFilesToAgent,
    s.addKnowledgeBaseToAgent,
    s.removeFileFromAgent,
    s.removeKnowledgeBaseFromAgent,
  ]);

  const [loading, setLoading] = useState(false);

  const assignKnowledge = async () => {
    setLoading(true);
    if (type === KnowledgeType.KnowledgeBase) {
      await addKnowledgeBasesToAgent(id);
    } else {
      await addFilesToAgent([id], true);
    }
    setLoading(false);
  };

  const removeKnowledge = async () => {
    setLoading(true);
    if (type === KnowledgeType.KnowledgeBase) {
      await removeKnowledgeBasesFromAgent(id);
    } else {
      await removeFilesFromAgent(id);
    }
    setLoading(false);
  };

  /** 菜单项 hover / 高亮由 @lobehub/ui 内置样式负责；这里只补「不透」面板底 + 弹窗内定位与层级。 */
  const menuZIndex = token.zIndexPopupBase + 5000;

  const menuItems = [
    {
      icon: <Icon icon={InfoIcon} />,
      key: 'detail',
      label: t('knowledgeBase.library.action.detail'),
      onClick: () => {
        if (type === KnowledgeType.KnowledgeBase) {
          window.open(`/resource/library/${id}`);
          return;
        }

        window.open(`/resource?file=${id}`);
      },
    },
    {
      danger: true,
      icon: <Icon icon={Trash2} />,
      key: 'remove',
      label: t('knowledgeBase.library.action.remove'),
      onClick: removeKnowledge,
    },
  ];

  return (
    <Flexbox horizontal align={'center'}>
      {enabled ? (
        <DropdownMenu
          items={menuItems}
          placement="bottomRight"
          popupProps={{
            style: {
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
              boxShadow: token.boxShadowSecondary,
              zIndex: menuZIndex,
            },
          }}
          portalProps={typeof document !== 'undefined' ? { container: document.body } : undefined}
          positionerProps={{
            positionMethod: 'fixed',
            style: { zIndex: menuZIndex },
          }}
        >
          <ActionIcon icon={MoreVerticalIcon} loading={loading} />
        </DropdownMenu>
      ) : (
        <Button
          loading={loading}
          size={mobile ? 'small' : undefined}
          type={'primary'}
          onClick={assignKnowledge}
        >
          {t('knowledgeBase.library.action.add')}
        </Button>
      )}
    </Flexbox>
  );
});

export default Actions;
