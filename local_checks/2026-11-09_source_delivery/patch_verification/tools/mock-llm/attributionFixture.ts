import type { MockTurn } from './types';

/** Controlled candidate echo. This tests HTTP/SDK/gating, never model reasoning quality. */
export function attributionFixture(request: { messages?: { role?: string; content?: unknown }[]; response_format?: { type?: string } }): MockTurn {
  const lastUser = request.messages?.filter(message => message.role === 'user').at(-1);
  try {
    if (request.response_format?.type !== 'json_schema' || typeof lastUser?.content !== 'string') throw new Error('Invalid fixture request');
    const value = JSON.parse(lastUser.content);
    if (!Object.hasOwn(value, 'syntheticCandidate')) throw new Error('Candidate required');
    return { content: JSON.stringify(value.syntheticCandidate), firstTokenDelayMs: 0, tokensPerSecond: 0 };
  } catch {
    return { error: { kind: 'http', status: 400, message: 'Offline attribution fixture requires schema and explicit syntheticCandidate' } };
  }
}
