import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getLLMConfig } from '@/envs/llm';

// ============ Error Types ============

export class EmpcodeNotFoundError extends Error {
  constructor(userId: string) {
    super(`Ada: empcode not found for user ${userId}`);
    this.name = 'EmpcodeNotFoundError';
  }
}

export class AdaConfigMissingError extends Error {
  constructor() {
    super('Ada: ADA_APP_ID or ADA_APP_SECRET not configured');
    this.name = 'AdaConfigMissingError';
  }
}

export class NoCodingPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoCodingPlanError';
  }
}

export class AdaGatewayError extends Error {
  constructor(status: number, body: string) {
    super(`Ada gateway error: ${status} ${body}`);
    this.name = 'AdaGatewayError';
    this.cause = body;
  }
}

// ============ Cache Structures ============

interface TokenCacheValue {
  expiresAt: number; // Unix timestamp in seconds
  token: string;
}

// Ada token exchange response structure
interface AdaTokenExchangeResponse {
  data: {
    token: string;
    tokenId: string;
    expiresAt: string; // ISO 8601 date string, e.g. '2026-04-24T09:27:01.448Z'
    user: {
      empcode: string;
    };
    app: {
      appId: string;
    };
  };
  message?: string; // present when success=false
  success: boolean;
}

const ADA_TOKEN_EXCHANGE_URL =
  'http://ada-cli-golang.ctripcorp.com/api/coding-plan/integration-apps/token/exchange';

const CACHE_EXPIRY_BUFFER_SECONDS = 300; // 5 minutes buffer

export const ADA_CODING_PLAN_REQUIRED_MESSAGE = 'ada需要激活coding plan套餐才能使用';
export const ADA_GATEWAY_UNAVAILABLE_MESSAGE = 'Ada 服务暂时不可用，请稍后重试';

const parseExchangeErrorMessage = (errorBody: string): string | undefined => {
  const trimmed = errorBody.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // plain-text error body
  }

  return trimmed.length <= 500 ? trimmed : undefined;
};

// Token cache: userId -> { token, expiresAt }
const tokenCache = new Map<string, TokenCacheValue>();

// Deduplication map: userId -> ongoing exchange Promise
const pendingExchanges = new Map<string, Promise<string>>();

// ============ Service ============

export class AdaTokenService {
  constructor(private db: LobeChatDatabase) {}

  async exchangeToken(userId: string): Promise<string> {
    // 1. Check cache
    const cached = tokenCache.get(userId);
    if (cached && cached.expiresAt > Date.now() / 1000 + CACHE_EXPIRY_BUFFER_SECONDS) {
      return cached.token;
    }

    // 2. Deduplication: if there's an ongoing exchange for this userId, wait for it
    const pending = pendingExchanges.get(userId);
    if (pending) {
      return pending;
    }

    // 3. Start a new exchange
    const exchangePromise = this._doExchange(userId);
    pendingExchanges.set(userId, exchangePromise);

    try {
      const token = await exchangePromise;
      return token;
    } finally {
      pendingExchanges.delete(userId);
    }
  }

  private async _doExchange(userId: string): Promise<string> {
    // 1. Get empcode from database
    const _row = await this.db.query.users.findFirst({
      columns: { username: true },
      where: eq(users.id, userId),
    });
    const empcode = _row?.username;

    if (!empcode || !empcode.trim()) {
      throw new EmpcodeNotFoundError(userId);
    }

    // 2. Check environment variables
    const llmConfig = getLLMConfig();
    const appId = llmConfig.ADA_APP_ID;
    const appSecret = llmConfig.ADA_APP_SECRET;
    if (!appId || !appSecret) {
      throw new AdaConfigMissingError();
    }

    // 3. Call Ada token exchange
    const res = await fetch(ADA_TOKEN_EXCHANGE_URL, {
      body: JSON.stringify({ appId, appSecret, empcode: empcode.trim() }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!res.ok) {
      const errorBody = await res.text();
      const message =
        parseExchangeErrorMessage(errorBody) ??
        (res.status >= 500 ? ADA_GATEWAY_UNAVAILABLE_MESSAGE : ADA_CODING_PLAN_REQUIRED_MESSAGE);

      if (res.status >= 500) {
        throw new AdaGatewayError(res.status, message);
      }

      throw new NoCodingPlanError(message);
    }

    const result = (await res.json()) as AdaTokenExchangeResponse;

    // 4. Check success field (top-level)
    if (result.success === false) {
      throw new NoCodingPlanError(result.message || '目标用户未生效 Coding Plan 套餐');
    }

    // 5. Extract token from data nested structure
    const token = result.data?.token;
    if (!token) {
      throw new AdaGatewayError(200, ADA_GATEWAY_UNAVAILABLE_MESSAGE);
    }

    // 6. Cache the token
    // expiresAt is an ISO 8601 string; convert to Unix timestamp in seconds
    // Fall back to current time + 24h (86400s) if not provided
    const expiresAtIso = result.data?.expiresAt;
    const expiresAt = expiresAtIso
      ? new Date(expiresAtIso).getTime() / 1000
      : Date.now() / 1000 + 86400;
    tokenCache.set(userId, { expiresAt, token });

    return token;
  }

  /** Clear all cached tokens - used for testing and admin operations */
  clearCache(): void {
    tokenCache.clear();
    pendingExchanges.clear();
  }
}
