// cloudfunctions/cleanup/sweeps/orders.js · 订单超时取消 + 送达自动完成（SYSTEM，批 100，幂等）
// 口径：ENGINEERING §4.7 orderTimeout/autoComplete；DATA_MODEL §8.2；guest 单同样由 autoComplete 完成。
'use strict';

const util = require('./_util');

const ORDER_TIMEOUT_SWEEP = 'orderTimeout';
const AUTO_COMPLETE_SWEEP = 'autoComplete';

async function runOrderTimeout(ctx) {
  const C = util.collectionsOf(ctx);
  const timeoutMinutes = util.numberConfig(ctx.config, 'orderTimeoutMinutes', 120);
  const deadline = util.minutesBefore(ctx.now, timeoutMinutes);
  const rows = await util.scanPage(ctx, C.ORDERS, { status: util.enums.ORDER_STATUS.SUBMITTED }, [['statusUpdatedAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const order = rows[i];
    if (util.msOf(order.createdAt) >= deadline) {
      continue;
    }
    scanned += 1;
    const nowDate = util.nowDateOf(ctx);
    try {
      await ctx.dao.transaction(async (trx) => {
        await trx.update(C.ORDERS, order._id, {
          status: util.enums.ORDER_STATUS.CANCELLED,
          cancelReason: 'TIMEOUT_UNACCEPTED',
          cancelledBy: util.enums.CANCELLED_BY.SYSTEM,
          cancelledAt: nowDate,
          statusUpdatedAt: nowDate,
          updatedAt: nowDate,
          version: (order.version || 1) + 1
        });
        await trx.add(C.ORDER_EVENTS, util.eventDoc(
          order,
          'TIMEOUT_CANCELLED',
          util.enums.ORDER_STATUS.SUBMITTED,
          util.enums.ORDER_STATUS.CANCELLED,
          util.enums.CANCELLED_BY.SYSTEM,
          nowDate,
          { scheduledBy: util.SYSTEM },
          String(order._id) + ':cleanup.orderTimeout'
        ));
      });
      acted += 1;
    } catch (error) {
      if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
        continue;
      }
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

async function runAutoComplete(ctx) {
  const C = util.collectionsOf(ctx);
  const hours = util.numberConfig(ctx.config, 'autoCompleteHours', 24);
  const deadline = util.hoursBefore(ctx.now, hours);
  const rows = await util.scanPage(ctx, C.ORDERS, { status: util.enums.ORDER_STATUS.DELIVERED }, [['deliveredAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const order = rows[i];
    const deliveredAt = util.msOf(order.deliveredAt);
    if (!deliveredAt || deliveredAt >= deadline) {
      continue;
    }
    scanned += 1;
    const nowDate = util.nowDateOf(ctx);
    try {
      await ctx.dao.transaction(async (trx) => {
        await trx.update(C.ORDERS, order._id, {
          status: util.enums.ORDER_STATUS.COMPLETED,
          completedAt: nowDate,
          statusUpdatedAt: nowDate,
          updatedAt: nowDate,
          version: (order.version || 1) + 1
        });
        await trx.add(C.ORDER_EVENTS, util.eventDoc(
          order,
          'AUTO_COMPLETED',
          util.enums.ORDER_STATUS.DELIVERED,
          util.enums.ORDER_STATUS.COMPLETED,
          util.enums.CANCELLED_BY.SYSTEM,
          nowDate,
          { scheduledBy: util.SYSTEM },
          String(order._id) + ':cleanup.autoComplete'
        ));
      });
      acted += 1;
    } catch (error) {
      if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
        continue;
      }
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  ORDER_TIMEOUT_SWEEP,
  AUTO_COMPLETE_SWEEP,
  runOrderTimeout,
  runAutoComplete
};
