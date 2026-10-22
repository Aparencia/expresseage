// pkg-partner/pages/order-detail/parts/event-view.js · 时间线/留言视图（真实 DTO：events{type,at,actorRole,note}、messages{type,text,at,fromRole}）
// 文案单源：状态类事件用 shared/order-state 的 statusText；其余事件用本表（页面不判断状态机，只做展示映射）。
const orderState = require('../../../../shared/order-state');
const enums = require('../../../../shared/enums');
const format = require('../../../../shared/format');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clockTextOf(value) {
  return format.formatTime(value);
}

// 事件类型 → 人话；状态类键用 orderState.STATUS 计算，避免页面层出现七状态字面量
const EVENT_LABELS = {
  ORDER_CREATED: '订单创建',
  REJECTED: '已拒单',
  PICKED_REVERTED: '撤销已取件',
  DELIVERED_REVERTED: '撤销已送达',
  EXCEPTION_REPORTED: '异常上报',
  EXCEPTION_RESOLVED: '异常已解除',
  ORDER_CORRECTED: '更正取件信息',
  PARCELS_APPENDED: '并入新包裹',
  DELETED_BY_CUSTOMER: '顾客删除记录',
  TIMEOUT_CANCELLED: '超时未接单，系统取消',
  AUTO_COMPLETED: '系统自动完成',
  UNDO: '撤销操作'
};
EVENT_LABELS[orderState.STATUS.ACCEPTED] = orderState.statusText(orderState.STATUS.ACCEPTED);
EVENT_LABELS[orderState.STATUS.PICKED] = orderState.statusText(orderState.STATUS.PICKED);
EVENT_LABELS[orderState.STATUS.DELIVERED] = orderState.statusText(orderState.STATUS.DELIVERED);
EVENT_LABELS[orderState.STATUS.COMPLETED] = orderState.statusText(orderState.STATUS.COMPLETED);
EVENT_LABELS[orderState.STATUS.CANCELLED] = orderState.statusText(orderState.STATUS.CANCELLED);
EVENT_LABELS[orderState.STATUS.EXCEPTION] = orderState.statusText(orderState.STATUS.EXCEPTION);

const ACTOR_TEXT = {
  [enums.ROLES.CUSTOMER]: '顾客',
  [enums.ROLES.PARTNER]: '我',
  [enums.CANCELLED_BY.SYSTEM]: '系统',
  [enums.CANCELLED_BY.ADMIN]: '开发者'
};

function labelOf(event) {
  const type = textOf(event.type);
  const base = EVENT_LABELS[type] || type;
  const note = textOf(event.note);
  if (!note || base === note) {
    return base;
  }
  // 取消/异常/更正的备注信息量大，拼在事件名后就够用（不展开 payload/L3）
  return base + '：' + note;
}

function buildEvent(item) {
  const event = item || {};
  const label = labelOf(event);
  return {
    key: textOf(event.type) + '@' + textOf(event.at),
    label: label,
    actor: ACTOR_TEXT[textOf(event.actorRole)] || '',
    atText: clockTextOf(event.at)
  };
}

function buildEvents(list) {
  return (Array.isArray(list) ? list : []).map(buildEvent).filter((item) => item.label);
}

// 订单留言 DTO：{type: 'MESSAGE'|'NOTICE', title, text, at, fromRole, read}
function buildMessage(item) {
  const row = item || {};
  return {
    id: textOf(row.requestKey) || textOf(row.at) + textOf(row.text).slice(0, 8),
    text: textOf(row.text),
    fromText: ACTOR_TEXT[textOf(row.fromRole)] || textOf(row.title) || '对方',
    atText: clockTextOf(row.at || row.createdAt)
  };
}

function buildMessages(list) {
  return (Array.isArray(list) ? list : []).map(buildMessage).filter((item) => item.text);
}

module.exports = {
  buildEvent,
  buildEvents,
  buildMessage,
  buildMessages,
  clockTextOf,
  EVENT_LABELS
};
