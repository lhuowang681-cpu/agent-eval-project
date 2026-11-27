import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { type CSSProperties } from 'react';
import React, { memo, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import RepoIcon from '@/components/LibIcon';
import { KnowledgeBasePublishModal } from '@/features/MarketPublish';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { useKnowledgeBaseStore } from '@/store/library';

import Actions from './Actions';
import Editing from './Editing';
import { useDropdownMenu } from './useDropdownMenu';

interface KnowledgeBaseItemProps {
  active?: boolean;
  className?: string;
  description?: string | null;
  id: string;
  marketIdentifier?: string | null;
  marketVisibility?: 'bundled' | 'public' | null;
  name: string;
  style?: CSSProperties;
}

const KnowledgeBaseItem = memo<KnowledgeBaseItemProps>(
  ({ id, name, description, marketIdentifier, marketVisibility, active, style, className }) => {
    const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);
    const navigate = useNavigate();
    const [publishOpen, setPublishOpen] = useState(false);
    const refreshKnowledgeBaseList = useKnowledgeBaseStore((s) => s.refreshKnowledgeBaseList);

    const [editing, isLoading] = useKnowledgeBaseStore((s) => [
      s.knowledgeBaseRenamingId === id,
      s.knowledgeBaseLoadingIds.includes(id),
    ]);

    const toggleEditing = useCallback(
      (visible?: boolean) => {
        useKnowledgeBaseStore.setState(
          { knowledgeBaseRenamingId: visible ? id : null },
          false,
          'toggleEditing',
        );
      },
      [id],
    );

    const handleClick = useCallback(() => {
      if (!editing) {
        navigate(`/resource/library/${id}`);
        setLibraryId(id);
      }
    }, [editing, navigate, id]);

    const handleDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        if (e.altKey) {
          toggleEditing(true);
        }
      },
      [toggleEditing],
    );

    // Icon (show loader when updating)
    const icon = useMemo(() => {
      if (isLoading) {
        return <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={18} />;
      }
      return <RepoIcon size={18} />;
    }, [isLoading]);

    const dropdownMenu = useDropdownMenu({
      description,
      id,
      marketIdentifier,
      marketVisibility,
      name,
      onPublish: () => setPublishOpen(true),
      toggleEditing,
    });

    return (
      <>
        <NavItem
          actions={<Actions dropdownMenu={dropdownMenu} />}
          active={active}
          className={className}
          contextMenuItems={dropdownMenu}
          disabled={editing}
          icon={icon}
          key={id}
          loading={isLoading}
          style={style}
          title={name}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        />
        <Editing id={id} name={name} toggleEditing={toggleEditing} />
        <KnowledgeBasePublishModal
          excludeMarketIdentifier={marketIdentifier}
          knowledgeBaseId={id}
          knowledgeBaseName={name}
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
          onSuccess={() => refreshKnowledgeBaseList()}
        />
      </>
    );
  },
);

export default KnowledgeBaseItem;
