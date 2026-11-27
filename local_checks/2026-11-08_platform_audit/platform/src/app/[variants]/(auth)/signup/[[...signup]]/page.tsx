import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { authEnv } from '@/envs/auth';
import { metadataModule } from '@/server/metadata';
import { translation } from '@/server/translation';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

import BetterAuthSignUpForm from './BetterAuthSignUpForm';

export const generateMetadata = async (props: DynamicLayoutProps) => {
  const locale = await RouteVariants.getLocale(props);
  const { t } = await translation('auth', locale);

  return metadataModule.generate({
    description: t('betterAuth.signup.subtitle'),
    title: t('betterAuth.signup.title'),
    url: '/signup',
  });
};

interface PageProps {
  searchParams?: Promise<{ 'email-login'?: string }>;
}

const Page = async ({ searchParams }: PageProps) => {
  if (authEnv.AUTH_DISABLE_EMAIL_PASSWORD) {
    const [cookieStore, resolvedSearch] = await Promise.all([cookies(), searchParams]);
    const hasUnlockCookie = cookieStore.get('el-unlock')?.value === '1';
    const hasUnlockQuery = resolvedSearch?.['email-login'] === '1';
    if (!hasUnlockCookie && !hasUnlockQuery) {
      redirect('/signin');
    }
  }

  return <BetterAuthSignUpForm />;
};

export default Page;
