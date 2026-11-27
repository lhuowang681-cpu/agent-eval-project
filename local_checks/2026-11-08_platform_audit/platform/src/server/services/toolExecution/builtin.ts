import { builtinTools } from '@lobechat/builtin-tools';
import { type LobeChatDatabase } from '@lobechat/database';
import { type ChatToolPayload } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import debug from 'debug';

import { KlavisService } from '@/server/services/klavis';
import { MarketService } from '@/server/services/market';

import { getServerRuntime, hasServerRuntime } from './serverRuntimes';
import { type IToolExecutor, type ToolExecutionContext, type ToolExecutionResult } from './types';

const log = debug('lobe-server:builtin-tools-executor');

interface JsonSchemaLite {
  items?: JsonSchemaLite;
  properties?: Record<string, JsonSchemaLite>;
  type?: string | string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const inferSchemaTypes = (schema?: JsonSchemaLite): string[] => {
  if (!schema) return [];
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) return schema.type.filter((item): item is string => !!item);
  if (schema.properties) return ['object'];
  if (schema.items) return ['array'];

  return [];
};

const tryParseStructuredString = (value: string): unknown | undefined => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;

  return safeParseJSON(trimmed);
};

const coerceValueBySchema = (value: unknown, schema?: JsonSchemaLite): unknown => {
  if (!schema) return value;

  let currentValue = value;
  const schemaTypes = inferSchemaTypes(schema);
  const expectsObject = schemaTypes.includes('object');
  const expectsArray = schemaTypes.includes('array');

  if (typeof currentValue === 'string' && (expectsObject || expectsArray)) {
    const parsed = tryParseStructuredString(currentValue);
    if (parsed !== undefined) {
      currentValue = parsed;
    }
  }

  if (expectsObject && isRecord(currentValue) && schema.properties) {
    const nextValue: Record<string, unknown> = { ...currentValue };
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      nextValue[key] = coerceValueBySchema(nextValue[key], propertySchema);
    }

    return nextValue;
  }

  if (expectsArray && Array.isArray(currentValue) && schema.items) {
    return currentValue.map((item) => coerceValueBySchema(item, schema.items));
  }

  return currentValue;
};

const coerceBuiltinArgsBySchema = (
  args: Record<string, unknown>,
  identifier: string,
  apiName: string,
): Record<string, unknown> => {
  const manifest = builtinTools.find((tool) => tool.identifier === identifier)?.manifest;
  const apiSchema = manifest?.api?.find((api) => api.name === apiName)?.parameters;

  if (!isRecord(apiSchema)) return args;

  const coerced = coerceValueBySchema(args, apiSchema as JsonSchemaLite);

  return isRecord(coerced) ? coerced : args;
};

export class BuiltinToolsExecutor implements IToolExecutor {
  private marketService: MarketService;
  private klavisService: KlavisService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.marketService = new MarketService({ serverDB: db, userInfo: { userId } });
    this.klavisService = new KlavisService({ db, userId });
  }

  async execute(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { identifier, apiName, arguments: argsStr, source } = payload;
    const parsedArgs = safeParseJSON<unknown>(argsStr);
    const args = isRecord(parsedArgs)
      ? coerceBuiltinArgsBySchema(parsedArgs, identifier, apiName)
      : {};

    log(
      'Executing builtin tool: %s:%s (source: %s) with args: %O',
      identifier,
      apiName,
      source,
      args,
    );

    // Route TripYoYo Skills to MarketService
    if (source === 'lobehubSkill') {
      return this.marketService.executeLobehubSkill({
        args,
        provider: identifier,
        toolName: apiName,
      });
    }

    // Route Klavis tools to KlavisService
    if (source === 'klavis') {
      return this.klavisService.executeKlavisTool({
        args,
        identifier,
        toolName: apiName,
      });
    }

    // Use server runtime registry (handles both pre-instantiated and per-request runtimes)
    if (!hasServerRuntime(identifier)) {
      throw new Error(`Builtin tool "${identifier}" is not implemented`);
    }

    // Await runtime in case factory is async
    const runtime = await getServerRuntime(identifier, context);

    if (!runtime[apiName]) {
      throw new Error(`Builtin tool ${identifier}'s ${apiName} is not implemented`);
    }

    const contextWithToolCallId: ToolExecutionContext = { ...context, toolCallId: payload.id };

    try {
      return await runtime[apiName](args, contextWithToolCallId);
    } catch (e) {
      const error = e as Error;
      console.error('Error executing builtin tool %s:%s: %O', identifier, apiName, error);

      return { content: error.message, error, success: false };
    }
  }
}
