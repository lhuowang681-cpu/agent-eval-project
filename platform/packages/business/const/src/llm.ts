export const DEFAULT_EMBEDDING_PROVIDER = 'openai';

// TripYoYo：默认使用 tripflow 提供商（含系统任务/轻量模型）
// ⚠️ 离线改造（PLAN.md 阶段 4）：原值均为 'tripflow'，其地址由 @ctrip/peta-ai-client
// 的 resolvePetaLlmGateway 解析，指向携程内网网关；该包已存根为抛错，且离线不可达。
// 改为 'openai' 后整个 provider 由 OPENAI_PROXY_URL 指向本地 Mock LLM。
// 恢复联网开发时把这两行改回 'tripflow'。
export const DEFAULT_PROVIDER = 'openai';
export const DEFAULT_MINI_PROVIDER = 'openai';
