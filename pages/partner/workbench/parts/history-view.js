// pages/partner/workbench/parts/history-view.js · 已完结自然日分区纯件（零 wx）
// 口径：CONTRACT §13 D45（M1）+ UX_PARTNER §4.10——已完结区（COMPLETED/CANCELLED）按订单 `createdAt`
//       （UTC+8 自然日）分「昨天/更早」；`completedAt`/`cancelledAt` 只做行为与统计展示，不当分区锚。
//       批 20（D53）：已完结区只放「昨日及更早」——今天完成/取消的单只出现在「全部」今日流水；
//       折叠入口「已完结 · 昨日及更早 N 单 >」，「更早还有更多单 >」按服务端游标继续翻页（单窗口）。
// 说明：listPartner 的 history 视图不计入 counts（P0-2/TD-073；响应仍回零值模板、页面不消费，
//       只有 workbench/day 视图算 6 个 count）。
'use strict';

const groupView = require('./group-view');
const filterView = require('./filter-view');
const dayView = require('./day-view');

// 日界/日键/分节单源在 parts/day-view.js（UTC+8 自然日只此一处）；本文件只转发与算窗口
const TZ_OFFSET_MS = dayView.TZ_OFFSET_MS;
const DAY_MS = dayView.DAY_MS;
const HISTORY_LIMIT = 30;

function dayStartMs(nowMs) {
  return dayView.dayStartMs(nowMs);
}

function yesterdayStartMs(nowMs) {
  return dayView.yesterdayStartMs(nowMs);
}

// 已完结窗口上界：今日 0 点 − 1ms（UTC+8）——只含昨日及更早；今天完成单只在「全部」今日流水（D53）
function historyToMs(nowMs) {
  return dayStartMs(nowMs) - 1;
}

// 折叠入口摘要 / 展开首屏：昨日及更早第一页（hasMore 由服务端 nextCursor 如实表达）
function historyQueryOf(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return { view: 'history', to: historyToMs(now), limit: HISTORY_LIMIT };
}

function summaryQuery(nowMs) {
  return historyQueryOf(nowMs);
}

// P0-2/TD-073：工作台每一次 onShow 都会先拉主列表（counts 六项随响应更新），历史摘要只在
// 「没拉过 / 请求在途 / 显式刷新 / 筛选变了 / 今日计数版本变了」时才需要再发 1 次 history 调用。
// counts 版本 = 六项逐值指纹（不用时间戳，避免每次 onShow 都判成脏）。
function countsFingerprintOf(counts) {
  const input = counts || {};
  const keys = ['submitted', 'accepted', 'picked', 'delivered', 'exception', 'todayCompleted'];
  return keys.map(function valueOf(key) {
    const value = Number(input[key]);
    return isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }).join(',');
}

// 历史摘要调用计划（进工作台一次的计划云调用数 = 主列表 1 + 摘要 0/1）。
// 判等：同筛选 + 同 counts 版本 + 无显式脏标记 + 无在途请求 → 摘要 0 次（TD-073 去重）。
function summaryCallPlan(state) {
  const current = state || {};
  if (current.pending === true) {
    return { call: false, reason: 'pending', calls: 1 };
  }
  if (current.dirty === true) {
    return { call: true, reason: 'dirty', calls: 2 };
  }
  if (current.hasSummary !== true) {
    return { call: true, reason: 'cold', calls: 2 };
  }
  if (current.filter !== current.lastFilter) {
    return { call: true, reason: 'filter', calls: 2 };
  }
  if (current.countsVersion !== current.lastCountsVersion) {
    return { call: true, reason: 'counts', calls: 2 };
  }
  return { call: false, reason: 'clean', calls: 1 };
}

// 展开：昨日及更早第一页（单窗口；游标翻页见 moreQueryOf/pageApplied，服务端窗口天然不重叠）
function expandQuery(nowMs) {
  return historyQueryOf(nowMs);
}

// 「更早还有更多单 >」→ 下一页 query：同一窗口 + 服务端游标（单窗口游标分页，不再两阶段切换）
function moreQueryOf(nowMs, state) {
  const st = state || {};
  const query = historyQueryOf(nowMs);
  if (st.cursor) {
    query.cursor = st.cursor;
  }
  return { query: query };
}

// 未展开的初始状态：hasMore 先 true（展开后以服务端 nextCursor 为准）
function pagingState() {
  return { cursor: '', hasMore: true, olderLoaded: 0 };
}

// 展开首屏返回后：hasMore = 服务端还有下一页（单窗口，翻完即到最早）
function openedPaging(result) {
  const data = result || {};
  return { cursor: data.nextCursor || '', hasMore: !!data.nextCursor, olderLoaded: 0 };
}

// 收到一页后推进状态（跨页去重由页面 mergeOlderRows 保证）
function pageApplied(state, result) {
  const st = state || pagingState();
  const data = result || {};
  const list = Array.isArray(data.list) ? data.list : [];
  const nextCursor = data.nextCursor || '';
  return {
    cursor: nextCursor,
    hasMore: !!nextCursor,
    olderLoaded: (st.olderLoaded || 0) + list.length
  };
}

// 翻页结果 → 状态机推进 + 是否需要提示「已到最早的订单」（空页才算到最早；正常末页由 hasMore=false 收口）
function moreResultOf(state, result) {
  const next = pageApplied(state, result);
  const list = Array.isArray(result && result.list) ? result.list : [];
  return { paging: next, rows: list, notice: list.length === 0 ? 'earliest' : '' };
}

// 任意时刻 → 自然日桶（今天/昨天/更早），单源在 day-view（D45）
function dayKeyOf(ms, nowMs) {
  return dayView.dayKeyOf(ms, nowMs);
}

// 终态行：复用活动区行视图（锚+键+状态 chip 一致），补灰显/取消原因。
// 分区锚 = 下单时刻 createdAt（不是完成时间）；节内也按下单时刻倒序（research §3.1）。
function buildHistoryRows(rows, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const list = (Array.isArray(rows) ? rows : []).slice();
  list.sort((left, right) => dayView.createdMsOf(right) - dayView.createdMsOf(left));
  return list.map((order) => {
    const row = groupView.toRow(order, now);
    const dayKey = dayKeyOf(dayView.createdMsOf(order), now);
    // 取消单以 DTO 的 cancelledAt 快照判定（不读七状态字面量，服务端已下发终态时间）
    const cancelled = !!(order && order.cancelledAt);
    return Object.assign({}, row, {
      dayKey: dayKey,
      cancelledText: cancelled
        ? '已取消 · 原因：' + (row.cancelReasonText || '系统取消')
        : '',
      muted: dayKey !== 'today' || cancelled
    });
  });
}

// 分区：昨天 / 更早（标题带日期，按 createdAt 归档；空分区不渲染——今日完成单不入已完结区）
// 分节实现单源在 day-view.sectionsOf（同一批 rows + 同一 nowMs → 计数与 total 一致）
function sectionsOf(rows, nowMs) {
  return dayView.sectionsOf(buildHistoryRows(rows, nowMs), nowMs);
}

function collapsedState(data) {
  const list = data && Array.isArray(data.list) ? data.list : [];
  return {
    count: list.length,
    hasMore: !!(data && data.nextCursor),
    text: filterView.foldedText(list.length, !!(data && data.nextCursor))
  };
}

// 「更早」翻页按钮：hasMore=服务端还有下一页；olderLoaded=已在展开面板加载的已更早条数
function moreText(options) {
  const opts = options || {};
  if (opts.loading) {
    return '加载更早的订单…';
  }
  if (opts.hasMore) {
    return '更早还有更多单 >';
  }
  if ((Number(opts.olderLoaded) || 0) > 0) {
    return '已到最早的订单';
  }
  return '';
}

function mergeOlderRows(existingRows, pageRows) {
  const seen = {};
  const rowList = [];
  (Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
    if (row && row.orderNo) {
      seen[row.orderNo] = true;
    }
    rowList.push(row);
  });
  (Array.isArray(pageRows) ? pageRows : []).forEach((row) => {
    if (row && row.orderNo && !seen[row.orderNo]) {
      seen[row.orderNo] = true;
      rowList.push(row);
    }
  });
  return rowList;
}

// 展开面板的完整视图状态：sections + 「更早」按钮文案/游标
function panelOf(context) {
  const ctx = context || {};
  const now = typeof ctx.nowMs === 'number' ? ctx.nowMs : Date.now();
  const allRows = mergeOlderRows(ctx.rows || [], ctx.olderRows || []);
  const sections = sectionsOf(allRows, now);
  const earlierCount = sections.filter((section) => section.key === 'earlier')[0];
  const olderLoaded = earlierCount ? earlierCount.rows.length : 0;
  return {
    sections: sections,
    olderLoaded: olderLoaded,
    hasMore: !!ctx.hasMore,
    nextCursor: ctx.nextCursor || null,
    moreText: moreText({
      loading: !!ctx.loading,
      hasMore: !!ctx.hasMore,
      olderLoaded: olderLoaded
    })
  };
}

module.exports = {
  TZ_OFFSET_MS,
  DAY_MS,
  HISTORY_LIMIT,
  dayStartMs,
  yesterdayStartMs,
  historyToMs,
  summaryQuery,
  countsFingerprintOf,
  summaryCallPlan,
  expandQuery,
  moreQueryOf,
  pagingState,
  openedPaging,
  pageApplied,
  moreResultOf,
  dayKeyOf,
  buildHistoryRows,
  sectionsOf,
  collapsedState,
  moreText,
  mergeOlderRows,
  panelOf
};
