#!/usr/bin/env node
/**
 * In-process "device" that connects to the mock gateway and ACTUALLY runs
 * commands on THIS machine. Together with server.mjs this gives you a real,
 * online device for end-to-end testing of the device-execution path — no
 * desktop app, no real gateway, no cloud.
 *
 * Speaks the device side of the gateway WS protocol (see
 * @lobechat/device-gateway-client/src/types.ts):
 *   - on connect: send { type:'auth', token }
 *   - on 'tool_call_request': run it, reply { type:'tool_call_response', requestId, result }
 *   - on 'system_info_request': reply machine paths
 *   - on 'rpc_request' / 'message_api_request': minimal stubs
 *   - heartbeat every 25s
 *
 * Tool calls map `apiName: 'runCommand'` → spawn a shell on this machine. That's
 * how the app's `execScript` → deviceProxy.executeToolCall(runCommand) reaches
 * lark-cli locally.
 *
 * Usage (normally auto-spawned by server.mjs):
 *   node device-worker.mjs --gateway ws://localhost:9001 --user <USER_ID> --token devtoken --device local-host
 */
import { exec } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import WebSocket from 'ws';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const GATEWAY = getArg('gateway', 'ws://localhost:9001');
const USER_ID = getArg('user', '');
const TOKEN = getArg('token', 'devtoken');
const DEVICE_ID = getArg('device', `local-${os.hostname()}`);
const CONNECTION_ID = `worker-${Math.random().toString(36).slice(2)}`;

const log = (...a) => console.log(`[device] ${new Date().toISOString().slice(11, 19)}`, ...a);

const home = os.homedir();
const systemInfo = {
  arch: process.arch,
  desktopPath: path.join(home, 'Desktop'),
  documentsPath: path.join(home, 'Documents'),
  downloadsPath: path.join(home, 'Downloads'),
  homePath: home,
  musicPath: path.join(home, 'Music'),
  picturesPath: path.join(home, 'Pictures'),
  userDataPath: home,
  videosPath: path.join(home, 'Movies'),
  workingDirectory: home,
};

/** Run a shell command on this machine and return the gateway tool-call envelope. */
const runCommand = (command, cwd) =>
  new Promise((resolve) => {
    log(`runCommand: ${String(command).slice(0, 200)}`);
    exec(
      command,
      { cwd: cwd || home, maxBuffer: 1024 * 1024 * 16, timeout: 110_000 },
      (error, stdout, stderr) => {
        const out = (stdout || '') + (stderr ? `\n${stderr}` : '');
        if (error && error.killed) {
          resolve({ content: out, error: 'command timed out', success: false });
          return;
        }
        // Non-zero exit is still a "successful" relay — surface output + code to the model.
        resolve({
          content: out || (error ? String(error.message) : ''),
          state: { exitCode: error?.code ?? 0 },
          success: !error,
        });
      },
    );
  });

const buildWsUrl = () => {
  const params = new URLSearchParams({
    connectionId: CONNECTION_ID,
    deviceId: DEVICE_ID,
    hostname: os.hostname(),
    platform: process.platform,
    userId: USER_ID,
  });
  return `${GATEWAY}/ws?${params.toString()}`;
};

let ws;
let heartbeat;

const connect = () => {
  ws = new WebSocket(buildWsUrl());

  ws.on('open', () => {
    ws.send(JSON.stringify({ token: TOKEN, tokenType: 'serviceToken', type: 'auth' }));
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    switch (msg.type) {
      case 'auth_success': {
        log(`registered as device "${DEVICE_ID}" for user ${USER_ID}`);
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' }));
        }, 25_000);
        break;
      }
      case 'auth_failed': {
        log(`auth failed: ${msg.reason}`);
        break;
      }
      case 'heartbeat_ack': {
        break;
      }
      case 'tool_call_request': {
        const { apiName, arguments: argsStr } = msg.toolCall || {};
        let parsed;
        try {
          parsed = argsStr ? JSON.parse(argsStr) : {};
        } catch {
          parsed = {};
        }
        let result;
        if (apiName === 'runCommand') {
          result = await runCommand(parsed.command, parsed.cwd);
        } else {
          result = {
            content: `mock device: unsupported apiName "${apiName}"`,
            error: 'unsupported_api',
            success: false,
          };
        }
        ws.send(JSON.stringify({ requestId: msg.requestId, result, type: 'tool_call_response' }));
        break;
      }
      case 'system_info_request': {
        ws.send(
          JSON.stringify({
            requestId: msg.requestId,
            result: { success: true, systemInfo },
            type: 'system_info_response',
          }),
        );
        break;
      }
      case 'rpc_request': {
        // Minimal: acknowledge unknown RPCs so the server doesn't hang.
        ws.send(
          JSON.stringify({
            requestId: msg.requestId,
            result: { data: null, success: true },
            type: 'rpc_response',
          }),
        );
        break;
      }
      case 'message_api_request': {
        ws.send(
          JSON.stringify({
            requestId: msg.requestId,
            result: { content: '', error: 'not_supported', success: false },
            type: 'message_api_response',
          }),
        );
        break;
      }
      default: {
        break;
      }
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    log('disconnected, reconnecting in 2s…');
    setTimeout(connect, 2000);
  });

  ws.on('error', (err) => {
    log(`ws error: ${err.message}`);
  });
};

if (!USER_ID) {
  console.error('✗ --user <USER_ID> is required');
  process.exit(1);
}

connect();
