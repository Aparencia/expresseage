// cloudfunctions/cleanup/sweeps/counters.js · 清理过期限流计数（counters.rl:*；窗口 2 天内有效）
// 口径：ENGINEERING §4.7 rateLimits；counters 三键族只清 rl: 前缀，orderNo/tag 序号永远保留。
'use strict';

const util = require('./_util');

const RATE_LIMIT_PREFIX = 'rl:';
const KEEP_MS = 2 * util.DAY_MS;

async function runRateLimits(ctx) {
  const C = util.collectionsOf(ctx);
  const rows = await ctx.dao.find(C.COUNTERS, {
    orderBy: [['updatedAt', 'asc']],
    limit: util.BATCH * 3
  });
  const deadline = ctx.now - KEEP_MS;
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const key = typeof row.key === 'string' ? row.key : '';
    if (key.indexOf(RATE_LIMIT_PREFIX) !== 0) {
      continue;
    }
    if (util.msOf(row.updatedAt) >= deadline) {
      continue;
    }
    scanned += 1;
    try {
      await ctx.dao.remove(C.COUNTERS, row._id);
      acted += 1;
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  RATE_LIMIT_PREFIX,
  runRateLimits
};
