import { type ConnectionConfig } from '@lobehub/market-types';
import { Block, Highlighter } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { genServerConfig } from '@/features/MCP/utils';

const styles = createStaticStyles(({ css }) => {
  return {
    lite: css`
      pre {
        padding: 12px !important;
      }
    `,
  };
});

interface PlatformProps {
  connection?: ConnectionConfig;
  /** Raw MCP config from customParams.mcp, preserves headers/env/type etc. */
  customParams?: Record<string, unknown>;
  identifier?: string;
  lite?: boolean;
  mobile?: boolean;
}

const Platform = memo<PlatformProps>(({ lite, identifier, connection, customParams }) => {
  const serverConfig = genServerConfig(identifier, connection, customParams);

  return (
    <Block gap={lite ? 0 : 16} padding={4} variant={lite ? 'outlined' : 'borderless'}>
      <Highlighter
        fullFeatured
        className={cx(lite && styles.lite)}
        fileName={'MCP server config'}
        language={'json'}
        variant={'filled'}
        style={{
          fontSize: 12,
        }}
      >
        {serverConfig}
      </Highlighter>
    </Block>
  );
});

export default Platform;
