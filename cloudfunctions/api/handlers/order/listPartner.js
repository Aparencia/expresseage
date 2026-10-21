// handlers/order/listPartner.js · order.listPartner：兼职工作台 / 历史订单 + counts 六项
// 响应形状 = {list,nextCursor,counts}（DATA_MODEL §7）；四档动线排序由客户端零件层用 shared/order-view 执行，
// 服务端只做状态桶 + 站点过滤；列表一律经 _dto 输出，绝不下发 raw order 文档（DATA_MODEL §6 DTO 铁律）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderView = require('../../shared/order-view');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const dto = require('./_dto');

const WORKBENCH_VIEW = 'workbench';
const HISTORY_VIEW = 'history';
const YESTERDAY_MS = time.DAY_MS;
const KEYWORD_MAX_CHARS = 40;

function parseTimeBound(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const ms = time.toMs(value);
  return ms;
}

// view 显式二值：缺省=workbench（页面首屏不传），非法值拒绝而不是静默降级（否则筛选口径被悄悄改掉）。
function resolveView(input) {
  const raw = typeof input.view === 'string' ? input.view.trim().toLowerCase() : '';
  if (raw === '') {
    return WORKBENCH_VIEW;
  }
  if (raw === WORKBENCH_VIEW || raw === HISTORY_VIEW) {
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

async function findExactOrder(ctx, partnerId, orderNo) {
  return ctx.dao.findOne(COLLECTIONS.ORDERS, {
    where: { partnerId, orderNo, isTest: common.isTestSession(ctx) }
  });
}

function resolveFilter(payload, view) {
  const raw = typeof payload.status === 'string' ? payload.status.trim().toUpperCase() : '';
  if (raw && !enums.isOrderStatus(raw)) {
    throw errors.validation('status', '订单状态筛选不合法');
  }
  if (view === HISTORY_VIEW) {
    const statuses = raw ? [raw] : [enums.ORDER_STATUS.COMPLETED, enums.ORDER_STATUS.CANCELLED];
    return { statuses, sortField: 'statusUpdatedAt' };
  }
  if (raw) {
    return { statuses: [raw], sortField: 'statusUpdatedAt' };
  }
  return { statuses: enums.ORDER_ACTIVE_STATUSES.slice(), sortField: 'statusUpdatedAt' };
}

function matchKeyword(order, keyword) {
  if (!keyword) {
    return true;
  }
  const text = keyword.toLowerCase();
  const parcel = order.parcel || {};
  const guest = order.guest || {};
  const dorm = order.dorm || {};
  // 搜索入口（UX §4.5）：订单号 / 取件码 / 楼栋宿舍 / 称呼 / 尾号 4 位；代客单无订单归属，
  // 用 guest 快照（displayName/phoneTail/dormKey）承担锚+键匹配。
  const fields = [
    order.orderNo,
    order.customerNo,
    order.phoneTail,
    parcel.pickupCode,
    parcel.trackingTail,
    dorm.dormKey,
    dorm.roomTag,
    guest.displayName,
    guest.phoneTail,
    guest.dormKey
  ];
  for (let i = 0; i < fields.length; i += 1) {
    if (typeof fields[i] === 'string' && fields[i].toLowerCase().indexOf(text) >= 0) {
      return true;
    }
  }
  return false;
}

async function fetchOrders(ctx, partnerId, filter, scanLimit) {
  const isTest = common.isTestSession(ctx);
  const rows = [];
  for (let i = 0; i < filter.statuses.length; i += 1) {
    const part = await ctx.dao.find(COLLECTIONS.ORDERS, {
      where: { partnerId, status: filter.statuses[i], isTest },
      orderBy: [[filter.sortField, 'desc'], ['orderNo', 'desc']],
      limit: scanLimit
    });
    part.forEach((row) => rows.push(row));
  }
  return rows;
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
  const todayStart = nowMs - ((nowMs + time.TZ_OFFSET_MS) % YESTERDAY_MS);
  const completed = await ctx.dao.find(COLLECTIONS.ORDERS, {
    where: { partnerId, status: enums.ORDER_STATUS.COMPLETED, isTest },
    orderBy: [['completedAt', 'desc']],
    limit: 100
  });
  counts.todayCompleted = completed.filter((order) => time.toMs(order.completedAt) >= todayStart).length;
  return counts;
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
  const filter = resolveFilter(input, view);
  const paging = common.parsePaging(input);
  const keyword = readKeyword(input.keyword);
  const fromMs = parseTimeBound(input.from);
  const toMs = parseTimeBound(input.to);
  const scanLimit = Math.min(Math.max(paging.limit * 3, 60), 300);
  const rows = await fetchOrders(ctx, partner._id, filter, scanLimit);
  // 完整订单号补一次唯一索引精确查询：窗口扫描只截断「部分匹配」，完整单号命中不应受窗口影响。
  const exactOrderNo = keyword ? exactOrderNoOf(keyword) : '';
  if (exactOrderNo) {
    const exactRow = await findExactOrder(ctx, partner._id, exactOrderNo);
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
  const sortValueOf = (order) => time.toMs(order[filter.sortField]);
  const candidates = uniqueRows
    .filter((order) => matchKeyword(order, keyword))
    .filter((order) => {
      if (fromMs === 0 && toMs === 0) {
        return true;
      }
      const anchor = time.toMs(order.completedAt) || time.toMs(order.cancelledAt) || time.toMs(order.statusUpdatedAt);
      if (fromMs && anchor < fromMs) {
        return false;
      }
      if (toMs && anchor > toMs) {
        return false;
      }
      return true;
    })
    .filter((order) => common.isAfterCursor(sortValueOf(order), order.orderNo, paging.cursor))
    .sort((left, right) => {
      const delta = sortValueOf(right) - sortValueOf(left);
      if (delta !== 0) {
        return delta;
      }
      return String(right.orderNo || '') < String(left.orderNo || '') ? -1 : 1;
    });
  const page = candidates.slice(0, paging.limit);
  const hasMore = candidates.length > paging.limit;
  // 工作台行级快捷操作（批 6-B 前置）：只给 workbench 行内联 actions[]，history 与 listCustomer 不动。
  const list = await dto.buildOrderDtos(ctx, page, 'PARTNER', { withActions: view === WORKBENCH_VIEW });
  const last = page[page.length - 1];
  const counts = await buildCounts(ctx, partner._id, common.nowMsOf(ctx));
  return {
    list,
    nextCursor: hasMore && last ? common.makeCursor(last, filter.sortField) : null,
    counts
  };
};
