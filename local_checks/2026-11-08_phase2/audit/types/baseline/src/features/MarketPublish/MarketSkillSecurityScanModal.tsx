'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { Modal, Spin, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface MarketSkillSecurityScanModalProps {
  batchProgress?: {
    completed: number;
    runningNames: string[];
    total: number;
  };
  current?: {
    index: number;
    name: string;
    total: number;
  };
  error: string | null;
  failedDescription?: string;
  loading: boolean;
  loadingDescription?: string;
  loadingTitle?: string;
  onClose: () => void;
  open: boolean;
  title?: string;
}

export const MarketSkillSecurityScanModal = memo<MarketSkillSecurityScanModalProps>(
  ({
    batchProgress,
    current,
    error,
    failedDescription,
    loading,
    loadingDescription,
    loadingTitle: loadingTitleOverride,
    onClose,
    open,
    title,
  }) => {
    const { t } = useTranslation(['discover', 'common']);

    const loadingTitle =
      loadingTitleOverride ??
      (batchProgress
        ? t('skills.publishSecurityScan.batchProgressTitle', {
            completed: batchProgress.completed,
            defaultValue: '正在安全扫描并发布 Skill（{{completed}}/{{total}} 已完成）',
            total: batchProgress.total,
          })
        : current
          ? t('skills.publishSecurityScan.batchLoadingTitle', {
              current: current.index,
              defaultValue: '正在安全扫描 {{name}}（{{current}}/{{total}}）',
              name: current.name,
              total: current.total,
            })
          : t('skills.publishSecurityScan.loadingTitle', {
              defaultValue: '正在进行安全扫描',
            }));
    const failedMessage =
      failedDescription ??
      t('skills.publishSecurityScan.failedDesc', {
        defaultValue: '安全扫描未通过',
      });
    const errorDescription = <span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>;
    const runningText =
      batchProgress && batchProgress.runningNames.length > 0
        ? t('skills.publishSecurityScan.runningNames', {
            defaultValue: '正在处理：{{names}}',
            names: batchProgress.runningNames.join('、'),
          })
        : null;

    return (
      <Modal
        centered
        closable={!loading}
        keyboard={!loading}
        maskClosable={!loading}
        open={open}
        width={520}
        footer={
          loading
            ? null
            : [
                <Button key="close" onClick={onClose}>
                  {t('common:close')}
                </Button>,
              ]
        }
        title={
          title ??
          t(error ? 'skills.publishSecurityScan.failedTitle' : 'skills.publishSecurityScan.title', {
            defaultValue: error ? '发布失败' : '发布到市场',
          })
        }
        onCancel={() => {
          if (!loading) onClose();
        }}
      >
        <Flexbox gap={16}>
          {loading ? (
            <Flexbox horizontal align="flex-start" gap={12}>
              <Spin />
              <Flexbox gap={4}>
                <Typography.Text>{loadingTitle}</Typography.Text>
                {runningText && <Typography.Text type="secondary">{runningText}</Typography.Text>}
                <Typography.Text type="secondary">
                  {loadingDescription ??
                    t('skills.publishSecurityScan.loadingDesc', {
                      defaultValue:
                        '安全扫描通常需要几分钟。请不要离开当前页面、刷新页面或关闭窗口，完成后会继续发布到市场。',
                    })}
                </Typography.Text>
              </Flexbox>
            </Flexbox>
          ) : error ? (
            <Alert showIcon description={errorDescription} message={failedMessage} type="error" />
          ) : null}
        </Flexbox>
      </Modal>
    );
  },
);

MarketSkillSecurityScanModal.displayName = 'MarketSkillSecurityScanModal';
