// cloudfunctions/cleanup/sweeps/storage.js · 截图文件引用计数清理 + 过期上传票据清理（批 100）
// 口径：ENGINEERING §4.7 files/tickets；DATA_MODEL §10.1/§10.2 步骤 3/4。
//   files：终态超 screenshotRetentionDays（默认 7）→ 清订单截图引用（写 image.cleanedAt）→ 引用计数归零删云文件；
//          查询必须带 image.fileId 非空条件，否则已清引用的旧单占满批 100 导致后面的截图永不清理（隐私留存超标）。
//   tickets：过期（expiresAt+24h 宽限）票据一律删（usedAt 不区分——已消费票据同样到期清理，否则无限堆积）；
//          purpose 不区分（TICKET/AVATAR 同一 TTL 规则）。
'use strict';

const util = require('./_util');

const TERMINAL_STATUSES = [util.enums.ORDER_STATUS.COMPLETED, util.enums.ORDER_STATUS.CANCELLED];

function imageFileWhere(ctx, status) {
  const command = util.commandOf(ctx);
  if (command && typeof command.gt === 'function') {
    return { status, 'image.fileId': command.gt('') };
  }
  return { status };
}

async function runFiles(ctx) {
  const C = util.collectionsOf(ctx);
  const retentionDays = util.numberConfig(ctx.config, 'screenshotRetentionDays', 7);
  const deadline = util.daysBefore(ctx.now, retentionDays);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let s = 0; s < TERMINAL_STATUSES.length; s += 1) {
    const rows = await util.scanPage(ctx, C.ORDERS, imageFileWhere(ctx, TERMINAL_STATUSES[s]),
      [['statusUpdatedAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const order = rows[i];
      const image = order.image || {};
      const fileId = typeof image.fileId === 'string' ? image.fileId : '';
      if (!fileId || util.msOf(order.statusUpdatedAt) >= deadline) {
        continue;
      }
      scanned += 1;
      try {
        await util.clearOrderImage(ctx, order);
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
  // 宽限 24h：给"上传成功但单据事务仍在提交中"的最后机会；到期后不再区分是否已消费。
  const graceDeadline = util.hoursBefore(ctx.now, 24);
  const rows = await util.scanPage(ctx, C.UPLOAD_TICKETS, {}, [['expiresAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const ticket = rows[i];
    const expiresAt = util.msOf(ticket.expiresAt);
    if (!expiresAt || expiresAt >= graceDeadline) {
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
  return { scanned, acted, failed };
}

module.exports = {
  runFiles,
  runTickets
};
