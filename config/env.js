// config/env.js · 云环境映射（envVersion -> envId）。envId 不是密钥，可入库。
// D1 修订（2026-10-22 用户告知：账号只能开通 1 个云环境）：
//   三档共用同一个 envId（单环境方案）。保留 ENV_MAP 形状，将来若可开第二环境，
//   只改本文件（develop/trial -> dev，release -> prod），调用方无需改动。
const ENV_ID = '__ENV_ID__';

const ENV_MAP = {
  develop: ENV_ID,
  trial: ENV_ID,
  release: ENV_ID
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

module.exports = {
  ENV_MAP,
  pick,
  isUsable
};
