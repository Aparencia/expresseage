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
  // D61（2026-11-02）：件级取件两种事件——note 里有件号就带上，没有就用通用人话（绝不裸英文上屏）
  PARCEL_PICKED: '已取走一件',
  PARCEL_PICKED_REVERTED: '撤销了一件已取件',
  GUEST_ORDER_CLAIMED: '代客单已认领',
  // D58（批 26）：5 个转派事件必须有人话（转派双方/后台都看时间线；中文单源 = shared/enums 转派文案表）
  TRANSFER_REQUESTED: '发起转派',
  TRANSFER_ACCEPTED: enums.TRANSFER_STATUS_TEXT[enums.TRANSFER_STATUS.ACCEPTED],
  TRANSFER_DECLINED: enums.TRANSFER_STATUS_TEXT[enums.TRANSFER_STATUS.DECLINED],
  TRANSFER_CANCELLED: '已撤回转派',
  TRANSFER_EXPIRED: enums.TRANSFER_STATUS_TEXT[enums.TRANSFER_STATUS.EXPIRED],
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

// D58（P1-1）：转派事件的事件 DTO 只给 type/at/actorRole/note（不带发起/接收方编号），
// actorRole=PARTNER 既可能是发起方也可能是接收方——显示「我」会把对方的动作冒认成自己的，
// 故这 5 类事件一律不显示 actor（宁缺勿错；要显示编号须服务端先补 DTO 字段）。
const TRANSFER_EVENT_TYPES = ['TRANSFER_REQUESTED', 'TRANSFER_ACCEPTED', 'TRANSFER_DECLINED',
  'TRANSFER_CANCELLED', 'TRANSFER_EXPIRED'];

// D61：服务端件级事件 note 形如「第2件」（A 侧约定）或空；有件号就进人话，没有就给通用句（不裸英文）
function pieceNoOf(note) {
  const hit = /第\s*(\d+)\s*件/.exec(textOf(note));
  return hit ? hit[1] : '';
}

function parcelEventLabelOf(type, note) {
  const no = pieceNoOf(note);
  if (type === 'PARCEL_PICKED') {
    return no ? '已取走第 ' + no + ' 件' : EVENT_LABELS.PARCEL_PICKED;
  }
  return no ? '已撤销第 ' + no + ' 件的已取' : EVENT_LABELS.PARCEL_PICKED_REVERTED;
}

function labelOf(event) {
  const type = textOf(event.type);
  const note = textOf(event.note);
  if (type === 'PARCEL_PICKED' || type === 'PARCEL_PICKED_REVERTED') {
    return parcelEventLabelOf(type, note);
  }
  // 未登记类型不上屏裸英文（文案纪律）：宁可少一行，也不把内部事件名/错误码暴露给用户
  const base = EVENT_LABELS[type] || '';
  if (!base) {
    return '';
  }
  if (!note || base === note) {
    return base;
  }
  // 取消/异常/更正的备注信息量大，拼在事件名后就够用（不展开 payload/L3）
  return base + '：' + note;
}

function buildEvent(item) {
  const event = item || {};
  const type = textOf(event.type);
  const label = labelOf(event);
  const isTransfer = TRANSFER_EVENT_TYPES.indexOf(type) >= 0;
  return {
    key: type + '@' + textOf(event.at),
    label: label,
    actor: isTransfer ? '' : (ACTOR_TEXT[textOf(event.actorRole)] || ''),
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
