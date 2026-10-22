// pkg-partner/pages/order-detail/parts/order-view.js · 订单详情视图模型（真实 DTO → 页面稳定字段；纯件零 wx）
// 数据来源：order.get 的 {order, events}（_dto.buildOrderDto：v1.0 一单多包裹 parcels[]/images[]/manualEntry/
//           delivery/counterpart/guest/exception/needCode/failureHint/version/时间戳 ISO）。
// 边界：本文件只做展示字段适配（不判断状态机、不拼动作、不派生判据——codeStatus/needCode 以服务端为准）。
const enums = require('../../../../shared/enums');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
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

// v1.0 一单多包裹：优先 parcels[]；兼容历史单包裹 parcel{}（同一视图，不新增分支判据）
function parcelListOf(order) {
  const parcels = listOf(order && order.parcels);
  if (parcels.length) {
    return parcels;
  }
  return order && order.parcel ? [order.parcel] : [];
}

function recognitionSourceTextOf(parcel) {
  const source = textOf(parcel && parcel.recognitionSource);
  return textOf(enums.RECOGNITION_SOURCE_TEXT[source]);
}

// 逐件展示行：站点/码/柜/尾号/识别来源全部逐件，页面不聚合猜测
function parcelViewOf(parcel, index) {
  const row = parcel || {};
  const codeStatus = textOf(row.codeStatus);
  return {
    index: index,
    indexText: '第 ' + (index + 1) + ' 件',
    stationText: textOf(row.stationName) || '还未指定站点',
    pickupCodeText: textOf(row.pickupCode),
    lockerNoText: textOf(row.lockerNo),
    trackingTailText: textOf(row.trackingTail),
    codeStatus: codeStatus,
    codeStatusText: textOf(row.codeStatusText) || textOf(enums.CODE_STATUS_TEXT[codeStatus]),
    needCode: codeStatus === enums.CODE_STATUS.NEED_CODE,
    recognitionSource: textOf(row.recognitionSource),
    recognitionSourceText: recognitionSourceTextOf(row),
    failureHint: !!textOf(row.failureId)
  };
}

// 配送地址（D25）：本单地址=下单人宿舍或互送第三方；无收件人称呼时明示"下单人宿舍"
function deliveryOf(order) {
  const item = order || {};
  const delivery = item.delivery || {};
  const dormKey = textOf(delivery.dormKey);
  const buildingText = textOf(delivery.buildingText) || textOf(delivery.zone);
  const room = textOf(delivery.room);
  const address = dormKey || [buildingText, room].filter(Boolean).join('-');
  const recipientName = textOf(delivery.recipientName);
  const phoneTail = textOf(delivery.phoneTail);
  return {
    deliveryText: address || '',
    deliveryRecipientText: recipientName ? '收件人：' + recipientName : '送至下单人宿舍',
    deliveryIsDefault: !recipientName,
    deliveryTailText: phoneTail ? '尾号 ' + phoneTail : ''
  };
}

// 详情页派生字段：wxml 只用这些稳定键，不直读服务端嵌套结构
function buildDetail(order) {
  const item = order || {};
  const appoint = item.appoint || {};
  const counterpart = item.counterpart || {};
  const exception = item.exception || {};
  const service = item.service || {};
  const parcels = parcelListOf(item).map((parcel, index) => parcelViewOf(parcel, index));
  const first = parcels[0] || parcelViewOf({}, 0);
  const images = listOf(item.images);
  const image = item.image || images[0] || {};
  const manualEntry = item.manualEntry === true;
  const delivery = deliveryOf(item);
  return {
    isGuest: textOf(item.source) === enums.ORDER_SOURCE.PARTNER,
    counterpartName: textOf(counterpart.displayName),
    counterpartAvatarFileId: textOf(counterpart.avatarFileId),
    customerNoText: textOf(item.customerNo),
    partnerNoText: textOf(item.partnerNo),
    appointText: appointTextOf(appoint),
    hasImage: images.length > 0 || image.hasImage === true,
    imageCleaned: image.cleaned === true,
    imageCount: images.length || (image.fileId || image.hasImage ? 1 : 0),
    serviceName: textOf(service.name),
    parcels: parcels,
    parcelCountText: parcels.length + ' 件',
    stationSummaryText: parcels.map((row) => row.stationText).filter((row, i, all) => all.indexOf(row) === i).join(' / '),
    needCode: parcels.some((row) => row.needCode),
    failureHint: parcels.some((row) => row.failureHint),
    manualEntry: manualEntry,
    manualEntryText: manualEntry ? '无截图·手填' : '',
    deliveryText: delivery.deliveryText,
    deliveryRecipientText: delivery.deliveryRecipientText,
    deliveryIsDefault: delivery.deliveryIsDefault,
    deliveryTailText: delivery.deliveryTailText,
    stationText: first.stationText,
    pickupCodeText: first.pickupCodeText,
    lockerNoText: first.lockerNoText,
    trackingTailText: first.trackingTailText,
    codeStatusText: first.codeStatusText,
    codeStatus: first.codeStatus,
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
  clockTextOf,
  deliveryOf,
  parcelListOf,
  parcelViewOf
};
