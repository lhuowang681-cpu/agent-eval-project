import type { RuntimeVideoGenParams } from 'model-bank';

export type CreateVideoPayload = {
  callbackUrl?: string;
  model: string;
  params: RuntimeVideoGenParams;
};

/** When createVideo blocks until the provider finishes (e.g. Tripflow + asyncifyPolling). */
export interface CreateVideoInlineCompletion {
  generateAudio?: boolean;
  model?: string;
  usage?: { completionTokens: number; totalTokens: number };
  videoUrl: string;
}

export type CreateVideoResponse = {
  inferenceId: string;
  inlineComplete?: CreateVideoInlineCompletion;
};

export type HandleCreateVideoWebhookPayload = {
  body: unknown;
  headers?: Record<string, string>;
};

export type HandleCreateVideoWebhookResult =
  | { status: 'pending' }
  | {
      generateAudio?: boolean;
      inferenceId: string;
      model?: string;
      status: 'success';
      usage?: { completionTokens: number; totalTokens: number };
      videoUrl: string;
    }
  | { error: string; inferenceId: string; status: 'error' };
