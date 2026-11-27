#!/usr/bin/env node
/**
 * 构建产物密钥扫描。
 *
 * 背景：`src/services/feishuToken.ts` 曾在浏览器侧 `new LarkAuth({ appId, appSecret })`，
 * 于是飞书应用密钥被原样打进前端 bundle —— 在 `dist/**` 的 JS 里可以直接 grep 到明文。
 * 换票已改为服务端 tRPC（`feishuAuth.*`），本脚本是防止这类问题再次发生的护栏。
 *
 * ⚠️ 脚本**不包含任何真实密钥**：那等于把密钥又写回仓库。这里匹配的是「形状」——
 * 密钥字面量赋值给 secret 类字段，以及飞书 app_secret 的长度特征。
 *
 *   node scripts/local/scanBundleSecrets.mjs [扫描目录...]
 *
 * 默认扫描 dist/。退出码非 0 表示发现疑似泄露。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_TARGETS = ['dist'];
const SCAN_EXTENSIONS = new Set(['.cjs', '.html', '.js', '.mjs', '.map']);

/**
 * 每条规则匹配「机密被写成字面量」的形状，而不是某个具体的值。
 * `allowPlaceholder` 用来放过构建期占位符（如 `appSecret:""`、`appSecret:void 0`）。
 */
const RULES = [
  {
    name: 'appSecret 字面量',
    // 覆盖压缩后的写法：appSecret:"xxx" / app_secret:'xxx' / "appSecret":`xxx`
    pattern: /["'`]?app_?secret["'`]?\s*:\s*["'`]([^"'`]{8,})["'`]/gi,
  },
  {
    name: 'clientSecret 字面量',
    pattern: /["'`]?client_?secret["'`]?\s*:\s*["'`]([^"'`]{8,})["'`]/gi,
  },
  {
    name: 'lark-cli --app-secret 明文参数',
    pattern: /--app-secret["'`,\s]+["'`]([^"'`]{8,})["'`]/gi,
  },
];

/**
 * 明显不是真密钥的值：占位符、环境变量引用、模板串，以及**界面文案**。
 *
 * 文案这条很重要：i18n 产物里有 `appSecret: "App Secret"` 这样的标签，
 * 形状上同样是「secret 字段 = 字符串字面量」。真密钥是无空格的高熵串，
 * 而含空格的纯字母短语必然是给人看的文案 —— 据此区分，避免护栏因为噪音被忽视。
 */
const isPlaceholder = (value) =>
  value.length < 8 ||
  /^\s*$/.test(value) ||
  /^(undefined|null|void 0|false|true)$/.test(value) ||
  /^\$\{/.test(value) ||
  /^process\.env/.test(value) ||
  /^(your|test|example|placeholder|dummy|xxx|<)/i.test(value) ||
  // 含空格的纯字母/中文短语 = UI 文案
  (/\s/.test(value) && /^[\p{L}\s]+$/u.test(value));

const walk = async (dir, out = []) => {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await walk(full, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
};

const main = async () => {
  const targets = process.argv.slice(2);
  const roots = targets.length > 0 ? targets : DEFAULT_TARGETS;

  const files = [];
  for (const root of roots) files.push(...(await walk(path.resolve(root))));

  if (files.length === 0) {
    console.error(`✖ 没有可扫描的文件：${roots.join(', ')}（先构建，或指定正确的目录）`);
    process.exit(2);
  }

  const findings = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8').catch(() => null);
    if (content === null) continue;

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(content)) !== null) {
        const value = match[1];
        if (isPlaceholder(value)) continue;
        findings.push({
          file: path.relative(process.cwd(), file),
          // 只回显首尾各 3 个字符，避免把密钥打进 CI 日志
          masked: `${value.slice(0, 3)}…${value.slice(-3)} (len=${value.length})`,
          rule: rule.name,
        });
      }
    }
  }

  console.log(`扫描 ${files.length} 个产物文件，目录：${roots.join(', ')}`);

  if (findings.length === 0) {
    console.log('✓ 未发现硬编码机密');
    return;
  }

  console.error(`\n✖ 发现 ${findings.length} 处疑似硬编码机密：\n`);
  for (const f of findings) {
    console.error(`  [${f.rule}] ${f.file}`);
    console.error(`      值：${f.masked}`);
  }
  console.error('\n机密不得出现在客户端产物中。应改为服务端持有（参见 src/server/services/feishuOAuth）。');
  process.exit(1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
