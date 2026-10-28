// pkg-partner/pages/service-settings/parts/service-model.js · 服务类型行模型（纯件，零 wx）
// 口径：CONTRACT v1.3 §13 D41（2026-10-28 用户拍板）——服务目录固定 5 类：
//   PICKUP_STD 标准代取＝送到寝室门口（上楼）；PICKUP_LOW 送至楼下＝宿舍楼下/约定地点（不上楼）；
//   PICKUP_URGENT / DROP_OFF / CUSTOM（CUSTOM 仍末项）。
// 原 PICKUP_DOOR 送寝上门已停用：目录不再下发；若旧配置里还启用着，只作「已停用」灰显行展示，
// 不可勾选、不进入保存载荷（服务端 partner.saveServiceConfig 同样忽略目录外 code，不报错）。
'use strict';

const enums = require('../../../../shared/enums');

const LEGACY_DESC = '该服务类型已停用：仅历史订单展示，不可再启用';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 旧目录判定：空目录 / 含目录外 code（如已停用 PICKUP_DOOR）/ 缺任一现行 code（如新增 PICKUP_LOW）。
// 旧目录里的说明来自旧语义（标准代取=楼下），不能展示给兼职端，整表回退新默认目录。
function isLegacyCatalog(list) {
  const stored = Array.isArray(list) ? list : [];
  if (!stored.length) return true;
  const codes = [];
  stored.forEach((item) => {
    const code = textOf(item && item.code);
    if (code && codes.indexOf(code) < 0) codes.push(code);
  });
  if (!codes.length) return true;
  return codes.some((code) => enums.SERVICE_CODES.indexOf(code) < 0)
    || enums.SERVICE_CODES.some((code) => codes.indexOf(code) < 0);
}

// 目录行：固定 5 行、顺序 = shared/enums；已迁移的目录保留后台改过的名称/说明。
function catalogRowsOf(catalog) {
  const stored = Array.isArray(catalog) ? catalog : [];
  const legacy = isLegacyCatalog(stored);
  const byCode = {};
  if (!legacy) {
    stored.forEach((item) => {
      if (!item || enums.SERVICE_CODES.indexOf(item.code) < 0 || byCode[item.code]) return;
      byCode[item.code] = item;
    });
  }
  return enums.SERVICES.map((item) => {
    const hit = byCode[item.code];
    return {
      code: item.code,
      name: textOf(hit && hit.name) || item.name,
      desc: hit && typeof hit.desc === 'string' ? hit.desc : item.desc,
      enabled: false,
      legacy: false
    };
  });
}

// 页面行 = 目录 5 行（enabled 取本人 serviceConfig）+ 旧配置里出现的已停用类型（灰显、不可勾选）。
function rowsOf(catalog, services) {
  const rows = catalogRowsOf(catalog);
  const enabledMap = {};
  (Array.isArray(services) ? services : []).forEach((item) => {
    const code = textOf(item && item.code);
    if (!code || Object.prototype.hasOwnProperty.call(enabledMap, code)) return;
    enabledMap[code] = item && item.enabled === true;
  });
  rows.forEach((row) => {
    row.enabled = enabledMap[row.code] === true;
  });
  Object.keys(enabledMap).forEach((code) => {
    if (rows.some((row) => row.code === code)) return;
    rows.push({
      code: code,
      name: enums.serviceNameOf(code) || code,
      desc: LEGACY_DESC,
      enabled: false,
      legacy: true
    });
  });
  return rows;
}

// 勾选反转：已停用类型不可勾选（返回 null，页面不 setData、不报错）。
function toggleRow(rows, index) {
  const list = Array.isArray(rows) ? rows : [];
  const row = list[index];
  if (!row || row.legacy === true) return null;
  return list.map((item, position) => (position === index
    ? Object.assign({}, item, { enabled: item.enabled !== true })
    : item));
}

// 保存载荷：只提交目录内 code（已停用类型不进载荷，服务端也不接受）。
function buildPayload(rows) {
  const services = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.legacy !== true && enums.SERVICE_CODES.indexOf(row.code) >= 0)
    .map((row) => ({ code: row.code, enabled: row.enabled === true }));
  return { services: services };
}

function hasLegacy(rows) {
  return (Array.isArray(rows) ? rows : []).some((row) => row && row.legacy === true);
}

module.exports = {
  LEGACY_DESC,
  isLegacyCatalog,
  catalogRowsOf,
  rowsOf,
  toggleRow,
  buildPayload,
  hasLegacy
};
