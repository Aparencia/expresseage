// pages/partner/workbench/parts/history-view.js · 已完结自然日分区纯件（零 wx）
// 口径：CONTRACT §13 D45（M1）+ UX_PARTNER §4.10——已完结区（COMPLETED/CANCELLED）按订单 `createdAt`
//       （UTC+8 自然日）分「今天/昨天/更早」；`completedAt`/`cancelledAt` 只做行为与统计展示，不当分区锚。
//       折叠入口仍为「已完结 · 今天 N 单 >」（完成时间窗口径，服务端零改动）；「更早还有 N 单 >」继续翻页。
//       P1-4（修复批 T3）：「更早」翻页改两阶段状态机——窗口内先带 cursor 续页，窗口耗尽后转「更早」桶
//       （首屏不带 cursor，天然不与今天/昨天窗口重叠），服务端零改动；展开后 hasMore 先 true（更早未知），
//       直到「更早」查询返回空/无下一页才置 false，修复「窗口内 >30 单被 to 窗口滤掉」与「更早不可达」。
// 说明：listPartner 的 history 视图不计入 counts（P0-2/TD-073；响应仍回零值模板、页面不消费，
//       只有 workbench 视图算 6 个 count），故折叠入口的 N 用「今天窗口已加载条数」如实展示
//       （有下一页时带 +），不虚构精确总数。
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

// 折叠入口摘要：今天窗口（from=今天 0 点，to=now）
function summaryQuery(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return { view: 'history', from: dayStartMs(now), to: now, limit: HISTORY_LIMIT };
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

// 展开：一次拉「今天+昨天」（from=昨天 0 点，to=now；客户端按终态时间分区）
function expandQuery(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return { view: 'history', from: yesterdayStartMs(now), to: now, limit: HISTORY_LIMIT };
}

// 更早：昨天 0 点之前的历史（游标沿用上页响应；首屏不带 cursor，to 窗口天然不与 expand 重叠）
function olderQuery(nowMs, cursor) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const payload = { view: 'history', to: yesterdayStartMs(now) - 1, limit: HISTORY_LIMIT };
  if (cursor) {
    payload.cursor = cursor;
  }
  return payload;
}

// ── P1-4 已完结两阶段翻页状态机（纯函数；服务端零改动）────────────────────────
// 现场缺陷：expand 首屏窗口 = [昨天0点, now]，窗口内命中 >30 单时第 31 条起会被 olderQuery 的
// to=昨天0点-1 滤掉（永久丢单）；窗口内 <30 单时 nextCursor=null → 无「更早」入口（更早历史不可达）。
// 修法：阶段 window（同一 from/to 窗口带 cursor 续页）→ 窗口耗尽后阶段 older（首屏不带 cursor）。
const PHASE_WINDOW = 'window';
const PHASE_OLDER = 'older';

// 初始状态（未展开）：window 阶段第一屏待请求
function pagingState() {
  return { phase: PHASE_WINDOW, cursor: '', windowDone: false, hasMore: true, olderLoaded: 0 };
}

// 展开首屏返回后：窗口内还有下一页就继续 window；hasMore 先置 true（更早未知）
function openedPaging(result) {
  const data = result || {};
  return {
    phase: PHASE_WINDOW,
    cursor: data.nextCursor || '',
    windowDone: !data.nextCursor,
    hasMore: true,
    olderLoaded: 0
  };
}

// 「更早还有更多单 >」→ 下一页 query 与本次进入的阶段：
// ① window 未耗尽：expandQuery 同窗口 + cursor 续页（绝不切换 to 窗口）；
// ② window 耗尽：转 older，首屏不带 cursor（to=昨天0点-1，天然不与窗口重叠）。
function moreQueryOf(nowMs, state) {
  const st = state || pagingState();
  if (st.phase !== PHASE_OLDER && st.cursor) {
    return { phase: PHASE_WINDOW, query: Object.assign(expandQuery(nowMs), { cursor: st.cursor }) };
  }
  const cursor = st.phase === PHASE_OLDER ? st.cursor : '';
  return { phase: PHASE_OLDER, query: olderQuery(nowMs, cursor) };
}

// 收到一页后推进状态机。phase = 本次请求所属阶段（moreQueryOf 的 plan.phase；首屏 = window）。
// window 阶段 hasMore 恒 true（更早未知，直到 older 查询确认）；older 阶段只有服务端 nextCursor 才算还有。
function pageApplied(state, result, phase) {
  const st = state || pagingState();
  const data = result || {};
  const list = Array.isArray(data.list) ? data.list : [];
  const nextCursor = data.nextCursor || '';
  if ((phase || st.phase) !== PHASE_OLDER) {
    return {
      phase: PHASE_WINDOW,
      cursor: nextCursor,
      windowDone: !nextCursor,
      hasMore: true,
      olderLoaded: st.olderLoaded || 0
    };
  }
  return {
    phase: PHASE_OLDER,
    cursor: nextCursor,
    windowDone: st.windowDone === true,
    hasMore: !!nextCursor,
    olderLoaded: (st.olderLoaded || 0) + list.length
  };
}

// 翻页结果 → 状态机推进 + 是否需要提示「已到最早的订单」：空结果、无下一页且此前从未加载过更早行。
function moreResultOf(state, result, phase) {
  const next = pageApplied(state, result, phase);
  const list = Array.isArray(result && result.list) ? result.list : [];
  const notice = next.phase === PHASE_OLDER && list.length === 0 && !next.hasMore
    && (next.olderLoaded || 0) === 0 ? 'earliest' : '';
  return { paging: next, rows: list, notice: notice };
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

// 分区：今天 / 昨天 / 更早（标题带日期，按 createdAt 归档；空分区不渲染）
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
  countsFingerprintOf,
  summaryCallPlan,
  expandQuery,
  olderQuery,
  pagingState,
  openedPaging,
  moreQueryOf,
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
