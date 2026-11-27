/* eslint-disable */
import type { ToolCallRecord } from '../lib/mcpCapture';

export interface ScenarioRunCtx {
  /** 写入目标文件夹 token（来自 FEISHU_TEST_FOLDER_TOKEN） */
  folderToken: string;
}

export interface AssertResult {
  notes: string[];
  passed: boolean;
}

export interface Scenario {
  /** read = 只读安全；write = 会写入测试文件夹 */
  group: 'read' | 'write';
  id: string;
  /** 期望被调用到的飞书工具名（用于默认断言） */
  expectedTools: string[];
  /** 依次发送的 prompt（多轮工具链可只发一条复合指令） */
  prompts: (ctx: ScenarioRunCtx) => string[];
  title: string;
  /**
   * 自定义断言。不提供则用默认：expectedTools 至少各被调用一次，且这些调用里
   * 至少有一次非 error。
   */
  assert?: (calls: ToolCallRecord[], ctx: ScenarioRunCtx) => AssertResult;
}

/** 默认断言：每个 expectedTool 至少被调用一次且存在一次成功调用 */
export function defaultAssert(scn: Scenario, calls: ToolCallRecord[]): AssertResult {
  const notes: string[] = [];
  let passed = true;
  for (const tool of scn.expectedTools) {
    const ofTool = calls.filter((c) => c.toolName === tool);
    if (ofTool.length === 0) {
      passed = false;
      notes.push(`未调用 ${tool}`);
      continue;
    }
    const ok = ofTool.some((c) => !c.isError);
    if (!ok) {
      passed = false;
      notes.push(`${tool} 全部失败（${ofTool.length} 次）`);
    } else {
      notes.push(
        `${tool} ✓（${ofTool.length} 次，${ofTool.filter((c) => c.isError).length} 失败）`,
      );
    }
  }
  // 整体若一次工具都没调用，明显失败
  if (calls.length === 0) {
    passed = false;
    notes.push('全程无任何 mcp 工具调用');
  }
  return { notes, passed };
}
