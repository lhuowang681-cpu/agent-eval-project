'use client';

import { Flexbox, Icon, Skeleton, Tooltip } from '@lobehub/ui';
import { message } from 'antd';
import { useTheme } from 'antd-style';
import { PaletteIcon } from 'lucide-react';
import { memo, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import BackgroundSwatches from '@/features/AgentSetting/AgentMeta/BackgroundSwatches';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

const DEFAULT_MAX_SIZE = 2 * 1024 * 1024;

export interface AvatarPickerProps {
  allowBackgroundColor?: boolean;
  avatar?: string;
  backgroundColor?: string;
  maxUploadSize?: number;
  onAvatarChange: (avatar?: string) => void;
  onBackgroundColorChange?: (color?: string) => void;
  onUpload: (file: File) => Promise<string | undefined>;
  shape?: 'square' | 'circle';
  size?: number;
}

const AvatarPicker = memo<AvatarPickerProps>(
  ({
    allowBackgroundColor,
    avatar,
    backgroundColor,
    maxUploadSize = DEFAULT_MAX_SIZE,
    onAvatarChange,
    onBackgroundColorChange,
    onUpload,
    shape = 'square',
    size = 72,
  }) => {
    const { t } = useTranslation(['setting', 'common']);
    const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
    const theme = useTheme();
    const [uploading, setUploading] = useState(false);

    const handleUpload = useCallback(
      async (file: File) => {
        if (file.size > maxUploadSize) {
          const mb = Math.round(maxUploadSize / 1024 / 1024);
          message.error(
            t('avatarPicker.sizeExceeded', { ns: 'common', size: mb }) as unknown as string,
          );
          return;
        }
        setUploading(true);
        try {
          const url = await onUpload(file);
          if (url) onAvatarChange(url);
        } finally {
          setUploading(false);
        }
      },
      [maxUploadSize, onUpload, onAvatarChange, t],
    );

    const handleDelete = useCallback(() => {
      onAvatarChange(undefined);
    }, [onAvatarChange]);

    const customTabs =
      allowBackgroundColor && onBackgroundColorChange
        ? [
            {
              label: (
                <Tooltip title={t('settingAgent.backgroundColor.title', { ns: 'setting' })}>
                  <Icon icon={PaletteIcon} size={{ size: 20, strokeWidth: 2.5 }} />
                </Tooltip>
              ),
              render: () => (
                <Flexbox padding={8} width={332}>
                  <Suspense
                    fallback={
                      <Flexbox gap={8}>
                        <Skeleton.Button block style={{ height: 38 }} />
                        <Skeleton.Button block style={{ height: 38 }} />
                      </Flexbox>
                    }
                  >
                    <BackgroundSwatches
                      gap={8}
                      shape={'square'}
                      size={38}
                      value={backgroundColor}
                      onChange={(c) => onBackgroundColorChange(c)}
                    />
                  </Suspense>
                </Flexbox>
              ),
              value: 'background',
            },
          ]
        : undefined;

    // @lobehub/ui 的 ThemeProvider 给 .ant-app 加了 isolation:isolate，创建了一个 stacking
    // context。Popover 默认把 portal 挂到 .ant-app 内的 data-lobe-portal-host（z-index:1100），
    // 而 antd Drawer/Modal 挂到 body 顶层（z-index:1000），从 body 视角看 .ant-app 是 auto，
    // Drawer 反而会盖住 popover。这里显式把 portal 提升到 body，绕开 .ant-app 的 stacking context。
    // lobehub 的 PopoverPortalProps 类型把 container 从 Base UI 原始 props 里 Omit 掉了，
    // 但 PopoverStandalone 运行时会通过 spread portalProps 覆盖默认 container，走 as any 即可。
    const portalProps = useMemo(
      () =>
        typeof document === 'undefined'
          ? undefined
          : ({ container: document.body } as unknown as Record<string, unknown>),
      [],
    );

    return (
      <EmojiPicker
        allowUpload
        allowDelete={!!avatar}
        customTabs={customTabs}
        loading={uploading}
        locale={locale}
        shape={shape}
        size={size}
        value={avatar}
        background={
          backgroundColor && backgroundColor !== 'rgba(0,0,0,0)' ? backgroundColor : undefined
        }
        popupProps={{
          placement: 'bottomLeft',
          portalProps: portalProps as any,
        }}
        popupStyle={{
          background: theme.colorBgElevated,
          border: `1px solid ${theme.colorBorderSecondary}`,
          borderRadius: 8,
          boxShadow: theme.boxShadowSecondary,
        }}
        onChange={onAvatarChange}
        onDelete={handleDelete}
        onUpload={handleUpload}
      />
    );
  },
);

AvatarPicker.displayName = 'AvatarPicker';

export default AvatarPicker;
