import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { type ChatMessageError } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  extractProviderHttpStatus,
  extractProviderRawMessage,
  formatProviderBizErrorTitle,
  mergeProviderBizErrorContext,
  PROVIDER_BIZ_ERROR_RULES,
  resolveAdaErrorTitle,
  resolveProviderBizErrorTitle,
} from './resolveProviderBizError';

const baseError = (body: ChatMessageError['body']): ChatMessageError => ({
  body,
  message: AgentRuntimeErrorType.ProviderBizError,
  type: AgentRuntimeErrorType.ProviderBizError,
});

describe('extractProviderRawMessage', () => {
  it('reads OpenAI-style body.error.message', () => {
    const error = baseError({
      error: {
        message: 'thinking is enabled but reasoning_content is missing',
        type: 'invalid_request_error',
      },
      provider: 'tripflow',
    });

    expect(extractProviderRawMessage(error)).toBe(
      'thinking is enabled but reasoning_content is missing',
    );
  });

  it('reads direct body.message', () => {
    const error = baseError({ message: 'context length exceeded' });

    expect(extractProviderRawMessage(error)).toBe('context length exceeded');
  });
});

describe('extractProviderHttpStatus', () => {
  it('reads body.error.status when there is no message', () => {
    const error = baseError({
      endpoint: 'http://example.com/llm/1',
      error: { headers: {}, status: 403 },
      provider: 'tripflow',
    });

    expect(extractProviderHttpStatus(error)).toBe(403);
    expect(extractProviderRawMessage(error)).toBeUndefined();
  });

  it('reads top-level body.status', () => {
    const error = baseError({ provider: 'ada', status: 429 });

    expect(extractProviderHttpStatus(error)).toBe(429);
  });
});

describe('mergeProviderBizErrorContext', () => {
  it('prefers override context over error.body', () => {
    const error = baseError({ provider: 'tripflow', model: 'old-model' });

    expect(mergeProviderBizErrorContext(error, { provider: 'ada', model: 'gpt-4.1' })).toEqual({
      provider: 'ada',
      model: 'gpt-4.1',
    });
  });
});

describe('resolveAdaErrorTitle', () => {
  it('returns body.error.message for ada NoCodingPlanError', () => {
    const error: ChatMessageError = {
      body: {
        error: { message: 'ada需要激活coding plan套餐才能使用' },
        provider: 'ada',
      },
      message: AgentRuntimeErrorType.NoCodingPlanError,
      type: AgentRuntimeErrorType.NoCodingPlanError,
    };

    expect(resolveAdaErrorTitle(error)).toBe('ada需要激活coding plan套餐才能使用');
  });

  it('returns body.error.message for ada AgentRuntimeError', () => {
    const error: ChatMessageError = {
      body: {
        error: { message: 'Ada 服务暂时不可用，请稍后重试' },
        provider: 'ada',
      },
      message: AgentRuntimeErrorType.AgentRuntimeError,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };

    expect(resolveAdaErrorTitle(error)).toBe('Ada 服务暂时不可用，请稍后重试');
  });

  it('reads legacy body.error.cause for ada', () => {
    const error: ChatMessageError = {
      body: {
        error: { cause: 'ada需要激活coding plan套餐才能使用', name: 'AdaGatewayError' },
        provider: 'ada',
      },
      message: AgentRuntimeErrorType.AgentRuntimeError,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };

    expect(resolveAdaErrorTitle(error)).toBe('ada需要激活coding plan套餐才能使用');
  });

  it('uses provider from message context when body has no provider', () => {
    const error: ChatMessageError = {
      body: { error: { message: '套餐未开通' } },
      message: AgentRuntimeErrorType.NoCodingPlanError,
      type: AgentRuntimeErrorType.NoCodingPlanError,
    };

    expect(resolveAdaErrorTitle(error, { provider: 'ada' })).toBe('套餐未开通');
  });

  it('returns undefined for non-ada provider', () => {
    const error: ChatMessageError = {
      body: { error: { message: 'some error' }, provider: 'openai' },
      message: AgentRuntimeErrorType.NoCodingPlanError,
      type: AgentRuntimeErrorType.NoCodingPlanError,
    };

    expect(resolveAdaErrorTitle(error)).toBeUndefined();
  });

  it('returns raw message for ada ProviderBizError billing limit', () => {
    const billingMessage =
      '当前套餐 150 美金 已达到当前周期费用上限，可到https://aicoding.portal.ctripcorp.com/codingPlan 申请更高额度';
    const error = baseError({
      endpoint: 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1',
      error: {
        code: null,
        message: billingMessage,
        param: null,
        type: 'rate_limit_error',
      },
      provider: 'ada',
    });

    expect(resolveAdaErrorTitle(error)).toBe(billingMessage);
    expect(resolveProviderBizErrorTitle(error)).toBeUndefined();
  });

  it('returns raw message for ada rate_limit_error without custom rule', () => {
    const error = baseError({
      error: { message: 'rate limit exceeded', type: 'rate_limit_error' },
      provider: 'ada',
    });

    expect(resolveAdaErrorTitle(error)).toBe('rate limit exceeded');
    expect(resolveProviderBizErrorTitle(error)).toBeUndefined();
  });
});

describe('formatProviderBizErrorTitle', () => {
  it('prefixes provider display name and model before hint', () => {
    expect(
      formatProviderBizErrorTitle(
        { provider: 'tripflow', model: 'glm-5.1' },
        '服务器负载过高，请稍后重试或更换模型',
      ),
    ).toBe('【Peta｜glm-5.1】 服务器负载过高，请稍后重试或更换模型');
  });

  it('falls back to provider id when not in DEFAULT_MODEL_PROVIDER_LIST', () => {
    expect(formatProviderBizErrorTitle({ provider: 'openai', model: 'gpt-4' }, '请求非法')).toBe(
      '【openai｜gpt-4】 请求非法',
    );
  });

  it('returns hint only when provider and model are missing', () => {
    expect(formatProviderBizErrorTitle({}, '请求非法')).toBe('请求非法');
  });
});

describe('resolveProviderBizErrorTitle', () => {
  it('returns content-moderation title for ada DataInspectionFailed', () => {
    const error = baseError({
      message:
        '<400> InternalError.Algo.DataInspectionFailed: Output data may contain inappropriate content.',
      provider: 'ada',
    });

    expect(resolveProviderBizErrorTitle(error, { model: 'qwen3.7-plus' })).toBe(
      '【Ada｜qwen3.7-plus】 内容安全审查拦截了模型输出，已自动重试仍失败。请调整提问措辞、减少敏感数据输出，或更换模型后重试',
    );
  });

  it('returns content-moderation title for "inappropriate content" wording', () => {
    const error = baseError({
      error: {
        message: 'Output may contain inappropriate content.',
        type: 'invalid_request_error',
      },
      provider: 'ada',
    });

    expect(resolveProviderBizErrorTitle(error, { model: 'qwen3.7-plus' })).toContain(
      '内容安全审查拦截了模型输出',
    );
  });

  it('returns mapped title for tripflow input length invalid parameter', () => {
    const error = baseError({
      endpoint: 'http://aigw.example.com/llm/100000533',
      error: {
        code: 'invalid_parameter_error',
        message:
          '<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 229376]',
        param: null,
        type: 'invalid_request_error',
      },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error)).toBe(
      '【Peta】 输入内容或附件过大，请减少输入内容后重试',
    );
  });

  it('returns generic 400 title when message does not match specific rules', () => {
    const error = baseError({
      error: { message: 'some other error', status: 400, type: 'invalid_request_error' },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error)).toBe(
      '【Peta】 请求非法，请检查以下情况：输入内容或附件过大、内容敏感、模型参数非法、工具参数错误',
    );
  });

  it('returns petaKeyId setup guidance for tripflow missing credential errors', () => {
    const error = baseError({
      error: {
        message: 'TripFlow petaKeyId is required',
        type: 'missing_peta_key_id',
      },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error)).toBe('【Peta】 请先到设置页面填写 Peta Key ID');
  });

  it('returns access authorization guidance for tripflow bindKey 404 errors', () => {
    const error = baseError({
      error: {
        message: JSON.stringify({
          apikey: null,
          code: '404',
          endpoint: null,
          message:
            'No binding found for this appId and keyName. Call bindKey first so this app can use this keyName.',
          tags: null,
        }),
        name: 'Error',
      },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error)).toBe(
      '【Peta】 Peta未申请访问授权，需要 Peta Key Owner 在 Peta 上申请应用访问权限。操作路径：租户管理 -> 选择目标租户 -> API Key 管理 -> 访问授权；环境选择 Captain 应用，APPID 填写 100071558。',
    );
  });

  it('returns access authorization guidance when bindKey 404 is stored on message', () => {
    const error: ChatMessageError = {
      body: {
        error: { name: 'Error' },
        provider: 'tripflow',
      },
      message: JSON.stringify({
        code: 404,
        message: 'No binding found for this appId and keyName.',
      }),
      type: AgentRuntimeErrorType.ProviderBizError,
    };

    expect(resolveProviderBizErrorTitle(error)).toBe(
      '【Peta】 Peta未申请访问授权，需要 Peta Key Owner 在 Peta 上申请应用访问权限。操作路径：租户管理 -> 选择目标租户 -> API Key 管理 -> 访问授权；环境选择 Captain 应用，APPID 填写 100071558。',
    );
  });

  it('returns internal setup guidance for ztrip missing qconfig petaKeyId errors', () => {
    const error = baseError({
      error: {
        message: 'Ztrip petaKeyId is required',
        type: 'missing_peta_key_id',
      },
      provider: 'ztrip',
    });

    expect(resolveProviderBizErrorTitle(error)).toBe('【VIP-Only】 服务配置缺失，请联系管理员');
  });

  it('prefers input length rule over generic 400 when message matches', () => {
    const error = baseError({
      error: {
        message:
          '<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 229376]',
        status: 400,
        type: 'invalid_request_error',
      },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error)).toBe(
      '【Peta】 输入内容或附件过大，请减少输入内容后重试',
    );
  });

  it('returns tripflow title for 403 without message', () => {
    const error = baseError({
      endpoint: 'http://aigw.example.com/llm/100000533',
      error: { headers: { 'content-type': 'application/json' }, status: 403 },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error, { model: 'some-model' })).toBe(
      '【Peta｜some-model】 请检查是否已申请该模型',
    );
  });

  it('returns ada title for 403 without message', () => {
    const error = baseError({
      error: { headers: {}, status: 403 },
      provider: 'ada',
    });

    expect(resolveProviderBizErrorTitle(error, { model: 'gpt-4.1' })).toBe(
      '【Ada｜gpt-4.1】 不支持该模型',
    );
  });

  it('returns ztrip title for 404 without message', () => {
    const error = baseError({
      error: { status: 404 },
      provider: 'ztrip',
    });

    expect(resolveProviderBizErrorTitle(error, { model: 'claude-3' })).toBe(
      '【VIP-Only｜claude-3】 请检查是否已申请该模型',
    );
  });

  it('returns generic title for 403 on other providers', () => {
    const error = baseError({
      error: { status: 403 },
      provider: 'openai',
    });

    expect(resolveProviderBizErrorTitle(error, { model: 'gpt-4' })).toBe(
      '【openai｜gpt-4】 未申请该模型，请先在 peta 平台申请后重试',
    );
  });

  it('returns model name in title for 429 without message', () => {
    const error = baseError({
      error: { headers: {}, status: 429 },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error, { model: 'glm-5.1' })).toBe(
      '【Peta｜glm-5.1】 服务器负载过高，请稍后重试或更换模型',
    );
    expect(resolveProviderBizErrorTitle(error, { model: 'glm5.1' })).toBe(
      '【Peta｜glm5.1】 服务器负载过高，请稍后重试或更换模型',
    );
    expect(resolveProviderBizErrorTitle(error, { model: 'gpt-4' })).toBe(
      '【Peta｜gpt-4】 服务器负载过高，请稍后重试或更换模型',
    );
    expect(resolveProviderBizErrorTitle(error)).toBe(
      '【Peta】 服务器负载过高，请稍后重试或更换模型',
    );
  });

  it('returns mapped title when message and provider match', () => {
    const error = baseError({
      error: {
        message:
          'thinking is enabled but reasoning_content is missing in assistant tool call message at index 5',
        status: 400,
        type: 'invalid_request_error',
      },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error)).toBe(
      '【Peta】 思考模式已开启，但历史消息缺少 reasoning_content；请关闭思考模式或更换模型',
    );
  });

  it('uses provider from message context when body has no provider', () => {
    const error = baseError({
      error: {
        message: 'thinking is enabled but reasoning_content is missing',
        status: 400,
        type: 'invalid_request_error',
      },
    });

    expect(resolveProviderBizErrorTitle(error, { provider: 'ada' })).toBe(
      '【Ada】 思考模式已开启，但历史消息缺少 reasoning_content；请关闭思考模式或更换模型',
    );
  });

  it('matches thinking rule for any provider', () => {
    const error = baseError({
      error: {
        message: 'thinking is enabled but reasoning_content is missing',
        status: 400,
        type: 'invalid_request_error',
      },
      provider: 'openai',
    });

    expect(resolveProviderBizErrorTitle(error)).toBe(
      '【openai】 思考模式已开启，但历史消息缺少 reasoning_content；请关闭思考模式或更换模型',
    );
  });

  it('matches model ids with different separators (glm5.1 vs glm-5.1)', () => {
    const originalRules = [...PROVIDER_BIZ_ERROR_RULES];
    PROVIDER_BIZ_ERROR_RULES.length = 0;
    PROVIDER_BIZ_ERROR_RULES.push({
      models: ['glm5.1'],
      status: 429,
      title: '负载过高',
    });

    try {
      const error = baseError({ error: { status: 429 }, provider: 'tripflow' });

      expect(resolveProviderBizErrorTitle(error, { model: 'zhipu/glm-5.1' })).toBe(
        '【Peta｜zhipu/glm-5.1】 负载过高',
      );
    } finally {
      PROVIDER_BIZ_ERROR_RULES.length = 0;
      PROVIDER_BIZ_ERROR_RULES.push(...originalRules);
    }
  });

  it('filters by models prefix when rule defines models', () => {
    const originalRules = [...PROVIDER_BIZ_ERROR_RULES];
    PROVIDER_BIZ_ERROR_RULES.length = 0;
    PROVIDER_BIZ_ERROR_RULES.push({
      match: 'rate limit',
      models: ['gpt-4'],
      title: '仅 gpt-4 系列限流',
    });

    try {
      const error = baseError({
        error: { message: 'rate limit exceeded', type: 'invalid_request_error' },
        provider: 'tripflow',
      });

      expect(resolveProviderBizErrorTitle(error, { model: 'gpt-4.1-mini' })).toBe(
        '【Peta｜gpt-4.1-mini】 仅 gpt-4 系列限流',
      );
      expect(resolveProviderBizErrorTitle(error, { model: 'claude-3-5' })).toBeUndefined();
    } finally {
      PROVIDER_BIZ_ERROR_RULES.length = 0;
      PROVIDER_BIZ_ERROR_RULES.push(...originalRules);
    }
  });

  it('returns undefined when no rule matches', () => {
    const error = baseError({
      error: { message: 'some unknown provider error', type: 'invalid_request_error' },
      provider: 'tripflow',
    });

    expect(resolveProviderBizErrorTitle(error)).toBeUndefined();
  });

  it('returns undefined when neither message nor status can be extracted', () => {
    const error = baseError({ provider: 'tripflow' });

    expect(resolveProviderBizErrorTitle(error)).toBeUndefined();
  });
});
