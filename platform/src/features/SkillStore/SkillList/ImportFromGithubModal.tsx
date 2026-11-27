'use client';

import { isDesktop } from '@lobechat/const';
import { Alert, Flexbox, Icon, Input } from '@lobehub/ui';
import { App, Button, Modal, Typography } from 'antd';
import { ArrowLeftRight, Github, Sparkles } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

import { translateSkillImportError } from './skillImportError';
import { useScanPolling } from './useScanPolling';

interface ImportFromGithubModalProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const ImportFromGithubModal = memo<ImportFromGithubModalProps>(({ open, onOpenChange }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { message } = App.useApp();
  const importAgentSkillFromGitHub = useToolStore((s) => s.importAgentSkillFromGitHub);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [scanId, setScanId] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const handleClose = () => {
    onOpenChange(false);
    setError(null);
    setUrl('');
    setScanId(null);
    setPendingUrl(null);
  };

  const handleScanDone = useCallback(async () => {
    if (!pendingUrl) return;
    const currentScanId = scanId;
    setScanId(null);

    try {
      await importAgentSkillFromGitHub({ gitUrl: pendingUrl, scanId: currentScanId ?? undefined });
      message.success(t('agentSkillModal.importSuccess'));
      handleClose();
    } catch (err) {
      setError(translateSkillImportError(t, err));
    } finally {
      setLoading(false);
    }
  }, [pendingUrl, scanId, importAgentSkillFromGitHub, message, t]);

  const handleScanError = useCallback((msg: string) => {
    setError(msg);
    setScanId(null);
    setPendingUrl(null);
    setLoading(false);
  }, []);

  const { isScanning, scanProgress } = useScanPolling(scanId, handleScanDone, handleScanError);

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setScanId(null);
    setPendingUrl(null);

    try {
      if (isDesktop) {
        await importAgentSkillFromGitHub({ gitUrl: trimmed, skipSecurityScan: true });
        message.success(t('agentSkillModal.importSuccess'));
        handleClose();
        setLoading(false);
        return;
      }

      const result = await agentSkillService.startScanForGitHub({ gitUrl: trimmed });

      if (result.scanId) {
        setPendingUrl(trimmed);
        setScanId(result.scanId);
        // loading stays true; useScanPolling handles the rest
      } else {
        // Scanner disabled — import directly
        await importAgentSkillFromGitHub({ gitUrl: trimmed });
        message.success(t('agentSkillModal.importSuccess'));
        handleClose();
        setLoading(false);
      }
    } catch (err) {
      setError(translateSkillImportError(t, err));
      setLoading(false);
    }
  };

  const scanLabel =
    scanProgress?.stageMessage ||
    (scanProgress?.progress !== undefined ? `${scanProgress.progress}%` : null);

  return (
    <Modal destroyOnClose footer={null} open={open} title={null} width={480} onCancel={handleClose}>
      <Flexbox align="center" gap={16} padding={'16px 0'}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={Github} size={28} />
          <Icon
            icon={ArrowLeftRight}
            size={16}
            style={{ color: 'var(--ant-color-text-tertiary)' }}
          />
          <Icon icon={Sparkles} size={28} />
        </Flexbox>

        <Flexbox align="center" gap={4}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('agentSkillModal.github.title')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('agentSkillModal.github.desc')}</Typography.Text>
        </Flexbox>
      </Flexbox>

      <Flexbox gap={16}>
        {error && (
          <Alert
            showIcon
            description={<span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>}
            title={t('agentSkillModal.importFailed')}
            type="error"
          />
        )}
        {isScanning && (
          <Alert
            showIcon
            description={scanLabel}
            title={t('agentSkillModal.securityScan.loading')}
            type="info"
          />
        )}

        <Flexbox gap={8}>
          <Typography.Text strong>URL</Typography.Text>
          <Input
            disabled={loading}
            placeholder={t('agentSkillModal.github.urlPlaceholder')}
            value={url}
            onPressEnter={handleImport}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
          />
        </Flexbox>

        <Button block loading={loading} type="primary" onClick={handleImport}>
          {t('common:import')}
        </Button>
      </Flexbox>
    </Modal>
  );
});

ImportFromGithubModal.displayName = 'ImportFromGithubModal';

export default ImportFromGithubModal;
