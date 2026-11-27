import { nonUninstallableBuiltinToolIds } from '@lobechat/builtin-tools';
import {
  isDesktop,
  KLAVIS_SERVER_TYPES,
  LOBEHUB_SKILL_PROVIDERS,
  RECOMMENDED_SKILLS,
  RecommendedSkillType,
} from '@lobechat/const';
import { type ItemType } from '@lobehub/ui';
import { Avatar, Icon, Popover, SearchBar, stopPropagation, Tag, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Switch } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pin,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import KlavisServerItem from './KlavisServerItem';
import KlavisSkillIcon from './KlavisSkillIcon';
import LobehubSkillIcon from './LobehubSkillIcon';
import LobehubSkillServerItem from './LobehubSkillServerItem';
import ToolItemDetailPopover from './ToolItemDetailPopover';

const SKILL_ICON_SIZE = 20;
const CLOSE_TOOL_DETAIL_POPOVER_EVENT = 'lobe-chat-tool-detail-popover-close';

/**
 * Non-uninstallable builtin skills that should be pinned-on by default for
 * every agent: Artifacts on all platforms, plus the environment-appropriate
 * Feishu skill (lobe-feishu-cli on desktop, builtin-feishu-mcp on web).
 */
const DEFAULT_PINNED_SKILL_IDS = [
  'lobe-artifacts',
  isDesktop ? 'lobe-feishu-cli' : 'builtin-feishu-mcp',
];

const officialTag = (
  <Tooltip placement={'top'} title={'TripYoYo'}>
    <Tag color={'success'} icon={<Icon icon={BadgeCheck} />} size={'small'} />
  </Tooltip>
);

type SkillPolicyMode = 'auto' | 'pinned';

interface SkillDeleteConfig {
  displayName: string;
  onDelete: () => Promise<void> | void;
}

interface SkillConfigureConfig {
  onConfigure: () => void;
}

type SkillMenuItem = NonNullable<ItemType> & {
  extra?: ReactNode;
  popoverContent?: ReactNode;
  searchText?: string;
};

const styles = createStaticStyles(({ css }) => ({
  activationGroupHeader: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
    padding-block: 4px;
  `,
  activationGroupChevron: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;

    color: ${cssVar.colorTextTertiary};
  `,
  activationGroupTitle: css`
    display: flex;
    gap: 7px;
    align-items: center;

    min-width: 0;
    min-height: 18px;
  `,
  activationGroupTitleBlock: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
  activationGroupTitleText: css`
    overflow: hidden;

    min-width: 0;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  count: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  activationGroupActions: css`
    display: flex;
    flex: none;
    gap: 8px;
    align-items: center;
  `,
  switchWrap: css`
    display: inline-flex;
    flex: none;
    align-items: center;
  `,
  iconAuto: css`
    color: ${cssVar.colorInfo};
  `,
  iconDefault: css`
    color: ${cssVar.colorTextTertiary};
  `,
  iconPinned: css`
    color: ${cssVar.colorInfo};
  `,
  fixedIndicator: css`
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;

    color: ${cssVar.colorTextQuaternary};
  `,
  policyButton: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
      background: transparent;
    }
  `,
  deleteButton: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 36px;
    padding-block: 8px;
    padding-inline: 10px;
    border: 0;
    border-radius: 6px;

    font-size: 14px;
    line-height: 20px;
    color: ${cssVar.colorError};

    background: transparent;

    transition: background 150ms ${cssVar.motionEaseOut};

    &:hover {
      background: ${cssVar.colorErrorBg};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
      background: transparent;
    }
  `,
  deleteDivider: css`
    height: 1px;
    margin-block: 2px;
    margin-inline: 4px;
    background: ${cssVar.colorBorderSecondary};
  `,
  deleteIcon: css`
    color: ${cssVar.colorError};
  `,
  policyCheck: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;

    color: ${cssVar.colorInfo};
  `,
  policyItem: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 36px;
    padding-block: 8px;
    padding-inline: 10px;
    border: 0;
    border-radius: 6px;

    font-size: 14px;
    line-height: 20px;
    color: ${cssVar.colorText};

    background: transparent;

    transition: background 150ms ${cssVar.motionEaseOut};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
      background: transparent;
    }
  `,
  policyItemIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
  `,
  policyPanel: css`
    min-width: 132px;
    padding: 4px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 0 15px 0 #00000008,
      0 2px 30px 0 #00000014;
  `,
  policyText: css`
    flex: 1;
    text-align: start;
  `,
  toolLabel: css`
    display: flex;
    flex: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  toolLabelText: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  toolRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
  `,
  toolTrailing: css`
    display: inline-flex;
    flex: none;
    gap: 8px;
    align-items: center;
  `,
  typeTag: css`
    display: inline-flex;
    flex: none;
    align-items: center;

    padding-block: 1px;
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

export const useControls = ({ setUpdating }: { setUpdating: (updating: boolean) => void }) => {
  const { t } = useTranslation('setting');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [autoOpen, setAutoOpen] = useState(true);
  const [policyOpenId, setPolicyOpenId] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [autoModeLoading, setAutoModeLoading] = useState(false);

  // This project does not gate skill editing behind a permission, so the
  // popover actions are always enabled.
  const canEdit = true;

  // 'manual' = hide auto (non-pinned) skills from the LLM; the switch on the
  // auto group toggles this. Pinned + fixed skills stay active either way.
  const isManualSkillMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s) === 'manual',
  );
  const isAutoSkillMode = !isManualSkillMode;

  const list = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const [uninstallPlugin, deleteAgentSkill, uninstallBuiltinTool] = useToolStore((s) => [
    s.uninstallPlugin,
    s.deleteAgentSkill,
    s.uninstallBuiltinTool,
  ]);
  const [checked, togglePlugin] = useAgentStore((s) => [
    agentByIdSelectors.getAgentPluginsById(agentId)(s),
    s.togglePlugin,
  ]);
  const checkedSet = useMemo(() => new Set(checked), [checked]);
  const builtinList = useToolStore(builtinToolSelectors.metaList, isEqual);
  const plugins = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));

  // One-time backfill: ensure non-uninstallable builtin skills (Artifacts +
  // the environment-appropriate Feishu skill) are pinned on by default for
  // existing agents whose plugins[] predates this default. togglePlugin
  // persists the change to the DB, so the backfill does not re-run on later
  // sessions. A sessionStorage guard prevents re-triggering within the same
  // session after the user explicitly toggles one of these skills to "auto".
  useEffect(() => {
    if (!agentId) return;
    const tag = `lobe-skill-default-pinned-${agentId}`;
    try {
      if (sessionStorage.getItem(tag)) return;
    } catch {
      return;
    }
    const missing = DEFAULT_PINNED_SKILL_IDS.filter((id) => !checkedSet.has(id));
    if (missing.length === 0) return;
    try {
      sessionStorage.setItem(tag, '1');
    } catch {
      /* ignore storage failures (e.g. private mode) */
    }
    setUpdating(true);
    Promise.all(missing.map((id) => togglePlugin(id, true))).finally(() => {
      setUpdating(false);
    });
  }, [agentId, checkedSet, togglePlugin, setUpdating]);

  // Application-fixed tools (always-on, read-only, non-uninstallable) —
  // lobe-activator / lobe-skills / lobe-skill-store. Rendered at the top of
  // the Pinned section with a fixed indicator, no policy menu, no uninstall.
  const fixedDisplayList = useToolStore(
    builtinToolSelectors.fixedDisplayMetaList({ isManualMode: false }),
    isEqual,
  );

  // Klavis-related state
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const isKlavisEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableKlavis);

  // TripYoYo Skill related state
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

  // Agent Skills related state
  const installedBuiltinSkills = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);
  const allMarketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const allUserAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
  const marketAgentSkills = useMemo(
    () => allMarketAgentSkills.filter(agentSkillsSelectors.isWebAvailableSkill),
    [allMarketAgentSkills],
  );
  const userAgentSkills = useMemo(
    () => allUserAgentSkills.filter(agentSkillsSelectors.isWebAvailableSkill),
    [allUserAgentSkills],
  );

  const [
    useFetchPluginStore,
    useFetchUserKlavisServers,
    useFetchLobehubSkillConnections,
    useFetchUninstalledBuiltinTools,
    useFetchAgentSkills,
  ] = useToolStore((s) => [
    s.useFetchPluginStore,
    s.useFetchUserKlavisServers,
    s.useFetchLobehubSkillConnections,
    s.useFetchUninstalledBuiltinTools,
    s.useFetchAgentSkills,
  ]);

  useFetchPluginStore();
  useFetchInstalledPlugins();
  useFetchUninstalledBuiltinTools(true);
  useFetchAgentSkills(true);
  useCheckPluginsIsInstalled(plugins);

  // Load user's Klavis integrations via SWR (from database)
  useFetchUserKlavisServers(isKlavisEnabledInEnv);

  // Load user's TripYoYo Skill connections via SWR
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);

  // Get connected server by identifier
  const getServerByName = (identifier: string) => {
    return allKlavisServers.find((server) => server.identifier === identifier);
  };

  // Get all Klavis server type identifier sets (used for filtering builtinList)
  const allKlavisTypeIdentifiers = useMemo(
    () => new Set(KLAVIS_SERVER_TYPES.map((type) => type.identifier)),
    [],
  );
  // Get all skill identifier sets (used for filtering builtinList)
  const allSkillIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    for (const s of installedBuiltinSkills) ids.add(s.identifier);
    for (const s of marketAgentSkills) ids.add(s.identifier);
    for (const s of userAgentSkills) ids.add(s.identifier);
    return ids;
  }, [installedBuiltinSkills, marketAgentSkills, userAgentSkills]);

  // Filter out Klavis tools and skills from builtinList (they will be displayed separately)
  const filteredBuiltinList = useMemo(() => {
    let list = builtinList;
    if (isKlavisEnabledInEnv) {
      list = list.filter((item) => !allKlavisTypeIdentifiers.has(item.identifier));
    }
    return list.filter((item) => !allSkillIdentifiers.has(item.identifier));
  }, [builtinList, allKlavisTypeIdentifiers, isKlavisEnabledInEnv, allSkillIdentifiers]);

  // Get recommended Klavis skill IDs
  const recommendedKlavisIds = useMemo(
    () =>
      new Set(
        RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Klavis).map((s) => s.id),
      ),
    [],
  );

  // Get recommended Lobehub skill IDs
  const recommendedLobehubIds = useMemo(
    () =>
      new Set(
        RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Lobehub).map((s) => s.id),
      ),
    [],
  );

  // Get installed Klavis server IDs
  const installedKlavisIds = useMemo(
    () => new Set(allKlavisServers.map((s) => s.identifier)),
    [allKlavisServers],
  );

  // Get installed Lobehub skill IDs
  const installedLobehubIds = useMemo(
    () => new Set(allLobehubSkillServers.map((s) => s.identifier)),
    [allLobehubSkillServers],
  );

  const updateSkillPolicy = useCallback(
    async (id: string, mode: SkillPolicyMode) => {
      if (!canEdit) return;
      const shouldPin = mode === 'pinned';
      if (checkedSet.has(id) === shouldPin) return;

      setUpdating(true);
      try {
        await togglePlugin(id, shouldPin);
      } finally {
        setUpdating(false);
      }
    },
    [canEdit, checkedSet, togglePlugin, setUpdating],
  );

  const openSkillPolicyMenu = useCallback((id: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(CLOSE_TOOL_DETAIL_POPOVER_EVENT));
    }
    setPolicyOpenId(id);
  }, []);

  const renderPolicyMenu = useCallback(
    (id: string, deleteConfig?: SkillDeleteConfig, configureConfig?: SkillConfigureConfig) => {
      const mode: SkillPolicyMode = checkedSet.has(id) ? 'pinned' : 'auto';
      const renderCheck = (value: SkillPolicyMode) =>
        mode === value ? (
          <span className={cx(styles.policyCheck)}>
            <Icon icon={Check} size={14} />
          </span>
        ) : (
          <span className={cx(styles.policyCheck)} />
        );

      const renderPolicyItem = (value: SkillPolicyMode, icon: ReactNode) => (
        <button
          className={cx(styles.policyItem)}
          disabled={!canEdit}
          type="button"
          onClick={async (event) => {
            event.stopPropagation();
            if (!canEdit) return;
            setPolicyOpenId(null);
            await updateSkillPolicy(id, value);
          }}
        >
          <span className={cx(styles.policyItemIcon)}>{icon}</span>
          <span className={cx(styles.policyText)}>{t(`tools.activation.${value}`)}</span>
          {renderCheck(value)}
        </button>
      );

      const content = (
        <div
          className={cx(styles.policyPanel)}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {renderPolicyItem(
            'pinned',
            <Icon
              className={cx(mode === 'pinned' ? styles.iconPinned : styles.iconDefault)}
              icon={Pin}
              size={15}
            />,
          )}
          {renderPolicyItem(
            'auto',
            <Icon
              className={cx(mode === 'auto' ? styles.iconAuto : styles.iconDefault)}
              icon={Zap}
              size={15}
            />,
          )}
          {(configureConfig || deleteConfig) && <div className={cx(styles.deleteDivider)} />}
          {configureConfig && (
            <button
              className={cx(styles.policyItem)}
              disabled={!canEdit}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!canEdit) return;
                setPolicyOpenId(null);
                configureConfig.onConfigure();
              }}
            >
              <span className={cx(styles.policyItemIcon)}>
                <Icon icon={Wrench} size={15} />
              </span>
              <span className={cx(styles.policyText)}>{t('tools.builtins.configure')}</span>
            </button>
          )}
          {deleteConfig && (
            <button
              className={cx(styles.deleteButton)}
              disabled={!canEdit}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!canEdit) return;
                setPolicyOpenId(null);
                confirmModal({
                  content: t('tools.builtins.uninstallConfirm.desc', {
                    name: deleteConfig.displayName,
                  }),
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    await deleteConfig.onDelete();
                  },
                  title: t('tools.builtins.uninstallConfirm.title', {
                    name: deleteConfig.displayName,
                  }),
                });
              }}
            >
              <span className={cx(styles.policyItemIcon)}>
                <Icon className={cx(styles.deleteIcon)} icon={Trash2} size={15} />
              </span>
              <span className={cx(styles.policyText)}>{t('tools.builtins.uninstall')}</span>
            </button>
          )}
        </div>
      );

      return (
        <Popover
          arrow={false}
          content={content}
          open={policyOpenId === id}
          placement="rightTop"
          positionerProps={{ sideOffset: 8 }}
          styles={{ content: { padding: 0 } }}
          trigger="click"
          onOpenChange={(open) => (open ? openSkillPolicyMenu(id) : setPolicyOpenId(null))}
        >
          <button
            aria-label={t('tools.skillActivateMode.title')}
            className={cx(styles.policyButton)}
            disabled={!canEdit}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event(CLOSE_TOOL_DETAIL_POPOVER_EVENT));
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openSkillPolicyMenu(id);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event(CLOSE_TOOL_DETAIL_POPOVER_EVENT));
              }
            }}
            onPointerEnter={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event(CLOSE_TOOL_DETAIL_POPOVER_EVENT));
              }
            }}
          >
            <Icon icon={MoreHorizontal} size={15} />
          </button>
        </Popover>
      );
    },
    [canEdit, checkedSet, openSkillPolicyMenu, policyOpenId, t, updateSkillPolicy],
  );

  const renderToolLabel = useCallback(
    (
      id: string,
      label: ReactNode,
      action: ReactNode,
      badge?: ReactNode,
      icon?: ReactNode,
      extraTag?: ReactNode,
    ) => (
      <span
        className={cx(styles.toolRow)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openSkillPolicyMenu(id);
        }}
      >
        <span className={cx(styles.toolLabel)}>
          {icon}
          <span className={cx(styles.toolLabelText)}>{label}</span>
          {extraTag}
        </span>
        <span className={cx(styles.toolTrailing)}>
          {badge && <span className={cx(styles.typeTag)}>{badge}</span>}
          {action}
        </span>
      </span>
    ),
    [openSkillPolicyMenu],
  );

  const createManagedSkillItem = useCallback(
    ({
      badge,
      configureConfig,
      deleteConfig,
      extraTag,
      icon,
      id,
      popoverContent,
      searchText,
      title,
    }: {
      badge?: ReactNode;
      configureConfig?: SkillConfigureConfig;
      deleteConfig?: SkillDeleteConfig;
      extraTag?: ReactNode;
      icon: ReactNode;
      id: string;
      popoverContent?: ReactNode;
      searchText?: string;
      title: ReactNode;
    }): SkillMenuItem =>
      ({
        closeOnClick: false,
        key: id,
        label: renderToolLabel(
          id,
          title,
          renderPolicyMenu(id, deleteConfig, configureConfig),
          badge,
          icon,
          extraTag,
        ),
        popoverContent,
        searchText: searchText || String(title || id),
      }) as SkillMenuItem,
    [renderPolicyMenu, renderToolLabel],
  );

  // Builtin tool list items (excluding Klavis and TripYoYo Skill).
  // Builtin MCPs that ship as first-class non-removable skills (e.g. Feishu MCP)
  // are not given a deleteConfig, so they can be toggled pinned/auto but not
  // uninstalled. Other builtin tools remain uninstallable.
  const builtinItems = useMemo(
    () =>
      filteredBuiltinList.map((item) => {
        const title = t(`tools.builtins.${item.identifier}.title` as any, {
          defaultValue: item.meta?.title || item.identifier,
        });
        const icon = item.meta?.avatar ? (
          <Avatar avatar={item.meta.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        );
        const popoverContent = (
          <ToolItemDetailPopover
            identifier={item.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            title={title}
            description={t(`tools.builtins.${item.identifier}.description` as any, {
              defaultValue: item.meta?.description || '',
            })}
            icon={
              item.meta?.avatar ? (
                <Avatar
                  avatar={item.meta.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
          />
        );

        const isNonUninstallable = nonUninstallableBuiltinToolIds.includes(item.identifier);

        return createManagedSkillItem({
          badge: <Icon icon={Wrench} size={12} />,
          deleteConfig: isNonUninstallable
            ? undefined
            : {
                displayName: title,
                onDelete: () => uninstallBuiltinTool(item.identifier),
              },
          extraTag: officialTag,
          icon,
          id: item.identifier,
          popoverContent,
          searchText: `${title} ${item.identifier}`,
          title,
        });
      }),
    [filteredBuiltinList, t, createManagedSkillItem, uninstallBuiltinTool],
  );

  // Application-fixed tool items (read-only). Always-on tools owned by the
  // runtime (lobe-activator / lobe-skills / lobe-skill-store), so they get a
  // fixed indicator instead of the policy menu and can't be switched to "auto"
  // or uninstalled.
  const fixedItems = useMemo(
    () =>
      fixedDisplayList.map((item) => {
        const title = t(`tools.builtins.${item.identifier}.title` as any, {
          defaultValue: item.meta?.title || item.identifier,
        });
        const icon = item.meta?.avatar ? (
          <Avatar avatar={item.meta.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        );
        const popoverContent = (
          <ToolItemDetailPopover
            identifier={item.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            title={title}
            description={t(`tools.builtins.${item.identifier}.description` as any, {
              defaultValue: item.meta?.description || '',
            })}
            icon={
              item.meta?.avatar ? (
                <Avatar
                  avatar={item.meta.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
          />
        );

        return {
          closeOnClick: false,
          key: item.identifier,
          label: (
            <span className={cx(styles.toolRow)}>
              <span className={cx(styles.toolLabel)}>
                {icon}
                <span className={cx(styles.toolLabelText)}>{title}</span>
                {officialTag}
              </span>
              <span className={cx(styles.toolTrailing)}>
                <span className={cx(styles.typeTag)}>
                  <Icon icon={Wrench} size={12} />
                </span>
                <Tooltip placement={'top'} title={t('tools.activation.fixed.hint')}>
                  <span className={cx(styles.fixedIndicator)}>
                    <Icon icon={Pin} size={15} />
                  </span>
                </Tooltip>
              </span>
            </span>
          ),
          popoverContent,
          searchText: `${title} ${item.identifier}`,
        } as SkillMenuItem;
      }),
    [fixedDisplayList, t],
  );

  // Builtin Agent Skills list items (grouped under TripYoYo).
  // All builtin skills (Artifacts, Feishu CLI, etc.) are non-uninstallable —
  // they can be toggled pinned/auto but not removed.
  const builtinAgentSkillItems = useMemo(
    () =>
      installedBuiltinSkills.map((skill) => {
        const title = t(`tools.builtins.${skill.identifier}.title` as any, {
          defaultValue: skill.name,
        });
        const icon = skill.avatar ? (
          <Avatar avatar={skill.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        );
        const popoverContent = (
          <ToolItemDetailPopover
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            title={title}
            description={t(`tools.builtins.${skill.identifier}.description` as any, {
              defaultValue: skill.description,
            })}
            icon={
              skill.avatar ? (
                <Avatar
                  avatar={skill.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={SkillsIcon} size={12} />,
          extraTag: officialTag,
          icon,
          id: skill.identifier,
          popoverContent,
          searchText: `${title} ${skill.identifier}`,
          title,
        });
      }),
    [installedBuiltinSkills, t, createManagedSkillItem],
  );

  // Market Agent Skills list items (grouped under Community) — uninstallable
  const marketAgentSkillItems = useMemo(
    () =>
      marketAgentSkills.map((skill) => {
        const icon = <Avatar avatar={'🧩'} shape={'square'} size={SKILL_ICON_SIZE} />;
        const popoverContent = (
          <ToolItemDetailPopover
            description={skill.description}
            icon={<Avatar avatar={'🧩'} shape={'square'} size={36} />}
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.community')}
            title={skill.name}
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={SkillsIcon} size={12} />,
          deleteConfig: {
            displayName: skill.name,
            onDelete: () => deleteAgentSkill(skill.id),
          },
          icon,
          id: skill.identifier,
          popoverContent,
          searchText: `${skill.name} ${skill.identifier}`,
          title: skill.name,
        });
      }),
    [marketAgentSkills, t, createManagedSkillItem, deleteAgentSkill],
  );

  // User Agent Skills list items (grouped under Custom) — uninstallable
  const userAgentSkillItems = useMemo(
    () =>
      userAgentSkills.map((skill) => {
        const icon = <Avatar avatar={'🧩'} shape={'square'} size={SKILL_ICON_SIZE} />;
        const popoverContent = (
          <ToolItemDetailPopover
            description={skill.description}
            icon={<Avatar avatar={'🧩'} shape={'square'} size={36} />}
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.custom')}
            title={skill.name}
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={SkillsIcon} size={12} />,
          deleteConfig: {
            displayName: skill.name,
            onDelete: () => deleteAgentSkill(skill.id),
          },
          icon,
          id: skill.identifier,
          popoverContent,
          searchText: `${skill.name} ${skill.identifier}`,
          title: skill.name,
        });
      }),
    [userAgentSkills, t, createManagedSkillItem, deleteAgentSkill],
  );

  // Klavis server list items - only show installed or recommended.
  // These keep their own connection UI (KlavisServerItem) and are not managed
  // policy items; they still participate in pinned/auto grouping by key.
  const klavisServerItems = useMemo(
    () =>
      isKlavisEnabledInEnv
        ? KLAVIS_SERVER_TYPES.filter(
            (type) =>
              installedKlavisIds.has(type.identifier) || recommendedKlavisIds.has(type.identifier),
          ).map((type) => ({
            icon: <KlavisSkillIcon icon={type.icon} label={type.label} size={SKILL_ICON_SIZE} />,
            key: type.identifier,
            label: (
              <KlavisServerItem
                agentId={agentId}
                identifier={type.identifier}
                label={type.label}
                server={getServerByName(type.identifier)}
                serverName={type.serverName}
              />
            ),
            searchText: `${type.label} ${type.identifier}`,
          }))
        : [],
    [isKlavisEnabledInEnv, allKlavisServers, installedKlavisIds, recommendedKlavisIds, agentId],
  );

  // TripYoYo Skill Provider list items - only show installed or recommended
  const lobehubSkillItems = useMemo(
    () =>
      isLobehubSkillEnabled
        ? LOBEHUB_SKILL_PROVIDERS.filter(
            (provider) =>
              installedLobehubIds.has(provider.id) || recommendedLobehubIds.has(provider.id),
          ).map((provider) => ({
            icon: (
              <LobehubSkillIcon
                icon={provider.icon}
                label={provider.label}
                size={SKILL_ICON_SIZE}
              />
            ),
            key: provider.id,
            label: (
              <LobehubSkillServerItem
                agentId={agentId}
                label={provider.label}
                provider={provider.id}
              />
            ),
            searchText: `${provider.label} ${provider.id}`,
          }))
        : [],
    [
      isLobehubSkillEnabled,
      allLobehubSkillServers,
      installedLobehubIds,
      recommendedLobehubIds,
      agentId,
    ],
  );

  // Skills list items (including TripYoYo Skill and Klavis).
  // Connected items listed first.
  const skillItems = useMemo(() => {
    const allItems = [...lobehubSkillItems, ...klavisServerItems];

    return allItems.sort((a, b) => {
      const isConnectedA =
        installedLobehubIds.has(a.key as string) || installedKlavisIds.has(a.key as string);
      const isConnectedB =
        installedLobehubIds.has(b.key as string) || installedKlavisIds.has(b.key as string);

      if (isConnectedA && !isConnectedB) return -1;
      if (!isConnectedA && isConnectedB) return 1;
      return 0;
    });
  }, [lobehubSkillItems, klavisServerItems, installedLobehubIds, installedKlavisIds]);

  // Distinguish community plugins and custom plugins
  const communityPlugins = list.filter((item) => item.type !== 'customPlugin');
  const customPlugins = list.filter((item) => item.type === 'customPlugin');

  // Function to map plugins to managed list items — uninstallable
  const mapPluginToItem = useCallback(
    (item: (typeof list)[0]): SkillMenuItem => {
      const title = item.title || item.identifier;
      const icon = item?.avatar ? (
        <PluginAvatar avatar={item.avatar} size={SKILL_ICON_SIZE} />
      ) : (
        <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
      );

      return createManagedSkillItem({
        deleteConfig: {
          displayName: title,
          onDelete: () => uninstallPlugin(item.identifier),
        },
        icon,
        id: item.identifier,
        searchText: `${title} ${item.identifier}`,
        title,
      });
    },
    [createManagedSkillItem, uninstallPlugin],
  );

  // Build TripYoYo group children (including Builtin Agent Skills, builtin tools, and TripYoYo Skill/Klavis)
  const lobehubGroupChildren: SkillMenuItem[] = [
    // 1. Builtin Agent Skills
    ...builtinAgentSkillItems,
    // 2. Builtin tools
    ...builtinItems,
    // 3. TripYoYo Skill and Klavis (as builtin skills)
    ...(skillItems as SkillMenuItem[]),
  ];

  // Build Community group children (Market Agent Skills + community plugins)
  const communityGroupChildren: SkillMenuItem[] = [
    ...marketAgentSkillItems,
    ...communityPlugins.map(mapPluginToItem),
  ];

  // Build Custom group children (User Agent Skills + custom plugins)
  const customGroupChildren: SkillMenuItem[] = [
    ...userAgentSkillItems,
    ...customPlugins.map(mapPluginToItem),
  ];

  const normalizedSearchKeyword = searchKeyword.trim().toLowerCase();
  // Deduplicate by key: the same app can be sourced from more than one list.
  const seenSkillKeys = new Set<string>();
  const allSkillItems = [
    ...lobehubGroupChildren,
    ...communityGroupChildren,
    ...customGroupChildren,
  ].filter((item): item is SkillMenuItem => {
    if (!item || (item as { type?: string }).type === 'divider') return false;
    const key = String(item.key);
    if (seenSkillKeys.has(key)) return false;
    seenSkillKeys.add(key);
    return true;
  });
  const filterBySearch = (items: SkillMenuItem[]) => {
    if (!normalizedSearchKeyword) return items;

    return items.filter((item) =>
      String(item.searchText || item.key || '')
        .toLowerCase()
        .includes(normalizedSearchKeyword),
    );
  };
  const allPinnedItems = allSkillItems.filter((item) => checkedSet.has(String(item.key)));
  const allAutoItems = allSkillItems.filter((item) => !checkedSet.has(String(item.key)));
  // App-fixed tools always lead the pinned section, ahead of user-pinned plugins.
  const pinnedItems = filterBySearch([...fixedItems, ...allPinnedItems]);
  const autoItems = filterBySearch(allAutoItems);

  const renderActivationGroupLabel = ({
    autoSwitch,
    count,
    icon,
    open,
    title,
    onToggle,
  }: {
    autoSwitch?: boolean;
    count?: number;
    icon: ReactNode;
    open: boolean;
    title: string;
    onToggle: () => void;
  }) => (
    <div
      data-skill-activation-group
      className={cx(styles.activationGroupHeader)}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <div className={cx(styles.activationGroupTitleBlock)}>
        {icon}
        <span className={cx(styles.activationGroupTitleText)}>{title}</span>
        {typeof count === 'number' && <span className={cx(styles.count)}>{count}</span>}
      </div>
      <div className={cx(styles.activationGroupActions)}>
        {autoSwitch && (
          <span
            className={cx(styles.switchWrap)}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <Tooltip
              title={t(`tools.skillActivateMode.${isAutoSkillMode ? 'auto' : 'manual'}.desc`)}
            >
              <Switch
                checked={isAutoSkillMode}
                disabled={!canEdit}
                loading={autoModeLoading}
                size="small"
                onClick={(_, event) => event.stopPropagation()}
                onChange={async (checked, event) => {
                  event?.stopPropagation?.();
                  if (!canEdit) return;
                  setAutoModeLoading(true);
                  try {
                    await updateAgentChatConfig({
                      skillActivateMode: checked ? 'auto' : 'manual',
                    });
                  } finally {
                    setAutoModeLoading(false);
                  }
                }}
              />
            </Tooltip>
          </span>
        )}
        <div className={cx(styles.activationGroupChevron)}>
          <Icon icon={open ? ChevronDown : ChevronRight} size={13} />
        </div>
      </div>
    </div>
  );

  const marketHeader = (
    <SearchBar
      allowClear
      placeholder={t('tools.search')}
      size="small"
      style={{ width: '100%' }}
      value={searchKeyword}
      variant="borderless"
      onChange={(event) => setSearchKeyword(event.target.value)}
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
    />
  );

  const marketItems: ItemType[] = [
    ...(pinnedItems.length > 0
      ? [
          {
            children: pinnedOpen ? pinnedItems : [],
            key: 'pinned',
            label: renderActivationGroupLabel({
              count: allPinnedItems.length + fixedItems.length,
              icon: <Icon icon={Pin} size={14} />,
              open: pinnedOpen,
              title: t('tools.activation.pinned'),
              onToggle: () => setPinnedOpen((open) => !open),
            }),
            type: 'group' as const,
          } as ItemType,
        ]
      : []),
    ...(pinnedItems.length > 0 && autoItems.length > 0
      ? [
          {
            key: 'skill-activation-divider',
            type: 'divider' as const,
          } as ItemType,
        ]
      : []),
    ...(autoItems.length > 0
      ? [
          {
            children: autoOpen ? autoItems : [],
            key: 'auto',
            label: renderActivationGroupLabel({
              autoSwitch: true,
              count: allAutoItems.length,
              icon: <Icon icon={Zap} size={14} />,
              open: autoOpen,
              title: t('tools.activation.auto'),
              onToggle: () => setAutoOpen((open) => !open),
            }),
            type: 'group' as const,
          } as ItemType,
        ]
      : []),
  ];

  return {
    autoCount: allAutoItems.length,
    marketHeader,
    marketItems,
    pinnedCount: allPinnedItems.length + fixedItems.length,
  };
};
