// cloudfunctions/cleanup/sweeps/storage.js · 截图文件引用计数清理 + 过期上传票据清理（批 100）
// 口径：ENGINEERING §4.7 files/tickets；DATA_MODEL §10.1/§10.2 步骤 3/4（v1.0/D23：images[] 0~5 张逐张清）。
//   files：终态超 screenshotRetentionDays（默认 7）→ 逐张清订单截图引用（images[].cleanedAt）→ 引用计数归零删云文件；
//          历史单 image{} 与 v1.0 images[] 同一口径；manualEntry 无截图单不命中；
//          查询必须带"仍有 fileId 非空"条件（逐下标），否则已清引用的旧单占满批 100 导致后面的截图永不清理（隐私留存超标）。
//   tickets：过期（expiresAt+24h 宽限）票据一律删（usedAt 不区分——已消费票据同样到期清理，否则无限堆积）；
//          purpose 不区分（TICKET/AVATAR 同一 TTL 规则）。
'use strict';

const util = require('./_util');

const TERMINAL_STATUSES = [util.enums.ORDER_STATUS.COMPLETED, util.enums.ORDER_STATUS.CANCELLED];

// 到期扫描条件（v1.0 逐张）：历史 image.fileId 非空 + images[i].fileId 非空（数组子元素无通配点查 → 逐下标）。
// 查询必须带"还有未清引用"条件，否则已清引用的旧单占满批 100 导致后面的截图永不清理（隐私留存超标）。
// manualEntry 无截图单不带 fileId，各条件天然不命中（DATA_MODEL §10.2 步骤 4）。
function fileWheresOf(ctx, status) {
  const command = util.commandOf(ctx);
  const legacy = { status: status };
  const wheres = [legacy];
  if (!command || typeof command.gt !== 'function') {
    return wheres; // 注入替身不支持指令时退化为单批（旧行为）
  }
  legacy['image.fileId'] = command.gt('');
  for (let i = 0; i < util.IMAGE_INDEX_SLOTS; i += 1) {
    const cond = { status: status };
    cond['images.' + i + '.fileId'] = command.gt('');
    wheres.push(cond);
  }
  return wheres;
}

async function runFiles(ctx) {
  const C = util.collectionsOf(ctx);
  const retentionDays = util.numberConfig(ctx.config, 'screenshotRetentionDays', 7);
  const deadline = util.daysBefore(ctx.now, retentionDays);
  const seen = {};
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let s = 0; s < TERMINAL_STATUSES.length; s += 1) {
    const wheres = fileWheresOf(ctx, TERMINAL_STATUSES[s]);
    for (let w = 0; w < wheres.length; w += 1) {
      const rows = await util.scanPage(ctx, C.ORDERS, wheres[w], [['statusUpdatedAt', 'asc']]);
      for (let i = 0; i < rows.length; i += 1) {
        const order = rows[i];
        if (seen[order._id] || util.msOf(order.statusUpdatedAt) >= deadline) {
          continue;
        }
        if (util.imageFileIdsOf(order).length === 0) {
          continue;
        }
        seen[order._id] = true;
        scanned += 1;
        try {
          const cleared = await util.clearOrderImages(ctx, order);
          if (cleared.cleared > 0) {
            acted += 1;
          }
        } catch (error) {
          failed += 1;
        }
      }
    }
  }
  return { scanned: scanned, acted: acted, failed: failed };
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
