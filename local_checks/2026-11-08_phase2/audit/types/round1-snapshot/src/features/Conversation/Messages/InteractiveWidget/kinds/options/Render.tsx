import type { OptionsWidgetDefinition } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { useConversationStore } from '@/features/Conversation/store';

import type { InteractiveWidgetRenderProps } from '../../registry';

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
  `,
  icon: css`
    font-size: 32px;
    line-height: 1.2;
  `,
  title: css`
    font-size: 15px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const OptionsWidget = memo<InteractiveWidgetRenderProps<OptionsWidgetDefinition>>(
  ({ definition }) => {
    const sendMessage = useConversationStore((s) => s.sendMessage);

    return (
      <div className={styles.grid}>
        {definition.items.map((item, index) => (
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
  },
);

OptionsWidget.displayName = 'OptionsWidget';

export default OptionsWidget;
