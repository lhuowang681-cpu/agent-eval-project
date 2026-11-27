import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { type ILobeAgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { type ChatMessageError, type ErrorType } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { type IPluginErrorType } from '@lobehub/chat-plugin-sdk';
import { type AlertProps } from '@lobehub/ui';
import { Block, Highlighter, Skeleton } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import useBusinessErrorAlertConfig from '@/business/client/hooks/useBusinessErrorAlertConfig';
import useBusinessErrorContent from '@/business/client/hooks/useBusinessErrorContent';
import useRenderBusinessChatErrorMessageExtra from '@/business/client/hooks/useRenderBusinessChatErrorMessageExtra';
import ErrorContent from '@/features/Conversation/ChatItem/components/ErrorContent';
import { useProviderName } from '@/hooks/useProviderName';
import dynamic from '@/libs/next/dynamic';

import ChatInvalidAPIKey from './ChatInvalidApiKey';
import NoCodingPlanError from './NoCodingPlanError';
import {
  type ProviderBizErrorContext,
  resolveAdaErrorTitle,
  resolveProviderBizErrorTitle,
} from './resolveProviderBizError';

export type { ProviderBizErrorContext };
export { resolveAdaErrorTitle, resolveProviderBizErrorTitle } from './resolveProviderBizError';

interface ErrorMessageData {
  error?: ChatMessageError | null;
  id: string;
}

const loading = () => (
  <Block
    align={'center'}
    padding={16}
    variant={'outlined'}
    style={{
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
    }}
  >
    <Skeleton.Button active block />
  </Block>
);

const OllamaBizError = dynamic(() => import('./OllamaBizError'), { loading, ssr: false });

const OllamaSetupGuide = dynamic(() => import('./OllamaSetupGuide'), {
  loading,
  ssr: false,
});

// Config for the errorMessage display
const getErrorAlertConfig = (
  errorType?: IPluginErrorType | ILobeAgentRuntimeErrorType | ErrorType,
): AlertProps | undefined => {
  // OpenAIBizError / ZhipuBizError / GoogleBizError / ...
  if (typeof errorType === 'string' && (errorType.includes('Biz') || errorType.includes('Invalid')))
    return {
      type: 'secondary',
    };

  switch (errorType) {
    case ChatErrorType.SystemTimeNotMatchError:
    case AgentRuntimeErrorType.PermissionDenied:
    case AgentRuntimeErrorType.NoCodingPlanError:
    case AgentRuntimeErrorType.InsufficientQuota:
    case AgentRuntimeErrorType.ModelNotFound:
    case AgentRuntimeErrorType.QuotaLimitReached:
    case AgentRuntimeErrorType.ExceededContextWindow:
    case AgentRuntimeErrorType.LocationNotSupportError: {
      return {
        type: 'secondary',
      };
    }

    case AgentRuntimeErrorType.OllamaServiceUnavailable:
    case AgentRuntimeErrorType.NoOpenAIAPIKey:
    case AgentRuntimeErrorType.ComfyUIServiceUnavailable:
    case AgentRuntimeErrorType.InvalidComfyUIArgs: {
      return {
        type: 'secondary',
      };
    }

    default: {
      return undefined;
    }
  }
};

export const useErrorContent = (error: any, providerBizContext?: ProviderBizErrorContext) => {
  const { t } = useTranslation('error');
  const providerName = useProviderName(error?.body?.provider || '');
  const businessAlertConfig = useBusinessErrorAlertConfig(error?.type);
  const { errorType: businessErrorType, hideMessage } = useBusinessErrorContent(error?.type);

  return useMemo<AlertProps | undefined>(() => {
    if (!error) return;
    const messageError = error;

    // Use business alert config if provided, otherwise fall back to default
    const alertConfig = businessAlertConfig ?? getErrorAlertConfig(messageError.type);

    // Use business error type if provided, otherwise use original
    const finalErrorType = businessErrorType ?? messageError.type;

    let displayMessage: string | undefined;
    if (!hideMessage) {
      displayMessage = resolveProviderBizErrorTitle(messageError, providerBizContext);
      displayMessage ??= resolveAdaErrorTitle(messageError, providerBizContext);
      // Fall back to the persisted error message when no `response.<type>` key
      // exists (e.g. the generic `UnknownError` bucket) so the user sees the real
      // error text instead of the raw i18n key.
      displayMessage ??= t(`response.${finalErrorType}` as any, {
        defaultValue: messageError.message,
        provider: providerName,
      });
    }

    return {
      message: displayMessage,
      ...alertConfig,
    };
  }, [
    businessAlertConfig,
    businessErrorType,
    error,
    hideMessage,
    providerBizContext,
    providerName,
    t,
  ]);
};

interface ErrorExtraProps {
  data: ErrorMessageData;
  error?: AlertProps;
}

const ErrorMessageExtra = memo<ErrorExtraProps>(({ error: alertError, data }) => {
  const error = data.error;
  const businessChatErrorMessageExtra = useRenderBusinessChatErrorMessageExtra(error, data.id);
  if (ENABLE_BUSINESS_FEATURES && businessChatErrorMessageExtra)
    return businessChatErrorMessageExtra;

  if (!error?.type) return;

  switch (error.type) {
    case AgentRuntimeErrorType.OllamaServiceUnavailable: {
      return <OllamaSetupGuide id={data.id} />;
    }

    case AgentRuntimeErrorType.OllamaBizError: {
      return <OllamaBizError {...data} />;
    }

    /* ↓ cloud slot ↓ */

    /* ↑ cloud slot ↑ */

    case AgentRuntimeErrorType.NoCodingPlanError: {
      return <NoCodingPlanError id={data.id} />;
    }

    case AgentRuntimeErrorType.NoOpenAIAPIKey: {
      {
        return (
          <ChatInvalidAPIKey id={data.id} provider={data.error?.body?.provider} variant="missing" />
        );
      }
    }
  }

  if (error.type.toString().includes('Invalid')) {
    return (
      <ChatInvalidAPIKey id={data.id} provider={data.error?.body?.provider} variant="invalid" />
    );
  }

  return (
    <ErrorContent
      id={data.id}
      error={{
        ...alertError,
        extra: data.error?.body ? (
          <Highlighter
            actionIconSize={'small'}
            language={'json'}
            padding={8}
            variant={'borderless'}
          >
            {JSON.stringify(data.error?.body, null, 2)}
          </Highlighter>
        ) : undefined,
      }}
    />
  );
});

export default ErrorMessageExtra;
