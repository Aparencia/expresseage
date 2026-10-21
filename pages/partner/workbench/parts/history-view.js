// pages/partner/workbench/parts/history-view.js · 已完结自然日分区纯件（零 wx）
// 口径：UX_PARTNER §4.10（活动区之外「已完结 · 今天 N 单 >」折叠入口；展开用 view:'history' + from/to
//       拉当天/昨天；「更早还有 N 单 >」继续翻页；取消单灰显 + 原因；DELIVERED 不归档）。
// 说明：listPartner 的 history counts 未回传终态总数（DATA_MODEL §7.5 只有活动区 counts 六项），
//       故折叠入口的 N 用「今天窗口已加载条数」如实展示（有下一页时带 +），不虚构精确总数。
'use strict';

const groupView = require('./group-view');
const filterView = require('./filter-view');

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 30;

// 自然日（服务端 UTC+8 口径）起点：与云端 lib/time 的日界公式一致，避免客户端时区漂移
function dayStartMs(nowMs) {
  return nowMs - ((nowMs + TZ_OFFSET_MS) % DAY_MS);
}

function yesterdayStartMs(nowMs) {
  return dayStartMs(nowMs) - DAY_MS;
}

// 折叠入口摘要：今天窗口（from=今天 0 点，to=now）
function summaryQuery(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return { view: 'history', from: dayStartMs(now), to: now, limit: HISTORY_LIMIT };
}

// 展开：一次拉「今天+昨天」（from=昨天 0 点，to=now；客户端按终态时间分区）
function expandQuery(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return { view: 'history', from: yesterdayStartMs(now), to: now, limit: HISTORY_LIMIT };
}

// 更早：昨天 0 点之前的历史（游标沿用上页响应）
function olderQuery(nowMs, cursor) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const payload = { view: 'history', to: yesterdayStartMs(now) - 1, limit: HISTORY_LIMIT };
  if (cursor) {
    payload.cursor = cursor;
  }
  return payload;
}

function finishedMsOf(order) {
  const item = order || {};
  const raw = item.completedAt || item.cancelledAt || item.statusUpdatedAt || item.updatedAt;
  const ms = raw ? Date.parse(raw) : 0;
  return Number.isNaN(ms) ? 0 : ms;
}

function dayKeyOf(finishedMs, nowMs) {
  const todayStart = dayStartMs(nowMs);
  if (finishedMs >= todayStart) {
    return 'today';
  }
  if (finishedMs >= todayStart - DAY_MS) {
    return 'yesterday';
  }
  return 'earlier';
}

// 终态行：复用活动区行视图（锚+键+状态 chip 一致），补灰显/取消原因
function buildHistoryRows(rows, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const list = (Array.isArray(rows) ? rows : []).slice();
  list.sort((left, right) => finishedMsOf(right) - finishedMsOf(left));
  return list.map((order) => {
    const row = groupView.toRow(order);
    const dayKey = dayKeyOf(finishedMsOf(order), now);
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

// 分区：今天 / 昨天 / 更早（空分区不渲染）
function sectionsOf(rows, nowMs) {
  const built = buildHistoryRows(rows, nowMs);
  const buckets = { today: [], yesterday: [], earlier: [] };
  built.forEach((row) => {
    buckets[row.dayKey].push(row);
  });
  return [
    { key: 'today', label: '今天', rows: buckets.today },
    { key: 'yesterday', label: '昨天', rows: buckets.yesterday },
    { key: 'earlier', label: '更早', rows: buckets.earlier }
  ].filter((section) => section.rows.length > 0);
}

function countIn(rows, dayKey, nowMs) {
  return buildHistoryRows(rows, nowMs).filter((row) => row.dayKey === dayKey).length;
}

function collapsedState(data) {
  const list = data && Array.isArray(data.list) ? data.list : [];
  return {
    count: list.length,
    hasMore: !!(data && data.nextCursor),
    text: filterView.foldedText(list.length, !!(data && data.nextCursor))
  };
}

// 「更早」翻页按钮：hasMore=服务端还有下一页；olderLoaded=已在展开面板加载的更早条数
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
  const out = [];
  (Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
    if (row && row.orderNo) {
      seen[row.orderNo] = true;
    }
    out.push(row);
  });
  (Array.isArray(pageRows) ? pageRows : []).forEach((row) => {
    if (row && row.orderNo && !seen[row.orderNo]) {
      seen[row.orderNo] = true;
      out.push(row);
    }
  });
  return out;
}

// 展开面板的完整视图状态：sections + 「更早」按钮文案/游标
function panelOf(context) {
  const ctx = context || {};
  const now = typeof ctx.nowMs === 'number' ? ctx.nowMs : Date.now();
  const olderRows = Array.isArray(ctx.olderRows) ? ctx.olderRows : [];
  const allRows = mergeOlderRows(ctx.rows || [], olderRows);
  const sections = sectionsOf(allRows, now);
  const earlierCount = sections.filter((section) => section.key === 'earlier')[0];
  return {
    sections: sections,
    olderLoaded: earlierCount ? earlierCount.rows.length : 0,
    hasMore: !!ctx.hasMore,
    nextCursor: ctx.nextCursor || null,
    moreText: moreText({
      loading: !!ctx.loading,
      hasMore: !!ctx.hasMore,
      olderLoaded: earlierCount ? earlierCount.rows.length : 0
    })
  };
}

module.exports = {
  TZ_OFFSET_MS,
  DAY_MS,
  HISTORY_LIMIT,
  dayStartMs,
  yesterdayStartMs,
  summaryQuery,
  expandQuery,
  olderQuery,
  finishedMsOf,
  dayKeyOf,
  buildHistoryRows,
  sectionsOf,
  countIn,
  collapsedState,
  moreText,
  mergeOlderRows,
  panelOf
};
