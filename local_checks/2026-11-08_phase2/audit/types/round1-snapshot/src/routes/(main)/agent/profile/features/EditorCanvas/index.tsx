'use client';

import { ReactMentionPlugin, ReactTablePlugin, ReactToolbarPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createChatInputRichPlugins } from '@/features/ChatInput/InputEditor/plugins';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { EMPTY_EDITOR_STATE } from '../constants';
import { useMentionOptions } from '../ProfileEditor/MentionList';
import { useProfileStore } from '../store';
import TypoBar from './TypoBar';
import { useSlashItems } from './useSlashItems';

const styles = createStaticStyles(({ css }) => ({
  desc: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  editorShell: css`
    min-height: 300px;
    padding-block: 18px;
    padding-inline: 18px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    max-width: 820px;
  `,
  root: css`
    padding-block-end: 16px;
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const EditorCanvas = memo(() => {
  const { t } = useTranslation('setting');
  const [editorInit, setEditorInit] = useState(false);
  const [contentInit, setContentInit] = useState(false);
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const editorData = config?.editorData;
  const systemRole = config?.systemRole;
  const updateConfig = useAgentStore((s) => s.updateAgentConfig);
  const [initialLoad] = useState(
    editorData === undefined || editorData?.root === undefined ? EMPTY_EDITOR_STATE : editorData,
  );
  const mentionOptions = useMentionOptions();
  const editor = useProfileStore((s) => s.editor);
  const handleContentChange = useProfileStore((s) => s.handleContentChange);
  const slashItems = useSlashItems();

  // Streaming state from AgentStore
  const streamingSystemRole = useAgentStore((s) => s.streamingSystemRole);
  const streamingInProgress = useAgentStore((s) => s.streamingSystemRoleInProgress);
  const prevStreamingRef = useRef<string | undefined>(undefined);
  const wasStreamingRef = useRef(false);

  // Wrap handleContentChange with updateConfig
  const handleChange = useCallback(() => {
    // Don't trigger save during streaming
    if (streamingInProgress) return;
    handleContentChange(updateConfig);
  }, [handleContentChange, updateConfig, streamingInProgress]);

  // Handle streaming updates - update editor with streaming content
  useEffect(() => {
    if (!editor || !editorInit) return;
    if (!streamingInProgress) {
      prevStreamingRef.current = undefined;
      return;
    }

    // Only update if content has changed
    if (streamingSystemRole !== prevStreamingRef.current) {
      prevStreamingRef.current = streamingSystemRole;
      try {
        editor.setDocument('markdown', streamingSystemRole || '');
      } catch {
        // Ignore errors during streaming updates
      }
    }
  }, [editor, editorInit, streamingSystemRole, streamingInProgress]);

  // Trigger save when streaming ends
  useEffect(() => {
    if (wasStreamingRef.current && !streamingInProgress && editor && editorInit) {
      // Streaming just ended, wait for editor to update its internal state then save
      // This ensures editorData (json) is properly updated from the markdown content
      const timer = setTimeout(() => {
        handleContentChange(updateConfig);
      }, 100);
      return () => clearTimeout(timer);
    }
    wasStreamingRef.current = !!streamingInProgress;
  }, [streamingInProgress, editor, editorInit, handleContentChange, updateConfig]);

  useEffect(() => {
    if (!editorInit || !editor || contentInit) return;
    // Don't init if streaming is in progress
    if (streamingInProgress) return;
    try {
      if (editorData && editorData?.root !== undefined) {
        editor.setDocument('json', editorData);
      } else if (systemRole) {
        editor.setDocument('markdown', systemRole);
      }
      // If no editorData and no systemRole, leave editor empty to show placeholder
      setContentInit(true);
    } catch (error) {
      console.error('[EditorCanvas] Failed to init editor content:', error);
    }
  }, [editorInit, contentInit, editor, editorData, systemRole, streamingInProgress]);

  return (
    <Flexbox className={styles.root} gap={16}>
      <Flexbox className={styles.header} gap={4}>
        <div className={styles.title}>{t('settingAgent.prompt.title')}</div>
        <div className={styles.desc}>{t('settingAgent.prompt.desc')}</div>
      </Flexbox>
      <div
        className={styles.editorShell}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <Editor
          content={initialLoad}
          editor={editor!}
          lineEmptyPlaceholder={t('settingAgent.prompt.editorPlaceholder')}
          mentionOption={mentionOptions}
          placeholder={t('settingAgent.prompt.editorPlaceholder')}
          style={{ paddingBottom: 0 }}
          plugins={[
            ...createChatInputRichPlugins(),
            ReactTablePlugin,
            ReactMentionPlugin,
            Editor.withProps(ReactToolbarPlugin, {
              children: <TypoBar />,
            }),
          ]}
          slashOption={{
            items: slashItems,
          }}
          onInit={() => setEditorInit(true)}
          onTextChange={handleChange}
        />
      </div>
    </Flexbox>
  );
});

export default EditorCanvas;
