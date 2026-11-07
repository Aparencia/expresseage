// pkg-admin/pages/customer-detail/parts/view-model.js · 顾客详情视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.4/§5.2——资料脱敏（服务端 DTO）、绑定关系、订单摘要与最近订单行；
//       D68：账号状态（正常/已停用/已注销）与停用/恢复前置条件。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');
const statusCopy = require('../../../common/customer-status');

function decorateCustomer(customer, fallbackNo) {
  const doc = customer || {};
  const status = doc.status || C.USER_STATUS_ACTIVE;
  const isTest = doc.isTest === true;
  return {
    customerNo: doc.customerNo || fallbackNo || '—',
    displayName: F.textOrDash(doc.displayName),
    dormText: doc.dormText || doc.dorm || '—',
    phoneTailText: doc.phoneTail || '—',
    profileText: doc.profileCompleted ? '资料完整' : '资料未完整',
    isTest: isTest,
    status: status,
    statusText: status === C.USER_STATUS_ACTIVE ? '正常' : (C.USER_STATUS_LABELS[status] || '—'),
    suspendedReason: doc.suspendedReason || '',
    suspendedAtText: doc.suspendedAt ? F.formatTime(doc.suspendedAt) : '',
    isSuspended: status === C.USER_STATUS_SUSPENDED,
    isDeactivated: status === C.USER_STATUS_DEACTIVATED,
    canSuspend: !isTest && status === C.USER_STATUS_ACTIVE,
    canResume: !isTest && status === C.USER_STATUS_SUSPENDED,
    canSwitch: !isTest && status === C.USER_STATUS_ACTIVE
  };
}

function decorateBinding(binding) {
  if (!binding) return null;
  return {
    partnerNo: binding.partnerNo || '—',
    displayName: F.textOrDash(binding.displayName),
    statusText: C.PARTNER_STATUS_LABELS[binding.status] || '—',
    boundAtText: binding.boundAt ? F.formatTime(binding.boundAt) : ''
  };
}

function pickCount(value) {
  return value === undefined || value === null ? '—' : F.numOrZero(value);
}

// 兼容两种入参形状：服务端 orderSummary（activeOrders/completedOrders/exceptionOrders）
// 与旧视图入参（inProgress/completed/exception）。
function buildSummaryText(summary) {
  const source = summary || {};
  const inProgress = source.inProgress !== undefined ? source.inProgress : source.activeOrders;
  const completed = source.completed !== undefined ? source.completed : source.completedOrders;
  const exception = source.exception !== undefined ? source.exception : source.exceptionOrders;
  return '进行中 ' + pickCount(inProgress) +
    ' · 已完成 ' + pickCount(completed) +
    ' · 异常 ' + pickCount(exception);
}

function decorateOrder(item) {
  const row = item || {};
  return {
    orderNo: row.orderNo || '—',
    statusText: row.statusText || C.ORDER_STATUS_LABELS[row.status] || '—',
    serviceName: row.serviceName || row.serviceCode || '—',
    dormText: row.dormText || row.dorm || '—',
    statusUpdatedAtText: F.formatTime(row.statusUpdatedAt),
    isTest: row.isTest === true
  };
}

function buildDetailView(result, fallbackNo) {
  const source = result || {};
  const detail = source.customer || {};
  // 服务端返回 {customer:{...,binding,orderSummary}, recentOrders}；旧入参为顶层 bindingSummary/orderSummary。
  const bindingSource = detail.binding || source.bindingSummary || null;
  const summarySource = detail.orderSummary || source.orderSummary || {};
  return {
    customer: decorateCustomer(detail, fallbackNo),
    binding: decorateBinding(bindingSource),
    orderSummaryText: buildSummaryText(summarySource),
    recentOrders: (source.recentOrders || []).map(decorateOrder)
  };
}

module.exports = {
  decorateCustomer,
  decorateBinding,
  buildSummaryText,
  decorateOrder,
  buildDetailView,
  suspendConfirmContent: statusCopy.suspendConfirmContent,
  resumeConfirmContent: statusCopy.resumeConfirmContent,
  validateSuspendReason: statusCopy.validateSuspendReason
};
