// pkg-admin/pages/order-detail/parts/view-model.js · 订单详情视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.7/§7.3/§11.6——脱敏展示、异常单介入取消前置（仅真实 EXCEPTION）、原因校验。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');

function decorateOrder(order, fallbackNo) {
  const row = order || {};
  const parcel = row.parcel || {};
  const service = row.service || {};
  const exception = row.exception || {};
  const customer = row.customer || {};
  const partner = row.partner || {};
  return {
    orderNo: row.orderNo || fallbackNo || '—',
    status: row.status || '',
    statusText: row.statusText || C.ORDER_STATUS_LABELS[row.status] || '—',
    serviceName: service.name || row.serviceName || service.code || '—',
    appointText: row.appointText || '—',
    note: row.note || '',
    deliveryNote: row.deliveryNote || '',
    cancelReasonText: row.cancelReasonText || '',
    customerNo: row.customerNo || '—',
    customerName: F.textOrDash(row.customerDisplayName || customer.displayName),
    partnerNo: row.partnerNo || '—',
    partnerName: F.textOrDash(row.partnerDisplayName || partner.displayName),
    stationText: [parcel.stationId, parcel.stationName].filter(Boolean).join(' ') || '—',
    pickupCodeText: F.textOrDash(parcel.pickupCode),
    lockerNoText: F.textOrDash(parcel.lockerNo),
    trackingTailText: F.textOrDash(parcel.trackingTail),
    exceptionText: exception.text || '',
    exceptionCodeText: exception.codeText || (exception.code ? '已上报异常' : ''),
    reportedAtText: exception.reportedAt ? F.formatTime(exception.reportedAt) : '',
    createdAtText: F.formatTime(row.createdAt),
    statusUpdatedAtText: F.formatTime(row.statusUpdatedAt),
    isTest: row.isTest === true,
    impersonatedBy: row.impersonatedBy || ''
  };
}

function decorateEvent(item) {
  const row = item || {};
  return {
    label: row.label || row.title || row.note || row.type || '状态更新',
    actor: row.actorText || row.actorRole || '',
    atText: F.formatTime(row.at || row.createdAt)
  };
}

// 介入取消只有「真实 EXCEPTION」单可见：测试单按测试流程清理，非异常单不得取消
function canCancelOrder(order) {
  const row = order || {};
  return row.isTest !== true && row.status === C.ORDER_STATUS_EXCEPTION;
}

function cancelConfirmContent(order) {
  const row = order || {};
  return '将取消订单 ' + row.orderNo + '（' + row.statusText + '）。取消后双方可见原因与状态，不可恢复。' +
    '请填写介入原因（必填，最多 200 字）。';
}

function validateCancelNote(note) {
  const text = String(note || '').trim();
  if (!text) return { ok: false, error: '请填写介入原因（最多 200 字）。' };
  if (text.length > C.LIMITS.cancelReasonMax) return { ok: false, error: '介入原因最多 200 字。' };
  return { ok: true, note: text };
}

function buildDetailView(result, fallbackNo) {
  const source = result || {};
  return {
    order: decorateOrder(source.order || {}, fallbackNo),
    events: (source.events || []).map(decorateEvent),
    canCancel: canCancelOrder(source.order || {})
  };
}

module.exports = {
  decorateOrder,
  decorateEvent,
  canCancelOrder,
  cancelConfirmContent,
  validateCancelNote,
  buildDetailView
};
