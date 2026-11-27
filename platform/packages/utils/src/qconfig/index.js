import { qconfig } from '@ctrip/vampire-core';

// 只有配置在这里的key才能cache到内存中
const keys = ['ai-infra-config.json', 'app-config.json'];

const configCache = Object.create(null);

function setConfig(config, data) {
  configCache[config] = data;
}

keys.forEach(async (key) => {
  const config = qconfig.getConfig(key);

  setConfig(key, await config.get());

  config.on('change', (event) => {
    setConfig(key, event.configData);
  });
});

/*
 * 获取qconfig配置
 */
export function getQConfig(key) {
  if (keys.includes(key)) {
    return configCache[key];
  }
  throw new Error(`could not find qconfig key ${key}`);
}
