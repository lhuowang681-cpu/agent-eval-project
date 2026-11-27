'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';

import MCPTag from '@/components/Plugins/MCPTag';
import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PublishedToMarketTag from '@/components/PublishedToMarketTag';
import SkillSourceTag from '@/components/SkillSourceTag';
import PluginDetailModal from '@/features/PluginDetailModal';
import { isPublishableMcpPlugin } from '@/helpers/marketPublisherActionState';
import { useMarketPublisherState } from '@/hooks/useMarketPublisherState';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

import Actions from './Actions';
import { styles } from './style';

interface McpSkillItemProps {
  avatar?: string;
  identifier: string;
  title: string;
  type: LobeToolType;
}

const McpSkillItem = memo<McpSkillItemProps>(({ identifier, title, avatar, type }) => {
  const isCustomPlugin = type === 'customPlugin';
  const [detailOpen, setDetailOpen] = useState(false);

  const plugin = useToolStore(pluginSelectors.getToolManifestById(identifier));
  const installedPlugins = useToolStore(pluginSelectors.installedPlugins);
  const mcpTool = installedPlugins.find((p) => p.identifier === identifier);
  const publishState = useMarketPublisherState(
    {
      installedFromMarketIdentifier: mcpTool?.installedFromMarketIdentifier,
      isPublishable: isPublishableMcpPlugin(mcpTool),
      marketIdentifier: mcpTool?.marketIdentifier,
    },
    'mcp',
    Boolean(mcpTool),
  );
  const displayTitle =
    (mcpTool?.manifest as { meta?: { title?: string } } | undefined)?.meta?.title ||
    plugin?.meta?.title ||
    title;

  return (
    <>
      <Flexbox
        horizontal
        align="center"
        className={styles.container}
        gap={16}
        justify="space-between"
      >
        <Flexbox horizontal align="center" gap={12} style={{ flex: 1, overflow: 'hidden' }}>
          <div className={styles.icon}>
            <PluginAvatar avatar={avatar} size={32} />
          </div>
          <Flexbox horizontal align="center" gap={8} style={{ overflow: 'hidden' }}>
            <span className={styles.title} onClick={() => setDetailOpen(true)}>
              {displayTitle}
            </span>
            <MCPTag showText={false} />
            {publishState.showPublishedTag && <PublishedToMarketTag />}
            <SkillSourceTag source={isCustomPlugin ? 'user' : 'market'} />
          </Flexbox>
        </Flexbox>
        <Actions isMCP identifier={identifier} type={type} />
      </Flexbox>
      <PluginDetailModal
        id={identifier}
        open={detailOpen}
        schema={plugin?.settings}
        tab="info"
        onClose={() => setDetailOpen(false)}
      />
    </>
  );
});

McpSkillItem.displayName = 'McpSkillItem';

export default McpSkillItem;
