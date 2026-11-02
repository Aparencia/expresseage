// handlers/order/_transfer-expire.js · D58 转派「读到即落库」的三个惰性终态入口（从 _transfer.js 拆出控行数）
// 口径：草案 §1.3 过期机制（任何读到 PENDING 且 now>expiresAt 的路径先落 EXPIRED 再返回）+
//       Q4 订单离开 ACCEPTED（STATE_CHANGED）+ P1-2 已有件被取（D61 件级，同样 STATE_CHANGED）。
// P1-4：写入一律「事务内条件更新」——where 带 version + transfer.status='PENDING'，updated===0 即他人已推进，
//       本次零写、零事件（杜绝事务外旧快照把已 ACCEPTED 的转派覆盖回 EXPIRED）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const store = require('./_store');
const transfer = require('./_transfer');

const STATUS = transfer.STATUS;
const REASON = transfer.REASON;

// 过期/状态变化共用：resolvePendingTransferOf 是纯件，写库只在这里发生（且只落一次）。
async function persistResolvedTransfer(ctx, order, resolved, nowMs) {
  const nowDate = store.toDate(nowMs);
  try {
    await ctx.dao.transaction(async (trx) => {
      const written = await trx.updateWhere(COLLECTIONS.ORDERS, {
        _id: order._id,
        version: transfer.numberOrZero(order.version),
        'transfer.status': STATUS.PENDING
      }, {
        transfer: resolved.transfer,
        version: transfer.numberOrZero(order.version) + 1,
        updatedAt: nowDate
      });
      if (!written.updated) {
        return;
      }
      await trx.add(COLLECTIONS.ORDER_EVENTS, resolved.event);
    });
  } catch (error) {
    // 并发读到同一过期邀请：唯一 requestKey 撞索引 = 另一请求已落库（不再二次写）
    if (!(ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error))) {
      throw error;
    }
  }
  const fresh = await store.getOrderById(ctx, order._id);
  return fresh || order;
}

// 超时：PENDING 且 now>expiresAt → EXPIRED/EXPIRED
async function expireIfNeeded(ctx, order, nowMs) {
  if (!transfer.isExpired(order, nowMs)) {
    return order;
  }
  const resolved = transfer.resolvePendingTransferOf(order, {
    status: STATUS.EXPIRED, reason: REASON.EXPIRED, nowDate: store.toDate(nowMs)
  });
  return resolved ? persistResolvedTransfer(ctx, order, resolved, nowMs) : order;
}

// Q4：订单已不在 ACCEPTED 却仍 PENDING（历史脏数据/他端越过钩子）→ 先落 EXPIRED/STATE_CHANGED 再报错
async function expireForStateChange(ctx, order, nowMs) {
  if (!transfer.isPending(order) || order.status === enums.ORDER_STATUS.ACCEPTED) {
    return order;
  }
  const resolved = transfer.resolvePendingTransferOf(order, {
    status: STATUS.EXPIRED, reason: REASON.STATE_CHANGED, nowDate: store.toDate(nowMs)
  });
  return resolved ? persistResolvedTransfer(ctx, order, resolved, nowMs) : order;
}

// P1-2：订单仍 ACCEPTED 但已有件被取（D61 件级）→ 邀请失效；acceptTransfer 据此先落终态再 INVALID_STATE
async function expireForPicked(ctx, order, nowMs) {
  if (!transfer.isPending(order) || !transfer.hasPickedAny(order)) {
    return order;
  }
  const resolved = transfer.resolvePendingTransferOf(order, {
    status: STATUS.EXPIRED, reason: REASON.STATE_CHANGED, nowDate: store.toDate(nowMs)
  });
  return resolved ? persistResolvedTransfer(ctx, order, resolved, nowMs) : order;
}

module.exports = {
  persistResolvedTransfer,
  expireIfNeeded,
  expireForStateChange,
  expireForPicked
};
