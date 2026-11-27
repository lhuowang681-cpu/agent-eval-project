import { Accordion, Flexbox } from '@lobehub/ui';
import { type Key, memo, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import CronTopicList from './Cron';
import TaskList from './Task';
import Topic from './Topic';

export enum ChatSidebarKey {
  CronTopics = 'cronTopics',
  Tasks = 'tasks',
  Topic = 'topic',
}

const Body = memo(() => {
  const { taskId, cronId } = useParams<{ cronId?: string; taskId?: string }>();
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(() => {
    if (taskId) return [ChatSidebarKey.Topic, ChatSidebarKey.Tasks];
    if (cronId) return [ChatSidebarKey.Topic, ChatSidebarKey.CronTopics];
    return [ChatSidebarKey.Topic];
  });

  // 从任务列表/待办卡片跳转到具体任务或定时任务详情页时，自动展开对应分组，
  // 这样已在 StatusGroup/CronTopicGroup 中算出的 active 高亮项才会可见
  useEffect(() => {
    if (!taskId) return;
    setExpandedKeys((keys) =>
      keys.includes(ChatSidebarKey.Tasks) ? keys : [...keys, ChatSidebarKey.Tasks],
    );
  }, [taskId]);

  useEffect(() => {
    if (!cronId) return;
    setExpandedKeys((keys) =>
      keys.includes(ChatSidebarKey.CronTopics) ? keys : [...keys, ChatSidebarKey.CronTopics],
    );
  }, [cronId]);

  return (
    <Flexbox paddingInline={4}>
      <Accordion expandedKeys={expandedKeys} gap={8} onExpandedChange={setExpandedKeys}>
        <CronTopicList itemKey={ChatSidebarKey.CronTopics} />
        <TaskList itemKey={ChatSidebarKey.Tasks} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
