export { honoApp as default } from './app';
/**
 * 从包根导出，供应用侧接线跨实例失效（本包不反向依赖应用侧）。
 * package.json 没有 exports 映射，子路径导入不可靠，故走根导出。
 */
export { invalidateApiKeyCache } from './middleware/auth';
