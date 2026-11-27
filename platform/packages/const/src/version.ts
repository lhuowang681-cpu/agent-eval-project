import { BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';

import pkg from '../../../package.json';

export const CURRENT_VERSION = pkg.version;

export const isDesktop = typeof __ELECTRON__ !== 'undefined' && !!__ELECTRON__;

// @ts-ignore
export const isCustomBranding = BRANDING_NAME !== 'TripYoYo';
// @ts-ignore
export const isCustomORG = ORG_NAME !== 'TripYoYo';
// 自定义Logo props
export const customLogoProps = {
  type: 'text',
  size: 32,
};
