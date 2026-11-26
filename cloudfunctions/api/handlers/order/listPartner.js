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
const orderNoSpec = require('../../shared/order-no');
const orderView = require('../../shared/order-view');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const dto = require('./_dto');
const summaryPure = require('./_summary');
const access = require('./_transfer-access');
const listTransfer = require('./_list-transfer');
const listHandover = require('./_list-handover');
const listMerged = require('./_list-merged');
const autoComplete = require('./_auto-complete');
const { readKeyword, readOptionalBindingId, parseTimeBound, cursorWheresOf } = require('./_list-query');

const WORKBENCH_VIEW = 'workbench';
const DAY_VIEW = 'day';
const HISTORY_VIEW = 'history';
const CUSTOMER_VIEW = 'customer';
// D58/Q1：待接收转派列表（目标兼职视角，见 _list-transfer.js）
const TRANSFER_VIEW = 'transfer';
// D81：已转出（转派发起者只读跟踪，见 _list-handover.js）
const HANDOVER_VIEW = 'handover';
const YESTERDAY_MS = time.DAY_MS;
// 今日流水行内不显示写操作（D54/批 20）：待确认（delivered 桶）与已完结（history 桶）只读
const DAY_READONLY_BUCKETS = ['delivered', 'history'];

// view 显式五值：缺省=workbench（页面首屏不传）、day=今日订单流水（批 20）；非法值拒绝而不是静默降级
// （否则筛选口径被悄悄改掉）。
function resolveView(input) {
  const raw = typeof input.view === 'string' ? input.view.trim().toLowerCase() : '';
  if (raw === '') {
    return WORKBENCH_VIEW;
  }
  if (raw === WORKBENCH_VIEW || raw === DAY_VIEW || raw === HISTORY_VIEW || raw === CUSTOMER_VIEW
    || raw === TRANSFER_VIEW || raw === HANDOVER_VIEW) {
    return raw;
  }
  throw errors.validation('view', '视图参数不正确，请刷新页面后重试');
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
  return orderNoSpec.isOrderNo(text) ? text : '';
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
// P0-12（2026-11-26 性能审查）：状态分桶查询互不依赖 → 并行发出，行集与截断标记按状态顺序归并（与串行版逐字一致）。
// P1-11（同日审查）：pushCursor（history/customer 视图）时把游标下推进 where，历史单超出首屏窗口仍可继续翻页；
// workbench/day 保持原「最新一窗」语义（summary 依赖该窗，下推会改变 summary 口径）。
async function fetchOrders(ctx, partnerId, filter, scanLimit, extraWhere, pushCursor) {
  const isTest = common.isTestSession(ctx);
  const cursorWheres = cursorWheresOf(ctx, filter.sortField, pushCursor || null);
  const extraWheres = cursorWheres.length > 0 ? cursorWheres : [{}];
  const groups = await Promise.all(filter.statuses.map((status) => Promise.all(
    extraWheres.map((extra) => ctx.dao.find(COLLECTIONS.ORDERS, {
      where: Object.assign({ partnerId, status, isTest }, extraWhere || {}, extra),
      orderBy: [[filter.sortField, 'desc'], ['orderNo', 'desc']],
      limit: scanLimit
    }))
  )));
  const rows = [];
  let truncated = false;
  groups.forEach((parts) => {
    parts.forEach((part) => {
      if (part.length >= scanLimit) {
        truncated = true;
      }
      part.forEach((row) => rows.push(row));
    });
  });
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
  const fetched = await fetchOrders(ctx, partnerId, filter, opts.scanLimit, opts.extraWhere,
    opts.pushCursor ? opts.paging.cursor : null);
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
  const hasMore = candidates.length > opts.paging.limit;
  // 游标必须在 D91 补完成之前取（补完成会改写 statusUpdatedAt，下一页会重扫已返回行）。
  const nextCursor = hasMore && page.length
    ? common.makeCursor(page[page.length - 1], filter.sortField)
    : null;
  // D91：页内已到日结时刻的送达单就地补完成（cleanup 触发器未跑时的兜底；行对象原地更新 →
  // 列表行、counts、summary（workbench/day 复用 summaryRows/scanRows 同一份引用）都看到 COMPLETED）
  await autoComplete.completeDueRows(ctx, page, common.nowMsOf(ctx));
  return {
    page,
    hasMore,
    nextCursor,
    sortField: filter.sortField,
    summaryRows,
    // 批 20/D54：keyword/时间窗过滤前的去重扫描行（view=day 的「今日已送达」summary 用它聚合，
    // 不被当前搜索词收窄）；旧 summary 仍用 summaryRows，口径不变。
    scanRows: uniqueRows,
    scanTruncated: fetched.truncated === true
  };
}

function pageQueryOf(input, scanLimit, pushCursor) {
  return {
    scanLimit,
    keyword: readKeyword(input.keyword),
    fromMs: parseTimeBound(input.from),
    toMs: parseTimeBound(input.to),
    paging: common.parsePaging(input),
    pushCursor: pushCursor === true
  };
}

// pageOf 已在补完成前算好游标（D91），这里只取结果，避免读到被改写的 statusUpdatedAt。
function nextCursorOf(result) {
  return result.nextCursor || null;
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
  const todayStart = todayStartOf(nowMs);
  // P0-12：五状态等值 count 与「今日完成」范围 count 互不依赖 → 并行（口径与查询条件不变）。
  const [statusCounts, todayCompleted] = await Promise.all([
    Promise.all(mapping.map((item) => ctx.dao.count(COLLECTIONS.ORDERS, {
      where: { partnerId, status: item[1], isTest }
    }))),
    // 今日完成（TD-043）：单 count 表达「completedAt ≥ 今日起点」，不再 find(limit:100) 后内存过滤；
    // 口径与旧实现一致（单日完成数没有上界），仍按 isTest 隔离。
    ctx.dao.count(COLLECTIONS.ORDERS, {
      where: {
        partnerId,
        status: enums.ORDER_STATUS.COMPLETED,
        isTest,
        completedAt: ctx.dao.command('gte', new Date(todayStart))
      }
    })
  ]);
  mapping.forEach((item, index) => {
    counts[item[0]] = statusCounts[index];
  });
  counts.todayCompleted = todayCompleted;
  return counts;
}

// 客户订单视图：bindingId 必须属于当前兼职（他人/不存在一律 FORBIDDEN，不暴露绑定是否存在）；
// 只返回该绑定顾客在本人名下的订单（partnerId=me AND customerId=binding.customerId），
// guest 单 customerId='' 天然不进入；行复用 history 行、不内联 actions[]、不发 counts。
// P1-3：行级遮蔽与详情同口径（_transfer-access.maskFlagsOf），转派进入的单不会在列表泄漏 customerNo/昵称。
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
  const query = pageQueryOf(input, 300, true); // P1-11：客户订单视图无 summary 依赖，游标可下推
  query.extraWhere = { customerId: binding.customerId };
  const result = await pageOf(ctx, partner._id, filter, query);
  const maskFlags = await access.maskFlagsOf(ctx, result.page, partner);
  const list = await dto.buildOrderDtos(ctx, result.page, 'PARTNER', { withActions: false, maskFlags });
  return { list, nextCursor: nextCursorOf(result) };
}

function scanLimitOf(paging) {
  return Math.min(Math.max(paging.limit * 3, 60), 300);
}

// 视图附加 summary（从 orderListPartner 拆出控单函数行数）：workbench=苑/栋+状态聚合、day=今日已送达；
// 均复用本次 find 的命中行（零额外查询/零二次扫描），P1-6 扫描触顶时带 truncated=true；
// history/customer/transfer 形状不变、不发 summary（只增不改）。
function attachSummaries(body, view, result, nowMs) {
  if (view === WORKBENCH_VIEW) {
    body.summary = summaryPure.buildSummary(result.summaryRows, { truncated: result.scanTruncated });
    return body;
  }
  if (view === DAY_VIEW) {
    body.summary = summaryPure.buildDeliveredToday(result.scanRows, {
      nowMs,
      truncated: result.scanTruncated
    });
  }
  return body;
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
  // D58/Q1：待接收转派列表（目标兼职本人视角；服务端过滤，无需 bindingId/keyword）
  if (view === TRANSFER_VIEW) {
    return listTransfer.listTransferOrders(ctx, partner, input);
  }
  // D81：已转出（发起者只读跟踪；服务端过滤）
  if (view === HANDOVER_VIEW) { return listHandover.listHandoverOrders(ctx, partner, input); }
  // bindingId 只服务 customer 视图；在其它视图静默忽略参数会让「按顾客筛」变成全量返回。
  if (readOptionalBindingId(input)) {
    throw errors.validation('bindingId', '仅顾客订单视图支持按绑定顾客筛选');
  }
  const filter = resolveFilter(input, view);
  const paging = common.parsePaging(input);
  const nowMs = common.nowMsOf(ctx);
  // P1-11（2026-11-26 审查）：history 不依赖 summary/窗口聚合，游标可安全下推；workbench/day 保持最新一窗语义。
  const query = pageQueryOf(input, scanLimitOf(paging), view === HISTORY_VIEW);
  // 批 20/D53：view=day = UTC+8 今日内有状态更新的全部七状态订单（窗口锚 statusUpdatedAt，与服务端排序同字段）
  if (view === DAY_VIEW) {
    query.extraWhere = dayWindowWhereOf(ctx, nowMs);
  }
  const result = await pageOf(ctx, partner._id, filter, query);
  const inlineActions = view === WORKBENCH_VIEW || view === DAY_VIEW;
  // P1-3：行级顾客身份遮蔽（与详情同口径；转派进入的单在列表同样零 customerNo/昵称泄漏），动作矩阵不动
  const maskFlags = await access.maskFlagsOf(ctx, result.page, partner);
  let list = await dto.buildOrderDtos(ctx, result.page, 'PARTNER', { withActions: inlineActions, maskFlags });
  // D54/批 20：今日流水的待确认/已完结行只读（不显示写操作）；workbench/history/customer 不动
  if (view === DAY_VIEW) {
    list = stripWriteActionsOf(list);
  }
  // P0-2/TD-073：只有 workbench/day 消费 counts；history 为零值模板（不计入、无查询）。
  const counts = inlineActions ? await buildCounts(ctx, partner._id, nowMs) : orderView.countsTemplate();
  const body = { list, nextCursor: nextCursorOf(result), counts };
  // D58：待接收转派角标只在需要它的主视图下发（workbench/day 轮询用；history/customer 保持既有严格形状，
  // 避免把 TD-050 的「零额外查询」口径扩到全视图；transfer 视图自带角标）。
  if (view === WORKBENCH_VIEW || view === DAY_VIEW) {
    body.transferPending = await listTransfer.countTransferPending(ctx, partner, nowMs);
  }
  return listMerged.finalize({ ctx, partner, view, paging, result, body, nowMs, statuses: filter.statuses, dayStartMs: view === DAY_VIEW ? todayStartOf(nowMs) : 0, attach: attachSummaries });
};
