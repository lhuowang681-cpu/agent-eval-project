'use client';

import { Block, Button, Flexbox } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

interface InvalidWidgetNoticeProps {
  className?: string;
  definition: unknown;
  messageId: string;
}

interface TroubleshootingInfoParams {
  definition: unknown;
  messageId: string;
}

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

export const buildInvalidWidgetTroubleshootingInfo = ({
  definition,
  messageId,
}: TroubleshootingInfoParams) =>
  [
    'type: interactive-widget-invalid-definition',
    `messageId: ${messageId}`,
    `definitionType: ${Array.isArray(definition) ? 'array' : typeof definition}`,
    'reason: The client could not recognize or normalize the interactive widget definition.',
    'definition:',
    safeStringify(definition),
  ].join('\n');

const InvalidWidgetNotice = memo<InvalidWidgetNoticeProps>(
  ({ className, definition, messageId }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
      await navigator.clipboard.writeText(
        buildInvalidWidgetTroubleshootingInfo({ definition, messageId }),
      );
      setCopied(true);
    }, [definition, messageId]);

    return (
      <Block className={className}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Flexbox gap={4}>
            <div>交互组件定义无效，无法渲染。</div>
          </Flexbox>
          <Button size={'small'} onClick={handleCopy}>
            {copied ? '已复制' : '复制排障信息'}
          </Button>
        </Flexbox>
      </Block>
    );
  },
);

InvalidWidgetNotice.displayName = 'InvalidWidgetNotice';

export default InvalidWidgetNotice;
