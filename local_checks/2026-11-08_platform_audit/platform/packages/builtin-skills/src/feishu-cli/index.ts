import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';

export const FeishuCliIdentifier = 'lobe-feishu-cli';

export const FeishuCliSkill: BuiltinSkill = {
  avatar: '🐦',
  content: systemPrompt,
  description:
    "Operate the user's Feishu/Lark (飞书) account via the bundled lark-cli: messages, docs, calendar, spreadsheets, Base, tasks, mail, wiki, video conferences, contacts and more. Use for ANY 飞书/Lark task — including reading or summarizing any Feishu/Lark doc, wiki, Base or sheet LINK (feishu.cn, *.larkenterprise.com, *.feishu.cn/wiki|/docx|/base). These are internal pages a generic web fetch CANNOT reach, so prefer this skill over web browsing for such links. Desktop only; requires a one-time authorization in Settings.",
  identifier: FeishuCliIdentifier,
  name: 'Feishu CLI',
  source: 'builtin',
};
