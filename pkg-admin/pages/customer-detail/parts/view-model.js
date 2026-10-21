// pkg-admin/pages/customer-detail/parts/view-model.js · 顾客详情视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.4/§5.2——资料脱敏（服务端 DTO）、绑定关系、订单摘要与最近订单行。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');

function decorateCustomer(customer, fallbackNo) {
  const doc = customer || {};
  return {
    customerNo: doc.customerNo || fallbackNo || '—',
    displayName: F.textOrDash(doc.displayName),
    dormText: doc.dormText || doc.dorm || '—',
    phoneTailText: doc.phoneTail || '—',
    profileText: doc.profileCompleted ? '资料完整' : '资料未完整',
    isTest: doc.isTest === true
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

function buildSummaryText(summary) {
  const source = summary || {};
  return '进行中 ' + pickCount(source.inProgress) +
    ' · 已完成 ' + pickCount(source.completed) +
    ' · 异常 ' + pickCount(source.exception);
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
  return {
    customer: decorateCustomer(source.customer || {}, fallbackNo),
    binding: decorateBinding(source.bindingSummary || null),
    orderSummaryText: buildSummaryText(source.orderSummary || {}),
    recentOrders: (source.recentOrders || []).map(decorateOrder)
  };
}

module.exports = {
  decorateCustomer,
  decorateBinding,
  buildSummaryText,
  decorateOrder,
  buildDetailView
};
