/* eslint-disable */
/**
 * 飞书 MCP 真实浏览器 E2E —— 全局配置
 *
 * 所有可调参数集中在此，读自环境变量（.env 经 bun/tsx 自动注入）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * tsx（基于 node）不像 bun 那样自动加载 .env，这里手动把仓库根的 .env 注入 process.env
 * （已存在的同名变量不覆盖）。仅做简单 KEY=VALUE 解析，够脚本用。
 */
function loadDotEnv() {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadDotEnv();

/** 套件根目录 */
export const ROOT_DIR = __dirname;
/** 授权态文件（storageState：cookies + localStorage lark-auth） */
export const STORAGE_STATE_PATH = path.join(ROOT_DIR, '.auth', 'storageState.json');
/** 录屏输出目录 */
export const VIDEO_DIR = path.join(ROOT_DIR, 'videos');
/** 截图输出目录 */
export const SCREENSHOT_DIR = path.join(ROOT_DIR, 'screenshots');
/** 报告输出目录 */
export const REPORT_DIR = path.join(ROOT_DIR, 'reports');

/** 本地全栈 dev（bun run dev）。可用 SPA_URL 覆盖。 */
export const SPA_URL = process.env.SPA_URL || 'http://localhost:3010';

/** 应用登录（Better Auth /api/auth/sign-in/email） */
export const DEV_USER = process.env.DEV_USER_NAME || '';
export const DEV_PASS = process.env.DEV_USER_PASSWORD || '';

/** 写入类场景的落点：用户空间里的测试文件夹 token */
export const FEISHU_TEST_FOLDER_TOKEN = process.env.FEISHU_TEST_FOLDER_TOKEN || '';

/** 飞书 OAuth 应用（与 src/services/feishuToken.ts 一致），决定 localStorage key */
export const LARK_AUTH_APP_ID = 'cli_aaa103c9df7c9be5';
export const LARK_AUTH_STORAGE_KEY = `lark-auth:${LARK_AUTH_APP_ID}`;

/** 飞书 MCP identifier 与工具名（与 @lobechat/builtin-mcp-feishu 一致） */
export const FEISHU_MCP_IDENTIFIER = 'builtin-feishu-mcp';
export const FEISHU_TOOLS = {
  AddComments: 'add-comments',
  CreateDoc: 'create-doc',
  FetchDoc: 'fetch-doc',
  FetchFile: 'fetch-file',
  GetComments: 'get-comments',
  GetUser: 'get-user',
  ListDocs: 'list-docs',
  SearchDoc: 'search-doc',
  SearchUser: 'search-user',
  UpdateDoc: 'update-doc',
} as const;

/**
 * 默认模型矩阵。具体 id 需与你 .env 中实际配好 key 的 provider 对应；
 * 跑前 driver 会打印当前对话可用模型，可据此用 --models 覆盖。
 * 每项 = { provider, model, label }；label 用于录屏/报告命名。
 */
export interface ModelSpec {
  label: string;
  model: string;
  provider: string;
}

// 注意：模型矩阵必须是当前部署"模型选择器里真实启用"的模型。
// 本环境（trncalciferdb / Peta provider）实测仅有以下两个，Claude/GPT/DeepSeek 未配置。
// 切到别的部署时按选择器里的显示名调整 model 字段（switchModel 按显示名匹配）。
export const DEFAULT_MODEL_MATRIX: ModelSpec[] = [
  { label: 'sonnet', model: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { label: 'minimax', model: 'MiniMax M2.7', provider: 'peta' },
  { label: 'qwen', model: 'Qwen3.6 Plus', provider: 'peta' },
];

/** 单场景总超时（真实 LLM 慢，大文档生成更慢，给足） */
export const SCENARIO_TIMEOUT_MS = Number(process.env.FS_SCENARIO_TIMEOUT || 220_000);
/** 工具调用 / 流响应静默多久判定收敛 */
export const SETTLE_QUIET_MS = Number(process.env.FS_SETTLE_QUIET || 10_000);
/** 是否显示浏览器（默认显示，便于观察 + 真实操作） */
export const HEADLESS = process.env.HEADLESS === 'true';

export function assertWriteConfig() {
  if (!FEISHU_TEST_FOLDER_TOKEN) {
    throw new Error(
      '写入类场景需要 FEISHU_TEST_FOLDER_TOKEN（你空间里的测试文件夹 token）。\n' +
        '请在 .env 设置后重试，例如：FEISHU_TEST_FOLDER_TOKEN=fldcnXXXX',
    );
  }
}
