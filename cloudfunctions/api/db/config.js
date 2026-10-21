// db/config.js · 云端运行时配置（config/_id='global'）+ 默认值 + 公开子集
// 默认值唯一来源 = shared/defaults.js（由 tools/sync-cloud-shared.js 从 config/defaults.js 复制），
// 云端不另写一份默认值；读库时把 config 种子覆盖在默认值之上。
const { COLLECTIONS, CONFIG_DOC_ID } = require('./collections');
const sharedDefaults = require('../shared/defaults');

const DEFAULT_CONFIG = sharedDefaults.DEFAULT_CONFIG;
const PUBLIC_CONFIG_KEYS = sharedDefaults.PUBLIC_CONFIG_KEYS;

function cloneDefault() {
  if (typeof sharedDefaults.createDefaultConfig === 'function') {
    return sharedDefaults.createDefaultConfig();
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

// 读取全局配置种子；未初始化时返回默认值并标记 seeded=false（health.check / admin.bootstrap 用）。
async function readConfig(dao) {
  const doc = await dao.get(COLLECTIONS.CONFIG, CONFIG_DOC_ID);
  if (!doc) {
    return { config: cloneDefault(), seeded: false };
  }
  return { config: Object.assign(cloneDefault(), doc), seeded: true };
}

// 公开子集：委托 shared/defaults 的 pickPublicConfig，保证客户端/云端字段一致。
function publicConfig(config) {
  const source = Object.assign(cloneDefault(), config || {});
  if (typeof sharedDefaults.pickPublicConfig === 'function') {
    return sharedDefaults.pickPublicConfig(source);
  }
  const out = {};
  PUBLIC_CONFIG_KEYS.forEach((key) => {
    if (source[key] !== undefined) {
      out[key] = source[key];
    }
  });
  return out;
}

module.exports = {
  DEFAULT_CONFIG,
  PUBLIC_CONFIG_KEYS,
  cloneDefault,
  readConfig,
  publicConfig
};
