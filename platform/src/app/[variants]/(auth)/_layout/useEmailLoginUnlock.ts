'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const COOKIE_NAME = 'el-unlock';
const COOKIE_MAX_AGE_SECONDS = 3600;

const readUnlockCookie = () =>
  document.cookie.split(';').some((entry) => entry.trim() === `${COOKIE_NAME}=1`);

/**
 * When `AUTH_DISABLE_EMAIL_PASSWORD=1` is set on the server, email/password
 * endpoints are gated by an `el-unlock` cookie. Internal users unlock them by
 * visiting any auth page with `?email-login=1` — this hook lifts that URL
 * parameter into a 1-hour cookie so subsequent form submissions pass the gate.
 */
export const useEmailLoginUnlock = () => {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('email-login') !== '1') return;
    if (readUnlockCookie()) return;
    document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  }, [searchParams]);
};
