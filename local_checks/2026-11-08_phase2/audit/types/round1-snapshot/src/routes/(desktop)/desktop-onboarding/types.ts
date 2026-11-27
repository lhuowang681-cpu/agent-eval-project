export enum DesktopOnboardingScreen {
  DataMode = 'data-mode',
  FeishuAuth = 'feishu-auth',
  Login = 'login',
  OpenCliInstall = 'opencli-install',
  Permissions = 'permissions',
  SystemToolsSetup = 'system-tools-setup',
  Welcome = 'welcome',
}

export const isDesktopOnboardingScreen = (value: unknown): value is DesktopOnboardingScreen => {
  if (typeof value !== 'string') return false;
  return (Object.values(DesktopOnboardingScreen) as string[]).includes(value);
};
