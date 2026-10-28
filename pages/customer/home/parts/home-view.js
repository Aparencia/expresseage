// pages/customer/home/parts/home-view.js · 顾客首页纯件（零 wx）：兼职卡 / 服务范围 / 服务类型 / 下单前置原因
// 口径：UX_CUSTOMER §3.3（兼职卡展示服务范围；范围不含顾客苑时主 CTA 置灰并给原因；服务范围用中文苑名）、
//       ARCHITECTURE §5（页面零判据）、PERFORMANCE 2026-10-22（首屏展示语义放纯件，页面只 setData）。
// 边界：本地只做下单前预检，服务端 order.create 仍是唯一权威（不替代服务端校验）。
'use strict';

const zones = require('../../../../shared/zones');

const SCOPE_ALL_TEXT = '全部苑';
const SERVICE_TEXT_LIMIT = 3;

const REASON = {
  profile: '先完善资料',
  bind: '先绑定兼职',
  readonly: '开发者只读视角不能操作',
  closed: '该兼职暂不接单',
  zone: '该兼职的服务范围不含你的苑，可换绑其他兼职。'
};

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

// 服务类型：只列已启用项；超过 3 项显示前 3 + 「等 N 项」（N=已启用总数），不换行撑高卡片
function serviceTextOf(partnerPublic, catalog, limit) {
  const services = partnerPublic && Array.isArray(partnerPublic.services) ? partnerPublic.services : [];
  const names = [];
  services.forEach(function each(item) {
    if (!item || item.enabled === false) {
      return;
    }
    const code = textOf(item.code);
    const found = (catalog || []).filter(function match(entry) {
      return entry && entry.code === code;
    })[0];
    const name = found ? textOf(found.name) : '';
    names.push(name || code);
  });
  if (names.length === 0) {
    return '';
  }
  const max = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : SERVICE_TEXT_LIMIT;
  if (names.length <= max) {
    return names.join(' / ');
  }
  return names.slice(0, max).join(' / ') + ' 等 ' + names.length + ' 项';
}

// 兼职卡展示模型：头像/昵称/编号优先取 bind.getCurrent 的 partnerPublic，未返回前用 store.binding
// 的启动期字段兜底（bootstrap 水合带 partnerDisplayName/partnerAvatarFileId）——首帧即显示对方头像/首字，
// 不出现空白昵称或顾客自己的头像；loaded=false 表示公开档案（服务类型/范围）尚未到达。
function partnerCardOf(binding, partnerPublic) {
  const bound = binding || {};
  const partner = partnerPublic || {};
  const accepting = partner.acceptingOrders !== false;
  return {
    name: textOf(partner.displayName) || textOf(bound.partnerDisplayName),
    avatarFileId: textOf(partner.avatarFileId) || textOf(bound.partnerAvatarFileId),
    partnerNo: textOf(partner.partnerNo) || textOf(bound.partnerNo),
    accepting: accepting,
    acceptingText: accepting ? '接单中' : '暂停接单',
    loaded: !!partnerPublic
  };
}

// 下单前置原因（优先级：维护 > 资料 > 绑定 > 只读 > 接单开关 > 服务范围；文案分开不合并）
function orderBlockReasonOf(context) {
  const ctx = context || {};
  if (textOf(ctx.maintenanceText)) {
    return ctx.maintenanceText;
  }
  if (ctx.profileComplete !== true) {
    return REASON.profile;
  }
  if (ctx.bound !== true) {
    return REASON.bind;
  }
  if (ctx.readonly === true) {
    return REASON.readonly;
  }
  if (ctx.partnerClosed === true) {
    return REASON.closed;
  }
  if (ctx.zoneAllowed === false) {
    return REASON.zone;
  }
  return '';
}

module.exports = {
  SCOPE_ALL_TEXT,
  SERVICE_TEXT_LIMIT,
  zoneTableOf,
  scopeTextOf,
  zoneAllowedOf,
  serviceTextOf,
  partnerCardOf,
  orderBlockReasonOf
};
