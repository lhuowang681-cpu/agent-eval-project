import { format, stripVTControlCharacters } from 'node:util';

import { triplog } from '@ctrip/vampire-core';
import type { Debug, Debugger } from 'debug-original';
import createDebugOriginal from 'debug-original';

// 主动激活 lobe-* 命名空间
// debug.enabled 是动态 getter，依赖 createDebug.namespaces
// 若不调用 enable，debug.enabled === false，instance.log 永远不会被执行
const existing = process.env.DEBUG ?? '';
const lobePattern = 'lobe-*';
if (
  !existing
    .split(',')
    .map((s) => s.trim())
    .includes(lobePattern)
) {
  createDebugOriginal.enable(existing ? `${existing},${lobePattern}` : lobePattern);
}

// 包裹 createDebug，对 lobe-* namespace 的实例注入 triplog 上报
const createDebug = (namespace: string): Debugger => {
  const instance = createDebugOriginal(namespace);

  if (namespace.startsWith('lobe-')) {
    const originalLog = (instance.log || createDebugOriginal.log).bind(instance);

    instance.log = function (this: Debugger, ...args: unknown[]) {
      // 用 util.format 插值 %O/%s/%d 等格式符，确保上报的是完整消息
      const formatted =
        typeof args[0] === 'string' ? format(...(args as [string, ...unknown[]])) : String(args[0]);
      const rawMsg = stripVTControlCharacters(formatted);

      triplog.custom({
        message: rawMsg,
        title: `debug.${namespace}`,
        type: 'debug',
      });

      // 保留原始 stderr 输出
      return originalLog(...(args as [string, ...unknown[]]));
    };
  }

  return instance;
};

// 复制静态方法（enable / disable / enabled / log 等）
Object.assign(createDebug, createDebugOriginal);

export default createDebug as unknown as Debug;
export * from 'debug-original';
