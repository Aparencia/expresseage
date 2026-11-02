'use strict';
/**
 * tools/selftest-order-workbench.js — 批 6-B「兼职工作台」端侧断言套件（ENGINEERING §7.2 register 聚合形态）。
 *
 * 覆盖（task-69 A~F + Lead 追加）：
 *   A. 多选资格（DELIVERED/COMPLETED/CANCELLED 不可勾选）与批量计划：客户端循环 + 同一 batchActionId、
 *      逐单结果、部分失败保留失败选中 + 一键重试、禁止把部分成功显示为全部成功；
 *   B. 撤销条策略：仅 pick/deliver、5s 倒计时、批量同一 batchActionId、部分失败文案「N 单撤销成功，M 单顾客已确认，不能撤销」；
 *   C. 筛选/搜索/分页/轮询增量：状态 chip 走服务端 status、需查明 client 过滤、筛空 vs 真空、
 *      按 orderNo/version 合并、仅变化行 setData 行级补丁、列表无变化 counts 仍更新、分片 ≤20 行、红点 patch 保留 messages；
 *   D. 首用引导三步 + 兼职编号行（partnerNo 空/非法不造假）+ utils/storage 引导标记读写；
 *   E. 行级动作只消费服务端 actions[]（无 actions 不显示、面板校验/请求包络 expectedVersion、补码后跳下一条需查明）；
 *   F. 静态纪律：页面零 wx.cloud / 零七状态字面量 / 零 random / 不直调 client.call / 写动作带 expectedVersion /
 *      行渲染不出现 openid；有牙反例证明扫描能红；
 *   G. 异步联调：真实 _dto.buildOrderDto 七状态 actions 与行工具逐格一致、批量循环共享 batchActionId、批量撤销同 id。
 *   K. 修复批 T3：P1-4 已完结两阶段翻页状态机（窗口内 cursor 续页 → 窗口耗尽转 older 首屏无游标、
 *      hasMore 先 true 直到 older 空）+ 页面接线；P1-5 工作台复制汇总（主包单源纯件 + load 的 summary、
 *      零额外请求）；P1-6 summary.truncated 时文案/toast 如实说明「可能少报」。
 *   L. 修复批 T5-B（TD-083）：批量送达确认文案的「系统每天 X 自动完成」时刻按调用方注入的
 *      config.autoCompleteAt 生成；缺配置/非法一律回退出厂默认（唯一默认单源 = config/defaults），
 *      纯件零第二处时刻字面量 + 页面/action-flow 注入接线静态守卫。
 *
 * 拆件：夹具/静态样本拆到 tools/lib/workbench-cases.js（控测试文件 ≤1000 行，门禁 #18；
 *       tools/lib 不参与 selftest 注册完整性闸，先例 tools/lib/workbench-day-cases.js）。
 *
 * 纪律：不 mock 全局 wx（本套只测纯件与真实 DTO；storage 用显式 platform 注入是既有公开能力）；
 *       先合法基线再反例；样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等。
 * 取数：node tools/selftest-order-workbench.js
 */
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard } = require('./selftest');

const ROOT = path.resolve(__dirname, '..');

const groupView = require(path.join(ROOT, 'pages/partner/workbench/parts/group-view.js'));
const filterView = require(path.join(ROOT, 'pages/partner/workbench/parts/filter-view.js'));
const rowActions = require(path.join(ROOT, 'pages/partner/workbench/parts/row-actions.js'));
const batchView = require(path.join(ROOT, 'pages/partner/workbench/parts/batch-view.js'));
const selectionFlow = require(path.join(ROOT, 'pages/partner/workbench/parts/selection-flow.js'));
const actionFlow = require(path.join(ROOT, 'pages/partner/workbench/parts/action-flow.js'));
const undoView = require(path.join(ROOT, 'pages/partner/workbench/parts/undo-view.js'));
const loadView = require(path.join(ROOT, 'pages/partner/workbench/parts/load-view.js'));
const historyView = require(path.join(ROOT, 'pages/partner/workbench/parts/history-view.js'));
const guideView = require(path.join(ROOT, 'pages/partner/workbench/parts/guide-view.js'));
const parcelView = require(path.join(ROOT, 'pages/partner/workbench/parts/parcel-view.js'));
const pieceActions = require(path.join(ROOT, 'pages/partner/workbench/parts/piece-actions.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const orderState = require(path.join(ROOT, 'shared/order-state.js'));
const storage = require(path.join(ROOT, 'utils/storage.js'));
const serverDto = require(path.join(ROOT, 'cloudfunctions/api/handlers/order/_dto.js'));
const defaults = require(path.join(ROOT, 'config/defaults.js'));
const dayCases = require(path.join(__dirname, 'lib', 'workbench-day-cases.js'));
// 批 20（D53/D54）：今日订单流水 + 今日已送达汇总用例表（拆 tools/lib，控测试文件 ≤1000 行，门禁 #18）
const orderCases = require(path.join(__dirname, 'lib', 'order-workbench-cases.js'));
// TD-083 拆件：夹具/静态样本拆到 tools/lib/workbench-cases.js（控测试文件 ≤1000 行，门禁 #18）
const cases = require(path.join(__dirname, 'lib', 'workbench-cases.js'));
// 批 25-B（D61/D62）：件级取件 + 多站点分组用例表（拆 tools/lib，控测试文件 ≤1000 行，门禁 #18）
const pickedCases = require(path.join(__dirname, 'lib', 'workbench-picked-cases.js'));
const {
  STATUS, STATUS_LITERALS, PAGES, ISO, DOC_MS,
  actionsFor, dto, multiDto, manualDto, row, rowsOf, groupsOf, selectedNames, orderDoc, FAKE_DTO_CTX
} = cases;
// P1-5/P1-6：复制汇总纯件单源（主包 parts，工作台与统计页共用）；缺件时 optionalRequire 给逐条可定位红。
const summaryCopy = optionalRequire('pages/partner/workbench/parts/summary-copy.js');

const EXPECTED_ASSERTIONS = 235 + dayCases.EXPECTED_ASSERTIONS + 33 + 15 + orderCases.EXPECTED_ASSERTIONS
  + pickedCases.EXPECTED_ASSERTIONS + 6; // A~N 实际断言总数（批 25-B：N 组用例表见 lib；G15~G20 真实 DTO 联调）
function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

// 可选 require：新纯件缺失时给出可定位的红（J01），而不是整个套件崩掉
function optionalRequire(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (err) {
    return null;
  }
}

// 页面层扫描（有牙正控/反例）：零 wx.cloud / 零七状态字面量 / 零 random / 不直调 client.call
function layerHits(code) {
  const src = fsutil.stripComments(String(code || ''));
  const hits = [];
  if (/wx\.cloud\./.test(src)) hits.push('wx.cloud');
  if (/Math\.random|\brandom\(/.test(src)) hits.push('random');
  if (/client\.call\s*\(/.test(src)) hits.push('直调 client.call');
  STATUS_LITERALS.forEach((status) => {
    if (new RegExp("['\"]" + status + "['\"]").test(src)) hits.push('状态字面量 ' + status);
  });
  return hits;
}

function register(h) {
  // ── A. 多选资格 / 批量计划 / 部分失败重试 ───────────────────────────────────
  h.section('A 多选资格与批量计划', (t) => {
    const submitted = row(STATUS.SUBMITTED);
    const accepted = row(STATUS.ACCEPTED);
    const picked = row(STATUS.PICKED);
    const delivered = row(STATUS.DELIVERED);
    const completed = row(STATUS.COMPLETED);
    const cancelled = row(STATUS.CANCELLED);
    const exception = row(STATUS.EXCEPTION);
    t.check(submitted.selectable && accepted.selectable && picked.selectable && exception.selectable,
      'A01 活动单（待接单/待取件/已取件/异常）可勾选');
    t.check(!delivered.selectable && !completed.selectable && !cancelled.selectable,
      'A02 DELIVERED/COMPLETED/CANCELLED 不可勾选（按服务端 bucket 判定）');
    t.eq([filterView.canSelect(delivered), filterView.canSelect(completed), filterView.canSelect(cancelled)],
      [false, false, false], 'A03 canSelect 与服务端 bucket 同口径（单一来源）');
    const list = [
      dto(STATUS.SUBMITTED, { orderNo: 'A-1' }),
      dto(STATUS.ACCEPTED, { orderNo: 'A-2' }),
      dto(STATUS.DELIVERED, { orderNo: 'A-3' }),
      dto(STATUS.COMPLETED, { orderNo: 'A-4' }),
      dto(STATUS.ACCEPTED, { orderNo: 'A-5' })
    ];
    const groups = groupsOf(list);
    const state = selectionFlow.selectAll(groups);
    t.eq(state.selectedCount, 3, 'A04 全选只选当前屏可勾选活动单（5 行中 2 行终态被排除）');
    t.check(state.groups[0].rows.some((item) => item.selected), 'A05 全选后行勾选态落到行数据（便于行级补丁）');
    const plan = batchView.plan('pick', rowsOf(list), { batchActionId: 'BATCHID000000000000001' });
    t.eq([plan.ok, plan.queue.length, plan.skipped.length], [true, 2, 3],
      'A06 批量「已取件」只圈 actions 含 pick 的单（服务端判据，不本地猜状态）');
    t.eq([plan.batch, plan.batchActionId], [true, 'BATCHID000000000000001'],
      'A07 批量键带同一 batchActionId');
    const acceptPlan = batchView.plan('accept', rowsOf(list), { batchActionId: 'BATCHID000000000000001' });
    t.eq([acceptPlan.batch, acceptPlan.batchActionId], [false, ''], 'A08 批量接单不携带 batchActionId（契约）');
    t.check(plan.confirmText.indexOf('将 2 单（共 2 件）') >= 0 && plan.confirmText.indexOf('已取件') >= 0,
      'A09 确认框逐字含「改几单、改什么」（2 单/2 件标记已取件）');
    t.check(plan.confirmText.indexOf('顾客') >= 0, 'A10 确认框写清顾客看到什么');
    const nonePlan = batchView.plan('pick', [delivered], {});
    t.eq([nonePlan.ok, nonePlan.message.indexOf('没有可') >= 0], [false, true],
      'A11 无可执行行时明确提示，不发空请求');
    const results = [
      { orderNo: 'A-2', ok: true, code: '', message: '' },
      { orderNo: 'A-5', ok: false, code: 'INVALID_TRANSITION', message: '状态已变化' }
    ];
    const summary = batchView.summary(plan, results);
    t.eq([summary.okCount, summary.failCount, summary.allOk], [1, 1, false],
      'A12 结果汇总区分成功/失败，部分成功不标成全部成功');
    t.eq(summary.text, '1 单成功，1 单失败：A-5 状态已变化。失败的单已保留选中，可重试。',
      'A13 部分失败逐句文案（UX §4.15：保留选中、可重试）');
    t.check(summary.text.indexOf('A-5 状态已变化') >= 0, 'A14 失败项列出订单号与原因');
    const finish = actionFlow.finishBatchIntent(plan, {}, results, groups, false);
    t.eq([finish.patch.selecting, finish.patch.selectedCount], [false, 1],
      'A15 部分失败：退出多选但保留失败项选择态（不留下看不见的成功项）');
    t.eq(finish.patch.batchResult.failedOrderNos, ['A-5'], 'A16 失败订单号上屏并可重试');
    t.eq(selectedNames(finish.patch.groups), ['A-5'], 'A17 行选择态只留失败行');
    t.check(finish.modal.confirmText === '重试失败项' && finish.modal.showCancel === true,
      'A18 部分失败弹窗给「重试失败项」+「稍后处理」两个出口');
    t.eq([finish.undo.actionKey, finish.undo.orderNos], ['pick', ['A-2']],
      'A19 撤销条只覆盖成功项（失败项不进入撤销条）');
    const retry = batchView.retryPlan(plan, finish.patch.batchResult.failedOrderNos);
    t.eq([retry.queue.length, retry.mode, retry.batchActionId], [1, 'retry', 'BATCHID000000000000001'],
      'A20 重试失败项沿用同一 batchActionId、只回放失败单');
    t.eq(retry.confirmText.indexOf('1 单') >= 0, true, 'A21 重试确认框说清重试几单');
    const allOk = actionFlow.finishBatchIntent(plan, {}, [{ orderNo: 'A-2', ok: true }], groups, false);
    t.eq([allOk.patch.selectedCount, allOk.modal.showCancel], [0, false],
      'A22 全成功：清空选集且弹窗只有一个「知道了」出口');
    t.eq(selectionFlow.stateOf(groups, {}).selectionText, '已选 0 件 · 全选范围：当前筛选下 3 件',
      'A23 批量条写清已选 N 件与全选范围 M 件（§4.6）');
    t.notEmpty(results, 'A24 部分失败样本非空');
  });

  // ── B. 撤销条策略 ─────────────────────────────────────────────────────────
  h.section('B 撤销条策略', (t) => {
    t.eq([undoView.undoableMeta('pick').label, undoView.undoableMeta('pick').backText],
      ['已取件', '已接单'], 'B01 已取件可撤销 → 回到「已接单」');
    t.eq([undoView.undoableMeta('deliver').label, undoView.undoableMeta('deliver').backText],
      ['已送达', '已取件'], 'B02 送达可撤销 → 回到「已取件」');
    t.eq([undoView.undoableMeta('accept'), undoView.undoableMeta('correct')], [null, null],
      'B03 接单/改码不进撤销条（只 pick/deliver，契约 §5.1）');
    t.eq(undoView.UNDO_SECONDS * 1000, orderState.UNDO_WINDOW_MS, 'B04 倒计时 5s 与服务端 undo 窗口同源（≤5000ms）');
    const state = undoView.createState({ actionKey: 'pick', orderNos: ['N-1', 'N-2', 'N-3'], batchActionId: 'BID00000000000000000001' });
    t.eq([state.visible, state.remaining, state.label, state.batchActionId],
      [true, 5, '已取件', 'BID00000000000000000001'], 'B05 撤销条创建：5s、标签、批量 id');
    t.eq(state.text, '已把 3 件标记为「已取件」', 'B06 撤销条文案「已把 N 件标记为已取件」');
    t.eq(undoView.createState({ actionKey: 'accept', orderNos: ['N-1'] }), null, 'B07 接单动作不创建撤销条');
    t.eq(undoView.createState({ actionKey: 'pick', orderNos: [] }), null, 'B08 空选集不创建撤销条');
    let tickState = state;
    for (let i = 0; i < 4; i += 1) {
      tickState = undoView.tick(tickState);
    }
    t.eq([tickState.remaining, tickState.visible], [1, true], 'B09 每秒递减、未归零仍可见');
    tickState = undoView.tick(tickState);
    t.eq([tickState.remaining, tickState.visible], [0, false], 'B10 倒计时归零隐藏（超时消失）');
    t.eq(actionFlow.undoStateOf('pick', ['N-1'], 'BID', true), null, 'B11 READONLY 不出现撤销条');
    t.check(actionFlow.undoStateOf('pick', ['N-1'], 'BID', false).visible, 'B12 可写会话正常出现撤销条');
    t.eq(actionFlow.closedUndo().visible, false, 'B13 关闭态结构完整（closedUndo）');
    const okSummary = undoView.summary([
      { orderNo: 'N-1', ok: true },
      { orderNo: 'N-2', ok: true }
    ], 'pick');
    t.eq(okSummary.text, '已撤销：2 件回到「已接单」。', 'B14 全部撤销成功文案');
    const partial = undoView.summary([
      { orderNo: 'N-1', ok: true },
      { orderNo: 'N-2', ok: true },
      { orderNo: 'N-3', ok: true },
      { orderNo: 'N-4', ok: false, message: '顾客已确认送达，不能撤销' }
    ], 'pick');
    t.eq(partial.text, '3 单撤销成功，1 单顾客已确认，不能撤销', 'B15 部分失败逐句文案（UX §4.7）');
    const changed = undoView.summary([
      { orderNo: 'N-1', ok: true },
      { orderNo: 'N-2', ok: false, message: '状态已变化' }
    ], 'deliver');
    t.eq(changed.text, '1 单撤销成功，1 单状态已变化，不能撤销', 'B16 非确认类失败如实说「状态已变化」');
    const none = undoView.summary([{ orderNo: 'N-1', ok: false, message: '状态已变化' }], 'pick');
    t.eq(none.text, '撤销失败：状态已变化，请刷新后再看。', 'B17 全部失败给下一步（刷新后再看）');
    t.eq(undoView.summary([], 'pick').text, '已撤销：0 件回到「已接单」。', 'B18 空结果不抛错（防御）');
    t.notEmpty(okSummary.text, 'B19 撤销文案样本非空');
  });

  // ── C. 筛选 / 分页 / 轮询增量 ─────────────────────────────────────────────
  h.section('C 筛选与轮询增量', (t) => {
    t.eq(filterView.FILTERS.map((item) => item.key),
      ['all', 'submitted', 'accepted', 'picked', 'delivered', 'needCode', 'exception', 'completed'],
      'C01 状态 chip 全集（含需查明/已完结，§4.5）');
    t.eq([filterView.statusOf('accepted'), filterView.statusOf('exception'), filterView.statusOf('needCode')],
      [enums.ORDER_STATUS.ACCEPTED, enums.ORDER_STATUS.EXCEPTION, ''],
      'C02 状态 chip 映射服务端 status 入参；需查明走客户端过滤');
    t.eq([filterView.isHistory('completed'), filterView.isNeedCode('needCode')], [true, true],
      'C03 已完结=历史分区入口、需查明=client 过滤');
    t.eq(filterView.describe('accepted'), '筛选中：待取件 —— 点上面那颗换一个。', 'C04 筛选说明行逐句（§4.5）');
    t.eq(filterView.describe('all'), '', 'C05 「全部」不显示筛选说明');
    t.eq(filterView.emptyOf({ filter: 'accepted', keyword: '' }).text, '换回「全部」就都回来了。',
      'C06 筛空文案与真空分开');
    t.eq(filterView.emptyOf({ filter: 'all', keyword: '' }).title, '今天还没有订单', 'C07 真空文案');
    t.eq(filterView.emptyOf({ keyword: 'D4-522' }).title, '没找到匹配的订单', 'C08 搜索无结果文案');
    t.eq([filterView.countTargetOf('delivered').filter, filterView.countTargetOf('todayCompleted').filter,
      filterView.countTargetOf('todayCompleted').toast],
    ['delivered', 'all', '今日完成的单都在「全部」里'],
    'C09 counts 点数字跳对应筛选（待确认→delivered；今日完成→「全部」今日流水 + toast 说明）');
    const q1 = loadView.queryOf({ filterKey: 'accepted', keyword: '' });
    t.eq([q1.view, q1.limit, q1.status], ['workbench', 30, enums.ORDER_STATUS.ACCEPTED],
      'C10 状态 chip 走服务端筛选（listPartner.status），切换只影响 list 不改 counts');
    t.eq(loadView.queryOf({ filterKey: 'needCode', keyword: '' }).status, undefined,
      'C11 需查明不传 status（client 过滤当前全集）');
    const q2 = loadView.queryOf({ filterKey: 'all', keyword: '6678', cursor: { sortValue: 1, orderNo: 'X' } });
    t.eq([q2.keyword, q2.cursor.orderNo], ['6678', 'X'], 'C12 搜索/分页参数透传（游标翻页）');
    const needList = [dto(STATUS.SUBMITTED, { orderNo: 'C-1', needCode: true }), dto(STATUS.ACCEPTED, { orderNo: 'C-2' })];
    const needGroups = filterView.filterRows(groupsOf(needList), 'needCode');
    t.eq(needGroups.length, 1, 'C13 需查明过滤后仅保留缺码行');
    t.eq(needGroups[0].rows.map((item) => item.orderNo), ['C-1'], 'C14 需查明过滤不改其它行');
    t.eq(loadView.badgePatch({ submitted: 5, messages: 0 }, { workbenchPending: 1, messages: 2 }),
      { workbenchPending: 5, messages: 2 },
      'C15 counts.submitted → 红点 workbenchPending 同步且不覆盖 messages（Lead 追加）');
    t.eq(loadView.badgePatch({ submitted: 0 }, { messages: 2 }), { workbenchPending: 0, messages: 2 },
      'C16 待接单清零时红点归零、messages 保留');
    const banner1 = loadView.bannerOf({ submitted: 5 }, 3);
    t.eq([banner1.visible, banner1.pendingNew, banner1.text], [true, 2, '有 2 个新订单待接单'],
      'C17 页内新订单横幅「有 N 个新订单待接单」（不自动跳页）');
    t.eq(loadView.bannerOf({ submitted: 5 }, 5).visible, false, 'C18 已确认过的待接单不再提示');

    const baseList = [
      dto(STATUS.SUBMITTED, { orderNo: 'C-1', needCode: true }),
      dto(STATUS.ACCEPTED, { orderNo: 'C-2', version: 1 }),
      dto(STATUS.PICKED, { orderNo: 'C-3', version: 2 })
    ];
    const first = loadView.applyRefresh({ list: [], page1Keys: [] }, {
      list: baseList,
      counts: { submitted: 1, accepted: 1, picked: 1, delivered: 0, exception: 0, todayCompleted: 0 },
      nextCursor: { sortValue: DOC_MS, orderNo: 'C-3' }
    }, { filterKey: 'all', keyword: '', nowMs: DOC_MS });
    t.eq([first.stage, first.totalRows, first.structural], ['ready', 3, true], 'C19 首次加载给完整视图');
    t.eq(first.groups.length, 1, 'C20 同行站点合并成一个站点卡');
    t.eq(first.nextCursor.orderNo, 'C-3', 'C21 分页游标保留（onReachBottom 用）');
    const unchanged = loadView.applyRefresh(first, {
      list: baseList,
      counts: { submitted: 1, accepted: 1, picked: 1, delivered: 0, exception: 0, todayCompleted: 9 },
      nextCursor: first.nextCursor
    }, { filterKey: 'all', keyword: '', nowMs: DOC_MS });
    t.eq(Object.keys(unchanged.patches).length, 0, 'C22 列表无变化时不发任何行补丁（不整表 setData）');
    t.eq(unchanged.counts.todayCompleted, 9, 'C23 列表无变化时 counts 仍更新（红点/总览不等订单变化）');
    const changedList = baseList.map((item) => (item.orderNo === 'C-2'
      ? Object.assign({}, item, { version: 2, statusText: '已取件', bucket: 'picked' })
      : item));
    const changed = loadView.applyRefresh(first, { list: changedList, counts: first.counts, nextCursor: first.nextCursor },
      { filterKey: 'all', keyword: '', nowMs: DOC_MS });
    t.eq(changed.structural, false, 'C24 行内容变化但不改行序/行集合 → 结构不变');
    const patchKeys = Object.keys(changed.patches);
    t.check(patchKeys.some((key) => /^groups\[\d+\]\.rows\[\d+\]\.statusText$/.test(key)),
      'C25 变化行只发 groups[g].rows[r].statusText 行级补丁（UX §4.11）');
    t.check(patchKeys.indexOf('groups') === -1, 'C26 不重发整表 groups');
    t.eq(changed.patches[patchKeys[0]] !== undefined, true, 'C27 补丁值可 setData 直用');
    const resultPatch = loadView.resultPatch(changed, { filterKey: 'all', poll: true, selecting: false });
    t.eq(resultPatch.mode, 'patch', 'C28 轮询且结构不变 → 走 patch 分支');
    const added = loadView.applyRefresh(first, {
      list: baseList.concat([dto(STATUS.SUBMITTED, { orderNo: 'C-4' })]),
      counts: first.counts
    }, { filterKey: 'all', keyword: '', nowMs: DOC_MS });
    t.eq([added.structural, added.added.indexOf('C-4') >= 0], [true, true], 'C29 新增订单 → 结构变化，整表替换（并记录新增）');
    const removed = loadView.applyRefresh(first, { list: baseList.slice(0, 2), counts: first.counts },
      { filterKey: 'all', keyword: '', nowMs: DOC_MS });
    t.eq([removed.structural, removed.removed], [true, ['C-3']], 'C30 行离开当前筛选（第一页消失）→ 识别移除并整表替换');
    t.eq(removed.list.map((item) => item.orderNo), ['C-1', 'C-2'], 'C31 已加载列表同步剔除离开筛选的单');
    const appendPlan = loadView.applyAppend(first, {
      list: [dto(STATUS.SUBMITTED, { orderNo: 'C-4' })],
      counts: first.counts,
      nextCursor: null
    }, { filterKey: 'all', keyword: '', nowMs: DOC_MS });
    t.eq([appendPlan.totalRows, appendPlan.nextCursor, appendPlan.structural], [4, null, true],
      'C32 onReachBottom 追加下一页（游标置空=到底）');
    const many = [];
    for (let i = 0; i < 45; i += 1) {
      many.push(dto(STATUS.ACCEPTED, { orderNo: 'M-' + i, version: 1 }));
    }
    const chunks = loadView.chunkPlanOf(groupsOf(many));
    const firstChunkRows = chunks.first.reduce((sum, group) => sum + group.rows.length, 0);
    t.check(firstChunkRows <= loadView.FIRST_CHUNK_ROWS && chunks.hasRest,
      'C33 首次渲染分片每片 ≤20 行（45 行分成多片）');
    const restRows = chunks.rest.reduce((sum, chunk) => sum
      + chunk.reduce((inner, group) => inner + group.rows.length, 0), 0);
    t.eq(firstChunkRows + restRows, 45, 'C34 分片合并后行数守恒（不丢行）');
    const chunkKeys = groupView.splitByRows(groupsOf(many), 20).map((chunk) => chunk[0].key);
    t.eq(new Set(chunkKeys).size, chunkKeys.length, 'C35 分片后的站点卡 key 唯一（wx:key 不冲突）');
    const selected = groupView.applySelection(first.groups, { 'C-2': true });
    const pollKeep = loadView.applyRefresh(
      Object.assign({}, first, { groups: selected.groups }),
      { list: changedList, counts: first.counts, nextCursor: first.nextCursor },
      { filterKey: 'all', keyword: '', nowMs: DOC_MS, selectedMap: { 'C-2': true } }
    );
    t.eq(pollKeep.patches['groups[0].rows[1].selected'], undefined, 'C36 轮询补丁不冲掉多选勾选态');
    t.check(groupView.findRow(pollKeep.groups, 'C-2').row.selected, 'C37 勾选行在合并后仍选中');
    t.eq(loadView.errorTextOf('08:12'), '检查网络后重试；上次成功更新 08:12。', 'C38 错误态带上次成功更新时间（§4.15）');
    t.eq(loadView.errorTextOf(''), '检查网络后重试。', 'C39 首次失败无更新时间时不编造时间');
    const emptyPlan = loadView.applyRefresh({ list: [], page1Keys: [] }, {
      list: [], counts: loadView.COUNTS_FALLBACK, nextCursor: null
    }, { filterKey: 'submitted', keyword: '', nowMs: DOC_MS });
    t.eq(emptyPlan.stage, 'filteredEmpty', 'C40 筛选下无单 → 筛空态（不是真空态）');
    const historySummary = historyView.collapsedState({
      list: [dto(STATUS.COMPLETED, { orderNo: 'H-1' })],
      nextCursor: { sortValue: DOC_MS, orderNo: 'H-1' }
    });
    t.eq(historySummary.text, '已完结 · 昨日及更早 1+ 单 >', 'C41 已完结折叠入口「已完结 · 昨日及更早 N+ 单 >」（今天完成单只在全部）');
    t.notEmpty(first.groups, 'C42 视图样本非空');
  });

  // ── D. 引导 / 编号行 / storage ────────────────────────────────────────────
  h.section('D 首用引导与兼职编号', (t) => {
    t.eq(guideView.STEPS.length, 3, 'D01 三步遮罩（§4.8）');
    const first = guideView.stateOf(0);
    t.eq([first.visible, first.step, first.title, first.primaryText], [true, 0, '按站点看', '下一步'],
      'D02 第一步高亮「多选」文案');
    const second = guideView.stateOf(1);
    t.eq([second.title, second.text.indexOf('需查明') >= 0], ['先补码', true], 'D03 第二步点出「需查明」要先补码');
    const last = guideView.stateOf(2);
    t.eq([last.isLast, last.primaryText, last.text.indexOf('5 秒') >= 0], [true, '知道了', true],
      'D04 第三步说明 5 秒内可撤销');
    t.eq([guideView.next(first).step, guideView.next(last)], [1, null], 'D05 步进到第三步后引导结束');
    t.eq(guideView.partnerLine('P7K2M9X'),
      '你的兼职编号是 P-7K2-M9X —— 在「我的」可复制或分享绑定卡片给顾客',
      'D06 兼职编号行逐句（§4.8）');
    t.eq([guideView.partnerLine(''), guideView.partnerLine('bad-no')], ['', ''],
      'D07 partnerNo 为空/非法时整行不渲染（不造假）');
    t.eq(guideView.emptyActions().replayText, '重新看引导', 'D08 空态有「重新看引导」入口（pages/profile 归 S0 不改）');
    t.eq(guideView.emptyActions().shareHint, '顾客在自己手机上确认后才建立绑定',
      'D09 分享绑定卡片口径：绑定只能顾客发起');
    let mem = '';
    const platform = {
      getStorageSync: () => mem,
      setStorageSync: (key, value) => {
        mem = value;
      },
      removeStorageSync: () => {
        mem = '';
      }
    };
    t.eq(storage.isGuideSeen(guideView.GUIDE_KEY, platform), false, 'D10 首次进入无引导完成标记（会展示引导）');
    t.eq(storage.markGuideSeen(guideView.GUIDE_KEY, platform), true, 'D11 引导完成写本地标记（utils/storage 单一出口）');
    t.eq(storage.isGuideSeen(guideView.GUIDE_KEY, platform), true, 'D12 有标记后不再展示引导');
    t.eq(storage.clearGuideSeen(guideView.GUIDE_KEY, platform), true, 'D13 空态「重新看引导」清标记');
    t.eq(storage.isGuideSeen(guideView.GUIDE_KEY, platform), false, 'D14 清标记后可重看（换账号/清缓存同效）');
    const closed = guideView.closedState();
    t.eq([closed.visible, closed.step], [false, 0], 'D15 引导关闭态可复用（不显示残留）');
    t.eq(guideView.GUIDE_KEY, 'PARTNER_WORKBENCH_V1', 'D16 复用既有本地引导键白名单');
    t.eq(guideView.partnerLine('P7K2M9X').indexOf('P-7K2-M9X') >= 0, true, 'D17 编号展示按既有 ids 零件分组');
  });

  // ── E. 行级动作只消费服务端 actions[] ──────────────────────────────────────
  h.section('E 行级动作消费服务端 actions', (t) => {
    const submittedRow = row(STATUS.SUBMITTED);
    const acceptedRow = row(STATUS.ACCEPTED);
    const pickedRow = row(STATUS.PICKED);
    const deliveredRow = row(STATUS.DELIVERED);
    const fixtureRows = [submittedRow, acceptedRow, pickedRow, deliveredRow, row(STATUS.EXCEPTION)];
    const toolbarKeys = fixtureRows.map((item) => {
      const built = rowActions.buildToolbar(item, {});
      return built.primary.concat(built.secondary).map((tool) => tool.key).sort();
    });
    const dtoKeys = fixtureRows.map((item) => item.actions.map((action) => action.key).sort());
    t.eq(toolbarKeys, dtoKeys, 'E01 行工具键集合 = 服务端 actions[]（页面不本地判状态）');
    t.eq(submittedRow.actions.map((item) => item.key), actionsFor(STATUS.SUBMITTED),
      'E02 SUBMITTED 动作矩阵与契约一致（接单/拒单/补码/取消/留言）');
    t.eq(deliveredRow.actions.map((item) => item.key), actionsFor(STATUS.DELIVERED),
      'E03 DELIVERED 动作矩阵（撤销送达/异常/取消/留言；已送达不可再补码）');
    t.eq(submittedRow.version, 3, 'E04 DTO version 供写动作 expectedVersion 使用');
    t.eq(rowActions.buildToolbar(submittedRow, {}).primary[0].key, 'accept', 'E05 主操作优先接单（行首主操作位）');
    t.eq([deliveredRow.selectable, rowActions.buildToolbar(deliveredRow, {}).primary.length], [false, 0],
      'E06 待确认行不可勾选且无主操作（只读待确认）');
    const readonlyToolbar = rowActions.buildToolbar(submittedRow, { readonly: true });
    t.check(readonlyToolbar.primary.concat(readonlyToolbar.secondary).every((tool) => tool.disabled === true),
      'E07 READONLY 行工具全部置灰（§6.3）');
    const selectingToolbar = rowActions.buildToolbar(submittedRow, { selecting: true });
    t.eq([selectingToolbar.hidden, selectingToolbar.primary.length, selectingToolbar.secondary.length], [true, 0, 0],
      'E08 多选态隐藏行工具（避免误触）');
    const noneToolbar = rowActions.buildToolbar(groupView.toRow(dto(STATUS.CANCELLED, { actions: [] })), {});
    t.eq([noneToolbar.primary.length, noneToolbar.secondary.length, noneToolbar.detail], [0, 0, true],
      'E09 服务端无 actions → 行工具不显示（只留详情）');
    t.eq(rowActions.knownActions({ actions: [{ key: 'bogus', label: 'x' }, { key: 'pick' }] }).map((item) => item.key),
      ['pick'], 'E10 未知动作键丢弃、不渲染不受控按钮');
    const blankRow = row(STATUS.SUBMITTED);
    const panel = rowActions.openPanel('correct', blankRow);
    t.eq([panel.type, panel.codeMax, panel.tailLength], ['code', 40, 5], 'E11 行内补码面板：码≤40、尾号 5 位（§4.4）');
    t.eq([panel.code, panel.lockerNo], ['', ''], 'E12 缺码行面板预填空值（不伪造取件码）');
    const noCode = rowActions.validatePanel(panel);
    t.eq([noCode.ok, noCode.message.indexOf('取件码必填') >= 0], [false, true], 'E13 补码必填校验（先合法基线再反例）');
    const badTail = rowActions.validatePanel(Object.assign({}, panel, { code: '27-2-7016', trackingTail: '667' }));
    t.eq([badTail.ok, badTail.message.indexOf('5 位') >= 0], [false, true], 'E14 运单尾号必须恰好 5 位数字');
    const okCode = rowActions.validatePanel(Object.assign({}, panel, { code: '27-2-7016', trackingTail: '66789' }));
    t.eq([okCode.ok, okCode.values.patch.pickupCode], [true, '27-2-7016'], 'E15 合法补码收口成 patch');
    const filledPanel = rowActions.openPanel('correct', acceptedRow);
    const tailOnly = rowActions.validatePanel(Object.assign({}, filledPanel, { trackingTail: '66789' }));
    t.eq([tailOnly.ok, Object.keys(tailOnly.values.patch)], [true, ['trackingTail']],
      'E15a 只改尾号时 patch 不含未改的取件码（不触发服务端字段白名单驳回）');
    const unchanged = rowActions.validatePanel(filledPanel);
    t.eq([unchanged.ok, unchanged.message.indexOf('没有改动') >= 0], [false, true],
      'E15b 什么都没改 → 明确提示「没有改动」，不发空 patch 请求');
    const pickedPanel = rowActions.openPanel('correct', pickedRow);
    const pickedLocker = rowActions.validatePanel(Object.assign({}, pickedPanel, { lockerNo: '3号柜' }));
    t.eq([pickedLocker.ok, pickedLocker.values.patch.pickupCode, pickedLocker.values.patch.lockerNo],
      [true, undefined, '3号柜'], 'E15c 已取件行只改柜号（只提交柜号，契约 PICKED 仅柜号/尾号）');
    const reasonPanel = rowActions.openPanel('reject', submittedRow);
    t.eq([reasonPanel.type, reasonPanel.options.length], ['reason', 4], 'E16 拒单原因枚举=兼职侧 4 值（§5.2）');
    t.eq(rowActions.validatePanel(reasonPanel).ok, false, 'E17 拒单必须选原因');
    const otherReason = Object.assign({}, reasonPanel, { selected: enums.OTHER_REASON_CODE });
    t.eq(rowActions.validatePanel(otherReason).ok, false, 'E18 选「其他原因」必须填说明');
    t.eq(rowActions.validatePanel(Object.assign({}, otherReason, { note: '临时有事' })).ok, true,
      'E19 其他原因+说明通过校验');
    const expPanel = rowActions.openPanel('exception', acceptedRow);
    t.eq([expPanel.type, expPanel.options.length, expPanel.textMax], ['exception', 6, 200],
      'E20 异常原因 6 值 + 备注 ≤200（§4.13）');
    t.eq(rowActions.validatePanel(Object.assign({}, expPanel, { selected: enums.EXCEPTION_OTHER_CODE })).ok, false,
      'E21 其他异常必须填说明');
    t.eq(rowActions.validatePanel(Object.assign({}, expPanel, { selected: 'CODE_INVALID', text: 'x'.repeat(201) })).ok,
      false, 'E22 异常备注超 200 字拦截');
    const deliverPanel = rowActions.openPanel('deliver', pickedRow);
    t.eq([deliverPanel.type, deliverPanel.noteMax, deliverPanel.quickTags.length >= 3], ['deliver', 100, true],
      'E23 送达面板：快捷标签 + 备注 ≤100');
    t.eq(rowActions.validatePanel(Object.assign({}, deliverPanel, { note: 'x'.repeat(101) })).ok, false,
      'E24 送达备注超 100 字拦截');
    const pickWrite = rowActions.buildWrite('pick', acceptedRow, {}, 'BID00000000000000000001');
    t.eq([pickWrite.method, pickWrite.payload.batchActionId, pickWrite.opts.expectedVersion],
      ['markPicked', 'BID00000000000000000001', acceptedRow.version],
      'E25 已取件写动作带 batchActionId + expectedVersion（乐观锁）');
    const acceptWrite = rowActions.buildWrite('accept', submittedRow, {}, 'BID00000000000000000001');
    t.eq([acceptWrite.method, acceptWrite.payload.batchActionId, acceptWrite.opts.expectedVersion],
      ['accept', undefined, submittedRow.version], 'E26 接单不带 batchActionId 但带 expectedVersion');
    const deliverWrite = rowActions.buildWrite('deliver', pickedRow, { deliveryNote: '放宿舍门口' }, 'BID');
    t.eq([deliverWrite.method, deliverWrite.payload.deliveryNote, deliverWrite.payload.batchActionId],
      ['markDelivered', '放宿舍门口', 'BID'], 'E27 送达带 deliveryNote 与 batchActionId');
    const undoRowWrite = rowActions.buildWrite('undoPick', pickedRow, {}, '');
    t.eq([undoRowWrite.method, undoRowWrite.payload.batchActionId], ['unmarkPicked', undefined],
      'E28 行级「撤销已取件」走 unmarkPicked（契约单件动作）');
    const undoBatchWrite = rowActions.buildWrite('undoPick', pickedRow, {}, 'BID');
    t.eq([undoBatchWrite.method, undoBatchWrite.payload.batchActionId], ['undo', 'BID'],
      'E29 批量撤销走 order.undo + 同一 batchActionId（契约统一入口）');
    const correctWrite = rowActions.buildWrite('correct', submittedRow, { patch: { pickupCode: '27-2-7016' } }, '');
    t.eq([correctWrite.method, correctWrite.payload.patch.pickupCode, correctWrite.opts.expectedVersion],
      ['correct', '27-2-7016', submittedRow.version], 'E30 补码写动作带 patch + expectedVersion');
    t.eq(rowActions.buildWrite('reject', submittedRow, { reason: 'TOO_BUSY', note: '' }).payload.reason, 'TOO_BUSY',
      'E31 拒单原因枚举透传');
    t.eq(rowActions.confirmTextOf('pick', acceptedRow).indexOf('顾客') >= 0, true,
      'E32 单件确认框写清顾客看到什么');
    const groups = groupsOf([dto(STATUS.SUBMITTED)]);
    t.eq(actionFlow.rowActionIntent('correct', submittedRow.orderNo, groups, false).kind, 'panel',
      'E33 补码点击 → 打开行内浮层（不跳页）');
    t.eq(actionFlow.rowActionIntent('message', submittedRow.orderNo, groups, false).kind, 'navigate',
      'E34 留言 → 跳详情（不在列表塞输入框）');
    t.eq(actionFlow.rowActionIntent('accept', submittedRow.orderNo, groups, true).kind, 'toast',
      'E35 READONLY 点写动作只 toast 不发请求');
    t.eq(actionFlow.needCodeIntent(submittedRow.orderNo, groups, false).kind, 'panel', 'E36 需查明「补码」→ 行内面板');
    const noCorrect = dto(STATUS.ACCEPTED, { orderNo: 'E-NC', actions: [{ key: 'pick' }] });
    t.eq(actionFlow.needCodeIntent('E-NC', groupsOf([noCorrect]), false).kind, 'navigate',
      'E37 服务端没给 correct 时跳详情（不硬做行内面板）');
    const submitIntent = actionFlow.panelSubmitIntent(
      Object.assign({}, panel, { code: '27-2-7016', orderNo: submittedRow.orderNo }),
      groups
    );
    t.eq([submitIntent.kind, submitIntent.key], ['write', 'correct'], 'E38 面板校验通过 → 产出写意图');
    const needGroups2 = groupsOf([
      dto(STATUS.SUBMITTED, { orderNo: 'F-2' }),
      dto(STATUS.SUBMITTED, { orderNo: 'F-3' })
    ]);
    const after = actionFlow.afterWriteIntent('correct', needGroups2, row(STATUS.SUBMITTED, { orderNo: 'F-1' }));
    t.eq(after.toastText, '已补齐：北部菜鸟驿站 → 需查明档。还剩 2 件需查明。',
      'E39 补码成功逐句文案 + 自动跳下一条需查明（还剩 N 件）');
    t.eq(after.panel.actionKey, 'correct', 'E40 自动打开下一条需查明的补码面板');
    const allDone = actionFlow.afterWriteIntent('correct', groupsOf([dto(STATUS.ACCEPTED)]), row(STATUS.SUBMITTED));
    t.eq([allDone.toastText, allDone.panel], ['这一屏的需查明都补齐了。', null], 'E41 全部补齐后不再跳面板');
    const stationPanel = Object.assign(rowActions.openBatchStationPanel(), { batchMode: true, selected: 'P6' });
    const stationIntent = actionFlow.panelSubmitIntent(stationPanel, groups);
    t.eq([stationIntent.kind, stationIntent.content.indexOf('南苑菜鸟驿站') >= 0, stationIntent.values.patch.stationName],
      ['batchStationConfirm', true, '南苑菜鸟驿站'], 'E42 批量改站点确认框写清改到哪个站点');
    t.check(actionFlow.panelSubmitIntent(Object.assign({}, stationPanel, { selected: 'BAD' }), []).kind === 'error',
      'E43 站点值域外 → 行内红字（P1~P8 限定）');
    const serialized = JSON.stringify(fixtureRows);
    t.eq(/(^|[^A-Za-z0-9_-])o[A-Za-z0-9_-]{27}([^A-Za-z0-9_-]|$)/.test(serialized), false,
      'E44 行渲染数据零 openid（只锚+键+编号）');
    t.notEmpty(toolbarKeys, 'E45 行工具样本非空');
  });

  // ── F. 静态纪律 ───────────────────────────────────────────────────────────
  h.section('F 静态纪律', (t) => {
    const indexSrc = textOf(PAGES.index);
    const actionSrc = textOf(PAGES.actions);
    t.check(indexSrc !== null && actionSrc !== null, 'F01 页面脚本存在（index + page-actions）');
    t.eq(layerHits(indexSrc + '\n' + actionSrc), [], 'F02 页面零 wx.cloud / 零七状态字面量 / 零 random / 不直调 client.call');
    t.check(layerHits('wx.cloud.callFunction({})').length > 0, 'F03 有牙反例：合成 wx.cloud 会被扫红');
    t.check(layerHits("var s = 'PICKED';").some((hit) => hit.indexOf('状态字面量') >= 0),
      'F04 有牙反例：合成七状态字面量会被扫红');
    t.check(layerHits('Math.random()').length > 0, 'F05 有牙反例：random 会被扫红');
    t.check(layerHits("client.call('order.get')").some((hit) => hit.indexOf('client.call') >= 0),
      'F06 有牙反例：页面直调 client.call 会被扫红');
    t.check(indexSrc.indexOf('buildWrite(') === -1 && actionSrc.indexOf('rowActions.buildWrite(') >= 0,
      'F07 写动作统一经 row-actions.buildWrite 构造（页面不手拼包络）');
    t.check(actionSrc.indexOf('createRequestId()') >= 0, 'F08 批量 batchActionId 由 api/client 统一生成（页面零 random）');
    t.check(/wx\.(get|set|remove)StorageSync/.test(indexSrc + actionSrc) === false,
      'F09 本地存储只经 utils/storage（页面零 wx.*Storage*）');
    t.eq(indexSrc.split('\n').length <= 500, true, 'F10 页面单文件 ≤500 行');
    t.eq(actionSrc.split('\n').length <= 500, true, 'F11 page-actions 单文件 ≤500 行');
    const wxml = textOf(PAGES.wxml);
    t.check(wxml.indexOf('onRowAction') >= 0 && wxml.indexOf('row.toolbar') >= 0,
      'F12 行工具只渲染 toolbar（toolbar 源自服务端 actions[]）');
    t.check(wxml.indexOf('row.status ==') === -1, 'F13 WXML 零本地七状态判断（不出现 row.status 比较）');
    STATUS_LITERALS.forEach((status, i) => {
      t.eq(wxml.indexOf(status), -1, 'F' + (14 + i) + ' WXML 不出现七状态字面量 ' + status);
    });
    t.check(wxml.indexOf('status-pill') >= 0, 'F21 状态 chip 用 status-pill 组件（文案来自 shared）');
    t.check(wxml.indexOf('switch-bar') >= 0, 'F22 切换会话条接入（READONLY 黄条/TEST_WRITE 蓝条）');
    t.check(wxml.indexOf('skeleton') >= 0 && wxml.indexOf('加载中') === -1, 'F23 骨架屏替「加载中…」（§4.15）');
    t.check(wxml.indexOf('onBannerTap') >= 0 && wxml.indexOf('banner.visible') >= 0,
      'F24 页内新订单横幅存在（不自动跳页）');
    t.eq(wxml.indexOf('batchActionId'), -1, 'F25 WXML 不出现内部字段 batchActionId');
    t.check(wxml.indexOf('open-type="share"') >= 0, 'F26 分享绑定卡片只在空态 UI（顾客自己确认才绑定）');
    t.check(indexSrc.indexOf('data: {') >= 0 && indexSrc.indexOf('Object.assign(base') >= 0,
      'F27 页面配置 = base + page-actions 合并（职责分离）');
    t.eq((indexSrc + actionSrc).indexOf('SUBMITTED'), -1, 'F28 页面脚本零状态字符串（零七态字面量总闸）');
    t.check(actionSrc.indexOf('this.load(') >= 0, 'F29 写动作成功后回读服务端（不本地改状态）');
    t.eq(wxml.indexOf('openid'), -1, 'F30 WXML 零 openid 字样');
    t.eq(PAGES.wxss.split('\n').length <= 500, true, 'F31 页面样式单文件 ≤500 行');
    t.check(wxml.indexOf('onCompletedToggle') >= 0, 'F32 已完结分区入口接线');
    t.notEmpty([indexSrc, actionSrc, wxml], 'F33 静态样本非空');
  });

  // ── G. 异步联调：真实服务端 DTO + 批量循环/批量撤销 ────────────────────────
  h.section('G 真实 DTO 与批量联调', (t) => {
    const dtoList = [];
    for (let i = 0; i < orderState.STATUS_LIST.length; i += 1) {
      dtoList.push(serverDto.buildOrderDto(FAKE_DTO_CTX, orderDoc(orderState.STATUS_LIST[i]), { side: 'PARTNER' }));
    }
    return Promise.all(dtoList).then((realDtos) => {
      t.eq(realDtos.map((item) => item.status), orderState.STATUS_LIST.slice(), 'G01 七状态真实服务端 DTO 全部生成（样本非空）');
      t.eq(realDtos.map((item) => item.actions.map((action) => action.key).sort()), orderState.STATUS_LIST.map((status) => actionsFor(status).sort()),
        'G02 真实 DTO actions[] 与契约矩阵逐状态一致');
      const toolbarKeys = realDtos.map((item) => {
        const built = rowActions.buildToolbar(groupView.toRow(item), {});
        return built.primary.concat(built.secondary).map((tool) => tool.key).sort();
      });
      t.eq(toolbarKeys, realDtos.map((item) => item.actions.map((action) => action.key).sort()),
        'G03 端侧行工具键集合 = 真实服务端 actions[]（七状态逐格一致）');
      t.eq(realDtos[0].version, 5, 'G04 真实 DTO 带 version（写动作乐观锁入参）');
      t.eq(realDtos[3].actions.map((item) => item.key).sort(), actionsFor(STATUS.DELIVERED).sort(),
        'G05 送达 5s 窗内真实 DTO 给 undoDeliver（窗口判定在服务端）');
      t.eq(toolbarKeys.reduce((sum, keys) => sum + keys.length, 0), 24,
        'G06 七状态行工具总数与契约矩阵一致（无多无少）');
      const plan = batchView.plan('pick', rowsOf([
        dto(STATUS.ACCEPTED, { orderNo: 'G-1' }),
        dto(STATUS.ACCEPTED, { orderNo: 'G-2' })
      ]), { batchActionId: 'GID00000000000000000001' });
      const seen = [];
      return batchView.run(plan, (item, batchActionId) => {
        seen.push([item.orderNo, batchActionId]);
        if (item.orderNo === 'G-2') {
          const err = new Error('状态已变化');
          err.code = 'INVALID_TRANSITION';
          return Promise.reject(err);
        }
        return Promise.resolve({});
      }).then((batchResult) => {
        t.eq(seen.map((pair) => pair[0]), ['G-1', 'G-2'], 'G07 客户端逐单循环按队列顺序调用');
        t.eq(seen.map((pair) => pair[1]), ['GID00000000000000000001', 'GID00000000000000000001'],
          'G08 循环内共享同一 batchActionId（同批可审计）');
        t.eq(batchResult.results.map((item) => item.ok), [true, false], 'G09 逐单结果成功/失败分别记录');
        t.eq(batchResult.results[1].code, 'INVALID_TRANSITION', 'G10 失败原因按错误码如实回传');
        const summary = batchView.summary(plan, batchResult.results);
        t.eq([summary.okCount, summary.failCount, summary.allOk], [1, 1, false], 'G11 部分失败汇总不伪装成全部成功');
        const undoIds = [];
        return undoView.run(['G-1', 'G-2'], 'GID00000000000000000001', (orderNo, batchActionId) => {
          undoIds.push([orderNo, batchActionId]);
          return Promise.resolve({});
        }).then((undoResult) => {
          t.check(undoIds.every((pair) => pair[1] === 'GID00000000000000000001'),
            'G12 批量撤销逐单调用共享同一 batchActionId（契约统一入口）');
          t.eq(undoResult.results.filter((item) => item.ok).length, 2, 'G13 批量撤销逐单结果齐全');
          t.notEmpty(realDtos, 'G14 真实 DTO 样本非空');
          // D61 联调（A 侧真实 DTO）：件级 picked/pickedAt/actions 与订单级 pickedCount/parcelCount/allPicked
          const pickedDoc = orderDoc(STATUS.ACCEPTED, {
            parcels: [
              {
                stationId: 'P4', stationName: '北部菜鸟驿站', pickupCode: '27-2-7016', lockerNo: '',
                trackingTail: '', codeStatus: enums.CODE_STATUS.OK, pickedAt: new Date(DOC_MS)
              },
              {
                stationId: 'P6', stationName: '南苑菜鸟驿站', pickupCode: '109-2-3003', lockerNo: '',
                trackingTail: '', codeStatus: enums.CODE_STATUS.OK, pickedAt: null
              }
            ]
          });
          return serverDto.buildOrderDto(FAKE_DTO_CTX, pickedDoc, { side: 'PARTNER' }).then((realPicked) => {
            t.eq([realPicked.pickedCount, realPicked.parcelCount, realPicked.allPicked], [1, 2, false],
              'G15 真实 DTO 订单级件级聚合 pickedCount/parcelCount/allPicked（部分取件不显示为全取）');
            t.eq(realPicked.parcels.map((parcel) => [parcel.picked, parcel.actions[0]]),
              [[true, 'unmarkPicked'], [false, 'markPicked']],
            'G16 真实 DTO 每件 picked/actions 与冻结契约逐格一致（PARTNER 侧 ACCEPTED）');
            t.check(realPicked.parcels[0].pickedAt > 0 && realPicked.parcels[1].pickedAt === 0,
              'G17 真实 DTO 件级 pickedAt 为毫秒（未取=0）');
            // 端侧纯件直接消费真实 DTO：D62 分组 / D61 件行动作 / 写请求 itemIndex
            const realGroups = groupView.buildGroups([realPicked], DOC_MS);
            const realP4 = realGroups.filter((group) => group.stationId === 'P4')[0];
            const realP6 = realGroups.filter((group) => group.stationId === 'P6')[0];
            t.eq([realGroups.length, realP4.rows[0].pieceRows.length, realP6.rows[0].pieceRows.length], [2, 1, 1],
              'G18 真实 DTO → 端侧 D62 按件站点分组（P4/P6 各出现一次，行内只列本站件）');
            t.eq([realP4.rows[0].pickedSummaryText, realP4.rows[0].pieceRows[0].action.key,
              realP6.rows[0].pieceRows[0].action.key],
            ['已取 1/2 件', 'unmarkPicked', 'markPicked'],
            'G19 真实 DTO → 端侧件行「已取 n/m」与逐件动作（只消费服务端字段）');
            const realWrite = pieceActions.writeOf('markPicked', realP6.rows[0].pieceRows[0], realPicked.orderNo,
              realPicked.version, 'GID00000000000000000002');
            t.eq([realWrite.method, realWrite.payload.itemIndex, realWrite.opts.expectedVersion],
              ['markPicked', 1, realPicked.version], 'G20 真实 DTO 件行 → 写请求带 itemIndex（第 2 件）与 expectedVersion');
          });
        });
      });
    });
  });

  // ── H. v1.0 多包裹行聚合与逐件纠正（D23/D24/D25）─────────────────────────
  h.section('H v1.0 多包裹', (t) => {
    const multi = multiDto();
    const pieces = parcelView.piecesOf(multi);
    t.eq(pieces.map((item) => item.indexText), ['第 1 件', '第 2 件', '第 3 件'], 'H01 逐件视图：parcels[] 1~10 件按序展开');
    t.eq(parcelView.tierOfPieces(pieces), 1, 'H02 四档按整单最差件：任一需查明 → 整单进需查明档');
    t.eq(parcelView.stationGroupsOf(multi).map((group) => group.stationId), ['P4', 'P6'],
      'H03 D62 按件站点分区：3 件分属 P4/P6 两组（一单在两组各出现一次）');
    t.eq(parcelView.stationSummaryOf(pieces).text, 'P4 / P6', 'H04 站点聚合去重展示（P4 / P6）');
    t.eq([parcelView.countTextOf(pieces), parcelView.needCodeCountTextOf(pieces)],
      ['3 件', '1 件需查明'], 'H05 件数聚合 + 需查明聚合（按件）');
    t.eq(parcelView.reviewTextOf(pieces), '已反馈开发者复核', 'H06 识别失败聚合：单件失败给原文案');
    const multiRow = groupView.toRow(multi);
    t.eq([multiRow.parcelCount, multiRow.parcelCountText, multiRow.stationSummaryText, multiRow.needCodeCountText, multiRow.manualEntryText],
      [3, '3 件', 'P4 / P6', '1 件需查明', ''], 'H07 行聚合字段（件数/站点/需查明/无截图）');
    t.eq([multiRow.codeText, multiRow.parcelRows.length, multiRow.stationId],
      ['27-2-7016', 3, 'P4'], 'H08 行首仍首件码；逐件明细下发给面板；首件站点分组');
    t.eq(groupView.buildGroups([multi]).map((group) => group.stationId), ['P4', 'P6'],
      'H09 D62 多站点订单在每个件站点组各出现一次（行内只列本站件）');
    const normalRow = groupView.toRow(dto(STATUS.ACCEPTED));
    t.eq([parcelView.piecesOf(dto(STATUS.ACCEPTED)).length, normalRow.parcelCountText, normalRow.parcelRows],
      [1, '', null], 'H10 历史单包裹 DTO 兼容：视作 1 件、不出件数 chip、不灌 parcelRows');
    const manualRow = groupView.toRow(manualDto());
    t.eq([manualRow.manualEntry, manualRow.manualEntryText, manualRow.reviewText],
      [true, '无截图·手填', ''], 'H11 无截图·手填标识（D24）：不显示识别失败提示');
    const panel = rowActions.openPanel('correct', multiRow);
    t.eq([panel.type, panel.items.length, panel.itemIndex, panel.code], ['code', 3, 0, '27-2-7016'],
      'H12 补码面板带件切换器（多件单 items=3、默认第 1 件）');
    const switched = rowActions.switchCodePanel(panel, 1);
    t.eq([switched.itemIndex, switched.itemIndexText, switched.code, switched.trackingTail], [1, '第 2 件', '', '12345'],
      'H13 切到第 2 件：编辑初值换成该件（含运单尾号）');
    const writeFirst = rowActions.buildWrite('correct', multiRow, { patch: { pickupCode: '27-2-7016' }, itemIndex: 0 });
    t.eq([writeFirst.method, writeFirst.payload.itemIndex], ['correct', undefined],
      'H14 首件缺省 itemIndex 0 不传（兼容契约默认）');
    const writeThird = rowActions.buildWrite('correct', multiRow, { patch: { pickupCode: '109-2-3003' }, itemIndex: 2, itemIndexText: '第 3 件' });
    t.eq([writeThird.payload.itemIndex, writeThird.payload.patch.pickupCode], [2, '109-2-3003'],
      'H15 第 3 件纠正带 itemIndex=2（只改该件）');
    const batchRows = rowsOf([multi, dto(STATUS.ACCEPTED, { orderNo: 'H-3' })]);
    const correctPlan = batchView.plan('correct', batchRows, { batchActionId: 'HID00000000000000000001' });
    t.eq([correctPlan.ok, correctPlan.pieceCount, correctPlan.confirmText.indexOf('选中 2 单共 4 件') >= 0,
      correctPlan.confirmText.indexOf('\n顾客端同步。') >= 0],
      [true, 4, true, true], 'H16 批量改站点按件展开（2 单 4 件）且确认框写清单数/件数（第二行顾客端同步）');
    const seenPieces = [];
    return batchView.runCorrect(correctPlan, (item, batchActionId, itemIndex) => {
      seenPieces.push([item.orderNo, itemIndex, batchActionId]);
      if (itemIndex === 1) {
        const err = new Error('状态已变化');
        err.code = 'INVALID_TRANSITION';
        return Promise.reject(err);
      }
      return Promise.resolve({});
    }).then((result) => {
      t.eq(seenPieces.length, 4, 'H17 批量改站点逐单逐件循环（4 件 4 次调用）');
      t.eq(seenPieces.every((pair) => pair[2] === 'HID00000000000000000001'), true,
        'H18 逐件调用共享同一 batchActionId（同批可审计）');
      const pieceSummary = batchView.summary(correctPlan, result.results);
      t.eq([pieceSummary.pieceMode, pieceSummary.okCount, pieceSummary.failCount],
        [true, 3, 1], 'H19 结果按件汇总（成功 3 件 · 失败 1 件）');
      t.check(pieceSummary.text.indexOf('3 件成功，1 件失败') >= 0 && pieceSummary.text.indexOf('第 2 件') >= 0,
        'H20 失败件定位到「单号 第 k 件」（逐件结果如实上屏）');
      const retry = batchView.retryPlan(correctPlan, pieceSummary.failedOrderNos, pieceSummary.failedPieceKeys);
      t.eq([retry.queue.length, batchView.correctItemsOf(retry).length], [1, 1],
        'H21 重试只放回失败件（不重跑已成功件）');
      const stay = actionFlow.afterWriteIntent('correct', groupsOf([multi]), multiRow, { itemIndex: 1, itemIndexText: '第 2 件' });
      t.check(stay.toastText.indexOf('第 2 件已更正') >= 0 && stay.panel && stay.panel.itemIndex === 1,
        'H22 多件单改完一件停在本单同一件面板（可继续核对其他件）');
      const singleDone = actionFlow.afterWriteIntent('correct', groupsOf([dto(STATUS.ACCEPTED)]), normalRow, { itemIndex: 0 });
      t.eq(singleDone.panel, null, 'H23 单件单保持旧行为：补齐后不重复开面板');
      t.eq([normalRow.needCodeCountText, normalRow.stationSummaryText], ['', ''], 'H24 单件单不出聚合 chip（保持 v0.9 视觉）');
      t.notEmpty(pieces, 'H25 多包裹样本非空');
    });
  });

  // ── I. 空态入口按钮文案合并 + 0 单多选隐藏（UI 修复）──────────────────────
  h.section('I 空态入口按钮文案 + 0 单多选', (t) => {
    const wxml = textOf(PAGES.wxml);
    const indexSrc = textOf(PAGES.index);

    // 空态数据必须带 actions：曾用 plan.emptyInfo={title,text} 覆盖 initial empty → 三个按钮无文字
    const vacuum = loadView.emptyOf({ filter: 'all', keyword: '' });
    t.eq([vacuum.title, vacuum.text],
      ['今天还没有订单', '把绑定卡片发给顾客，让顾客自己绑定；或给熟客代客下单。'],
      'I01 空态逐句文案仍来自 filter-view（真空态）');
    t.eq([vacuum.actions.shareText, vacuum.actions.createOnBehalfText, vacuum.actions.replayText],
      ['分享绑定卡片', '代客下单', '重新看引导'], 'I02 空态 actions = guideView.emptyActions（三个按钮都有文字）');
    t.eq(vacuum.actions.shareHint, '顾客在自己手机上确认后才建立绑定', 'I03 分享提示随空态下发');
    t.eq(loadView.emptyOf({ filter: 'submitted' }).actions.shareText, '分享绑定卡片',
      'I04 筛空态同样带 actions（不因筛选丢按钮文案）');
    t.eq(loadView.emptyOf({ keyword: 'P4' }).title, '没找到匹配的订单', 'I05 搜索空态文案不变');

    const emptyPlan = loadView.applyRefresh({ list: [], page1Keys: [] }, {
      list: [], counts: loadView.COUNTS_FALLBACK, nextCursor: null
    }, { filterKey: 'all', keyword: '', nowMs: DOC_MS });
    t.eq(emptyPlan.emptyInfo.actions.replayText, '重新看引导',
      'I06 加载结果 emptyInfo 已合并 actions（不再只有 title/text）');
    const emptyPatch = loadView.resultPatch(emptyPlan, { filterKey: 'all', poll: false, selecting: false });
    t.eq([emptyPatch.setData.empty.actions.shareText, emptyPatch.setData.empty.title],
      ['分享绑定卡片', '今天还没有订单'], 'I07 resultPatch 下发的 empty 带 actions（空态三按钮有文字）');
    t.eq(emptyPatch.setData.hasRows, false, 'I08 0 单 → hasRows=false（顶部「多选」主按钮隐藏）');
    const readyPlan = loadView.applyRefresh({ list: [], page1Keys: [] }, {
      list: [dto(STATUS.SUBMITTED)], counts: loadView.COUNTS_FALLBACK, nextCursor: null
    }, { filterKey: 'all', keyword: '', nowMs: DOC_MS });
    t.eq(loadView.resultPatch(readyPlan, { filterKey: 'all', poll: false, selecting: false }).setData.hasRows, true,
      'I09 有单 → hasRows=true（多选入口恢复）');
    t.eq(loadView.resultPatch(readyPlan, { filterKey: 'all', poll: true, selecting: false }).setData.empty.actions.shareHint,
      '顾客在自己手机上确认后才建立绑定', 'I10 轮询行级补丁分支同样带 actions（不丢按钮文案）');

    t.check(/selecting \|\| hasRows/.test(wxml) && wxml.indexOf('hasRows') >= 0,
      'I11 WXML 顶部「多选」条件 = selecting || hasRows（0 单隐藏，多选中仍可退出）');
    t.check(indexSrc.indexOf('loadView.emptyOf(') >= 0 && indexSrc.indexOf('filterView.emptyOf(') === -1,
      'I12 页面空态统一走 loadView.emptyOf（initial/筛选/错误，actions 不再被覆盖）');
    t.notEmpty([vacuum.actions, emptyPatch.setData], 'I13 I 组样本非空');
  });

  // ── J. 工作台日期分类（D45=M1）+ P0-5 增量渲染（用例表拆 tools/lib，控测试文件 ≤1000 行）──
  h.section('J 日期分类与增量渲染', (t) => dayCases.dayGroupingChecks(t, {
    dto: dto,
    orderDoc: orderDoc,
    STATUS: STATUS,
    enums: enums,
    ISO: ISO,
    DOC_MS: DOC_MS,
    groupView: groupView,
    historyView: historyView,
    loadView: loadView,
    textOf: textOf,
    PAGES: PAGES
  }));

  // ── K. 已完结=昨日及更早（D53 单窗口翻页）+ 复制汇总=今日已送达（D54）────────
  h.section('K 已完结昨日及更早 + 今日已送达汇总', (t) => {
    const now = DOC_MS;
    const todayStart = historyView.dayStartMs(now);
    const state0 = historyView.pagingState();
    const openedNo = historyView.openedPaging({ list: [], nextCursor: null });
    const openedNext = historyView.openedPaging({ list: [], nextCursor: 'C1' });
    const expandQ = historyView.expandQuery(now);
    t.eq([state0.cursor, state0.hasMore, state0.olderLoaded], ['', true, 0],
      'K01 翻页初始态：无游标、hasMore 先 true（展开后以服务端 nextCursor 为准）');
    t.eq([expandQ.view, expandQ.from, expandQ.to, expandQ.limit, expandQ.cursor],
      ['history', undefined, todayStart - 1, historyView.HISTORY_LIMIT, undefined],
      'K02 已完结窗口 = 昨日及更早（to=今日0点-1、不带 from/游标；今天完成单只在「全部」D53）');
    t.eq([openedNo.cursor, openedNo.hasMore, openedNext.cursor, openedNext.hasMore], ['', false, 'C1', true],
      'K03 展开首屏 hasMore = 服务端 nextCursor（单窗口，不再需要「更早未知」占位）');
    const moreQ = historyView.moreQueryOf(now, openedNext);
    t.eq([moreQ.query.view, moreQ.query.to, moreQ.query.cursor], ['history', todayStart - 1, 'C1'],
      'K04 更早一页 = 同一窗口 + 服务端游标（单窗口游标分页，天然不重叠）');
    const page2 = historyView.moreResultOf(openedNext, { list: [{ orderNo: 'E-1' }, { orderNo: 'E-2' }], nextCursor: 'C2' });
    t.eq([page2.paging.cursor, page2.paging.hasMore, page2.paging.olderLoaded, page2.rows.length, page2.notice],
      ['C2', true, 2, 2, ''], 'K05 翻页推进：游标续传、累计已加载 2 行、正常页不提示到最早');
    const tailPage = historyView.moreResultOf(page2.paging, { list: [{ orderNo: 'E-3' }], nextCursor: null });
    t.eq([tailPage.paging.hasMore, tailPage.paging.cursor], [false, ''],
      'K06 末页无游标 → hasMore=false（按钮转「已到最早的订单」）');
    const emptyPage = historyView.moreResultOf(openedNext, { list: [], nextCursor: null });
    t.eq([emptyPage.paging.hasMore, emptyPage.notice], [false, 'earliest'],
      'K07 空页 → hasMore=false + 提示「已到最早的订单」');
    t.eq(historyView.mergeOlderRows([{ orderNo: 'A' }, { orderNo: 'B' }], [{ orderNo: 'B' }, { orderNo: 'C' }]),
      [{ orderNo: 'A' }, { orderNo: 'B' }, { orderNo: 'C' }], 'K08 跨页合并去重不重复行');
    t.eq(expandQ.to + 1, todayStart,
      'K09 窗口上界=今日0点-1：今天完成/取消的单被已完结窗口排除（只在「全部」今日流水；D53）');
    const collapsed = historyView.collapsedState({
      list: [{ orderNo: 'H-1' }],
      nextCursor: { sortValue: now, orderNo: 'H-1' }
    });
    t.eq(collapsed.text, '已完结 · 昨日及更早 1+ 单 >', 'K10 折叠入口「已完结 · 昨日及更早 N+ 单 >」');
    const yesterdayIncome = { orderNo: 'H-2', status: STATUS.COMPLETED, bucket: 'history', createdAt: '2026-10-21T10:00:00+08:00' };
    const panel = actionFlow.historyStateOf([yesterdayIncome], openedNo, false, now);
    t.eq([panel.hasMore, panel.moreText], [false, ''], 'K11 无下一页且已有昨日行 → 不显示「更多」按钮（零假入口）');
    const panelMore = actionFlow.historyStateOf([yesterdayIncome], openedNext, false, now);
    t.eq([panelMore.hasMore, panelMore.moreText], [true, '更早还有更多单 >'], 'K12 有下一页 → 「更早还有更多单 >」可见');
    const actionSrc = textOf(PAGES.actions);
    const indexSrc = textOf(PAGES.index);
    const wxml = textOf(PAGES.wxml);
    t.check(actionSrc.indexOf('historyView.moreQueryOf(') !== -1 && actionSrc.indexOf('historyView.moreResultOf(') !== -1,
      'K13 页面「更早」接单窗口状态机（moreQueryOf + moreResultOf）');
    t.check(actionSrc.indexOf('historyView.olderQuery(') === -1, 'K14 旧两阶段 olderQuery 接线已移除');
    t.check(actionSrc.indexOf('historyView.openedPaging(') !== -1, 'K15 展开成功即写状态机 openedPaging');
    t.check(indexSrc.indexOf('_historyPaging') !== -1, 'K16 页面状态存 _historyPaging');
    t.check(wxml.indexOf('bindtap="onHistoryMore"') !== -1, 'K17 WXML「更早」按钮仍接 onHistoryMore');

    // D54 复制汇总：今日已送达口径（deliveredAt 今日 + DELIVERED/COMPLETED、排除取消单 → 服务端聚合）
    const todaySummary = {
      scope: 'deliveredToday',
      total: 8,
      parcels: 10,
      completed: 5,
      pending: 3,
      byDorm: [{ zone: 'D', buildingNo: 4, count: 3 }, { zone: 'X', buildingNo: 2, count: 1 }],
      truncated: false
    };
    const copyBase = summaryCopy ? summaryCopy.copyOf(todaySummary) : null;
    t.eq(copyBase && copyBase.text,
      '【代取汇总】今日已送达 8 单（10 件）；东苑 4栋 3单；西苑 2栋 1单。已完成 5 / 待确认 3。',
      'K18 D54 文案：今日已送达 N 单（M 件）+ 苑/栋 + 已完成/待确认（只到苑/栋）');
    t.eq(copyBase && [copyBase.visible, copyBase.total, copyBase.parcels, copyBase.dormCount, copyBase.truncated],
      [true, 8, 10, 2, false], 'K19 视图字段：可复制/8 单/10 件/2 栋/未截断');
    t.eq(summaryCopy ? summaryCopy.copyOf(Object.assign({}, todaySummary, { total: 0, byDorm: [] })).visible : null,
      false, 'K20 今日 0 送达 → 不复制假文案（total=0）');
    t.eq(summaryCopy ? summaryCopy.copyOf(null).visible : null, false, 'K21 无 summary → 不可复制');
    const truncatedCopy = summaryCopy ? summaryCopy.copyOf(Object.assign({}, todaySummary, { truncated: true })) : null;
    t.check(!!truncatedCopy && truncatedCopy.text.indexOf('（仅统计最近 8 单，可能少报）') !== -1,
      'K22 P1-6 truncated 时新口径文案同样如实说明可能少报');
    t.eq(summaryCopy ? summaryCopy.copyOf(Object.assign({}, todaySummary, { byDorm: [] })).text : null,
      '【代取汇总】今日已送达 8 单（10 件）。已完成 5 / 待确认 3。',
      'K23 无苑/栋数据（缺地址单）仍给总单/进度，不编造楼栋行');
    t.eq(summaryCopy ? summaryCopy.copyOf({
      total: 2, parcels: 2, byStatus: { picked: 0, delivered: 0, ongoing: 2 }, byDorm: []
    }).text : null,
    '【代取汇总】当前 2 单（2 件）。进度：进行中 2 / 已取件 0 / 已送达 0。',
    'K24 旧 D48 形状仍走旧文案（服务端 workbench summary 向后兼容）');
    t.check(actionSrc.indexOf("require('./summary-copy')") !== -1 && wxml.indexOf('bindtap="onCopySummaryTap"') !== -1,
      'K25 工作台复制汇总接线：page-actions require 主包纯件 + WXML 按钮');
    t.check(wxml.indexOf('复制汇总') !== -1 && wxml.indexOf('只到苑/栋') !== -1,
      'K26 WXML「复制汇总」按钮 + 隐私范围提示（只到苑/栋）');
    t.check(actionSrc.indexOf('ensureCopySummary(') !== -1 && actionSrc.indexOf("view: 'day'") !== -1,
      'K27 复制 handler 用今日已送达 summary（缺失/counts 变了才补拉 view=day，正常零请求）');
    t.check(actionSrc.indexOf("'今天还没有送达的订单'") !== -1 && actionSrc.indexOf("'已复制，可发到顾客群'") !== -1,
      'K28 无送达不复制假文案 + 成功 toast 与统计页同口径');
    t.check(actionSrc.indexOf('copy.truncated') !== -1 && actionSrc.indexOf('可能少报') !== -1,
      'K29 truncated 时 toast 如实提示可能少报');
    t.check(indexSrc.indexOf('_summaryCounts') !== -1 && indexSrc.indexOf('filterView.FILTER_ALL && data && data.summary') !== -1,
      'K30 页面只在「全部」今日流水存 summary（其它 chip 的旧形状不覆盖）');
    t.check(!optionalRequire('pkg-partner/pages/stats/parts/summary-copy.js'),
      'K31 旧 pkg-partner 路径已删除（纯件主包单源）');
    t.eq(summaryCopy ? summaryCopy.copyOf(null).textOmitted : null, false,
      'K32 空数据视图 textOmitted=false（不复制假文案）');
    t.notEmpty([todaySummary, copyBase], 'K33 今日已送达样本非空');
  });

  // ── L. TD-083：日结批自动完成时刻配置化（batch-view 零第二处时刻字面量）─────────
  h.section('L 自动完成时刻配置化', (t) => {
    const fallbackAt = defaults.DEFAULT_CONFIG.autoCompleteAt;
    const pickedRows = rowsOf([dto(STATUS.PICKED, { orderNo: 'L-1' }), dto(STATUS.PICKED, { orderNo: 'L-2' })]);
    const at2230 = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '22:30' } });
    t.check(at2230.confirmText.indexOf('系统每天 22:30 自动完成送达单') >= 0,
      'L01 TD-083 合法基线：注入 config.autoCompleteAt=22:30 → 送达确认文案按配置时刻生成');
    t.eq([(at2230.confirmText.match(/22:30/g) || []).length, at2230.confirmText.indexOf(fallbackAt)],
      [1, -1], 'L02 文案时刻按配置值单处渲染（D51 文案只提一次时刻；缺省值不出现在配置生效文案里）');
    const noConfig = batchView.plan('deliver', pickedRows, {});
    t.check(noConfig.confirmText.indexOf('系统每天 ' + fallbackAt + ' 自动完成送达单') >= 0,
      'L03 缺配置 → 回退出厂默认（唯一默认单源 = config/defaults.DEFAULT_CONFIG.autoCompleteAt）');
    const outOfRange = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '25:00' } });
    t.eq([outOfRange.confirmText.indexOf(fallbackAt) >= 0, outOfRange.confirmText.indexOf('25:00')],
      [true, -1], 'L04 非法配置（25:00 越界）→ 回退默认，不把非法时刻上屏');
    const emptyClock = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '' } });
    t.eq(emptyClock.confirmText.indexOf('系统每天 ' + fallbackAt + ' 自动完成送达单') >= 0, true,
      'L05 空串配置值 → 同样回退默认（不生成「系统每天  自动完成」残句）');
    const nonString = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: 2230 } });
    t.eq([nonString.confirmText.indexOf(fallbackAt) >= 0, nonString.confirmText.indexOf('2230')], [true, -1],
      'L06 非字符串配置值（数字 2230）→ 回退默认，不上屏半截时刻');
    const trimmed = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: ' 22:30 ' } });
    t.check(trimmed.confirmText.indexOf('系统每天 22:30 自动完成送达单') >= 0,
      'L07 配置前后空格归一后使用（normalizeClockText 单源，不把脏值直接拼进文案）');
    const pickWithConfig = batchView.plan('pick', pickedRows, { config: { autoCompleteAt: '22:30' } });
    const pickNoConfig = batchView.plan('pick', pickedRows, {});
    t.eq(pickWithConfig.confirmText, pickNoConfig.confirmText,
      'L08 其它批量动作不受影响（无占位模板逐字一致，配置化只作用于送达文案）');
    t.check(at2230.confirmText.indexOf('将 2 单（共 2 件）') >= 0
      && at2230.confirmText.indexOf('guest 单无需确认') >= 0,
      'L09 配置化不影响件数替换与 guest 口径原文（N/M 与时刻同时正确）');
    const batchSrc = fsutil.stripComments(textOf('pages/partner/workbench/parts/batch-view.js'));
    t.check(batchSrc.indexOf(fallbackAt) === -1 && batchSrc.indexOf('{autoCompleteAt}') >= 0,
      'L10 纯件零第二处时刻字面量（剥注释后无默认时刻）、模板用 {autoCompleteAt} 占位单源');
    t.check(batchSrc.indexOf('defaults.DEFAULT_CONFIG.autoCompleteAt') >= 0
      && batchSrc.indexOf('defaults.normalizeClockText(') >= 0,
      'L11 默认值/归一判据都引用 config/defaults（唯一默认值来源），零件不本地写死时刻');
    t.check(at2230.confirmText.indexOf('该时刻前送达的当天完成') >= 0
      && at2230.confirmText.indexOf('该时刻后送达的下一轮自动完成') >= 0
      && at2230.confirmText.indexOf('顺延次日') === -1,
      'L12 D51 文案语义：该时刻前送达的当天完成、该时刻后送达的下一轮自动完成（不再写「顺延次日」）');
    const at2350 = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '23:50' } });
    t.check(at2350.confirmText.indexOf('系统每天 23:50 自动完成送达单') >= 0,
      'L13 显式注入 23:50 的可配置用例：文案按注入值生效（旧默认已成配置可改项）');
    const actionSrc = textOf(PAGES.actions);
    const tapBody = actionSrc.slice(actionSrc.indexOf('onBatchTap('));
    t.check(tapBody.indexOf("store.get('config')") >= 0
      && /batchTapIntent\([\s\S]{0,200}?this\.data\.readonly,\s*config\)/.test(tapBody),
      "L14 页面接线：onBatchTap 读 store.get('config') 并注入 actionFlow.batchTapIntent");
    const flowSrc = textOf('pages/partner/workbench/parts/action-flow.js');
    t.check(/function batchTapIntent\(key, groups, readonly, config\)/.test(flowSrc)
      && flowSrc.indexOf('batchView.plan(key, rows, { config: config })') >= 0,
      'L15 action-flow 接线：config 参数透传到 batch-view.plan（不吞配置、不本地判时刻）');
  });

  // ── M. 批 20（D53/D54）：全部=今日订单流水 + 复制汇总=今日已送达（用例表 tools/lib/order-workbench-cases.js）──
  h.section('M 今日订单流水与今日已送达汇总', (t) => orderCases.dayFlowChecks(t, {
    dto: dto,
    STATUS: STATUS,
    enums: enums,
    DOC_MS: DOC_MS,
    groupView: groupView,
    loadView: loadView,
    filterView: filterView,
    textOf: textOf,
    PAGES: PAGES
  }));

  // ── N. 批 25-B（D61/D62）：件级取件 + 多站点按件分组（用例表 tools/lib/workbench-picked-cases.js）──
  h.section('N D61 件级取件 / D62 多站点分组', (t) => pickedCases.pickedChecks(t, {
    parcelView: parcelView,
    groupView: groupView,
    pieceActions: pieceActions,
    rowActions: rowActions,
    selectionFlow: selectionFlow,
    batchView: batchView,
    loadView: loadView
  }));
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-order-workbench' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-order-workbench');
  h.setExpected(EXPECTED_ASSERTIONS === 0 ? -1 : EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
