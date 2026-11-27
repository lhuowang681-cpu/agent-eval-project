import { type ChatMessageError } from '@lobechat/types';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

/** Optional overrides from the message row (model/provider are usually on the message, not in error.body). */
export interface ProviderBizErrorContext {
  model?: string;
  provider?: string;
}

export interface ProviderBizErrorRule {
  /** When set, rule applies only when body.error.type matches (case-insensitive exact match) */
  errorTypes?: string[];
  /**
   * Prefix match on error message (case-insensitive).
   * Omit when the rule only uses `status`.
   */
  match?: string | RegExp | ((raw: string, error: ChatMessageError) => boolean);
  /** When set, rule applies only when model id starts with one of these prefixes (case-insensitive) */
  models?: string[];
  /** HTTP status from error body (e.g. body.error.status). Single code or list. */
  status?: number | number[];
  /** Hint text only (provider/model prefix is applied by {@link formatProviderBizErrorTitle}). */
  title:
    | string
    | ((error: ChatMessageError, raw: string | undefined, ctx: ProviderBizErrorContext) => string);
}

const normalize = (value: string) => value.trim().toLowerCase();

const PETA_ACCESS_AUTH_BIND_KEY_MESSAGE = 'No binding found for this appId and keyName';
const PETA_ACCESS_AUTH_HINT =
  'Peta未申请访问授权，需要 Peta Key Owner 在 Peta 上申请应用访问权限。操作路径：租户管理 -> 选择目标租户 -> API Key 管理 -> 访问授权；环境选择 Captain 应用，APPID 填写 100071558。';

interface ProviderRawJsonError {
  code?: unknown;
  message?: unknown;
}

const parseProviderRawJsonError = (raw: string): ProviderRawJsonError | undefined => {
  try {
    const parsed = JSON.parse(raw) as unknown;

    return parsed && typeof parsed === 'object' ? (parsed as ProviderRawJsonError) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Get provider display name from provider id.
 * Falls back to the original id if not found in DEFAULT_MODEL_PROVIDER_LIST.
 */
const getProviderDisplayName = (providerId: string): string => {
  const providerCard = DEFAULT_MODEL_PROVIDER_LIST.find((p) => p.id === providerId);
  return providerCard?.name || providerId;
};

/**
 * Prefix: `provider` + `模型{model}` + hint.
 * Example: `Peta模型glm-5.1 服务器负载过高，请稍后重试或更换模型`
 */
export const formatProviderBizErrorTitle = (ctx: ProviderBizErrorContext, hint: string): string => {
  const segments: string[] = [];

  if (ctx.provider?.trim()) segments.push(getProviderDisplayName(ctx.provider.trim()));
  if (ctx.model?.trim()) segments.push(ctx.model.trim());

  if (segments.length === 0) return hint;

  return `【${segments.join('｜')}】 ${hint}`;
};

const resolve403404Hint = (ctx: ProviderBizErrorContext): string => {
  const provider = normalize(ctx.provider ?? '');

  if (provider === 'ada') return '不支持该模型';

  if (provider === 'tripflow' || provider === 'ztrip') return '请检查是否已申请该模型';

  return '未申请该模型，请先在 peta 平台申请后重试';
};

/**
 * Rules are evaluated in order; first match wins.
 * - `match` (string): case-insensitive prefix on raw message
 * - `status`: matches body.error.status / body.status (no message required)
 * - `models`: model id prefix / normalized match (glm5.1 matches glm-5.1, zhipu/glm-5.1, etc.)
 * - `errorTypes`: matches body.error.type (e.g. rate_limit_error)
 * - Combine `status` + `errorTypes` + `models` — all specified fields must match
 */
export const PROVIDER_BIZ_ERROR_RULES: ProviderBizErrorRule[] = [
  {
    match: (raw) => /DataInspectionFailed|inappropriate content/i.test(raw ?? ''),
    title:
      '内容安全审查拦截了模型输出，已自动重试仍失败。请调整提问措辞、减少敏感数据输出，或更换模型后重试',
  },
  {
    errorTypes: ['missing_peta_key_id'],
    title: (_error, _raw, ctx) =>
      normalize(ctx.provider ?? '') === 'ztrip'
        ? '服务配置缺失，请联系管理员'
        : '请先到设置页面填写 Peta Key ID',
  },
  {
    errorTypes: ['missing_peta_username', 'missing_tripflow_username'],
    title: '请通过 Ctrip SSO 登录后再使用 Peta 模型服务',
  },
  {
    match: (raw) => {
      const parsed = parseProviderRawJsonError(raw);

      return (
        `${parsed?.code}` === '404' &&
        typeof parsed?.message === 'string' &&
        parsed.message.includes(PETA_ACCESS_AUTH_BIND_KEY_MESSAGE)
      );
    },
    title: PETA_ACCESS_AUTH_HINT,
  },
  {
    status: [403, 404],
    title: (_error, _raw, ctx) => resolve403404Hint(ctx),
  },
  {
    match: (raw) =>
      (raw.includes('400') && raw.includes('Range of input length should be')) ||
      raw.includes('Your request exceeded model token limit'),
    title: '输入内容或附件过大，请减少输入内容后重试',
  },
  {
    status: 429,
    title: '服务器负载过高，请稍后重试或更换模型',
  },
  {
    status: 400,
    match: 'thinking is enabled but reasoning_content is missing',
    title: '思考模式已开启，但历史消息缺少 reasoning_content；请关闭思考模式或更换模型',
  },
  {
    status: 400,
    title: '请求非法，请检查以下情况：输入内容或附件过大、内容敏感、模型参数非法、工具参数错误',
  },
  {
    status: 503,
    title: '服务异常或超时，请稍后重试',
  },
  {
    status: 502,
    title: '超时',
  },
];

export const extractProviderRawMessage = (error: ChatMessageError): string | undefined => {
  const body = error.body;
  if (!body || typeof body !== 'object') return undefined;

  const record = body as Record<string, unknown>;

  const nestedError = record.error;
  if (nestedError && typeof nestedError === 'object') {
    const inner = nestedError as Record<string, unknown>;
    if (typeof inner.message === 'string' && inner.message.length > 0) return inner.message;
    if (typeof inner.cause === 'string' && inner.cause.length > 0) return inner.cause;
  }

  if (typeof record.message === 'string' && record.message.length > 0) return record.message;
  if (error.message && error.message !== String(error.type)) return error.message;

  return undefined;
};

const parseHttpStatus = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

/** Reads HTTP status from provider error body (e.g. OpenAI SDK error with status + headers, no message). */
export const extractProviderHttpStatus = (error: ChatMessageError): number | undefined => {
  const body = error.body;
  if (!body || typeof body !== 'object') return undefined;

  const record = body as Record<string, unknown>;

  const nestedError = record.error;
  if (nestedError && typeof nestedError === 'object') {
    const fromNested = parseHttpStatus((nestedError as Record<string, unknown>).status);
    if (fromNested !== undefined) return fromNested;
  }

  return parseHttpStatus(record.status);
};

export const extractProviderErrorType = (error: ChatMessageError): string | undefined => {
  const body = error.body;
  if (!body || typeof body !== 'object') return undefined;

  const nestedError = (body as Record<string, unknown>).error;
  if (!nestedError || typeof nestedError !== 'object') return undefined;

  const type = (nestedError as Record<string, unknown>).type;
  return typeof type === 'string' && type.length > 0 ? type : undefined;
};

export const extractProviderId = (error: ChatMessageError): string | undefined => {
  const body = error.body;
  if (!body || typeof body !== 'object') return undefined;

  const provider = (body as Record<string, unknown>).provider;
  return typeof provider === 'string' && provider.length > 0 ? provider : undefined;
};

export const extractModelId = (error: ChatMessageError): string | undefined => {
  const body = error.body;
  if (!body || typeof body !== 'object') return undefined;

  const model = (body as Record<string, unknown>).model;
  return typeof model === 'string' && model.length > 0 ? model : undefined;
};

export const mergeProviderBizErrorContext = (
  error: ChatMessageError,
  override?: ProviderBizErrorContext,
): ProviderBizErrorContext => ({
  model: override?.model ?? extractModelId(error),
  provider: override?.provider ?? extractProviderId(error),
});

const matchesProviderList = (list: string[], value: string | undefined): boolean => {
  if (!value) return false;
  const normalizedValue = normalize(value);
  return list.some((item) => normalize(item) === normalizedValue);
};

/** Normalize model id for fuzzy match: glm5.1 ≈ glm-5.1 ≈ zhipu/glm-5.1 */
const normalizeModelId = (value: string) => normalize(value).replaceAll(/[-._/]/g, '');

const matchesModelList = (list: string[], value: string | undefined): boolean => {
  if (!value) return false;
  const normalizedValue = normalizeModelId(value);

  return list.some((item) => {
    const normalizedItem = normalizeModelId(item);
    if (!normalizedItem) return false;

    return (
      normalizedValue === normalizedItem ||
      normalizedValue.startsWith(normalizedItem) ||
      normalizedValue.includes(normalizedItem)
    );
  });
};

const matchesStatus = (ruleStatus: number | number[], actual: number | undefined): boolean => {
  if (actual === undefined) return false;
  const codes = Array.isArray(ruleStatus) ? ruleStatus : [ruleStatus];
  return codes.includes(actual);
};

const matchesMessage = (
  rule: ProviderBizErrorRule,
  raw: string | undefined,
  error: ChatMessageError,
): boolean => {
  if (rule.match === undefined) return true;
  if (!raw) return false;

  const { match } = rule;

  if (typeof match === 'string') {
    return normalize(raw).startsWith(normalize(match));
  }

  if (match instanceof RegExp) {
    return match.test(raw);
  }

  return match(raw, error);
};

const ruleMatches = (
  rule: ProviderBizErrorRule,
  raw: string | undefined,
  httpStatus: number | undefined,
  providerErrorType: string | undefined,
  error: ChatMessageError,
  ctx: ProviderBizErrorContext,
): boolean => {
  if (rule.match === undefined && rule.status === undefined && rule.errorTypes === undefined) {
    return false;
  }

  if (rule.status !== undefined && !matchesStatus(rule.status, httpStatus)) {
    return false;
  }

  if (rule.errorTypes?.length && !matchesProviderList(rule.errorTypes, providerErrorType)) {
    return false;
  }

  if (!matchesMessage(rule, raw, error)) {
    return false;
  }

  if (rule.models?.length && !matchesModelList(rule.models, ctx.model)) {
    return false;
  }

  return true;
};

/** Use provider-returned message as title for Ada (token exchange, gateway, API biz errors). */
export const resolveAdaErrorTitle = (
  error: ChatMessageError,
  context?: ProviderBizErrorContext,
): string | undefined => {
  const ctx = mergeProviderBizErrorContext(error, context);
  if (!matchesProviderList(['ada'], ctx.provider)) return undefined;

  return extractProviderRawMessage(error);
};

export const resolveProviderBizErrorTitle = (
  error: ChatMessageError,
  context?: ProviderBizErrorContext,
): string | undefined => {
  const raw = extractProviderRawMessage(error);
  const httpStatus = extractProviderHttpStatus(error);
  const providerErrorType = extractProviderErrorType(error);

  if (!raw && httpStatus === undefined && providerErrorType === undefined) return undefined;

  const ctx = mergeProviderBizErrorContext(error, context);

  for (const rule of PROVIDER_BIZ_ERROR_RULES) {
    if (!ruleMatches(rule, raw, httpStatus, providerErrorType, error, ctx)) continue;

    const hint = typeof rule.title === 'function' ? rule.title(error, raw, ctx) : rule.title;

    return formatProviderBizErrorTitle(ctx, hint);
  }

  return undefined;
};
