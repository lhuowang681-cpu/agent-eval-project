import { FEISHU_URL_PATTERN } from '@lobechat/const';
import { Button, Flexbox, Input, Segmented, TextArea } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import FeishuAuthModal from '@/features/FeishuAuth/FeishuAuthModal';
import { feishuTokenService } from '@/services/feishuToken';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import { useKnowledgeBaseStore } from '@/store/library';

interface CreateFormProps {
  id?: string;
  initialValues?: { description?: string; name?: string };
  onClose?: () => void;
  onSuccess?: (id: string) => void;
}

type LibraryKind = 'normal' | 'feishu';

interface PendingFeishuImport {
  authUrl: string;
  knowledgeBaseId: string;
  url: string;
}

const CreateForm = memo<CreateFormProps>(({ id, initialValues, onClose, onSuccess }) => {
  const { t } = useTranslation('knowledgeBase');
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<LibraryKind>('normal');
  const [name, setName] = useState(initialValues?.name || '');
  const [description, setDescription] = useState(initialValues?.description || '');
  const [feishuUrl, setFeishuUrl] = useState('');
  const [pendingFeishuImport, setPendingFeishuImport] = useState<PendingFeishuImport | null>(null);
  const createNewKnowledgeBase = useKnowledgeBaseStore((s) => s.createNewKnowledgeBase);
  const updateKnowledgeBase = useKnowledgeBaseStore((s) => s.updateKnowledgeBase);

  const isEditMode = !!id;
  const isFeishu = !isEditMode && kind === 'feishu';

  const finishFeishuImport = useCallback(
    async (knowledgeBaseId: string, url: string, token: string) => {
      await knowledgeBaseService.importFromFeishu({
        knowledgeBaseId,
        mode: 'create',
        url,
        userAccessToken: token,
      });

      setLoading(false);
      onClose?.();
      if (onSuccess) onSuccess(knowledgeBaseId);
      else window.location.href = `/resource/library/${knowledgeBaseId}`;
    },
    [onClose, onSuccess],
  );

  const handleSubmit = async () => {
    if (!name.trim()) return;

    const url = feishuUrl.trim();
    if (isFeishu) {
      if (!url) return;
      if (!FEISHU_URL_PATTERN.test(url)) {
        message.error(t('createNew.feishuUrl.invalid'));
        return;
      }
    }

    setLoading(true);
    const values = { description: description.trim(), name: name.trim() };

    try {
      if (isEditMode) {
        await updateKnowledgeBase(id, values);
        setLoading(false);
        onClose?.();
        return;
      }

      if (isFeishu) {
        const newId = await createNewKnowledgeBase({
          ...values,
          settings: { feishuUrl: url },
          type: 'feishu',
        });

        const tokenResult = await feishuTokenService.requestToken();

        if (tokenResult.status === 'auth_required') {
          setPendingFeishuImport({
            authUrl: tokenResult.authUrl,
            knowledgeBaseId: newId,
            url,
          });
          setLoading(false);
          return;
        }

        await finishFeishuImport(newId, url, tokenResult.token);
        return;
      }

      const newId = await createNewKnowledgeBase(values);
      setLoading(false);

      if (onSuccess) {
        onSuccess(newId);
        onClose?.();
      } else {
        window.location.href = `/resource/library/${newId}`;
      }
    } catch (e) {
      console.error(e);
      message.error(isFeishu ? t('createNew.feishuUrl.importError') : (e as Error).message);
      setLoading(false);
    }
  };

  const handleFeishuAuthorized = useCallback(
    async (token: string) => {
      if (!pendingFeishuImport) return;

      setLoading(true);
      setPendingFeishuImport(null);

      try {
        await finishFeishuImport(
          pendingFeishuImport.knowledgeBaseId,
          pendingFeishuImport.url,
          token,
        );
      } catch (e) {
        console.error(e);
        message.error(t('createNew.feishuUrl.importError'));
        setLoading(false);
      }
    },
    [finishFeishuImport, pendingFeishuImport, t],
  );

  return (
    <>
      <Flexbox gap={16}>
        {!isEditMode && (
          <Segmented
            block
            value={kind}
            options={[
              { label: t('createNew.tabs.normal'), value: 'normal' },
              { label: t('createNew.tabs.feishu'), value: 'feishu' },
            ]}
            onChange={(value) => setKind(value as LibraryKind)}
          />
        )}
        <Input
          autoFocus
          placeholder={t('createNew.name.placeholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Flexbox gap={8}>
          <label style={{ fontSize: 14 }}>{t('createNew.description.label')}</label>
          <TextArea
            placeholder={t('createNew.description.placeholder')}
            style={{ minHeight: 120 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Flexbox>
        {isFeishu && (
          <Flexbox gap={8}>
            <label style={{ fontSize: 14 }}>{t('createNew.feishuUrl.label')}</label>
            <Input
              placeholder={t('createNew.feishuUrl.placeholder')}
              value={feishuUrl}
              onChange={(e) => setFeishuUrl(e.target.value)}
            />
          </Flexbox>
        )}
        <Button block loading={loading} type={'primary'} onClick={handleSubmit}>
          {isEditMode ? t('createNew.edit.confirm') : t('createNew.confirm')}
        </Button>
      </Flexbox>
      {pendingFeishuImport && (
        <FeishuAuthModal
          open
          authUrl={pendingFeishuImport.authUrl}
          onAuthorized={handleFeishuAuthorized}
          onClose={() => setPendingFeishuImport(null)}
        />
      )}
    </>
  );
});

export default CreateForm;
