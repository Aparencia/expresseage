'use strict';
/**
 * tools/selftest-order-customer.js — 批 5「顾客订单闭环」端侧断言套件（ENGINEERING §7.2 接入范式）。
 *
 * 覆盖（任务 task-64 A~G；UX §3.4/§3.8/§5/§8.1/§12.3 AC-C-21~30、QA E13/E17）：
 *   A. 七状态顾客视图矩阵：progress 节点态/异常分支/取消分支/actions 键集合/留言输入/截图状态/
 *      补码 marker 文案（task-67：云端 note=CODE_FILLED_NOTE → 时间线/提示条直上屏，不靠前后翻变）
 *   B. poll-policy 纯件：10s 基线、失败 20s→40s 退避封顶、成功复位、stop 后不再排程
 *   C. 倒计时/等待文案：serverTimeSkew 校时、statusUpdatedAt 解析、超时边界、行文案
 *   D. 列表分组映射：counts→tab、空态、软删防御过滤、再次下单入口、行视图
 *   E. reorder 纯件：只预填 service/station、禁用类型回退、失败静默、绝不带 code/image
 *   F. 页面静态：零 wx.cloud / 零七状态字面量 / 零 random / 轮询停接线 / expectedVersion / 只经 api/modules
 *   G. 端到端 fake transport：首拉成功→轮询失败退避→恢复成功（旧数据保留 + 最近更新时刻）、
 *      actions 完全由服务端 DTO 驱动、写动作 expectedVersion 透传、CONFLICT 人话、截图错误人话；
 *      首屏即已补码（needCode=false）→ 提示/时间线直接上屏（task-67，端云 note 同字面量联调）
 *   H. （D64 后已并入 P 组）取件码一级入口：伪 tab / 删 D26 订单区 / 首页入口卡删除 / 禁分享
 *   I. 截图区 v1.0：images[]{index,status,hasImage,cleaned} 三态/多图下标/历史单兼容/零存储句柄
 *   K. 顾客端 UI 修复（兼职卡/服务范围/服务类型/头像兜底/tab 居中/tabBar 选中态）
 *   L. C 批单点欠账收口（TD-068 服务范围预检单源 / TD-070「其他代办」码常量单源 / TD-064 死导出清除）
 *   P. D57「我的取件码（本机）」+ D64「取件码一级入口（伪 tab）」：行/时间/汇总/上限提示纯件 +
 *      页面零上传/零 wx.cloud/零第三方 AI 外呼/READONLY 静态接线 + 主包迁移/底部栏单源/禁分享
 *      （宽口径断言在 tools/lib/pickup-local-cases.js，拆件守 #18）
 *   Q. 批 25-C / D61 件级取件的顾客可见性：部分取件每件已取/待取+时间、摘要「已取 n/m 件」与提示、
 *      进度条第 3 步仍由订单 status=PICKED 驱动、全取后推进、旧单派生/旧 DTO 兼容、
 *      顾客侧 parcel.actions 恒空、列表行「已取 n/m 件」四态、件级事件通用人话、
 *      展示条件收敛（列表标签终态不显示；详情件级状态行/摘要限履约状态集）
 *      （宽口径断言在 tools/lib/order-customer-pickup-cases.js，拆件守 #18）
 *   R. 批 26-D58 转派顾客可见性：只读「由 P-XXX 接手履约」提示、只显示编号（无昵称头像/客户编号）、
 *      TRANSFER_ACCEPTED 时间线人话、4 个私有事件页面零特判、新增纯件零状态字面量
 *
 * 纪律：不 mock 全局 wx（api/client 用 setTransport 注入替身）；fake DTO/事件，不连真云；
 *       先合法基线再反例；样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-order-customer.js | Select-Object -Last 2
 */
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard } = require('./selftest');

const ROOT = path.resolve(__dirname, '..');

const view = require(path.join(ROOT, 'pkg-customer/parts/status-view.js'));
const flow = require(path.join(ROOT, 'pkg-customer/parts/order-detail-flow.js'));
const poll = require(path.join(ROOT, 'pkg-customer/parts/poll-policy.js'));
const format = require(path.join(ROOT, 'pkg-customer/parts/format.js'));
const ordersView = require(path.join(ROOT, 'pages/customer/parts/orders-view.js'));
const homeView = require(path.join(ROOT, 'pages/customer/home/parts/home-view.js'));
const guideView = require(path.join(ROOT, 'pages/customer/home/parts/guide-view.js'));
const storage = require(path.join(ROOT, 'utils/storage.js'));
const reorder = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/reorder.js'));
const parcelView = require(path.join(ROOT, 'pkg-customer/pages/order-detail/parts/parcel-view.js'));
const orderState = require(path.join(ROOT, 'shared/order-state.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const client = require(path.join(ROOT, 'api/client.js'));
const orderApi = require(path.join(ROOT, 'api/modules/order.js'));
const serverDto = require(path.join(ROOT, 'cloudfunctions/api/handlers/order/_dto.js'));
const precheck = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/precheck.js'));
const orderScopeReq = fsutil.tryRequire(path.join(ROOT, 'utils/order-scope.js'));
const orderScope = orderScopeReq.value || {};

const caseLib = require('./lib/order-customer-cases');
const pickupCases = require('./lib/order-customer-pickup-cases'); // 批25-C/D61：Q 组件级取件顾客可见性
// 实跑读数；批24-D64/D66：P 组扩 37（H 组 4 条并入并删除，+14 一级入口/文案断言）；批25-C/D61：+Q 组；批26-D58：+R 组 7
const EXPECTED_ASSERTIONS = 335 + pickupCases.ASSERTIONS + 9; // +9：D58 转派 R 组（R1~R6 共 7 + 批27 审查 P2-5 补 R3b/R3c 2）
const {
  STATUS, PAGES, ISO, NOW, DOC_MS, textOf, actionsFor, dto, event, orderDoc,
  FAKE_DTO_CTX
} = caseLib;
const ACTION_KEYS = view.ACTION_KEYS;

function register(h) {
  // ---------------------------------------------------------------- A 七状态矩阵
  h.section('A. 七状态顾客视图矩阵（进度/分支/actions/留言/截图逐格）', (t) => {
    const pickedIndex = orderState.progressIndex(STATUS.PICKED);
    const samples = [
      { key: STATUS.SUBMITTED, order: dto(STATUS.SUBMITTED), mode: 'normal',
        states: 'current,future,future,future,future', input: true, image: 'AVAILABLE' },
      { key: STATUS.ACCEPTED, order: dto(STATUS.ACCEPTED), mode: 'normal',
        states: 'done,current,future,future,future', input: true, image: 'AVAILABLE' },
      { key: STATUS.PICKED, order: dto(STATUS.PICKED), mode: 'normal',
        states: 'done,done,current,future,future', input: true, image: 'AVAILABLE' },
      { key: STATUS.DELIVERED, order: dto(STATUS.DELIVERED), mode: 'normal',
        states: 'done,done,done,current,future', input: true, image: 'AVAILABLE' },
      { key: STATUS.COMPLETED, order: dto(STATUS.COMPLETED), mode: 'normal',
        states: 'done,done,done,done,current', input: false, image: 'AVAILABLE' },
      { key: STATUS.CANCELLED, order: dto(STATUS.CANCELLED, { cancelReason: 'CHANGED_MIND', cancelReasonText: '不需要了' }),
        mode: 'cancelled', states: 'cancelled,cancelled,cancelled,cancelled,cancelled', input: false, image: 'AVAILABLE' },
      { key: STATUS.EXCEPTION, order: dto(STATUS.EXCEPTION, {
        exception: { code: 'PARCEL_NOT_FOUND', codeText: '驿站找不到件', text: '驿站暂时没找到这个件', fromStatus: STATUS.PICKED, at: ISO }
      }), mode: 'exception', states: 'done,done,exception,future,future', input: true, image: 'AVAILABLE' }
    ];
    t.eq(samples.map(function map(item) { return item.key; }), orderState.STATUS_LIST.slice(),
      'A0 样本覆盖七状态且顺序与 shared/enums 一致（七格全非空）');
    samples.forEach(function each(sample) {
      const actions = view.actionsView(sample.order, false);
      const enabled = ACTION_KEYS.filter(function filter(key) { return actions[key] === true; }).sort();
      const expected = sample.order.actions.map(function map(item) { return item.key; }).sort();
      t.eq(enabled, expected, 'A1 ' + sample.key + ' actions 键集合 = 服务端 DTO actions[]（不多不少）');
      t.eq(actions.labels.confirm, '确认已收到', 'A2 ' + sample.key + ' 按钮中文取服务端 label/兜底（确认已收到）');
      const progress = view.progressView(sample.order);
      t.eq(progress.mode, sample.mode, 'A3 ' + sample.key + ' 进度条分支模式');
      t.eq(progress.steps.map(function map(step) { return step.state; }).join(','), sample.states,
        'A4 ' + sample.key + ' 五节点 done/current/future/exception/cancelled 逐格');
      const message = view.messageView(sample.order, false);
      t.eq(message.inputVisible, sample.input, 'A5 ' + sample.key + ' 留言输入框可见性（只认 DTO message 动作）');
      t.eq(view.imageView(sample.order).state, sample.image, 'A6 ' + sample.key + ' 截图卡状态');
      t.check(view.statusText(sample.order.status).length > 0 && view.statusDesc(sample.order).length > 0,
        'A7 ' + sample.key + ' 状态标题/说明文案非空（§5.1）');
    });
    const exceptionAllowed = dto(STATUS.EXCEPTION, {
      actions: actionsFor(STATUS.EXCEPTION, STATUS.ACCEPTED),
      exception: { code: 'CODE_INVALID', codeText: '取件码/柜号无效或已被取走', text: '码不对', fromStatus: STATUS.ACCEPTED, at: ISO }
    });
    t.eq(view.actionsView(exceptionAllowed, false).cancel, true,
      'A8 异常单 fromStatus=ACCEPTED → 取消动作在 DTO 里（可取消分支）');
    t.eq(view.actionsView(samples[6].order, false).cancel, false,
      'A9 异常单 fromStatus=PICKED → 无取消动作（不可单方取消）');
    t.check(view.messageView(samples[4].order, false).archiveText.indexOf('留言已归档') >= 0,
      'A10 COMPLETED 留言只读归档提示（订单已完成，留言已归档）');
    t.check(view.progressView(samples[5].order).branchText.indexOf('不需要了') >= 0,
      'A11 CANCELLED 分支上屏取消原因（cancelReasonText）');
    t.eq(view.progressView(samples[6].order).branchText, '驿站暂时没找到这个件',
      'A12 EXCEPTION 分支原样展示 exception.text（AC-C-27）');
    const readonlyActions = view.actionsView(dto(STATUS.SUBMITTED), true);
    t.check(readonlyActions.cancel === false && readonlyActions.message === false
      && readonlyActions.confirm === false && readonlyActions.deleteRecord === false
      && readonlyActions.reorder === false && readonlyActions.readonly === true
      && readonlyActions.hint.length > 0,
    'A13 READONLY 会话隐藏全部写按钮、只留提示（无写入口）');
    t.eq(view.actionsView(dto(STATUS.COMPLETED, { actions: [{ key: 'hackMe', label: 'x' }] }), false),
      Object.assign({ labels: view.actionsView(null, false).labels, readonly: false, hint: '',
        cancel: false, message: false, confirm: false, deleteRecord: false, reorder: false }),
      'A14 服务端下发未登记动作键被忽略（不渲染未知按钮）');
    t.eq(view.actionsView(dto(STATUS.DELIVERED, { actions: [] }), false).confirm, false,
      'A15 DTO 无 confirm 动作 → 不显示确认按钮（页面不按本地状态机猜，单一判据）');
    t.check(view.cancelGuide(samples[2].order, false).indexOf('不能直接取消') >= 0
      && view.cancelGuide(samples[0].order, false) === ''
      && view.cancelGuide(samples[2].order, true) === '',
    'A16 不可取消状态给引导文案（已取件起）；可取消/READONLY 不出引导（AC-C-24）');
    t.eq(enums.ORDER_EVENTS.filter(function filter(type) {
      const text = view.eventText({ type: type });
      return typeof text === 'string' && text.length > 0 && text !== type;
    }), enums.ORDER_EVENTS, 'A17 ' + enums.ORDER_EVENTS.length + ' 种事件类型全部有人话映射（无裸英文事件名上屏）');
    const corrected = [{ type: 'ORDER_CORRECTED', at: ISO, note: '' }];
    t.eq([view.buildEvents(corrected, { codeFilled: true })[0].text,
      view.buildEvents(corrected, { codeFilled: false })[0].text],
    ['兼职已补齐取件码', '兼职更正了订单信息'],
    'A18 NEED_CODE 补码场景显示「兼职已补齐取件码」（轮询检出 needCode 翻变时）');
    t.eq(['PICKED_REVERTED', 'DELIVERED_REVERTED', 'ORDER_CORRECTED', 'EXCEPTION_RESOLVED'].map(function map(type) {
      return view.noticeText([{ type: type, at: ISO, note: '' }]).text;
    }), ['兼职更正了取件状态：已退回「已取件」。', '兼职更正了送达状态：订单回到配送中。',
      '兼职更正了订单信息，请核对最新取件信息。', '异常已解除，订单继续处理'],
    'A19 回退/纠正/异常解除的顶部提示条文案（UX §5.5）');
    // 批 5 补丁（task-67）：补码 marker 文案 —— 云端 handlers/order/correct.js 把补码事件 note 冻结为
    // 同一字面量；端侧凭 note 精确识别，不靠 needCode 前后翻变（首屏即补码同样可见）。先基线后反例。
    const MARKER = '兼职已补齐取件码';
    const cloudCorrect = textOf('cloudfunctions/api/handlers/order/correct.js');
    const viewSource = textOf('pkg-customer/parts/status-view.js');
    const markerRe = /CODE_FILLED_NOTE\s*=\s*'兼职已补齐取件码'/;
    t.eq([markerRe.test(viewSource), markerRe.test(cloudCorrect)], [true, true],
      'A20 端侧/云端 CODE_FILLED_NOTE 冻结字面量逐字一致（task-66/67，跨端防漂移；不为测试新增导出）');
    t.eq(view.buildEvents([{ type: 'ORDER_CORRECTED', at: ISO, note: MARKER }], {})[0].text, MARKER,
      'A21 补码 marker 时间线直接上屏「兼职已补齐取件码」（不拼成「兼职更正了订单信息：…」）');
    t.eq(view.buildEvents([{ type: 'ORDER_CORRECTED', at: ISO, note: '柜号更正' }], {})[0].text,
      '兼职更正了订单信息：柜号更正',
      'A22 非 marker 更正仍走通用拼接「兼职更正了订单信息：<note>」（补码识别不误伤普通更正）');
    t.eq(view.noticeText([{ type: 'ORDER_CORRECTED', at: ISO, note: MARKER }]).text,
      '兼职已补齐取件码，请核对最新取件码。',
      'A23 补码 marker 顶部提示条给核对引导（首屏与翻变同一条路径）');
    t.eq(view.noticeText([{ type: 'ORDER_CORRECTED', at: ISO, note: '柜号更正' }]).text,
      '兼职更正了订单信息（柜号更正）',
      'A24 非 marker 更正的提示条保持现有通用文案（不误报「已补齐」）');
    t.eq(view.noticeText([{ type: 'ORDER_CORRECTED', at: ISO, note: MARKER },
      { type: 'ORDER_CORRECTED', at: ISO, note: '柜号更正' }]).text, '兼职更正了订单信息（柜号更正）',
    'A25 提示条只认最新一条更正：历史出现过补码 marker 不冒充最近一次（防误报）');
    t.eq([view.eventText({ type: 'ORDER_CORRECTED', note: '' }, { codeFilled: true }),
      view.eventText({ type: 'ORDER_CORRECTED', note: '柜号更正' }, { codeFilled: true }),
      view.eventText({ type: 'ORDER_CORRECTED', note: MARKER }, { codeFilled: false })],
    [MARKER, MARKER + '：柜号更正', MARKER],
    'A26 旧 codeFilled 翻变路径兼容保留；marker note 在无翻变上下文下同样直上屏（首屏可显示）');
    t.notEmpty(samples, 'A 组样本非空');
  });

  // ---------------------------------------------------------------- B 轮询策略
  h.section('B. poll-policy 纯件（10s 基线 / 20s→40s 退避封顶 / 成功复位 / stop 不再排程）', (t) => {
    const idle = poll.create();
    t.eq(poll.delayOf(idle), 0, 'B1 未 start 不排程（delay=0）');
    const started = poll.start(idle);
    t.eq(poll.delayOf(started), 10000, 'B2 可见基线 10s');
    const fail1 = poll.onFailure(started);
    t.eq(poll.delayOf(fail1), 20000, 'B3 连续失败 1 次 → 20s 退避');
    const fail2 = poll.onFailure(fail1);
    t.eq(poll.delayOf(fail2), 40000, 'B4 连续失败 2 次 → 40s 退避');
    const fail3 = poll.onFailure(fail2);
    t.eq(poll.delayOf(fail3), 40000, 'B5 连续失败 3 次仍 40s（封顶，不无限放大）');
    t.eq(poll.MAX_BACKOFF_MS, 40000, 'B6 退避上界常量 = 40000ms');
    t.eq(poll.BACKOFF_MS.slice(), [20000, 40000], 'B7 退避序列单源 [20000, 40000]');
    const recovered = poll.onSuccess(fail3);
    t.eq([poll.delayOf(recovered), recovered.failures], [10000, 0], 'B8 成功后回 10s 且失败计数清零');
    t.eq(poll.delayOf(poll.start(fail3)), 10000, 'B9 重新可见（start）同样从 10s 基线开始');
    const stopped = poll.stop();
    t.eq(poll.delayOf(stopped), 0, 'B10 stop 后不再排程');
    t.eq(poll.delayOf(poll.onFailure(started)), 20000, 'B11 运行中失败仍按退避（未 stop）');
    t.eq([poll.shouldPoll(started), poll.shouldPoll(stopped)], [true, false],
      'B12 shouldPoll：运行中 true / stop 后 false');
    const stoppedAfterFail = poll.onFailure(stopped);
    t.eq([stoppedAfterFail.running, poll.delayOf(stoppedAfterFail)], [false, 0],
      'B13 stop 后的失败回调不得把轮询重新拉起');
    t.eq([started.failures, started.running], [0, true],
      'B14 状态更新不改写入参（纯函数：输入态保持 failures=0）');
    t.eq([poll.BASE_MS, poll.BACKOFF_MS.length], [10000, 2], 'B15 基线与退避档位与 UX §8.1 一致');
    t.notEmpty(poll.BACKOFF_MS, 'B 组样本非空');
  });

  // ---------------------------------------------------------------- C 倒计时/等待文案
  h.section('C. 倒计时/等待文案（serverTimeSkew 校时 / statusUpdatedAt 解析 / 超时边界）', (t) => {
    const now = Date.parse('2026-10-22T12:00:03+08:00');
    t.eq(ordersView.serverNowMs(0, now), now, 'C1 无偏差时服务端时间 = 本机时间');
    t.eq(ordersView.serverNowMs(5000, now), now - 5000, 'C2 skew=5000 → 服务端时间回拨 5s（以 serverTime 为准）');
    t.eq(ordersView.serverNowMs('bad', now), now, 'C3 非法 skew 静默按 0 处理（不把 NaN 传给倒计时）');
    const base = { status: STATUS.SUBMITTED, statusUpdatedAt: '2026-10-22T12:00:00+08:00' };
    const config = { orderTimeoutMinutes: 120 };
    t.eq(ordersView.waitingTextOf(base, Date.parse('2026-10-22T12:01:30+08:00'), config),
      '等待接单 01:58:30', 'C4 等待接单倒计时 = statusUpdatedAt + orderTimeoutMinutes（mm:ss）');
    t.eq(ordersView.waitingTextOf(base, Date.parse('2026-10-22T12:00:00+08:00'), config),
      '等待接单 02:00:00', 'C5 起点余量恰为配置分钟数');
    t.eq(ordersView.waitingTextOf(base, Date.parse('2026-10-22T14:00:00+08:00'), config),
      '等待接单超时，即将自动取消', 'C6 到期边界 → 超时文案（不再显示 00:00）');
    t.eq(ordersView.waitingTextOf(base, Date.parse('2026-10-22T15:00:00+08:00'), config),
      '等待接单超时，即将自动取消', 'C7 超过截止后仍给超时文案（文案稳定）');
    t.eq(ordersView.waitingTextOf(base, now, {}), '等待接单', 'C8 缺 orderTimeoutMinutes 配置 → 只说等待（不写死数字）');
    t.eq(ordersView.waitingTextOf({ status: STATUS.SUBMITTED, statusUpdatedAt: '' }, now, config),
      '等待接单', 'C9 statusUpdatedAt 解析失败 → 不显示假倒计时');
    t.eq(format.clock(new Date(2026, 9, 22, 12, 0, 3).getTime()), '12:00:03',
      'C10 「最近更新 HH:mm:ss」时刻格式（AC-C-29/E17）');
    const rows = [
      { status: STATUS.SUBMITTED, statusUpdatedAt: base.statusUpdatedAt, timeText: '等待接单 02:00:00' },
      { status: STATUS.PICKED, timeText: '已取件，配送中' }
    ];
    const ticked = ordersView.tickRows(rows, Date.parse('2026-10-22T12:00:10+08:00'), config);
    t.check(ticked[0].timeText === '等待接单 01:59:50' && ticked[1].timeText === rows[1].timeText,
      'C11 秒级 tick 只重算等待接单行，其他行文案不动');
    t.eq([STATUS.ACCEPTED, STATUS.PICKED, STATUS.DELIVERED, STATUS.COMPLETED, STATUS.CANCELLED].map(function map(status) {
      const sample = dto(status, {
        completedAt: '2026-10-22T12:00:00+08:00',
        cancelledAt: '2026-10-22T12:00:00+08:00'
      });
      return ordersView.timeTextOf(sample, now, config);
    }), ['已接单，正在安排取件', '已取件，配送中', '已送达，待你确认', '已完成 刚刚', '已取消 刚刚'],
    'C12 非等待行的行文案（§3.4/§5.1）');
    t.eq([ordersView.hasPending(rows), ordersView.hasPending([rows[1]])], [true, false],
      'C13 hasPending：存在 SUBMITTED 行才起 1s ticker');
    t.notEmpty(rows, 'C 组样本非空');
  });

  // ---------------------------------------------------------------- D 列表分组映射
  h.section('D. 列表分组映射（counts→tab / 空态 / 软删防御 / 再次下单入口 / 行视图）', (t) => {
    const tabs = ordersView.tabsWithCounts({ ongoing: 2, completed: 12, cancelled: 0 });
    t.eq(tabs.map(function map(tab) { return tab.label; }), ['进行中', '已完成', '已取消'],
      'D1 分组 tab 文案固定（进行中/已完成/已取消）');
    t.eq(tabs.map(function map(tab) { return tab.count; }), [2, 12, 0],
      'D2 分组计数取服务端 counts（进行中/已完成/已取消）');
    t.eq(ordersView.tabsWithCounts(null).map(function map(tab) { return tab.count; }), [0, 0, 0],
      'D3 counts 缺失 → 0（不猜、不显示 NaN）');
    t.eq(ordersView.tabsWithCounts({ ongoing: -3, completed: NaN, cancelled: '9' }).map(function map(tab) { return tab.count; }),
      [0, 0, 9], 'D4 负数/NaN 归零，字符串数字可解析（防御脏数据）');
    t.eq([ordersView.requestStatusOf('ONGOING'), ordersView.requestStatusOf('DONE'), ordersView.requestStatusOf('CANCELED')],
      ['', STATUS.COMPLETED, STATUS.CANCELLED],
      'D5 tab → 请求 status：进行中不带 status，已完成/已取消按状态过滤（服务端排序）');
    const empties = ['ONGOING', 'DONE', 'CANCELED'].map(function map(key) { return ordersView.emptyStateOf(key); });
    t.eq(empties.map(function map(item) { return item.text; }),
      ['这里还没有进行中的订单。', '还没有已完成的订单。', '没有取消过的订单。'], 'D6 三组空态文案');
    t.eq(empties.map(function map(item) { return item.actionText; }), ['去下单', '回首页', '回首页'],
      'D7 空态主 CTA：进行中给「去下单」，其余「回首页」');
    t.eq([STATUS.COMPLETED, STATUS.CANCELLED, STATUS.SUBMITTED, STATUS.PICKED].map(function map(status) {
      return ordersView.canReorder(dto(status));
    }), [true, true, false, false], 'D8 再次下单入口只给终态（COMPLETED/CANCELLED，§5.4）');
    const deleted = dto(STATUS.COMPLETED, { deletedByCustomerAt: ISO });
    t.eq(ordersView.visibleRows([dto(STATUS.SUBMITTED), deleted]), [dto(STATUS.SUBMITTED)],
      'D9 软删记录不展示（服务端已隐藏，客户端防御旧缓存/深链）');
    const rowOrder = dto(STATUS.SUBMITTED, { statusUpdatedAt: '2026-10-22T11:00:00+08:00' });
    const row = ordersView.rowView(rowOrder, { nowMs: Date.parse('2026-10-22T12:00:00+08:00'), config: { orderTimeoutMinutes: 120 } });
    t.eq([row.orderNo, row.status, row.codeText, row.customerLine, row.serviceName],
      ['20261022-0031', STATUS.SUBMITTED, '8-2-3021', '菜鸟驿站-3号楼 · D4-522', '标准代取'],
      'D10 行视图字段（orderNo/status/码/站点+宿舍/服务类型）');
    t.eq(row.timeText, '等待接单 01:00:00',
      'D11 进行中行显示等待接单倒计时（statusUpdatedAt + orderTimeoutMinutes，行组件 timeText 位）');
    const needCode = ordersView.rowView(dto(STATUS.SUBMITTED, {
      needCode: true,
      parcel: Object.assign({}, dto(STATUS.SUBMITTED).parcel, { pickupCode: '', trackingTail: '12345', codeStatus: 'NEED_CODE' })
    }), { nowMs: NOW, config: {} });
    t.eq(needCode.codeText, '需查明', 'D12 NEED_CODE 行显示「需查明」（不显示空码）');
    const tailOnly = ordersView.rowView(dto(STATUS.SUBMITTED, {
      parcel: Object.assign({}, dto(STATUS.SUBMITTED).parcel, { pickupCode: '', trackingTail: '12345', codeStatus: 'NEED_CODE' })
    }), { nowMs: NOW, config: {} });
    t.eq(tailOnly.codeText, '需查明', 'D13 无码有尾号同样进「需查明」支路（不与码混排）');
    t.eq(ordersView.rowView(dto(STATUS.COMPLETED), { nowMs: NOW, config: {} }).reorderable, true,
      'D14 已完成行暴露 reorder 入口标记');
    t.notEmpty(tabs, 'D 组样本非空');
  });

  // ---------------------------------------------------------------- E reorder 预填
  h.section('E. reorder 纯件（只预填 service/station / 禁用类型回退 / 失败静默 / 不带 L3）', (t) => {
    const old = dto(STATUS.COMPLETED, {
      parcel: Object.assign({}, dto(STATUS.COMPLETED).parcel, { pickupCode: '8-2-3021', lockerNo: '7号柜', trackingTail: '12345' }),
      service: { code: 'PICKUP_DOOR', name: '送寝上门' },
      image: { hasImage: true, cleaned: false }
    });
    const prefill = reorder.prefillFromOrder(old);
    t.eq(Object.keys(prefill).sort(), ['serviceCode', 'stationId', 'stationName'],
      'E1 预填快照恰好三键（绝不带取件码/尾号/柜号/截图/识别结果）');
    t.eq([prefill.serviceCode, prefill.stationId, prefill.stationName], ['PICKUP_DOOR', 'P3', '菜鸟驿站-3号楼'],
      'E2 只取服务类型码与站点（站点名以服务端站点表单源解析）');
    t.eq(reorder.prefillFromOrder(null), null, 'E3 无老订单 → 无预填（普通下单）');
    const services = [{ code: 'PICKUP_STD' }, { code: 'PICKUP_URGENT' }];
    t.eq(reorder.serviceCodeOf(prefill, services), '', 'E4 老服务类型已停用 → 不预填（回退页面默认第一项）');
    t.eq(reorder.serviceCodeOf(prefill, [{ code: 'PICKUP_DOOR' }]), 'PICKUP_DOOR',
      'E5 老服务类型仍启用 → 预填该类型');
    t.eq(reorder.stationOf({ stationId: 'P9', stationName: '自建驿站' }), { stationId: '', stationName: '' },
      'E6 站点不在 P1~P8 正式值域 → 不预填（宁可不填，不指到错驿站）');
    const base = { appointType: 'SLOT', slotIndex: 2, startAt: 'a', endAt: 'b', note: '旧备注' };
    const merged = reorder.defaultsFor(base, prefill, [{ code: 'PICKUP_DOOR' }]);
    t.eq([merged.serviceCode, merged.stationId, merged.appointType, merged.slotIndex, merged.note],
      ['PICKUP_DOOR', 'P3', 'SLOT', 2, '旧备注'],
      'E7 预填只叠加服务/站点，预约与备注保持调用方默认（不复制老单预约/备注）');
    const items = [
      { key: 'a', stationId: '', stationName: '', pickupCode: '' },
      { key: 'b', stationId: 'P6', stationName: '旧站', pickupCode: 'X1' }
    ];
    const applied = reorder.applyToItems(items, prefill, [{ code: 'PICKUP_DOOR' }]);
    t.eq([applied[0].stationId, applied[1].stationId], ['P3', 'P6'],
      'E8 逐件只补空站点，已有站点不覆盖');
    t.check(applied[0].pickupCode === '' && applied[1].pickupCode === 'X1' && !applied[0].image && !applied[0].failureId,
      'E9 取件码/截图/识别结果一律不继承（新单自己重新识别）');
    let calls = 0;
    return Promise.resolve().then(async () => {
      const ok = await reorder.load({
        orderNo: '20261022-0031',
        getOrder: function getOrder() {
          calls += 1;
          return Promise.resolve({ order: old });
        }
      });
      t.eq(ok, prefill, 'E10 load：order.get 成功后返回预填快照');
      const denied = await reorder.load({
        orderNo: '20261022-0000',
        getOrder: function getOrder() { return Promise.reject(Object.assign(new Error('无权查看'), { code: 'FORBIDDEN' })); }
      });
      t.eq(denied, null, 'E11 无权限/不存在/网络失败 → 静默 null（回普通下单，不打断）');
      const noOrder = await reorder.load({
        orderNo: '',
        getOrder: function getOrder() { calls += 1; return Promise.resolve({}); }
      });
      t.eq([noOrder, calls], [null, 1], 'E12 无 reorder 参数 → 不发 order.get（普通下单零额外外呼）');
      t.eq(reorder.orderNoOf({ reorder: ' 20261022-0031 ' }), '20261022-0031', 'E13 options.reorder 去空格取值');
      t.eq([reorder.orderNoOf({}), reorder.orderNoOf(null)], ['', ''], 'E14 无参数 → 空串（不猜）');
      t.notEmpty(items, 'E 组样本非空');
    });
  });

  // ---------------------------------------------------------------- F 页面静态（断言在 tools/lib/order-customer-cases.js#registerF，守 #18 行数）
  h.section('F. 页面静态：零 wx.cloud/零七状态字面量/零 random/轮询停接线/expectedVersion/只经 api', (t) => {
    caseLib.registerF(t);
  });

  // ---------------------------------------------------------------- G 端到端 fake transport
  h.section('G. 端到端 fake transport：首拉成功→轮询失败退避→恢复成功 + DTO 驱动 actions/写动作', async (t) => {
    store.reset();
    const sub = dto(STATUS.SUBMITTED);
    const accepted = dto(STATUS.ACCEPTED, { version: 4 });
    let index = 0;
    const steps = [
      { ok: true, data: { order: sub, events: [event('ORDER_CREATED', ISO), event('ACCEPTED', ISO)] }, serverTime: NOW },
      { ok: false, code: 'RATE_LIMITED' },
      { ok: false, code: 'RATE_LIMITED' },
      { ok: false, code: 'RATE_LIMITED' },
      { ok: true, data: { order: accepted, events: [event('ORDER_CREATED', ISO), event('ACCEPTED', ISO)] }, serverTime: NOW }
    ];
    try {
      client.setTransport(function transport() {
        const step = steps[Math.min(index, steps.length - 1)];
        index += 1;
        return Promise.resolve(step);
      });
      const deps = {
        orderNo: '20261022-0031',
        getOrder: orderApi.get,
        readonly: false,
        config: { orderTimeoutMinutes: 120, autoCompleteAt: '23:50' },
        now: function now() { return NOW; }
      };
      const s1 = await flow.refresh(flow.startPoll(flow.createSession()), deps);
      t.check(s1.view !== null && s1.everSucceeded === true && s1.pollError === '',
        'G1 首拉成功：视图就绪、无轮询错误');
      t.eq([s1.view.statusText, s1.view.actions.cancel, s1.view.actions.confirm],
        ['待接单', true, false], 'G2 状态/按钮来自服务端 DTO actions[]（待接单 → 取消，无确认）');
      t.eq(flow.lastUpdatedText(s1), '最近更新 ' + format.clock(NOW), 'G3 首拉成功记录「最近更新 HH:mm:ss」');
      t.eq(flow.pollDelay(s1), 10000, 'G4 成功后 10s 再拉');
      t.eq(s1.view.events.map(function map(item) { return item.text; }), ['订单创建', '已接单'],
        'G5 时间线事件 DTO 映射为人话（含时间格式）');
      const s2 = await flow.refresh(s1, deps);
      t.check(s2.view === s1.view && s2.order === s1.order,
        'G6 轮询失败不覆盖旧数据（视图/订单对象保持）');
      t.eq([s2.error, s2.pollError], ['', flow.POLL_ERROR_COPY], 'G7 非首屏失败只给顶部条「网络不稳定，正在重试…」');
      t.eq([s2.poll.failures, flow.pollDelay(s2)], [1, 20000], 'G8 失败 1 次 → 20s 退避');
      t.eq(flow.lastUpdatedText(s2), '最近更新 ' + format.clock(NOW), 'G9 失败不刷新「最近更新」时刻（不把旧数据冒充最新）');
      const s3 = await flow.refresh(s2, deps);
      t.eq(flow.pollDelay(s3), 40000, 'G10 连续失败 2 次 → 40s 退避');
      const s4 = await flow.refresh(s3, deps);
      t.eq([s4.poll.failures, flow.pollDelay(s4)], [3, 40000], 'G11 连续失败 3 次 → 40s 封顶');
      const s5 = await flow.refresh(s4, deps);
      t.check(s5.view !== null && s5.view.statusText === '已接单' && s5.pollError === '' && s5.error === '',
        'G12 恢复成功：视图更新到最新状态、顶部错误条消失');
      t.eq([s5.poll.failures, flow.pollDelay(s5), s5.view.actions.cancel, s5.view.actions.message],
        [0, 10000, true, true], 'G13 成功复位 10s 且动作随新 DTO 重算（已接单 → 取消+留言）');
      const applied = flow.applyOrder(s5, dto(STATUS.DELIVERED, { version: 5 }), deps);
      t.eq([applied.view.actions.confirm, applied.view.actions.cancel, applied.view.message.inputVisible],
        [true, false, true], 'G14 写动作返回 order 立即重绘（已送达 → 确认按钮出现，不等轮询）');
      t.check(applied.view.waitingHint.indexOf('每天 23:50 自动完成') >= 0, 'G14b 已送达等待提示按 D43 日结批时刻（config.autoCompleteAt=23:50）');
      const ro = view.actionsView(dto(STATUS.SUBMITTED), true);
      t.check(ro.cancel === false && ro.readonly === true, 'G15 READONLY 视图零写按钮');
      t.eq([view.actionsView(dto(STATUS.DELIVERED, { actions: [] }), false).confirm,
        view.actionsView(dto(STATUS.EXCEPTION, { actions: [{ key: 'unknown', label: 'x' }] }), false).cancel],
      [false, false], 'G16 按钮完全由 DTO actions[] 驱动（缺动作不猜；未知动作忽略）');
      t.eq([view.imageView(dto(STATUS.COMPLETED, { image: { hasImage: false, cleaned: true } })).state,
        view.imageView(dto(STATUS.COMPLETED, { image: { hasImage: false, cleaned: false } })).state,
        view.imageView(dto(STATUS.COMPLETED)).state], ['CLEANED', 'NONE', 'AVAILABLE'],
      'G17 截图三态：已清理/无图/可看');
      t.check(view.imageErrorText('NOT_FOUND', '截图已按隐私策略删除（完成/取消 7 天后）').indexOf('隐私策略删除') >= 0
        && view.imageErrorText('NOT_FOUND', '').indexOf('已过期') >= 0
        && view.imageErrorText('DEPENDENCY_FAILED', '').indexOf('加载失败') >= 0,
      'G18 截图加载失败/过期/已清理分别人话');
      const seen = [];
      client.setTransport(function capture(payload) {
        seen.push(payload);
        return Promise.resolve({ ok: true, data: { order: dto(STATUS.CANCELLED, { cancelReasonText: '不需要了' }) } });
      });
      const cancelled = await orderApi.cancel({ orderNo: '20261022-0031', reason: 'CHANGED_MIND', note: '' },
        { expectedVersion: 4 });
      t.eq([seen[0].action, seen[0].expectedVersion], ['order.cancel', 4],
        'G19 写动作把 DTO.version 作为 expectedVersion 透传到包络（服务端乐观锁）');
      t.eq(cancelled.order.cancelReasonText, '不需要了', 'G20 取消成功返回最新 order（页面立即重绘数据源）');
      client.setTransport(function conflict() {
        return Promise.resolve({ ok: false, code: 'CONFLICT' });
      });
      let conflictError = null;
      try {
        await orderApi.confirmDelivery({ orderNo: '20261022-0031' }, { expectedVersion: 3 });
      } catch (err) {
        conflictError = err;
      }
      t.check(!!conflictError && conflictError.code === 'CONFLICT'
        && conflictError.message === errorCopy.CODE_COPY.CONFLICT,
      'G21 CONFLICT → error-copy 人话「数据已被其他人更新，请刷新页面后重新操作」');
      client.setTransport(function miss() {
        return Promise.resolve({ ok: true, data: {} });
      });
      const missing = await flow.refresh(flow.createSession(), deps);
      t.eq([missing.everSucceeded, missing.view, missing.error], [false, null, flow.NOT_FOUND_COPY],
        'G22 首屏不存在/无权限 → 整页错误态 + 回列表文案（旧数据不存在可保留）');
      // 真实服务端 DTO（handlers/order/_dto.buildOrderDto，side=CUSTOMER）→ 客户端消费逐格一致
      const realDtos = [];
      for (let i = 0; i < orderState.STATUS_LIST.length; i += 1) {
        realDtos.push(await serverDto.buildOrderDto(FAKE_DTO_CTX, orderDoc(orderState.STATUS_LIST[i]), { side: 'CUSTOMER' }));
      }
      t.eq(realDtos.map(function map(item) { return item.status; }), orderState.STATUS_LIST.slice(),
        'G23 七状态真实服务端 DTO 全部生成成功（样本非空）');
      const serverEnabled = realDtos.map(function map(item) {
        return item.actions.map(function key(action) { return action.key; }).sort();
      });
      const clientEnabled = realDtos.map(function map(item) {
        const built = flow.buildView(item, [], { config: {} });
        return ACTION_KEYS.filter(function filter(key) { return built.actions[key] === true; }).sort();
      });
      t.eq(clientEnabled, serverEnabled,
        'G24 真实 DTO actions[] 与客户端按钮消费逐格一致（七状态，不多不少）');
      const labelOf = flow.buildView(realDtos[3], [], {}).actions.labels;
      t.eq([labelOf.confirm, labelOf.message], ['确认已收到', '留言'],
        'G25 按钮中文取服务端 ACTION_LABELS（DELIVERED=确认已收到/留言）');
      const completedLabels = flow.buildView(realDtos[4], [], {}).actions.labels;
      t.eq([completedLabels.deleteRecord, completedLabels.reorder], ['删除这条记录', '再次下单'],
        'G26 COMPLETED 按钮文案取服务端（删除这条记录/再次下单）');
      t.eq(flow.buildView(realDtos[4], [], {}).image.state, 'AVAILABLE',
        'G27 真实 DTO image{hasImage,cleaned} → 有图时客户端给「查看截图」');
      const cleanedDto = await serverDto.buildOrderDto(FAKE_DTO_CTX,
        orderDoc(STATUS.COMPLETED, { image: { fileId: 'cloud://test.env/orders/TKT/image.jpg', cleanedAt: DOC_MS } }),
        { side: 'CUSTOMER' });
      t.eq([cleanedDto.image.hasImage, cleanedDto.image.cleaned, view.imageView(cleanedDto).state],
        [false, true, 'CLEANED'], 'G28 服务端 cleaned 投影 → 客户端显示「已按隐私策略删除」');
      const cancelledView = flow.buildView(realDtos[5], [], {});
      t.check(cancelledView.progress.mode === 'cancelled' && cancelledView.progress.branchText.indexOf('不需要了') >= 0,
        'G29 真实 CANCELLED DTO 分支：进度置灰 + 取消原因上屏');
      const exceptionView = flow.buildView(realDtos[6], [], {});
      t.check(exceptionView.progress.mode === 'exception'
        && exceptionView.progress.branchText === '驿站暂时没找到这个件',
      'G30 真实 EXCEPTION DTO：上报来源节点标红 + exception.text 原样展示');
      // 批 5 补丁（task-67）：首屏进入即已补码（needCode=false，无 NEED_CODE 前后翻变）也要显示
      const firstScreen = flow.buildView(dto(STATUS.ACCEPTED),
        [event('ORDER_CREATED', ISO), event('ORDER_CORRECTED', ISO, '兼职已补齐取件码')], {});
      t.eq([firstScreen.notice.text, firstScreen.codeFilled],
        ['兼职已补齐取件码，请核对最新取件码。', false],
        'G31 首屏进入即已补码 → 顶部提示可见，codeFilled=false 证明不依赖 NEED_CODE 前后翻变');
      t.eq(firstScreen.events.map(function map(item) { return item.text; }), ['订单创建', '兼职已补齐取件码'],
        'G32 首屏时间线首帧同样直接上屏补码文案（无需等轮询翻变才提示）');
      const serverTrimmed = serverDto.buildEventDtos([
        { type: 'ORDER_CORRECTED', at: DOC_MS, actorRole: 'PARTNER', note: '兼职已补齐取件码' }
      ]);
      const e2eFilled = flow.buildView(dto(STATUS.ACCEPTED), serverTrimmed, {});
      t.eq([serverTrimmed[0].note, e2eFilled.events[0].text, e2eFilled.notice.text],
        ['兼职已补齐取件码', '兼职已补齐取件码', '兼职已补齐取件码，请核对最新取件码。'],
        'G33 真实服务端事件裁剪（_dto.buildEventDtos）保留 note → 客户端时间线/提示条命中补码文案（端云联调）');
      t.notEmpty(steps, 'G 组样本非空');
    } finally {
      client.restoreTransport();
      store.reset();
    }
  });

  // ---------------------------------------------------------------- H 已并入 P 组（D64：取件码升一级入口）
  // ---------------------------------------------------------------- I 截图区 v1.0 images[] DTO
  h.section('I. 截图区 v1.0：images[]{index,status,hasImage,cleaned} 三态/多图下标/历史单兼容/零存储句柄', (t) => {
    const multi = parcelView.imagesView({
      images: [
        { index: 0, status: 'AVAILABLE', hasImage: true, cleaned: false },
        { index: 1, status: 'CLEANED', hasImage: false, cleaned: true },
        { index: 2, status: 'AVAILABLE', hasImage: true, cleaned: false }
      ]
    });
    t.eq([multi.state, multi.canView, multi.count, multi.cleanedCount], ['AVAILABLE', true, 3, 1],
      'I1 v1.0 images[]：2 张可看 + 1 张已清理 → AVAILABLE（不再因 DTO 无存储句柄被过滤成「无截图·手填」）');
    t.eq(multi.list.map(function map(row) { return row.index; }), [0, 2],
      'I2 可看张 index 取服务端 image.index（多图切换向 order.imageUrl({index}) 传对下标）');
    const cleaned = parcelView.imagesView({ images: [{ index: 0, status: 'CLEANED', hasImage: false, cleaned: true }] });
    t.eq([cleaned.state, cleaned.canView, cleaned.text], ['EXPIRED', false, '截图已按隐私策略删除'],
      'I3 全部已清理 → EXPIRED 人话（cleaned 布尔/status=CLEANED 双口径同判）');
    const missing = parcelView.imagesView({ images: [{ index: 0, status: 'MISSING', hasImage: false, cleaned: false }] });
    t.eq([missing.state, missing.canView], ['NONE', false],
      'I4 MISSING（无图）→ NONE 无截图（不把「没图」冒充成「已按隐私策略删除」）');
    const legacy = parcelView.imagesView({ image: { hasImage: true, cleaned: false } });
    t.eq([legacy.state, legacy.list.length, (legacy.list[0] || {}).index, parcelView.imagesView({ images: [] }).state,
      parcelView.imagesView(null).state], ['AVAILABLE', 1, 0, 'NONE', 'NONE'],
    'I5 历史单 images 缺失 → order.image.hasImage 归一为单元素 index 0；空单/undefined 零截图 → NONE');
    const shotSource = textOf('pkg-customer/pages/order-detail/parts/parcel-view.js')
      + textOf('pkg-customer/parts/status-view.js');
    t.eq([/fileId/.test(shotSource), /cleanedAt/.test(shotSource)], [false, false],
      'I6 顾客端截图视图源码零存储句柄/清理时刻（服务端 DTO 只下发可见性摘要，看图只经 imageUrl）');
    const detailWxml = textOf(PAGES.detailWxml);
    const detailJs = textOf(PAGES.detail);
    t.check(/wx:for="\{\{image\.list\}\}"[\s\S]*data-index="\{\{item\.index\}\}"/.test(detailWxml)
      && /dataset\.index/.test(detailWxml + detailJs) && /index:\s*index/.test(detailJs)
      && /orderApi\.imageUrl\(\{[\s\S]*index:\s*index/.test(detailJs),
    'I7 详情多图切换接线：WXML 按 image.list[].index → onViewImage 取 dataset.index → order.imageUrl({orderNo,index})');
    t.notEmpty(multi.list, 'I 组样本非空');
  });

  // ---------------------------------------------------------------- J. A 批 P1-5/P1-6/P1-7（顾客端）
  h.section('J. A 批：订单角标接线/服务范围预检/首用三步引导（P1-5/P1-6/P1-7）', (t) => {
    const home = textOf(PAGES.home), homePlan = textOf(PAGES.homePlan);
    const orders = textOf(PAGES.orders);

    // P1-5 页面侧：订单格数量角标（不清零）
    t.check(/renderPlan\.refreshPlanOf\(/.test(home) && /ordersOngoing/.test(homePlan) && /counts\.ongoing/.test(homePlan),
      'J1 首页用 counts.ongoing 更新 store.badges.ordersOngoing（P1-5；判据单源 parts/render-plan，页内只接线）');
    t.check(/ordersOngoing/.test(orders) && /counts\.ongoing/.test(orders),
      'J2 订单列表同源更新 ordersOngoing（onShow/下拉刷新，不新增轮询）');
    t.check(!/ordersOngoing:\s*0/.test(home) && !/ordersOngoing:\s*0/.test(orders),
      'J3 页面无「进列表/点击清零」写法（数量角标与红点语义区分）');
    t.check(/badgeKey: 'ordersOngoing'/.test(textOf('components/tab-bar-view/tabs.js')),
      'J4 顾客「订单」格由 tabbar 按 badgeKey 渲染数量角标（D64 视觉/数据单源 components/tab-bar-view）');

    // P1-6 服务范围 + CTA 预检
    t.eq(homeView.scopeTextOf({ zones: ['东苑', '西苑'] }), '东苑 / 西苑', 'J5 服务范围文案=苑列表');
    t.eq([homeView.scopeTextOf({ zones: [] }), homeView.scopeTextOf(null)], ['全部苑', '全部苑'],
      'J6 无服务范围配置=全部苑（不误判为不可下单）');
    t.eq([
      homeView.zoneAllowedOf({ zones: ['东苑'] }, '东苑'),
      homeView.zoneAllowedOf({ zones: ['东苑'] }, '西苑'),
      homeView.zoneAllowedOf({ zones: [] }, '西苑'),
      homeView.zoneAllowedOf({ zones: ['东苑'] }, '')
    ], [true, false, true, true],
    'J7 顾客苑在范围→允许；不在→拦截；范围为空/顾客苑未知不误拦（服务端仍是唯一权威）');
    t.eq(homeView.orderBlockReasonOf({
      maintenanceText: '系统维护中', profileComplete: false, bound: false, partnerClosed: true, zoneAllowed: false
    }), '系统维护中', 'J8 前置原因优先级第一档=维护（高于资料/绑定/接单/范围）');
    t.eq([
      homeView.orderBlockReasonOf({ profileComplete: false }),
      homeView.orderBlockReasonOf({ profileComplete: true, bound: false })
    ], ['先完善资料', '先绑定兼职'], 'J9 资料/绑定原因文案');
    t.eq([
      homeView.orderBlockReasonOf({ profileComplete: true, bound: true, partnerClosed: true }),
      homeView.orderBlockReasonOf({ profileComplete: true, bound: true, zoneAllowed: false })
    ], ['该兼职暂不接单', '该兼职的服务范围不含你的苑，可换绑其他兼职。'],
    'J10 先接单开关后服务范围（两条文案分开，不合并）');
    t.eq([
      homeView.orderBlockReasonOf({ profileComplete: true, bound: true }),
      homeView.orderBlockReasonOf({ profileComplete: true, bound: true, zoneAllowed: true })
    ], ['', ''], 'J11 合法基线：条件全满足 → 可下单');
    t.check(/scopeText/.test(textOf(PAGES.homeWxml)) && /homeView\.orderBlockReasonOf/.test(homePlan) && /homeView\.zoneAllowedOf/.test(homePlan) && /renderPlan\.refreshPlanOf\(/.test(home),
    'J12 首页 WXML 展示服务范围 + CTA 预检走纯件（页面层零判据；判据单源 parts/render-plan）');

    // P1-7 顾客首用三步引导
    t.eq([guideView.GUIDE_KEY, guideView.total()], ['CUSTOMER_HOME_V1', 3],
      'J13 引导键=白名单 CUSTOMER_HOME_V1、共三步');
    t.eq([guideView.stateOf(0).title, guideView.stateOf(1).title, guideView.stateOf(2).title],
      ['先绑定兼职', '下单', '在「订单」看进度'], 'J14 三步=绑定/下单/看进度（D66：第 2 步标题改「下单」）');
    t.eq([
      guideView.stateOf(0).primaryText, guideView.stateOf(1).primaryText, guideView.stateOf(2).primaryText
    ], ['下一步', '下一步', '完成'], 'J15 按钮：前两步「下一步」、最后一步「完成」');
    t.eq([guideView.stateOf(0).isLast, guideView.stateOf(2).isLast], [false, true], 'J16 isLast 仅最后一步');
    t.eq([
      guideView.next(guideView.stateOf(0)).step,
      guideView.next(guideView.stateOf(2))
    ], [1, null], 'J17 下一步推进到 step1；最后一步 next=null（调用方写标记后关闭）');
    t.eq([
      guideView.showGuideOf(false).visible, guideView.showGuideOf(false).step, guideView.showGuideOf(true).visible
    ], [true, 0, false], 'J18 未看过→step0 显示；已完成→closed 不再出现');
    const platform = {
      data: {},
      getStorageSync: function get(key) { return this.data[key] || ''; },
      setStorageSync: function set(key, value) { this.data[key] = value; },
      removeStorageSync: function remove(key) { delete this.data[key]; }
    };
    t.eq(storage.isGuideSeen(guideView.GUIDE_KEY, platform), false, 'J19 首次进无引导标记（会展示引导）');
    t.eq(storage.markGuideSeen(guideView.GUIDE_KEY, platform), true, 'J20 完成/跳过写引导标记（utils/storage 单一出口）');
    t.eq(storage.isGuideSeen(guideView.GUIDE_KEY, platform), true, 'J21 有标记后不再出现（只本机记忆）');
    t.eq(storage.clearGuideSeen(guideView.GUIDE_KEY, platform), true,
      'J22 「我的→重新看新手引导」清标记（profile 既有入口，未改）');
    t.eq(storage.isGuideSeen(guideView.GUIDE_KEY, platform), false, 'J23 清标记后回到首次态（可重看）');
    t.check(/guide-mask/.test(textOf(PAGES.homeWxml)) && /onGuideSkip/.test(textOf(PAGES.homeWxml))
      && /storage\.isGuideSeen/.test(home) && /storage\.markGuideSeen/.test(home),
    'J24 首页接线：引导遮罩可跳过 + 读/写标记只经 utils/storage');
    t.check(/clearGuideSeen/.test(textOf('pages/profile/index.js')),
      'J25 「我的→重新看新手引导」仍走 clearGuideSeen（portal 未改，与新引导联动）');
    t.notEmpty(home, 'J 组样本非空');
  });

  // ── K. 顾客端 UI 修复：兼职卡重排 / 服务范围中文名 / 服务类型截断 / 头像兜底 / tab 居中 / tabBar 选中态
  h.section('K. 顾客端 UI 修复（兼职卡/服务范围/服务类型/头像兜底/tab 居中/tabBar 选中态）', (t) => {
    const homeWxml = textOf(PAGES.homeWxml);
    const home = textOf(PAGES.home), homePlan = textOf(PAGES.homePlan);
    const ordersWxml = textOf(PAGES.ordersWxml);
    const ordersWxss = textOf('pages/customer/orders/index.wxss');
    const orders = textOf(PAGES.orders);
    const tabBar = textOf('custom-tab-bar/index.js');

    // 服务范围：中文苑名（config.zoneLabels 覆盖 shared 默认），不再暴露 D/X/N/B/C 原始代号
    t.eq([homeView.scopeTextOf({ zones: ['D', 'X'] }), homeView.scopeTextOf({ zones: ['N', 'B', 'C'] })],
      ['东苑 / 西苑', '南苑 / 北苑 / 翠苑'], 'K1 服务范围用中文苑名（D/X/N/B/C → 东/西/南/北/翠苑）');
    t.eq(homeView.scopeTextOf({ zones: ['D'] }, { D: '东区' }), '东区', 'K2 config.zoneLabels 可覆盖默认苑名');
    t.eq([homeView.scopeTextOf(null), homeView.scopeTextOf({ zones: [] })], ['全部苑', '全部苑'],
      'K3 无服务范围配置=全部苑（不显示原始代号）');
    t.check(!/[A-Z]/.test(homeView.scopeTextOf({ zones: ['D', 'X', 'N', 'B', 'C'] })),
      'K4 五苑全配置时输出不含任何原始大写代号');
    t.eq([
      homeView.zoneAllowedOf({ zones: ['D'] }, '东苑'),
      homeView.zoneAllowedOf({ zones: ['东苑'] }, 'D'),
      homeView.zoneAllowedOf({ zones: ['D'] }, 'X'),
      homeView.zoneAllowedOf({ zones: ['D'] }, '')
    ], [true, true, false, true], 'K5 服务范围预检兼容代号/中文苑名（D 与 东苑 同苑；未知苑不误拦）');

    // 服务类型：只列已启用项；超过 3 项截断「等 N 项」（不撑高卡片）
    const catalog = enums.SERVICES;
    t.eq(homeView.serviceTextOf({ services: [{ code: 'PICKUP_STD' }, { code: 'DROP_OFF', enabled: false }] }, catalog),
      '标准代取', 'K6 服务类型只列已启用项（enabled:false 不展示）');
    t.eq(homeView.serviceTextOf({ services: enums.SERVICES.map((item) => ({ code: item.code })) }, catalog),
      '标准代取 / 送至楼下 / 加急代取 等 5 项', 'K7 超过 3 项截断为前 3 +「等 N 项」（N=已启用总数；D41 第 2 类=送至楼下）');
    t.eq(homeView.serviceTextOf({ services: [{ code: 'PICKUP_STD' }, { code: 'PICKUP_LOW' }, { code: 'DROP_OFF' }] }, catalog),
      '标准代取 / 送至楼下 / 代寄快递', 'K8 恰好 3 项不截断（边界；D41 新服务码 PICKUP_LOW）');
    t.eq([homeView.serviceTextOf(null, catalog), homeView.serviceTextOf({ services: [] }, catalog)], ['', ''],
      'K9 无启用服务类型 → 空串（页面显示「暂未设置」）');

    // 兼职卡展示模型：partnerPublic 优先，未返回前用 store.binding 启动期字段兜底（头像错误根因）
    const card = homeView.partnerCardOf(
      { partnerDisplayName: '旧名', partnerAvatarFileId: 'cloud://old.jpg', partnerNo: 'POLDOLD' },
      { displayName: '小王', avatarFileId: 'cloud://new.jpg', partnerNo: 'PNEWNEW', acceptingOrders: true }
    );
    t.eq([card.name, card.avatarFileId, card.partnerNo, card.acceptingText],
      ['小王', 'cloud://new.jpg', 'PNEWNEW', '接单中'], 'K10 partnerPublic 返回后覆盖启动期字段（新结果优先）');
    const bootCard = homeView.partnerCardOf(
      { partnerDisplayName: '小王', partnerAvatarFileId: 'cloud://bootstrap.jpg', partnerNo: 'PABC23' }, null);
    t.eq([bootCard.name, bootCard.avatarFileId, bootCard.partnerNo, bootCard.loaded],
      ['小王', 'cloud://bootstrap.jpg', 'PABC23', false],
      'K11 根因：partnerPublic 未到达时头像/昵称/编号用 store.binding 的 bootstrap 水合字段兜底（首帧不再空白/默认「代」）');
    const paused = homeView.partnerCardOf({ partnerDisplayName: '小王' }, { displayName: '小王', acceptingOrders: false });
    t.eq([paused.accepting, paused.acceptingText], [false, '暂停接单'], 'K12 暂停接单=独立状态标签文案（贴昵称旁）');
    t.eq(homeView.partnerCardOf(null, null).avatarFileId, '', 'K13 未绑定/无数据不崩溃（空卡片模型）');
    t.check(home.indexOf('customer.avatarFileId') === -1 && homeWxml.indexOf('customer.avatarFileId') === -1,
      'K14 兼职卡绝不引用顾客自己的头像字段（只显示对方头像/昵称）');

    // 静态接线：移除楼栋标签行；状态标贴昵称；展示语义全部走纯件
    t.check(homeWxml.indexOf('room-tag-text') === -1 && homeWxml.indexOf('roomTag') === -1,
      'K15 兼职卡移除 room-tag-text 楼栋行（不再与「接单中」同排造成「兼职楼栋」误解）');
    t.check(homeWxml.indexOf('partnerCard.avatarFileId') >= 0 && homeWxml.indexOf('partnerCard.acceptingText') >= 0,
      'K16 WXML 头像/接单状态取自 partnerCard（状态标在昵称旁）');
    t.check(home.indexOf('roomTag') === -1 && home.indexOf('dormKey') === -1,
      'K17 首页 vm 移除 roomTag/dormKey（不再向兼职卡下发楼栋）');
    t.check(home.indexOf('renderPlan.refreshPlanOf(') >= 0 && homePlan.indexOf('homeView.partnerCardOf(') >= 0 && homePlan.indexOf('homeView.serviceTextOf(') >= 0 && homePlan.indexOf('homeView.scopeTextOf(') >= 0 && homePlan.indexOf('function serviceText(') === -1,
      'K18 兼职卡展示语义全部走纯件（页面零判据、不在页面里截断服务类型；判据单源 parts/render-plan）');
    t.check(homeWxml.indexOf('order-empty-card') >= 0, 'K19 无进行中订单卡压缩为一行提示（卡片高度收口）');
    t.check(homeWxml.indexOf('name="{{partnerCard.name}}"') >= 0,
      'K20 头像 name 传对方昵称（无头像时显示对方昵称首字，不回落「代」）');

    // 订单页 tab 文案居中：.tab-item 需自成 flex 容器（.center 类才生效）
    t.check(/\.tab-item\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*center/.test(ordersWxss),
      'K21 订单页 .tab-item 加 display:flex + justify-content:center（「进行中/已完成/已取消」居中）');
    t.check(ordersWxml.indexOf('class="tab-item flex-1 center') >= 0,
      'K22 tab 子项保留 center 布局类（文案不改、只修布局）');

    // custom-tab-bar 选中态：4 个 tab 页 onShow 显式同步 + tabbar 自身兜底不重置成首页
    t.check(home.indexOf('getTabBar()') >= 0 && /setData\(\{\s*selected:\s*0/.test(home),
      'K23 首页 onShow 同步选中格=0');
    t.check(orders.indexOf('getTabBar()') >= 0 && /setData\(\{\s*selected:\s*1/.test(orders),
      'K24 订单页 onShow 同步选中格=1（不再高亮「首页」）');
    const workbench = textOf('pages/partner/workbench/index.js');
    const customers = textOf('pages/partner/customers/index.js');
    t.check(/setData\(\{\s*selected:\s*0/.test(workbench) && /setData\(\{\s*selected:\s*1/.test(customers),
      'K25 工作台/客户页 onShow 同步选中格=0/1（tabBar per-page 同步）');
    t.check(tabBar.indexOf('current.selected === selected') >= 0,
      'K26 tabbar 路径未命中时保留页面显式设置（不回落首页造成错格）');

    // D40/D41：下单页截图上限 10 张、逐图进度、送达层级说明、服务类型文案来自 config（页面零业务判据）
    const createWxml = textOf('pkg-customer/pages/order-create/index.wxml');
    t.check(/0~\{\{maxImages\}\} 张/.test(createWxml) && /maxImages:\s*MAX_IMAGES/.test(textOf(PAGES.create)),
      'K28 D40 下单页截图上限 10 张由共享常量渲染（0~{{maxImages}} 张）');
    t.check(/\{\{ocrIndex\}\}\/\{\{ocrTotal\}\}/.test(createWxml) && /ocrTotal/.test(textOf(PAGES.create)),
      'K29 D40 逐图识别进度「第 n/N 张」接线（wxml + 页面 onOcrPhase）');
    t.check(createWxml.indexOf('标准代取送到寝室门口（上楼）') >= 0
      && createWxml.indexOf('需要楼下自取请选『送至楼下』') >= 0,
    'K30 D41 地址卡送达层级说明（标准代取=楼上；楼下自取需选送至楼下）');
    t.check(createWxml.indexOf('range-key="name"') >= 0 && createWxml.indexOf('services[serviceIndex].name') >= 0,
      'K31 D41 服务类型选择器文案由 config.services 下发（order-create 不写死服务名）');

    t.notEmpty([homeWxml, ordersWxss, tabBar], 'K27 K 组静态样本非空');
  });

  // ---------------------------------------------------------------- L. C 批单点欠账收口（TD-064/068/070）
  h.section('L. C 批单点欠账：预检单源/「其他代办」码常量/死导出清除（TD-068/070/064）', (t) => {
    const homeViewSrc = textOf('pages/customer/home/parts/home-view.js');
    const precheckSrc = textOf('pkg-customer/pages/order-create/parts/precheck.js');
    const parcelSrc = textOf('cloudfunctions/api/handlers/order/_parcel.js');
    const adminCommonSrc = textOf('cloudfunctions/api/handlers/admin/_common.js');
    const cleanupEnums = require(path.join(ROOT, 'cloudfunctions/cleanup/shared/enums.js'));
    const stripped = (code) => fsutil.stripComments(code);
    // TD-068：两份同口径预检下沉 utils/order-scope.js，两页 require 单源（re-export 保留原导出名）
    t.check(typeof orderScope.zoneAllowedOf === 'function' && typeof orderScope.scopeTextOf === 'function'
      && typeof orderScope.RANGE_BLOCK_TEXT === 'string' && typeof orderScope.SCOPE_ALL_TEXT === 'string',
    'L1 TD-068 单源纯件 utils/order-scope.js 导出 zoneAllowedOf/scopeTextOf/RANGE_BLOCK_TEXT/SCOPE_ALL_TEXT');
    t.check(orderScopeReq.ok === true, 'L2 TD-068 纯件可 require（零 wx 纯函数；'
      + (orderScopeReq.error ? orderScopeReq.error.message : 'ok') + '）');
    t.check(homeView.zoneAllowedOf === orderScope.zoneAllowedOf && precheck.zoneAllowedOf === orderScope.zoneAllowedOf,
      'L3 TD-068 首页与下单页 zoneAllowedOf 引用同一函数（单源，未来不可能漂移）');
    t.eq([/function zoneAllowedOf/.test(stripped(homeViewSrc)), /function zonesOf/.test(stripped(homeViewSrc)),
      /function zoneAllowedOf/.test(stripped(precheckSrc)), /function zonesOf/.test(stripped(precheckSrc))],
    [false, false, false, false], 'L4 TD-068 两页不再各写 zoneAllowedOf/zonesOf 实现（重复实现清零）');
    t.check(/require\('\.\.\/\.\.\/\.\.\/\.\.\/utils\/order-scope'\)/.test(homeViewSrc)
      && /require\('\.\.\/\.\.\/\.\.\/\.\.\/utils\/order-scope'\)/.test(precheckSrc),
    'L5 TD-068 两页均 require utils/order-scope（同一单源文件）');
    t.eq([
      homeView.orderBlockReasonOf({ profileComplete: true, bound: true, zoneAllowed: false }),
      precheck.rangeCheckOf({ zone: 'N', partnerPublic: { zones: ['D'] } }).reason,
      homeView.scopeTextOf({ zones: [] })
    ], [orderScope.RANGE_BLOCK_TEXT, orderScope.RANGE_BLOCK_TEXT, orderScope.SCOPE_ALL_TEXT],
    'L6 TD-068 范围拦截文案/全部苑文案同源（原 home-view REASON.zone 与 precheck.RANGE_BLOCK_TEXT 合并）');
    t.eq([
      homeView.zoneAllowedOf({ zones: ['D'] }, '东苑'),
      precheck.zoneAllowedOf({ zones: ['D'] }, '东苑'),
      precheck.rangeCheckOf({ zone: '东苑', partnerPublic: { zones: ['D'] } }).ok,
      homeView.zoneAllowedOf({ zones: ['D'] }, 'X')
    ], [true, true, true, false],
    'L7 TD-068 差异反例：旧 precheck 纯字符串比较遇「代号↔中文苑名」混用会误拦（D vs 东苑），单源后两端一致放行、真不含仍拦');
    // TD-070：「其他代办」码 = shared/enums 显式常量，不再由 SERVICE_CODES 末项推导
    t.eq(enums.CUSTOM_SERVICE_CODE, 'CUSTOM', 'L8 TD-070 shared/enums 导出显式 CUSTOM_SERVICE_CODE=CUSTOM');
    t.eq(precheck.CUSTOM_SERVICE_CODE, enums.CUSTOM_SERVICE_CODE, 'L9 TD-070 客户端预检引用同一常量（不从 SERVICES 顺序推导）');
    t.check(precheckSrc.indexOf('enums.CUSTOM_SERVICE_CODE') >= 0
      && precheckSrc.indexOf('SERVICE_CODES[') < 0 && precheckSrc.indexOf('SERVICE_CODES.length') < 0,
    'L10 TD-070 precheck 源码零「SERVICE_CODES 末项」推导写法');
    t.check(parcelSrc.indexOf('const CUSTOM_SERVICE_CODE = enums.CUSTOM_SERVICE_CODE;') >= 0
      && parcelSrc.indexOf("const CUSTOM_SERVICE_CODE = 'CUSTOM'") < 0,
    'L11 TD-070 服务端 _parcel 引用同一常量（不再裸写字符串）');
    t.eq([require(path.join(ROOT, 'cloudfunctions/api/shared/enums.js')).CUSTOM_SERVICE_CODE,
      cleanupEnums.CUSTOM_SERVICE_CODE], ['CUSTOM', 'CUSTOM'],
    'L12 TD-070 sync 生成的两套云函数副本同步常量（sync-cloud-shared 单源）');
    t.check(enums.SERVICE_CODES.indexOf(enums.CUSTOM_SERVICE_CODE) >= 0,
      'L13 TD-070 常量仍在服务码目录内（目录与常量一致）');

    // TD-064：admin/_common 死导出 scanPaged（HEAD 起零生产调用）已删除，cloudfunctions+tools 去注释零残留
    const scanResidue = fsutil.walk(path.join(ROOT, 'cloudfunctions'), { exts: new Set(['.js']) })
      .concat(fsutil.walk(path.join(ROOT, 'tools'), { exts: new Set(['.js']) }))
      .filter((full) => full !== __filename && stripped(fsutil.readText(full)).indexOf('scanPaged') >= 0)
      .map((full) => fsutil.rel(full));
    t.eq(scanResidue, [], 'L14 TD-064 scanPaged 死导出零残留（cloudfunctions + tools 全量去注释扫描）');
  });

  // ---------------------------------------------------------------- M 预约「最晚可接受时间」详情展示（D47）
  h.section('M. 预约「最晚可接受时间」详情展示（D47）：文案/到点标红/不自动取消/历史 SLOT', (t) => {
    t.eq(typeof parcelView.appointView, 'function', 'M0 详情视图纯件导出 appointView（顾客/兼职同口径）');
    if (typeof parcelView.appointView !== 'function') return;
    const latestAt = '2026-10-22T12:00:00+08:00';
    const ms = Date.parse(latestAt);
    const base = {
      appoint: { type: 'LATEST', latestAt: latestAt, typeText: '最晚时间', text: '最晚 10月22日 12:00' },
      status: STATUS.ACCEPTED
    };
    const before = parcelView.appointView(Object.assign({}, base), ms - 60000);
    t.eq([before.appointText, before.appointOverdue, before.appointOverdueText],
      ['最晚 10月22日 12:00', false, ''], 'M1 详情展示「最晚 M月D日 HH:MM」；未到点不标红');
    const after = parcelView.appointView(Object.assign({}, base), ms + 60000);
    t.eq([after.appointOverdue, after.appointOverdueText.indexOf('不会自动取消') >= 0],
      [true, true], 'M2 到点未送达 → 行内标红提示「不会自动取消」（纯展示，不改状态）');
    const delivered = parcelView.appointView(Object.assign({}, base, { status: STATUS.DELIVERED }), ms + 60000);
    t.eq([delivered.appointOverdue, delivered.appointOverdueText], [false, ''],
      'M3 已送达不标红（到点≠超时处罚；无自动取消/无状态变更）');
    t.eq(parcelView.appointView(Object.assign({}, base, { status: STATUS.COMPLETED }), ms + 60000).appointOverdue,
      false, 'M4 终态（已完成）不标红');
    const asap = parcelView.appointView({ appoint: { type: 'ASAP', typeText: '尽快' }, status: STATUS.ACCEPTED }, ms + 60000);
    t.eq([asap.appointText, asap.appointOverdue], ['尽快', false], 'M5 尽快单无标红、文案「尽快」');
    const slot = parcelView.appointView({
      appoint: { type: 'SLOT', typeText: '预约时段', startAt: '2026-10-22T08:00:00+08:00', endAt: '2026-10-22T12:00:00+08:00' },
      status: STATUS.ACCEPTED
    }, ms + 60000);
    t.eq([slot.appointText, slot.appointOverdue], ['预约时段 08:00-12:00', false],
      'M6 历史 SLOT 单仍按「预约时段 + 起止」展示，不按最晚时间标红');
    const extras = parcelView.pageExtras(Object.assign({}, base), {}, ms + 60000);
    t.eq([extras.appointText, extras.appointOverdue, extras.appointOverdueText.length > 0],
      ['最晚 10月22日 12:00', true, true],
      'M7 详情页派生字段 pageExtras 带 appointText/appointOverdue/appointOverdueText');
    const detailWxml = textOf('pkg-customer/pages/order-detail/index.wxml');
    t.check(/appointOverdue/.test(detailWxml) && /appointText/.test(detailWxml),
      'M8 详情 WXML 渲染预约文案 + 到点标红（无自动取消按钮/无状态改写接线）');
    const detailFlow = textOf('pkg-customer/pages/order-detail/index.js');
    t.check(/pageExtras\(payload\.order, this\.data\.config, Date\.now\(\)\)/.test(detailFlow),
      'M9 详情页每次刷新用当前时钟重算标红（不必等用户重进页面）');
    t.notEmpty(latestAt, 'M 组样本非空');
  });

  // ---------------------------------------------------------------- N 首页 refresh 在途切 tab/卸载守卫（P2）
  h.section('N. 首页 refresh 在途切 tab/卸载守卫：迟到结果不写已隐藏页、不启 ticker（P2）', (t) => {
    const home = textOf(PAGES.home);
    // 判据①：await Promise.all 之后、结果 setData 之前必须判 _hidden（有牙：旧实现无守卫被判否）
    const guardedAfterAwait = (src) => {
      const awaitAt = src.indexOf('await Promise.all(tasks)');
      const guardAt = src.indexOf('if (this._hidden === true) return;', awaitAt);
      const setDataAt = src.indexOf('this.setData(plan.setData)');
      return awaitAt >= 0 && guardAt > awaitAt && setDataAt > guardAt;
    };
    // 判据②：startTicker 创建定时器之前必须判 _hidden
    const tickerGuarded = (src) => {
      const tickerAt = src.indexOf('startTicker() {');
      const guardAt = src.indexOf('if (this._hidden === true) return;', tickerAt);
      const intervalAt = src.indexOf('setInterval(', tickerAt);
      return tickerAt >= 0 && guardAt > tickerAt && intervalAt > guardAt;
    };
    const oldRefresh = 'async refresh() {\n'
      + '  const results = await Promise.all(tasks);\n'
      + '  this.setData(plan.setData);\n'
      + '  this.startTicker();\n'
      + '}\n';
    t.check(guardedAfterAwait(oldRefresh) === false,
      'N1 正控：旧 refresh 在途无隐藏守卫被判否（判据有牙）');
    t.check(guardedAfterAwait(home) === true,
      'N2 refresh await 后先判 _hidden 再 setData（切 tab/卸载的迟到结果不写已隐藏页）');
    t.check(tickerGuarded(home) === true,
      'N3 startTicker 建定时器前判 _hidden（已隐藏不启 ticker/不后台空转）');
    t.check(/onHide\(\)\s*\{\s*this\._hidden = true;/.test(home)
      && /onUnload\(\)\s*\{\s*this\._hidden = true;/.test(home),
    'N4 onHide/onUnload 置 _hidden（守卫有真实状态来源，不是常量恒假）');
    t.notEmpty(home, 'N 组样本非空');
  });

  // ---------------------------------------------------------------- O 批20-C 顾客高频页首屏灰色占位
  h.section('O. 批20-C 顾客高频页首屏灰色占位：订单页/首页去掉文字 loading，刷新保留旧内容（只这两页）', (t) => {
    const ordersWxml = textOf(PAGES.ordersWxml);
    const orders = textOf(PAGES.orders);
    const ordersWxss = textOf('pages/customer/orders/index.wxss');
    const homeWxml = textOf(PAGES.homeWxml);
    const homeWxss = textOf('pages/customer/home/index.wxss');
    const home = textOf(PAGES.home);
    const hasSkeleton = (wxml) => /skeleton/.test(wxml);
    const hasTextLoading = (wxml) => wxml.indexOf('加载中') >= 0;
    const oldOrders = '<view class="empty-text" wx:if="{{loadingVisible}}">加载中…</view>';
    t.check(hasTextLoading(oldOrders) === true && hasSkeleton(oldOrders) === false,
      'O1 正控：旧订单页文字 loading 被判否（判据有牙）');
    t.check(hasSkeleton(ordersWxml) === true && hasTextLoading(ordersWxml) === false,
      'O2 订单页首屏 = 灰色骨架占位，零「加载中…」文字');
    t.check(/wx:for="\{\{skeletonRows\}\}"/.test(ordersWxml)
      && /skeletonRows:\s*\[1,\s*2,\s*3\]/.test(orders)
      && /\.skeleton-[a-z]+\s*\{[^}]*background/.test(ordersWxss),
    'O3 骨架 3 张占位卡由页面数据驱动 + 灰色块样式（灰底，不是白屏/文字）');
    t.check(/loadingVisible && list\.length === 0/.test(ordersWxml),
      'O4 骨架只在首屏（list 为空）出现：刷新保留旧列表、不闪骨架');
    const loadBody = orders.slice(orders.indexOf('loadPage(reset) {'), orders.indexOf('scheduleLoadingVisible() {'));
    t.check(loadBody.length > 0 && loadBody.indexOf('list: []') < 0
      && loadBody.indexOf('list = reset ? rows : this.data.list.concat(rows)') >= 0,
    'O5 请求在途不清空旧列表，结果到达才整表替换（onShow 刷新保留旧内容）');
    t.check(homeWxml.indexOf('partner-name-skeleton') >= 0 && homeWxml.indexOf('资料加载中') < 0,
      'O6 首页兼职卡昵称位文字 loading → 灰色骨架条');
    t.check(/\.skeleton-line\s*\{[^}]*background:\s*#EEF0F3/.test(homeWxss)
      && /\.partner-name-skeleton\s*\{/.test(homeWxss),
    'O7 首页骨架条灰底样式（同客户页灰 #EEF0F3）');
    t.check(/wx:elif="\{\{loading\}\}"/.test(homeWxml),
      'O8 骨架只在数据未到时出现（有昵称直接渲染，loading=false 不占位）');
    const refreshBody = home.slice(home.indexOf('async refresh() {'), home.indexOf('// D42：兼职卡头像 URL 过期'));
    t.check(refreshBody.length > 0 && refreshBody.indexOf('order: null') < 0 && refreshBody.indexOf('vm:') < 0,
      'O9 首页 refresh 不清空旧内容（在途仍显示上次兼职卡/订单，结果到达才覆盖）');
    t.notEmpty([ordersWxml, homeWxml, ordersWxss, homeWxss], 'O 组样本非空');
  });

  // ---------------------------------------------------------------- P D57 本机取件码清单 + D64 取件码一级入口
  h.section('P. D57/D64 取件码：行/时间/汇总/上限纯件 + 本机零上传静态接线 + 伪 tab 一级入口迁移', (t) => {
    require('./lib/pickup-local-cases').registerP(t);
  });

  // ---------------------------------------------------------------- Q D61 件级取件顾客可见性（批 25-C）
  h.section('Q. D61 件级取件顾客可见性：每件已取/待取+时间、部分取件摘要与提示、进度仍按订单 status、列表标签、件级事件人话、端云联调', (t) => {
    return pickupCases.registerQ(t);
  });

  // ---------------------------------------------------------------- R D58 转派顾客可见性（批 26-W5）
  h.section('R. D58 转派顾客可见性：只读「由 P-XXX 接手履约」、只显示编号、时间线人话、页面零判据', (t) => {
    const detailWxml = textOf('pkg-customer/pages/order-detail/index.wxml');
    const detailJs = textOf('pkg-customer/pages/order-detail/index.js');
    const detailWxss = textOf('pkg-customer/pages/order-detail/index.wxss');
    const transferView = require(path.join(ROOT, 'pkg-customer/pages/order-detail/parts/transfer-view.js'));
    const accepted = Object.assign(dto(STATUS.ACCEPTED), {
      fulfillmentPartnerNo: 'P-NEW-001', transfer: { status: enums.TRANSFER_STATUS.ACCEPTED, toPartnerNo: 'P-NEW-001' }
    });
    const pending = Object.assign(dto(STATUS.ACCEPTED), {
      fulfillmentPartnerNo: 'P-OLD-001', transfer: { status: enums.TRANSFER_STATUS.PENDING, toPartnerNo: 'P-NEW-001' }
    });
    t.eq([transferView.pageExtras(accepted).transferHint, transferView.pageExtras(pending).transferHint,
      transferView.pageExtras(dto(STATUS.ACCEPTED)).transferHint],
    ['由 P-NEW-001 接手履约', '', ''],
    'R1 正控：DTO 显示已接手时给「由 {编号} 接手履约」；待确认/旧 DTO（无 transfer）不出提示（不猜编号）');
    const leak = Object.assign({}, accepted, {
      transfer: Object.assign({ displayName: '小王', avatarUrl: 'https://x/a.jpg', customerNo: 'C-LEAK' }, accepted.transfer)
    });
    const leakHint = transferView.pageExtras(leak);
    t.check(Object.keys(leakHint).length === 1 && leakHint.transferHint.indexOf('C-LEAK') < 0
      && leakHint.transferHint.indexOf('小王') < 0 && leakHint.transferHint.indexOf('https') < 0,
      'R2 顾客侧只显示编号：挂载昵称/头像/客户编号的 DTO 不进入提示（D19/D42 隐私边界）');
    const byFulfillment = Object.assign({}, accepted, { transfer: Object.assign({}, accepted.transfer, { toPartnerNo: '' }) });
    const byTransfer = Object.assign({}, accepted, { fulfillmentPartnerNo: '' });
    t.eq([transferView.pageExtras(byFulfillment).transferHint, transferView.pageExtras(byTransfer).transferHint],
      ['由 P-NEW-001 接手履约', '由 P-NEW-001 接手履约'],
      'R2b 编号来源：优先 DTO.fulfillmentPartnerNo（当前履约编号快照），缺失时回退 transfer.toPartnerNo');
    const events = transferView.eventsView([
      { id: 'e1', type: 'TRANSFER_ACCEPTED', text: 'TRANSFER_ACCEPTED' },
      { id: 'e2', type: 'ACCEPTED', text: '已接单' }
    ], accepted);
    const bare = transferView.eventsView([{ id: 'e3', type: 'TRANSFER_ACCEPTED', text: 'TRANSFER_ACCEPTED' }], {});
    t.eq([events[0].text, events[1].text, bare[0].text, bare[0].text.indexOf('TRANSFER')],
      ['由 P-NEW-001 接手履约', '已接单', '兼职已交接，后续由新兼职继续履约', -1],
      'R3 时间线 TRANSFER_ACCEPTED 换顾客人话（有编号带编号；编号缺失退回通用人话，不出现英文事件名）；其余事件原样');
    // R3b/R3c（审查 P2-5）：二次转派 A→B→C 只改写最近一条，更早一条通用人话（顾客侧事件 DTO 无 payload.toPartnerNo）
    const acceptedNow = Object.assign(dto(STATUS.ACCEPTED), {
      fulfillmentPartnerNo: 'P-LATEST-002',
      transfer: { status: enums.TRANSFER_STATUS.ACCEPTED, toPartnerNo: 'P-LATEST-002' }
    });
    const older = { id: 't1', type: 'TRANSFER_ACCEPTED', at: '2026-11-03T10:00:00+08:00' };
    const newer = { id: 't2', type: 'TRANSFER_ACCEPTED', at: '2026-11-03T11:00:00+08:00' };
    const desc = transferView.eventsView([newer, older], acceptedNow);
    const asc = transferView.eventsView([older, newer], acceptedNow);
    t.eq([desc[0].text, desc[1].text, asc[0].text, asc[1].text],
      ['由 P-LATEST-002 接手履约', '兼职已交接，后续由新兼职继续履约',
        '兼职已交接，后续由新兼职继续履约', '由 P-LATEST-002 接手履约'],
      'R3b 二次转派（A→B→C）只把最近一条 TRANSFER_ACCEPTED 换成当前编号，更早一条退回通用人话；与下发顺序无关');
    const noAt = transferView.eventsView([{ id: 'n1', type: 'TRANSFER_ACCEPTED' }, { id: 'n2', type: 'TRANSFER_ACCEPTED' }], acceptedNow);
    t.eq([noAt[0].text, noAt[1].text],
      ['兼职已交接，后续由新兼职继续履约', '由 P-LATEST-002 接手履约'],
      'R3c 历史事件缺 at 时按下发顺序以最后一条为最近交接（不拿当前编号冒充更早的交接）');
    t.check(/wx:if="\{\{transferHint\}\}"/.test(detailWxml) && /\.transfer-hint\s*\{/.test(detailWxss)
      && /parts\/transfer-view/.test(detailJs) && /transferView\.pageExtras\(payload\.order\)/.test(detailJs)
      && /transferView\.eventsView\(payload\.events, payload\.order\)/.test(detailJs),
    'R4 详情页接线：状态卡渲染提示（wx:if）、样式类已定义、显示与否/文案由纯件按 DTO 计算（页面零判据）');
    t.eq(caseLib.layerHits(textOf('pkg-customer/pages/order-detail/parts/transfer-view.js')), [],
      'R5 新增纯件零 wx.cloud/零七状态字面量/零 random/零直调 client.call（门禁 #21）');
    t.eq(['TRANSFER_REQUESTED', 'TRANSFER_DECLINED', 'TRANSFER_CANCELLED', 'TRANSFER_EXPIRED'].filter(function hit(type) {
      return detailJs.indexOf(type) >= 0 || detailWxml.indexOf(type) >= 0;
    }), [], 'R6 4 个私有转派事件顾客页面零特判（服务端消息中心已拉黑，页面不做过滤/隐藏判据）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-order-customer' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-order-customer');
  h.setExpected(EXPECTED_ASSERTIONS === 0 ? -1 : EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
