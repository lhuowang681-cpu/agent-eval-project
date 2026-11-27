import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { type PropsWithChildren } from 'react';

import { authEnv } from '@/envs/auth';

interface Props extends PropsWithChildren {
  searchParams?: Promise<{ 'email-login'?: string }>;
}

const ResetPasswordLayout = async ({ children, searchParams }: Props) => {
  if (authEnv.AUTH_DISABLE_EMAIL_PASSWORD) {
    const [cookieStore, resolvedSearch] = await Promise.all([cookies(), searchParams]);
    const hasUnlockCookie = cookieStore.get('el-unlock')?.value === '1';
    const hasUnlockQuery = resolvedSearch?.['email-login'] === '1';
    if (!hasUnlockCookie && !hasUnlockQuery) {
      redirect('/signin');
    }
  }

  return children;
};

export default ResetPasswordLayout;
