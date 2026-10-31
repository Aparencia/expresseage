// utils/order-scope.js · 下单前服务范围预检纯件（零 wx）：苑归一 / 范围文案 / 范围判定（TD-068 单源）
// 口径：UX_CUSTOMER §3.3（兼职卡展示服务范围；范围不含顾客苑时主 CTA 置灰并给原因；服务范围用中文苑名）、
//       ARCHITECTURE §5（页面零判据）。
// 消费方（原两份同口径实现下沉到这里，只此一份）：
//   - pages/customer/home/parts/home-view.js：兼职卡展示 scopeTextOf + CTA/下单前置 zoneAllowedOf；
//   - pkg-customer/pages/order-create/parts/precheck.js：提交前 rangeCheckOf 的服务范围判定。
// 边界：本地预检只省一次必失败请求，服务端 order.create 的 assertServiceRange 仍是唯一权威（不替代服务端校验）。
'use strict';

const zones = require('../shared/zones');

const SCOPE_ALL_TEXT = '全部苑';
// 范围拦截文案：首页「下单前置原因」与下单页提交前预检共用同一句（不许各写一份漂移）
const RANGE_BLOCK_TEXT = '该兼职的服务范围不含你的苑，可换绑其他兼职。';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function zonesOf(partnerPublic) {
  const raw = partnerPublic && Array.isArray(partnerPublic.zones) ? partnerPublic.zones : [];
  return raw.map(textOf).filter(function keep(zone) {
    return zone !== '';
  });
}

// config.zoneLabels 覆盖 shared/zones 默认名：键 = 苑代号（D/X/N/B/C），值 = 展示名
function zoneTableOf(zoneLabels) {
  const custom = zoneLabels && typeof zoneLabels === 'object' ? zoneLabels : {};
  const table = {};
  zones.ZONES.forEach(function each(code) {
    table[code] = textOf(custom[code]) || zones.ZONE_LABELS[code];
  });
  return table;
}

// 苑值归一：既认代号（D），也认历史/后台直接存的中文苑名（东苑）→ 代号
function zoneKeyOf(value, table) {
  const code = zones.normalizeZone(value);
  if (code) {
    return code;
  }
  const text = textOf(value);
  if (!text) {
    return '';
  }
  const keys = Object.keys(table);
  for (let i = 0; i < keys.length; i += 1) {
    if (table[keys[i]] === text) {
      return keys[i];
    }
  }
  return '';
}

// 服务范围：无配置 = 全部苑；有配置一律显示中文苑名（不再暴露 D/X/N/B/C 原始代号）
function scopeTextOf(partnerPublic, zoneLabels) {
  const list = zonesOf(partnerPublic);
  if (list.length === 0) {
    return SCOPE_ALL_TEXT;
  }
  const table = zoneTableOf(zoneLabels);
  const names = list.map(function map(zone) {
    return table[zoneKeyOf(zone, table)] || zones.zoneLabel(zone) || zone;
  });
  return names.join(' / ');
}

// 顾客苑是否在兼职服务范围：范围为空=全部苑；顾客苑未知不误拦（资料完整才可下单，服务端权威）
function zoneAllowedOf(partnerPublic, zone, zoneLabels) {
  const list = zonesOf(partnerPublic);
  if (list.length === 0) {
    return true;
  }
  const table = zoneTableOf(zoneLabels);
  const mine = zoneKeyOf(zone, table);
  if (!mine) {
    return true;
  }
  return list.some(function some(item) {
    return zoneKeyOf(item, table) === mine;
  });
}

module.exports = {
  SCOPE_ALL_TEXT,
  RANGE_BLOCK_TEXT,
  zonesOf,
  zoneTableOf,
  scopeTextOf,
  zoneAllowedOf
};
