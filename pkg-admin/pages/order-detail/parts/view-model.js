// pkg-admin/pages/order-detail/parts/view-model.js · 订单详情视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.7/§7.3/§11.6——脱敏展示、异常单介入取消前置（仅真实 EXCEPTION）、原因校验。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');

// v1.0 逐件包裹（D23）：parcels[] 优先；历史单 parcel{} 视作单件（同一视图，不新增判据）
function parcelsOf(order) {
  const row = order || {};
  const list = Array.isArray(row.parcels) ? row.parcels : [];
  if (list.length > 0) {
    return list;
  }
  return row.parcel && typeof row.parcel === 'object' ? [row.parcel] : [];
}

// 逐件行：件序号 + 站点 + 码/柜号/尾号（DTO 已打码，页面原样展示、不还原不加工）
function parcelViewOf(parcel, index) {
  const item = parcel || {};
  const station = [item.stationId, item.stationName].filter(Boolean).join(' ');
  return {
    indexText: '第 ' + (index + 1) + ' 件',
    stationText: station || '—',
    pickupCodeText: F.textOrDash(item.pickupCode),
    lockerNoText: F.textOrDash(item.lockerNo),
    trackingTailText: F.textOrDash(item.trackingTail)
  };
}

// 本单配送地址（D25）：admin DTO 只到苑+楼栋（不收件人称呼/房型键）；历史单回退脱敏 dorm
function deliveryTextOf(order) {
  const row = order || {};
  const delivery = row.delivery && typeof row.delivery === 'object' ? row.delivery : null;
  if (delivery) {
    const text = F.joinParts([delivery.zone, delivery.buildingText], ' · ');
    if (text) {
      return text;
    }
  }
  return typeof row.dorm === 'string' ? row.dorm : '';
}

// 包裹卡字段：件数/无截图标识/配送地址；单件单仍走既有视觉（wxml 按 multiParcel 分支）
function parcelFieldsOf(order) {
  const row = order || {};
  const parcels = parcelsOf(row).map(parcelViewOf);
  return {
    parcels: parcels,
    multiParcel: parcels.length > 1,
    pieceCountText: parcels.length > 1 ? '共 ' + parcels.length + ' 件' : '',
    manualEntryText: row.manualEntry === true ? '无截图·手填' : '',
    deliveryText: deliveryTextOf(row)
  };
}

function decorateOrder(order, fallbackNo) {
  const row = order || {};
  const parcel = row.parcel || {};
  const parcelFields = parcelFieldsOf(row);
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
    parcels: parcelFields.parcels,
    multiParcel: parcelFields.multiParcel,
    pieceCountText: parcelFields.pieceCountText,
    manualEntryText: parcelFields.manualEntryText,
    deliveryText: parcelFields.deliveryText,
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
