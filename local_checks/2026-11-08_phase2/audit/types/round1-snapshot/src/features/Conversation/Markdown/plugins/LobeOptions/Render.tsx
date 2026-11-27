import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';
import { messageStateSelectors } from '@/store/chat/selectors';
import { dotLoading } from '@/styles/loading';

import { type MarkdownElementProps } from '../type';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    height: 100%;
    text-align: center;
  `,
  desc: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;

    width: 100%;
    margin-block-start: 12px;
  `,
  icon: css`
    font-size: 32px;
    line-height: 1.2;
  `,
  loading: css`
    margin-block-start: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    font-size: 15px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface OptionItem {
  desc?: string;
  icon?: string;
  prompt?: string;
  title: string;
}

const Render = memo<MarkdownElementProps>(({ children, id }) => {
  const { t } = useTranslation('chat');
  const [sendMessage] = useConversationStore((s) => [s.sendMessage]);
  const isGenerating = useChatStore(messageStateSelectors.isMessageGenerating(id));

  const raw = ((children as string) || '').toString?.() ?? '';

  let items: OptionItem[] | undefined;
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    items = undefined;
  }

  // Content not yet parseable: show a loading hint while still streaming, otherwise render nothing
  if (!items || items.length === 0) {
    if (isGenerating) {
      return (
        <Flexbox horizontal className={cx(styles.loading, dotLoading)}>
          {t('artifact.generating')}
        </Flexbox>
      );
    }
    return null;
  }

  return (
    <div className={styles.grid}>
      {items.map((item, index) => (
        <Block
          clickable
          className={styles.card}
          key={`${item.title}-${index}`}
          paddingBlock={20}
          paddingInline={16}
          variant={'outlined'}
          onClick={() => sendMessage({ message: item.prompt || item.title })}
        >
          <Flexbox align={'center'} gap={8}>
            {item.icon && <div className={styles.icon}>{item.icon}</div>}
            <div className={styles.title}>{item.title}</div>
            {item.desc && <div className={styles.desc}>{item.desc}</div>}
          </Flexbox>
        </Block>
      ))}
    </div>
  );
});

export default Render;
