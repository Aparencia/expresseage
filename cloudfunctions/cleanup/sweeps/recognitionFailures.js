// cloudfunctions/cleanup/sweeps/recognitionFailures.js · 识别失败记录到期清理（删原图引用并置 IGNORED/EXPIRED）
// 口径：ENGINEERING §4.7 recognitionFailures（到期条件 = createdAt 超 retentionDays 且 status≠FIXED）；
//       DATA_MODEL §2.14/§10.1/§10.3。
//   - 到期：删原图引用（引用计数 0 才删云文件）→ PENDING 置 IGNORED + resolution.note='EXPIRED'
//     + reviewedAt=now；IGNORED 只清原图引用（保留人工忽略的 note，禁止覆盖）；
//   - 上传者已注销（uploaderOpenid=''）：记录已匿名化，按 §10.3 保留至到期后物理删（ocrTextMasked 不再留）。
'use strict';

const util = require('./_util');

const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 30;

function retentionOf(config) {
  return util.numberConfig(config, 'recognitionFailureRetentionDays', DEFAULT_RETENTION_DAYS,
    MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
}

function recordRetentionOf(record, fallback) {
  const raw = record && record.retentionDays;
  if (typeof raw === 'number' && isFinite(raw)) {
    return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(raw)));
  }
  return fallback;
}

function isDue(record, nowMs, fallbackDays) {
  const retentionDays = recordRetentionOf(record, fallbackDays);
  return util.msOf(record.createdAt) < util.daysBefore(nowMs, retentionDays);
}

async function dropImageRef(ctx, fileId) {
  if (typeof fileId === 'string' && fileId !== '') {
    await util.deleteFileIfUnreferenced(ctx, fileId);
  }
}

// ① 上传者注销后的匿名记录：到期物理删
async function anonymizedPass(ctx, counters, defaultDays) {
  const C = util.collectionsOf(ctx);
  const rows = await util.scanPage(ctx, C.RECOGNITION_FAILURES, { uploaderOpenid: '' }, [['createdAt', 'asc']]);
  for (let i = 0; i < rows.length; i += 1) {
    const record = rows[i];
    if (!isDue(record, ctx.now, defaultDays)) {
      continue;
    }
    counters.scanned += 1;
    try {
      // 先清本记录引用再计数（本记录不能把自己算成引用者），最后物理删文档
      await ctx.dao.update(C.RECOGNITION_FAILURES, record._id, { fileId: '', updatedAt: util.nowDateOf(ctx) });
      await dropImageRef(ctx, record.fileId);
      await ctx.dao.remove(C.RECOGNITION_FAILURES, record._id);
      counters.acted += 1;
    } catch (error) {
      counters.failed += 1;
    }
  }
}

// ② 未匿名记录（IGNORED/PENDING）：到期删原图引用；PENDING 置 IGNORED(EXPIRED)
//    先处理已 IGNORED（人工忽略），再处理 PENDING；同一轮被置 IGNORED 的记录不会在本轮被二次处理。
async function activePass(ctx, counters, defaultDays) {
  const C = util.collectionsOf(ctx);
  const statuses = [util.enums.FAILURE_STATUS.IGNORED, util.enums.FAILURE_STATUS.PENDING];
  const command = util.commandOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  for (let s = 0; s < statuses.length; s += 1) {
    const where = { status: statuses[s] };
    if (command && typeof command.neq === 'function') {
      where.uploaderOpenid = command.neq('');
    }
    const rows = await util.scanPage(ctx, C.RECOGNITION_FAILURES, where, [['createdAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const record = rows[i];
      const fileId = typeof record.fileId === 'string' ? record.fileId : '';
      if (record.uploaderOpenid === '' || !isDue(record, ctx.now, defaultDays)) {
        continue;
      }
      // 已人工忽略且原图引用已清：到期后无剩余动作，重跑不得重复计 acted
      if (record.status === util.enums.FAILURE_STATUS.IGNORED && fileId === '') {
        continue;
      }
      counters.scanned += 1;
      try {
        const patch = { fileId: '', updatedAt: nowDate };
        if (record.status === util.enums.FAILURE_STATUS.PENDING) {
          patch.status = util.enums.FAILURE_STATUS.IGNORED;
          patch.resolution = {
            stationId: '',
            stationName: '',
            pickupCode: '',
            note: 'EXPIRED',
            by: util.SYSTEM,
            at: nowDate
          };
          patch.reviewedAt = nowDate;
        }
        await ctx.dao.update(C.RECOGNITION_FAILURES, record._id, patch);
        await dropImageRef(ctx, fileId);
        counters.acted += 1;
      } catch (error) {
        counters.failed += 1;
      }
    }
  }
}

async function runRecognitionFailures(ctx) {
  const defaultDays = retentionOf(ctx.config);
  const counters = { scanned: 0, acted: 0, failed: 0 };
  await anonymizedPass(ctx, counters, defaultDays);
  await activePass(ctx, counters, defaultDays);
  return counters;
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  runRecognitionFailures
};
