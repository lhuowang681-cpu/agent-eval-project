import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { detectMcpRunner, getMcpRunnerGuide } from '@/helpers/mcpRunner';
import { useToolStore } from '@/store/tool';

interface MCPRunnerGuideProps {
  command?: string;
  identifier: string;
}

const MCPRunnerGuide = memo<MCPRunnerGuideProps>(({ command, identifier }) => {
  const { t } = useTranslation('plugin');
  const installMCPPlugin = useToolStore((s) => s.installMCPPlugin);
  const runner = detectMcpRunner(command);
  const guide = getMcpRunnerGuide(runner.runner);

  return (
    <Flexbox gap={12} padding={12}>
      <Text as="h5">{t(guide.titleKey as any)}</Text>
      <Text type="secondary">{t(guide.descriptionKey as any)}</Text>
      <Flexbox horizontal gap={8}>
        {guide.downloadUrl && (
          <Button href={guide.downloadUrl} target="_blank">
            {t('mcpInstall.runnerGuide.download')}
          </Button>
        )}
        <Button type="primary" onClick={() => installMCPPlugin(identifier)}>
          {t('mcpInstall.runnerGuide.recheck')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default MCPRunnerGuide;
