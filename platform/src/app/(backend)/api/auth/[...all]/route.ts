import { toNextJsHandler } from 'better-auth/next-js';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { authEnv } from '@/envs/auth';

const handler = toNextJsHandler(auth);

// Email/password endpoints that must be gated when `AUTH_DISABLE_EMAIL_PASSWORD=1`.
// Internal users bypass the gate via the `el-unlock` cookie set from `/signin?email-login=1`.
const EMAIL_PASSWORD_GATED_PATHS = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
]);

const isEmailPasswordBlocked = (req: NextRequest): boolean => {
  if (!authEnv.AUTH_DISABLE_EMAIL_PASSWORD) return false;
  const { pathname } = new URL(req.url);
  if (!EMAIL_PASSWORD_GATED_PATHS.has(pathname)) return false;
  return req.cookies.get('el-unlock')?.value !== '1';
};

export const GET = async (req: NextRequest) => {
  return handler.GET(req);
};

export const POST = async (req: NextRequest) => {
  if (isEmailPasswordBlocked(req)) {
    return NextResponse.json(
      { message: 'Email/password authentication is disabled.' },
      { status: 403 },
    );
  }
  return handler.POST(req);
};
