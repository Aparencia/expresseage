// pages/partner/workbench/parts/handover-view.js · D81「已转出」纯件（折叠态/行投影/只读进度面板）
// 口径：服务端只回最小进度投影（order.listPartner view='handover'）；页面不补任何顾客字段、不出现操作按钮。
'use strict';

function closedState() {
  return { loaded: false, expanded: false, loading: false, rows: [], error: '' };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

// 时间统一「今天 HH:mm / MM-DD HH:mm」：只做展示，不改服务端时间口径
function timeTextOf(iso, now) {
  if (typeof iso !== 'string' || iso === '') {
    return '';
  }
  const ms = Date.parse(iso);
  if (!isFinite(ms)) {
    return '';
  }
  const date = new Date(ms);
  const base = pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  const nowDate = now instanceof Date ? now : new Date();
  const today = nowDate.getFullYear() === date.getFullYear() && nowDate.getMonth() === date.getMonth()
    && nowDate.getDate() === date.getDate();
  return today ? pad2(date.getHours()) + ':' + pad2(date.getMinutes()) : base;
}

function rowOf(dto, now) {
  const value = dto && typeof dto === 'object' ? dto : {};
  const transfer = value.transfer && typeof value.transfer === 'object' ? value.transfer : {};
  return {
    orderNo: typeof value.orderNo === 'string' ? value.orderNo : '',
    statusText: typeof value.statusText === 'string' ? value.statusText : '',
    fulfillmentPartnerNo: typeof value.fulfillmentPartnerNo === 'string' ? value.fulfillmentPartnerNo : '',
    progressIndex: typeof value.progressIndex === 'number' ? value.progressIndex : 0,
    timeText: timeTextOf(value.statusUpdatedAt, now),
    transferTimeText: timeTextOf(transfer.requestedAt, now),
    deliveredTimeText: timeTextOf(value.deliveredAt, now),
    completedTimeText: timeTextOf(value.completedAt, now)
  };
}

function rowsOf(list, now) {
  return (Array.isArray(list) ? list : []).map((item) => rowOf(item, now));
}

// 只读进度面板：type=tracking 由 WXML 渲染只读行 + 仅「关闭」按钮
function panelOf(row) {
  return {
    type: 'tracking',
    title: '已转出 ' + (row && row.orderNo ? row.orderNo : ''),
    tracking: row || rowOf(null)
  };
}

module.exports = {
  closedState,
  timeTextOf,
  rowOf,
  rowsOf,
  panelOf
};
