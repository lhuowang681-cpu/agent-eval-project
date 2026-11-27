// debug-original 是 debug 的 npm 别名，显式声明所有导出以提供完整类型
declare module 'debug-original' {
  import type debug from 'debug';

  const createDebug: debug.Debug;
  export default createDebug;
  export type Debug = debug.Debug;
  export type Debugger = debug.Debugger;
}
