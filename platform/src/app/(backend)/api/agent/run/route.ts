import { triplog } from '@ctrip/vampire-core';
import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { verifyQStashSignature } from '@/libs/qstash';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';

const log = debug('api-route:agent:execute-step');

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Read raw body for signature verification (must be done before parsing JSON)
  const rawBody = await request.text();

  if (!(await verifyQStashSignature(request, rawBody))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse body after verification
  const body = JSON.parse(rawBody);
  try {
    const {
      operationId,
      stepIndex = 0,
      context,
      humanInput,
      approvedToolCall,
      rejectionReason,
    } = body;

    if (!operationId) {
      return NextResponse.json({ error: 'operationId is required' }, { status: 400 });
    }

    log(`[${operationId}] Starting step ${stepIndex}`);

    // Get userId from operation metadata stored in Redis
    const coordinator = new AgentRuntimeCoordinator();
    const metadata = await coordinator.getOperationMetadata(operationId);

    if (!metadata?.userId) {
      log(`[${operationId}] Invalid operation or no userId found`);
      return NextResponse.json({ error: 'Invalid operation or unauthorized' }, { status: 401 });
    }

    // 注入全链路上下文，传播到所有下游服务
    triplog.setTraceContext('uid', metadata.userId);

    const model = metadata.modelRuntimeConfig?.model;
    const provider = metadata.modelRuntimeConfig?.provider;

    triplog.setTraceContext('model', model);
    triplog.setTraceContext('provider', provider);

    triplog.custom({
      message: `[START] agent.run | operationId=${operationId} stepIndex=${stepIndex} user=${metadata.userId}${model ? ` model=${model} provider=${provider}` : ''}`,
      title: 'agent.run',
      type: 'info',
    });

    // Initialize service with userId from operation metadata
    const serverDB = await getServerDB();
    const agentRuntimeService = new AgentRuntimeService(serverDB, metadata.userId);

    // Execute step using AgentRuntimeService
    const result = await agentRuntimeService.executeStep({
      approvedToolCall,
      context,
      humanInput,
      operationId,
      rejectionReason,
      stepIndex,
    });

    // Step is currently being executed by another instance — tell QStash to retry later
    if (result.locked) {
      log(`[${operationId}] Step ${stepIndex} locked by another instance, returning 429`);
      return NextResponse.json(
        { error: 'Step is currently being executed, retry later', operationId, stepIndex },
        {
          status: 429,
          headers: {
            'Retry-After': '37', // unit: seconds
          },
        },
      );
    }

    const executionTime = Date.now() - startTime;

    const responseData = {
      completed: result.state.status === 'done',
      error: result.state.status === 'error' ? result.state.error : undefined,
      executionTime,
      nextStepIndex: result.nextStepScheduled ? stepIndex + 1 : undefined,
      nextStepScheduled: result.nextStepScheduled,
      operationId,
      pendingApproval: result.state.pendingToolsCalling,
      pendingPrompt: result.state.pendingHumanPrompt,
      pendingSelect: result.state.pendingHumanSelect,
      status: result.state.status,
      stepIndex,
      success: result.success,
      totalCost: result.state.cost?.total || 0,
      totalSteps: result.state.stepCount,
      waitingForHuman: result.state.status === 'waiting_for_human',
    };

    log(
      `[${operationId}] Step ${stepIndex} completed (${executionTime}ms, status: ${result.state.status})`,
    );

    triplog.custom({
      message: `[END] agent.run | operationId=${operationId} stepIndex=${stepIndex} user=${metadata.userId} duration=${executionTime}ms status=${result.state.status} success=${result.success}${model ? ` model=${model}` : ''}`,
      title: 'agent.run',
      type: 'info',
    });

    return NextResponse.json(responseData);
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    console.error('Error in execution: %O', error);

    triplog.custom({
      message: `[ERROR] agent.run | operationId=${body?.operationId} stepIndex=${body?.stepIndex || 0} duration=${executionTime}ms error=${error instanceof Error ? error.message : String(error)}`,
      title: 'agent.run',
      type: 'error',
    });

    return NextResponse.json(
      {
        error: error.message,
        executionTime,
        operationId: body?.operationId,
        stepIndex: body?.stepIndex || 0,
      },
      { status: 500 },
    );
  }
}

/**
 * Health check endpoint
 */
export async function GET() {
  try {
    return NextResponse.json({
      healthy: true,
      message: 'Agent execution service is running',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message,
        healthy: false,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
