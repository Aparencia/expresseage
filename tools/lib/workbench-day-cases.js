'use strict';
/**
 * tools/lib/workbench-day-cases.js — selftest-order-workbench 的 J 组用例表：
 * 工作台日期分类（D45=M1，2026-11-01 批 16 研究后按推荐实施）+ 性能 P0-5 增量渲染。
 *
 * 覆盖（research 2026-11-01_WORKBENCH_DATE_GROUPING §4.1 A1~A8 + PERFORMANCE_2026-11-01 §5 P0-5）：
 *   A1 UTC+8 日界（固定 nowMs 入参，不读系统时间，跨 0 点）；
 *   A2 未送达跨日「顺延 N 天」（N = 今天 0 点 − 下单日 0 点的自然日数）；
 *   A3 合并单归属首单 createdAt（跑真实 _merge 追加路径：更新字段集不含 createdAt、version+1）；
 *   A4 已送达/已完结不标顺延，且已完结行按 createdAt 归日（completedAt 只做展示/统计）；
 *   A5 分节计数与总条数一致（今天/昨天/更早 + 日期标题，UTC+8）；
 *   A6 结构签名只由站点+orderNo 决定（新增行字段/跨日不改变签名 → 行级补丁路径不被打断）；
 *   A7 页面/纯件零日期判据（无 setHours）、日界常量与公式单源在 parts/day-view.js；
 *   A8 顺延文案只在 day-view 出现一次，页面/wxml/其它纯件零字面量；
 *   P0-5 分组结构变化只发变化组（groups[i] 路径补丁）、分片追加不重发已渲染组；
 *   J36~J38 接线静态：页面真消费 day-view/prevGroups/appendPatches，wxml 标签/面板头/样式接入。
 *
 * 非独立套件：由 selftest-order-workbench require 后调用（拆出以控测试文件 ≤1000 行，门禁 #18）。
 * 口径：CONTRACT §13 D45；UX_PARTNER §4.10/§4.15；DATA_MODEL §7.5（分区锚=createdAt，不改服务端排序/索引）。
 */
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '../..');

// 固定入参（不读系统时间）：UTC+8 2026-11-01 00:00:01 当地
const J_NOW = Date.parse('2026-11-01T00:00:01.000+08:00');
const J_TODAY_START = Date.parse('2026-11-01T00:00:00.000+08:00');
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPECTED_ASSERTIONS = 38;

// 可选 require：新纯件缺失时给出可定位的红（J01），而不是整个套件崩掉
function optionalRequire(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (err) {
    return null;
  }
}

// A3：真实 _merge 追加路径（fake 事务捕获更新字段）——验证 createdAt 不进更新集、version+1
function mergeFixture(deps) {
  const merge = optionalRequire('cloudfunctions/api/handlers/order/_merge.js');
  const delivery = { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', recipientName: '小王', phoneTail: '6678' };
  const fresh = Object.assign(deps.orderDoc(deps.STATUS.SUBMITTED), { delivery: delivery, parcels: [], images: [] });
  const captured = {};
  const trx = {
    get: () => Promise.resolve(fresh),
    updateWhere: (collection, where, patch) => {
      captured.patch = patch;
      return Promise.resolve({ updated: 1 });
    },
    add: () => Promise.resolve({ _id: 'event-append' }),
    update: () => Promise.resolve({})
  };
  const ctx = {
    dao: {
      transaction: (fn) => fn(trx),
      isDuplicateError: () => false,
      get: () => Promise.resolve(fresh),
      find: () => Promise.resolve([]),
      findOne: () => Promise.resolve(null)
    },
    impersonatedBy: ''
  };
  const input = {
    parcels: [{ stationId: 'P4', stationName: '北部菜鸟驿站', pickupCode: '27-2-7016', imageIndex: 0 }],
    images: [],
    tickets: [],
    delivery: delivery,
    service: { code: 'PICKUP_STD' },
    appoint: { type: 'ASAP' },
    note: ''
  };
  const context = { scope: { role: 'CUSTOMER', openid: 'openid-j' } };
  if (!merge) {
    return Promise.resolve({ fresh: fresh, patch: {}, result: null });
  }
  return merge.appendWithRetry(ctx, fresh, input, context, 'client-req-j', new Date(deps.DOC_MS))
    .then((result) => ({ fresh: fresh, patch: captured.patch || {}, result: result }));
}

function parcelAt(stationId, stationName, pickupCode) {
  return {
    stationId: stationId,
    stationName: stationName,
    pickupCode: pickupCode,
    lockerNo: '',
    trackingTail: '',
    codeStatus: 'OK',
    codeStatusText: ''
  };
}

async function dayGroupingChecks(t, deps) {
  const dayView = optionalRequire('pages/partner/workbench/parts/day-view.js');
  const groupView = deps.groupView;
  const historyView = deps.historyView;
  const loadView = deps.loadView;
  t.check(!!dayView, 'J01 day-view 纯件存在（UTC+8 日界收敛到一处，D45）');
  if (!dayView) {
    return;
  }

  // ── A1 UTC+8 日界（固定 nowMs；跨 0 点）────────────────────────────────────
  t.eq(dayView.dayStartMs(J_NOW), J_TODAY_START, 'J02 A1 日界起点 = UTC+8 当日 0 点（不随本机时区漂移）');
  t.eq([dayView.dayKeyOf(J_TODAY_START - 1, J_NOW), dayView.dayKeyOf(J_TODAY_START, J_NOW)],
    ['yesterday', 'today'], 'J03 A1 跨 0 点：日界前 1ms 归昨天、当刻归今天');
  t.eq([dayView.yesterdayStartMs(J_NOW), dayView.dayKeyOf(J_TODAY_START - DAY_MS, J_NOW)],
    [J_TODAY_START - DAY_MS, 'yesterday'], 'J04 A1 昨天起点=今天-1 天、该时刻归昨天（UTC+8 自然日）');

  // ── A2 未送达跨日「顺延 N 天」──────────────────────────────────────────────
  t.eq(dayView.delayDaysTextOf({ bucket: 'accepted', createdAt: '2026-10-31T23:59:59+08:00' }, J_NOW), '顺延 1 天',
    'J05 A2 跨零点 1 秒 → 顺延 1 天（不是 0）');
  t.eq(dayView.delayDaysTextOf({ bucket: 'accepted', createdAt: '2026-10-30T23:59:59+08:00' }, J_NOW), '顺延 2 天',
    'J06 A2 顺延标签文案由纯函数生成（页面不拼字面量）');
  t.eq([dayView.delayDaysTextOf({ bucket: 'accepted', createdAt: '2026-11-01T00:00:00+08:00' }, J_NOW),
    dayView.delayDaysTextOf({ bucket: 'accepted' }, J_NOW)], ['', ''], 'J07 A2 当日单/无 createdAt 不标顺延');

  // ── A4 已送达/已完结不标顺延；已完结行归下单日 ─────────────────────────────
  const completedPair = historyView.buildHistoryRows([{
    orderNo: 'JC-1',
    status: deps.STATUS.COMPLETED,
    bucket: 'history',
    createdAt: '2026-10-30T10:00:00+08:00',
    completedAt: '2026-11-01T09:00:00+08:00',
    statusUpdatedAt: '2026-11-01T09:00:00+08:00',
    version: 3
  }], J_NOW)[0];
  t.eq([completedPair.dayKey, completedPair.delayDaysText], ['earlier', ''],
    'J08 A4 已完结行锚 createdAt（不是完成日）且不标顺延');
  const deliveredRow = groupView.toRow(deps.dto(deps.STATUS.DELIVERED, { createdAt: '2026-10-30T10:00:00+08:00' }), J_NOW);
  t.eq(deliveredRow.delayDaysText, '', 'J09 A4 待确认（DELIVERED）不标顺延（不提前归档）');
  const activeRow = groupView.toRow(deps.dto(deps.STATUS.ACCEPTED, { createdAt: '2026-10-30T10:00:00+08:00' }), J_NOW);
  t.eq(activeRow.delayDaysText, '顺延 2 天', 'J10 A4 进行中跨日行带「顺延 N 天」标签（2 天）');

  // ── A5 分节计数与 total 一致（两套日不打架）───────────────────────────────
  const historyRows = [
    { orderNo: 'JA-1', status: deps.STATUS.COMPLETED, bucket: 'history', createdAt: '2026-11-01T00:00:00+08:00', completedAt: '2026-11-01T00:00:00+08:00' },
    { orderNo: 'JA-2', status: deps.STATUS.COMPLETED, bucket: 'history', createdAt: '2026-10-31T23:59:59+08:00', completedAt: '2026-11-01T00:00:00+08:00' },
    { orderNo: 'JA-3', status: deps.STATUS.CANCELLED, bucket: 'history', createdAt: '2026-10-20T10:00:00+08:00', cancelledAt: '2026-10-21T10:00:00+08:00' }
  ];
  const historySections = historyView.sectionsOf(historyRows, J_NOW);
  t.eq(historySections.reduce((sum, section) => sum + section.count, 0), historyRows.length,
    'J11 A5 各分节条数之和 = 已加载条数（不丢单）');
  t.eq(historySections.map((section) => section.key), ['today', 'yesterday', 'earlier'],
    'J12 A5 三桶顺序：今天 → 昨天 → 更早（空桶不渲染）');
  t.eq(historySections.map((section) => section.label), ['今天 · 11-01', '昨天 · 10-31', '更早'],
    'J13 A5 分节标题带日期（按 createdAt 归档，UTC+8）');
  t.eq(historySections[1].rows.map((item) => item.orderNo), ['JA-2'],
    'J14 A5 「今天完成但昨天下单」的单归昨天分节（锚=下单日）');

  // ── A6 结构签名稳定（新增行字段/跨日不改签名 → 行级补丁不断）─────────────
  const twoStations = [
    deps.dto(deps.STATUS.ACCEPTED, { orderNo: 'JS-1', version: 1 }),
    deps.dto(deps.STATUS.ACCEPTED, {
      orderNo: 'JS-2',
      version: 1,
      parcel: parcelAt('P6', '南苑菜鸟驿站', '11-1-2002')
    })
  ];
  const prevGroups = groupView.buildGroups(twoStations, J_NOW);
  const laterGroups = groupView.buildGroups(twoStations, J_NOW + 3 * DAY_MS);
  t.eq(groupView.signatureOf(laterGroups), groupView.signatureOf(prevGroups),
    'J15 A6 结构签名只由站点+orderNo 决定（跨日/行字段变化不打断行级补丁路径）');

  // ── P0-5 结构变化只发变化组 ───────────────────────────────────────────────
  const grown = groupView.buildGroups(twoStations.concat([deps.dto(deps.STATUS.SUBMITTED, { orderNo: 'JS-3' })]), J_NOW);
  const structural = groupView.structuralPatch(prevGroups, grown);
  const changedIndex = groupView.findRow(grown, 'JS-3').groupIndex;
  t.eq(structural.mode, 'groups', 'J16 P0-5 结构变化 → 只发变化组补丁（不整表替换）');
  t.eq(Object.keys(structural.patches), ['groups[' + changedIndex + ']'],
    'J17 P0-5 未变化的站点组不重发（补丁键只有变化组）');
  t.eq(structural.patches['groups[' + changedIndex + ']'].rows.length, 2,
    'J18 P0-5 变化组补丁内容 = 该组新行集（含新单）');
  t.eq(groupView.structuralPatch(prevGroups, groupView.buildGroups([twoStations[0]], J_NOW)).mode, 'replace',
    'J19 P0-5 站点组减少 → 整表替换（不残留尾部站点卡）');
  const many = [];
  for (let i = 0; i < 45; i += 1) {
    many.push(deps.dto(deps.STATUS.ACCEPTED, { orderNo: 'JM-' + i, version: 1 }));
  }
  const manyPlan = loadView.applyRefresh({ list: [], page1Keys: [] }, {
    list: many, counts: loadView.COUNTS_FALLBACK
  }, { filterKey: 'all', nowMs: J_NOW });
  const manyPatch = loadView.resultPatch(manyPlan, { filterKey: 'all', poll: false, selecting: false });
  const appendSteps = manyPatch.appendPatches.map((patches) => Object.keys(patches));
  t.eq(appendSteps, [['groups[1]'], ['groups[2]']],
    'J20 P0-5 分片追加只发新组索引（已渲染组不重发）');
  t.check(appendSteps.every((keys) => keys.indexOf('groups') === -1),
    'J21 P0-5 追加补丁不含整表 groups 键（不重发已渲染组）');
  const firstPlan = loadView.applyRefresh({ list: [], page1Keys: [] }, {
    list: twoStations, counts: loadView.COUNTS_FALLBACK
  }, { filterKey: 'all', nowMs: J_NOW });
  const grownPlan = loadView.applyRefresh(firstPlan, {
    list: twoStations.concat([deps.dto(deps.STATUS.SUBMITTED, { orderNo: 'JS-3' })]),
    counts: firstPlan.counts
  }, { filterKey: 'all', nowMs: J_NOW });
  const grownPatch = loadView.resultPatch(grownPlan, {
    filterKey: 'all',
    poll: false,
    selecting: false,
    prevGroups: firstPlan.groups,
    nowMs: J_NOW
  });
  t.eq(grownPatch.mode, 'groups', 'J22 P0-5 结构变化刷新 → groups 补丁分支（不再首片整发）');
  t.eq(grownPatch.setData.groups, undefined, 'J23 P0-5 结构变化分支不下发整表 groups');
  t.check(grownPatch.setData['groups[' + changedIndex + ']'] !== undefined,
    'J24 P0-5 变化组走 groups[n] 路径 setData');
  t.eq(loadView.resultPatch(firstPlan, { filterKey: 'all', poll: false, selecting: false }).mode, 'replace',
    'J25 P0-5 首屏无 prevGroups 仍走分片 replace（不瞎补丁）');

  // ── A7 页面/纯件零日期判据（日界单源在 day-view）───────────────────────────
  const pageSrc = fsutil.stripComments(deps.textOf(deps.PAGES.index));
  const partRel = ['history-view', 'group-view', 'load-view', 'day-view']
    .map((name) => 'pages/partner/workbench/parts/' + name + '.js');
  const partSrc = partRel.map((rel) => fsutil.stripComments(deps.textOf(rel))).join('\n');
  t.check(!/setHours|setUTCHours/.test(pageSrc + partSrc),
    'J26 A7 页面/纯件无 setHours 本地时区判据');
  t.eq([historyView.TZ_OFFSET_MS, historyView.DAY_MS], [dayView.TZ_OFFSET_MS, dayView.DAY_MS],
    'J27 A7 日界常量单源（history-view 复用 day-view，不再各自定义）');
  t.check(!/nowMs \+ TZ_OFFSET_MS\) % DAY_MS/.test(fsutil.stripComments(deps.textOf(partRel[0]))),
    'J28 A7 日界公式不再重复在 history-view 定义');

  // ── A8 顺延文案单源 ───────────────────────────────────────────────────────
  const daySrc = fsutil.stripComments(deps.textOf(partRel[3]));
  const otherSrc = partRel.slice(0, 3).map((rel) => fsutil.stripComments(deps.textOf(rel)))
    .concat([fsutil.stripComments(deps.textOf(deps.PAGES.index)), fsutil.stripComments(deps.textOf(deps.PAGES.wxml))])
    .join('\n');
  t.eq((daySrc.match(/顺延/g) || []).length, 1, 'J29 A8 顺延文案只在 day-view 出现一次（单源）');
  t.eq((otherSrc.match(/顺延/g) || []).length, 0, 'J30 A8 页面/wxml/其它纯件零顺延文案字面量');

  // ── A3 合并单归属首单 createdAt（真实 _merge 追加路径）────────────────────
  const merged = await mergeFixture(deps);
  t.eq(merged.patch.createdAt, undefined, 'J31 A3 合并追加的更新字段集合不含 createdAt');
  t.eq(merged.patch.version, merged.fresh.version + 1, 'J32 A3 合并追加 version+1（状态不变）');
  t.eq(dayView.createdMsOf(merged.result && merged.result.order), deps.DOC_MS,
    'J33 A3 合并后订单 createdAt 不变 → 归首单下单日');
  t.eq(dayView.createdMsOf({
    createdAt: deps.ISO,
    statusUpdatedAt: '2026-11-01T09:00:00+08:00',
    completedAt: '2026-11-01T09:00:00+08:00'
  }), deps.DOC_MS, 'J34 A3 分区锚只认 createdAt（不认 statusUpdatedAt/completedAt）');
  t.notEmpty(historySections, 'J35 J 组样本非空');

  // ── 接线（页面真消费纯件；静态扫描防回退）────────────────────────────────
  const indexSrc = fsutil.stripComments(deps.textOf(deps.PAGES.index));
  t.check(indexSrc.indexOf("require('./parts/day-view')") >= 0
    && indexSrc.indexOf('dayView.dayDateKeyOf(') >= 0 && indexSrc.indexOf('TZ_OFFSET_MS') < 0,
    'J36 A7 页面接线：日界/日期键全走 parts/day-view（页面零本地时区常量）');
  // 批 26（D58）：加载/增量渲染接线按门禁 #18 拆到 parts/load-flow（页面已 499/500 行），
  // 判据改为「纯件仍逐字保留行为 + 页面经 require 接线」，防拆件时把 prevGroups/appendPatches 丢掉
  const flowSrc = fsutil.stripComments(deps.textOf('pages/partner/workbench/parts/load-flow.js'));
  const resultFlow = flowSrc.slice(flowSrc.indexOf('applyResult('));
  t.check(resultFlow.indexOf('prevGroups: prev.groups') >= 0
    && resultFlow.indexOf('nowMs: Date.now()') >= 0
    && resultFlow.indexOf('this.appendChunks(result.appendPatches') >= 0
    && flowSrc.indexOf('.concat(rest[0])') < 0
    && indexSrc.indexOf("require('./parts/load-flow')") >= 0,
    'J37 P0-5 页面接线：刷新透传 prevGroups/nowMs、分片追加只发 appendPatches（不再整表 concat）');
  const wxmlSrc = deps.textOf(deps.PAGES.wxml);
  t.check(wxmlSrc.indexOf('row.delayDaysText') >= 0 && wxmlSrc.indexOf('按下单日分') >= 0
    && deps.textOf('pages/partner/workbench/parts/order-row.wxss').indexOf('.delay-tag') >= 0,
    'J38 D45/M1 视图接线：行内延迟标签 + 已完结面板头「按下单日分」+ .delay-tag 样式');
}

module.exports = { EXPECTED_ASSERTIONS, dayGroupingChecks };
