'use strict';
/**
 * tools/lib/order-workbench-cases.js — selftest-order-workbench 的 M 组用例表（批 20 D53/D54）。
 *
 * 覆盖：
 *   M01~M03  客户端查询口径：「全部」= view=day（今日订单流水），其它 chip 仍 view=workbench + status；
 *   M04~M08  今日流水渲染：单组平铺（group.day、不按站点分组、行序 = 服务端 statusUpdatedAt 倒序）、
 *            活动行保留工具条 / 待确认·已完结行只读、多选资格沿用 bucket 判据、load 刷新行数守恒；
 *   M09~M11  分片渲染：45 行单组、groups[1]/groups[2] 追加键不变、追加片保留 day 标记（站点头不回归）；
 *   M12~M15  页面接线：WXML 站点头 group.day 分支、今日完成跳入仍解析 completedDate、落点=全部并 toast、
 *            counts 点击仅筛选变化时重拉；
 *   M16~M25  服务端契约纯件：_summary.buildDeliveredToday（今日窗口/DELIVERED·COMPLETED/排除取消单/
 *            只到苑·栋/件数/truncated/空值），旧 buildSummary 形状不变，listPartner view=day 接线，
 *            统计页复制汇总同口径；
 *   M26      D51 自动完成时刻默认 22:00（config/defaults 唯一默认源）。
 *
 * 非独立套件：由 tools/selftest-order-workbench require（拆出以控测试文件 ≤1000 行，门禁 #18；
 * tools/lib 不参与 selftest 注册完整性闸，先例 tools/lib/workbench-day-cases.js）。
 * 纪律：不 mock 全局 wx；纯件/云函数纯聚合直测；先合法基线再反例。
 */
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '../..');
// 实际断言数（M01~M26）；与实际不相符由 harness 完整性闸判红
const EXPECTED_ASSERTIONS = 26;

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

// 可选 require：纯件/云函数纯聚合缺失时给可定位红，而不是整段崩掉
function optionalRequire(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (err) {
    return null;
  }
}

// D54 原始订单文档夹具（_summary.buildDeliveredToday 吃 raw doc，不依赖 DTO）
function rawOrder(no, status, deliveredAt, extra) {
  const doc = {
    orderNo: no,
    status: status,
    deliveredAt: deliveredAt,
    parcels: [{ pickupCode: '1-1-1' }],
    delivery: { zone: 'D', buildingNo: 4 }
  };
  return Object.assign(doc, extra || {});
}

function dayFlowChecks(t, deps) {
  const groupView = deps.groupView;
  const loadView = deps.loadView;
  const filterView = deps.filterView;
  const summaryPure = optionalRequire('cloudfunctions/api/handlers/order/_summary.js');
  const now = deps.DOC_MS;
  const STATUS = deps.STATUS;
  const listed = [
    deps.dto(STATUS.PICKED, { orderNo: 'D-1' }),
    deps.dto(STATUS.SUBMITTED, { orderNo: 'D-2' }),
    deps.dto(STATUS.DELIVERED, { orderNo: 'D-3' }),
    deps.dto(STATUS.COMPLETED, { orderNo: 'D-4' }),
    deps.dto(STATUS.CANCELLED, { orderNo: 'D-5' })
  ];

  // ── M01~M03 查询口径 ─────────────────────────────────────────────────────
  t.eq([filterView.isAll('all'), filterView.isAll(''), filterView.isActive('all')], [true, true, false],
    'M01 全部=今日流水口径：isAll（all/缺省）且不当作状态 chip');
  t.eq(loadView.queryOf({ filterKey: 'all' }), { view: 'day', limit: loadView.PAGE_LIMIT },
    'M02 「全部」请求 view=day（今日七状态流水，窗口/排序由服务端收口）');
  t.eq(loadView.queryOf({ filterKey: 'accepted' }),
    { view: 'workbench', limit: loadView.PAGE_LIMIT, status: deps.enums.ORDER_STATUS.ACCEPTED },
    'M03 其它 chip 仍 view=workbench + status（逐项基线不变）');

  // ── M04~M08 今日流水渲染 ─────────────────────────────────────────────────
  const dayGroups = groupView.buildDayGroups(listed, now);
  t.eq([dayGroups.length, dayGroups[0].day, dayGroups[0].stationId, dayGroups[0].count], [1, true, '', 5],
    'M04 今日流水单组平铺（不按站点分组：1 组 / day 标记 / 零站点键）');
  t.eq(dayGroups[0].rows.map((row) => row.orderNo), ['D-1', 'D-2', 'D-3', 'D-4', 'D-5'],
    'M05 行序 = 服务端 statusUpdatedAt 倒序原样（客户端不二次四档排序）');
  t.eq(dayGroups[0].rows.filter((row) => row.toolbar.primary.length || row.toolbar.secondary.length)
    .map((row) => row.orderNo), ['D-1', 'D-2'],
  'M06 活动行保留行工具条；待确认/已完成/已取消行无写操作（D54）');
  t.eq([filterView.canSelect(dayGroups[0].rows[0]), filterView.canSelect(dayGroups[0].rows[2]),
    filterView.canSelect(dayGroups[0].rows[3])], [true, false, false],
  'M07 多选资格沿用服务端 bucket 判据（待确认/已完结不可勾选）');
  const refresh = loadView.applyRefresh({ list: [], page1Keys: [] },
    { list: listed, counts: loadView.COUNTS_FALLBACK }, { filterKey: 'all', nowMs: now });
  t.eq([refresh.groups.length, refresh.groups[0].day, refresh.totalRows], [1, true, 5],
    'M08 load 刷新走今日流水（单组平铺、行数守恒）');
  const chipRefresh = loadView.applyRefresh({ list: [], page1Keys: [] },
    { list: listed, counts: loadView.COUNTS_FALLBACK }, { filterKey: 'picked', nowMs: now });
  t.check(chipRefresh.groups.length > 0 && chipRefresh.groups[0].day !== true,
    'M09 状态 chip 仍是站点分组（day 标记不泄漏到其它 chip，基线）');

  // ── M10~M12 分片渲染（≤20 行/片；追加只发新组路径）────────────────────────
  const manyList = [];
  for (let i = 0; i < 45; i += 1) {
    manyList.push(deps.dto(STATUS.PICKED, { orderNo: 'DF-' + i, version: 1 }));
  }
  const manyPlan = loadView.applyRefresh({ list: [], page1Keys: [] },
    { list: manyList, counts: loadView.COUNTS_FALLBACK }, { filterKey: 'all', nowMs: now });
  t.eq([manyPlan.groups.length, manyPlan.groups[0].count, manyPlan.groups[0].day], [1, 45, true],
    'M10 45 行今日流水仍单业务组（分片在 setData 层，不拆业务组）');
  const manyPatch = loadView.resultPatch(manyPlan, { filterKey: 'all', poll: false, selecting: false });
  t.eq(manyPatch.appendPatches.map((patch) => Object.keys(patch)), [['groups[1]'], ['groups[2]']],
    'M11 分片追加键不变（groups[1]/groups[2]，不重发已渲染组）');
  t.check(manyPatch.appendPatches[0]['groups[1]'].day === true,
    'M12 追加片保留 day 标记（站点头不回归）');

  // ── M13~M16 页面接线（静态守卫）──────────────────────────────────────────
  const wxml = deps.textOf(deps.PAGES.wxml);
  t.check(wxml.indexOf('今日订单流水') !== -1 && wxml.indexOf('group.day') !== -1,
    'M13 WXML 站点头按 group.day 分支（今日流水不显示站点卡头/全选本站）');
  const indexSrc = deps.textOf(deps.PAGES.index);
  t.check(indexSrc.indexOf('applyCompletedFocus') !== -1 && indexSrc.indexOf('completedDate') !== -1,
    'M14 今日完成跳入仍解析 completedDate（统计页跳转口径保留）');
  const actionsSrc = deps.textOf(deps.PAGES.actions);
  t.check(actionsSrc.indexOf('focusTodayFlow(') !== -1 && actionsSrc.indexOf('今日完成的单都在「全部」里') !== -1,
    'M15 今日完成落点=「全部」今日流水并 toast 说明（D53）');
  t.check(actionsSrc.indexOf('target.filter !== this.data.filter') !== -1,
    'M16 counts 点击只在筛选变化时重拉（当前即全部不重复请求）');

  // ── M17~M24 服务端「今日已送达」聚合纯件（_summary.buildDeliveredToday）──
  const rows = [
    rawOrder('S-1', 'DELIVERED', '2026-10-22T01:00:00.000Z'),
    rawOrder('S-2', 'COMPLETED', '2026-10-22T00:10:00.000Z'),
    rawOrder('S-3', 'COMPLETED', '2026-10-21T15:59:59.000Z'),
    rawOrder('S-4', 'CANCELLED', '2026-10-22T00:30:00.000Z'),
    rawOrder('S-5', 'SUBMITTED', '2026-10-22T00:20:00.000Z'),
    rawOrder('S-6', 'DELIVERED', ''),
    rawOrder('S-7', 'DELIVERED', '2026-10-22T02:00:00.000Z', {
      delivery: { zone: 'X', buildingNo: 2 },
      parcels: [{ pickupCode: '2-2-2' }, { pickupCode: '3-3-3' }]
    })
  ];
  const built = summaryPure ? summaryPure.buildDeliveredToday(rows, { nowMs: now }) : null;
  t.eq(built && [built.scope, built.total, built.parcels, built.completed, built.pending, built.truncated],
    ['deliveredToday', 2, 2, 1, 1, false],
    'M17 今日已送达聚合：DELIVERED/COMPLETED + 今日窗口，排除取消/非目标状态/缺失或未来 deliveredAt');
  t.eq(built && built.byDorm, [{ zone: 'D', buildingNo: 4, count: 2 }],
    'M18 只到苑/栋：缺地址或未来时刻行不入栋（不猜地址）');
  const boundary = summaryPure ? summaryPure.buildDeliveredToday([
    rawOrder('B-1', 'DELIVERED', '2026-10-21T16:00:00.000Z'),
    rawOrder('B-2', 'DELIVERED', '2026-10-21T15:59:59.999Z'),
    rawOrder('B-3', 'DELIVERED', '2026-10-22T01:20:00.000Z')
  ], { nowMs: now }) : null;
  t.eq(boundary && [boundary.total, boundary.pending], [2, 2],
    'M19 窗口边界：今日 0 点整/此刻算今日，前 1ms 算昨日（UTC+8 日界）');
  const addr = summaryPure ? summaryPure.buildDeliveredToday([
    rawOrder('A-1', 'DELIVERED', '2026-10-22T01:00:00.000Z', {
      delivery: { zone: 'X', buildingNo: 3 },
      dorm: { zone: 'D', buildingNo: 9 }
    }),
    rawOrder('A-2', 'DELIVERED', '2026-10-22T01:00:00.000Z', { delivery: null, dorm: { zone: 'N', buildingNo: 1 } }),
    rawOrder('A-3', 'DELIVERED', '2026-10-22T01:00:00.000Z', {
      delivery: { zone: 'BAD', buildingNo: 0 },
      dorm: { zone: 'B', buildingNo: 2 }
    })
  ], { nowMs: now }) : null;
  t.eq(addr && addr.byDorm.map((row) => row.zone + row.buildingNo), ['X3', 'N1', 'B2'],
    'M20 地址取配送快照优先、非法/缺失回退下单地址，苑序固定 D→X→N→B→C');
  const truncated = summaryPure ? summaryPure.buildDeliveredToday(rows, { nowMs: now, truncated: true }) : null;
  t.eq(truncated && truncated.truncated, true, 'M21 扫描触顶 truncated 如实透传（显式 true 才算）');
  t.eq(summaryPure ? summaryPure.buildDeliveredToday(rows, { nowMs: now }).truncated : null, false,
    'M22 未触顶不误报 truncated（合法基线）');
  t.eq(summaryPure ? summaryPure.buildDeliveredToday([], { nowMs: now }) : null,
    { scope: 'deliveredToday', total: 0, parcels: 0, completed: 0, pending: 0, byDorm: [], truncated: false },
    'M23 空 rows → 零值形状（不产生假数据）');
  t.check(!!summaryPure && typeof summaryPure.buildSummary === 'function'
    && summaryPure.buildSummary([], {}).total === 0
    && Object.keys(summaryPure.buildSummary([], {})).sort().join(',') === 'byDorm,byStatus,parcels,total,truncated',
    'M24 旧 D48 buildSummary 仍导出且形状不变（向后兼容，查询窗口簇依赖）');

  // ── M25~M26 服务端/统计页接线 + D51 默认时刻 ─────────────────────────────
  const handlerSrc = fsutil.stripComments(textOf('cloudfunctions/api/handlers/order/listPartner.js'));
  t.check(handlerSrc.indexOf("const DAY_VIEW = 'day'") !== -1
    && handlerSrc.indexOf('view === DAY_VIEW') !== -1
    && handlerSrc.indexOf('statusUpdatedAt: ctx.dao.command(') !== -1
    && handlerSrc.indexOf('list = stripWriteActionsOf(list)') !== -1
    && handlerSrc.indexOf('buildDeliveredToday(result.scanRows') !== -1,
    'M25 服务端 view=day 接线：七状态 + 今日 statusUpdatedAt 下界 + 剥待确认/已完结写操作 + 今日已送达聚合');
  const defaultsCfg = optionalRequire('config/defaults.js');
  t.eq(defaultsCfg && defaultsCfg.DEFAULT_CONFIG.autoCompleteAt, '22:00',
    'M26 D51 自动完成时刻默认 22:00（唯一默认源 config/defaults）');
}

module.exports = { EXPECTED_ASSERTIONS, dayFlowChecks };
