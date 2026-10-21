// cloudfunctions/cleanup/sweeps/accounts.js · 注销账号 30 天物理删除 + 测试账号级联删除兜底
// 口径：DATA_MODEL §10.4 / ENGINEERING §4.7 accountDeletion、§4.11.3；级联范围见 §4.11.1。
'use strict';

const util = require('./_util');

const DELETION_DAYS = 30;

async function endSessionsOfTarget(ctx, targetId) {
  const C = util.collectionsOf(ctx);
  const rows = await ctx.dao.find(C.ADMIN_VIEW_SESSIONS, {
    where: { targetId, endedAt: null },
    limit: util.BATCH
  });
  const nowDate = util.nowDateOf(ctx);
  for (let i = 0; i < rows.length; i += 1) {
    await ctx.dao.update(C.ADMIN_VIEW_SESSIONS, rows[i]._id, { endedAt: nowDate, updatedAt: nowDate });
  }
  return rows.length;
}

async function deleteAccount(ctx, user) {
  const C = util.collectionsOf(ctx);
  const openid = user._id;
  const customer = await ctx.dao.get(C.CUSTOMERS, openid);
  const avatarFileId = customer && customer.avatarFileId ? customer.avatarFileId : '';
  await ctx.dao.removeWhere(C.BINDINGS, { customerId: openid });
  await ctx.dao.removeWhere(C.UPLOAD_TICKETS, { openid });
  await ctx.dao.remove(C.CUSTOMERS, openid);
  await ctx.dao.updateWhere(C.RECOGNITION_FAILURES, { uploaderOpenid: openid }, { uploaderOpenid: '' });
  await endSessionsOfTarget(ctx, openid);
  await ctx.dao.remove(C.USERS, openid);
  if (avatarFileId) {
    await util.deleteFileSafe(ctx, avatarFileId);
  }
}

async function runAccountDeletion(ctx) {
  const C = util.collectionsOf(ctx);
  const deadline = util.daysBefore(ctx.now, DELETION_DAYS);
  const rows = await util.scanPage(ctx, C.USERS, { status: 'DEACTIVATED' }, [['deletionRequestedAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const user = rows[i];
    const requestedAt = util.msOf(user.deletionRequestedAt);
    if (!requestedAt || requestedAt >= deadline) {
      continue;
    }
    scanned += 1;
    try {
      await deleteAccount(ctx, user);
      acted += 1;
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

// 测试账号删除由 admin.deleteTestAccount 同步级联完成，不落"待删标记"；
// 本 sweep 仅兜底清理删除过程中断留下的孤儿测试数据（头像文件已无账号引用时删除）。
async function runTestAccountsDeletion(ctx) {
  const C = util.collectionsOf(ctx);
  const rows = await util.scanPage(ctx, C.CUSTOMERS, {}, [['updatedAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const customer = rows[i];
    if (!customer || typeof customer._id !== 'string' || customer._id.indexOf('TEST-') !== 0) {
      continue;
    }
    scanned += 1;
    try {
      const user = await ctx.dao.get(C.USERS, customer._id);
      if (!user || user.isTestAccount !== true) {
        await ctx.dao.removeWhere(C.ORDERS, { customerId: customer._id, isTest: true });
        await ctx.dao.remove(C.CUSTOMERS, customer._id);
        acted += 1;
      }
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  DELETION_DAYS,
  runAccountDeletion,
  runTestAccountsDeletion
};
