// cloudfunctions/cleanup/sweeps/stats.js · 重算 partners.stats（只含单量，无任何交易字段）
// 口径：ENGINEERING §4.7 recomputeStats；DATA_MODEL §2.3/§5.2。stats 只是可重算缓存，真值=orders 查询。
'use strict';

const util = require('./_util');

async function runRecomputeStats(ctx) {
  const C = util.collectionsOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  const todayStart = ctx.now - ((ctx.now + 8 * util.HOUR_MS) % util.DAY_MS);
  const partners = await ctx.dao.find(C.PARTNERS, { orderBy: [['updatedAt', 'asc']], limit: util.BATCH });
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < partners.length; i += 1) {
    const partner = partners[i];
    scanned += 1;
    try {
      const statuses = util.enums.ORDER_STATUS_LIST;
      const counts = {};
      for (let s = 0; s < statuses.length; s += 1) {
        counts[statuses[s]] = await ctx.dao.count(C.ORDERS, {
          where: { partnerId: partner._id, status: statuses[s], isTest: false }
        });
      }
      const completedRows = await ctx.dao.find(C.ORDERS, {
        where: { partnerId: partner._id, status: util.enums.ORDER_STATUS.COMPLETED, isTest: false },
        orderBy: [['completedAt', 'desc']],
        limit: util.BATCH
      });
      const todayOrders = completedRows.filter((order) => util.msOf(order.completedAt) >= todayStart).length;
      const activeOrders = counts[util.enums.ORDER_STATUS.SUBMITTED]
        + counts[util.enums.ORDER_STATUS.ACCEPTED]
        + counts[util.enums.ORDER_STATUS.PICKED]
        + counts[util.enums.ORDER_STATUS.DELIVERED]
        + counts[util.enums.ORDER_STATUS.EXCEPTION];
      await ctx.dao.update(C.PARTNERS, partner._id, {
        stats: {
          totalOrders: statuses.reduce((sum, status) => sum + counts[status], 0),
          activeOrders,
          completedOrders: counts[util.enums.ORDER_STATUS.COMPLETED],
          cancelledOrders: counts[util.enums.ORDER_STATUS.CANCELLED],
          todayOrders,
          updatedAt: nowDate
        },
        updatedAt: nowDate
      });
      acted += 1;
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  runRecomputeStats
};
