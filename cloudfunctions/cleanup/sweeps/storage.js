// cloudfunctions/cleanup/sweeps/storage.js · 截图/头像文件引用计数清理 + 过期上传票据清理（批 100）
// 口径：ENGINEERING §4.7 files/tickets；同一 fileId 被多单/识别失败记录共享时，全部引用都过期才删文件。
'use strict';

const util = require('./_util');

const TERMINAL_STATUSES = [util.enums.ORDER_STATUS.COMPLETED, util.enums.ORDER_STATUS.CANCELLED];

async function countFileRefs(ctx, fileId) {
  const C = util.collectionsOf(ctx);
  const orders = await ctx.dao.find(C.ORDERS, { where: { 'image.fileId': fileId }, limit: 1 });
  const failures = await ctx.dao.count(C.RECOGNITION_FAILURES, { where: { fileId } });
  return { orders: orders.length, failures };
}

async function runFiles(ctx) {
  const C = util.collectionsOf(ctx);
  const retentionDays = util.numberConfig(ctx.config, 'screenshotRetentionDays', 7);
  const deadline = util.daysBefore(ctx.now, retentionDays);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let s = 0; s < TERMINAL_STATUSES.length; s += 1) {
    const rows = await util.scanPage(ctx, C.ORDERS, { status: TERMINAL_STATUSES[s] }, [['statusUpdatedAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const order = rows[i];
      const image = order.image || {};
      const fileId = typeof image.fileId === 'string' ? image.fileId : '';
      if (!fileId || util.msOf(order.statusUpdatedAt) >= deadline) {
        continue;
      }
      scanned += 1;
      try {
        await ctx.dao.update(C.ORDERS, order._id, {
          image: { fileId: '', width: 0, height: 0, failureId: '' },
          updatedAt: util.nowDateOf(ctx)
        });
        const refs = await countFileRefs(ctx, fileId);
        if (refs.orders === 0 && refs.failures === 0) {
          await util.deleteFileSafe(ctx, fileId);
        }
        acted += 1;
      } catch (error) {
        failed += 1;
      }
    }
  }
  return { scanned, acted, failed };
}

async function runTickets(ctx) {
  const C = util.collectionsOf(ctx);
  const graceDeadline = util.daysBefore(ctx.now, 0) - 24 * util.HOUR_MS;
  const purposes = [util.enums.UPLOAD_PURPOSE.TICKET, util.enums.UPLOAD_PURPOSE.AVATAR];
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let p = 0; p < purposes.length; p += 1) {
    const rows = await util.scanPage(ctx, C.UPLOAD_TICKETS, { purpose: purposes[p] }, [['expiresAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const ticket = rows[i];
      const expiresAt = util.msOf(ticket.expiresAt);
      if (ticket.usedAt || !expiresAt || expiresAt >= graceDeadline) {
        continue;
      }
      scanned += 1;
      try {
        await ctx.dao.remove(C.UPLOAD_TICKETS, ticket._id);
        acted += 1;
      } catch (error) {
        failed += 1;
      }
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  runFiles,
  runTickets
};
