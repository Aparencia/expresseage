// handlers/partner/stats.js · partner.stats（兼职单量统计：今日/本周/本月；服务端聚合、零费用口径）
// 口径：DATA_MODEL §7.4 表格与「批 7 兼职客户与运营（只增不改语义）」③；UX_PARTNER §3.8/§9。
// completed 按 completedAt、cancelled 按 cancelledAt、exceptions 按 exception.reportedAt 落区间；
// active 为当前非终态单量（不随区间）；completionRate=completed/(completed+cancelled+exceptions)，分母 0 → null；
// series 近 7 个自然日固定 7 项（缺日补 0）；recent 只含 orderNo/status/statusText/at（日报摘要源）。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const customer = require('./_customer');

const RANGES = ['today', 'week', 'month'];
const DEFAULT_RANGE = 'today';

function resolveRange(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_RANGE;
  }
  const range = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (RANGES.indexOf(range) < 0) {
    throw errors.validation('range', '统计区间不正确，请刷新页面后重试');
  }
  return range;
}

function emptyCounts() {
  return { completed: 0, active: 0, cancelled: 0, exceptions: 0 };
}

// 测试账号会话：统计一律排除测试数据（DATA_MODEL §6.6/§7.4），直接返回空模板而不查库。
function emptyStats(range, nowMs) {
  return {
    range,
    counts: emptyCounts(),
    completionRate: null,
    series: customer.buildSeries(nowMs, function zeroCompleted() { return 0; }),
    recent: [],
    todayCompleted: 0
  };
}

// 异常上报时间：口径写 `exception.reportedAt`（DATA_MODEL §7.4 批 7）；落库字段实际是 `exception.at`
// （§2.5 字段表 + order.reportException 写 at）。先取 at，兼容未来更名/管理端写入口的 reportedAt。
function exceptionReportedAt(order) {
  const exception = order && order.exception;
  if (!exception) {
    return 0;
  }
  return customer.msOf(exception.at) || customer.msOf(exception.reportedAt);
}

// 自然日区间 [startMs, startMs+24h) 内的完成单数（series/todayCompleted 共用）。
function completedBetween(completed, startMs, dayMs) {
  let total = 0;
  completed.forEach((order) => {
    const ms = customer.msOf(order.completedAt);
    if (ms >= startMs && ms < startMs + dayMs) {
      total += 1;
    }
  });
  return total;
}

// 日报摘要行：只回 orderNo/status/statusText/at（不含取件码/宿舍/尾号，UX §9）。
function recentRowOf(order) {
  const status = customer.textOf(order.status);
  return {
    orderNo: customer.textOf(order.orderNo),
    status,
    statusText: enums.orderStatusText(status),
    at: customer.isoOf(order.statusUpdatedAt)
  };
}

async function handler(ctx, payload) {
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const range = resolveRange(input.range);
  const nowMs = customer.nowMsOf(ctx);
  if (customer.scopeOf(ctx).isTestAccount) {
    return emptyStats(range, nowMs);
  }
  const startMs = customer.rangeStartMs(range, nowMs);
  const orders = await customer.loadPartnerOrders(ctx, partner._id);
  const completedAll = orders.filter((order) => order.status === enums.ORDER_STATUS.COMPLETED);
  // series / todayCompleted 固定看「近 7 个自然日 + 今天」，不随 range 缩窗（range=today 时 series 仍要 7 项）。
  const completed = completedAll.filter((order) => (
    customer.inWindow(customer.msOf(order.completedAt), startMs, nowMs)
  ));
  const cancelled = orders.filter((order) => (
    order.status === enums.ORDER_STATUS.CANCELLED
    && customer.inWindow(customer.msOf(order.cancelledAt), startMs, nowMs)
  ));
  const exceptions = orders.filter((order) => (
    customer.inWindow(exceptionReportedAt(order), startMs, nowMs)
  ));
  const counts = {
    completed: completed.length,
    active: await customer.countActiveOrders(ctx, partner._id),
    cancelled: cancelled.length,
    exceptions: exceptions.length
  };
  const series = customer.buildSeries(nowMs, (dayStart) => (
    completedBetween(completedAll, dayStart, customer.DAY_MS)
  ));
  const todayStart = customer.dayStartMs(nowMs);
  const recent = orders
    .filter((order) => customer.inWindow(customer.statusUpdatedMs(order), startMs, nowMs))
    .sort(customer.compareOrderRowsDesc)
    .slice(0, customer.RECENT_LIMIT)
    .map(recentRowOf);
  const denominator = counts.completed + counts.cancelled + counts.exceptions;
  return {
    range,
    counts,
    completionRate: denominator > 0 ? counts.completed / denominator : null,
    series,
    recent,
    todayCompleted: completedBetween(completedAll, todayStart, customer.DAY_MS)
  };
}

module.exports = { handler };
