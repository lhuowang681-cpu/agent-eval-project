'use client';

import { Modal } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import McpAdaTokenConfig from './index';

const McpAdaTokenCommunityPrompt = memo(() => {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [isLogin, isLoaded, isUserStateInit, token, updateMcpAdaToken] = useUserStore((s) => [
    authSelectors.isLogin(s),
    s.isLoaded,
    s.isUserStateInit,
    userProfileSelectors.mcpAdaToken(s),
    s.updateMcpAdaToken,
  ]);

  const open = !dismissed && !!isLogin && !!isLoaded && isUserStateInit && !token;

  return (
    <Modal
      centered
      destroyOnHidden
      footer={null}
      open={open}
      title="配置MCP Token"
      width={640}
      onCancel={() => setDismissed(true)}
    >
      <McpAdaTokenConfig
        showSettingsLink
        saveToken={updateMcpAdaToken}
        onOpenSettings={() => {
          setDismissed(true);
          navigate('/settings/profile');
        }}
        onSaved={() => {
          setDismissed(true);
        }}
      />
    </Modal>
  );
});

McpAdaTokenCommunityPrompt.displayName = 'McpAdaTokenCommunityPrompt';

export default McpAdaTokenCommunityPrompt;
