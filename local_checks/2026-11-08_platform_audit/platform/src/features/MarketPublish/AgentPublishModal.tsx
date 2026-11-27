'use client';

import { App, Checkbox, Modal, Typography } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarketPublishFormFields from '@/features/MarketPublish/MarketPublishFormFields';
import { MarketSkillSecurityScanModal } from '@/features/MarketPublish/MarketSkillSecurityScanModal';
import { PublishRenameModal } from '@/features/MarketPublish/PublishRenameModal';
import { translateSkillImportError } from '@/features/SkillStore/SkillList/skillImportError';
import { communityApiService } from '@/services/marketApi';

interface AgentPublishModalProps {
  agentId: string;
  agentTitle: string;
  knowledgeBases?: { identifier: string; name: string; source: string }[];
  mcps?: { identifier: string; name: string; source: string }[];
  onClose: () => void;
  onSuccess?: (identifier: string) => void;
  open: boolean;
  skills?: { identifier: string; name: string; source: string }[];
}

export const AgentPublishModal = memo<AgentPublishModalProps>(
  ({
    open,
    onClose,
    agentId,
    agentTitle,
    skills = [],
    mcps = [],
    knowledgeBases = [],
    onSuccess,
  }) => {
    const { t } = useTranslation('discover');
    const { t: tSetting } = useTranslation('setting');
    const { message } = App.useApp();
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
    const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
    const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [category, setCategory] = useState<string>();
    const [securityScanOpen, setSecurityScanOpen] = useState(false);
    const [securityScanError, setSecurityScanError] = useState<string | null>(null);

    const marketSkills = skills.filter((item) => item.source === 'market');
    const privateSkills = skills.filter(
      (item) => item.source !== 'market' && item.source !== 'builtin',
    );
    const marketMcps = mcps.filter((item) => item.source === 'market');
    const privateMcps = mcps.filter(
      (item) => item.source !== 'market' && item.source !== 'builtin',
    );
    const marketKbs = knowledgeBases.filter((item) => item.source === 'market');
    const privateKbs = knowledgeBases.filter((item) => item.source !== 'market');

    const hasSelectableBundledItems =
      privateSkills.length > 0 || privateMcps.length > 0 || privateKbs.length > 0;
    const shouldShowSecurityScan = privateSkills.length > 0;

    const doPublish = async (newDisplayName?: string) => {
      if (!category) {
        message.error(t('publish.category.required'));
        return;
      }

      setLoading(true);
      setSecurityScanError(null);
      if (shouldShowSecurityScan) setSecurityScanOpen(true);
      try {
        const result = await communityApiService.publishAgent(
          agentId,
          selectedSkillIds,
          selectedMcpIds,
          selectedKbIds,
          newDisplayName,
          category,
        );
        setSecurityScanOpen(false);
        message.success(t('assistants.publishSuccess'));
        onSuccess?.(result.identifier);
        setRenameOpen(false);
        onClose();
      } catch (error) {
        console.error(error);
        if (shouldShowSecurityScan) {
          setSecurityScanError(translateSkillImportError(tSetting, error));
        } else {
          message.error(t('fork.failed'));
        }
      } finally {
        setLoading(false);
      }
    };

    const handlePublish = async () => {
      if (!category) {
        message.error(t('publish.category.required'));
        return;
      }

      const conflict = await communityApiService.checkAgentPublishNameConflict(agentTitle);
      if (conflict.conflict) {
        setRenameOpen(true);
        return;
      }
      await doPublish();
    };

    return (
      <>
        <Modal
          closable={!loading}
          confirmLoading={loading}
          keyboard={!loading}
          maskClosable={!loading}
          open={open}
          title={t('assistants.publishToMarket', { title: agentTitle })}
          onOk={handlePublish}
          onCancel={() => {
            if (!loading) onClose();
          }}
        >
          <Typography.Paragraph type="secondary">
            {t('assistants.publishDescription')}
          </Typography.Paragraph>

          <MarketPublishFormFields
            category={category}
            resourceType="agent"
            onCategoryChange={setCategory}
          />

          {hasSelectableBundledItems && (
            <Typography.Paragraph style={{ marginBottom: 16 }} type="secondary">
              {t('assistants.publishBundledSelectionHint')}
            </Typography.Paragraph>
          )}

          {marketSkills.length > 0 && (
            <div>
              <Typography.Text strong>{t('assistants.publishMarketSkills')}</Typography.Text>
              {marketSkills.map((skill) => (
                <div key={skill.identifier}>
                  <Checkbox checked disabled>
                    {skill.name}
                  </Checkbox>
                </div>
              ))}
            </div>
          )}

          {privateSkills.length > 0 && (
            <div>
              <Typography.Text strong>{t('assistants.publishPrivateSkills')}</Typography.Text>
              {privateSkills.map((skill) => (
                <div key={skill.identifier}>
                  <Checkbox
                    checked={selectedSkillIds.includes(skill.identifier)}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedSkillIds([...selectedSkillIds, skill.identifier]);
                      } else {
                        setSelectedSkillIds(
                          selectedSkillIds.filter((id) => id !== skill.identifier),
                        );
                      }
                    }}
                  >
                    {skill.name}
                  </Checkbox>
                </div>
              ))}
            </div>
          )}

          {privateMcps.length > 0 && (
            <div>
              <Typography.Text strong>{t('assistants.publishPrivateMcps')}</Typography.Text>
              {privateMcps.map((mcp) => (
                <div key={mcp.identifier}>
                  <Checkbox
                    checked={selectedMcpIds.includes(mcp.identifier)}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedMcpIds([...selectedMcpIds, mcp.identifier]);
                      } else {
                        setSelectedMcpIds(selectedMcpIds.filter((id) => id !== mcp.identifier));
                      }
                    }}
                  >
                    {mcp.name}
                  </Checkbox>
                </div>
              ))}
            </div>
          )}

          {marketMcps.length > 0 && (
            <div>
              <Typography.Text strong>{t('assistants.publishMarketMcps')}</Typography.Text>
              {marketMcps.map((mcp) => (
                <div key={mcp.identifier}>
                  <Checkbox checked disabled>
                    {mcp.name}
                  </Checkbox>
                </div>
              ))}
            </div>
          )}

          {privateKbs.length > 0 && (
            <div>
              <Typography.Text strong>
                {t('assistants.publishPrivateKnowledgeBases')}
              </Typography.Text>
              {privateKbs.map((kb) => (
                <div key={kb.identifier}>
                  <Checkbox
                    checked={selectedKbIds.includes(kb.identifier)}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedKbIds([...selectedKbIds, kb.identifier]);
                      } else {
                        setSelectedKbIds(selectedKbIds.filter((id) => id !== kb.identifier));
                      }
                    }}
                  >
                    {kb.name}
                  </Checkbox>
                </div>
              ))}
            </div>
          )}

          {marketKbs.length > 0 && (
            <div>
              <Typography.Text strong>
                {t('assistants.publishMarketKnowledgeBases')}
              </Typography.Text>
              {marketKbs.map((kb) => (
                <div key={kb.identifier}>
                  <Checkbox checked disabled>
                    {kb.name}
                  </Checkbox>
                </div>
              ))}
            </div>
          )}
        </Modal>

        <PublishRenameModal
          currentName={agentTitle}
          open={renameOpen}
          toolType="agent"
          onCancel={() => setRenameOpen(false)}
          onConfirm={async (newName) => {
            const recheck = await communityApiService.checkAgentPublishNameConflict(newName);
            if (recheck.conflict) {
              message.error(t('publishRename.sameName'));
              return;
            }
            await doPublish(newName);
          }}
        />

        <MarketSkillSecurityScanModal
          error={securityScanError}
          loading={loading && securityScanOpen && !securityScanError}
          open={securityScanOpen}
          failedDescription={t('assistants.publishSecurityScan.failedDesc', {
            defaultValue: '助理发布失败',
          })}
          loadingDescription={t('assistants.publishSecurityScan.loadingDesc', {
            defaultValue:
              '安全扫描可能需要较长时间。请不要离开当前页面、刷新页面或关闭窗口，扫描通过后会继续发布助理。',
          })}
          loadingTitle={t('assistants.publishSecurityScan.loadingTitle', {
            count: privateSkills.length,
            defaultValue: '正在安全扫描助理内置 Skill（共 {{count}} 个）',
          })}
          title={t(
            securityScanError
              ? 'assistants.publishSecurityScan.failedTitle'
              : 'assistants.publishSecurityScan.title',
            {
              defaultValue: securityScanError ? '助理发布失败' : '发布助理到市场',
            },
          )}
          onClose={() => setSecurityScanOpen(false)}
        />
      </>
    );
  },
);
