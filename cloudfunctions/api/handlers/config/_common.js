// handlers/config/_common.js · 运行时配置读取 + 公开子集（config.getPublic 与 user.bootstrap 共用）
// 口径：ARCHITECTURE §4.1/§3.4；DATA_MODEL §2.10/§7.6；ENGINEERING §3.6（公开子集含 avatarMaxBytes 与
// viewTicketTtlMinutes）。优先复用 shared/defaults.pickPublicConfig（sync 生成后可用），
// 未同步前回退 db/config.publicConfig；两份的公开键清单在同一次裁决中保持一致。
'use strict';

const { readConfig, publicConfig } = require('../../db/config');

let sharedDefaults = null;
try {
  sharedDefaults = require('../../shared/defaults');
} catch (error) {
  sharedDefaults = null;
}

async function loadRuntimeConfig(ctx) {
  if (ctx && ctx.config && typeof ctx.config === 'object' && Object.keys(ctx.config).length > 0) {
    return ctx.config;
  }
  const result = await readConfig(ctx.dao);
  return result.config;
}

function buildPublicConfig(config) {
  const source = config && typeof config === 'object' ? config : {};
  const out = sharedDefaults && typeof sharedDefaults.pickPublicConfig === 'function'
    ? sharedDefaults.pickPublicConfig(source)
    : publicConfig(source);
  out.subscribeEnabled = !!(source.subscribeTemplates && source.subscribeTemplates.enabled === true);
  return out;
}

async function loadPublicConfig(ctx) {
  return buildPublicConfig(await loadRuntimeConfig(ctx));
}

module.exports = {
  loadRuntimeConfig,
  buildPublicConfig,
  loadPublicConfig
};
