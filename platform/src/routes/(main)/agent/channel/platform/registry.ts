import type { ComponentType } from 'react';

import type { PlatformCredentialBodyProps } from './types';

/**
 * Platform-specific components that replace the auto-generated credential block
 * entirely (e.g. WeChat's QR auth flow). Empty here: Feishu / Lark both use the
 * default schema-driven credential form.
 */
export const platformCredentialBodyMap: Record<
  string,
  ComponentType<PlatformCredentialBodyProps>
> = {};

/**
 * Components rendered after the default credential block. Use this for small
 * platform-specific helpers that augment the auto-generated form without
 * replacing it. Empty here: Feishu / Lark need no extras.
 */
export const platformCredentialExtrasMap: Record<string, ComponentType> = {};
