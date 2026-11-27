'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import urlJoin from 'url-join';

import ShareButton from '../../../../features/ShareButton';
import { useDetailContext } from '../../DetailProvider';
import InstallAndChat from './InstallAndChat';

const ActionButton = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { avatar, description, tags, title, identifier } = useDetailContext();
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <InstallAndChat mobile={mobile} />
      <ShareButton
        meta={{
          avatar,
          desc: description,
          hashtags: tags,
          title,
          url: urlJoin(baseUrl, '/community/agent', identifier as string),
        }}
      />
    </Flexbox>
  );
});

export default ActionButton;
