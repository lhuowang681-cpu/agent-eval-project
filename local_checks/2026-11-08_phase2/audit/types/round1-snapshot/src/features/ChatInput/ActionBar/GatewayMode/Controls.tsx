import { Center, Flexbox, Icon, Tag } from '@lobehub/ui';
import { Alert, Divider } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Cloud, CloudOff, type LucideIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  header: css`
    padding-block: 4px;
    padding-inline: 8px;
  `,
  headerDesc: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextDescription};
  `,
  headerTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  icon: css`
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  option: css`
    cursor: pointer;

    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface ToggleOption {
  description: string;
  icon: LucideIcon;
  label: string;
  value: 'off' | 'on';
}

const useIsGatewayEnabled = (agentId: string) => {
  const disableGatewayMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).disableGatewayMode,
  );
  const defaultDisableGatewayMode = useUserStore(
    (s) => settingsSelectors.defaultAgentConfig(s).chatConfig?.disableGatewayMode,
  );
  // Default OFF: enabled only when explicitly turned on (`disableGatewayMode === false`).
  return (disableGatewayMode ?? defaultDisableGatewayMode) === false;
};

const ToggleItem = memo<ToggleOption>(({ value, description, icon, label }) => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const isEnabled = useIsGatewayEnabled(agentId);

  const isActive = value === 'on' ? isEnabled : !isEnabled;

  return (
    <Flexbox
      horizontal
      align={'flex-start'}
      className={cx(styles.option, isActive && styles.active)}
      gap={12}
      onClick={async () => {
        // value 'on' → gateway enabled → disableGatewayMode: false
        await updateAgentChatConfig({ disableGatewayMode: value !== 'on' });
      }}
    >
      <Center className={styles.icon} flex={'none'} height={32} width={32}>
        <Icon icon={icon} />
      </Center>
      <Flexbox flex={1}>
        <div className={styles.title}>{label}</div>
        <div className={styles.description}>{description}</div>
      </Flexbox>
    </Flexbox>
  );
});

ToggleItem.displayName = 'GatewayModeToggleItem';

const Controls = memo<{ forcedByTarget?: boolean }>(({ forcedByTarget }) => {
  const { t } = useTranslation('chat');

  const toggleOptions: ToggleOption[] = [
    {
      description: t('gatewayMode.on.desc'),
      icon: Cloud,
      label: t('gatewayMode.on.title'),
      value: 'on',
    },
    {
      description: t('gatewayMode.off.desc'),
      icon: CloudOff,
      label: t('gatewayMode.off.title'),
      value: 'off',
    },
  ];

  return (
    <Flexbox gap={4}>
      <Flexbox className={styles.header} gap={6}>
        <Flexbox horizontal align={'center'} gap={8}>
          {/* Brand name — same in every language, so no i18n (matches lobehub). */}
          <span className={styles.headerTitle}>Agent Gateway</span>
          <Tag color={'info'} size={'small'} variant={'filled'}>
            {t('gatewayMode.beta')}
          </Tag>
        </Flexbox>
        <div className={styles.headerDesc}>{t('gatewayMode.desc')}</div>
      </Flexbox>
      <Divider style={{ margin: 0 }} />
      {forcedByTarget ? (
        <Alert
          showIcon
          description={t('gatewayMode.forced.desc')}
          message={t('gatewayMode.forced.title')}
          style={{ margin: 4 }}
          type={'info'}
        />
      ) : (
        toggleOptions.map((option) => <ToggleItem {...option} key={option.value} />)
      )}
    </Flexbox>
  );
});

Controls.displayName = 'GatewayModeControls';

export default Controls;
