import { Block, Empty, Flexbox } from '@lobehub/ui';
import { BlocksIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';
import CapabilityItem from './CapabilityItem';
import PluginItem from './PluginItem';

const Plugin = memo(() => {
  const { t } = useTranslation('discover');
  const { capabilities = [], config } = useDetailContext();

  const unresolvedPluginIds = useMemo(() => {
    const resolvedIds = new Set(capabilities.map((item) => item.identifier));
    return [...new Set(config?.plugins || [])].filter((id) => !resolvedIds.has(id));
  }, [capabilities, config?.plugins]);

  const hasItems = capabilities.length > 0 || unresolvedPluginIds.length > 0;

  if (!hasItems)
    return (
      <Block variant={'outlined'}>
        <Empty
          description={t('assistants.details.capabilities.plugin.desc')}
          descriptionProps={{ fontSize: 14 }}
          icon={BlocksIcon}
        />
      </Block>
    );

  return (
    <Flexbox gap={8}>
      {capabilities.map((item) => (
        <CapabilityItem item={item} key={item.identifier} />
      ))}
      {unresolvedPluginIds.map((identifier) => (
        <PluginItem identifier={identifier} key={identifier} />
      ))}
    </Flexbox>
  );
});

export default Plugin;
