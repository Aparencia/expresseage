// handlers/partner/stats.js · partner.stats（兼职单量统计：今日/本周/本月；服务端聚合、零费用口径）
// 口径：DATA_MODEL §7.4 表格与「批 7 兼职客户与运营（只增不改语义）」③；UX_PARTNER §3.8/§9。
// completed 按 completedAt、cancelled 按 cancelledAt、exceptions 按 exception.at 落区间；
// active 为当前非终态单量（不随区间）；completionRate=completed/(completed+cancelled+exceptions)，分母 0 → null；
// series 近 7 个自然日固定 7 项（缺日补 0）；recent 只含 orderNo/status/statusText/at（日报摘要源）。
// TD-050：全部计数走 count + 范围命令，不再按状态 find(limit:300) 取「最近窗口」——
//   单状态月区间 >300 单时四格计数/series 不再截断；查询次数固定上界（见 countInWindow/loadSeriesData 注释）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
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

// ── 区间计数（TD-050）：查询次数固定上界，不随历史单量增长 ─────────────────────────────
// completed/cancelled/exceptions 各 2 次（≥区间起点 − >区间终点 = [起点,终点]）；
// active 沿用 countActiveOrders（5 次 count）；recent 1 次 find(limit RECENT_LIMIT)；
// 合计 ≤20 次读。exceptions 用点路径 'exception.at'（与生产既有 'image.fileId' 嵌套查询同形）。
function baseWhere(partnerId, status) {
  const where = { partnerId, isTest: false };
  if (status) {
    where.status = status;
  }
  return where;
}

async function countOrAfter(ctx, partnerId, field, ms, status) {
  const where = baseWhere(partnerId, status);
  where[field] = ctx.dao.command('gte', new Date(ms));
  return ctx.dao.count(COLLECTIONS.ORDERS, { where });
}

async function countAfter(ctx, partnerId, field, ms, status) {
  const where = baseWhere(partnerId, status);
  where[field] = ctx.dao.command('gt', new Date(ms));
  return ctx.dao.count(COLLECTIONS.ORDERS, { where });
}

async function countInWindow(ctx, partnerId, field, startMs, endMs, status) {
  const from = await countOrAfter(ctx, partnerId, field, startMs, status);
  const after = await countAfter(ctx, partnerId, field, endMs, status);
  return from - after;
}

// 近 7 自然日 series + todayCompleted：8 个自然日边界 count（7 个起点 + 明日起点），相邻差=当日完成数，
// 与旧 completedBetween「[起点, 起点+24h) 且不封顶到 now」同口径。
async function loadSeriesData(ctx, partnerId, nowMs) {
  const todayStart = customer.dayStartMs(nowMs);
  const boundaries = [];
  for (let offset = customer.SERIES_DAYS - 1; offset >= 0; offset -= 1) {
    boundaries.push(todayStart - offset * customer.DAY_MS);
  }
  boundaries.push(todayStart + customer.DAY_MS);
  const atOrAfter = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    atOrAfter.push(await countOrAfter(ctx, partnerId, 'completedAt', boundaries[i], enums.ORDER_STATUS.COMPLETED));
  }
  const completedByDay = [];
  for (let i = 0; i < customer.SERIES_DAYS; i += 1) {
    completedByDay.push(atOrAfter[i] - atOrAfter[i + 1]);
  }
  return {
    completedByDay,
    todayStart,
    todayCompleted: atOrAfter[customer.SERIES_DAYS - 1] - atOrAfter[customer.SERIES_DAYS]
  };
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

// 区间内最近单：statusUpdatedAt desc 取前 RECENT_LIMIT 条（上界按 now 在内存收口，与 inWindow 同口径）。
// 同刻次序沿用旧 .sort(compareOrderRowsDesc)：orderNo 升序（orderNo 含日期段，等价「同刻老单在前」）。
async function loadRecent(ctx, partnerId, startMs, nowMs) {
  const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
    where: Object.assign(baseWhere(partnerId), {
      statusUpdatedAt: ctx.dao.command('gte', new Date(startMs))
    }),
    orderBy: [['statusUpdatedAt', 'desc'], ['orderNo', 'asc']],
    limit: customer.RECENT_LIMIT
  });
  return rows
    .filter((order) => customer.msOf(order.statusUpdatedAt) <= nowMs)
    .slice(0, customer.RECENT_LIMIT)
    .map(recentRowOf);
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
  const completed = await countInWindow(
    ctx, partner._id, 'completedAt', startMs, nowMs, enums.ORDER_STATUS.COMPLETED
  );
  const cancelled = await countInWindow(
    ctx, partner._id, 'cancelledAt', startMs, nowMs, enums.ORDER_STATUS.CANCELLED
  );
  const exceptions = await countInWindow(ctx, partner._id, 'exception.at', startMs, nowMs);
  const active = await customer.countActiveOrders(ctx, partner._id);
  const seriesData = await loadSeriesData(ctx, partner._id, nowMs);
  const recent = await loadRecent(ctx, partner._id, startMs, nowMs);
  const counts = {
    completed,
    active,
    cancelled,
    exceptions
  };
  const denominator = counts.completed + counts.cancelled + counts.exceptions;
  const series = customer.buildSeries(nowMs, (dayStart) => (
    seriesData.completedByDay[
      customer.SERIES_DAYS - 1 - Math.round((seriesData.todayStart - dayStart) / customer.DAY_MS)
    ]
  ));
  return {
    range,
    counts,
    completionRate: denominator > 0 ? counts.completed / denominator : null,
    series,
    recent,
    todayCompleted: seriesData.todayCompleted
  };
}

module.exports = { handler };
