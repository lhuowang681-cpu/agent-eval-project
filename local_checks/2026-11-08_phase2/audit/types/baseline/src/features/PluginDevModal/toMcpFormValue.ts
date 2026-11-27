import type { LobeTool } from '@lobechat/types';

import type { LobeToolCustomPlugin } from '@/types/tool/plugin';

export const toMcpFormValue = (plugin: LobeTool): LobeToolCustomPlugin => {
  const meta = (
    plugin.manifest as {
      meta?: { avatar?: string; avatarBackground?: string; description?: string };
    } | null
  )?.meta;
  const customParams = plugin.customParams ?? {};

  // Backfill legacy records where CLI-published MCPs only carry description / avatar
  // in manifest.meta but the UI form reads them from customParams.
  const mergedCustomParams = {
    ...customParams,
    avatar: customParams.avatar ?? meta?.avatar,
    avatarBackground: customParams.avatarBackground ?? meta?.avatarBackground,
    description: customParams.description ?? meta?.description,
  };

  return {
    customParams: mergedCustomParams,
    identifier: plugin.identifier,
    manifest: plugin.manifest ?? undefined,
    settings: plugin.settings,
    type: 'customPlugin',
  };
};
