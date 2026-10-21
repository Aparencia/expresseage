// config/env.js · 云环境映射（envVersion -> envId）。envId 不是密钥，可入库。
// 批 1 开工门：由用户在云开发控制台创建环境后把真实 envId 填到 __DEV_ENV_ID__ / __PROD_ENV_ID__。
const ENV_MAP = {
  develop: '__DEV_ENV_ID__',
  trial: '__DEV_ENV_ID__',
  release: '__PROD_ENV_ID__'
};

const PLACEHOLDER_PREFIX = '__';

function pick(envVersion) {
  return ENV_MAP[envVersion] || ENV_MAP.develop;
}

function isUsable(envId) {
  if (typeof envId !== 'string') {
    return false;
  }
  const value = envId.trim();
  return value.length > 0 && value.indexOf(PLACEHOLDER_PREFIX) !== 0;
}

function envOf(envVersion) {
  return envVersion === 'release' ? 'prod' : 'dev';
}

module.exports = {
  ENV_MAP,
  pick,
  isUsable,
  envOf
};
