'use client';

import { getElectronIpc } from '@lobechat/electron-client-ipc';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useSession } from '@/libs/better-auth/auth-client';
import { autoUpdateService } from '@/services/electron/autoUpdate';
import { useUserStore } from '@/store/user';
import { type LobeUser } from '@/types/user';

/**
 * Sync Better-Auth session state to Zustand store
 */
const UserUpdater = memo(() => {
  const { data: session, isPending, error } = useSession();

  const isLoaded = !isPending;
  const isSignedIn = !!session?.user && !error;

  const betterAuthUser = session?.user;
  const useStoreUpdater = createStoreUpdater(useUserStore);

  useStoreUpdater('isLoaded', isLoaded);
  useStoreUpdater('isSignedIn', isSignedIn);

  // Sync user data from Better-Auth session to Zustand store
  useEffect(() => {
    if (betterAuthUser) {
      const userAvatar = useUserStore.getState().user?.avatar;

      const lobeUser = {
        // Preserve avatar from settings, don't override with auth provider value
        avatar: userAvatar || '',
        email: betterAuthUser.email,
        fullName: betterAuthUser.name,
        id: betterAuthUser.id,
        username: betterAuthUser.username,
      } as LobeUser;

      // Merge with existing user data to preserve fields set by useInitUserState
      // (e.g. mcpAdaToken, feishuOpenId, interests). Overwriting the whole `user`
      // object would clear those fields whenever better-auth session updates.
      useUserStore.setState((state) => ({
        user: { ...state.user, ...lobeUser } as LobeUser,
      }));

      // Debug (temporary): surface the actual betterAuthUser fields and IPC call
      // outcome so we can see why `employee` was empty in the SOA request.
      // Remove once the root cause is confirmed.
      console.info('[UserUpdater] betterAuthUser:', {
        id: betterAuthUser.id,
        email: betterAuthUser.email,
        name: betterAuthUser.name,
        username: betterAuthUser.username,
        allKeys: Object.keys(betterAuthUser),
      });

      // On desktop, feed the username (employee id) to the macOS updater so the
      // server can apply gray release. Guarded by getElectronIpc so it is a no-op on
      // web; errors are swallowed to never block user data sync.
      if (getElectronIpc() && betterAuthUser.username) {
        console.info('[UserUpdater] calling setUpdaterEmpCode with:', betterAuthUser.username);
        autoUpdateService.setUpdaterEmpCode(betterAuthUser.username).catch((err) => {
          console.error('[UserUpdater] setUpdaterEmpCode failed:', err);
        });
      } else if (getElectronIpc()) {
        console.warn(
          '[UserUpdater] desktop mode but username is empty, skipping setUpdaterEmpCode',
        );
      }
      return;
    }

    // Clear user data when session becomes unavailable
    useUserStore.setState({ user: undefined });
  }, [betterAuthUser]);

  return null;
});

export default UserUpdater;
