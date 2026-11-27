'use client';

import { Block, Button, Flexbox } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

interface InvalidFormNoticeProps {
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

export const buildInvalidFormTroubleshootingInfo = ({
  definition,
  messageId,
}: TroubleshootingInfoParams) =>
  [
    'type: interactive-form-invalid-definition',
    `messageId: ${messageId}`,
    `definitionType: ${Array.isArray(definition) ? 'array' : typeof definition}`,
    'reason: The client could not normalize the interactive form definition.',
    'definition:',
    safeStringify(definition),
  ].join('\n');

const InvalidFormNotice = memo<InvalidFormNoticeProps>(({ className, definition, messageId }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(
      buildInvalidFormTroubleshootingInfo({
        definition,
        messageId,
      }),
    );
    setCopied(true);
  }, [definition, messageId]);

  return (
    <Block className={className}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <Flexbox gap={4}>
          <div>表单定义无效，无法渲染。</div>
        </Flexbox>
        <Button size={'small'} onClick={handleCopy}>
          {copied ? '已复制' : '复制排障信息'}
        </Button>
      </Flexbox>
    </Block>
  );
});

InvalidFormNotice.displayName = 'InvalidFormNotice';

export default InvalidFormNotice;
