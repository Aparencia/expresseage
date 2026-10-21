// handlers/config/_common.js · 运行时配置读取 + 公开子集（config.getPublic 与 user.bootstrap 共用）
// 口径：ARCHITECTURE §4.1/§3.4；DATA_MODEL §2.10/§7.6（公开子集不含模板 ID/不含 aiFallback 细节）。
// 复用 db/config 的 readConfig/publicConfig（单一默认值与公开键清单来源），handler 不自建清单。
'use strict';

const { readConfig, publicConfig } = require('../../db/config');

async function loadRuntimeConfig(ctx) {
  if (ctx && ctx.config && typeof ctx.config === 'object' && Object.keys(ctx.config).length > 0) {
    return ctx.config;
  }
  const result = await readConfig(ctx.dao);
  return result.config;
}

// 公开子集：publicConfig 已按 PUBLIC_CONFIG_KEYS 裁剪；subscribeEnabled 由 subscribeTemplates.enabled 派生
function buildPublicConfig(config) {
  const source = config && typeof config === 'object' ? config : {};
  const out = publicConfig(source);
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
