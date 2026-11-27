/* eslint-disable */
/**
 * A 组 · 只读场景（安全，先跑通真实链路）。
 * prompt 用自然语言诱导模型调对应工具；断言基于真实捕获的工具调用。
 */
import { FEISHU_TOOLS } from '../config';
import type { Scenario } from './types';

export const readScenarios: Scenario[] = [
  {
    expectedTools: [FEISHU_TOOLS.SearchDoc],
    group: 'read',
    id: 'FS-READ-01',
    prompts: () => [
      '帮我在飞书里搜索包含“周报”关键词的文档，按更新时间倒序，先给我第一页结果，再翻到第二页看看。',
    ],
    title: 'search-doc 关键词+排序+翻页',
  },
  {
    expectedTools: [FEISHU_TOOLS.SearchDoc, FEISHU_TOOLS.FetchDoc],
    group: 'read',
    id: 'FS-READ-02',
    prompts: () => [
      '在飞书里找到我最近更新的一篇较长的文档，把它完整读出来；如果内容很长就分页读，并告诉我里面有没有图片或附件的下载链接。',
    ],
    title: 'fetch-doc 大文档分页+媒体链接',
  },
  {
    expectedTools: [FEISHU_TOOLS.ListDocs],
    group: 'read',
    id: 'FS-READ-03',
    prompts: () => [
      '列出我飞书个人云空间（my library）根目录下的文档，如果有子文件夹或子节点，往下再展开一层看看结构。',
    ],
    title: 'list-docs my_library/递归',
  },
  {
    expectedTools: [FEISHU_TOOLS.GetUser],
    group: 'read',
    id: 'FS-READ-05',
    prompts: () => [
      '先告诉我我自己的飞书账号信息（姓名、open_id）；然后帮我搜索一个叫“张”的同事，拿到他的 open_id。',
    ],
    title: 'get-user/search-user 取 open_id',
  },
  {
    expectedTools: [FEISHU_TOOLS.FetchDoc, FEISHU_TOOLS.FetchFile],
    group: 'read',
    id: 'FS-READ-06',
    prompts: () => [
      '找一篇我飞书里带图片或附件的文档，读出它引用的第一个图片/文件的内容；如果文件超过 5MB 就告诉我超限了。',
    ],
    title: 'fetch-file 图片/附件/5MB 限制',
  },
];
