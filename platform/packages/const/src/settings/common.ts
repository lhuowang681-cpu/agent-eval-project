import type { UserGeneralConfig } from '@lobechat/types';

export const DEFAULT_COMMON_SETTINGS: UserGeneralConfig = {
  animationMode: 'agile',
  canaryIdc: 'LATEST',
  // contextMenuMode not set default value, use env to calc
  // enableCanary not set default value either, use env to calc (desktop DEFAULT_ENABLE_CANARY)
  fontSize: 14,
  highlighterTheme: 'lobe-theme',
  isDevMode: false,
  isLiteMode: false,
  mermaidTheme: 'lobe-theme',
  telemetry: true,
  transitionMode: 'fadeIn',
};
