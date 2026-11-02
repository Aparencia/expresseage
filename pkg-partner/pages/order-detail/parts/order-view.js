// pkg-partner/pages/order-detail/parts/order-view.js · 订单详情视图模型（真实 DTO → 页面稳定字段；纯件零 wx）
// 数据来源：order.get 的 {order, events}（_dto.buildOrderDto：v1.0 一单多包裹 parcels[]/images[]/manualEntry/
//           delivery/counterpart/guest/exception/needCode/failureHint/version/时间戳 ISO）。
// 边界：本文件只做展示字段适配（不判断状态机、不拼动作、不派生判据——codeStatus/needCode 以服务端为准）。
// D61：每件增「已取/待取 + 时间」与独立件动作（只消费服务端 parcel.actions，READONLY 隐藏）。
const enums = require('../../../../shared/enums');
const appointUtil = require('../../../../shared/appoint');
const pieceActions = require('../../../../pages/partner/workbench/parts/piece-actions');
const workbenchParcel = require('../../../../pages/partner/workbench/parts/parcel-view');

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

// D61 件级取件时间：毫秒 number（契约）/ISO 兼容；只显示时:分
function pickedClockOf(value) {
  return clockTextOf(value);
}

// 预约文案（D47）：ASAP「尽快」/ LATEST「最晚 M月D日 HH:MM」/ 历史 SLOT「预约时段 起-止」
function appointTextOf(appoint) {
  const base = appointUtil.appointTextOf(appoint);
  const slotRange = appointUtil.slotRangeTextOf(appoint);
  return slotRange ? base + ' ' + slotRange : base;
}

// 到点未送达只标红提示（纯展示：不改状态、不自动取消；终态/已送达不标红）
function appointViewOf(appoint, status, nowMs) {
  const view = appointUtil.viewOf(appoint, status, nowMs);
  const slotRange = appointUtil.slotRangeTextOf(appoint);
  return Object.assign({}, view, { text: slotRange ? view.text + ' ' + slotRange : view.text });
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

// 逐件展示行：站点/码/柜/尾号/识别来源全部逐件，页面不聚合猜测；D61 增已取状态与件动作
function parcelViewOf(parcel, index, readonly) {
  const row = parcel || {};
  const codeStatus = textOf(row.codeStatus);
  const picked = row.picked === true;
  const pickedAt = typeof row.pickedAt === 'number' && isFinite(row.pickedAt) ? row.pickedAt : Date.parse(row.pickedAt) || 0;
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
    failureHint: !!textOf(row.failureId),
    picked: picked,
    pickedText: picked ? '已取件' : '待取件',
    pickedAt: pickedAt,
    pickedAtText: picked ? pickedClockOf(pickedAt) : '',
    action: readonly === true ? null : pieceActions.viewOf(row, false)
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

// D41（2026-10-28 用户拍板）：原 PICKUP_DOOR（送寝上门）已停用、不可新启用；历史订单只保留快照名。
// 服务端 DTO 对目录外服务码回 service.deprecated=true，这里按 shared/enums 名称单源渲染「送寝上门（已停用）」；
// 现行 5 类仍显示订单快照名（不偷换成目录名）。
function serviceNameOfOrder(order) {
  const item = order || {};
  const service = item.service && typeof item.service === 'object' ? item.service : {};
  if (service.deprecated === true) {
    return textOf(enums.serviceNameOf(service.code)) || textOf(service.name);
  }
  return textOf(service.name);
}

// 取件信息段（D61 逐件已取状态/件动作 + D23 多包裹 + D24 无截图 + D40 截图张数）
function parcelSectionOf(item, readonly) {
  const parcels = parcelListOf(item).map((parcel, index) => parcelViewOf(parcel, index, readonly));
  const first = parcels[0] || parcelViewOf({}, 0, readonly);
  const images = listOf(item.images);
  const image = item.image || images[0] || {};
  return {
    parcels: parcels,
    first: first,
    images: images,
    image: image,
    manualEntry: item.manualEntry === true,
    picked: workbenchParcel.pickedFieldsOf(item)
  };
}

// 详情页派生字段：wxml 只用这些稳定键，不直读服务端嵌套结构
function buildDetail(order, nowMs, options) {
  const opts = options || {};
  const item = order || {};
  const appointView = appointViewOf(item.appoint || {}, item.status, nowMs);
  const counterpart = item.counterpart || {}; const exception = item.exception || {};
  const section = parcelSectionOf(item, opts.readonly === true);
  const delivery = deliveryOf(item);
  return {
    isGuest: textOf(item.source) === enums.ORDER_SOURCE.PARTNER,
    counterpartName: textOf(counterpart.displayName),
    counterpartAvatarFileId: textOf(counterpart.avatarFileId),
    customerNoText: textOf(item.customerNo),
    partnerNoText: textOf(item.partnerNo),
    appointText: appointView.text,
    appointOverdue: appointView.overdue,
    appointOverdueText: appointView.overdueText,
    hasImage: section.images.length > 0 || section.image.hasImage === true,
    imageCleaned: section.image.cleaned === true,
    imageCount: section.images.length || (section.image.fileId || section.image.hasImage ? 1 : 0),
    serviceName: serviceNameOfOrder(item),
    parcels: section.parcels,
    parcelCountText: section.parcels.length + ' 件',
    pickedCount: section.picked.pickedCount,
    allPicked: section.picked.allPicked,
    pickedSummaryText: section.picked.pickedCountText,
    stationSummaryText: section.parcels.map((row) => row.stationText)
      .filter((row, i, all) => all.indexOf(row) === i).join(' / '),
    needCode: section.parcels.some((row) => row.needCode),
    failureHint: section.parcels.some((row) => row.failureHint),
    manualEntry: section.manualEntry,
    manualEntryText: section.manualEntry ? '无截图·手填' : '',
    deliveryText: delivery.deliveryText,
    deliveryRecipientText: delivery.deliveryRecipientText,
    deliveryIsDefault: delivery.deliveryIsDefault,
    deliveryTailText: delivery.deliveryTailText,
    stationText: section.first.stationText,
    pickupCodeText: section.first.pickupCodeText,
    lockerNoText: section.first.lockerNoText,
    trackingTailText: section.first.trackingTailText,
    codeStatusText: section.first.codeStatusText,
    codeStatus: section.first.codeStatus,
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
  appointViewOf,
  buildDetail,
  clockTextOf,
  deliveryOf,
  parcelListOf,
  parcelViewOf,
  serviceNameOfOrder
};
