// pkg-customer/pages/order-create/parts/delivery.js · 本单配送地址（D25，纯件、零 wx）
// 口径（CONTRACT §5.2/D25）：orders.delivery{zone,buildingNo,room,dormKey,buildingText,recipientName?}
// 默认=下单人当前宿舍；下单时可改他人苑/楼栋/宿舍并填收件人称呼（≤20 字）；仅本单有效，不写回 customers。
// 页面只消费本零件的视图/校验结果；提交时 SELF 不传 delivery（服务端默认本人宿舍），OTHER 传最小字段。
'use strict';

const zones = require('../../../../shared/zones');

const MODE = { SELF: 'SELF', OTHER: 'OTHER' };
const RECIPIENT_MAX = 20;
const ERRORS = {
  zone: '请选择苑',
  buildingNo: '请选择楼栋（1~10 栋）',
  room: '宿舍号要 100 以上的数字',
  recipientName: '收件人称呼最多 20 字'
};

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function moduleLabels(labels) {
  const table = labels && typeof labels === 'object' ? labels : zones.ZONE_LABELS;
  return zones.ZONES.map(function map(code) {
    return { value: code, label: table[code] || zones.ZONE_LABELS[code] || code };
  });
}

function buildingOptions() {
  const out = [];
  for (let i = zones.BUILDING_MIN; i <= zones.BUILDING_MAX; i += 1) {
    out.push({ value: i, label: i + ' 栋', text: String(i) });
  }
  return out;
}

/** 本人宿舍（资料完整才有值；读不到就留空，让用户走「送他人」或等资料完善） */
function selfOf(profile, labels) {
  const value = profile || {};
  const zone = zones.normalizeZone(value.zone);
  const buildingNo = zones.isBuildingNo(value.buildingNo) ? value.buildingNo : 0;
  const room = zones.canonicalRoom(value.room);
  const buildingText = zones.buildingText(zone, buildingNo);
  const dormKey = zones.dormKey(zone, buildingNo, room);
  return {
    zone: zone,
    buildingNo: buildingNo,
    room: room,
    buildingText: buildingText,
    dormKey: dormKey,
    zoneLabel: zones.zoneLabel(zone, labels),
    text: buildingText || room ? (zones.zoneLabel(zone, labels) || '') + buildingText + (room ? ' ' + room : '') : ''
  };
}

/** 页面状态：mode + 本人宿舍快照 + 他人地址草稿（换回本人时不丢草稿） */
function createState(profile, labels) {
  return {
    mode: MODE.SELF,
    labels: labels && typeof labels === 'object' ? labels : null,
    self: selfOf(profile, labels),
    other: {
      zone: '',
      buildingNo: 0,
      room: '',
      recipientName: ''
    },
    zoneIndex: -1,
    buildingIndex: -1
  };
}

function isOther(state) {
  return !!(state && state.mode === MODE.OTHER);
}

function zoneOptions(state) {
  return moduleLabels(state && state.labels);
}

function selfDisplayText(state) {
  const self = (state && state.self) || {};
  if (!self.text) {
    return '本人宿舍（资料未完整）';
  }
  return '本人宿舍 · ' + self.text;
}

function otherDisplayText(state) {
  const other = (state && state.other) || {};
  const zone = zones.normalizeZone(other.zone);
  const buildingText = zones.buildingText(zone, other.buildingNo);
  const room = zones.canonicalRoom(other.room);
  const parts = [];
  if (zone) parts.push(zones.zoneLabel(zone, (state && state.labels) || null));
  if (buildingText) parts.push(buildingText + ' 栋');
  if (room) parts.push(room);
  const name = textOf(other.recipientName);
  const address = parts.join('') || '还没填收件地址';
  return name ? '送给 ' + name + ' · ' + address : address;
}

function displayText(state) {
  return isOther(state) ? otherDisplayText(state) : selfDisplayText(state);
}

/** 校验：SELF 不校验（服务端按资料默认）；OTHER 必须苑/栋/宿舍合法，称呼选填但 ≤20 字 */
function validate(state) {
  const errors = {};
  if (!isOther(state)) {
    return { ok: true, errors: errors };
  }
  const other = (state && state.other) || {};
  const zone = zones.normalizeZone(other.zone);
  const buildingNo = zones.isBuildingNo(other.buildingNo) ? other.buildingNo : 0;
  const room = zones.canonicalRoom(other.room);
  const name = textOf(other.recipientName);
  if (!zone) errors.zone = ERRORS.zone;
  if (!buildingNo) errors.buildingNo = ERRORS.buildingNo;
  if (!room) errors.room = ERRORS.room;
  if (name.length > RECIPIENT_MAX) errors.recipientName = ERRORS.recipientName;
  return { ok: Object.keys(errors).length === 0, errors: errors };
}

/** 提交载荷：SELF → null（服务端默认本人宿舍）；OTHER → 最小字段（dormKey/buildingText 由服务端派生） */
function toPayload(state) {
  if (!isOther(state)) {
    return null;
  }
  const other = (state && state.other) || {};
  const zone = zones.normalizeZone(other.zone);
  if (!zone) {
    return null;
  }
  const payload = {
    zone: zone,
    buildingNo: zones.isBuildingNo(other.buildingNo) ? other.buildingNo : 0,
    room: zones.canonicalRoom(other.room)
  };
  const name = textOf(other.recipientName);
  if (name) payload.recipientName = name;
  return payload;
}

/** 幂等键指纹：地址变了必须重新生成 clientRequestId（否则服务端会当重放） */
function fingerprintOf(state) {
  if (!isOther(state)) {
    return 'SELF';
  }
  const other = (state && state.other) || {};
  return [
    'OTHER',
    zones.normalizeZone(other.zone),
    String(zones.isBuildingNo(other.buildingNo) ? other.buildingNo : 0),
    zones.canonicalRoom(other.room),
    textOf(other.recipientName)
  ].join('|');
}

module.exports = {
  MODE,
  RECIPIENT_MAX,
  ERRORS,
  createState,
  selfOf,
  isOther,
  zoneOptions,
  buildingOptions,
  selfDisplayText,
  otherDisplayText,
  displayText,
  validate,
  toPayload,
  fingerprintOf
};
