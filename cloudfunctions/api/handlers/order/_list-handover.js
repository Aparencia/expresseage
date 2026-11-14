// handlers/order/_list-handover.js · D81「已转出」列表（转派发起者只读跟踪；服务端过滤，客户端零过滤）
// 查询口径：orders.transfer.fromPartnerId=本人 + transfer.status=ACCEPTED + 可跟踪状态；按 statusUpdatedAt desc 游标。
// 索引：`idx_transfer_from(transfer.fromPartnerId,transfer.status,statusUpdatedAt desc)`（RUNBOOK §3.4 控制台创建）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderView = require('../../shared/order-view');
const common = require('./_common');
const transfer = require('./_transfer');
const handover = require('./_handover');

const MAX_HANDOVER_SCAN = 100;

function assertHandoverQuery(input) {
  if (typeof input.bindingId === 'string' && input.bindingId.trim() !== '') {
    throw common.errors.validation('bindingId', '已转出列表不支持该筛选参数');
  }
  if (typeof input.keyword === 'string' && input.keyword.trim() !== '') {
    throw common.errors.validation('keyword', '已转出列表不支持搜索');
  }
  if (typeof input.status === 'string' && input.status.trim() !== '') {
    throw common.errors.validation('status', '已转出列表不支持状态筛选');
  }
  if (typeof input.from === 'string' && input.from.trim() !== '') {
    throw common.errors.validation('from', '已转出列表不支持时间筛选');
  }
  if (typeof input.to === 'string' && input.to.trim() !== '') {
    throw common.errors.validation('to', '已转出列表不支持时间筛选');
  }
}

function msOf(order) {
  return transfer.dateMsOf(order && order.statusUpdatedAt);
}

function cursorOf(page, hasMore) {
  const last = page[page.length - 1];
  if (!hasMore || !last) {
    return null;
  }
  return { sortValue: msOf(last), orderNo: transfer.textOf(last.orderNo) };
}

async function listHandoverOrders(ctx, partner, input) {
  const payload = input || {};
  assertHandoverQuery(payload);
  const paging = common.parsePaging(payload);
  const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
    where: {
      'transfer.fromPartnerId': partner._id,
      'transfer.status': enums.TRANSFER_STATUS.ACCEPTED,
      status: ctx.dao.command('in', handover.TRACKABLE_STATUSES),
      isTest: common.isTestSession(ctx)
    },
    orderBy: [['statusUpdatedAt', 'desc'], ['orderNo', 'desc']],
    limit: MAX_HANDOVER_SCAN
  });
  const candidates = rows.filter((row) => handover.isInitiatorOf(row, partner._id)
    && common.isAfterCursor(msOf(row), row.orderNo, paging.cursor));
  const page = candidates.slice(0, paging.limit);
  return {
    list: page.map((row) => handover.rowOf(row)),
    nextCursor: cursorOf(page, candidates.length > paging.limit),
    counts: orderView.countsTemplate(),
    handover: true
  };
}

module.exports = {
  MAX_HANDOVER_SCAN,
  assertHandoverQuery,
  listHandoverOrders
};
