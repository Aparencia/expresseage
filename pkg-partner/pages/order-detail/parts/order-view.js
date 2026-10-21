// pkg-partner/pages/order-detail/parts/order-view.js · 订单详情视图模型（真实 DTO → 页面字段；纯件零 wx）
// 数据：order.get 的 {order, events}（order/_dto.buildOrderDto：service/appoint/parcel/counterpart/actions/image/needCode）
// 边界：本文件只做展示字段适配（不改状态判定、不复制状态机；动作可见性一律来自 order.actions）。
const enums = require('../../../../shared/enums');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

// 服务端时间是 ISO 字符串（toIso）；兼容毫秒/Date
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
  return {
    isGuest: textOf(item.source) === enums.ORDER_SOURCE.PARTNER,
    counterpartName: textOf(counterpart.displayName),
    counterpartAvatarFileId: textOf(counterpart.avatarFileId),
    customerNoText: textOf(item.customerNo),
    appointText: appointTextOf(appoint),
    hasImage: image.hasImage === true,
    serviceName: textOf(item.service && item.service.name),
    codeStatusText: textOf(parcel.codeStatusText),
    exceptionText: textOf(exception.text) || textOf(exception.codeText)
  };
}

// 改码面板 → 只提交"确实变化"的字段（已取件单服务端只允许柜号/运单尾号；
// 未变化字段带上去会被判成非法字段，所以差异提交是本页的硬要求）
function diffPatch(editor, parcel) {
  const input = editor || {};
  const current = parcel || {};
  const patch = {};
  ['pickupCode', 'lockerNo', 'trackingTail'].forEach((field) => {
    const next = textOf(input[field]);
    const before = textOf(current[field]);
    if (next !== before) {
      patch[field] = next;
    }
  });
  return patch;
}

module.exports = {
  appointTextOf,
  buildDetail,
  diffPatch,
  clockTextOf
};
