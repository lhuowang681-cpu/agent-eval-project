export interface GenerateObjectPayload {
  scoreMode?: 'binary' | 'continuous';
  timeoutMs?: number;
  messages: { content: string; role: 'system' | 'user' }[];
  model: string;
  provider?: string;
  schema: Record<string, unknown>;
}

export interface MatchContext {
  taskContext?: { input: string; choices?: string[]; category?: string };
  generateObject?: (payload: GenerateObjectPayload) => Promise<{ reason: string; score: number }>;
  judgeModel?: string;
}

export interface MatchResult {
  passed: boolean;
  reason?: string;
  score: number;
}
