// handlers/order/listPartner.js · order.listPartner：兼职工作台 / 历史订单 + counts 六项
// 服务端返回「状态桶 + 站点分组 + 四档动线」视图（DATA_MODEL §5.2/§8.5）；客户端只渲染不重排。
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

function parseTimeBound(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const ms = time.toMs(value);
  return ms;
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
  const fields = [
    order.orderNo,
    order.customerNo,
    parcel.pickupCode,
    parcel.trackingTail,
    dorm.dormKey,
    dorm.roomTag,
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

function stationSortKey(stationId) {
  const index = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].indexOf(stationId);
  return index < 0 ? 99 : index;
}

function buildGroups(orders) {
  const map = {};
  orders.forEach((order) => {
    const parcel = order.parcel || {};
    const stationId = typeof parcel.stationId === 'string' && parcel.stationId ? parcel.stationId : '';
    const key = stationId || '__NONE__';
    if (!map[key]) {
      map[key] = { stationId, stationName: parcel.stationName || '', orders: [] };
    }
    map[key].orders.push(order);
  });
  return Object.keys(map)
    .map((key) => map[key])
    .sort((left, right) => stationSortKey(left.stationId) - stationSortKey(right.stationId))
    .map((group) => ({
      stationId: group.stationId,
      stationName: group.stationName,
      orders: orderView.sortByPickupRoute(group.orders)
    }));
}

module.exports = async function orderListPartner(ctx, payload) {
  const partner = await common.loadScopePartner(ctx);
  if (!partner) {
    throw errors.forbidden('未激活兼职身份');
  }
  const input = payload || {};
  const view = input.view === HISTORY_VIEW ? HISTORY_VIEW : WORKBENCH_VIEW;
  const filter = resolveFilter(input, view);
  const paging = common.parsePaging(input);
  const keyword = common.readTrimmedText(input.keyword, 40);
  const fromMs = parseTimeBound(input.from);
  const toMs = parseTimeBound(input.to);
  const scanLimit = Math.min(Math.max(paging.limit * 3, 60), 300);
  const rows = await fetchOrders(ctx, partner._id, filter, scanLimit);
  const sortValueOf = (order) => time.toMs(order[filter.sortField]);
  const candidates = rows
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
  const list = await dto.buildOrderDtos(ctx, page, 'PARTNER', { withActions: false });
  const last = page[page.length - 1];
  const counts = await buildCounts(ctx, partner._id, common.nowMsOf(ctx));
  return {
    list,
    nextCursor: hasMore && last ? common.makeCursor(last, filter.sortField) : null,
    counts,
    groups: buildGroups(page)
  };
};
