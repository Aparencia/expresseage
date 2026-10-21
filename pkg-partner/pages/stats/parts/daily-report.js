// pkg-partner/pages/stats/parts/daily-report.js · 日报摘要纯件（可复制；零 wx）
// 口径：docs/V4_UX_PARTNER.md §9「日报摘要（可复制）」：`【代取日报】YYYY-MM-DD 完成 N 单、异常 M 单；
//       订单 20261021-0031 已送达 / 20261021-0027 已取件 / …`——只含 orderNo + 状态 + 日期，
//       不含取件码/宿舍/尾号；无任何费用信息。数据源 = partner.stats 的 counts/recent（DATA_MODEL §7.4）。
'use strict';

const viewModel = require('./view-model');

const REPORT_TITLE = '【代取日报】';
const MAX_ORDERS = 10;
const ORDER_NO_RE = /^[A-Za-z0-9-]{4,32}$/;
const STATUS_TEXT_MAX = 20;

function emptyReport() {
  return {
    visible: false,
    date: '',
    completed: 0,
    exceptions: 0,
    orderCount: 0,
    text: '',
    copyText: ''
  };
}

function countOf(value) {
  const number = Number(value);
  return isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// 订单号白名单：只放行编号字符，异常值一律不进日报（防越界字符串夹带敏感内容）
function orderNoOf(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const raw = typeof item.orderNo === 'string' ? item.orderNo.trim() : '';
  return ORDER_NO_RE.test(raw) ? raw : '';
}

// 状态文案直接取服务端 statusText（人话；不端侧拼状态字面量）；压平空白并截断
function statusTextOf(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const raw = typeof item.statusText === 'string' ? item.statusText : '';
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length > STATUS_TEXT_MAX ? text.slice(0, STATUS_TEXT_MAX) : text;
}

// 只取 ≤10 单，每条 = orderNo + statusText（recent 里其它键一概不进文本）
function orderLinesOf(dto) {
  const recent = dto && typeof dto === 'object' && Array.isArray(dto.recent)
    ? dto.recent.slice(0, MAX_ORDERS)
    : [];
  const lines = [];
  recent.forEach(function take(item) {
    const orderNo = orderNoOf(item);
    const statusText = statusTextOf(item);
    if (orderNo && statusText) {
      lines.push(orderNo + ' ' + statusText);
    }
  });
  return lines;
}

/**
 * 今日日报摘要。todayDto = partner.stats({range:'today'}) 的返回（任何 range 都复用缓存）。
 * 无可展示数据（0 完成 / 0 异常 / 无订单行）时 visible=false，页面显示空文案、不复制假日报。
 */
function reportOf(todayDto, options) {
  const opts = options || {};
  const dto = todayDto && typeof todayDto === 'object' ? todayDto : null;
  const empty = emptyReport();
  if (!dto) {
    return empty;
  }
  const counts = dto.counts && typeof dto.counts === 'object' ? dto.counts : {};
  const completed = countOf(counts.completed);
  const exceptions = countOf(counts.exceptions);
  const orders = orderLinesOf(dto);
  const date = viewModel.todayDateKeyOf(dto, opts.nowMs);
  const visible = completed > 0 || exceptions > 0 || orders.length > 0;
  if (!visible) {
    return Object.assign({}, empty, { date: date });
  }
  const head = REPORT_TITLE + date + ' 完成 ' + completed + ' 单、异常 ' + exceptions + ' 单';
  const text = orders.length ? head + '；订单 ' + orders.join(' / ') + '。' : head + '。';
  return {
    visible: true,
    date: date,
    completed: completed,
    exceptions: exceptions,
    orderCount: orders.length,
    text: text,
    copyText: text
  };
}

module.exports = {
  REPORT_TITLE,
  MAX_ORDERS,
  STATUS_TEXT_MAX,
  emptyReport,
  orderNoOf,
  statusTextOf,
  orderLinesOf,
  reportOf
};
