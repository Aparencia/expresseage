// handlers/order/_list-transfer.js · D58 待接收转派列表（view='transfer'）与主视图角标计数（从 listPartner.js 拆出控行数）
// 口径：草案 §1.3 [Q1]=A / DATA_MODEL §5.2 查询路径「目标兼职待接收转派」——服务端过滤 + 逐行惰性过期，
//       客户端零过滤；行 DTO 按目标视角遮蔽（§1.4）；counts 六项零值模板、顶层 transferPending 由服务端计数。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderView = require('../../shared/order-view');
const common = require('./_common');
const dto = require('./_dto');
const transfer = require('./_transfer');
const expire = require('./_transfer-expire');
const { readKeyword, readOptionalBindingId, parseTimeBound } = require('./_list-query');

// 单账号 PENDING 邀请量级 = 日上限（TTL 10 分钟），一次扫描足够
const MAX_TRANSFER_SCAN = 100;

// D58：待接收转派角标（服务端计数，客户端不自行计数、不额外轮询 view=transfer）。
// 口径 = 本人为目标 + PENDING + 订单仍 ACCEPTED + 未过期；count 单查询（不惰性写库，过期项由读路径收敛）。
async function countTransferPending(ctx, partner, nowMs) {
  return ctx.dao.count(COLLECTIONS.ORDERS, {
    where: {
      'transfer.toPartnerId': partner._id,
      'transfer.status': enums.TRANSFER_STATUS.PENDING,
      'transfer.expiresAt': ctx.dao.command('gt', new Date(nowMs)),
      status: enums.ORDER_STATUS.ACCEPTED,
      isTest: common.isTestSession(ctx)
    }
  });
}

function transferRequestedMsOf(order) {
  return transfer.dateMsOf(order && order.transfer && order.transfer.requestedAt);
}

// transfer 视图不消费筛选参数：静默忽略会让"筛了但没筛"变成全量返回，统一拒绝（与其它视图同口径）
function assertTransferQuery(input) {
  if (readOptionalBindingId(input)) {
    throw common.errors.validation('bindingId', '待接收转派列表不支持该筛选参数');
  }
  if (readKeyword(input.keyword)) {
    throw common.errors.validation('keyword', '待接收转派列表不支持搜索');
  }
  if (typeof input.status === 'string' && input.status.trim() !== '') {
    throw common.errors.validation('status', '待接收转派列表不支持状态筛选');
  }
  if (parseTimeBound(input.from) > 0 || parseTimeBound(input.to) > 0) {
    throw common.errors.validation('from', '待接收转派列表不支持时间筛选');
  }
}

function transferCursorOf(page, hasMore) {
  const last = page[page.length - 1];
  if (!hasMore || !last) {
    return null;
  }
  return { sortValue: transferRequestedMsOf(last), orderNo: last.orderNo || '' };
}

// 逐行惰性过期：过期/订单已离开 ACCEPTED 的先落库再排除（读到即收敛，无需 sweep）
async function validPendingRowsOf(ctx, rows, nowMs) {
  const valid = [];
  for (let i = 0; i < rows.length; i += 1) {
    let current = await expire.expireIfNeeded(ctx, rows[i], nowMs);
    current = await expire.expireForStateChange(ctx, current, nowMs);
    if (transfer.isPending(current) && current.status === enums.ORDER_STATUS.ACCEPTED) {
      valid.push(current);
    }
  }
  return valid;
}

// 数据源 = orders.transfer（目标=本人、PENDING、订单仍 ACCEPTED）；服务端过滤 + 惰性过期，客户端零过滤。
// 目标兼职视角：无 counterpart/customerNo（§1.4），行不内联 actions（入口点进详情）。
async function listTransferOrders(ctx, partner, input) {
  assertTransferQuery(input);
  const paging = common.parsePaging(input);
  const nowMs = common.nowMsOf(ctx);
  const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
    where: {
      'transfer.toPartnerId': partner._id,
      'transfer.status': enums.TRANSFER_STATUS.PENDING,
      isTest: common.isTestSession(ctx)
    },
    orderBy: [['transfer.requestedAt', 'desc'], ['orderNo', 'desc']],
    limit: MAX_TRANSFER_SCAN
  });
  const valid = await validPendingRowsOf(ctx, rows, nowMs);
  const candidates = valid.filter((row) => common.isAfterCursor(
    transferRequestedMsOf(row), row.orderNo, paging.cursor
  ));
  const page = candidates.slice(0, paging.limit);
  const list = await dto.buildOrderDtos(ctx, page, '', { withActions: false, transferTarget: true });
  return {
    list,
    nextCursor: transferCursorOf(page, candidates.length > paging.limit),
    counts: orderView.countsTemplate(),
    transferPending: valid.length
  };
}

module.exports = {
  MAX_TRANSFER_SCAN,
  countTransferPending,
  listTransferOrders
};
