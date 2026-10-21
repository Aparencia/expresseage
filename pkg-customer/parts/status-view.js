// pkg-customer/parts/status-view.js · 订单状态视图适配（单一职责零件，零 wx）
// 状态文案/动作可用性的单源在 shared/order-state.js（S1 产出）；此处只做安全适配：
// 导出存在则用共享实现，缺失时退回同一套本地常量，页面层不出现七状态字面量。
'use strict';

let shared = {};
try {
  shared = require('../../shared/order-state');
} catch (err) {
  shared = {};
}

const STATUS = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];

const STATUS_TEXT = {
  SUBMITTED: '待接单',
  ACCEPTED: '已接单',
  PICKED: '已取件·配送中',
  DELIVERED: '已送达·待确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  EXCEPTION: '异常·待处理'
};

const EVENT_TEXT = {
  ORDER_CREATED: '已提交订单',
  ACCEPTED: '兼职已接单',
  REJECTED: '兼职已拒单',
  PICKED: '兼职已取件',
  PICKED_REVERTED: '已撤销取件',
  DELIVERED: '兼职已送达',
  DELIVERED_REVERTED: '已撤销送达',
  COMPLETED: '订单已完成',
  AUTO_COMPLETED: '超时自动完成',
  CANCELLED: '订单已取消',
  TIMEOUT_CANCELLED: '超时未接单，订单已取消',
  EXCEPTION_REPORTED: '兼职上报异常',
  EXCEPTION_RESOLVED: '异常已解除',
  ORDER_CORRECTED: '兼职更正了订单信息',
  DELETED_BY_CUSTOMER: '顾客删除了记录'
};

const CANCEL_REASONS = [
  { code: 'CHANGED_MIND', label: '不需要了' },
  { code: 'WRONG_INFO', label: '信息填错' },
  { code: 'DUPLICATE', label: '重复下单' },
  { code: 'PARTNER_UNREACHABLE', label: '联系不上兼职' },
  { code: 'OTHER', label: '其他' }
];

function statusText(status) {
  if (typeof shared.statusText === 'function') return shared.statusText(status);
  const table = shared.STATUS_TEXT || shared.STATUS_TEXT_MAP;
  if (table && table[status]) return table[status];
  if (STATUS_TEXT[status]) return STATUS_TEXT[status];
  return '';
}

function eventText(event) {
  if (typeof shared.eventText === 'function') return shared.eventText(event);
  if (event && event.note) return event.note;
  const type = event && (event.type || event.eventType);
  return EVENT_TEXT[type] || '';
}

function isTerminal(status) {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

function isExceptionCancellable(order) {
  const exception = order && order.exception;
  if (!exception) return false;
  return exception.fromStatus === 'SUBMITTED' || exception.fromStatus === 'ACCEPTED';
}

function canCancel(order) {
  const status = order && order.status;
  if (status === 'SUBMITTED' || status === 'ACCEPTED') return true;
  if (status === 'EXCEPTION') return isExceptionCancellable(order);
  return false;
}

function canConfirmDelivery(order) {
  return !!order && order.status === 'DELIVERED';
}

function canDeleteRecord(order) {
  return !!order && order.status === 'COMPLETED' && !order.deletedByCustomerAt;
}

function canMessage(order) {
  const status = order && order.status;
  return status !== 'CANCELLED' && !isTerminal(status) || status === 'COMPLETED';
}

function canViewImage(order) {
  return !!order && !!order.image && !!order.image.fileId;
}

function cancelReasons() {
  if (typeof shared.cancelReasons === 'function') return shared.cancelReasons();
  if (Array.isArray(shared.CANCEL_REASONS) && shared.CANCEL_REASONS.length > 0) {
    return shared.CANCEL_REASONS;
  }
  return CANCEL_REASONS.map(function clone(item) { return { code: item.code, label: item.label }; });
}

const PROGRESS_SEQ = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED'];
const PROGRESS_LABELS = ['下单', '已接单', '已取件', '已送达', '已完成'];

/** 进度节点（页面不出现状态字面量，统一由本零件给出） */
function progressSteps(order) {
  const status = order && order.status;
  const current = PROGRESS_SEQ.indexOf(status);
  return PROGRESS_LABELS.map(function map(label, index) {
    let state = 'future';
    if (current >= 0) {
      if (index < current) state = 'done';
      else if (index === current) state = 'current';
    } else if (status === 'CANCELLED' || status === 'EXCEPTION') {
      if (index === 0) state = 'done';
    }
    return { label: label, state: state };
  });
}

/** 待接单/待确认的提示行（服务端时间口径，页面只展示） */
function waitingHint(order, config, format) {
  if (!order || !config) return '';
  const minutes = Number(config.orderTimeoutMinutes) || 0;
  const hours = Number(config.autoCompleteHours) || 0;
  if (order.status === 'SUBMITTED' && minutes > 0) {
    const deadline = new Date(new Date(String(order.statusUpdatedAt).replace(/-/g, '/')).getTime() + minutes * 60000);
    return '等待接单，超时将自动取消（截止 ' + format.formatDateTime(deadline) + '）';
  }
  if (order.status === 'DELIVERED' && hours > 0) {
    return '送达 ' + hours + ' 小时后未操作将自动完成';
  }
  return '';
}

module.exports = {
  STATUS,
  STATUS_TEXT,
  CANCEL_REASONS,
  statusText,
  eventText,
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
