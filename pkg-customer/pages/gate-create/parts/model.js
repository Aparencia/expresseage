// pkg-customer/pages/gate-create/parts/model.js · E 校门代取纯件（零 wx）
// 边界：只做校门点/送达摘要/幂等键/提交载荷；商家、餐品、抢单、款项字段一律不进入本线。
'use strict';

const enums = require('../../../../shared/enums');
const zones = require('../../../../shared/zones');
const client = require('../../../../api/client');

const NOTE_MAX = 200;
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pointsOf(config) {
  const list = config && Array.isArray(config.gatePoints) ? config.gatePoints : [];
  const out = [];
  list.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const id = textOf(item.id).toUpperCase();
    const name = textOf(item.name);
    if (id && name && out.length < 5) out.push({ id, name });
  });
  return out.length ? out : enums.DEFAULT_GATE_POINTS.map((item) => ({ id: item.id, name: item.name }));
}

function deliveryTextOf(customer) {
  const item = customer || {};
  const zone = zones.normalizeZone(item.zone);
  const building = textOf(item.buildingText) || zones.buildingText(zone, item.buildingNo);
  const room = textOf(item.room);
  const address = [building, room].filter(Boolean).join('-');
  return address || '你的宿舍';
}

function canSubmit(data) {
  const value = data || {};
  if (!value.gateEnabled) return { ok: false, reason: '校门代取暂未开放' };
  if (!value.profileComplete) return { ok: false, reason: '请先完善个人资料' };
  if (!value.binding) return { ok: false, reason: '请先绑定兼职' };
  if (!textOf(value.pointId)) return { ok: false, reason: '请选择校门' };
  if (String(value.note || '').length > NOTE_MAX) return { ok: false, reason: '备注最多 ' + NOTE_MAX + ' 字' };
  return { ok: true, reason: '' };
}

function payloadOf(data) {
  const value = data || {};
  return {
    line: enums.ORDER_LINE.GATE,
    gate: { pointId: textOf(value.pointId) },
    appoint: { type: enums.APPOINT_TYPE.ASAP },
    note: textOf(value.note)
  };
}

function fingerprintOf(data) {
  const value = data || {};
  return [textOf(value.pointId), textOf(value.note)].join('\u0001');
}

function createId() {
  return client.createRequestId();
}

// 同内容重试复用 id；校门/备注变化即重新生成（避免服务端按重放吞掉新内容）。
function ensureSubmission(current, fingerprint, makeId) {
  const value = current || {};
  const next = String(fingerprint === null || fingerprint === undefined ? '' : fingerprint);
  if (value.id && SUBMISSION_ID_PATTERN.test(value.id) && value.fingerprint === next) {
    return value;
  }
  return { id: (typeof makeId === 'function' ? makeId : createId)(), fingerprint: next };
}

function clearSubmission() {
  return null;
}

module.exports = {
  NOTE_MAX,
  pointsOf,
  deliveryTextOf,
  canSubmit,
  payloadOf,
  fingerprintOf,
  ensureSubmission,
  clearSubmission
};
