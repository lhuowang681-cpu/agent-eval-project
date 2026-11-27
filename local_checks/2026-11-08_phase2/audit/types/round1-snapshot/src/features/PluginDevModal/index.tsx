import { isDesktop } from '@lobechat/const';
import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { type LobeToolCustomPlugin } from '@lobechat/types';
import { Button, Drawer, Flexbox } from '@lobehub/ui';
import { App, Form, Popconfirm } from 'antd';
import { useResponsive } from 'antd-style';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import MCPManifestForm from './MCPManifestForm';
import {
  ensureMcpCreateFormValues,
  hasMcpConnectionChanged,
  serializeMcpConnection,
} from './MCPManifestForm/mcpFormSync';
import PluginPreview from './PluginPreview';

interface DevModalProps {
  mode?: 'edit' | 'create';
  onDelete?: () => void;
  onOpenChange: (open: boolean) => void;
  onSave?: (value: LobeToolCustomPlugin) => Promise<void> | void;
  onValueChange?: (value: Partial<LobeToolCustomPlugin>) => void;
  open?: boolean;
  value?: LobeToolCustomPlugin;
}

const DevModal = memo<DevModalProps>(
  ({ open, mode = 'create', value, onValueChange, onSave, onOpenChange, onDelete }) => {
    const isEditMode = mode === 'edit';
    const { t } = useTranslation('plugin');
    const { message } = App.useApp();
    const pluginIds = useToolStore(pluginSelectors.storeAndInstallPluginsIdList);
    const testMcpConnection = useToolStore((s) => s.testMcpConnection);

    const [submitting, setSubmitting] = useState(false);
    const initialConnectionRef = useRef<string | undefined>();

    const { mobile } = useResponsive();
    const [form] = Form.useForm();
    useEffect(() => {
      if (open && value) {
        form.setFieldsValue(value);
        initialConnectionRef.current = serializeMcpConnection(
          value.customParams?.mcp as Record<string, unknown> | undefined,
        );
      }
    }, [open, value, form]);

    useEffect(() => {
      if (mode === 'create' && !open) {
        form.resetFields();
        initialConnectionRef.current = undefined;
      }
    }, [open, mode, form]);

    const verifyConnectionBeforeSave = async (
      values: LobeToolCustomPlugin,
    ): Promise<LobeToolCustomPlugin> => {
      const mcp = values.customParams?.mcp;
      if (!mcp) return values;

      const needsTest =
        mode === 'create' ||
        hasMcpConnectionChanged(initialConnectionRef.current, mcp as Record<string, unknown>);

      if (!needsTest) return values;

      const title = values.manifest?.meta?.title;
      const existingReadme = (values.manifest?.meta as { readme?: string } | undefined)?.readme;
      const result = await testMcpConnection({
        connection: mcp,
        identifier: values.identifier,
        metadata: {
          avatar: values.customParams?.avatar,
          description: values.customParams?.description,
          name: title,
        },
      });

      if (!result.success || !result.manifest) {
        throw new Error(result.error || t('protocolInstall.messages.connectionTestFailed'));
      }

      const mergedMeta: Record<string, unknown> = {
        ...result.manifest.meta,
        title: title || result.manifest.meta?.title,
      };
      const readmeToKeep =
        existingReadme || (result.manifest.meta as { readme?: string } | undefined)?.readme;
      if (readmeToKeep) mergedMeta.readme = readmeToKeep;

      return {
        ...values,
        manifest: {
          ...result.manifest,
          meta: mergedMeta as unknown as (typeof result.manifest)['meta'],
        },
      };
    };

    const buttonStyle = mobile ? { flex: 1 } : { margin: 0 };

    const footer = (
      <Flexbox horizontal flex={1} gap={12} justify={'space-between'}>
        {isEditMode ? (
          <Popconfirm
            arrow={false}
            cancelText={t('cancel', { ns: 'common' })}
            okText={t('ok', { ns: 'common' })}
            placement={'topLeft'}
            title={t('dev.confirmDeleteDevPlugin')}
            okButtonProps={{
              danger: true,
              type: 'primary',
            }}
            onConfirm={() => {
              onDelete?.();
              message.success(t('dev.deleteSuccess'));
            }}
          >
            <Button danger style={buttonStyle}>
              {t('delete', { ns: 'common' })}
            </Button>
          </Popconfirm>
        ) : (
          <div />
        )}
        <Flexbox horizontal gap={12}>
          <Button
            style={buttonStyle}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            loading={submitting}
            style={buttonStyle}
            type={'primary'}
            onClick={() => {
              const identifier = form.getFieldValue('identifier');
              if (!isEditMode && identifier && pluginIds.includes(identifier)) {
                message.warning(t('dev.mcp.duplicateInstall'));
                void form.validateFields(['identifier']).catch(() => undefined);
                return;
              }
              form.submit();
            }}
          >
            {t(isEditMode ? 'dev.update' : 'dev.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    );

    return (
      <Form.Provider
        onFormChange={() => {
          onValueChange?.(form.getFieldsValue());
        }}
        onFormFinish={async (_, info) => {
          let values = (
            isEditMode
              ? (info.values as LobeToolCustomPlugin)
              : ensureMcpCreateFormValues(info.values as LobeToolCustomPlugin)
          ) as LobeToolCustomPlugin;

          if (onSave) {
            setSubmitting(true);
            try {
              values = await verifyConnectionBeforeSave(values);
              await onSave?.(values);
              message.success(t(isEditMode ? 'dev.updateSuccess' : 'dev.saveSuccess'));
              onOpenChange(false);
            } catch (error) {
              console.error('[DevModal] Install failed:', error);
              const errorMessage = error instanceof Error ? error.message : t('dev.saveError');
              message.error(
                errorMessage === t('protocolInstall.messages.connectionTestFailed') ||
                  errorMessage.includes('Connection')
                  ? t('error.testConnectionFailed', { error: errorMessage })
                  : errorMessage || t('dev.saveError'),
              );
            } finally {
              setSubmitting(false);
            }
            return;
          }
          message.success(t(isEditMode ? 'dev.updateSuccess' : 'dev.saveSuccess'));
          onOpenChange(false);
        }}
      >
        <Drawer
          destroyOnHidden
          containerMaxWidth={'auto'}
          footer={footer}
          height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
          open={open}
          placement={'bottom'}
          push={false}
          title={t(isEditMode ? 'dev.title.skillSettings' : 'dev.title.create')}
          width={mobile ? '100%' : 800}
          styles={{
            body: {
              padding: 0,
            },
            bodyContent: {
              height: '100%',
            },
          }}
          onClose={(e) => {
            e.stopPropagation();
            onOpenChange(false);
          }}
        >
          <Flexbox
            horizontal
            gap={0}
            height={'100%'}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Flexbox flex={3} gap={16} padding={24} style={{ overflowY: 'auto' }}>
              <MCPManifestForm form={form} isEditMode={isEditMode} />
            </Flexbox>
            <PluginPreview form={form} />
          </Flexbox>
        </Drawer>
      </Form.Provider>
    );
  },
);

export default DevModal;
