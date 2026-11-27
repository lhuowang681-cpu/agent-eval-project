#!/usr/bin/env node
/**
 * Minimal mock Device Gateway for LOCAL development.
 *
 * Stands in for the closed-source `device-gateway.calcifer.train.ctripcorp.com` (and the OSS
 * `device-gateway-go`) so the device-execution path can be exercised end to end
 * on one machine without deploying anything. Implements the exact wire protocol
 * the app's `@lobechat/device-gateway-client` speaks:
 *
 *   - HTTP (server → gateway), Bearer <serviceToken>:
 *       POST /api/device/status        → { online, deviceCount }
 *       POST /api/device/devices       → { devices: GatewayDevice[] }
 *       POST /api/device/system-info   → { success, systemInfo }
 *       POST /api/device/tool-call     → { content, state, success, error? }
 *       POST /api/device/rpc           → { success, data?, error? }
 *       POST /api/device/message-api   → { content, success, error? }
 *
 *   - WebSocket (device → gateway) at /ws?deviceId=..&connectionId=..&userId=..:
 *       device sends  { type:'auth', token, ... }   → gateway replies auth_success
 *       device sends  { type:'heartbeat' }          → gateway replies heartbeat_ack
 *       gateway sends { type:'tool_call_request', requestId, toolCall }
 *       device sends  { type:'tool_call_response', requestId, result }
 *       (same request/response correlation for system_info / rpc / message_api)
 *
 * It ALSO bundles an in-process "device worker" (see ./device-worker.mjs) that
 * connects over this same WS and actually runs commands on THIS machine, so you
 * get a real, online device with zero extra setup. The worker registers under
 * the userId you pass via --user.
 *
 * Auth here is intentionally permissive (dev only): any non-empty serviceToken
 * passes. Do NOT use this in production — deploy device-gateway-go instead.
 *
 * Usage:
 *   node scripts/mock-device-gateway/server.mjs --user <USER_ID> [--port 9001] [--token devtoken]
 *
 * Then point the app's server at it:
 *   DEVICE_GATEWAY_URL=http://localhost:9001
 *   DEVICE_GATEWAY_SERVICE_TOKEN=devtoken
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(getArg('port', '9001'));
const SERVICE_TOKEN = getArg('token', 'devtoken');
const USER_ID = getArg('user', '');
const NO_WORKER = args.includes('--no-worker');

if (!USER_ID) {
  console.error('✗ --user <USER_ID> is required (the app user that owns the device)');
  process.exit(1);
}

const log = (...a) => console.log(`[gateway] ${new Date().toISOString().slice(11, 19)}`, ...a);

/**
 * Registry of live device connections, keyed by userId.
 * Map<userId, Map<connectionId, { ws, deviceId, hostname, platform, channel, connectedAt }>>
 */
const connectionsByUser = new Map();
/** Pending request → resolver, keyed by requestId. */
const pending = new Map();

const getUserConns = (userId) => {
  let m = connectionsByUser.get(userId);
  if (!m) {
    m = new Map();
    connectionsByUser.set(userId, m);
  }
  return m;
};

/** Collapse this user's live connections into GatewayDevice[] (one per deviceId). */
const listDevices = (userId) => {
  const conns = connectionsByUser.get(userId);
  if (!conns || conns.size === 0) return [];
  const byDevice = new Map();
  for (const c of conns.values()) {
    let d = byDevice.get(c.deviceId);
    if (!d) {
      d = {
        channels: [],
        connectedAt: c.connectedAt,
        deviceId: c.deviceId,
        hostname: c.hostname,
        platform: c.platform,
      };
      byDevice.set(c.deviceId, d);
    }
    d.channels.push({
      channel: c.channel,
      connectedAt: c.connectedAt,
      connectionId: c.connectionId,
    });
    d.connectedAt = Math.max(d.connectedAt, c.connectedAt);
  }
  return [...byDevice.values()];
};

/** Pick a target connection: explicit deviceId, else the user's first live one. */
const pickConnection = (userId, deviceId) => {
  const conns = connectionsByUser.get(userId);
  if (!conns || conns.size === 0) return null;
  if (deviceId) {
    for (const c of conns.values()) if (c.deviceId === deviceId) return c;
    return null;
  }
  return [...conns.values()][0];
};

/** Send a request to a device and await its response by requestId. */
const requestDevice = (conn, message, timeoutMs) =>
  new Promise((resolve) => {
    const requestId = message.requestId;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ error: 'device response timeout', success: false, timedOut: true });
    }, timeoutMs);
    pending.set(requestId, (result) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(result);
    });
    conn.ws.send(JSON.stringify(message));
  });

// ─── HTTP server (server → gateway) ───

const readJson = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });

const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const httpServer = createServer(async (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${SERVICE_TOKEN}`) {
    return send(res, 401, { error: 'unauthorized' });
  }
  const body = await readJson(req);
  const userId = body.userId;
  const url = req.url || '';

  if (url === '/api/device/status') {
    const devices = listDevices(userId);
    return send(res, 200, { deviceCount: devices.length, online: devices.length > 0 });
  }

  if (url === '/api/device/devices') {
    return send(res, 200, { devices: listDevices(userId) });
  }

  if (url === '/api/device/system-info') {
    const conn = pickConnection(userId, body.deviceId);
    if (!conn) return send(res, 200, { success: false });
    const requestId = `sys_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const result = await requestDevice(conn, { requestId, type: 'system_info_request' }, 10_000);
    return send(res, 200, result);
  }

  if (url === '/api/device/tool-call') {
    const conn = pickConnection(userId, body.deviceId);
    if (!conn) {
      return send(res, 200, { content: 'No device online', error: 'no_device', success: false });
    }
    const requestId = `tc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timeout = Number.isFinite(body.timeout) ? body.timeout : 120_000;
    log(`tool-call → device ${conn.deviceId} apiName=${body.toolCall?.apiName}`);
    const result = await requestDevice(
      conn,
      {
        operationId: body.operationId,
        requestId,
        timeout,
        toolCall: body.toolCall,
        type: 'tool_call_request',
      },
      timeout + 5_000,
    );
    return send(res, 200, result);
  }

  if (url === '/api/device/rpc') {
    const conn = pickConnection(userId, body.deviceId);
    if (!conn) return send(res, 200, { error: 'no_device', success: false });
    const requestId = `rpc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timeout = Number.isFinite(body.timeout) ? body.timeout : 30_000;
    const result = await requestDevice(
      conn,
      { method: body.method, params: body.params, requestId, timeout, type: 'rpc_request' },
      timeout + 5_000,
    );
    return send(res, 200, result);
  }

  if (url === '/api/device/message-api') {
    const conn = pickConnection(userId, body.deviceId);
    if (!conn) return send(res, 200, { content: '', error: 'no_device', success: false });
    const requestId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const result = await requestDevice(
      conn,
      { api: body.api, requestId, type: 'message_api_request' },
      30_000,
    );
    return send(res, 200, result);
  }

  return send(res, 404, { error: 'not found' });
});

// ─── WebSocket server (device → gateway) ───

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const q = url.searchParams;
    const meta = {
      channel: q.get('channel') || undefined,
      connectedAt: Date.now(),
      connectionId: q.get('connectionId') || `conn_${Math.random().toString(36).slice(2)}`,
      deviceId: q.get('deviceId') || `dev_${Math.random().toString(36).slice(2)}`,
      hostname: q.get('hostname') || 'unknown',
      platform: q.get('platform') || 'unknown',
      userId: q.get('userId') || undefined, // serviceToken mode passes userId in query
      ws,
    };

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'auth') {
        // Dev gateway: accept any token. In serviceToken mode the userId comes
        // from the query string; some clients also carry it in the token.
        const userId = meta.userId || msg.userId;
        if (!userId) {
          ws.send(JSON.stringify({ reason: 'no userId', type: 'auth_failed' }));
          return;
        }
        meta.userId = userId;
        getUserConns(userId).set(meta.connectionId, meta);
        ws.send(JSON.stringify({ type: 'auth_success' }));
        log(
          `device connected: user=${userId} deviceId=${meta.deviceId} host=${meta.hostname} ch=${meta.channel ?? '-'}`,
        );
        return;
      }

      if (msg.type === 'heartbeat') {
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        return;
      }

      // Responses from the device → resolve the matching pending request.
      if (
        msg.type === 'tool_call_response' ||
        msg.type === 'system_info_response' ||
        msg.type === 'rpc_response' ||
        msg.type === 'message_api_response'
      ) {
        const resolver = pending.get(msg.requestId);
        if (resolver) resolver(msg.result ?? {});
        return;
      }
    });

    ws.on('close', () => {
      if (meta.userId) {
        getUserConns(meta.userId).delete(meta.connectionId);
        log(`device disconnected: user=${meta.userId} deviceId=${meta.deviceId}`);
      }
    });
  });
});

httpServer.listen(PORT, () => {
  log(`mock device gateway listening on http://localhost:${PORT}`);
  log(`  DEVICE_GATEWAY_URL=http://localhost:${PORT}`);
  log(`  DEVICE_GATEWAY_SERVICE_TOKEN=${SERVICE_TOKEN}`);
  log(`  owner userId=${USER_ID}`);

  if (!NO_WORKER) {
    // Spawn the bundled device worker so there's a real, online device.
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const worker = spawn(
      process.execPath,
      [
        path.join(dir, 'device-worker.mjs'),
        '--gateway',
        `ws://localhost:${PORT}`,
        '--user',
        USER_ID,
        '--token',
        SERVICE_TOKEN,
        '--device',
        `local-${os.hostname()}`,
      ],
      { stdio: 'inherit' },
    );
    worker.on('exit', (code) => log(`device worker exited (code ${code})`));
    process.on('exit', () => worker.kill());
  }
});
