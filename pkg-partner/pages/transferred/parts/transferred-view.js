// pkg-partner/pages/transferred/parts/transferred-view.js · 「转出单」页纯件（零 wx、零请求）
// D103（2026-11-26 用户指令）：已转出且对方已接收的单不在取件清单两个 tab 内，集中到本页看信息。
// 数据源 order.listPartner({view:'handover'})（服务端已按 transfer.fromPartnerId=me + ACCEPTED 过滤）。
'use strict';

const enums = require('../../../../shared/enums');
const orderState = require('../../../../shared/order-state');

const PAGE_LIMIT = 20;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

// 后台 DTO 时间：ISO 字符串；只做展示，解析失败留空
function timeTextOf(value) {
  if (!value) {
    return '';
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!ms || Number.isNaN(ms)) {
    return '';
  }
  const date = new Date(ms);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function queryOf(cursor) {
  const payload = { view: 'handover', limit: PAGE_LIMIT };
  if (cursor) {
    payload.cursor = cursor;
  }
  return payload;
}

function partnerTextOf(item) {
  const no = textOf(item && item.fulfillmentPartnerNo);
  return no ? '接手 ' + no : '接手人待同步';
}

function pieceTextOf(item) {
  const count = typeof (item && item.parcelCount) === 'number' ? item.parcelCount : 0;
  const picked = typeof (item && item.pickedCount) === 'number' ? item.pickedCount : 0;
  const base = count > 0 ? count + ' 件' : '';
  if (!base || !item || item.allPicked === true || picked <= 0) {
    return base;
  }
  return base + ' · 已取 ' + picked + '/' + count;
}

function rowOf(item) {
  const value = item || {};
  const status = textOf(value.status);
  return {
    key: textOf(value.orderNo) || String(value.orderNo || ''),
    orderNo: textOf(value.orderNo),
    status: status,
    statusText: textOf(value.statusText) || orderState.statusText(status),
    partnerText: partnerTextOf(value),
    pieceText: pieceTextOf(value),
    timeText: timeTextOf(value.statusUpdatedAt) || timeTextOf(value.deliveredAt) || timeTextOf(value.completedAt),
    delivered: status === enums.ORDER_STATUS.DELIVERED || status === enums.ORDER_STATUS.COMPLETED
  };
}

function rowsOf(list) {
  return listOf(list).map(rowOf).filter((row) => !!row.orderNo);
}

// 页头汇总：只报「已加载」，有下一页时提示上拉；转出单数量不并入取件清单 chip（计数不变）
function summaryOf(rows, nextCursor) {
  const total = listOf(rows).length;
  if (!total) {
    return '还没有转出且对方已接收的单';
  }
  const loaded = '已加载 ' + total + ' 单';
  return nextCursor ? loaded + '（还有更多，上拉加载）' : loaded;
}

module.exports = {
  PAGE_LIMIT,
  queryOf,
  rowOf,
  rowsOf,
  summaryOf
};
