// handlers/order/listCustomer.js · order.listCustomer：顾客本人订单列表（进行中 / 已完成 / 已取消）
// 服务端排序：进行中按 statusUpdatedAt desc；已完成按 completedAt desc；已取消按 cancelledAt desc。
// 分页：游标 {sortValue, orderNo}；不返回已删除记录（deletedByCustomerAt 非空仅从列表隐藏）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const dto = require('./_dto');

const IN_PROGRESS = 'IN_PROGRESS';
const SORT_FIELDS = {
  SUBMITTED: 'statusUpdatedAt',
  ACCEPTED: 'statusUpdatedAt',
  PICKED: 'statusUpdatedAt',
  DELIVERED: 'statusUpdatedAt',
  EXCEPTION: 'statusUpdatedAt',
  COMPLETED: 'completedAt',
  CANCELLED: 'cancelledAt'
};

function resolveFilter(payload) {
  const raw = typeof payload.status === 'string' ? payload.status.trim().toUpperCase() : '';
  if (!raw || raw === IN_PROGRESS || raw === 'ACTIVE') {
    return { statuses: enums.ORDER_ACTIVE_STATUSES, sortField: 'statusUpdatedAt' };
  }
  if (!enums.isOrderStatus(raw)) {
    throw errors.validation('status', '订单状态筛选不合法');
  }
  return { statuses: [raw], sortField: SORT_FIELDS[raw] || 'statusUpdatedAt' };
}

function matchKeyword(order, keyword) {
  if (!keyword) {
    return true;
  }
  const text = keyword.toLowerCase();
  const parcel = order.parcel || {};
  const fields = [
    order.orderNo,
    parcel.pickupCode,
    parcel.trackingTail,
    parcel.stationName
  ];
  for (let i = 0; i < fields.length; i += 1) {
    if (typeof fields[i] === 'string' && fields[i].toLowerCase().indexOf(text) >= 0) {
      return true;
    }
  }
  return false;
}

async function fetchOrders(ctx, customerId, filter, scanLimit) {
  const rows = [];
  for (let i = 0; i < filter.statuses.length; i += 1) {
    const part = await ctx.dao.find(COLLECTIONS.ORDERS, {
      where: { customerId, status: filter.statuses[i] },
      orderBy: [[filter.sortField, 'desc'], ['orderNo', 'desc']],
      limit: scanLimit
    });
    part.forEach((row) => rows.push(row));
  }
  return rows;
}

module.exports = async function orderListCustomer(ctx, payload) {
  const customerId = common.customerScope(ctx);
  const filter = resolveFilter(payload || {});
  const paging = common.parsePaging(payload || {});
  const keyword = common.readTrimmedText(payload && payload.keyword, 40);
  const scanLimit = Math.min(Math.max(paging.limit * 3, 60), 300);
  const rows = await fetchOrders(ctx, customerId, filter, scanLimit);
  const sortValueOf = (order) => time.toMs(order[filter.sortField]);
  const candidates = rows
    .filter((order) => !order.deletedByCustomerAt)
    .filter((order) => matchKeyword(order, keyword))
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
  const list = await dto.buildOrderDtos(ctx, page, 'CUSTOMER');
  const last = page[page.length - 1];
  return {
    list,
    nextCursor: hasMore && last ? common.makeCursor(last, filter.sortField) : null
  };
};
