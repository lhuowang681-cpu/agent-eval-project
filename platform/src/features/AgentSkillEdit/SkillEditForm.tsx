'use client';

import {
  ReactCodemirrorPlugin,
  ReactCodePlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { Form, type FormItemProps } from '@lobehub/ui';
import { Form as AForm, type FormInstance, Input } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AvatarPicker from '@/components/AvatarPicker';
import { useFileStore } from '@/store/file';

const styles = createStaticStyles(({ css }) => ({
  editorWrapper: css`
    min-height: 200px;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;
  `,
  wrapper: css`
    max-width: 798px;
    margin-inline: auto;
    padding-block: 0;
    padding-inline: 24px;
  `,
}));

const PLUGINS = [
  ReactListPlugin,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactTablePlugin,
  ReactMathPlugin,
];

export interface SkillEditFormValues {
  backgroundColor?: string;
  content: string;
  description: string;
  icon?: string;
}

interface SkillEditFormProps {
  form: FormInstance;
  initialValues: SkillEditFormValues;
  name?: string;
  onSubmit: (values: SkillEditFormValues) => void;
}

const AvatarField = ({ form }: { form: FormInstance }) => {
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const icon = AForm.useWatch('icon', form) as string | undefined;
  const backgroundColor = AForm.useWatch('backgroundColor', form) as string | undefined;
  return (
    <AvatarPicker
      allowBackgroundColor
      avatar={icon}
      backgroundColor={backgroundColor}
      onAvatarChange={(v) => form.setFieldValue('icon', v)}
      onBackgroundColorChange={(c) => form.setFieldValue('backgroundColor', c)}
      onUpload={async (file) => {
        const r = await uploadWithProgress({ file });
        return r?.url;
      }}
    />
  );
};

const SkillEditForm = memo<SkillEditFormProps>(({ name, form, initialValues, onSubmit }) => {
  const { t } = useTranslation('setting');
  const editor = useEditor();
  const currentValueRef = useRef(initialValues.content);

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [initialValues]);

  useEffect(() => {
    currentValueRef.current = initialValues.content;
  }, [initialValues.content]);

  useEffect(() => {
    if (!editor) return;
    try {
      setTimeout(() => {
        if (initialValues.content) {
          editor.setDocument('markdown', initialValues.content);
        }
      }, 100);
    } catch {
      setTimeout(() => {
        editor.setDocument('markdown', initialValues.content);
      }, 100);
    }
  }, [editor, initialValues.content]);

  const handleContentChange = useCallback(
    (e: any) => {
      const nextContent = (e.getDocument('markdown') as unknown as string) || '';
      if (nextContent !== currentValueRef.current) {
        currentValueRef.current = nextContent;
        form.setFieldValue('content', nextContent);
      }
    },
    [form],
  );

  const items: FormItemProps[] = [
    {
      children: <AvatarField form={form} />,
      label: t('avatarPicker.label', { ns: 'common' }),
    },
    {
      children: <Input disabled readOnly value={name} />,
      desc: t('agentSkillEdit.nameDesc'),
      label: t('settingAgent.name.title'),
    },
    {
      children: (
        <Input.TextArea
          autoSize={{ maxRows: 4, minRows: 2 }}
          placeholder={t('agentSkillModal.descriptionPlaceholder')}
        />
      ),
      desc: t('agentSkillEdit.descriptionDesc'),
      label: t('agentSkillModal.description'),
      name: 'description',
    },
    {
      children: (
        <div className={styles.editorWrapper}>
          <Editor
            content={''}
            editor={editor}
            lineEmptyPlaceholder={t('agentSkillEdit.instructionsPlaceholder')}
            placeholder={t('agentSkillEdit.instructionsPlaceholder')}
            plugins={PLUGINS}
            style={{ paddingBottom: 48 }}
            type={'text'}
            variant={'chat'}
            onTextChange={handleContentChange}
          />
        </div>
      ),
      desc: t('agentSkillEdit.instructionsDesc'),
      label: t('agentSkillEdit.instructions'),
    },
  ];

  return (
    <div className={styles.wrapper}>
      <Form
        form={form}
        gap={0}
        initialValues={initialValues}
        items={items}
        itemsType={'flat'}
        layout={'vertical'}
        variant={'borderless'}
        onFinish={onSubmit}
      >
        <AForm.Item hidden name="content">
          <Input type="hidden" />
        </AForm.Item>
        <AForm.Item hidden name="icon">
          <Input type="hidden" />
        </AForm.Item>
        <AForm.Item hidden name="backgroundColor">
          <Input type="hidden" />
        </AForm.Item>
      </Form>
    </div>
  );
});

SkillEditForm.displayName = 'SkillEditForm';

export default SkillEditForm;
