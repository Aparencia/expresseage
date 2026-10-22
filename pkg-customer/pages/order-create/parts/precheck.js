// pkg-customer/pages/order-create/parts/precheck.js · 下单提交前本地预检（纯函数，零 wx）
// A 批 P1-6（服务范围早提示）+ P1-9（「其他代办」强制备注）。
// 边界：本地预检只省一次必失败请求，服务端 order.create 的 assertServiceRange 与备注校验仍是唯一权威；
//      预检数据只由调用方从 store 快照取（customer.zone / binding.partnerPublic.zones），不新增请求。
'use strict';

const enums = require('../../../../shared/enums');

// 「其他代办」服务码：shared/enums 的 SERVICES 固定顺序最后一项（CONTRACT §6），不另抄一份码表
const CUSTOM_SERVICE_CODE = enums.SERVICE_CODES[enums.SERVICE_CODES.length - 1];
// 与顾客首页 P1-6 同一句（该文案当前在 pages/customer/home/parts/home-view.js；待 utils/ 下沉后单源）
const RANGE_BLOCK_TEXT = '该兼职的服务范围不含你的苑，可换绑其他兼职。';
const CUSTOM_NOTE_TEXT = '选「其他代办」时，备注要写清需要兼职办什么事';
const CUSTOM_NOTE_TOAST = '请填写「其他代办」的备注';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function zonesOf(partnerPublic) {
  const raw = partnerPublic && Array.isArray(partnerPublic.zones) ? partnerPublic.zones : [];
  return raw.map(textOf).filter(function keep(zone) {
    return zone !== '';
  });
}

// 服务范围为空 = 全部苑；顾客苑未知不误拦（资料完整才可下单，服务端仍权威）
function zoneAllowedOf(partnerPublic, zone) {
  const zones = zonesOf(partnerPublic);
  if (zones.length === 0) return true;
  const mine = textOf(zone);
  if (!mine) return true;
  return zones.indexOf(mine) >= 0;
}

/** 提交前服务范围预检：{ok, reason, zone}；不替代服务端判据 */
function rangeCheckOf(input) {
  const value = input || {};
  const zone = textOf(value.zone);
  if (zoneAllowedOf(value.partnerPublic, zone)) return { ok: true, reason: '', zone: zone };
  return { ok: false, reason: RANGE_BLOCK_TEXT, zone: zone };
}

/** 「其他代办」强制备注（UX §3.7.3 / AC-C-15）：返回行内红字，空串 = 通过 */
function noteErrorOf(serviceCode, note) {
  if (textOf(serviceCode) !== CUSTOM_SERVICE_CODE) return '';
  return textOf(note) === '' ? CUSTOM_NOTE_TEXT : '';
}

module.exports = {
  CUSTOM_SERVICE_CODE,
  RANGE_BLOCK_TEXT,
  CUSTOM_NOTE_TEXT,
  CUSTOM_NOTE_TOAST,
  zonesOf,
  zoneAllowedOf,
  rangeCheckOf,
  noteErrorOf
};
