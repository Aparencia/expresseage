// pkg-customer/parts/status-view.js · 订单状态视图适配（单一职责零件，零 wx）
// 状态/动作/取消原因的单源 = shared/order-state.js + shared/enums.js（S1 产出）；
// 本零件只做展示适配，页面层不出现七状态字面量（check #21）。
'use strict';

const state = require('../../shared/order-state');
const enums = require('../../shared/enums');

const STATUS = state.STATUS;
const STATUS_TEXT = state.STATUS_TEXT;
const PROGRESS_LABELS = ['下单', '已接单', '已取件', '已送达', '已完成'];

function statusText(status) {
  return state.statusText(status) || '';
}

function eventText(event) {
  if (!event) return '';
  if (event.note) return event.note;
  if (event.toStatus) {
    const text = state.statusText(event.toStatus);
    if (text) return '订单状态：' + text;
  }
  return '';
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

function canViewImage(order) {
  return !!order && !!order.image && !!order.image.fileId;
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
    const base = new Date(String(order.statusUpdatedAt).replace(/-/g, '/')).getTime();
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
