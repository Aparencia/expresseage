// pkg-customer/pages/order-create/parts/precheck.js · 下单提交前本地预检（纯函数，零 wx）
// A 批 P1-6（服务范围早提示）+ P1-9（「其他代办」强制备注）。
// TD-068：服务范围判定/拦截文案下沉 utils/order-scope.js 单源（与顾客首页同一实现，re-export 保持原导出名）。
// TD-070：「其他代办」码取 shared/enums 显式常量（不再由 SERVICES 末项推导，新增服务码不改变判定）。
// 边界：本地预检只省一次必失败请求，服务端 order.create 的 assertServiceRange 与备注校验仍是唯一权威；
//      预检数据只由调用方从 store 快照取（customer.zone / binding.partnerPublic.zones），不新增请求。
'use strict';

const enums = require('../../../../shared/enums');
const orderScope = require('../../../../utils/order-scope');

const CUSTOM_SERVICE_CODE = enums.CUSTOM_SERVICE_CODE;
const RANGE_BLOCK_TEXT = orderScope.RANGE_BLOCK_TEXT;
const CUSTOM_NOTE_TEXT = '选「其他代办」时，备注要写清需要兼职办什么事';
const CUSTOM_NOTE_TOAST = '请填写「其他代办」的备注';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 提交前服务范围预检：{ok, reason, zone}；不替代服务端判据 */
function rangeCheckOf(input) {
  const value = input || {};
  const zone = textOf(value.zone);
  if (orderScope.zoneAllowedOf(value.partnerPublic, zone)) return { ok: true, reason: '', zone: zone };
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
  zonesOf: orderScope.zonesOf,
  zoneAllowedOf: orderScope.zoneAllowedOf,
  rangeCheckOf,
  noteErrorOf
};
