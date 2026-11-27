import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@lobechat/types';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { asyncTasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

const cancelPayloadSchema = z.object({
  // Optional human-readable cancellation reason.
  reason: z.string().trim().max(1000).optional(),
  // Async task id for user memory extraction.
  taskId: z.string().uuid(),
  // Optional ownership guard; when provided, must match task owner.
  userId: z.string().optional(),
});

export const POST = async (req: Request) => {
  const { webhook } = parseMemoryExtractionConfig();

  if (webhook.headers && Object.keys(webhook.headers).length > 0) {
    for (const [key, value] of Object.entries(webhook.headers)) {
      const headerValue = req.headers.get(key);
      if (headerValue !== value) {
        return NextResponse.json(
          { error: `Unauthorized: Missing or invalid header '${key}'` },
          { status: 403 },
        );
      }
    }
  }

  try {
    const payload = cancelPayloadSchema.parse(await req.json());
    const db = await getServerDB();

    const task = await db.query.asyncTasks.findFirst({
      where: and(
        eq(asyncTasks.id, payload.taskId),
        eq(asyncTasks.type, AsyncTaskType.UserMemoryExtractionWithChatTopic),
      ),
    });

    if (!task) {
      return NextResponse.json(
        { error: `Memory extraction task not found for id '${payload.taskId}'` },
        { status: 404 },
      );
    }

    if (payload.userId && payload.userId !== task.userId) {
      return NextResponse.json(
        { error: `Task '${payload.taskId}' does not belong to the provided userId` },
        { status: 403 },
      );
    }

    const asyncTaskModel = new AsyncTaskModel(db, task.userId);
    await asyncTaskModel.update(task.id, {
      error: new AsyncTaskError(
        AsyncTaskErrorType.ServerError,
        payload.reason || 'Memory extraction cancelled from webhook',
      ),
      status: AsyncTaskStatus.Error,
    });

    return NextResponse.json(
      {
        message: 'Memory extraction cancellation has been requested.',
        status: AsyncTaskStatus.Error,
        taskId: task.id,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[memory-user-memory/pipelines/extract/chat-topic/cancel] failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
