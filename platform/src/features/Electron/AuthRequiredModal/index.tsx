'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { memo, useCallback, useEffect } from 'react';

import { desktopAuthEvents } from '@/layout/AuthProvider/Desktop/events';
import { navigateToDesktopOnboarding } from '@/routes/(desktop)/desktop-onboarding/navigation';
import { getDesktopOnboardingCompleted } from '@/routes/(desktop)/desktop-onboarding/storage';
import { DesktopOnboardingScreen } from '@/routes/(desktop)/desktop-onboarding/types';
import { useElectronStore } from '@/store/electron';

/**
 * Listens for "auth required" signals (expired OIDC token / 401) and redirects
 * the user to the onboarding login screen instead of showing a modal.
 *
 * Desktop has no web `/signin` route — sign-in is the OIDC browser flow driven
 * by `LoginStep` at `/desktop-onboarding?screen=login`, which on success calls
 * `window.location.replace('/')` to return to the app.
 *
 * Three trigger sources converge here:
 *   1. Main-process IPC `authorizationRequired` — fired by `AuthCtr` when token
 *      refresh fails on startup, or when the backend sets `X-Auth-Required`.
 *   2. Renderer event `session-expired` — fired by the lambda tRPC error link
 *      (`src/libs/trpc/client/lambda.ts`) and `StoreInitialization` on a 401.
 *   3. Force-login gate — onboarding completed but `active === false` (e.g. user
 *      disconnected the remote server). Previously a non-dismissible modal.
 */
const AuthRequiredModal = memo(() => {
  const [dataSyncConfig, isInitRemoteServerConfig] = useElectronStore((s) => [
    s.dataSyncConfig,
    s.isInitRemoteServerConfig,
  ]);

  const handleAuthRequired = useCallback(async () => {
    // Don't interrupt the user if they're already in the connect/login drawer.
    if (useElectronStore.getState().isConnectionDrawerOpen) return;

    // Already on the onboarding route — don't redirect again (prevents a
    // refresh loop when the login page itself triggers more 401s).
    if (location.pathname.startsWith('/desktop-onboarding')) return;

    // Only handle the session-expired case here: `active === true` means the
    // user has a configured remote server whose token just went invalid. The
    // `active === false` case (never configured, or disconnected) is handled
    // by the force-login gate below, so a first-run user is NOT yanked out of
    // the normal onboarding flow (welcome → permissions → feishu-auth → login).
    if (!useElectronStore.getState().dataSyncConfig?.active) return;

    // The main process only clears the token and intentionally keeps
    // `active === true`. LoginStep treats `active` as "signed in", so it would
    // falsely show the success state and sending the user back to the app
    // would 401 again → redirect loop. Deactivate first (merged write
    // preserves remoteServerUrl / storageMode).
    await useElectronStore.getState().deactivateRemoteServer();

    navigateToDesktopOnboarding(DesktopOnboardingScreen.Login);
  }, []);

  // Main-process trigger.
  useWatchBroadcast('authorizationRequired', handleAuthRequired);

  // Renderer-side trigger: a lambda tRPC call returned 401 (token expired).
  // Also consume a flag set before this component mounted (e.g. a 401 during
  // the initial getUserState load) so we don't miss the first expiry.
  useEffect(() => {
    if (desktopAuthEvents.consumePending()) {
      void handleAuthRequired();
    }
    return desktopAuthEvents.on('session-expired', () => {
      void handleAuthRequired();
    });
  }, [handleAuthRequired]);

  // Force-login gate: onboarding already completed but `active === false`
  // (e.g. the user disconnected the remote server). Send the user to the
  // login screen instead of blocking with a non-dismissible modal. This path
  // navigates directly (no deactivate — `active` is already false), so it
  // doesn't go through `handleAuthRequired` (which returns on `!active`).
  useEffect(() => {
    if (!isInitRemoteServerConfig) return;
    if (dataSyncConfig?.active) return;
    if (!getDesktopOnboardingCompleted()) return;
    if (useElectronStore.getState().isConnectionDrawerOpen) return;
    if (location.pathname.startsWith('/desktop-onboarding')) return;

    navigateToDesktopOnboarding(DesktopOnboardingScreen.Login);
  }, [dataSyncConfig?.active, isInitRemoteServerConfig]);

  return null;
});

AuthRequiredModal.displayName = 'AuthRequiredModal';

export default AuthRequiredModal;
