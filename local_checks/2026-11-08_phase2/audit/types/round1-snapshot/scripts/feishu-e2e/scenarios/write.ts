/* eslint-disable */
/**
 * B 组 · 写入场景。所有写入只落到测试文件夹（folderToken）。
 * 写入后多由模型自行 fetch-doc 回读，断言基于真实捕获的调用参数 + 是否 error。
 */
import { FEISHU_TOOLS } from '../config';
import { type Scenario, defaultAssert } from './types';

const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export const writeScenarios: Scenario[] = [
  {
    expectedTools: [FEISHU_TOOLS.CreateDoc, FEISHU_TOOLS.FetchDoc],
    group: 'write',
    id: 'FS-WRITE-01',
    prompts: (ctx) => [
      `在飞书文件夹（folder_token=${ctx.folderToken}）里新建一篇文档，标题“E2E 冒烟 ${stamp()}”，` +
        `正文用 markdown：一级标题、一段说明文字、一个三行的无序列表。建完后把它读回来确认内容写进去了。`,
    ],
    title: 'create-doc 小文档+回读',
  },
  {
    assert: (calls) => {
      const base = defaultAssert(writeScenarios[1], calls);
      // 额外校验：create-doc 的 markdown 参数足够长 → 大文档确实整体写入（未被截断/转义吞掉）
      const create = calls.find((c) => c.toolName === FEISHU_TOOLS.CreateDoc && !c.isError);
      const md = String(create?.args?.markdown ?? '');
      const notes = [...base.notes];
      let passed = base.passed;
      if (create) {
        notes.push(`create-doc markdown 长度=${md.length}`);
        if (md.length < 300) {
          passed = false;
          notes.push('⚠️ markdown 偏短，疑似被截断/未生成多章节文档');
        }
      }
      return { notes, passed };
    },
    expectedTools: [FEISHU_TOOLS.CreateDoc],
    group: 'write',
    id: 'FS-WRITE-02',
    prompts: (ctx) => [
      `在飞书文件夹 folder_token=${ctx.folderToken} 新建一篇文档，标题“E2E 大文档 ${stamp()}”。` +
        `正文用 markdown：2 个二级章节，每章一段说明文字加一个小表格。` +
        `一次性写入（不要分多次创建）。建完后把文档读回来确认章节都在。`,
    ],
    title: 'create-doc 多章节结构化文档(表格)',
  },
  {
    expectedTools: [FEISHU_TOOLS.CreateDoc, FEISHU_TOOLS.UpdateDoc],
    group: 'write',
    id: 'FS-WRITE-03',
    prompts: (ctx) => [
      `先在文件夹 folder_token=${ctx.folderToken} 新建一篇文档“E2E update 七模式 ${stamp()}”，` +
        `初始正文写三段编号段落。然后对这篇文档依次执行：` +
        `1) 末尾 append 一段“追加内容”；` +
        `2) 在开头 insert_before 一个二级标题；` +
        `3) 用 replace_all 把所有“编号”替换成“章节”；` +
        `每步做完都简单说明结果。`,
    ],
    title: 'update-doc 多模式(append/insert/replace_all)',
  },
  {
    assert: (calls) => {
      const base = defaultAssert(writeScenarios[3], calls);
      const update = calls.find((c) => c.toolName === FEISHU_TOOLS.UpdateDoc && !c.isError);
      const md = String(update?.args?.markdown ?? '');
      const notes = [...base.notes];
      let passed = base.passed;
      if (update) {
        notes.push(`update-doc markdown 长度=${md.length}, mode=${update?.args?.mode}`);
        if (md.length < 150) {
          passed = false;
          notes.push('⚠️ update 的 markdown 偏短，疑似内容被截断');
        }
      }
      return { notes, passed };
    },
    expectedTools: [FEISHU_TOOLS.CreateDoc, FEISHU_TOOLS.UpdateDoc, FEISHU_TOOLS.FetchDoc],
    group: 'write',
    id: 'FS-WRITE-04',
    prompts: (ctx) => [
      `在文件夹 folder_token=${ctx.folderToken} 新建一篇短文档“E2E 内容追加 ${stamp()}”，正文只写一句话。` +
        `然后用 update-doc 的 append 模式，一次性追加 2 个二级章节（每章一段文字和一个小表格），` +
        `完成后读回文档确认追加的章节都在。`,
    ],
    title: 'update-doc 大内容 append 不截断',
  },
  {
    // 诊断：刻意要一篇"大文档"，验证大 markdown 单次写入能否真正执行（不同模型对比）。
    // 默认模型(MiniMax)实测：工具调用渲染出来但 mcp.callTool 不发起 → FAIL。换模型看是否一致。
    assert: (calls) => {
      const create = calls.find((c) => c.toolName === FEISHU_TOOLS.CreateDoc);
      const ok = create && !create.isError;
      const md = String(create?.args?.markdown ?? '');
      const notes: string[] = [];
      let passed = true;
      if (!create) {
        passed = false;
        notes.push('未发起 create-doc（大 tool-call 未执行：渲染了但 mcp.callTool 没发）');
      } else {
        notes.push(`create-doc ${create.isError ? 'ERROR' : 'ok'}，markdown 长度=${md.length}`);
        if (!ok) passed = false;
        if (md.length < 1500) {
          passed = false;
          notes.push('⚠️ markdown < 1500，疑似截断/未生成大文档');
        }
      }
      return { notes, passed };
    },
    expectedTools: [FEISHU_TOOLS.CreateDoc],
    group: 'write',
    id: 'FS-WRITE-06',
    prompts: (ctx) => [
      `在飞书文件夹 folder_token=${ctx.folderToken} 新建一篇内容详尽的长文档，标题“E2E 大文档诊断 ${stamp()}”。` +
        `正文要求 10 个二级章节，每章包含：两段说明文字、一个至少 5 行的 Markdown 表格、一个代码块、一个含勾选项的清单。` +
        `把全部内容一次性作为 markdown 写入（务必一次写完，不要分多次小段创建）。创建后告诉我文档链接。`,
    ],
    title: '大文档执行边界(诊断)',
  },
];
