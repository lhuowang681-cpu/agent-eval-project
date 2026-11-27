'use client';

import { ProviderIcon } from '@lobehub/icons';
import { Button, DropdownMenu } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import urlJoin from 'url-join';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    button {
      width: 100%;
    }
  `,
}));

const ChatWithModel = memo(() => {
  const { t } = useTranslation('discover');
  const { providers = [] } = useDetailContext();

  const items = providers.map((item) => ({
    icon: <ProviderIcon provider={item.id} size={20} type={'avatar'} />,
    key: item.id,
    label: (
      <Link to={urlJoin('/community/provider', item.id)}>
        {[item.name, t('models.guide')].join(' ')}
      </Link>
    ),
  }));

  if (items.length === 1)
    return (
      <Link style={{ flex: 1 }} to={urlJoin('/community/provider', items[0].key)}>
        <Button block className={styles.button} size={'large'} type={'primary'}>
          {t('models.guide')}
        </Button>
      </Link>
    );

  return (
    <DropdownMenu data-no-highlight items={items}>
      <Button
        className={styles.button}
        size={'large'}
        style={{ flex: 1, width: 'unset' }}
        type={'primary'}
      >
        {t('models.guide')}
      </Button>
    </DropdownMenu>
  );
});

export default ChatWithModel;
