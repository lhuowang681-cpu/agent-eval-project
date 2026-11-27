// @vitest-environment node
import { AgentRuntime } from '@lobechat/agent-runtime';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 双运行时一致性对照。
 *
 * 本项目把同一个 Brain（`packages/agent-runtime`）同时跑在两处，只替换 executor：
 *   · 服务端 `src/server/modules/AgentRuntime/RuntimeExecutors.ts`
 *   · 客户端 `src/store/chat/agents/createAgentExecutors.ts`
 *
 * 两份实现之间**没有共享代码、也没有任何一致性约束**，此前只验证过「两者都存在」，
 * 从未做过覆盖面比对。本用例补上这一层：任何一侧新增/漏掉指令都会在这里失败。
 *
 * ⚠️ 为什么用静态解析而不是 import：
 * 两个工厂各自拖着重量级依赖（服务端要数据库与 S3，客户端是 3000 行 zustand store），
 * 在单测里实例化它们需要造一大堆桩，桩本身会成为新的失真来源。这里要回答的问题是
 * 「注册了哪些指令键」—— 那是源码里的**字面结构**，静态解析足够且更稳。
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

const SERVER_EXECUTORS = path.join(
  REPO_ROOT,
  'src/server/modules/AgentRuntime/RuntimeExecutors.ts',
);
const CLIENT_EXECUTORS = path.join(REPO_ROOT, 'src/store/chat/agents/createAgentExecutors.ts');
const INSTRUCTION_TYPES = path.join(
  REPO_ROOT,
  'packages/agent-runtime/src/types/instruction.ts',
);
const RUNTIME_CORE = path.join(REPO_ROOT, 'packages/agent-runtime/src/core/runtime.ts');

const read = (file: string) => fs.readFileSync(file, 'utf8');

/** 从 instruction.ts 抽出全部指令类型（`type: 'xxx';`） */
const collectInstructionTypes = (): string[] => {
  const source = read(INSTRUCTION_TYPES);
  const found = [...source.matchAll(/^\s*type: '([a-z_]+)';/gm)].map((m) => m[1]);
  return [...new Set(found)].sort();
};

/** 抽出某个 executor 工厂里注册的指令键（形如 `  exec_task: async (…)` ） */
const collectExecutorKeys = (file: string, candidates: string[]): string[] => {
  const source = read(file);
  return candidates
    .filter((type) => new RegExp(`^\\s+${type}\\s*:\\s*(async\\s*)?\\(`, 'm').test(source))
    .sort();
};

/** AgentRuntime 构造函数里自带的内置 executor —— 两侧都能白拿 */
const collectBuiltinKeys = (candidates: string[]): string[] => {
  const source = read(RUNTIME_CORE);
  const ctor = source.slice(source.indexOf('this.executors = {'), source.indexOf('...config.executors'));
  return candidates.filter((type) => new RegExp(`^\\s+${type}:`, 'm').test(ctor)).sort();
};

describe('双运行时 executor 覆盖一致性', () => {
  const allTypes = collectInstructionTypes();

  it('指令类型清单应保持 13 种（新增指令必须同步评估两侧覆盖）', () => {
    expect(allTypes).toEqual([
      'call_llm',
      'call_tool',
      'call_tools_batch',
      'compress_context',
      'exec_client_task',
      'exec_client_tasks',
      'exec_task',
      'exec_tasks',
      'finish',
      'request_human_approve',
      'request_human_prompt',
      'request_human_select',
      'resolve_aborted_tools',
    ]);
  });

  it('AgentRuntime 自带 6 个内置 executor', () => {
    expect(collectBuiltinKeys(allTypes)).toEqual([
      'call_llm',
      'call_tool',
      'finish',
      'request_human_approve',
      'request_human_prompt',
      'request_human_select',
    ]);
  });

  it('服务端仅缺 4 个 exec_* 指令（附录 A.3 的结构性论断）', () => {
    const covered = new Set([
      ...collectBuiltinKeys(allTypes),
      ...collectExecutorKeys(SERVER_EXECUTORS, allTypes),
      // `call_tools_batch` 在 runtime.step() 里有显式内置兜底，不算缺口
      'call_tools_batch',
    ]);

    const missing = allTypes.filter((t) => !covered.has(t));

    /*
     * 这 4 个缺口是**已知且当前未修**的：服务端 Brain 一旦产出它们，
     * `runtime.step()` 会抛 `No executor found for instruction type`
     * （见下一条用例的实证）。
     *
     * 若本断言失败：
     *   · 缺口变多 → 有人往 Brain 加了新指令却没给服务端 executor
     *   · 缺口变少 → 缺口被补上了，请同步更新 plan.md 附录 A.3 与本断言
     */
    expect(missing).toEqual(['exec_client_task', 'exec_client_tasks', 'exec_task', 'exec_tasks']);
  });

  it('客户端覆盖全部指令，无缺口', () => {
    const covered = new Set([
      ...collectBuiltinKeys(allTypes),
      ...collectExecutorKeys(CLIENT_EXECUTORS, allTypes),
      'call_tools_batch',
    ]);

    expect(allTypes.filter((t) => !covered.has(t))).toEqual([]);
  });

  it('两侧覆盖差集即为服务端的 exec_* 缺口', () => {
    const serverCovered = new Set([
      ...collectBuiltinKeys(allTypes),
      ...collectExecutorKeys(SERVER_EXECUTORS, allTypes),
      'call_tools_batch',
    ]);
    const clientCovered = new Set([
      ...collectBuiltinKeys(allTypes),
      ...collectExecutorKeys(CLIENT_EXECUTORS, allTypes),
      'call_tools_batch',
    ]);

    const onlyClient = [...clientCovered].filter((t) => !serverCovered.has(t)).sort();
    const onlyServer = [...serverCovered].filter((t) => !clientCovered.has(t)).sort();

    expect(onlyClient).toEqual([
      'exec_client_task',
      'exec_client_tasks',
      'exec_task',
      'exec_tasks',
    ]);
    // 服务端没有客户端缺的东西 —— 差异是单向的
    expect(onlyServer).toEqual([]);
  });
});

describe('附录 A.3 实证：缺失 executor 时 step() 的真实行为', () => {
  /**
   * 此前只验证过「execTask 作为**工具**被调用」这条路，没有构造出
   * 「Brain 产出 `exec_task` **指令**」的场景，所以 A.3 一直只是结构性推断。
   *
   * 这里直接让 Agent 产出该指令，用不含 exec_* 的 executor 集合（即服务端的形态）
   * 跑一步，观察真实结果。
   */
  const makeAgent = (instructionType: string) =>
    ({
      executors: {},
      runner: async () => ({
        payload: { parentMessageId: 'msg-1', task: { id: 't1' } },
        type: instructionType,
      }),
      tools: {},
    }) as any;

  it('exec_task 指令未注册时被 catch 成 error 状态，而非抛到调用方', async () => {
    const runtime = new AgentRuntime(makeAgent('exec_task'));
    const state = AgentRuntime.createInitialState({ operationId: 'a3-exec-task' });

    const result = await runtime.step(state);

    // step() 不会向外抛 —— 错误被吞进事件与状态，这正是 A.3 说的
    // 「被 catch 成 error 状态」：调用方看不到堆栈，只看到运行失败。
    expect(result.newState.status).toBe('error');
    expect(result.events.some((e: any) => e.type === 'error')).toBe(true);

    const message = result.events
      .filter((e: any) => e.type === 'error')
      .map((e: any) => String(e.error?.message ?? e.error))
      .join(' | ');

    expect(message).toContain('No executor found for instruction type: exec_task');
  });

  it('四个 exec_* 指令表现一致', async () => {
    for (const type of ['exec_task', 'exec_tasks', 'exec_client_task', 'exec_client_tasks']) {
      const runtime = new AgentRuntime(makeAgent(type));
      const result = await runtime.step(
        AgentRuntime.createInitialState({ operationId: `a3-${type}` }),
      );

      expect(result.newState.status, `${type} 应进入 error 状态`).toBe('error');
      const message = result.events
        .filter((e: any) => e.type === 'error')
        .map((e: any) => String(e.error?.message ?? e.error))
        .join(' | ');
      expect(message, `${type} 的错误信息`).toContain(
        `No executor found for instruction type: ${type}`,
      );
    }
  });

  it('对照组：已注册的 finish 指令正常执行，不进入 error', async () => {
    const runtime = new AgentRuntime({
      executors: {},
      runner: async () => ({ reason: 'completed', reasonDetail: 'ok', type: 'finish' }),
      tools: {},
    } as any);

    const result = await runtime.step(
      AgentRuntime.createInitialState({ operationId: 'a3-control' }),
    );

    expect(result.newState.status).not.toBe('error');
  });
});
