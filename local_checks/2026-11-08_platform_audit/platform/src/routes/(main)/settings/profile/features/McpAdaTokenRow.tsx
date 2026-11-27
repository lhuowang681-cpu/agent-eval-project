'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { Modal } from 'antd';
import { memo, useState } from 'react';

import McpAdaTokenConfig from '@/features/McpAdaTokenConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

interface McpAdaTokenRowProps {
  mobile?: boolean;
}

const McpAdaTokenRow = memo<McpAdaTokenRowProps>(({ mobile }) => {
  const [open, setOpen] = useState(false);
  const [token, updateMcpAdaToken] = useUserStore((s) => [
    userProfileSelectors.mcpAdaToken(s),
    s.updateMcpAdaToken,
  ]);

  return (
    <>
      <ProfileRow
        label="x-bbzai-mcp-token"
        mobile={mobile}
        action={
          <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
            修改
          </Button>
        }
      >
        <Flexbox align={mobile ? 'flex-start' : 'flex-end'}>
          <Text code style={{ overflowWrap: 'anywhere' }}>
            {token || '未配置'}
          </Text>
        </Flexbox>
      </ProfileRow>
      <Modal
        destroyOnHidden
        footer={null}
        open={open}
        title="配置MCP Token"
        width={640}
        onCancel={() => setOpen(false)}
      >
        <McpAdaTokenConfig
          compact
          defaultValue={token}
          saveToken={updateMcpAdaToken}
          onSaved={() => setOpen(false)}
        />
      </Modal>
    </>
  );
});

McpAdaTokenRow.displayName = 'McpAdaTokenRow';

export default McpAdaTokenRow;
