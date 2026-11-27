'use client';

import { getElectronIpc } from '@lobechat/electron-client-ipc';
import { type PropsWithChildren, useEffect } from 'react';
import { memo } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { autoUpdateService } from '@/services/electron/autoUpdate';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';

const DesktopAuthProvider = memo<PropsWithChildren>(({ children }) => {
  const useStoreUpdater = createStoreUpdater(useUserStore);
  // Desktop login state follows whether a remote server has been authorized via
  // the OIDC PKCE flow. `dataSyncConfig.active` flips to true once the OIDC token
  // is obtained (see AuthCtr / RemoteServerConfigCtr). Until then the user is
  // treated as signed-out, and the AuthRequiredModal force-login gate blocks
  // access. Expired tokens are handled by the existing `authorizationRequired`
  // / `session-expired` re-auth flow.
  const isSyncActive = useElectronStore((s) => !!s.dataSyncConfig.active);

  useStoreUpdater('isLoaded', true);
  useStoreUpdater('isSignedIn', isSyncActive);

  // Desktop: TRPC `getUserState` populates userStore.user (including username
  // = employee id for gray release) independently of Better-Auth. Watch the
  // username here and push it to the native updater whenever it changes, so the
  // SOA update request carries the correct `employee` field.
  const username = useUserStore((s) => s.user?.username);
  useEffect(() => {
    if (!getElectronIpc() || !username) return;
    autoUpdateService.setUpdaterEmpCode(username).catch((err) => {
      console.error('[DesktopAuthProvider] setUpdaterEmpCode failed:', err);
    });
  }, [username]);

  return children;
});

export default DesktopAuthProvider;
