// cloudfunctions/cleanup/sweeps/orders.js · 订单超时取消 + 送达自动完成（SYSTEM，批 100，幂等）
// 口径：ENGINEERING §4.7 orderTimeout/autoComplete；DATA_MODEL §5.2（超时锚 statusUpdatedAt、
//       自动完成锚 deliveredAt）；guest 单同样由 autoComplete 完成。
// 并发安全：扫描→更新的窗口内订单可能被接单/确认，更新必须带 fromStatus 条件（updateWhere 条件更新），
//       只有真正命中 1 条才写事件；条件未命中=对手先动，本轮跳过、下一轮按新状态判断。
'use strict';

const util = require('./_util');

const ORDER_TIMEOUT_SWEEP = 'orderTimeout';
const AUTO_COMPLETE_SWEEP = 'autoComplete';

async function cancelExpired(ctx, order, nowDate) {
  const C = util.collectionsOf(ctx);
  return ctx.dao.transaction(async (trx) => {
    const updated = await trx.updateWhere(C.ORDERS, {
      _id: order._id,
      status: util.enums.ORDER_STATUS.SUBMITTED
    }, {
      status: util.enums.ORDER_STATUS.CANCELLED,
      cancelReason: 'TIMEOUT_UNACCEPTED',
      cancelledBy: util.enums.CANCELLED_BY.SYSTEM,
      cancelledAt: nowDate,
      statusUpdatedAt: nowDate,
      updatedAt: nowDate,
      version: (order.version || 1) + 1
    });
    if (updated.updated !== 1) {
      return false;
    }
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
    return true;
  });
}

async function runOrderTimeout(ctx) {
  const C = util.collectionsOf(ctx);
  const timeoutMinutes = util.numberConfig(ctx.config, 'orderTimeoutMinutes', 120);
  const deadline = util.minutesBefore(ctx.now, timeoutMinutes);
  const rows = await util.scanPage(ctx, C.ORDERS, { status: util.enums.ORDER_STATUS.SUBMITTED },
    [['statusUpdatedAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const order = rows[i];
    // 契约锚 = statusUpdatedAt（SUBMITTED 未被别的动作改过时等于 createdAt）；createdAt 仅作历史数据兜底
    const anchor = util.msOf(order.statusUpdatedAt) || util.msOf(order.createdAt);
    if (anchor >= deadline) {
      continue;
    }
    scanned += 1;
    try {
      const done = await cancelExpired(ctx, order, util.nowDateOf(ctx));
      if (done) {
        acted += 1;
      }
    } catch (error) {
      if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
        continue;
      }
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

async function completeDelivered(ctx, order, nowDate) {
  const C = util.collectionsOf(ctx);
  return ctx.dao.transaction(async (trx) => {
    const updated = await trx.updateWhere(C.ORDERS, {
      _id: order._id,
      status: util.enums.ORDER_STATUS.DELIVERED
    }, {
      status: util.enums.ORDER_STATUS.COMPLETED,
      completedAt: nowDate,
      statusUpdatedAt: nowDate,
      updatedAt: nowDate,
      version: (order.version || 1) + 1
    });
    if (updated.updated !== 1) {
      return false;
    }
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
    return true;
  });
}

async function runAutoComplete(ctx) {
  const C = util.collectionsOf(ctx);
  const hours = util.numberConfig(ctx.config, 'autoCompleteHours', 24);
  const deadline = util.hoursBefore(ctx.now, hours);
  const rows = await util.scanPage(ctx, C.ORDERS, { status: util.enums.ORDER_STATUS.DELIVERED },
    [['deliveredAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const order = rows[i];
    // 契约锚 = deliveredAt；缺时间戳的脏数据回落 statusUpdatedAt，避免 DELIVERED 单永久滞留
    const deliveredAt = util.msOf(order.deliveredAt) || util.msOf(order.statusUpdatedAt);
    if (!deliveredAt || deliveredAt >= deadline) {
      continue;
    }
    scanned += 1;
    try {
      const done = await completeDelivered(ctx, order, util.nowDateOf(ctx));
      if (done) {
        acted += 1;
      }
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
