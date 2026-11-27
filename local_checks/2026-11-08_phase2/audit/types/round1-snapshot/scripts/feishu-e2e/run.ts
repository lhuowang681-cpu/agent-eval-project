/* eslint-disable */
/**
 * 入口：跑真实模式场景（A/B 组）与跨模型矩阵（D 组）。
 *
 * 用法：
 *   bunx tsx scripts/feishu-e2e/run.ts --scenario FS-READ-01
 *   bunx tsx scripts/feishu-e2e/run.ts --group read
 *   bunx tsx scripts/feishu-e2e/run.ts --scenario FS-WRITE-01,FS-WRITE-03
 *   bunx tsx scripts/feishu-e2e/run.ts --matrix                 # D 组矩阵
 *   bunx tsx scripts/feishu-e2e/run.ts --matrix --models claude-opus,gpt
 *   bunx tsx scripts/feishu-e2e/run.ts --all                    # A+B 组（默认模型）
 *
 * 写入类需要 FEISHU_TEST_FOLDER_TOKEN；授权态需先跑 auth-capture.ts。
 */
import {
  DEFAULT_MODEL_MATRIX,
  FEISHU_TEST_FOLDER_TOKEN,
  type ModelSpec,
  assertWriteConfig,
} from './config';
import { closeSession, openSession, sendPrompt, snap, waitForSettle } from './lib/driver';
import { listVisibleModels, switchModel } from './lib/modelSwitch';
import { type ScenarioResult, writeReport } from './lib/report';
import { MATRIX_SCENARIO_IDS, allScenarios, filterScenarios, getScenario } from './scenarios';
import { type Scenario, type ScenarioRunCtx, defaultAssert } from './scenarios/types';

interface Args {
  all?: boolean;
  group?: string;
  matrix?: boolean;
  model?: string;
  models?: string;
  scenario?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--scenario') a.scenario = argv[++i];
    else if (k === '--group') a.group = argv[++i];
    else if (k === '--models') a.models = argv[++i];
    else if (k === '--model') a.model = argv[++i];
    else if (k === '--matrix') a.matrix = true;
    else if (k === '--all') a.all = true;
  }
  return a;
}

function resolveModels(filter?: string): ModelSpec[] {
  if (!filter) return DEFAULT_MODEL_MATRIX;
  const wanted = filter.split(',').map((s) => s.trim().toLowerCase());
  return DEFAULT_MODEL_MATRIX.filter(
    (m) => wanted.includes(m.label.toLowerCase()) || wanted.includes(m.model.toLowerCase()),
  );
}

/** 跑单个 (场景 × 模型)。每次独立开浏览器会话以隔离录屏。 */
async function runOne(scn: Scenario, model: ModelSpec | undefined): Promise<ScenarioResult> {
  const ctx: ScenarioRunCtx = { folderToken: FEISHU_TEST_FOLDER_TOKEN };
  const tag = model ? `${scn.id}-${model.label}` : scn.id;
  console.log(`\n=== 运行 ${tag} · ${scn.title} ===`);

  const result: ScenarioResult = {
    group: scn.group,
    id: scn.id,
    model: model?.label ?? 'default',
    notes: [],
    passed: false,
    title: scn.title,
    toolCalls: [],
  };

  let session: Awaited<ReturnType<typeof openSession>> | undefined;
  try {
    session = await openSession(tag);

    if (model) {
      const ok = await switchModel(session.page, model);
      if (!ok) {
        const visible = await listVisibleModels(session.page);
        result.notes.push(
          `模型切换失败，沿用默认；当前可见模型：${visible.slice(0, 8).join(' | ')}`,
        );
      }
    }

    const prompts = scn.prompts(ctx);
    for (const p of prompts) {
      const sent = await sendPrompt(session, p);
      if (!sent) result.notes.push('发送可能失败（未捕获到 chat 请求）');
      await waitForSettle(session);
    }

    result.toolCalls = session.calls.slice();
    const verdict = scn.assert
      ? scn.assert(result.toolCalls, ctx)
      : defaultAssert(scn, result.toolCalls);
    result.passed = verdict.passed;
    result.notes.push(...verdict.notes);

    result.screenshotPath = await snap(session, tag);
  } catch (e) {
    result.error = (e as Error).message;
    result.passed = false;
  } finally {
    if (session) result.videoPath = await closeSession(session, tag);
  }

  console.log(`=== ${tag} → ${result.passed ? 'PASS' : 'FAIL'} | ${result.notes.join('；')}`);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const results: ScenarioResult[] = [];

  if (args.matrix) {
    assertWriteConfig();
    const models = resolveModels(args.models);
    const scns = MATRIX_SCENARIO_IDS.map(getScenario).filter(Boolean) as Scenario[];
    console.log(
      `矩阵：${scns.length} 场景 × ${models.length} 模型 = ${scns.length * models.length} 组合`,
    );
    for (const scn of scns) {
      for (const model of models) {
        results.push(await runOne(scn, model));
      }
    }
  } else {
    let scns: Scenario[];
    if (args.all) scns = allScenarios;
    else if (args.scenario) scns = filterScenarios(args.scenario);
    else if (args.group) scns = filterScenarios(args.group);
    else {
      console.error('请指定 --scenario <id[,id]> / --group <read|write> / --all / --matrix');
      process.exit(1);
    }
    if (scns.length === 0) {
      console.error('没有匹配到任何场景');
      process.exit(1);
    }
    if (scns.some((s) => s.group === 'write')) assertWriteConfig();
    // --model 指定单个模型应用到本次选择；否则用默认模型（不切换）
    const single = args.model ? resolveModels(args.model)[0] : undefined;
    if (args.model && !single) {
      console.error(
        `未知模型 "${args.model}"，可选：${DEFAULT_MODEL_MATRIX.map((m) => m.label).join(', ')}`,
      );
      process.exit(1);
    }
    for (const scn of scns) {
      results.push(await runOne(scn, single));
    }
  }

  const { json, md } = writeReport(results);
  const pass = results.filter((r) => r.passed).length;
  console.log(`\n报告已生成：\n  ${md}\n  ${json}`);
  console.log(`总计 ${results.length}，通过 ${pass}，失败 ${results.length - pass}`);
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
