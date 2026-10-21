// pkg-partner/pages/order-detail/parts/order-view.js · 订单详情视图模型（真实 DTO → 页面稳定字段；纯件零 wx）
// 数据来源：order.get 的 {order, events}（_dto.buildOrderDto：status/statusText/parcel/service/appoint/
//           counterpart/guest/exception/image/needCode/failureHint/version/时间戳 ISO）。
// 边界：本文件只做展示字段适配（不判断状态机、不拼动作、不派生 codeStatus——以服务端 codeStatus/Text 为准）。
const enums = require('../../../../shared/enums');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

// 服务端时间是 ISO 字符串（_dto.isoOf）；兼容毫秒/Date
function clockTextOf(value) {
  if (!value) {
    return '';
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!ms || Number.isNaN(ms)) {
    return '';
  }
  const date = new Date(ms);
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function appointTextOf(appoint) {
  const input = appoint || {};
  const type = textOf(input.type);
  const typeText = textOf(input.typeText) || enums.APPOINT_TYPE_TEXT[type] || '';
  if (type === enums.APPOINT_TYPE.SLOT) {
    const start = clockTextOf(input.startAt);
    const end = clockTextOf(input.endAt);
    const range = start && end ? start + '-' + end : start || end;
    return [typeText, range].filter(Boolean).join(' ');
  }
  return typeText || enums.APPOINT_TYPE_TEXT[enums.APPOINT_TYPE.ASAP];
}

// 详情页派生字段：wxml 只用这些稳定键，不直读服务端嵌套结构
function buildDetail(order) {
  const item = order || {};
  const appoint = item.appoint || {};
  const counterpart = item.counterpart || {};
  const parcel = item.parcel || {};
  const exception = item.exception || {};
  const image = item.image || {};
  const service = item.service || {};
  return {
    isGuest: textOf(item.source) === enums.ORDER_SOURCE.PARTNER,
    counterpartName: textOf(counterpart.displayName),
    counterpartAvatarFileId: textOf(counterpart.avatarFileId),
    customerNoText: textOf(item.customerNo),
    partnerNoText: textOf(item.partnerNo),
    appointText: appointTextOf(appoint),
    hasImage: image.hasImage === true,
    imageCleaned: image.cleaned === true,
    serviceName: textOf(service.name),
    stationText: textOf(parcel.stationName) || '还未指定站点',
    pickupCodeText: textOf(parcel.pickupCode),
    lockerNoText: textOf(parcel.lockerNo),
    trackingTailText: textOf(parcel.trackingTail),
    codeStatusText: textOf(parcel.codeStatusText),
    codeStatus: textOf(parcel.codeStatus),
    needCode: item.needCode === true,
    failureHint: item.failureHint === true,
    exceptionCodeText: textOf(exception.codeText),
    exceptionText: textOf(exception.text),
    exceptionFromText: textOf(exception.fromStatus),
    deliveryNoteText: textOf(item.deliveryNote),
    noteText: textOf(item.note),
    cancelReasonText: textOf(item.cancelReasonText),
    cancelledByText: textOf(item.cancelledByText)
  };
}

module.exports = {
  appointTextOf,
  buildDetail,
  clockTextOf
};
