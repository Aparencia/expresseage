// pkg-customer/parts/status-view.js · 订单状态视图适配（单一职责零件，零 wx）
// 状态/动作的单源 = 服务端 order DTO 的 status/statusText/actions[] + shared/order-state.js；
// 本零件只做展示适配（事件类型→人话、动作键→按钮），页面层不出现七状态字面量（check #21）。
'use strict';

const state = require('../../shared/order-state');
const enums = require('../../shared/enums');

const STATUS = state.STATUS;
const STATUS_TEXT = state.STATUS_TEXT;
const PROGRESS_LABELS = ['下单', '已接单', '已取件', '已送达', '已完成'];

// 事件类型 → 人话；状态类事件键用 orderState.STATUS 计算，避免页面/零件层再写一遍七状态字面量
const EVENT_TEXT = {
  ORDER_CREATED: '订单创建',
  REJECTED: '已拒单',
  PICKED_REVERTED: '撤销已取件',
  DELIVERED_REVERTED: '撤销已送达',
  AUTO_COMPLETED: '系统自动完成',
  TIMEOUT_CANCELLED: '超时未接单，系统取消',
  EXCEPTION_REPORTED: '异常上报',
  EXCEPTION_RESOLVED: '异常已解除',
  ORDER_CORRECTED: '更正取件信息',
  DELETED_BY_CUSTOMER: '顾客删除记录',
  GUEST_ORDER_CLAIMED: '代客单已认领'
};
EVENT_TEXT[STATUS.ACCEPTED] = state.statusText(STATUS.ACCEPTED);
EVENT_TEXT[STATUS.PICKED] = state.statusText(STATUS.PICKED);
EVENT_TEXT[STATUS.DELIVERED] = state.statusText(STATUS.DELIVERED);
EVENT_TEXT[STATUS.COMPLETED] = state.statusText(STATUS.COMPLETED);
EVENT_TEXT[STATUS.CANCELLED] = state.statusText(STATUS.CANCELLED);

function statusText(status) {
  return state.statusText(status) || '';
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 服务端事件 DTO：{type,at,actorRole,note}（无 toStatus/id）
function eventText(event) {
  const item = event || {};
  const type = textOf(item.type);
  const base = EVENT_TEXT[type] || type;
  const note = textOf(item.note);
  if (!base) return note;
  if (!note || base === note) return base;
  return base + '：' + note;
}

// 服务端下发的动作条：actions[] = [{key,label}]；页面只按 key 决定按钮显隐
function hasAction(order, key) {
  const actions = order && Array.isArray(order.actions) ? order.actions : [];
  for (let i = 0; i < actions.length; i += 1) {
    if (actions[i] && actions[i].key === key) return true;
  }
  return false;
}

function isTerminal(status) {
  return state.isTerminal(status);
}

function canCancel(order) {
  return state.canCustomerCancel(order);
}

function canConfirmDelivery(order) {
  return !!order && order.status === STATUS.DELIVERED;
}

function canDeleteRecord(order) {
  return !!order && order.status === STATUS.COMPLETED && !order.deletedByCustomerAt;
}

function canMessage(order) {
  const status = order && order.status;
  if (!status) return false;
  return !state.isTerminal(status) || status === STATUS.COMPLETED;
}

// 订单截图：服务端 DTO 只给 {hasImage}（fileId 不落客户端列表 DTO）
function canViewImage(order) {
  if (!order) return false;
  if (order.image && order.image.hasImage === true) return true;
  return !!(order.image && order.image.fileId);
}

function cancelReasons() {
  return (enums.CANCEL_REASONS.CUSTOMER || []).map(function map(item) {
    return { code: item.code, label: item.text };
  });
}

function progressSteps(order) {
  const status = order && order.status;
  const current = state.progressIndex(status);
  return PROGRESS_LABELS.map(function map(label, index) {
    let stepState = 'future';
    if (current >= 0) {
      if (index < current) stepState = 'done';
      else if (index === current) stepState = 'current';
    } else if (index === 0) {
      stepState = 'done';
    }
    return { label: label, state: stepState };
  });
}

function waitingHint(order, config, format) {
  if (!order || !config) return '';
  if (order.status === STATUS.SUBMITTED) {
    const minutes = Number(config.orderTimeoutMinutes) || 0;
    if (minutes <= 0) return '等待接单，超时将自动取消';
    // statusUpdatedAt 是真实 DTO 的 ISO 字符串：先按原样解析，再兼容老格式
    const raw = typeof order.statusUpdatedAt === 'number'
      ? order.statusUpdatedAt
      : Date.parse(order.statusUpdatedAt || '');
    const base = isNaN(raw) ? 0 : raw;
    if (!base) return '等待接单，超时将自动取消';
    const deadline = new Date(base + minutes * 60000);
    return '等待接单，超时将自动取消（截止 ' + format.formatDateTime(deadline) + '）';
  }
  if (order.status === STATUS.DELIVERED) {
    const hours = Number(config.autoCompleteHours) || 0;
    return hours > 0 ? '送达 ' + hours + ' 小时后未操作将自动完成' : '待你确认收到';
  }
  return '';
}

module.exports = {
  STATUS,
  STATUS_TEXT,
  EVENT_TEXT,
  statusText,
  eventText,
  hasAction,
  isTerminal,
  canCancel,
  canConfirmDelivery,
  canDeleteRecord,
  canMessage,
  canViewImage,
  cancelReasons,
  progressSteps,
  waitingHint
};
