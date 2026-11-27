'use client';

import { useEffect, useRef, useState } from 'react';

import { DOCUMENT_LOCK_HEARTBEAT_MS } from '@/const/documentLock';

export type EditLockHealth = 'healthy' | 'unstable' | 'lost';

export interface EditLockState {
  expiresAt?: Date | string | null;
  holderId: string | null;
  lockedByOther: boolean;
  ownerId?: string | null;
}

export interface EditLockResult extends EditLockState {
  health: EditLockHealth;
  pending: boolean;
}

export interface EditLockClient {
  acquire: (id: string, ownerId?: string) => Promise<EditLockState>;
  peek: (id: string, ownerId?: string) => Promise<EditLockState>;
  release: (id: string, ownerId?: string) => Promise<void>;
}

interface UseEditLockOptions {
  client: EditLockClient;
  enabled: boolean;
  isDirty: boolean;
  ownerId?: string;
  pollWhileViewing?: boolean;
  resourceId: string | undefined;
}

const UNLOCKED: EditLockState = { holderId: null, lockedByOther: false };
const LOCK_REFRESH_SAFETY_MS = 8000;
const LOCK_RETRY_BACKOFF_MS = 500;
const VIEWER_FALLBACK_POLL_MS = 60_000;

const nextRefreshDelay = (expiresAt: EditLockState['expiresAt']) => {
  if (!expiresAt) return DOCUMENT_LOCK_HEARTBEAT_MS;

  const expiresAtTime =
    expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtTime)) return DOCUMENT_LOCK_HEARTBEAT_MS;

  return Math.max(1000, expiresAtTime - Date.now() - LOCK_REFRESH_SAFETY_MS);
};

export const useEditLock = ({
  client,
  enabled,
  isDirty,
  ownerId,
  pollWhileViewing = true,
  resourceId,
}: UseEditLockOptions): EditLockResult => {
  const [state, setState] = useState<EditLockState>(UNLOCKED);
  const [editIntent, setEditIntent] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [health, setHealth] = useState<EditLockHealth>('healthy');

  const idRef = useRef(resourceId);
  if (idRef.current !== resourceId) {
    idRef.current = resourceId;
    setEditIntent(false);
    setState(UNLOCKED);
    setResolved(false);
    setHealth('healthy');
  }

  useEffect(() => {
    if (enabled && isDirty) setEditIntent(true);
  }, [enabled, isDirty]);

  const active = Boolean(enabled && resourceId);
  const engaged = active && editIntent;

  useEffect(() => {
    if (!active || !resourceId || editIntent) return;

    let cancelled = false;
    const tick = () => {
      client
        .peek(resourceId, ownerId)
        .then((s) => {
          if (cancelled) return;
          setState(s);
          setResolved(true);
        })
        .catch(() => {
          if (!cancelled) setResolved(true);
        });
    };

    tick();
    const interval = pollWhileViewing ? DOCUMENT_LOCK_HEARTBEAT_MS : VIEWER_FALLBACK_POLL_MS;
    const timer = setInterval(tick, interval);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, resourceId, editIntent, client, ownerId, pollWhileViewing]);

  useEffect(() => {
    if (!engaged || !resourceId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failureStreak = 0;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(tick, delay);
    };

    const onSuccess = (s: EditLockState) => {
      if (cancelled) return;
      setState(s);
      setResolved(true);
      if (s.lockedByOther) {
        failureStreak += 1;
        setHealth('lost');
        schedule(DOCUMENT_LOCK_HEARTBEAT_MS);
        return;
      }

      failureStreak = 0;
      setHealth('healthy');
      schedule(nextRefreshDelay(s.expiresAt));
    };

    const onFailure = () => {
      if (cancelled) return;
      setResolved(true);
      failureStreak += 1;
      if (failureStreak === 1) {
        setHealth('unstable');
        schedule(LOCK_RETRY_BACKOFF_MS);
        return;
      }

      setHealth('lost');
      schedule(DOCUMENT_LOCK_HEARTBEAT_MS);
    };

    const tick = () => {
      timer = undefined;
      client.acquire(resourceId, ownerId).then(onSuccess).catch(onFailure);
    };

    tick();

    const refresh = () => {
      if (cancelled) return;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      tick();
    };

    let released = false;
    const releaseOnce = () => {
      if (released || cancelled) return;
      released = true;
      client.release(resourceId, ownerId).catch(() => {});
    };

    const supportsWindow = typeof window !== 'undefined';
    if (supportsWindow) {
      window.addEventListener('online', refresh);
      window.addEventListener('focus', refresh);
      window.addEventListener('pagehide', releaseOnce);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (supportsWindow) {
        window.removeEventListener('online', refresh);
        window.removeEventListener('focus', refresh);
        window.removeEventListener('pagehide', releaseOnce);
      }
      setState(UNLOCKED);
      setHealth('healthy');
      if (!released) {
        released = true;
        client.release(resourceId, ownerId).catch(() => {});
      }
    };
  }, [engaged, resourceId, client, ownerId]);

  return { ...state, health, pending: active && !resolved };
};
