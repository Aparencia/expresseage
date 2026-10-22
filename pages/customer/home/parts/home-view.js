// pages/customer/home/parts/home-view.js · 顾客首页纯件（零 wx）：服务范围文案 + 下单前置原因（A 批 P1-6）
// 口径：UX_CUSTOMER §3.3（兼职卡展示服务范围；范围不含顾客苑时主 CTA 置灰并给原因）、ARCHITECTURE §5（页面零判据）。
// 边界：本地只做下单前预检，服务端 order.create 仍是唯一权威（不替代服务端校验）。
'use strict';

const SCOPE_ALL_TEXT = '全部苑';

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

// 服务范围：无配置 = 全部苑（UX_CUSTOMER §3.3）
function scopeTextOf(partnerPublic) {
  const zones = zonesOf(partnerPublic);
  return zones.length ? zones.join(' / ') : SCOPE_ALL_TEXT;
}

// 顾客苑是否在兼职服务范围：范围为空=全部苑；顾客苑未知不误拦（资料完整才可下单，服务端权威）
function zoneAllowedOf(partnerPublic, zone) {
  const zones = zonesOf(partnerPublic);
  if (zones.length === 0) {
    return true;
  }
  const mine = textOf(zone);
  if (!mine) {
    return true;
  }
  return zones.indexOf(mine) >= 0;
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
  scopeTextOf,
  zoneAllowedOf,
  orderBlockReasonOf
};
