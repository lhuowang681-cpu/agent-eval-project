'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { Alert } from 'antd';
import { cssVar } from 'antd-style';
import { ExternalLinkIcon, SettingsIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import {
  MCP_ADA_TOKEN_INSTRUCTION,
  MCP_ADA_TOKEN_MARKET_URL,
  MCP_ADA_TOKEN_PLACEHOLDER,
  parseMcpAdaTokenInput,
} from '../../utils/mcpAdaToken';

interface McpAdaTokenConfigProps {
  compact?: boolean;
  defaultValue?: string;
  onOpenSettings?: () => void;
  onSaved?: () => void;
  saveToken: (token: string) => Promise<void>;
  showSettingsLink?: boolean;
  stickyFooter?: boolean;
}

const McpAdaTokenConfig = memo<McpAdaTokenConfigProps>(
  ({
    compact,
    defaultValue = '',
    onOpenSettings,
    onSaved,
    saveToken,
    showSettingsLink,
    stickyFooter = true,
  }) => {
    const [value, setValue] = useState(defaultValue);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSave = useCallback(async () => {
      const token = parseMcpAdaTokenInput(value);
      if (!token) {
        setError('请输入 ada_token');
        return;
      }

      try {
        setSaving(true);
        setError('');
        await saveToken(token);
        onSaved?.();
      } finally {
        setSaving(false);
      }
    }, [onSaved, saveToken, value]);

    return (
      <Flexbox
        gap={0}
        style={{
          marginBlock: compact ? 0 : -8,
          maxHeight: stickyFooter ? 'min(68vh, 620px)' : undefined,
        }}
      >
        <Flexbox
          gap={16}
          style={{
            overflowY: stickyFooter ? 'auto' : undefined,
            paddingBlock: compact ? 0 : 8,
            paddingInline: 1,
          }}
        >
          <Flexbox
            gap={8}
            style={{
              background: cssVar.colorFillQuaternary,
              border: `1px solid ${cssVar.colorBorderSecondary}`,
              borderRadius: 8,
              paddingBlock: 12,
              paddingInline: 14,
            }}
          >
            <Flexbox gap={4}>
              <Text strong>获取方式</Text>
              <Text type="secondary">
                为了 MCP 能正常运行，请及时配置 mcp token，后续您可以在
                {showSettingsLink ? (
                  <Button
                    icon={SettingsIcon}
                    size="small"
                    type="link"
                    style={{
                      height: 22,
                      paddingInline: 4,
                      verticalAlign: 'baseline',
                    }}
                    onClick={onOpenSettings}
                  >
                    设置页面
                  </Button>
                ) : (
                  '设置页面'
                )}
                修改。
              </Text>
            </Flexbox>
            <Text type="secondary">{MCP_ADA_TOKEN_INSTRUCTION}</Text>
            <Button
              icon={ExternalLinkIcon}
              style={{ width: 'fit-content' }}
              target="_blank"
              type="primary"
              onClick={() => window.open(MCP_ADA_TOKEN_MARKET_URL, '_blank', 'noopener,noreferrer')}
            >
              打开配置页面
            </Button>
          </Flexbox>
          <Flexbox gap={8}>
            <Text strong>ada_token</Text>
            <Text type="secondary">请填入形如 ada_xxx 的 token。</Text>
            <Input
              placeholder={MCP_ADA_TOKEN_PLACEHOLDER}
              value={value}
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                fontSize: 12,
              }}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError('');
              }}
            />
          </Flexbox>
          {error && <Alert showIcon message={error} type="error" />}
        </Flexbox>
        <Flexbox
          horizontal
          justify="flex-end"
          style={{
            borderBlockStart: stickyFooter ? `1px solid ${cssVar.colorBorderSecondary}` : undefined,
            background: cssVar.colorBgElevated,
            marginBlockStart: 16,
            paddingBlock: stickyFooter ? 14 : 0,
            position: stickyFooter ? 'sticky' : undefined,
            bottom: stickyFooter ? 0 : undefined,
            boxShadow: stickyFooter ? `0 -8px 18px ${cssVar.colorBgElevated}` : undefined,
          }}
        >
          <Button disabled={saving} loading={saving} type="primary" onClick={handleSave}>
            保存
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

McpAdaTokenConfig.displayName = 'McpAdaTokenConfig';

export default McpAdaTokenConfig;
