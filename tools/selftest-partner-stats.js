'use strict';
/**
 * tools/selftest-partner-stats.js — 批7-D「单量统计与日报」端侧断言套件（ENGINEERING §7.2 register 聚合形态）。
 * 覆盖：
 *   A. 请求与状态机（§3.8/§9 数据来源）：range 三档/缺省 today/只带 range 一个键；
 *      骨架屏 → ready；切 tab/刷新只置 loading 保留旧值；错误保留上次成功数据与 HH:MM 时间。
 *   B. 指标映射（§3.8 口径/§9 完成率）：四格计数、completionRate 0..1（null→「暂无」）、todayCompleted。
 *   C. 近 7 天柱（§3.8 图表）：固定 7 项、date/label、缺日补 0、空数据不画假柱、高度等比。
 *   D. 日报摘要（§9 日报）：格式、只含 orderNo+状态+日期、≤10 单、去敏、空日不复制假日报。
 *   E. 页面接线与静态（§3.8 页面/§9 固定句）：四件套、五入口、复制日报、跳工作台带 completedDate、
 *      WXML class 有定义（镜像 check #9 口径）。
 *   F. 反残留（真实缺陷锁）：删掉 history 4×100 累加、零 wx.cloud、零七状态字面量、零存储、零写守卫、
 *      零金额词表（复用 tools/zero-money-scan.js 单源）、workbench 只加最小入参解析。
 *   G. 跨域契约（DATA_MODEL §7.4 批 7 ③）：真实 DTO 形状 → 视图/日报端到端；空统计（测试会话）全 0。
 *   H. 复制汇总（D48，批 17）：纯件按苑/栋生成顾客群文案（只到楼栋级、无房间/尾号/码/昵称/单号）、
 *      空数据不出假文案、200 字上限按栋数省略、同栋合并/苑固定序/异常归进行中、页面按需调
 *      order.listPartner({view:'workbench',limit:1}) 取服务端 summary（不在 onShow 预拉、不本地聚合）。
 *      P1-6（修复批 T3）：纯件移主包单源 pages/partner/workbench/parts/summary-copy.js（统计页/工作台共用）；
 *      summary.truncated=true 时文案末尾追加「仅统计最近 N 单，可能少报」，toast 同步提示。
 * 纪律：不 mock 全局 wx（本套只测纯件与静态文本）；先合法基线再反例；不空集判绿；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等。取数：node tools/selftest-partner-stats.js
 */
const path = require('path');
const fs = require('fs');
const fsutil = require('./lib/fsutil');
const zeroMoney = require('./zero-money-scan');
const orderState = require('../shared/order-state');
const { createHarness, installCrashGuard } = require('./selftest');

const ROOT = path.resolve(__dirname, '..');

const viewModel = require(path.join(ROOT, 'pkg-partner/pages/stats/parts/view-model.js'));
const dailyReport = require(path.join(ROOT, 'pkg-partner/pages/stats/parts/daily-report.js'));
// D48 纯件：未实现时 try/catch 兜住，让 H 段逐条给出「缺件/缺字段」首红，而不是整套 require 崩溃。
// P1-6：纯件单源已移到主包 pages/partner/workbench/parts/summary-copy.js（统计页与工作台共用）。
function loadSummaryCopy() {
  try {
    return require(path.join(ROOT, 'pages/partner/workbench/parts/summary-copy.js'));
  } catch (error) {
    return null;
  }
}
const summaryCopy = loadSummaryCopy();

// 203（A~G 既有）+ 45（H D48 复制汇总，含 P1-6 truncated/单源）= 248；少算/多算都判红。
const EXPECTED_ASSERTIONS = 248;

const P = {
  page: 'pkg-partner/pages/stats/index.js',
  wxml: 'pkg-partner/pages/stats/index.wxml',
  wxss: 'pkg-partner/pages/stats/index.wxss',
  json: 'pkg-partner/pages/stats/index.json',
  viewModel: 'pkg-partner/pages/stats/parts/view-model.js',
  report: 'pkg-partner/pages/stats/parts/daily-report.js',
  summaryCopy: 'pages/partner/workbench/parts/summary-copy.js',
  summaryCopyMoved: 'pkg-partner/pages/stats/parts/summary-copy.js',
  oldSummary: 'pkg-partner/pages/stats/parts/summary.js',
  workbench: 'pages/partner/workbench/index.js',
  workbenchActions: 'pages/partner/workbench/parts/page-actions.js',
  workbenchWxml: 'pages/partner/workbench/index.wxml'
};
const STATS_JS = [P.page, P.viewModel, P.report];

const STATUS_LITERALS = Object.keys(orderState.STATUS).map(function literalOf(key) {
  return orderState.STATUS[key];
});

// 2026-10-22 09:20（UTC+8）的 UTC 毫秒；本套所有日期断言都相对它
const NOW_MS = Date.parse('2026-10-22T01:20:00.000Z');
const DAY_MS = viewModel.DAY_MS;

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

function exists(rel) {
  return fsutil.exists(path.join(ROOT, rel));
}

function occurrences(haystack, needle) {
  return String(haystack).split(needle).length - 1;
}

function sampleSeries() {
  return [
    { date: '2026-10-16', label: '10-16', completed: 2 },
    { date: '2026-10-17', label: '10-17', completed: 0 },
    { date: '2026-10-18', label: '10-18', completed: 3 },
    { date: '2026-10-19', label: '10-19', completed: 1 },
    { date: '2026-10-20', label: '10-20', completed: 0 },
    { date: '2026-10-21', label: '10-21', completed: 4 },
    { date: '2026-10-22', label: '10-22', completed: 5 }
  ];
}

function sampleRecent() {
  return [
    { orderNo: '20261021-0031', status: 'DELIVERED', statusText: '已送达·待确认', at: '2026-10-21T08:00:00.000Z' },
    { orderNo: '20261021-0027', status: 'PICKED', statusText: '已取件·配送中', at: '2026-10-21T07:00:00.000Z' }
  ];
}

function sampleDto(overrides) {
  return Object.assign({
    range: 'today',
    counts: { completed: 5, active: 3, cancelled: 2, exceptions: 1 },
    completionRate: 0.625,
    series: sampleSeries(),
    recent: sampleRecent(),
    todayCompleted: 5
  }, overrides || {});
}

function emptyStatsDto(overrides) {
  return Object.assign({
    range: 'today',
    counts: { completed: 0, active: 0, cancelled: 0, exceptions: 0 },
    completionRate: null,
    series: sampleSeries().map(function zero(item) {
      return { date: item.date, label: item.label, completed: 0 };
    }),
    recent: [],
    todayCompleted: 0
  }, overrides || {});
}

// D48 复制汇总：空视图形状（纯件未实现时逐条首红，不做假绿）
function emptyCopyShape() {
  return {
    visible: false, text: '', copyText: '', total: 0, parcels: 0, dormCount: 0,
    truncated: false, textOmitted: false
  };
}

// D48 复制汇总：顾客群口径样例（byDorm 故意乱序，验证苑序/栋号排序与同栋合并）
function sampleSummary() {
  return {
    total: 8,
    parcels: 10,
    byStatus: { picked: 1, delivered: 1, ongoing: 6 },
    byDorm: [
      { zone: 'D', buildingNo: 4, count: 2 },
      { zone: 'X', buildingNo: 2, count: 1 },
      { zone: 'D', buildingNo: 3, count: 5 }
    ]
  };
}

// D48 截断样例：5 苑 × 10 栋，50 行必超 200 字
function manyDormSummary() {
  const byDorm = [];
  ['D', 'X', 'N', 'B', 'C'].forEach(function eachZone(zone) {
    for (let buildingNo = 1; buildingNo <= 10; buildingNo += 1) {
      byDorm.push({ zone: zone, buildingNo: buildingNo, count: 1 });
    }
  });
  return { total: 50, parcels: 50, byStatus: { picked: 0, delivered: 0, ongoing: 50 }, byDorm: byDorm };
}

function register(h) {
  // ---------------------------------------------------------------- A 请求与状态
  h.section('§3.8 A 请求入参与加载/错误状态（PARTNER.stats 单一来源）', (t) => {
    t.eq(viewModel.DEFAULT_RANGE, 'today', 'A01 §3.8 默认区间为今日（服务端缺省 today 同口径）');
    t.eq(viewModel.RANGE_KEYS, ['today', 'week', 'month'], 'A02 §3.8 三档区间今日/本周/本月');
    t.eq(viewModel.resolveRange('week'), 'week', 'A03 §3.8 切本周保留 week');
    t.eq(viewModel.resolveRange('month'), 'month', 'A04 §3.8 切本月保留 month');
    t.eq(viewModel.resolveRange(''), 'today', 'A05 §9 非法空串回退默认 today');
    t.eq(viewModel.resolveRange('year'), 'today', 'A06 §9 未知区间不发明第四档，回退 today');
    t.eq(viewModel.resolveRange(null), 'today', 'A07 §9 null 回退 today');
    t.eq(viewModel.queryOf('today'), { range: 'today' }, 'A08 §9 请求只带 range=today');
    t.eq(viewModel.queryOf('week'), { range: 'week' }, 'A09 §3.8 切本周重新请求 range=week');
    t.eq(viewModel.queryOf(undefined), { range: 'today' }, 'A10 §9 缺省入参按 today 请求');
    t.eq(Object.keys(viewModel.queryOf('month')), ['range'], 'A11 §9 不夹带 from/to/cursor 等历史页参数');
    t.eq(viewModel.initialView().stage, 'skeleton', 'A12 §3.8 首次进入是骨架屏（不是 0 值假数据）');
    t.eq(viewModel.initialView().loading, true, 'A13 §3.8 骨架屏 loading=true');
    t.eq(viewModel.initialView().bars, [], 'A14 §3.8 骨架屏不预画柱子');
    t.eq(viewModel.initialView().range, 'today', 'A15 §3.8 初始区间为今日');
    t.eq(viewModel.initialView().metrics.rateText, '暂无', 'A16 §9 初始完成率不作 0% 假读数');
    t.eq(viewModel.loadingView(), { loading: true }, 'A17 §3.8 切 tab/刷新只置 loading，不动旧值（防闪空）');
    t.eq(viewModel.viewOf({ dto: sampleDto(), range: 'today', nowMs: NOW_MS, lastSuccessAt: NOW_MS }).stage,
      'ready', 'A18 §3.8 成功返回进入 ready');
    t.eq(viewModel.viewOf({ dto: sampleDto(), range: 'today', nowMs: NOW_MS, lastSuccessAt: NOW_MS }).errorText,
      '', 'A19 §3.8 成功态清空旧错误条');
    t.eq(viewModel.viewOf({ dto: sampleDto(), range: 'today', nowMs: NOW_MS, lastSuccessAt: NOW_MS }).updatedAtText,
      '09:20', 'A20 §3.8 显示服务端更新时间 HH:MM');
    t.eq(viewModel.clockText(NOW_MS), '09:20', 'A21 §9 服务端时钟按 UTC+8 自然日口径');
    t.eq(viewModel.clockText(Date.parse('2026-10-21T17:30:00.000Z')), '01:30', 'A22 §9 时钟不跟本机时区漂移');
    t.eq(viewModel.clockText(0), '', 'A23 §9 无成功时间不显示假时钟');
    t.eq(viewModel.dayStartMs(NOW_MS), Date.parse('2026-10-21T16:00:00.000Z'), 'A24 §9 自然日边界按 UTC+8');
    t.eq(viewModel.dateKeyOf(NOW_MS), '2026-10-22', 'A25 §9 日期键按 UTC+8');
    t.eq(viewModel.dateKeyOf(viewModel.dayStartMs(NOW_MS) - 1), '2026-10-21', 'A26 §9 日界前一毫秒属于昨天');
    t.check(viewModel.isValidDateKey('2026-10-22'), 'A27 §9 合法日期键通过');
    t.check(!viewModel.isValidDateKey('2026-02-30'), 'A28 §9 2026-02-30 非法（回环校验）');
    t.check(!viewModel.isValidDateKey('2026-10-2'), 'A29 §9 补零格式必须 YYYY-MM-DD');
    t.eq(viewModel.labelOf('2026-10-22'), '10-22', 'A30 §3.8 柱标签 MM-DD');
    t.eq(viewModel.errorViewOf({ hasData: false }).stage, 'error', 'A31 §3.8 首次失败进错误态可重试');
    t.eq(viewModel.errorViewOf({ hasData: false }).errorText, '统计没加载出来，检查网络后重试',
      'A32 §3.8 首次失败文案给下一步（重试）');
    t.eq(viewModel.errorViewOf({ hasData: false }).loading, false, 'A33 §3.8 错误态关闭 loading');
    t.check(!('stage' in viewModel.errorViewOf({ hasData: true })), 'A34 §3.8 有旧值时错误不切换 stage（保留数据）');
    t.eq(viewModel.errorViewOf({ hasData: true, updatedAtText: '08:12' }).errorText,
      '没连上服务器，显示的是 08:12 的数据。', 'A35 §10 断网文案带上次成功时间');
    t.eq(viewModel.errorViewOf({ hasData: true }).errorText, '没连上服务器，显示的是上次成功的数据。',
      'A36 §10 无时间戳时如实说上次成功数据');
    t.eq(Object.keys(viewModel.errorViewOf({ hasData: false })).sort(), ['errorText', 'loading', 'stage'],
      'A37 §3.8 错误视图只动状态字段，不动四格/柱');
    t.check(typeof viewModel.serverNow(0) === 'number', 'A38 §9 服务端时间基准可用');
  });

  // ---------------------------------------------------------------- B 指标映射
  h.section('§3.8/§9 B 四格指标与完成率（completionRate 0..1，null→暂无）', (t) => {
    const metrics = viewModel.metricOf(sampleDto());
    t.eq(metrics.completed, 5, 'B01 §3.8 完成单量取 counts.completed（服务端聚合）');
    t.eq(metrics.active, 3, 'B02 §3.8 进行中取 counts.active');
    t.eq(metrics.exceptions, 1, 'B03 §3.8 异常取 counts.exceptions（与取消分开）');
    t.eq(metrics.cancelled, 2, 'B04 §3.8 取消取 counts.cancelled');
    t.eq(metrics.rateText, '63%', 'B05 §9 完成率 0.625 → 63%（端侧只做百分比展示）');
    t.eq(metrics.todayCompleted, 5, 'B06 §3.8 todayCompleted 直接消费服务端值');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: null })).rateText, '暂无',
      'B07 §7.4 分母 0 → null 显示「暂无」而非 0%');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: 0 })).rateText, '0%', 'B08 §9 0 完成率如实显示 0%');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: 1 })).rateText, '100%', 'B09 §9 全完成显示 100%');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: 0.916 })).rateText, '92%', 'B10 §9 0.916 四舍五入 92%');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: undefined })).rateText, '暂无',
      'B11 §9 缺 completionRate 不猜 0%');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: NaN })).rateText, '暂无', 'B12 §9 NaN 按无数据处理');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: '0.5' })).rateText, '暂无',
      'B13 §9 非 number 不参与计算（服务端契约为 number）');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: 1.7 })).rateText, '100%', 'B14 §9 越界比率夹紧到 100%');
    t.eq(viewModel.metricOf(sampleDto({ completionRate: -0.2 })).rateText, '0%', 'B15 §9 负比率夹紧到 0%');
    t.eq(viewModel.metricOf(null), viewModel.EMPTY_METRICS, 'B16 §3.8 空 DTO 全 0 且完成率暂无（合法基线）');
    t.eq(viewModel.metricOf({}), viewModel.EMPTY_METRICS, 'B17 §3.8 缺 counts 不报错、不猜');
    t.eq(viewModel.metricOf({ counts: { completed: -3, active: '7', cancelled: 2.9, exceptions: undefined } }),
      { completed: 0, rateText: '暂无', active: 7, exceptions: 0, cancelled: 2, todayCompleted: 0 },
      'B18 §3.8 计数归一：负数/浮点/字符串不产生脏值');
    t.eq(viewModel.countOf('5'), 5, 'B19 §3.8 数字字符串安全转换');
    t.eq(viewModel.countOf(Number.POSITIVE_INFINITY), 0, 'B20 §3.8 非有限数按 0');
    t.eq(viewModel.metricOf(sampleDto({ counts: { completed: 0, active: 9, cancelled: 0, exceptions: 0 } })).active,
      9, 'B21 §7.4 进行中不随区间变化（独立于 series 完成数）');
    t.eq(viewModel.emptyTextOf('week', 0), '本周还没有完成订单', 'B22 §3.8 本周空态文案');
    t.eq(viewModel.emptyTextOf('today', 0), '今天还没有完成订单', 'B23 §3.8 今日空态文案');
    t.eq(viewModel.emptyTextOf('month', 0), '本月还没有完成订单', 'B24 §3.8 本月空态文案');
    t.eq(viewModel.emptyTextOf('week', 5), '', 'B25 §3.8 有完成单不显示空态');
    t.eq(viewModel.summaryTextOf('today', metrics), '今日异常 1 · 取消 2', 'B26 §3.8 异常/取消分开计数');
    t.eq(viewModel.summaryTextOf('week', metrics), '本周异常 1 · 取消 2', 'B27 §3.8 周口径行文案');
    t.eq(viewModel.summaryTextOf('month', metrics), '本月异常 1 · 取消 2', 'B28 §3.8 月口径行文案');
    const completedOnly = viewModel.metricOf(sampleDto({
      counts: { completed: 999, active: 0, cancelled: 0, exceptions: 0 }
    }));
    t.eq(viewModel.summaryTextOf('week', completedOnly), '本周异常 0 · 取消 0',
      'B29 §3.8 行文案只取异常/取消，不被完成量污染');
    t.eq(viewModel.rangeLabelOf('today'), '今日', 'B30 §3.8 区间文案今日');
    t.eq(viewModel.rangeLabelOf('week'), '本周', 'B31 §3.8 区间文案本周');
    t.eq(viewModel.rangeLabelOf('month'), '本月', 'B32 §3.8 区间文案本月');
  });

  // ---------------------------------------------------------------- C 近 7 天柱
  h.section('§3.8 C 近 7 天柱（固定 7 项/缺日补 0/空数据不画假柱）', (t) => {
    const series = viewModel.seriesOf(sampleDto(), NOW_MS);
    t.eq(series.length, 7, 'C01 §3.8 固定 7 项（不随 range 变化）');
    t.eq(series.map(function date(item) { return item.date; }),
      ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'],
      'C02 §3.8 顺序最早→今天');
    t.eq(series[6].date, viewModel.dateKeyOf(NOW_MS), 'C03 §3.8 末项是今天');
    t.eq(series.map(function label(item) { return item.label; }),
      ['10-16', '10-17', '10-18', '10-19', '10-20', '10-21', '10-22'], 'C04 §3.8 标签 MM-DD');
    t.eq(series.map(function count(item) { return item.completed; }), [2, 0, 3, 1, 0, 4, 5],
      'C05 §3.8 每日完成数原样消费');
    const shortSeries = viewModel.seriesOf(sampleDto({ series: sampleSeries().slice(0, 6) }), NOW_MS);
    t.eq(shortSeries.length, 7, 'C06 §7.4 series 不足仍补足 7 项');
    t.eq(shortSeries[6].completed, 0, 'C07 §7.4 缺日补 0（今天无数据不画假柱）');
    t.eq(viewModel.seriesOf(sampleDto({ series: undefined }), NOW_MS).map(function count(item) {
      return item.completed;
    }), [0, 0, 0, 0, 0, 0, 0], 'C08 §3.8 无 series 时 7 天全 0');
    t.eq(viewModel.seriesOf(sampleDto({ series: undefined }), NOW_MS)[0].date, '2026-10-16',
      'C09 §3.8 无 series 时窗口仍按今天倒推');
    const eight = [{ date: '2026-10-15', label: '10-15', completed: 9 }].concat(sampleSeries());
    const trimmed = viewModel.seriesOf(sampleDto({ series: eight }), NOW_MS);
    t.eq(trimmed.length, 7, 'C10 §7.4 多于 7 项只取最近 7 天');
    t.eq(trimmed[0].date, '2026-10-16', 'C11 §7.4 多出的更早日期被裁掉');
    const badDate = sampleSeries().map(function clone(item, index) {
      return index === 1 ? { date: '2026-13-17', label: '10-17', completed: 9 } : item;
    });
    t.eq(viewModel.seriesOf(sampleDto({ series: badDate }), NOW_MS).map(function count(item) {
      return item.completed;
    }), [2, 0, 3, 1, 0, 4, 5], 'C12 §7.4 非法日期项丢弃后按日键回填，不串值');
    const noLabel = sampleSeries().map(function clone(item) { return { date: item.date, completed: item.completed }; });
    t.eq(viewModel.seriesOf(sampleDto({ series: noLabel }), NOW_MS)[0].label, '10-16',
      'C13 §7.4 缺 label 时从 date 派生 MM-DD');
    const bars = viewModel.barsOf(series);
    t.eq(bars.total, 15, 'C14 §3.8 柱状总量=7 天完成数之和');
    t.eq(bars.empty, false, 'C15 §3.8 有数据时不显示空态');
    t.eq(bars.bars[6].heightRpx, 120, 'C16 §3.8 最大值柱高 120rpx');
    t.eq(bars.bars[5].heightRpx, 101, 'C17 §3.8 等比高度 4/5 → 101rpx');
    t.eq(bars.bars[0].heightRpx, 62, 'C18 §3.8 等比高度 2/5 → 62rpx');
    t.eq(bars.bars[2].heightRpx, 82, 'C19 §3.8 等比高度 3/5 → 82rpx');
    t.eq(bars.bars[1].heightRpx, 0, 'C20 §3.8 0 单不画柱（高度 0）');
    t.eq(bars.bars[1].hasBar, false, 'C21 §3.8 0 单 hasBar=false（不画假柱）');
    t.eq(bars.bars.map(function has(item) { return item.hasBar; }).filter(Boolean).length, 5,
      'C22 §3.8 仅正数日画柱');
    t.check(bars.bars[6].latest && !bars.bars[0].latest, 'C23 §3.8 末柱标记今天');
    const emptyBars = viewModel.barsOf(viewModel.seriesOf(emptyStatsDto(), NOW_MS));
    t.eq(emptyBars.empty, true, 'C24 §3.8 全 0 时图表空态');
    t.eq(emptyBars.bars.filter(function has(item) { return item.hasBar || item.heightRpx > 0; }).length, 0,
      'C25 §3.8 空数据零柱（不造假柱）');
    t.eq(viewModel.barsOf(undefined).bars, [], 'C26 §3.8 无 series 不崩、无柱');
    t.eq(viewModel.CHART_EMPTY_TEXT, '近 7 天还没有完成订单', 'C27 §3.8 图表空态文案');
    const view = viewModel.viewOf({ dto: emptyStatsDto(), range: 'week', nowMs: NOW_MS, lastSuccessAt: NOW_MS });
    t.eq(view.chartEmpty, true, 'C28 §3.8 空统计视图 chartEmpty=true');
    t.eq(view.bars.length, 7, 'C29 §3.8 空统计仍给 7 个日期槽（只有标签不画柱）');
    t.eq(viewModel.viewOf({ dto: sampleDto(), range: 'week', nowMs: NOW_MS, lastSuccessAt: NOW_MS }).chartEmpty,
      false, 'C30 §3.8 有数据视图 chartEmpty=false');
    t.eq(viewModel.viewOf({ dto: sampleDto(), range: 'week', nowMs: NOW_MS, lastSuccessAt: NOW_MS }).bars.length,
      7, 'C31 §3.8 ready 视图恒 7 柱');
  });

  // ---------------------------------------------------------------- D 日报摘要
  h.section('§9 D 日报摘要（可复制；仅 orderNo+状态+日期；去敏）', (t) => {
    t.eq(dailyReport.emptyReport(), {
      visible: false, date: '', completed: 0, exceptions: 0, orderCount: 0, text: '', copyText: ''
    }, 'D01 §9 空日报结构（不可复制假日报）');
    t.eq(dailyReport.reportOf(null), dailyReport.emptyReport(), 'D02 §9 无 DTO 返回空日报');
    const report = dailyReport.reportOf(sampleDto(), { nowMs: NOW_MS });
    t.eq(report.text,
      '【代取日报】2026-10-22 完成 5 单、异常 1 单；订单 20261021-0031 已送达·待确认 / 20261021-0027 已取件·配送中。',
      'D03 §9 日报格式与状态文案（服务端 statusText 原样）');
    t.eq(report.text.indexOf('【代取日报】2026-10-22'), 0, 'D04 §9 标题+日期开头');
    t.eq(report.orderCount, 2, 'D05 §9 订单条目数=recent 有效行数');
    t.eq([report.completed, report.exceptions], [5, 1], 'D06 §9 完成/异常计数取 counts');
    t.eq(report.copyText, report.text, 'D07 §9 复制内容=展示内容');
    t.eq(report.visible, true, 'D08 §9 有数据时可复制');
    const many = [];
    for (let i = 1; i <= 12; i += 1) {
      many.push({
        orderNo: '20261022-00' + (i < 10 ? '0' + i : String(i)),
        statusText: '已完成', at: '2026-10-22T00:00:00.000Z'
      });
    }
    const manyReport = dailyReport.reportOf(sampleDto({ recent: many }), { nowMs: NOW_MS });
    t.eq(manyReport.orderCount, 10, 'D09 §7.4 recent ≤10：超过 10 条只列前 10');
    t.eq(occurrences(manyReport.text, ' / '), 9, 'D10 §9 10 条用斜杠分隔');
    const missingStatus = dailyReport.reportOf(sampleDto({
      recent: [{ orderNo: '20261021-0031', statusText: '', at: '' }]
    }), { nowMs: NOW_MS });
    t.eq(missingStatus.orderCount, 0, 'D11 §9 缺状态文案的订单不进日报');
    t.eq(dailyReport.reportOf(sampleDto({ recent: [{ orderNo: '2026 1021', statusText: '已完成' }] }),
      { nowMs: NOW_MS }).orderCount, 0, 'D12 §9 非法订单号（含空格）不进日报');
    t.eq(dailyReport.reportOf(sampleDto({ recent: [{ orderNo: 'A'.repeat(40), statusText: '已完成' }] }),
      { nowMs: NOW_MS }).orderCount, 0, 'D13 §9 超长订单号不进日报');
    t.eq(dailyReport.statusTextOf({ statusText: '已送达\n待确认' }), '已送达 待确认',
      'D14 §9 状态文案压平换行（不破坏单行复制）');
    t.eq(dailyReport.statusTextOf({ statusText: '  已完成  ' }), '已完成', 'D15 §9 状态文案去首尾空白');
    t.eq(dailyReport.statusTextOf({ statusText: '已完成'.repeat(10) }).length, dailyReport.STATUS_TEXT_MAX,
      'D16 §9 状态文案截断到上限');
    const zeroReport = dailyReport.reportOf(emptyStatsDto(), { nowMs: NOW_MS });
    t.eq([zeroReport.visible, zeroReport.text, zeroReport.copyText], [false, '', ''],
      'D17 §9 全 0 的一天不产出可复制日报');
    const exceptionOnly = dailyReport.reportOf(emptyStatsDto({ counts: {
      completed: 0, active: 0, cancelled: 0, exceptions: 1
    } }), { nowMs: NOW_MS });
    t.eq(exceptionOnly.text, '【代取日报】2026-10-22 完成 0 单、异常 1 单。',
      'D18 §9 只有异常也如实出日报');
    const reportJson = JSON.stringify(report);
    t.check(reportJson.indexOf('取件码') === -1 && reportJson.indexOf('宿舍') === -1
      && reportJson.indexOf('尾号') === -1 && reportJson.indexOf('门牌') === -1,
      'D19 §9 日报对象不含取件码/宿舍/尾号/门牌');
    t.check(report.text.indexOf('取件码') === -1 && report.text.indexOf('宿舍') === -1
      && report.text.indexOf('尾号') === -1, 'D20 §9 日报文本去敏');
    const withL3 = sampleDto({
      recent: [{
        orderNo: '20261021-0031', statusText: '已送达·待确认',
        pickupCode: '9-1-2333', dormKey: 'D4-522', phoneTail: '8888', at: '2026-10-21T08:00:00.000Z'
      }]
    });
    t.eq(dailyReport.reportOf(withL3, { nowMs: NOW_MS }).text,
      '【代取日报】2026-10-22 完成 5 单、异常 1 单；订单 20261021-0031 已送达·待确认。',
      'D21 §9 recent 附带字段（取件码/宿舍/尾号）一概不进日报');
    t.eq(dailyReport.reportOf(sampleDto({ series: undefined }), { nowMs: NOW_MS }).date, '2026-10-22',
      'D22 §9 无 series 时日期回退到服务端今日');
    t.eq(dailyReport.reportOf(sampleDto({ recent: [] }), { nowMs: NOW_MS }).text,
      '【代取日报】2026-10-22 完成 5 单、异常 1 单。', 'D23 §9 无订单行时只留计数句');
    t.eq(dailyReport.reportOf(sampleDto({ recent: [], counts: {
      completed: 3, active: 0, cancelled: 9, exceptions: 0
    } }), { nowMs: NOW_MS }).text, '【代取日报】2026-10-22 完成 3 单、异常 0 单。',
      'D24 §9 日报只报完成/异常，取消不混入');
  });

  // ---------------------------------------------------------------- E 页面接线与静态
  h.section('§3.8/§9 E 页面接线（四格/柱/日报/复制/跳转）与四件套', (t) => {
    const page = textOf(P.page);
    const wxml = textOf(P.wxml);
    const wxss = textOf(P.wxss);
    const jsonText = textOf(P.json);
    t.check(page.indexOf("require('../../../api/modules/partner')") !== -1, 'E01 §9 页面走 api/modules/partner（partner.stats 出口）');
    t.check(page.indexOf('partnerApi.stats(') !== -1, 'E02 §9 页面直接调 partnerApi.stats（单一来源）');
    t.check(page.indexOf('viewModel.queryOf(') !== -1, 'E03 §9 请求参数由纯件 queryOf 生成');
    t.check(page.indexOf('viewModel.initialView()') !== -1, 'E04 §3.8 初始 data 来自纯件（骨架屏）');
    t.check(page.indexOf('onShow()') !== -1, 'E05 §3.8 onShow 重新对齐服务端数据');
    t.check(page.indexOf('onPullDownRefresh()') !== -1, 'E06 §3.8 支持下拉刷新');
    t.check(page.indexOf('onRangeTap(') !== -1, 'E07 §3.8 三档 tab 点击');
    t.check(page.indexOf('onRetryTap(') !== -1, 'E08 §3.8 错误态重试入口');
    t.check(page.indexOf('onCopyReport(') !== -1, 'E09 §9 复制日报入口');
    t.check(page.indexOf('onTodayCompletedTap(') !== -1, 'E10 §3.8 今日完成跳转入口');
    t.check(page.indexOf('wx.reLaunch({ url:') !== -1, 'E11 §3.8 tabBar 页只能 reLaunch 带参跳转');
    t.check(page.indexOf('route.PARTNER_WORKBENCH') !== -1, 'E12 §3.8 工作台地址取 config/route 常量');
    t.check(page.indexOf('viewModel.jumpUrlOf(') !== -1, 'E13 §3.8 跳转 URL 由纯件生成（completedDate）');
    t.check(page.indexOf('wx.setClipboardData') !== -1, 'E14 §9 复制使用剪贴板能力');
    t.check(page.indexOf('dailyReport.reportOf(') !== -1, 'E15 §9 日报由纯件拼装');
    t.check(wxml.indexOf('switch-bar') !== -1, 'E16 §6 页面保留切换会话条');
    t.check(wxml.indexOf('本程序不涉及任何费用收付') !== -1, 'E17 §9 页面固定一句零费用声明');
    t.check(wxml.indexOf('复制日报') !== -1, 'E18 §9 日报复制按钮文案');
    t.check(wxml.indexOf('近 7 天单量') !== -1, 'E19 §3.8 近 7 天单量分区');
    t.check(wxml.indexOf('完成率') !== -1, 'E20 §3.8 四格含完成率');
    t.check(wxml.indexOf('进行中') !== -1, 'E21 §3.8 四格含进行中');
    t.check(wxml.indexOf('近 7 天还没有完成订单') === -1 && wxml.indexOf('chartEmptyText') !== -1,
      'E22 §3.8 图表空态文案走 view-model（不在 WXML 写死）');
    t.check(wxml.indexOf('chartEmpty') !== -1, 'E23 §3.8 WXML 有图表空态分支');
    t.check(wxml.indexOf('rangeEmptyText') !== -1, 'E24 §3.8 WXML 有区间空态分支');
    t.check(wxml.indexOf('wx:if="{{stage ===') !== -1 && wxml.indexOf('skeleton') !== -1,
      'E25 §3.8 WXML 有骨架屏分支');
    t.check(wxml.indexOf('errorText') !== -1 && wxml.indexOf('重试') !== -1, 'E26 §3.8 WXML 错误卡可重试');
    t.check(wxml.indexOf('今日日报') !== -1, 'E27 §9 WXML 日报分区');
    t.check(wxml.indexOf('canvas') === -1 && wxml.indexOf('echarts') === -1,
      'E28 §12 不引第三方图表库/不用 canvas（view 自绘）');
    t.check(wxml.indexOf('bindtap="onTodayCompletedTap"') !== -1, 'E29 §3.8 今日完成行可点');
    t.check(wxml.indexOf('style="height: {{item.heightRpx}}rpx"') !== -1, 'E30 §3.8 柱高来自纯件 rpx 值');
    t.check(wxml.indexOf('wx:if="{{item.hasBar}}"') !== -1, 'E31 §3.8 仅 hasBar 的柱子渲染（0 单不画假柱）');
    t.check(wxss.indexOf('.bar') !== -1 && wxss.indexOf('.range-tab') !== -1, 'E32 §3.8 页面自绘样式齐全');
    t.check(jsonText.indexOf('单量统计') !== -1, 'E33 §3.8 页面标题');
    t.check(jsonText.indexOf('"enablePullDownRefresh": true') !== -1, 'E34 §3.8 页面允许下拉刷新');
    const appWxss = textOf('app.wxss');
    const defined = new Set();
    [wxss + '\n' + appWxss].forEach(function collect(css) {
      const re = /\.([A-Za-z_][A-Za-z0-9_-]*)/g;
      let m;
      while ((m = re.exec(css)) !== null) {
        defined.add(m[1]);
      }
    });
    const missing = [];
    const classRe = /class\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = classRe.exec(wxml)) !== null) {
      const value = match[1];
      if (value.indexOf('{{') !== -1) {
        continue;
      }
      value.split(/\s+/).filter(Boolean).forEach(function each(cls) {
        if (!defined.has(cls)) {
          missing.push(cls);
        }
      });
    }
    t.eq(missing, [], 'E35 §3.8 WXML class 全部有定义（镜像 check #9，空集不判绿）');
    t.check(page.indexOf('modeGuard') === -1 && page.indexOf('canRenderWriteButton') === -1,
      'E36 §6 只读可读：统计页零写权限守卫、不禁读取');
  });

  // ---------------------------------------------------------------- F 反残留（真实缺陷锁）
  h.section('§9 F 反残留（history 累加/本地猜/测试数据/费用/状态字面量）', (t) => {
    t.check(!exists(P.oldSummary), 'F01 §9 旧 summary.js 客户端累加件已删除');
    const page = textOf(P.page);
    t.check(page.indexOf("view: 'history'") === -1,
      'F02 §9 页面不为本地统计拉历史页（listPartner 只用于 workbench summary，零 history 视图）');
    t.check(page.indexOf('MAX_HISTORY_PAGES') === -1 && page.indexOf('HISTORY_PAGE_LIMIT') === -1,
      'F03 §9 零 4×100 页累加常量（>400 单偏小的真缺陷已废弃）');
    t.check(page.indexOf('fetchHistory') === -1, 'F04 §9 零客户端历史翻页累加函数');
    t.check(page.indexOf('computeStats') === -1 && page.indexOf('buildWeekBars') === -1,
      'F05 §9 零本地统计/本地柱计算（完成率/异常不再按本地时间猜）');
    STATS_JS.forEach(function eachFile(rel, index) {
      const text = textOf(rel);
      t.check(text.indexOf('wx.cloud') === -1, 'F0' + (6 + index) + ' §9 ' + rel + ' 零 wx.cloud 直连');
    });
    const statusHits = [];
    STATS_JS.forEach(function eachFile(rel) {
      const text = textOf(rel);
      STATUS_LITERALS.forEach(function eachStatus(literal) {
        if (text.indexOf("'" + literal + "'") !== -1) {
          statusHits.push(rel + ':' + literal);
        }
      });
    });
    t.eq(statusHits, [], 'F09 §3.8 统计页零七状态字面量（状态/异常由服务端聚合）');
    const joined = STATS_JS.map(textOf).join('\n');
    t.check(joined.indexOf('Math.random') === -1, 'F10 §3.8 页面/纯件零随机');
    t.check(joined.indexOf('getStorageSync') === -1 && joined.indexOf('setStorageSync') === -1,
      'F11 §5.6 零本地存储读写（统计不入盘）');
    t.check(joined.indexOf('unbindCustomer') === -1 && joined.indexOf('saveCustomerNote') === -1
      && joined.indexOf('saveServiceConfig') === -1, 'F12 §9 统计页零写动作（纯读页面）');
    STATS_JS.forEach(function eachFile(rel, index) {
      t.eq(zeroMoney.scanText(textOf(rel)).length, 0,
        'F' + (13 + index) + ' §7.6 ' + rel + ' 零金额词表 0 命中');
    });
    t.eq(zeroMoney.scanText(textOf(P.wxml)).length, 0, 'F16 §7.6 stats 页面文案零金额词表 0 命中');
    t.eq(zeroMoney.scanText(dailyReport.reportOf(sampleDto(), { nowMs: NOW_MS }).text).length, 0,
      'F17 §9 日报复制文本零金额词表 0 命中');
    const workbench = textOf(P.workbench);
    t.check(workbench.indexOf('completedDate') !== -1, 'F18 §3.8 workbench 解析 completedDate 跳转参数');
    t.check(workbench.indexOf('applyCompletedFocus') !== -1, 'F19 §3.8 workbench 自动展开已完结区（复用既有 toggle）');
    t.check(workbench.indexOf('this.onCompletedToggle()') !== -1, 'F20 §3.8 既有已完结加载逻辑原样复用（不重写）');
    t.check(workbench.indexOf("Page(Object.assign(base, require('./parts/page-actions')))") !== -1,
      'F21 §3.8 workbench 入口合并方式未变（仅增量入参解析）');
    const dayView = textOf('pages/partner/workbench/parts/day-view.js');
    t.check(workbench.indexOf('dayView.focusDateOf(') !== -1
      && dayView.indexOf('\\d{4}') !== -1 && dayView.indexOf('\\d{2}') !== -1,
      'F22 §3.8 workbench 只接受 YYYY-MM-DD 形参（日形参校验单源 parts/day-view；非法参数忽略）');
  });

  // ---------------------------------------------------------------- G 跨域契约
  h.section('§7.4 G 契约端到端（真实 DTO → 视图/日报；空统计=测试会话）', (t) => {
    const view = viewModel.viewOf({
      dto: sampleDto(), range: 'week', nowMs: NOW_MS, lastSuccessAt: NOW_MS
    });
    t.eq(view.metrics, {
      completed: 5, rateText: '63%', active: 3, exceptions: 1, cancelled: 2, todayCompleted: 5
    }, 'G01 §7.4 契约 DTO → 四格指标（端到端）');
    t.eq(view.rangeEmptyText, '', 'G02 §3.8 契约 DTO 有完成单不显示空态');
    t.eq(view.summaryText, '本周异常 1 · 取消 2', 'G03 §3.8 契约 DTO → 异常/取消行');
    const emptyView = viewModel.viewOf({
      dto: emptyStatsDto({ range: 'week' }), range: 'week', nowMs: NOW_MS, lastSuccessAt: NOW_MS
    });
    t.eq(emptyView.metrics, {
      completed: 0, rateText: '暂无', active: 0, exceptions: 0, cancelled: 0, todayCompleted: 0
    }, 'G04 §1.3 空统计（TEST_WRITE 会话）四格全 0、完成率暂无');
    t.eq(emptyView.rangeEmptyText, '本周还没有完成订单', 'G05 §3.8 空统计周文案');
    t.eq(emptyView.chartEmpty, true, 'G06 §3.8 空统计不画假柱');
    t.eq(dailyReport.reportOf(emptyStatsDto(), { nowMs: NOW_MS }).visible, false,
      'G07 §9 空统计不出日报（测试数据不进日报）');
    t.eq(dailyReport.reportOf(sampleDto(), { nowMs: NOW_MS }).text,
      '【代取日报】2026-10-22 完成 5 单、异常 1 单；订单 20261021-0031 已送达·待确认 / 20261021-0027 已取件·配送中。',
      'G08 §9 契约 recent(statusText 人话) → 日报端到端');
    t.eq(viewModel.todayDateKeyOf(sampleDto(), NOW_MS), '2026-10-22', 'G09 §7.4 日报日期取 series 末项（今天）');
    t.check(viewModel.viewOf({ dto: sampleDto(), range: 'today', nowMs: NOW_MS, lastSuccessAt: NOW_MS })
      .metrics.todayCompleted === 5, 'G10 §7.4 todayCompleted 任何 range 都可用');
    t.eq(viewModel.jumpUrlOf('/pages/partner/workbench/index', '2026-10-22'),
      '/pages/partner/workbench/index?completedDate=2026-10-22', 'G11 §3.8 跳转 URL 带 completedDate');
    t.eq(viewModel.jumpUrlOf('/pages/partner/workbench/index?x=1', '2026-10-22'),
      '/pages/partner/workbench/index?x=1&completedDate=2026-10-22', 'G12 §3.8 已有 query 时用 & 拼接');
    t.eq(viewModel.jumpUrlOf('/pages/partner/workbench/index', 'bad'), '/pages/partner/workbench/index',
      'G13 §3.8 非法日期不拼参数（退化为普通打开）');
    t.eq(viewModel.jumpUrlOf('', '2026-10-22'), '', 'G14 §3.8 空地址不生成跳转');
    const monthCross = [
      { date: '2026-09-30', label: '09-30', completed: 1 },
      { date: '2026-10-01', label: '10-01', completed: 2 },
      { date: '2026-10-02', label: '10-02', completed: 0 },
      { date: '2026-10-03', label: '10-03', completed: 3 },
      { date: '2026-10-04', label: '10-04', completed: 0 },
      { date: '2026-10-05', label: '10-05', completed: 4 },
      { date: '2026-10-06', label: '10-06', completed: 5 }
    ];
    const crossSeries = viewModel.seriesOf(sampleDto({ series: monthCross }), Date.parse('2026-10-06T02:00:00.000Z'));
    t.eq(crossSeries.map(function label(item) { return item.label; }),
      ['09-30', '10-01', '10-02', '10-03', '10-04', '10-05', '10-06'], 'G15 §7.4 跨月 7 天序列原样消费');
    t.eq(crossSeries.map(function count(item) { return item.completed; }), [1, 2, 0, 3, 0, 4, 5],
      'G16 §7.4 跨月每日完成数不丢值');
    const readonlyView = viewModel.viewOf({
      dto: sampleDto(), range: 'today', nowMs: NOW_MS, lastSuccessAt: NOW_MS, readonly: true
    });
    t.eq(readonlyView.metrics.rateText, '63%', 'G17 §6 READONLY 会话统计正常可读（不被写守卫挡）');
    t.eq(viewModel.seriesOf(sampleDto(), NOW_MS).length, 7, 'G18 §7.4 series 固定 7 项契约');
    t.check(STATUS_LITERALS.length === 7, 'G19 §7.4 七状态枚举来自 shared/order-state 单源');
    t.eq(occurrences(textOf(P.wxml), 'bindtap'), 4, 'G20 §3.8 页面交互入口恰好 4 个（tab/复制日报/复制汇总/跳转）');
  });

  // ---------------------------------------------------------------- H 复制汇总（D48，批 17）
  h.section('§9/D48 H 复制汇总（顾客群口径：只到楼栋级/200 字/空数据不复制/服务端 summary）', (t) => {
    t.check(exists(P.summaryCopy), 'H01 D48 文案纯件 parts/summary-copy.js 存在（页面零本地聚合）');
    const copy = summaryCopy ? summaryCopy.copyOf(sampleSummary()) : null;
    t.eq(copy && copy.text,
      '【代取汇总】当前 8 单（10 件）；东苑 3栋 5单 · 4栋 2单；西苑 2栋 1单。进度：进行中 6 / 已取件 1 / 已送达 1。',
      'H02 D48 文案格式：总单/总件 + 苑/栋聚合（固定 D→X 序）+ 进行中/已取件/已送达');
    t.check(!!copy && copy.text.indexOf('【代取汇总】') === 0, 'H03 D48 标题固定【代取汇总】开头');
    t.eq(copy && copy.copyText, copy && copy.text, 'H04 D48 复制内容=展示内容（单源，不复制看不见的字段）');
    t.eq(copy && [copy.visible, copy.total, copy.parcels, copy.dormCount, copy.truncated, copy.textOmitted],
      [true, 8, 10, 3, false, false], 'H05 D48 视图字段：可复制/总单 8/总件 10/3 栋/未截断（数据与文案两个标记都 false）');
    t.eq(summaryCopy ? summaryCopy.copyOf(null) : null, emptyCopyShape(),
      'H06 D48 无 summary（null）→ 不可复制、零假文案');
    t.eq(summaryCopy ? summaryCopy.copyOf({}) : null, emptyCopyShape(),
      'H07 D48 空对象 → 不可复制（不产出「当前 0 单」假文案）');
    t.eq(summaryCopy ? summaryCopy.copyOf({
      total: 0, parcels: 0, byStatus: { picked: 0, delivered: 0, ongoing: 0 },
      byDorm: [{ zone: 'D', buildingNo: 4, count: 3 }]
    }) : null, emptyCopyShape(), 'H08 D48 total=0（即使有残留 byDorm）→ 不复制假汇总');
    t.eq(summaryCopy ? summaryCopy.copyOf('bad') : null, emptyCopyShape(),
      'H09 D48 非对象入参 → 不可复制（服务端契约外数据不猜）');
    t.eq(summaryCopy ? summaryCopy.copyOf({
      total: '7',
      parcels: -2,
      byStatus: { picked: '2', delivered: Infinity, ongoing: -1 },
      byDorm: [
        { zone: 'D4-522', buildingNo: 1, count: 2 },
        { zone: 'D', buildingNo: 99, count: 3 },
        { zone: 'X', buildingNo: 2, count: 0 },
        { zone: ' D ', buildingNo: 4, count: 1 }
      ]
    }).text : null,
    '【代取汇总】当前 7 单（0 件）；东苑 4栋 1单。进度：进行中 0 / 已取件 2 / 已送达 0。',
    'H10 D48 脏值归一：非法苑/栋/0 单行丢弃，计数夹紧为非负整数');
    t.eq(summaryCopy ? summaryCopy.copyOf(sampleSummary(), { zoneLabels: { D: 'D 区', X: 'X 区' } }).text : null,
      '【代取汇总】当前 8 单（10 件）；D 区 3栋 5单 · 4栋 2单；X 区 2栋 1单。进度：进行中 6 / 已取件 1 / 已送达 1。',
      'H11 D48 苑名走 config.zoneLabels 覆盖（与顾客端展示名同源）');
    t.eq(summaryCopy ? summaryCopy.copyOf(Object.assign({}, sampleSummary(), {
      byDorm: [{ zone: 'D', buildingNo: 4, count: 2 }, { zone: 'D', buildingNo: 4, count: 3 },
        { zone: 'X', buildingNo: 2, count: 1 }]
    })).text : null,
    '【代取汇总】当前 8 单（10 件）；东苑 4栋 5单；西苑 2栋 1单。进度：进行中 6 / 已取件 1 / 已送达 1。',
    'H12 D48 同苑同栋多行合并为一行（服务端应已合并，端侧再兜底不重复列栋）');
    const many = summaryCopy ? summaryCopy.copyOf(manyDormSummary()) : null;
    t.check(!!many && many.text.length <= 200,
      'H13 D48 文案长度上限 200 字（超长按栋数省略，不截半个字/半个栋）');
    t.check(!!many && /…等 \d+ 栋/.test(many.text), 'H14 D48 超长时给出省略栋数标记「…等 N 栋」');
    const included = many ? (many.text.match(/\d+栋 \d+单/g) || []).length : -1;
    const omitted = many ? Number((many.text.match(/…等 (\d+) 栋/) || [])[1]) : -1;
    t.eq(many ? [included + omitted, many.textOmitted, many.dormCount] : null, [50, true, 50],
      'H15 D48 省略口径：已列栋数 + 省略栋数 = 全部 50 栋，textOmitted=true');
    t.check(!!many && many.text.indexOf('【代取汇总】当前 50 单（50 件）；') === 0
      && /。进度：进行中 50 \/ 已取件 0 \/ 已送达 0。$/.test(many.text),
    'H16 D48 超长截断只省略苑/栋部分，总单/进度尾句完整保留');
    t.check(!!copy && copy.text.indexOf('…等') === -1, 'H17 D48 未超长时不加省略标记（不虚报省略）');
    t.eq(summaryCopy ? summaryCopy.copyOf({
      total: 2, parcels: 2, byStatus: { picked: 0, delivered: 0, ongoing: 2 }, byDorm: []
    }).text : null,
    '【代取汇总】当前 2 单（2 件）。进度：进行中 2 / 已取件 0 / 已送达 0。',
    'H18 D48 无苑/栋数据（缺地址单）仍给总单/进度，不编造楼栋行');
    const privacyRaw = Object.assign(sampleSummary(), {
      room: '522', roomTag: 'Z9', pickupCode: '9-1-2333', phoneTail: '8888',
      displayName: '小王', orderNo: '20261022-0001', customerNo: 'CABCDEFGH',
      byDorm: [{ zone: 'D', buildingNo: 3, count: 5, room: '522', roomTag: 'Z9' }],
      byStatus: { picked: 1, delivered: 1, ongoing: 6, exception: 0 }
    });
    const privacyText = summaryCopy ? summaryCopy.copyOf(privacyRaw).text : '';
    t.check(privacyText.indexOf('522') === -1 && privacyText.indexOf('Z9') === -1
      && privacyText.indexOf('9-1-2333') === -1 && privacyText.indexOf('8888') === -1
      && privacyText.indexOf('小王') === -1 && privacyText.indexOf('20261022') === -1
      && privacyText.indexOf('CABCDEFGH') === -1,
    'H19 D48 隐私红线：楼栋级封顶——房间号/roomTag/取件码/尾号/昵称/订单号/顾客编号一概不进文案');
    t.eq(['室', '房间', '取件码', '尾号', '昵称', '单号'].filter(function hit(word) {
      return privacyText.indexOf(word) !== -1;
    }), [], 'H20 D48 文案零敏感字段名（连字段名也不出现）');
    t.check(/^[^A-Za-z]*$/.test(privacyText), 'H21 D48 不暴露原始苑代号/编号英文（只出现中文苑名与数字栋号）');
    t.eq(zeroMoney.scanText(privacyText).length, 0, 'H22 D48 复制文案零金额词表 0 命中（D5/D6）');
    const pageText = textOf(P.page);
    const handlerStart = pageText.indexOf('onCopySummaryTap(');
    const handlerEnd = pageText.indexOf('onTodayCompletedTap(');
    const handlerBody = handlerStart >= 0 && handlerEnd > handlerStart
      ? pageText.slice(handlerStart, handlerEnd) : '';
    t.check(handlerStart !== -1, 'H23 D48 统计页有「复制汇总」点击入口 onCopySummaryTap');
    t.eq(occurrences(pageText, 'orderApi.listPartner('), 1,
      'H24 D48 页面只在复制汇总时调一次 order.listPartner（不预拉、不翻页）');
    t.check(handlerBody.indexOf("view: 'workbench'") !== -1 && handlerBody.indexOf('limit: 1') !== -1,
      'H25 D48 调用入参：view=workbench、limit=1（只为拿服务端 summary，不渲染 list）');
    t.check(handlerBody.indexOf('summaryCopy.copyOf(') !== -1,
      'H26 D48 文案由纯件生成（页面不拼字符串）');
    t.check(pageText.indexOf('栋') === -1 && pageText.indexOf('东苑') === -1 && pageText.indexOf('byDorm') === -1,
      'H27 D48 页面零本地聚合（无苑/栋文案与 byDorm 处理；聚合只在云函数）');
    t.check(!!copy && handlerBody.indexOf('copy.visible') !== -1
      && handlerBody.indexOf('copy.visible') < handlerBody.indexOf('setClipboardData'),
    'H28 D48 无数据不复制：可见性判断先于 setClipboardData');
    t.check(handlerBody.indexOf("'已复制，可发到顾客群'") !== -1,
      'H29 D48 复制成功 toast「已复制，可发到顾客群」');
    const wxmlText = textOf(P.wxml);
    t.check(wxmlText.indexOf('复制汇总') !== -1 && wxmlText.indexOf('bindtap="onCopySummaryTap"') !== -1,
      'H30 D48 WXML「复制汇总」按钮接 onCopySummaryTap');
    t.check(wxmlText.indexOf('只到苑/栋') !== -1 || wxmlText.indexOf('只到楼栋') !== -1,
      'H31 D48 WXML 明示隐私范围（只到苑/栋，读者知道可发群）');
    const moduleText = exists(P.summaryCopy) ? textOf(P.summaryCopy) : '';
    t.check(moduleText.indexOf('wx.cloud') === -1, 'H32 D48 纯件零 wx.cloud 直连');
    t.eq(zeroMoney.scanText(moduleText).length, 0, 'H33 D48 纯件零金额词表 0 命中');
    t.eq(STATUS_LITERALS.filter(function literal(literalText) {
      return moduleText.indexOf("'" + literalText + "'") !== -1;
    }), [], 'H34 D48 纯件零七状态字面量（只消费服务端计数）');
    t.check(moduleText.indexOf('Math.random') === -1 && moduleText.indexOf('getStorageSync') === -1
      && moduleText.indexOf('setStorageSync') === -1, 'H35 D48 纯件零随机/零本地存储');
    t.check(moduleText.indexOf('MAX_TEXT_CHARS') !== -1 && occurrences(pageText, '200') === 0,
      'H36 D48 200 字上限在纯件常量单源声明（页面不重复写死上限）');

    // ---- P1-6：扫描触顶如实说明 + 纯件移主包单源（统计页/工作台共用） ----
    t.check(exists(P.summaryCopy) && !exists(P.summaryCopyMoved),
      'H37 P1-6 纯件单源在主包 pages/partner/workbench/parts；旧 pkg-partner 路径已删除');
    const truncatedCopy = summaryCopy
      ? summaryCopy.copyOf(Object.assign({}, sampleSummary(), { truncated: true })) : null;
    t.check(!!truncatedCopy && truncatedCopy.truncated === true
      && truncatedCopy.text.indexOf('（仅统计最近 8 单，可能少报）') !== -1
      && truncatedCopy.text.indexOf('进度：进行中 6 / 已取件 1 / 已送达 1。') !== -1,
    'H38 P1-6 summary.truncated=true → 文案末尾如实说明「仅统计最近 N 单，可能少报」且进度尾句保留');
    t.eq(truncatedCopy ? [truncatedCopy.textOmitted, truncatedCopy.dormCount] : null, [false, 3],
      'H39 P1-6 少报说明不占用「省略栋数」标记（truncated 与 textOmitted 语义分开）');
    t.check(!!copy && copy.text.indexOf('仅统计最近') === -1,
      'H40 P1-6 未触顶时文案不出现少报说明（不虚报）');
    const manyTruncated = summaryCopy
      ? summaryCopy.copyOf(Object.assign({}, manyDormSummary(), { truncated: true })) : null;
    t.check(!!manyTruncated && manyTruncated.text.length <= 200
      && /…等 \d+ 栋/.test(manyTruncated.text) && manyTruncated.text.indexOf('可能少报') !== -1,
    'H41 P1-6 少报说明计入 200 字上限：仍省略苑/栋并保留如实说明，不截半个字');
    t.eq(summaryCopy ? [
      summaryCopy.copyOf(Object.assign({}, sampleSummary(), { truncated: 1 })).truncated,
      summaryCopy.copyOf(Object.assign({}, sampleSummary(), { truncated: 'true' })).truncated
    ] : null, [false, false], 'H42 P1-6 truncated 只认 boolean true（脏值不误报少报）');
    t.check(handlerBody.indexOf('copy.truncated') !== -1 && handlerBody.indexOf('可能少报') !== -1,
      'H43 P1-6 统计页 toast 在 truncated 时如实提示可能少报');
    t.check(textOf(P.page).indexOf("require('../../../pages/partner/workbench/parts/summary-copy')") !== -1,
      'H44 P1-6 统计页 require 主包单源（不再依赖 pkg 子包副本）');
    t.check(textOf(P.workbenchActions).indexOf('summary-copy') !== -1
      && textOf(P.workbenchWxml).indexOf('onCopySummaryTap') !== -1,
    'H45 P1-5 工作台复用同一纯件（page-actions require + WXML 复制汇总按钮）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-partner-stats' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-partner-stats');
  h.setExpected(EXPECTED_ASSERTIONS === 0 ? -1 : EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
