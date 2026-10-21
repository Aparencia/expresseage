// cloudfunctions/cleanup/sweeps/recognitionFailures.js · 识别失败记录到期清理（删原图引用并置 IGNORED/EXPIRED）
// 口径：ENGINEERING §4.7 recognitionFailures；DATA_MODEL §10.1/§2.14。文件引用计数归零才删云文件。
'use strict';

const util = require('./_util');

const DEFAULT_RETENTION_DAYS = 30;

function fileStillReferenced(ctx, fileId) {
  return (async () => {
    const C = util.collectionsOf(ctx);
    const failures = await ctx.dao.count(C.RECOGNITION_FAILURES, { where: { fileId } });
    const orders = await ctx.dao.count(C.ORDERS, { where: { 'image.fileId': fileId } });
    return failures > 0 || orders > 0;
  })();
}

async function runRecognitionFailures(ctx) {
  const C = util.collectionsOf(ctx);
  const defaultDays = util.numberConfig(ctx.config, 'recognitionFailureRetentionDays', DEFAULT_RETENTION_DAYS);
  const rows = await util.scanPage(
    ctx,
    C.RECOGNITION_FAILURES,
    { status: util.enums.FAILURE_STATUS.PENDING },
    [['createdAt', 'asc']]
  );
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const record = rows[i];
    const retentionDays = typeof record.retentionDays === 'number' && record.retentionDays >= 7
      ? record.retentionDays
      : defaultDays;
    const deadline = util.daysBefore(ctx.now, retentionDays);
    if (util.msOf(record.createdAt) >= deadline) {
      continue;
    }
    scanned += 1;
    const nowDate = util.nowDateOf(ctx);
    try {
      const fileId = typeof record.fileId === 'string' ? record.fileId : '';
      await ctx.dao.update(C.RECOGNITION_FAILURES, record._id, {
        status: util.enums.FAILURE_STATUS.IGNORED,
        resolution: {
          stationId: '',
          stationName: '',
          pickupCode: '',
          note: 'EXPIRED',
          by: util.SYSTEM,
          at: nowDate
        },
        reviewedAt: nowDate,
        fileId: ''
      });
      if (fileId && !(await fileStillReferenced(ctx, fileId))) {
        await util.deleteFileSafe(ctx, fileId);
      }
      acted += 1;
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  runRecognitionFailures
};
