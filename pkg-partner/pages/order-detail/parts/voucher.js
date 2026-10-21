// pkg-partner/pages/order-detail/parts/voucher.js · 履约凭证卡纯件（MVP 口径：事件流水即事实依据）
// 契约：docs/V4_UX_PARTNER.md §4.14「取件凭证（MVP）」与 §3.3 编号口径（凭证卡小字显示本人兼职编号）；
//       docs/V4_DATA_MODEL.md §7.5 order.get（events 裁剪 {type,at,actorRole,note}）。
// 边界：顾客确认时间只取服务端事件（COMPLETED + actorRole=CUSTOMER）或 DTO.completedAt；
//       代客单无顾客确认路径，标「系统自动完成」。不展示截图/签名/二维码（MVP 不做）。
const orderState = require('../../../../shared/order-state');
const enums = require('../../../../shared/enums');
const format = require('../../../../shared/format');

const STATUS = orderState.STATUS;
const CONFIRM_EVENT_TYPE = STATUS.COMPLETED;
const AUTO_EVENT_TYPE = 'AUTO_COMPLETED';
const COPY = {
  title: '履约凭证',
  footer: '凭证以订单事件记录为准；本单不可删除。',
  empty: '—',
  guestAuto: '系统自动完成（代客单无顾客确认）',
  autoCompleted: '系统自动完成',
  confirmedLabel: '顾客确认时间',
  autoLabel: '自动完成时间'
};

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function eventList(events) {
  return Array.isArray(events) ? events : [];
}

function findEvent(events, predicate) {
  const list = eventList(events);
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && predicate(list[i])) {
      return list[i];
    }
  }
  return null;
}

// 顾客确认送达 = 状态事件 COMPLETED 且操作者是顾客（服务端 confirmDelivery 写该事件）
function customerConfirmEvent(events) {
  return findEvent(events, (event) => textOf(event.type) === CONFIRM_EVENT_TYPE
    && textOf(event.actorRole) === enums.ROLES.CUSTOMER);
}

function autoCompleteEvent(events) {
  return findEvent(events, (event) => textOf(event.type) === AUTO_EVENT_TYPE);
}

function dateTimeText(value) {
  return format.formatDateTime(value) || COPY.empty;
}

function isGuestOrder(order) {
  return textOf(order && order.source) === enums.ORDER_SOURCE.PARTNER;
}

function buildVoucher(order, events) {
  const item = order || {};
  const guest = isGuestOrder(item);
  const confirmEvent = customerConfirmEvent(events);
  const autoEvent = autoCompleteEvent(events);
  const completed = textOf(item.status) === STATUS.COMPLETED;
  let confirmLabel = COPY.confirmedLabel;
  let confirmText = confirmEvent ? dateTimeText(confirmEvent.at) : '';
  if (guest) {
    confirmLabel = COPY.autoLabel;
    if (autoEvent) {
      confirmText = dateTimeText(autoEvent.at);
    } else if (completed) {
      confirmText = dateTimeText(item.completedAt);
    }
    if (!confirmText && completed) {
      confirmText = COPY.guestAuto;
    }
  } else if (!confirmText && completed) {
    // 正常单 24h 未确认由 cleanup 自动完成：事件是 AUTO_COMPLETED，不是顾客确认 → 不冒充确认时间
    confirmText = autoEvent ? dateTimeText(autoEvent.at) : COPY.empty;
    if (autoEvent) {
      confirmLabel = COPY.autoLabel;
    }
  }
  const rows = [
    { label: '订单号', value: textOf(item.orderNo) || COPY.empty },
    { label: '站点', value: textOf(item.parcel && item.parcel.stationName) || COPY.empty },
    { label: '服务类型', value: textOf(item.service && item.service.name) || COPY.empty },
    { label: '接单时间', value: item.acceptedAt ? dateTimeText(item.acceptedAt) : COPY.empty },
    { label: '取件时间', value: item.pickedAt ? dateTimeText(item.pickedAt) : COPY.empty },
    { label: '送达时间', value: item.deliveredAt ? dateTimeText(item.deliveredAt) : COPY.empty },
    { label: '完成时间', value: item.completedAt ? dateTimeText(item.completedAt) : COPY.empty },
    { label: '送达备注', value: textOf(item.deliveryNote) || COPY.empty },
    { label: confirmLabel, value: confirmText || COPY.empty }
  ];
  return {
    title: COPY.title,
    footer: COPY.footer,
    orderNo: textOf(item.orderNo),
    stationName: textOf(item.parcel && item.parcel.stationName),
    serviceName: textOf(item.service && item.service.name),
    acceptedAtText: item.acceptedAt ? dateTimeText(item.acceptedAt) : '',
    pickedAtText: item.pickedAt ? dateTimeText(item.pickedAt) : '',
    deliveredAtText: item.deliveredAt ? dateTimeText(item.deliveredAt) : '',
    completedAtText: item.completedAt ? dateTimeText(item.completedAt) : '',
    deliveryNote: textOf(item.deliveryNote),
    confirmLabel: confirmLabel,
    confirmedAtText: confirmText,
    partnerNo: textOf(item.partnerNo),
    guest: guest,
    guestAuto: guest ? COPY.guestAuto : '',
    rows: rows
  };
}

module.exports = {
  COPY,
  CONFIRM_EVENT_TYPE,
  AUTO_EVENT_TYPE,
  customerConfirmEvent,
  autoCompleteEvent,
  buildVoucher,
  isGuestOrder
};
