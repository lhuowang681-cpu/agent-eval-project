import isEqual from 'fast-deep-equal';
import { type ReactNode } from 'react';
import { memo } from 'react';

import DevModal from '@/features/PluginDevModal';
import { toMcpFormValue } from '@/features/PluginDevModal/toMcpFormValue';
import { pluginService } from '@/services/plugin';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

interface EditMcpPluginProps {
  children: ReactNode;
  identifier: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const EditMcpPlugin = memo<EditMcpPluginProps>(({ identifier, open, onOpenChange, children }) => {
  const installedPlugin = useToolStore(pluginSelectors.getInstalledPluginById(identifier), isEqual);
  const refreshPlugins = useToolStore((s) => s.refreshPlugins);

  if (!installedPlugin) return <>{children}</>;

  const formValue = toMcpFormValue(installedPlugin);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <DevModal
        mode="edit"
        open={open}
        value={formValue}
        onOpenChange={onOpenChange}
        onSave={async (devPlugin) => {
          const existingMeta =
            (installedPlugin.manifest as { meta?: Record<string, unknown> } | undefined)?.meta ??
            {};
          const nextMeta = {
            ...existingMeta,
            ...devPlugin.manifest?.meta,
            // Keep manifest.meta in sync with the customParams-backed form fields so the
            // market page (which reads manifest.meta) and the local skill page (which
            // reads customParams) show the same description / avatar.
            avatar: devPlugin.customParams?.avatar ?? devPlugin.manifest?.meta?.avatar,
            description:
              devPlugin.customParams?.description ?? devPlugin.manifest?.meta?.description,
          };
          const nextManifest = devPlugin.manifest
            ? {
                ...(installedPlugin.manifest as object),
                ...devPlugin.manifest,
                meta: nextMeta,
              }
            : (installedPlugin.manifest ?? undefined);

          await pluginService.updatePlugin(identifier, {
            customParams: devPlugin.customParams,
            manifest: nextManifest,
            settings: devPlugin.settings,
          });
          await refreshPlugins();
          onOpenChange(false);
        }}
      />
      {children}
    </div>
  );
});

export default EditMcpPlugin;
