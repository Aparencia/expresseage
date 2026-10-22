// pkg-admin/pages/orders/parts/view-model.js · 订单总览视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.6/§5.2/§11.5——脱敏行、测试标签、空态/异常空态、状态筛选计数。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');

function buildTabs(activeStatus, counts) {
  return C.ORDER_STATUS_TABS.map(function mapTab(tab) {
    const raw = counts ? counts[tab.key] : undefined;
    return {
      key: tab.key,
      label: tab.label,
      active: tab.key === activeStatus,
      countText: raw === undefined || raw === null ? '' : ' ' + raw
    };
  });
}

function exceptionTextOf(exception) {
  const source = exception || {};
  // 服务端给中文 codeText；缺失时也不透出内部英文码，只说明"已上报异常"
  return source.codeText || source.text || (source.code ? '已上报异常' : '');
}

// v1.0（D23/D24）：一行=一单，件数独立呈现（N>1 才出 chip）；无截图·手填单独标识
function parcelCountTextOf(count) {
  const total = Number(count);
  return total > 1 ? total + ' 件' : '';
}

function manualEntryTextOf(row) {
  return row && row.manualEntry === true ? '无截图' : '';
}

function decorateRow(item) {
  const row = item || {};
  const exception = row.exception || {};
  return {
    orderNo: row.orderNo || '—',
    statusText: row.statusText || C.ORDER_STATUS_LABELS[row.status] || '—',
    serviceName: row.serviceName || row.serviceCode || '—',
    dormText: row.dormText || row.dorm || '—',
    statusUpdatedAtText: F.formatTime(row.statusUpdatedAt),
    isTest: row.isTest === true,
    exceptionText: exceptionTextOf(exception),
    partnerNo: row.partnerNo || '',
    reportedAtText: exception.reportedAt ? F.formatTime(exception.reportedAt) : '',
    parcelCountText: parcelCountTextOf(row.parcelCount),
    manualEntryText: manualEntryTextOf(row)
  };
}

function decorateList(list) {
  return (list || []).map(decorateRow);
}

// 空态：搜索空 / 异常工单空 / 当前筛选空（三种文案必须区分）
function buildEmptyText(options) {
  const opts = options || {};
  if (opts.keyword) return '没有找到匹配的订单，换个订单号或编号试试。';
  if (opts.activeStatus && opts.activeStatus === C.ORDER_STATUS_EXCEPTION) return '没有待处理的异常工单。';
  return '当前筛选下没有订单。';
}

module.exports = {
  buildTabs,
  exceptionTextOf,
  decorateRow,
  decorateList,
  buildEmptyText
};
