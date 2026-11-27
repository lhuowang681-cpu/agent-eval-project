import { isDesktop } from '@lobechat/const';

import { useGlobalStore } from '@/store/global';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useNewVersion = () => {
  const [hasNewVersion, useCheckLatestVersion] = useGlobalStore((s) => [
    s.hasNewVersion,
    s.useCheckLatestVersion,
  ]);

  const { enableCheckUpdates } = useServerConfigStore(featureFlagsSelectors);
  // Desktop uses its own native updater (MacUpdaterManager on macOS, electron-updater
  // elsewhere); the @lobehub/chat npm registry version is irrelevant here. Skip the
  // check entirely on desktop so no useless network request is made and no misleading
  // "new version v<web-version>" tag is shown in the About page.
  useCheckLatestVersion(enableCheckUpdates && !isDesktop);

  return hasNewVersion;
};
