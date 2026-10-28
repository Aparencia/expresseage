// db/config.js · 云端运行时配置（config/_id='global'）+ 默认值 + 公开子集
// 默认值唯一来源 = shared/defaults.js（由 tools/sync-cloud-shared.js 从 config/defaults.js 复制），
// 云端不另写一份默认值；读库时把 config 种子覆盖在默认值之上。
// v1.1（D32）：旧配置缺 stations / 条目非法时按 shared/stations 回退内置默认名（读层补齐，不要求先迁移库）。
const { COLLECTIONS, CONFIG_DOC_ID } = require('./collections');
const sharedDefaults = require('../shared/defaults');
const sharedStations = require('../shared/stations');

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
  const config = Object.assign(cloneDefault(), doc);
  // stations 读层净化：缺省/非法/重名条目回退内置默认，固定 P1~P8 顺序且名称唯一
  config.stations = sharedStations.stationsFromConfig(config);
  return { config: config, seeded: true };
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
  out.stations = sharedStations.stationsFromConfig(source);
  return out;
}

module.exports = {
  DEFAULT_CONFIG,
  PUBLIC_CONFIG_KEYS,
  cloneDefault,
  readConfig,
  publicConfig
};
