// handlers/order/_list-merged.js · D99 已转出并入工作台首屏（counts 并集；不并入游标分页）
// 口径：CONTRACT §13 D99（修订 D95 ①）——首屏有界扫描 ≤100，行按 PARTNER 视角正常 DTO（D85 双人可控），
//       行加只读标记 handover=true；counts 六个桶按订单当前状态各 +1（一次扫描内存 tally，不再发 6 次 count）。
// D103（2026-11-26 用户指令）：取件清单传 excludeHandover=true 时**只计 counts、不把已转出行并入列表**，
//       由「转出单」页单独展示；工作台不传，行为保持 D99 不变（计数不变）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderView = require('../../shared/order-view');
const common = require('./_common');
const transfer = require('./_transfer');
const handover = require('./_handover');
const dto = require('./_dto');

const MERGE_VIEWS = ['workbench', 'day'];
const MAX_MERGED_SCAN = 100;

async function handoverOrdersOf(ctx, partner, options) {
  const opts = options || {};
  const where = {
    'transfer.fromPartnerId': partner._id,
    'transfer.status': enums.TRANSFER_STATUS.ACCEPTED,
    isTest: common.isTestSession(ctx)
  };
  if (Array.isArray(opts.statuses) && opts.statuses.length) {
    where.status = ctx.dao.command('in', opts.statuses);
  } else {
    where.status = ctx.dao.command('in', handover.TRACKABLE_STATUSES);
  }
  if (opts.dayStartMs > 0) {
    where.statusUpdatedAt = ctx.dao.command('gte', new Date(opts.dayStartMs));
  }
  const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
    where: where,
    orderBy: [['statusUpdatedAt', 'desc'], ['orderNo', 'desc']],
    limit: MAX_MERGED_SCAN
  });
  return rows.filter((row) => handover.isInitiatorOf(row, partner._id));
}

// counts 并集：每个已转出单按当前状态归桶（一次扫描；未知桶忽略）。
function tallyOf(rows, counts) {
  const next = Object.assign({}, counts);
  rows.forEach((order) => {
    const bucket = orderView.bucketOf(order.status);
    if (typeof next[bucket] === 'number') {
      next[bucket] += 1;
    }
  });
  return next;
}

/**
 * 主列表收口：workbench/day 首屏并入「已转出」行，再走既有 summary 附加。
 * params = { ctx, partner, view, paging, result, body, nowMs, attach, excludeHandover }
 */
async function finalize(params) {
  const body = params.body;
  if (MERGE_VIEWS.indexOf(params.view) >= 0 && !(params.paging && params.paging.cursor)) {
    // D99 修订（2026-11-23 真机回归）：并入行必须与当前筛选/今日窗口同口径，否则历史已完成转出单会
    // 混进任意状态 chip 与「全部=今日流水」，并把真正的待接单新单挤出首屏。
    const rows = await handoverOrdersOf(params.ctx, params.partner, {
      statuses: params.statuses,
      dayStartMs: params.dayStartMs || 0
    });
    if (rows.length) {
      // D103：counts 始终按并集口径（计数不变）；excludeHandover 只影响列表行。
      body.counts = tallyOf(rows, body.counts);
      body.handoverMerged = rows.length;
      if (params.excludeHandover !== true) {
        const merged = await dto.buildOrderDtos(params.ctx, rows, 'PARTNER', { withActions: true });
        merged.forEach((row) => {
          row.handover = true;
          // day 视图与主查询同口径：今日流水不显示写操作（已转出单同样只读展示）
          if (params.view === 'day') {
            row.actions = [];
          }
        });
        body.list = merged.concat(body.list);
      } else {
        body.handoverHidden = rows.length;
      }
    }
  }
  return params.attach(body, params.view, params.result, params.nowMs);
}

module.exports = {
  MERGE_VIEWS,
  MAX_MERGED_SCAN,
  handoverOrdersOf,
  tallyOf,
  finalize
};
