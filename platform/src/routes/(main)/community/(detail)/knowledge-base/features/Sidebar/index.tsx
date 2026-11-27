'use client';

import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import ShareButton from '../../../features/ShareButton';
import { useDetailContext } from '../DetailProvider';
import InstallKnowledgeBase from './InstallKnowledgeBase';

const Sidebar = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { description, name, identifier, avatar } = useDetailContext();
  const { t } = useTranslation('common');
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const shareButton = (
    <ShareButton
      block
      size={'large'}
      meta={{
        avatar: avatar || undefined,
        desc: description,
        title: name,
        url: urlJoin(baseUrl, '/community/knowledge-base', identifier || ''),
      }}
    >
      {t('share')}
    </ShareButton>
  );

  if (mobile) {
    return (
      <Flexbox gap={24} width={'100%'}>
        <InstallKnowledgeBase />
        {shareButton}
      </Flexbox>
    );
  }

  return (
    <ScrollShadow
      hideScrollBar
      flex={'none'}
      gap={24}
      size={4}
      width={360}
      style={{
        maxHeight: 'calc(100vh - 114px)',
        paddingBottom: 24,
        position: 'sticky',
        top: 114,
      }}
    >
      <InstallKnowledgeBase />
      {shareButton}
    </ScrollShadow>
  );
});

export default Sidebar;
