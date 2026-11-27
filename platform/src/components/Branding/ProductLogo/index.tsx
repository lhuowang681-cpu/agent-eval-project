'use client';

import { type LobeChatProps, type LobeHubProps } from '@lobehub/ui/brand';
import { memo } from 'react';

import { customLogoProps, isCustomBranding } from '@/const/version';

import CustomLogo from './Custom';

interface ProductLogoProps extends LobeHubProps {
  height?: number;
  width?: number;
}

export const ProductLogo = memo<ProductLogoProps>((props) => {
  if (isCustomBranding) {
    return <CustomLogo {...(customLogoProps as LobeChatProps)} {...props} />;
  }

  return <span>TripYoYo</span>;
});
