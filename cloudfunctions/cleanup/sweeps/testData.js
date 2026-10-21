// cloudfunctions/cleanup/sweeps/testData.js · 超期未使用测试账号的业务数据清理（账号保留、审计摘要保留）
// 口径：ENGINEERING §4.7 testData / §4.11.3；DATA_MODEL §10.2 步骤 10。每轮最多 6 个测试账号，幂等可重跑。
// 幂等：数据已清空（各集合计数全 0）时不再写审计、不再计 acted —— 重跑 acted 收敛为 0，审计不重复。
'use strict';

const util = require('./_util');

const DEFAULT_RETENTION_DAYS = 30;
const MAX_ACCOUNTS_PER_RUN = 6;

async function testDataOf(ctx, user) {
  const C = util.collectionsOf(ctx);
  const openid = user._id;
  const orders = await ctx.dao.find(C.ORDERS, { where: { customerId: openid, isTest: true }, limit: util.BATCH });
  const partner = await ctx.dao.findOne(C.PARTNERS, { where: { openid } });
  let partnerOrders = [];
  if (partner) {
    partnerOrders = await ctx.dao.find(C.ORDERS, { where: { partnerId: partner._id, isTest: true }, limit: util.BATCH });
  }
  const bindings = await ctx.dao.find(C.BINDINGS, { where: { customerId: openid }, limit: util.BATCH });
  const failures = await ctx.dao.find(C.RECOGNITION_FAILURES, { where: { uploaderOpenid: openid }, limit: util.BATCH });
  const customer = await ctx.dao.get(C.CUSTOMERS, openid);
  return { openid, orders, partnerOrders, bindings, failures, partner, customer };
}

async function purgeAccountData(ctx, data) {
  const C = util.collectionsOf(ctx);
  let orders = 0;
  let events = 0;
  let messages = 0;
  const seen = {};
  const allOrders = data.orders.concat(data.partnerOrders);
  for (let i = 0; i < allOrders.length; i += 1) {
    const order = allOrders[i];
    if (seen[order._id]) {
      continue;
    }
    seen[order._id] = true;
    const eventResult = await ctx.dao.removeWhere(C.ORDER_EVENTS, { orderId: order._id });
    const messageResult = await ctx.dao.removeWhere(C.ORDER_MESSAGES, { orderId: order._id });
    const orderResult = await ctx.dao.remove(C.ORDERS, order._id);
    events += eventResult.removed;
    messages += messageResult.removed;
    orders += orderResult.removed;
  }
  for (let i = 0; i < data.bindings.length; i += 1) {
    await ctx.dao.remove(C.BINDINGS, data.bindings[i]._id);
  }
  for (let i = 0; i < data.failures.length; i += 1) {
    const fileId = data.failures[i].fileId;
    await ctx.dao.remove(C.RECOGNITION_FAILURES, data.failures[i]._id);
    if (fileId) {
      await util.deleteFileSafe(ctx, fileId);
    }
  }
  const files = [];
  if (data.customer && data.customer.avatarFileId) {
    files.push(data.customer.avatarFileId);
    await ctx.dao.update(C.CUSTOMERS, data.customer._id, { avatarFileId: '' });
  }
  if (data.partner && data.partner.avatarFileId) {
    files.push(data.partner.avatarFileId);
    await ctx.dao.update(C.PARTNERS, data.partner._id, { avatarFileId: '' });
  }
  for (let i = 0; i < files.length; i += 1) {
    await util.deleteFileSafe(ctx, files[i]);
  }
  const ticketResult = await ctx.dao.removeWhere(C.UPLOAD_TICKETS, { openid: data.openid });
  return {
    orders,
    events,
    messages,
    bindings: data.bindings.length,
    failures: data.failures.length,
    tickets: ticketResult.removed,
    avatarFiles: files.length
  };
}

function totalOf(counts) {
  return Object.keys(counts).reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);
}

async function runTestData(ctx) {
  const C = util.collectionsOf(ctx);
  const retentionDays = util.numberConfig(ctx.config, 'testDataRetentionDays', DEFAULT_RETENTION_DAYS, 7, 90);
  const deadline = util.daysBefore(ctx.now, retentionDays);
  const rows = await util.scanPage(ctx, C.USERS, { isTestAccount: true }, [['createdAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  let accounts = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const user = rows[i];
    const lastUsed = util.msOf(user.testLastUsedAt) || util.msOf(user.createdAt);
    if (lastUsed >= deadline) {
      continue;
    }
    scanned += 1;
    if (accounts >= MAX_ACCOUNTS_PER_RUN) {
      break;
    }
    try {
      const data = await testDataOf(ctx, user);
      const counts = await purgeAccountData(ctx, data);
      if (totalOf(counts) === 0) {
        // 数据早已清空：无副作用，不写审计、不计 acted（重跑幂等）
        continue;
      }
      accounts += 1;
      const dayBucket = Math.floor(ctx.now / util.DAY_MS);
      const requestKey = 'cleanup-testData:' + String(user._id) + ':' + dayBucket;
      await util.writeAuditOnce(ctx, util.auditDoc(
        ctx,
        'CLEANUP',
        { type: 'test_account', id: String(user._id) },
        { sweep: 'testData', accountId: String(user._id), counts },
        requestKey
      ));
      acted += 1;
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  MAX_ACCOUNTS_PER_RUN,
  runTestData
};
