import { z } from 'zod';

import type { PageSelection } from './pageSelection';
import { PageSelectionSchema } from './pageSelection';

export interface ModelTokensUsage {
  // Prediction tokens
  acceptedPredictionTokens?: number;
  inputAudioTokens?: number;
  // Input tokens breakdown
  /**
   * user prompt input
   */
  // Input cache tokens
  inputCachedTokens?: number;

  inputCacheMissTokens?: number;
  /**
   * currently only pplx has citation_tokens
   */
  inputCitationTokens?: number;
  /**
   * user prompt image
   */
  inputImageTokens?: number;
  inputTextTokens?: number;

  /**
   * tool use prompt tokens (Google AI / Vertex AI)
   */
  inputToolTokens?: number;
  inputWriteCacheTokens?: number;
  outputAudioTokens?: number;
  outputImageTokens?: number;
  outputReasoningTokens?: number;

  // Output tokens breakdown
  outputTextTokens?: number;
  rejectedPredictionTokens?: number;

  // Total tokens
  // TODO: make all following fields required
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
}

export const ModelUsageSchema = z.object({
  // Input tokens breakdown
  inputCachedTokens: z.number().optional(),
  inputCacheMissTokens: z.number().optional(),
  inputWriteCacheTokens: z.number().optional(),
  inputTextTokens: z.number().optional(),
  inputImageTokens: z.number().optional(),
  inputAudioTokens: z.number().optional(),
  inputCitationTokens: z.number().optional(),
  inputToolTokens: z.number().optional(),

  // Output tokens breakdown
  outputTextTokens: z.number().optional(),
  outputImageTokens: z.number().optional(),
  outputAudioTokens: z.number().optional(),
  outputReasoningTokens: z.number().optional(),

  // Prediction tokens
  acceptedPredictionTokens: z.number().optional(),
  rejectedPredictionTokens: z.number().optional(),

  // Total tokens
  totalInputTokens: z.number().optional(),
  totalOutputTokens: z.number().optional(),
  totalTokens: z.number().optional(),

  // Cost
  cost: z.number().optional(),
});

export const ModelPerformanceSchema = z.object({
  tps: z.number().optional(),
  ttft: z.number().optional(),
  duration: z.number().optional(),
  latency: z.number().optional(),
});

// ============ Emoji Reaction ============ //

export interface EmojiReaction {
  count: number;
  emoji: string;
  users: string[];
}

export const EmojiReactionSchema = z.object({
  emoji: z.string(),
  count: z.number(),
  users: z.array(z.string()),
});

export interface InteractiveFormFieldOption {
  label: string;
  value: string;
}

interface BaseInteractiveFormField {
  defaultValue?: unknown;
  description?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
}

export interface InteractiveFormTextField extends BaseInteractiveFormField {
  type: 'text' | 'textarea';
}

export interface InteractiveFormChoiceField extends BaseInteractiveFormField {
  options: InteractiveFormFieldOption[];
  type: 'multiSelect' | 'radio' | 'select';
}

export interface InteractiveFormCheckboxField extends BaseInteractiveFormField {
  options?: InteractiveFormFieldOption[];
  type: 'checkbox';
}

export interface InteractiveFormDateField extends BaseInteractiveFormField {
  type: 'date' | 'dateRange';
}

export interface InteractiveFormNumberField extends BaseInteractiveFormField {
  max?: number;
  min?: number;
  step?: number;
  type: 'number' | 'slider';
}

export type InteractiveFormField =
  | InteractiveFormCheckboxField
  | InteractiveFormChoiceField
  | InteractiveFormDateField
  | InteractiveFormNumberField
  | InteractiveFormTextField;

export interface InteractiveFormDefinition {
  behavior?: {
    allowEditAfterSubmit?: boolean;
    generateSummary?: boolean;
    submitMode?: 'save-only' | 'send-message';
  };
  description?: string;
  fields: InteractiveFormField[];
  id: string;
  submitLabel?: string;
  title: string;
  version: 1;
}

export interface InteractiveFormSubmission {
  formId: string;
  submittedAt: string;
  summary: string;
  values: Record<string, unknown>;
}

const InteractiveFormFieldOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const BaseInteractiveFormFieldSchema = z.object({
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
  label: z.string(),
  name: z.string(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
});

const InteractiveFormFieldSchema = z.discriminatedUnion('type', [
  BaseInteractiveFormFieldSchema.extend({
    type: z.enum(['text', 'textarea']),
  }),
  BaseInteractiveFormFieldSchema.extend({
    options: z.array(InteractiveFormFieldOptionSchema),
    type: z.enum(['multiSelect', 'radio', 'select']),
  }),
  BaseInteractiveFormFieldSchema.extend({
    options: z.array(InteractiveFormFieldOptionSchema).optional(),
    type: z.literal('checkbox'),
  }),
  BaseInteractiveFormFieldSchema.extend({
    type: z.enum(['date', 'dateRange']),
  }),
  BaseInteractiveFormFieldSchema.extend({
    max: z.number().optional(),
    min: z.number().optional(),
    step: z.number().optional(),
    type: z.enum(['number', 'slider']),
  }),
]);

const InteractiveFormDefinitionSchema = z.object({
  behavior: z
    .object({
      allowEditAfterSubmit: z.boolean().optional(),
      generateSummary: z.boolean().optional(),
      submitMode: z.enum(['save-only', 'send-message']).optional(),
    })
    .optional(),
  description: z.string().optional(),
  fields: z.array(InteractiveFormFieldSchema),
  id: z.string(),
  submitLabel: z.string().optional(),
  title: z.string(),
  version: z.literal(1),
});

const InteractiveFormSubmissionSchema = z.object({
  formId: z.string(),
  submittedAt: z.string(),
  summary: z.string(),
  values: z.record(z.string(), z.unknown()),
});

/**
 * Generalized kind identifier for interactive widgets rendered inside assistant
 * messages (options cards, forms, and future kinds share this discriminator).
 */
export type InteractiveWidgetKind = 'form' | 'options';

export interface InteractiveWidgetSubmission {
  kind: InteractiveWidgetKind;
  submittedAt: string;
  summary: string;
  values: Record<string, unknown>;
  widgetId: string;
}

export const InteractiveWidgetSubmissionSchema = z.object({
  kind: z.enum(['form', 'options']),
  submittedAt: z.string(),
  summary: z.string(),
  values: z.record(z.string(), z.unknown()),
  widgetId: z.string(),
});

export const MessageMetadataSchema = ModelUsageSchema.merge(ModelPerformanceSchema).extend({
  autoRetryExhausted: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  interactiveForm: InteractiveFormDefinitionSchema.optional(),
  interactiveFormSubmission: InteractiveFormSubmissionSchema.optional(),
  interactiveWidgetSubmission: InteractiveWidgetSubmissionSchema.optional(),
  isIncomplete: z.boolean().optional(),
  inspectExpanded: z.boolean().optional(),
  isMultimodal: z.boolean().optional(),
  isSupervisor: z.boolean().optional(),
  pageSelections: z.array(PageSelectionSchema).optional(),
  reactions: z.array(EmojiReactionSchema).optional(),
  scope: z.string().optional(),
  subAgentId: z.string().optional(),
  stuckToolLoopBreak: z.boolean().optional(),
  toolExecutionTimeMs: z.number().optional(),
});

export interface ModelUsage extends ModelTokensUsage {
  /**
   * dollar
   */
  cost?: number;
}

export interface ModelPerformance {
  /**
   * from output start to output finish (ms)
   */
  duration?: number;
  /**
   * from input start to output finish (ms)
   */
  latency?: number;
  /**
   * tokens per second
   */
  tps?: number;
  /**
   * time to first token (ms)
   */
  ttft?: number;
}

export interface MessageMetadata extends ModelUsage, ModelPerformance {
  activeBranchIndex?: number;
  activeColumn?: boolean;
  autoRetryExhausted?: boolean;
  /**
   * Message collapse state
   * true: collapsed, false/undefined: expanded
   */
  collapsed?: boolean;
  compare?: boolean;
  finishType?: string;
  /**
   * Tool inspect expanded state
   * true: expanded, false/undefined: collapsed
   */
  inspectExpanded?: boolean;
  /**
   * Task instruction (for role='task' messages)
   * The instruction given by supervisor to the agent
   * Thread's sourceMessageId links back to this message for status tracking
   */
  instruction?: string;
  /**
   * Interactive form definition rendered inside an assistant message.
   */
  interactiveForm?: InteractiveFormDefinition;
  /**
   * Structured values submitted from an interactive form.
   */
  interactiveFormSubmission?: InteractiveFormSubmission;
  /**
   * Structured values submitted from any interactive widget (options/form/future kinds).
   * Generalized replacement for interactiveFormSubmission, which is kept for
   * backward-compatible rendering of historical messages.
   */
  interactiveWidgetSubmission?: InteractiveWidgetSubmission;
  /**
   * Stream ended without a terminal SSE event after auto-retry was exhausted
   */
  isIncomplete?: boolean;
  /**
   * Flag indicating if message content is multimodal (serialized MessageContentPart[])
   */
  isMultimodal?: boolean;
  /**
   * Flag indicating if message is from the Supervisor agent in group orchestration
   * Used by conversation-flow to transform role to 'supervisor' for UI rendering
   */
  isSupervisor?: boolean;
  /**
   * Page selections attached to user message
   * Used for Ask AI functionality to persist selection context
   */
  pageSelections?: PageSelection[];
  performance?: ModelPerformance;
  /**
   * Flag indicating if message is pinned (excluded from compression)
   */
  pinned?: boolean;
  /**
   * Emoji reactions on this message
   */
  reactions?: EmojiReaction[];
  /**
   * Message scope - indicates the context in which this message was created
   * Used by conversation-flow to determine how to handle message grouping and display
   * See MessageMapScope for available values
   */
  scope?: string;
  /**
   * Marks the assistant message created when the stuck-tool-loop circuit breaker fires.
   * `countTrailingIdenticalToolFailures` stops its backward scan here, so failures
   * reported once don't keep counting against later, independent retries.
   */
  stuckToolLoopBreak?: boolean;
  /**
   * Sub Agent ID - behavior depends on scope
   * - scope: 'sub_agent': conversation-flow will transform message.agentId to this value for display
   * - scope: 'group' | 'group_agent': indicates the agent that generated this message in group mode
   * Used by callAgent tool (sub_agent) and group orchestration (group modes)
   */
  subAgentId?: string;
  taskTitle?: string;
  // message content is multimodal, display content in the streaming, won't save to db
  tempDisplayContent?: string;
  /**
   * Tool execution time for tool messages (ms)
   */
  toolExecutionTimeMs?: number;
  usage?: ModelUsage;
}
