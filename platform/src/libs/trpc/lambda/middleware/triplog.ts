import { triplog } from '@ctrip/vampire-core';

import { trpc } from '../init';

/**
 * 从 raw input 中 best-effort 提取 model / provider，
 * 适配 aiChat、aiAgent 等不同 input 结构
 */
const extractModelInfo = (input: unknown): { model?: string; provider?: string } => {
  if (!input || typeof input !== 'object') return {};
  const raw = input as Record<string, any>;

  // aiChat.outputJSON: { model, provider }
  if (typeof raw.model === 'string') {
    return { model: raw.model, provider: raw.provider };
  }

  // aiChat.sendMessageInServer: { newAssistantMessage: { model, provider } }
  if (typeof raw.newAssistantMessage?.model === 'string') {
    return {
      model: raw.newAssistantMessage.model,
      provider: raw.newAssistantMessage.provider,
    };
  }

  // aiAgent 系列: { modelRuntimeConfig: { model, provider } }
  if (typeof raw.modelRuntimeConfig?.model === 'string') {
    return {
      model: raw.modelRuntimeConfig.model,
      provider: raw.modelRuntimeConfig.provider,
    };
  }

  return {};
};

/**
 * TripLog 全链路上下文注入 middleware
 * setTraceContext 必须在 next() 之前调用，否则不会传递到下游
 * TripLog 自动关联 CAT trace（messageId 字段），无需手动传 traceId
 */
export const triplogContext = trpc.middleware(async ({ ctx, path, type, next, getRawInput }) => {
  const userId = ctx.userId;

  triplog.setTraceContext('trpc', 'lambda');
  triplog.setTraceContext('method', path);

  // 必须在 next() 之前调用 —— 设置全链路上下文，会传播到所有下游服务
  if (userId) {
    triplog.setTraceContext('uid', userId);
  }

  // mutation 记日志，query 跳过（避免高频只读查询产生 ClickHouse 噪音）
  if (type !== 'mutation') {
    return next();
  }

  // best-effort 提取 model/provider，失败不影响主流程
  let modelInfo: { model?: string; provider?: string } = {};
  try {
    const input = await getRawInput();
    modelInfo = extractModelInfo(input);
  } catch {
    // 忽略
  }

  const startMs = Date.now();

  if (modelInfo.model) {
    triplog.setTraceContext('model', modelInfo.model);
  }
  if (modelInfo.provider) {
    triplog.setTraceContext('provider', modelInfo.provider);
  }

  triplog.custom({
    message: `[START] ${path} | user=${userId ?? 'anonymous'}${modelInfo.model ? ` model=${modelInfo.model} provider=${modelInfo.provider}` : ''}`,
    title: `trpc.${path}`,
    type: 'info',
  });

  try {
    const result = await next();

    triplog.custom({
      message: `${result.ok ? '[END]' : '[FAIL]'} ${path} | user=${userId ?? 'anonymous'} duration=${Date.now() - startMs}ms success=${result.ok}${modelInfo.model ? ` model=${modelInfo.model}` : ''}`,
      title: `trpc.${path}`,
      type: result.ok ? 'info' : 'error',
    });

    return result;
  } catch (error) {
    triplog.custom({
      message: `[ERROR] ${path} | user=${userId ?? 'anonymous'} duration=${Date.now() - startMs}ms${modelInfo.model ? ` model=${modelInfo.model}` : ''} error=${error instanceof Error ? error.message : String(error)}`,
      title: `trpc.${path}`,
      type: 'error',
    });
    throw error;
  }
});
