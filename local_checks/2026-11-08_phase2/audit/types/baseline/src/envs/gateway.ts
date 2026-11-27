import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const getGatewayConfig = () => {
  return createEnv({
    runtimeEnv: {
      AGENT_GATEWAY_URL: process.env.AGENT_GATEWAY_URL,
      DEVICE_GATEWAY_SERVICE_TOKEN: process.env.DEVICE_GATEWAY_SERVICE_TOKEN,
      DEVICE_GATEWAY_URL: process.env.DEVICE_GATEWAY_URL,
      ENABLE_GATEWAY_MODE: process.env.ENABLE_GATEWAY_MODE,
      MESSAGE_GATEWAY_ENABLED: process.env.MESSAGE_GATEWAY_ENABLED,
      MESSAGE_GATEWAY_SERVICE_TOKEN: process.env.MESSAGE_GATEWAY_SERVICE_TOKEN,
      MESSAGE_GATEWAY_URL: process.env.MESSAGE_GATEWAY_URL,
    },

    server: {
      // Base URL of the Agent Gateway WebSocket service the client connects to
      // for server-dispatched agent runs (sandbox / device / auto execution).
      AGENT_GATEWAY_URL: z.string().url().optional(),
      DEVICE_GATEWAY_SERVICE_TOKEN: z.string().optional(),
      DEVICE_GATEWAY_URL: z.string().url().optional(),
      // When 'true' (and AGENT_GATEWAY_URL is set), agent runs are dispatched to
      // the server over the Agent Gateway instead of running in-process.
      ENABLE_GATEWAY_MODE: z.string().optional(),
      MESSAGE_GATEWAY_ENABLED: z.string().optional(),
      MESSAGE_GATEWAY_SERVICE_TOKEN: z.string().optional(),
      MESSAGE_GATEWAY_URL: z.string().url().optional(),
    },
  });
};

export const gatewayEnv = getGatewayConfig();
