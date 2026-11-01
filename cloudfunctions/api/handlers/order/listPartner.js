// handlers/order/listPartner.js · order.listPartner：兼职工作台 / 今日订单流水（批 20 view=day）/ 历史订单 / 客户订单（批 7 view=customer）
// 响应形状 = {list,nextCursor,counts}（history）；workbench/history 顶层键 + D48 只增 summary（仅 workbench，
// 基于本次 find 命中行聚合、零额外查询；P1-6 扫描触顶时 summary.truncated=true）；view=customer 返回
// {list,nextCursor}、不发 counts/summary（DATA_MODEL §7.5 批 7 段④）。四档动线排序由客户端零件层用
// shared/order-view 执行，服务端只做状态桶 + 绑定顾客过滤；列表一律经 _dto 输出，绝不下发 raw order 文档。
// 批 20（D53）：view=day = UTC+8 今日（statusUpdatedAt ≥ 今日 0 点）内有状态更新的全部七状态订单，
// 按 statusUpdatedAt desc 分页；返回 counts 与新的「今日已送达」summary（D54 口径，形状带 scope 标记）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderView = require('../../shared/order-view');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const dto = require('./_dto');
const summaryPure = require('./_summary');

const WORKBENCH_VIEW = 'workbench';
const DAY_VIEW = 'day';
const HISTORY_VIEW = 'history';
const CUSTOMER_VIEW = 'customer';
const YESTERDAY_MS = time.DAY_MS;
const KEYWORD_MAX_CHARS = 40;
const BINDING_ID_MAX = 64;
// 今日流水行内不显示写操作（D54/批 20）：待确认（delivered 桶）与已完结（history 桶）只读
const DAY_READONLY_BUCKETS = ['delivered', 'history'];

function parseTimeBound(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const ms = time.toMs(value);
  return ms;
}

// view 显式四值：缺省=workbench（页面首屏不传）、day=今日订单流水（批 20）；非法值拒绝而不是静默降级
// （否则筛选口径被悄悄改掉）。
function resolveView(input) {
  const raw = typeof input.view === 'string' ? input.view.trim().toLowerCase() : '';
  if (raw === '') {
    return WORKBENCH_VIEW;
  }
  if (raw === WORKBENCH_VIEW || raw === DAY_VIEW || raw === HISTORY_VIEW || raw === CUSTOMER_VIEW) {
    return raw;
  }
  throw errors.validation('view', '视图参数不正确，请刷新页面后重试');
}

// 工作台搜索词：空=不过滤；超长/非串拒绝（静默忽略会让「搜了但没筛」变成全量返回）。
function readKeyword(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw errors.validation('keyword', '搜索词不正确，请重新输入');
  }
  const text = value.trim();
  if (text.length > KEYWORD_MAX_CHARS) {
    throw errors.validation('keyword', '搜索词过长，请缩短后重试');
  }
  return text;
}

// 绑定顾客筛选参数（批 7 view=customer 必传）：非串/超长拒绝；空串=未给（由调用处按视图裁决）。
function readOptionalBindingId(input) {
  const value = input && typeof input === 'object' ? input.bindingId : undefined;
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw errors.validation('bindingId', '绑定顾客参数不正确，请刷新页面后重试');
  }
  const text = value.trim();
  if (text === '') {
    return '';
  }
  if (text.length > BINDING_ID_MAX) {
    throw errors.validation('bindingId', '绑定顾客参数不正确，请刷新页面后重试');
  }
  return text;
}

// 停用/注销兼职不再返回业务数据（CONTRACT §1：只看到「已停用」提示；DATA_MODEL §12 #3）。
function assertPartnerReadable(partner) {
  if (partner.deletedAt || partner.status === enums.PARTNER_STATUS.CLOSED) {
    throw errors.partnerClosed('兼职已注销，无法查看工作台');
  }
  if (partner.status === enums.PARTNER_STATUS.SUSPENDED) {
    throw errors.partnerClosed('兼职已停用，无法查看工作台');
  }
}

// 完整订单号走唯一索引精确查询：命中不受 300 条扫描窗限制（搜索漏单修复；keyword 部分匹配仍按窗口扫描）。
function exactOrderNoOf(keyword) {
  const text = keyword.trim().toUpperCase();
  return enums.ORDER_NO_PATTERN.test(text) ? text : '';
}

async function findExactOrder(ctx, partnerId, orderNo, extraWhere) {
  return ctx.dao.findOne(COLLECTIONS.ORDERS, {
    where: Object.assign({ partnerId, orderNo, isTest: common.isTestSession(ctx) }, extraWhere || {})
  });
}

function readStatusFilter(payload) {
  const raw = typeof payload.status === 'string' ? payload.status.trim().toUpperCase() : '';
  if (raw && !enums.isOrderStatus(raw)) {
    throw errors.validation('status', '订单状态筛选不合法');
  }
  return raw;
}

function resolveFilter(payload, view) {
  const raw = readStatusFilter(payload);
  if (view === HISTORY_VIEW) {
    const statuses = raw ? [raw] : [enums.ORDER_STATUS.COMPLETED, enums.ORDER_STATUS.CANCELLED];
    return { statuses, sortField: 'statusUpdatedAt' };
  }
  // 今日订单流水（D53）：七状态全收（含已送达/已完成/已取消），窗口由 handler 的 statusUpdatedAt 下界收口
  if (view === DAY_VIEW) {
    return { statuses: raw ? [raw] : enums.ORDER_STATUS_LIST.slice(), sortField: 'statusUpdatedAt' };
  }
  if (raw) {
    return { statuses: [raw], sortField: 'statusUpdatedAt' };
  }
  return { statuses: enums.ORDER_ACTIVE_STATUSES.slice(), sortField: 'statusUpdatedAt' };
}

// 客户订单视图（批 7）：一个顾客的全部订单（含已完成/已取消），status 只作可选筛选。
function resolveCustomerFilter(payload) {
  const raw = readStatusFilter(payload);
  return { statuses: raw ? [raw] : enums.ORDER_STATUS_LIST.slice(), sortField: 'statusUpdatedAt' };
}

function matchKeyword(order, keyword) {
  if (!keyword) {
    return true;
  }
  const text = keyword.toLowerCase();
  const guest = order.guest || {};
  const dorm = order.dorm || {};
  // 搜索入口（UX §4.5）：订单号 / 任一件取件码或运单尾号 / 楼栋宿舍 / 称呼 / 尾号 4 位；代客单无订单归属，
  // 用 guest 快照（displayName/phoneTail/dormKey）承担锚+键匹配。v1.0 多包裹由 orderParcelsOf 统一归一。
  const fields = [
    order.orderNo,
    order.customerNo,
    order.phoneTail,
    dorm.dormKey,
    dorm.roomTag,
    guest.displayName,
    guest.phoneTail,
    guest.dormKey
  ];
  common.orderParcelsOf(order).forEach((parcel) => {
    fields.push(parcel.pickupCode, parcel.trackingTail, parcel.stationName);
  });
  for (let i = 0; i < fields.length; i += 1) {
    if (typeof fields[i] === 'string' && fields[i].toLowerCase().indexOf(text) >= 0) {
      return true;
    }
  }
  return false;
}

// P1-6：任一状态 find 返回行数触达扫描上限（>= scanLimit）→ 本次候选集可能不全，summary 需如实标注
// （聚合值仍按已取到的行计算，跨状态合并后去重；不新增查询、不二次扫描）。
async function fetchOrders(ctx, partnerId, filter, scanLimit, extraWhere) {
  const isTest = common.isTestSession(ctx);
  const rows = [];
  let truncated = false;
  for (let i = 0; i < filter.statuses.length; i += 1) {
    const part = await ctx.dao.find(COLLECTIONS.ORDERS, {
      where: Object.assign({ partnerId, status: filter.statuses[i], isTest }, extraWhere || {}),
      orderBy: [[filter.sortField, 'desc'], ['orderNo', 'desc']],
      limit: scanLimit
    });
    if (part.length >= scanLimit) {
      truncated = true;
    }
    part.forEach((row) => rows.push(row));
  }
  return { rows, truncated };
}

// 时间窗过滤：from/to 为 0 表示不限；锚点与列表一致（completedAt → cancelledAt → statusUpdatedAt）。
function inTimeWindow(order, opts) {
  if (opts.fromMs === 0 && opts.toMs === 0) {
    return true;
  }
  const anchor = time.toMs(order.completedAt) || time.toMs(order.cancelledAt) || time.toMs(order.statusUpdatedAt);
  if (opts.fromMs && anchor < opts.fromMs) {
    return false;
  }
  if (opts.toMs && anchor > opts.toMs) {
    return false;
  }
  return true;
}

// 稳定排序：sortField 降序，同刻按 orderNo 降序兜底（翻页不重不漏）。
function compareRowsBy(sortField) {
  const sortValueOf = (order) => time.toMs(order[sortField]);
  return function compare(left, right) {
    const delta = sortValueOf(right) - sortValueOf(left);
    if (delta !== 0) {
      return delta;
    }
    return String(right.orderNo || '') < String(left.orderNo || '') ? -1 : 1;
  };
}

// 一次取数 → 精确单号补查 → 去重 → keyword/时间窗过滤（= D48 summary 候选集）→ 游标 → 稳定排序 → 单页切片。
// 两个视图共用（workbench/history 与 customer 只在 where 过滤与过滤状态集上不同）。
// P1-6：返回 scanTruncated（fetch 触达扫描上限）供 workbench summary 标注「可能少报」；history/customer 不消费。
async function pageOf(ctx, partnerId, filter, options) {
  const opts = options || {};
  const fetched = await fetchOrders(ctx, partnerId, filter, opts.scanLimit, opts.extraWhere);
  const rows = fetched.rows;
  // 完整订单号补一次唯一索引精确查询：窗口扫描只截断「部分匹配」，完整单号命中不应受窗口影响。
  const exactOrderNo = opts.keyword ? exactOrderNoOf(opts.keyword) : '';
  if (exactOrderNo) {
    const exactRow = await findExactOrder(ctx, partnerId, exactOrderNo, opts.extraWhere);
    if (exactRow) {
      rows.push(exactRow);
    }
  }
  const seenOrderNos = {};
  const uniqueRows = rows.filter((order) => {
    const key = order.orderNo || '';
    if (seenOrderNos[key]) {
      return false;
    }
    seenOrderNos[key] = true;
    return true;
  });
  // summaryRows = 分页/游标之前的全部命中行：D48 要求 summary 与 limit/cursor 无关（复用本次已查 rows）。
  const summaryRows = uniqueRows
    .filter((order) => matchKeyword(order, opts.keyword))
    .filter((order) => inTimeWindow(order, opts));
  const candidates = summaryRows
    .filter((order) => common.isAfterCursor(time.toMs(order[filter.sortField]), order.orderNo, opts.paging.cursor))
    .sort(compareRowsBy(filter.sortField));
  const page = candidates.slice(0, opts.paging.limit);
  return {
    page,
    hasMore: candidates.length > opts.paging.limit,
    sortField: filter.sortField,
    summaryRows,
    // 批 20/D54：keyword/时间窗过滤前的去重扫描行（view=day 的「今日已送达」summary 用它聚合，
    // 不被当前搜索词收窄）；旧 summary 仍用 summaryRows，口径不变。
    scanRows: uniqueRows,
    scanTruncated: fetched.truncated === true
  };
}

function pageQueryOf(input, scanLimit) {
  return {
    scanLimit,
    keyword: readKeyword(input.keyword),
    fromMs: parseTimeBound(input.from),
    toMs: parseTimeBound(input.to),
    paging: common.parsePaging(input)
  };
}

function nextCursorOf(result) {
  const last = result.page[result.page.length - 1];
  return result.hasMore && last ? common.makeCursor(last, result.sortField) : null;
}

// UTC+8 今日 0 点（毫秒；与 buildCounts 的 todayCompleted 同公式、同一时区口径）
function todayStartOf(nowMs) {
  return nowMs - ((nowMs + time.TZ_OFFSET_MS) % YESTERDAY_MS);
}

// view=day 窗口下界：statusUpdatedAt ≥ 今日 0 点（今日 00:00~now 内有状态更新的订单；上界由 now 本身天然收口）
function dayWindowWhereOf(ctx, nowMs) {
  return { statusUpdatedAt: ctx.dao.command('gte', new Date(todayStartOf(nowMs))) };
}

// 今日流水行内只读（D54/批 20）：delivered（待确认）/history（已完成/已取消）不显示写操作，只留详情。
// 服务端先剥 actions[]，客户端 parts 再兜底清 toolbar（双保险，不依赖单端判据）。
function stripWriteActionsOf(list) {
  return (Array.isArray(list) ? list : []).map(function rowOf(item) {
    if (DAY_READONLY_BUCKETS.indexOf(item && item.bucket) < 0) {
      return item;
    }
    return Object.assign({}, item, { actions: [] });
  });
}

async function buildCounts(ctx, partnerId, nowMs) {
  const isTest = common.isTestSession(ctx);
  const counts = orderView.countsTemplate();
  const mapping = [
    ['submitted', enums.ORDER_STATUS.SUBMITTED],
    ['accepted', enums.ORDER_STATUS.ACCEPTED],
    ['picked', enums.ORDER_STATUS.PICKED],
    ['delivered', enums.ORDER_STATUS.DELIVERED],
    ['exception', enums.ORDER_STATUS.EXCEPTION]
  ];
  for (let i = 0; i < mapping.length; i += 1) {
    counts[mapping[i][0]] = await ctx.dao.count(COLLECTIONS.ORDERS, {
      where: { partnerId, status: mapping[i][1], isTest }
    });
  }
  const todayStart = todayStartOf(nowMs);
  // 今日完成（TD-043）：单 count 表达「completedAt ≥ 今日起点」，不再 find(limit:100) 后内存过滤；
  // 口径与旧实现一致（单日完成数没有上界），仍按 isTest 隔离。
  counts.todayCompleted = await ctx.dao.count(COLLECTIONS.ORDERS, {
    where: {
      partnerId,
      status: enums.ORDER_STATUS.COMPLETED,
      isTest,
      completedAt: ctx.dao.command('gte', new Date(todayStart))
    }
  });
  return counts;
}

// 客户订单视图：bindingId 必须属于当前兼职（他人/不存在一律 FORBIDDEN，不暴露绑定是否存在）；
// 只返回该绑定顾客在本人名下的订单（partnerId=me AND customerId=binding.customerId），
// guest 单 customerId='' 天然不进入；行复用 history 行、不内联 actions[]、不发 counts。
async function listCustomerOrders(ctx, partner, input) {
  const bindingId = readOptionalBindingId(input);
  if (!bindingId) {
    throw errors.validation('bindingId', '请选择顾客后查看订单');
  }
  const binding = await common.getBindingById(ctx, bindingId);
  if (!binding || String(binding.partnerId) !== String(partner._id)) {
    throw errors.forbidden('该顾客不在你的客户列表中');
  }
  const filter = resolveCustomerFilter(input);
  const query = pageQueryOf(input, 300);
  query.extraWhere = { customerId: binding.customerId };
  const result = await pageOf(ctx, partner._id, filter, query);
  const list = await dto.buildOrderDtos(ctx, result.page, 'PARTNER', { withActions: false });
  return { list, nextCursor: nextCursorOf(result) };
}

function scanLimitOf(paging) {
  return Math.min(Math.max(paging.limit * 3, 60), 300);
}

module.exports = async function orderListPartner(ctx, payload) {
  const partner = await common.loadScopePartner(ctx);
  if (!partner) {
    throw errors.forbidden('未激活兼职身份');
  }
  // 停用/注销不再返回业务数据（CONTRACT §1；DATA_MODEL §12 #3：listPartner 属兼职接口越权负向清单）。
  assertPartnerReadable(partner);
  const input = payload || {};
  const view = resolveView(input);
  if (view === CUSTOMER_VIEW) {
    return listCustomerOrders(ctx, partner, input);
  }
  // bindingId 只服务 customer 视图；在其它视图静默忽略参数会让「按顾客筛」变成全量返回。
  if (readOptionalBindingId(input)) {
    throw errors.validation('bindingId', '仅顾客订单视图支持按绑定顾客筛选');
  }
  const filter = resolveFilter(input, view);
  const paging = common.parsePaging(input);
  const nowMs = common.nowMsOf(ctx);
  const query = pageQueryOf(input, scanLimitOf(paging));
  // 批 20/D53：view=day = UTC+8 今日内有状态更新的全部七状态订单（窗口锚 statusUpdatedAt，与服务端排序同字段）
  if (view === DAY_VIEW) {
    query.extraWhere = dayWindowWhereOf(ctx, nowMs);
  }
  const result = await pageOf(ctx, partner._id, filter, query);
  const inlineActions = view === WORKBENCH_VIEW || view === DAY_VIEW;
  let list = await dto.buildOrderDtos(ctx, result.page, 'PARTNER', { withActions: inlineActions });
  // D54/批 20：今日流水的待确认/已完结行只读（不显示写操作）；workbench/history/customer 不动
  if (view === DAY_VIEW) {
    list = stripWriteActionsOf(list);
  }
  // P0-2/TD-073：只有 workbench 视图计算 counts（页面总览/红点消费它）；history 视图不白算 6 个 count。
  // 批 20：view=day 同样消费 counts（页面总览/红点），故一并计算；history 仍为零值模板（不计入、无查询）。
  const counts = inlineActions ? await buildCounts(ctx, partner._id, nowMs) : orderView.countsTemplate();
  const body = { list, nextCursor: nextCursorOf(result), counts };
  // D48：仅 workbench 只增 summary（按苑/栋聚合 + 状态计数；history/customer 形状不变、不发 summary）。
  // 复用本次 find 的命中行（result.summaryRows），零额外查询/零二次扫描；P1-6 扫描触顶时带 truncated=true。
  if (view === WORKBENCH_VIEW) {
    body.summary = summaryPure.buildSummary(result.summaryRows, { truncated: result.scanTruncated });
  }
  // D54（批 20）：view=day 的 summary 换「今日已送达」口径（deliveredAt 今日 + DELIVERED/COMPLETED、排除取消单；
  // 只到苑/栋）。用扫描行（keyword/时间窗过滤前）聚合，不被当前搜索词收窄；零额外查询。
  if (view === DAY_VIEW) {
    body.summary = summaryPure.buildDeliveredToday(result.scanRows, {
      nowMs,
      truncated: result.scanTruncated
    });
  }
  return body;
};
