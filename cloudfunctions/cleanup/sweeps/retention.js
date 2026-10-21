// cloudfunctions/cleanup/sweeps/retention.js · 终态订单留存：180 天匿名化 → 再 30 天物理删；软删 7 天物理删
// 口径：DATA_MODEL §10.1/§10.3；匿名化幂等判据 = anonymizedAt（禁止重复匿名化）。
'use strict';

const util = require('./_util');

const TERMINAL_STATUSES = [util.enums.ORDER_STATUS.COMPLETED, util.enums.ORDER_STATUS.CANCELLED];
const ANONYMIZE_DAYS = 180;
const PURGE_AFTER_ANONYMIZE_DAYS = 30;
const PURGE_AFTER_DELETE_DAYS = 7;

function anonymizedPatch(order, nowDate) {
  const parcel = order.parcel || {};
  return {
    customerId: '',
    customerOpenid: '',
    partnerOpenid: '',
    customerNo: '',
    partnerNo: '',
    phoneTail: '',
    note: '',
    deliveryNote: '',
    cancelReason: '',
    exception: null,
    dorm: null,
    guest: null,
    parcel: {
      stationId: typeof parcel.stationId === 'string' ? parcel.stationId : '',
      stationName: '',
      pickupCode: '',
      lockerNo: '',
      trackingTail: '',
      codeStatus: parcel.codeStatus || util.enums.CODE_STATUS.OK
    },
    image: { fileId: '', width: 0, height: 0, failureId: '' },
    anonymizedAt: nowDate,
    updatedAt: nowDate,
    version: (order.version || 1) + 1
  };
}

async function anonymizeOrder(ctx, order) {
  const C = util.collectionsOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  await ctx.dao.update(C.ORDERS, order._id, anonymizedPatch(order, nowDate));
  const messages = await ctx.dao.find(C.ORDER_MESSAGES, { where: { orderId: order._id }, limit: util.BATCH });
  for (let i = 0; i < messages.length; i += 1) {
    await ctx.dao.update(C.ORDER_MESSAGES, messages[i]._id, { text: '[已删除]', fromId: '' });
  }
  const events = await ctx.dao.find(C.ORDER_EVENTS, { where: { orderId: order._id }, limit: util.BATCH });
  for (let i = 0; i < events.length; i += 1) {
    await ctx.dao.update(C.ORDER_EVENTS, events[i]._id, { actorId: '', payload: {} });
  }
}

async function runRetention(ctx) {
  const C = util.collectionsOf(ctx);
  const anonymizeDeadline = util.daysBefore(ctx.now, ANONYMIZE_DAYS);
  const purgedAnonymizedDeadline = util.daysBefore(ctx.now, PURGE_AFTER_ANONYMIZE_DAYS);
  const purgedDeletedDeadline = util.daysBefore(ctx.now, PURGE_AFTER_DELETE_DAYS);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let s = 0; s < TERMINAL_STATUSES.length; s += 1) {
    const rows = await util.scanPage(ctx, C.ORDERS, { status: TERMINAL_STATUSES[s] }, [['statusUpdatedAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const order = rows[i];
      const anonymizedAt = util.msOf(order.anonymizedAt);
      const deletedByCustomerAt = util.msOf(order.deletedByCustomerAt);
      const shouldAnonymize = !anonymizedAt && util.msOf(order.statusUpdatedAt) < anonymizeDeadline;
      const shouldPurge = (anonymizedAt > 0 && anonymizedAt < purgedAnonymizedDeadline)
        || (deletedByCustomerAt > 0 && deletedByCustomerAt < purgedDeletedDeadline);
      if (!shouldAnonymize && !shouldPurge) {
        continue;
      }
      scanned += 1;
      try {
        if (shouldPurge) {
          await util.removeOrderCascade(ctx, order);
        } else {
          await anonymizeOrder(ctx, order);
        }
        acted += 1;
      } catch (error) {
        failed += 1;
      }
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  ANONYMIZE_DAYS,
  PURGE_AFTER_ANONYMIZE_DAYS,
  PURGE_AFTER_DELETE_DAYS,
  runRetention
};
