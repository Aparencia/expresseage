// cloudfunctions/cleanup/sweeps/retention.js · 终态订单留存：180 天匿名化 → 再 30 天物理删；软删 7 天物理删
// 口径：DATA_MODEL §10.1/§10.2 步骤 5/6、§10.3 匿名化字段表；ENGINEERING §4.7 retention。
// 幂等判据 = anonymizedAt（禁止重复匿名化）。三类到期条件各自走带条件的查询，避免"已处理过的旧单
// 占满批 100 把后面待匿名化/待物理删的单挡住"（隐私留存超标的真实风险）。
'use strict';

const util = require('./_util');

const TERMINAL_STATUSES = [util.enums.ORDER_STATUS.COMPLETED, util.enums.ORDER_STATUS.CANCELLED];
const ANONYMIZE_DAYS = 180;
const PURGE_AFTER_ANONYMIZE_DAYS = 30;
const PURGE_AFTER_DELETE_DAYS = 7;

// §10.3 匿名化字段表：去 openid/编号快照/尾号/备注/宿舍/代客信息/取件码类/截图引用 + P1 认领字段
function anonymizedPatch(order, nowDate) {
  const parcel = order.parcel || {};
  const image = order.image || {};
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
    // cleanedAt 已被截图清理/注销链路写过时必须保留（api order.get 的 cleaned 判据）
    image: { fileId: '', width: 0, height: 0, failureId: '', cleanedAt: image.cleanedAt || null },
    claimTokenHash: '',
    claimExpiresAt: null,
    claimedAt: null,
    anonymizedAt: nowDate,
    updatedAt: nowDate,
    version: (order.version || 1) + 1
  };
}

async function anonymizeOrder(ctx, order) {
  const C = util.collectionsOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  const image = order.image || {};
  const fileId = typeof image.fileId === 'string' ? image.fileId : '';
  await ctx.dao.update(C.ORDERS, order._id, anonymizedPatch(order, nowDate));
  if (fileId) {
    await util.deleteFileIfUnreferenced(ctx, fileId);
  }
  const messages = await ctx.dao.find(C.ORDER_MESSAGES, { where: { orderId: order._id }, limit: util.BATCH });
  for (let i = 0; i < messages.length; i += 1) {
    await ctx.dao.update(C.ORDER_MESSAGES, messages[i]._id, { text: '[已删除]', fromId: '' });
  }
  const events = await ctx.dao.find(C.ORDER_EVENTS, { where: { orderId: order._id }, limit: util.BATCH });
  for (let i = 0; i < events.length; i += 1) {
    await ctx.dao.update(C.ORDER_EVENTS, events[i]._id, { actorId: '', payload: {} });
  }
}

function whereExists(ctx, base, field, exists) {
  const command = util.commandOf(ctx);
  if (command && typeof command.exists === 'function') {
    const cond = Object.assign({}, base);
    cond[field] = command.exists(exists);
    return cond;
  }
  return Object.assign({}, base);
}

// ① 匿名化：终态且无 anonymizedAt 且超 180 天
async function anonymizePass(ctx, collected) {
  const C = util.collectionsOf(ctx);
  const deadline = util.daysBefore(ctx.now, ANONYMIZE_DAYS);
  for (let s = 0; s < TERMINAL_STATUSES.length; s += 1) {
    const rows = await util.scanPage(ctx, C.ORDERS, whereExists(ctx, { status: TERMINAL_STATUSES[s] }, 'anonymizedAt', false),
      [['statusUpdatedAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const order = rows[i];
      if (order.anonymizedAt || util.msOf(order.statusUpdatedAt) >= deadline) {
        continue;
      }
      collected.scanned += 1;
      try {
        await anonymizeOrder(ctx, order);
        collected.acted += 1;
      } catch (error) {
        collected.failed += 1;
      }
    }
  }
}

// ② 物理删：匿名化满 30 天
async function purgeAnonymizedPass(ctx, collected) {
  const C = util.collectionsOf(ctx);
  const deadline = util.daysBefore(ctx.now, PURGE_AFTER_ANONYMIZE_DAYS);
  for (let s = 0; s < TERMINAL_STATUSES.length; s += 1) {
    const rows = await util.scanPage(ctx, C.ORDERS, whereExists(ctx, { status: TERMINAL_STATUSES[s] }, 'anonymizedAt', true),
      [['anonymizedAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const order = rows[i];
      const anonymizedAt = util.msOf(order.anonymizedAt);
      if (!anonymizedAt || anonymizedAt >= deadline) {
        continue;
      }
      collected.scanned += 1;
      try {
        if (order.image && order.image.fileId) {
          await util.clearOrderImage(ctx, order);
        }
        await util.removeOrderCascade(ctx, order);
        collected.acted += 1;
      } catch (error) {
        collected.failed += 1;
      }
    }
  }
}

// ③ 物理删：顾客"删除记录"（软删）满 7 天
async function purgeSoftDeletedPass(ctx, collected) {
  const C = util.collectionsOf(ctx);
  const deadline = util.daysBefore(ctx.now, PURGE_AFTER_DELETE_DAYS);
  const rows = await util.scanPage(ctx, C.ORDERS, whereExists(ctx, {}, 'deletedByCustomerAt', true),
    [['deletedByCustomerAt', 'asc']]);
  for (let i = 0; i < rows.length; i += 1) {
    const order = rows[i];
    const deletedAt = util.msOf(order.deletedByCustomerAt);
    if (!deletedAt || deletedAt >= deadline) {
      continue;
    }
    collected.scanned += 1;
    try {
      if (order.image && order.image.fileId) {
        await util.clearOrderImage(ctx, order);
      }
      await util.removeOrderCascade(ctx, order);
      collected.acted += 1;
    } catch (error) {
      collected.failed += 1;
    }
  }
}

async function runRetention(ctx) {
  const collected = { scanned: 0, acted: 0, failed: 0 };
  await anonymizePass(ctx, collected);
  await purgeAnonymizedPass(ctx, collected);
  await purgeSoftDeletedPass(ctx, collected);
  return collected;
}

module.exports = {
  ANONYMIZE_DAYS,
  PURGE_AFTER_ANONYMIZE_DAYS,
  PURGE_AFTER_DELETE_DAYS,
  anonymizeOrder,
  runRetention
};
