// handlers/config/_common.js · 运行时配置读取 + 公开子集（config.getPublic 与 user.bootstrap 共用）
// 口径：ARCHITECTURE §4.1/§3.4；DATA_MODEL §2.10/§7.6；ENGINEERING §3.6（公开子集含 avatarMaxBytes 与
// viewTicketTtlMinutes）。优先复用 shared/defaults.pickPublicConfig（sync 生成后可用），
// 未同步前回退 db/config.publicConfig；两份的公开键清单在同一次裁决中保持一致。
// D41（2026-10-28 用户拍板）：服务类型目录读层归一——旧目录（含已停用 PICKUP_DOOR 或缺新码 PICKUP_LOW）
// 整表回退 shared/enums 的新 5 类默认目录（部署即完成迁移，不要求先手工改库）；已是新目录时保留后台改过的名称/说明。
'use strict';

const { readConfig, publicConfig, DEFAULT_CONFIG } = require('../../db/config');

const SERVICE_NAME_MAX = 20;
const SERVICE_DESC_MAX = 60;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 出厂目录（唯一来源 config/defaults.js → 云副本 shared/defaults.DEFAULT_CONFIG，随 shared/enums.js 派生）
function defaultServiceCatalog() {
  return DEFAULT_CONFIG.serviceCatalog.map((item) => ({ code: item.code, name: item.name, desc: item.desc }));
}

function normalizeServiceEntry(item) {
  if (!item || typeof item !== 'object') return null;
  const code = textOf(item.code);
  const name = textOf(item.name);
  if (!code || !name) return null;
  return {
    code: code,
    name: name.slice(0, SERVICE_NAME_MAX),
    desc: textOf(item.desc).slice(0, SERVICE_DESC_MAX)
  };
}

// 旧目录判定：空目录 / 含目录外 code（如已停用 PICKUP_DOOR）/ 缺任一现行 code（如新增 PICKUP_LOW）。
// 旧目录里的名称/说明来自旧语义（标准代取=楼下），不能继续下发，整表回退新默认目录。
function isLegacyServiceCatalog(stored, canonicalCodes) {
  if (!Array.isArray(stored) || stored.length === 0) return true;
  const codes = [];
  stored.forEach((item) => {
    const code = textOf(item && item.code);
    if (code && codes.indexOf(code) < 0) codes.push(code);
  });
  if (codes.length === 0) return true;
  return codes.some((code) => canonicalCodes.indexOf(code) < 0)
    || canonicalCodes.some((code) => codes.indexOf(code) < 0);
}

/** 服务类型目录归一（唯一出口；config.getPublic 与 partner.activate 共用）：恰好 5 条、顺序=默认目录顺序。 */
function serviceCatalogOf(config) {
  const source = config && typeof config === 'object' ? config : {};
  const defaults = defaultServiceCatalog();
  const canonicalCodes = defaults.map((item) => item.code);
  const stored = Array.isArray(source.serviceCatalog) ? source.serviceCatalog : [];
  if (isLegacyServiceCatalog(stored, canonicalCodes)) return defaults;
  const byCode = {};
  stored.forEach((item) => {
    const entry = normalizeServiceEntry(item);
    if (!entry || canonicalCodes.indexOf(entry.code) < 0 || byCode[entry.code]) return;
    byCode[entry.code] = entry;
  });
  return defaults.map((item) => byCode[item.code] || item);
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
  const out = publicConfig(source);
  // D41：目录固定 5 类（旧目录自动迁移），客户端选择器/兼职服务配置页都按这一个出口渲染
  out.serviceCatalog = serviceCatalogOf(source);
  out.subscribeEnabled = !!(source.subscribeTemplates && source.subscribeTemplates.enabled === true);
  return out;
}

async function loadPublicConfig(ctx) {
  return buildPublicConfig(await loadRuntimeConfig(ctx));
}

module.exports = {
  loadRuntimeConfig,
  buildPublicConfig,
  loadPublicConfig,
  serviceCatalogOf
};
