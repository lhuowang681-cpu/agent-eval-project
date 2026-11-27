import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';
import Block from './Block';
import Knowledge from './Knowledge';
import Plugins from './Plugins';

const Capabilities = memo(() => {
  const { t } = useTranslation('discover');
  const { knowledgeCount, config, capabilities = [] } = useDetailContext();

  const unresolvedPluginCount = useMemo(() => {
    const resolvedIds = new Set(capabilities.map((item) => item.identifier));
    return [...new Set(config?.plugins || [])].filter((id) => !resolvedIds.has(id)).length;
  }, [capabilities, config?.plugins]);

  const effectivePluginCount = capabilities.length + unresolvedPluginCount;
  const effectiveKnowledgeCount = config?.knowledgeBases?.length || knowledgeCount || 0;

  return (
    <Flexbox gap={64}>
      <Block
        count={effectivePluginCount}
        desc={t('assistants.details.capabilities.plugin.desc')}
        id={'tools'}
        title={t('assistants.details.capabilities.plugin.title')}
      >
        <Plugins />
      </Block>

      <Block
        count={effectiveKnowledgeCount}
        desc={t('assistants.details.capabilities.knowledge.desc')}
        id={'prompts'}
        title={t('assistants.details.capabilities.knowledge.title')}
      >
        <Knowledge />
      </Block>
    </Flexbox>
  );
});

export default Capabilities;
