import { isDesktop } from '@lobechat/const';

import { CANARY_IDC_LATEST } from '@/const/canary';

import { type UserStore } from '../../../store';
import { currentSettings } from './settings';

const generalConfig = (s: UserStore) => currentSettings(s).general || {};

const neutralColor = (s: UserStore) => generalConfig(s).neutralColor;
const primaryColor = (s: UserStore) => generalConfig(s).primaryColor;
const fontSize = (s: UserStore) => generalConfig(s).fontSize;
const highlighterTheme = (s: UserStore) => generalConfig(s).highlighterTheme;
const mermaidTheme = (s: UserStore) => generalConfig(s).mermaidTheme;
const transitionMode = (s: UserStore) => generalConfig(s).transitionMode;
const animationMode = (s: UserStore) => generalConfig(s).animationMode;
const contextMenuMode = (s: UserStore) => {
  const config = generalConfig(s).contextMenuMode;
  if (config !== undefined) return config;
  return isDesktop ? 'default' : 'disabled';
};
const responseLanguage = (s: UserStore) => generalConfig(s).responseLanguage;
const telemetry = (s: UserStore) => generalConfig(s).telemetry;
const enableAutoScrollOnStreaming = (s: UserStore) =>
  generalConfig(s).enableAutoScrollOnStreaming ?? true;
/**
 * Desktop builds can ship with the bastion (canary) switch defaulted to on via
 * `DEFAULT_ENABLE_CANARY` (baked into `window.lobeEnv` by the preload at build
 * time, see apps/desktop/.env.desktop.*). Falls back to off everywhere else.
 */
const defaultEnableCanary = () =>
  (typeof window !== 'undefined' && window.lobeEnv?.defaultEnableCanary) || false;

const enableCanary = (s: UserStore) => generalConfig(s).enableCanary ?? defaultEnableCanary();
const canaryIdc = (s: UserStore) => generalConfig(s).canaryIdc || CANARY_IDC_LATEST;

export const userGeneralSettingsSelectors = {
  animationMode,
  canaryIdc,
  config: generalConfig,
  contextMenuMode,
  enableAutoScrollOnStreaming,
  enableCanary,
  fontSize,
  highlighterTheme,
  mermaidTheme,
  neutralColor,
  primaryColor,
  responseLanguage,
  telemetry,
  transitionMode,
};
