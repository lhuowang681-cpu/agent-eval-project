export interface RunBenchmarkPayload {
  dryRun?: boolean;
  force?: boolean;
  runId: string;
  userId: string;
}

export interface PaginateTestCasesPayload {
  cursor?: string;
  runId: string;
  testCaseIds?: string[];
  userId: string;
}

export interface ExecuteTestCasePayload {
  runId: string;
  testCaseId: string;
  userId: string;
}

export interface RunAgentTrajectoryPayload {
  runId: string;
  testCaseId: string;
  userId: string;
}

export interface FinalizeRunPayload {
  runId: string;
  userId: string;
}

export interface OnTrajectoryCompletePayload {
  cost?: number;
  duration?: number;
  errorDetail?: unknown;
  errorMessage?: string;
  llmCalls?: number;
  operationId: string;
  reason: string;
  runId: string;
  status: string;
  steps?: number;
  testCaseId: string;
  toolCalls?: number;
  totalTokens?: number;
  userId: string;
}

export interface RunThreadTrajectoryPayload {
  runId: string;
  testCaseId: string;
  threadId: string;
  topicId: string;
  userId: string;
}

export interface OnThreadCompletePayload {
  cost?: number;
  duration?: number;
  errorMessage?: string;
  llmCalls?: number;
  operationId: string;
  reason: string;
  runId: string;
  status: string;
  steps?: number;
  testCaseId: string;
  threadId: string;
  toolCalls?: number;
  topicId: string;
  totalTokens?: number;
  userId: string;
}
