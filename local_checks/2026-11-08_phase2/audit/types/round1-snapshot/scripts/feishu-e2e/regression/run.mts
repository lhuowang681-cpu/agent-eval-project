/* eslint-disable */
/**
 * C 组 · 确定性 mock 回归。锁定已修 bug 的稳定 pass/fail 基线。
 *
 * 用法：
 *   bunx tsx scripts/feishu-e2e/regression/run.mts            # 全部浏览器回归
 *   bunx tsx scripts/feishu-e2e/regression/run.mts FS-REG-02  # 单个
 *
 * 注：FS-REG-03（条件 schema 契约）是纯 Ajv 单测，不在此浏览器套件，单独跑：
 *   bunx vitest run --silent='passed-only' src/services/feishuUpdateDocSchema.test.ts
 */
import {
  FEISHU_UPDATE_TOOL,
  type MockScenario,
  mcpBizError,
  mcpOk,
  runMockScenario,
  sseText,
  sseToolCall,
} from './mockHarness.mjs';

// 故意无 markdown 的固定 args（每轮完全相同 → 触发熔断）
const EMPTY_MD_APPEND = JSON.stringify({ doc_id: 'D_REPRO', mode: 'append' });
const EMPTY_MD_OVERWRITE = JSON.stringify({ doc_id: 'D_REPRO', mode: 'overwrite' });

// LLM 转义把整段 markdown 吞进 doc_id（模仿 b9af8b0d 真实畸形）。
// 关键：被吞的值必须以 "} 收尾，repairer 重建 `{"doc_id": "<value>` 才是合法 JSON。
const ESCAPED_INTO_DOCID = JSON.stringify({
  doc_id: 'D_ESCAPED", "markdown": "# 已恢复标题 正文被转义吞掉又救回", "mode": "append"}',
});

const scenarios: MockScenario[] = [
  {
    // FS-REG-01：空 markdown 死循环 → 连续 3 次相同失败触发熔断
    assert: (s) => {
      const notes: string[] = [];
      let passed = true;
      if (s.mcpCallCount === 0) {
        passed = false;
        notes.push('未发生任何工具调用（mock 未生效？）');
      }
      if (s.mcpCallCount > 4) {
        passed = false;
        notes.push(`调用 ${s.mcpCallCount} 次，未在阈值内熔断`);
      } else {
        notes.push(`调用 ${s.mcpCallCount} 次（≤3 阈值内）`);
      }
      if (!s.breakerShown) {
        passed = false;
        notes.push('未出现熔断提示文案');
      } else notes.push('出现熔断提示');
      return { notes, passed };
    },
    buildSSE: () => sseToolCall(FEISHU_UPDATE_TOOL, EMPTY_MD_APPEND),
    id: 'FS-REG-01',
    injectFakeToken: true,
    mcpHandler: () => mcpBizError('[VALIDATION:1002] Markdown content cannot be empty'),
    observeMs: 22_000,
    title: '空 markdown 死循环熔断',
  },
  {
    // FS-REG-02：转义把 markdown 吞进 doc_id → ToolArgumentsRepairer 救回
    assert: (s) => {
      const notes: string[] = [];
      let passed = true;
      const first = s.capturedArgs[0];
      const md = first?.markdown ?? '';
      notes.push(`首个调用 args: doc_id=${String(first?.doc_id).slice(0, 20)}..., markdown长度=${String(md).length}`);
      if (!md || String(md).length < 5) {
        passed = false;
        notes.push('⚠️ markdown 仍为空，repairer 未救回');
      } else if (!String(md).includes('已恢复')) {
        notes.push('⚠️ markdown 非空但内容不符预期');
      } else {
        notes.push('repairer 成功救回 markdown ✓');
      }
      return { notes, passed };
    },
    buildSSE: (turn) =>
      turn === 0 ? sseToolCall(FEISHU_UPDATE_TOOL, ESCAPED_INTO_DOCID) : sseText('已经写好了。'),
    id: 'FS-REG-02',
    injectFakeToken: true,
    mcpHandler: () => mcpOk(JSON.stringify({ doc_id: 'D_ESCAPED', ok: true })),
    observeMs: 16_000,
    title: '转义吞 markdown → repairer 救回',
  },
  {
    // FS-REG-04：UAT 失效 → 收敛为授权卡片而非死循环
    assert: (s) => {
      const notes: string[] = [];
      let passed = true;
      notes.push(`mcp 调用 ${s.mcpCallCount} 次`);
      // 鉴权错误应被客户端拦截并清 token，不应反复重试堆积
      if (s.mcpCallCount > 3) {
        passed = false;
        notes.push('⚠️ 鉴权失败仍反复重试，未收敛');
      }
      // 授权卡片：页面应出现授权/重新授权相关文案
      const authCard = /授权|登录飞书|重新授权|authorize|connect.*feishu/i.test(s.bodyText);
      if (!authCard) {
        notes.push('未检测到授权卡片文案（请看录屏人工确认）');
      } else notes.push('出现授权卡片 ✓');
      return { notes, passed };
    },
    buildSSE: (turn) =>
      turn === 0
        ? sseToolCall(FEISHU_UPDATE_TOOL, JSON.stringify({ doc_id: 'D1', markdown: '# hi', mode: 'append' }))
        : sseText('好的。'),
    id: 'FS-REG-04',
    injectFakeToken: true,
    mcpHandler: () => mcpBizError('401 invalid access token, token expired'),
    observeMs: 16_000,
    title: 'UAT 失效 → 授权卡片',
  },
  {
    // FS-REG-05：Mecha loop（streamingExecutor）熔断 —— overwrite 模式同样按 args 签名熔断
    assert: (s) => {
      const notes: string[] = [];
      let passed = true;
      if (s.mcpCallCount > 4) {
        passed = false;
        notes.push(`调用 ${s.mcpCallCount} 次，Mecha 循环未熔断`);
      } else notes.push(`调用 ${s.mcpCallCount} 次（阈值内）`);
      if (!s.breakerShown) {
        passed = false;
        notes.push('未出现熔断提示');
      } else notes.push('Mecha 循环熔断生效 ✓');
      return { notes, passed };
    },
    buildSSE: () => sseToolCall(FEISHU_UPDATE_TOOL, EMPTY_MD_OVERWRITE),
    id: 'FS-REG-05',
    injectFakeToken: true,
    mcpHandler: () => mcpBizError('[VALIDATION:1002] Markdown content cannot be empty'),
    observeMs: 22_000,
    title: 'Mecha loop 熔断(overwrite)',
  },
];

async function main() {
  const want = process.argv[2];
  const list = want ? scenarios.filter((s) => s.id.toLowerCase() === want.toLowerCase()) : scenarios;
  if (list.length === 0) {
    console.error('未匹配场景。可选：', scenarios.map((s) => s.id).join(', '));
    process.exit(1);
  }
  const results: { id: string; notes: string[]; passed: boolean }[] = [];
  for (const scn of list) {
    console.log(`\n=== ${scn.id} · ${scn.title} ===`);
    const v = await runMockScenario(scn);
    results.push({ id: scn.id, ...v });
  }
  console.log('\n================ 回归汇总 ================');
  for (const r of results) console.log(`${r.passed ? '✅' : '❌'} ${r.id} | ${r.notes.join('；')}`);
  const pass = results.filter((r) => r.passed).length;
  console.log(`通过 ${pass}/${results.length}`);
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
