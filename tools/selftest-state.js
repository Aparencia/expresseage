'use strict';
/**
 * tools/selftest-state.js — v4 状态机 / 视图模型 / 四档排序 / 编号 / roomTag / 启动分流 / 页面零件。
 * 分层依据：docs/V4_ENGINEERING.md §7.1（纯件 shared/utils/config + 页面零件 parts/）。
 * 判据纪律：先合法基线、再只有该闸能挡的反例；样本非空；期望值以 docs/V4_CONTRACT.md 与镜像为准，
 *           不抄现状。EXPECTED_ASSERTIONS 必须精确等于实际断言数（少算/多算都判红）。
 * 接入：tools/selftest.js 里 `h.setExpected(require('./selftest-state').EXPECTED_ASSERTIONS)` 后 register(h)。
 * 零金额：本文件不得出现口径词表（ENGINEERING §7.6）字面量，需要时用构造串。
 */
const fs = require('fs');
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');
const project = require('./lib/project');

const ROOT = path.resolve(__dirname, '..');
const state = require(path.join(ROOT, 'shared/order-state.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const orderView = require(path.join(ROOT, 'shared/order-view.js'));
const format = require(path.join(ROOT, 'shared/format.js'));
const validate = require(path.join(ROOT, 'shared/validate.js'));
const ids = require(path.join(ROOT, 'utils/ids.js'));
const roomTag = require(path.join(ROOT, 'utils/room-tag.js'));
const route = require(path.join(ROOT, 'config/route.js'));
const defaults = require(path.join(ROOT, 'config/defaults.js'));
const statusView = require(path.join(ROOT, 'pkg-customer/parts/status-view.js'));
const createModel = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/model.js'));

const EXPECTED_ASSERTIONS = 340; // 改为实际断言数时同步核对 `node tools/selftest-state.js` 读数

const STATUS = state.STATUS;
const ALL_ROLES = ['CUSTOMER', 'PARTNER', 'SYSTEM', 'ADMIN'];

// ---------------------------------------------------------------- §5 状态机
function sectionStatusMachine(h) {
  h.section('§5 订单状态机（七状态与转移表）', (t) => {
    t.eq(state.STATUS_LIST.length, 7, '§5 七状态恰好 7 个');
    t.eq(state.STATUS_LIST.slice(), enums.ORDER_STATUS_LIST.slice(), '§5 状态表与 shared/enums 同源');
    t.eq(state.STATUS_LIST.slice().sort(),
      ['ACCEPTED', 'CANCELLED', 'COMPLETED', 'DELIVERED', 'EXCEPTION', 'PICKED', 'SUBMITTED'],
      '§5 七状态字面量与 CONTRACT 一致');
    t.eq(Object.keys(state.TRANSITIONS).sort(), state.STATUS_LIST.slice().sort(), '§5 转移表覆盖全部七状态');
    t.eq(state.TERMINAL_STATUSES.slice().sort(), ['CANCELLED', 'COMPLETED'], '§5 终态只有已完成/已取消');
    t.eq(state.ACTIVE_STATUSES.length, 5, '§5 进行中集合 5 个（非终态）');
    t.eq(state.PROGRESS_STEPS.slice(), ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED'],
      '§5 顾客进度条固定五步');
    t.eq(state.MAX_CREATE_BATCH, 5, '§5 一图多码批量上限 5');
    t.eq(state.STATUS_TEXT, enums.ORDER_STATUS_TEXT, '§5 状态文案与 shared/enums 同源');

    const edges = [];
    Object.keys(state.TRANSITIONS).forEach((from) => {
      state.TRANSITIONS[from].forEach((to) => edges.push(from + '>' + to));
    });
    t.notEmpty(edges, '§5 转移边样本（空集不得判绿）');
    t.check(edges.every((edge) => {
      const pair = edge.split('>');
      return state.isOrderStatus(pair[0]) && state.isOrderStatus(pair[1]);
    }), '§5 每条转移边两端都是合法状态');
    t.check(edges.every((edge) => {
      const pair = edge.split('>');
      return state.canTransition(pair[0], pair[1]);
    }), '§5 表内声明的每条边都判可转移（合法基线）');
    t.check(edges.every((edge) => Object.keys(state.TRANSITIONS).length > 0), '§5 转移表非空');

    const illegal = [
      ['SUBMITTED', 'PICKED'], ['SUBMITTED', 'DELIVERED'], ['SUBMITTED', 'COMPLETED'],
      ['ACCEPTED', 'DELIVERED'], ['ACCEPTED', 'COMPLETED'],
      ['PICKED', 'COMPLETED'], ['DELIVERED', 'SUBMITTED'],
      ['EXCEPTION', 'COMPLETED'], ['EXCEPTION', 'SUBMITTED'],
      ['COMPLETED', 'ACCEPTED'], ['CANCELLED', 'SUBMITTED']
    ];
    t.check(illegal.every((pair) => !state.canTransition(pair[0], pair[1])),
      '§5 直跳/回退（如 PICKED→COMPLETED）必须挡');
    t.check(['COMPLETED', 'CANCELLED'].every((terminal) => state.STATUS_LIST.every(
      (to) => !state.canTransition(terminal, to))), '§5 终态无出边');
    t.check(!state.canTransition('BOGUS', 'ACCEPTED') && !state.canTransition('SUBMITTED', 'BOGUS'),
      '§5 未知状态不转移');
    t.eq(state.TRANSITIONS.EXCEPTION.slice(), ['ACCEPTED', 'PICKED', 'DELIVERED', 'CANCELLED'],
      '§5 异常恢复/取消四出口');
  });
}

// ---------------------------------------------------------------- §5.1 动作规则
function sectionActionRules(h) {
  h.section('§5.1 动作规则与角色（接单/取消/undo/异常恢复）', (t) => {
    const rules = state.ACTION_RULES;
    const actionNames = Object.keys(rules);
    t.notEmpty(actionNames, '§5.1 动作规则样本（空集不得判绿）');
    t.check(actionNames.every((a) => !!project.ACTIONS[a]), '§5.1 动作规则全部在 CONTRACT 动作镜像中登记');
    t.check(actionNames.every((a) => rules[a].from.every((s) => state.isOrderStatus(s))),
      '§5.1 from 全部为合法状态');
    t.check(actionNames.every((a) => ['SAME', 'UNDO', 'FROM_STATUS'].indexOf(rules[a].to) !== -1
      || state.isOrderStatus(rules[a].to)), '§5.1 to 只能是状态或 SAME/UNDO/FROM_STATUS');
    t.check(actionNames.every((a) => Array.isArray(rules[a].roles) && rules[a].roles.length > 0
      && rules[a].roles.every((role) => ALL_ROLES.indexOf(role) !== -1)), '§5.1 每个动作角色非空且合法');
    t.check(actionNames.filter((a) => a !== 'order.undo')
      .every((a) => enums.ORDER_EVENTS.indexOf(rules[a].event) !== -1),
    '§5.1 事件类型都在 16 种枚举内（undo 事件按 UNDO_TARGETS 动态解析）');
    t.check(Object.keys(state.UNDO_TARGETS).every(
      (from) => enums.ORDER_EVENTS.indexOf(state.UNDO_TARGETS[from].event) !== -1),
    '§5.1 undo 实际落库事件在 16 种枚举内');
    t.eq(enums.ORDER_EVENTS.length, enums.ORDER_EVENT_COUNT, '§5.1 事件枚举条数与登记一致');

    t.eq(rules['order.accept'].roles, ['PARTNER'], '§5.1 接单仅兼职');
    t.eq(rules['order.accept'].from, ['SUBMITTED'], '§5.1 仅待接单可接单');
    t.eq(rules['order.confirmDelivery'].roles, ['CUSTOMER'], '§5.1 确认送达仅顾客');
    t.eq(rules['order.deleteRecord'].from, ['COMPLETED'], '§5.1 删除记录仅已完成单');
    t.check(rules['order.deleteRecord'].changesStatus === false, '§5.1 删除记录不改状态');
    t.eq(rules['order.reportException'].from.slice().sort(), ['ACCEPTED', 'DELIVERED', 'PICKED'],
      '§5.1 三类进行中可报异常');
    t.eq(rules['order.cancel'].from.slice(), state.ACTIVE_STATUSES.slice(), '§5.1 取消覆盖全部进行中');

    t.eq(state.UNDO_WINDOW_MS, 5000, '§5.1 undo 窗口 5 秒');
    t.eq(Object.keys(state.UNDO_TARGETS).sort(), ['DELIVERED', 'PICKED'], '§5.1 仅取件/送达可 undo');
    t.eq(state.UNDO_TARGETS.PICKED.to, 'ACCEPTED', '§5.1 撤销取件回已接单');
    t.eq(state.UNDO_TARGETS.DELIVERED.to, 'PICKED', '§5.1 撤销送达回已取件');
    t.check(rules['order.undo'].changesStatus === true, '§5.1 undo 会改状态');
    t.check(['order.markPicked', 'order.markDelivered'].every(
      (a) => !!state.UNDO_TARGETS[state.nextStatus(a, rules[a].from[0])]), '§5.1 undo 目标覆盖两类动作');

    t.check(state.canAct('order.accept', STATUS.SUBMITTED, 'PARTNER'), '§5.1 兼职可接待接单');
    t.check(!state.canAct('order.accept', STATUS.SUBMITTED, 'CUSTOMER'), '§5.1 顾客不可接单');
    t.check(state.canAct('order.confirmDelivery', STATUS.DELIVERED, 'CUSTOMER'), '§5.1 顾客可确认送达');
    t.check(!state.canAct('order.confirmDelivery', STATUS.DELIVERED, 'PARTNER'), '§5.1 兼职不可代确认送达');
    t.check(state.canAct('order.markPicked', STATUS.ACCEPTED, 'PARTNER'), '§5.1 已接单可标记取件');
    t.check(!state.canAct('order.markPicked', STATUS.SUBMITTED, 'PARTNER'), '§5.1 待接单不可先取件');
    t.check(state.canAct('order.undo', STATUS.PICKED, 'PARTNER'), '§5.1 已取件可 undo');
    t.check(!state.canAct('order.undo', STATUS.ACCEPTED, 'PARTNER'), '§5.1 已接单不在 undo 白名单');
    t.check(!state.canAct('order.undo', STATUS.PICKED, 'CUSTOMER'), '§5.1 顾客不可 undo');
    t.check(!state.canAct('order.noSuchAction', STATUS.SUBMITTED, 'PARTNER'), '§5.1 未登记动作一律不可行');

    t.check(state.canCustomerCancel({ status: STATUS.SUBMITTED }), '§5.1 待接单可取消');
    t.check(state.canCustomerCancel({ status: STATUS.ACCEPTED }), '§5.1 已接单可取消');
    t.check(!state.canCustomerCancel({ status: STATUS.PICKED }), '§5.1 已取件不可单方取消');
    t.check(!state.canCustomerCancel({ status: STATUS.DELIVERED }), '§5.1 已送达不可单方取消');
    t.check(!state.canCustomerCancel(null), '§5.1 无订单不可取消');
    t.check(state.canCustomerCancel({ status: STATUS.EXCEPTION, exception: { fromStatus: STATUS.SUBMITTED } }),
      '§5.1 异常（来自待接单）可取消');
    t.check(state.canCustomerCancel({ status: STATUS.EXCEPTION, exception: { fromStatus: STATUS.ACCEPTED } }),
      '§5.1 异常（来自已接单）可取消');
    t.check(!state.canCustomerCancel({ status: STATUS.EXCEPTION, exception: { fromStatus: STATUS.PICKED } }),
      '§5.1 异常（来自已取件）不可取消');
    t.check(!state.canCustomerCancel({ status: STATUS.EXCEPTION }), '§5.1 异常缺 fromStatus 不可取消');
    t.check(state.canAct('order.cancel', STATUS.EXCEPTION, 'CUSTOMER',
      { status: STATUS.EXCEPTION, exception: { fromStatus: STATUS.ACCEPTED } }), '§5.1 顾客取消经 canAct 同口径');
    t.check(!state.canAct('order.cancel', STATUS.PICKED, 'CUSTOMER', { status: STATUS.PICKED }),
      '§5.1 顾客取消已取件被挡');
    t.check(state.canAct('order.cancel', STATUS.SUBMITTED, 'SYSTEM'), '§5.1 系统可取消超时待接单');
    t.check(!state.canAct('order.cancel', STATUS.ACCEPTED, 'SYSTEM'), '§5.1 系统不取消进行中其他状态');
    t.check(state.canAct('order.cancel', STATUS.PICKED, 'PARTNER'), '§5.1 兼职可取消进行中');

    t.eq(state.nextStatus('order.accept', STATUS.SUBMITTED), STATUS.ACCEPTED, '§5.1 接单目标已接单');
    t.eq(state.nextStatus('order.unmarkPicked', STATUS.PICKED), STATUS.ACCEPTED, '§5.1 反标记取件回已接单');
    t.eq(state.nextStatus('order.unmarkDelivered', STATUS.DELIVERED), STATUS.PICKED, '§5.1 反标记送达回已取件');
    t.eq(state.nextStatus('order.undo', STATUS.PICKED), STATUS.ACCEPTED, '§5.1 undo 取件回已接单');
    t.eq(state.nextStatus('order.undo', STATUS.ACCEPTED), '', '§5.1 无 undo 目标返回空串');
    t.eq(state.nextStatus('order.resolveException', STATUS.EXCEPTION, { exception: { fromStatus: STATUS.PICKED } }),
      STATUS.PICKED, '§5.1 异常恢复回上报时状态');
    t.eq(state.nextStatus('order.resolveException', STATUS.EXCEPTION, null), STATUS.ACCEPTED,
      '§5.1 异常恢复缺快照回落已接单');
    t.eq(state.nextStatus('order.cancel', STATUS.ACCEPTED), STATUS.CANCELLED, '§5.1 取消目标已取消');
    t.eq(state.nextStatus('order.correct', STATUS.PICKED), STATUS.PICKED, '§5.1 更正不改状态');
    t.eq(state.nextStatus('order.noSuchAction', STATUS.PICKED), '', '§5.1 未登记动作无目标状态');
    t.eq(state.resolveExceptionTo({ fromStatus: STATUS.DELIVERED }), STATUS.DELIVERED,
      '§5.1 异常恢复白名单回原状态');
    t.eq(state.resolveExceptionTo({ fromStatus: STATUS.SUBMITTED }), STATUS.ACCEPTED,
      '§5.1 异常恢复非白名单回落已接单');
    t.eq(state.resolveExceptionTo(null), STATUS.ACCEPTED, '§5.1 无异常快照回落已接单');

    t.check(state.isOrderStatus('EXCEPTION') && !state.isOrderStatus('Exception'), '§5 状态判定大小写敏感');
    t.check(state.isTerminal('COMPLETED') && state.isTerminal('CANCELLED')
      && !state.isTerminal('PICKED'), '§5 终态判定');
    t.check(state.isActiveStatus('EXCEPTION') && !state.isActiveStatus('COMPLETED'), '§5 进行中判定');
    t.eq(state.statusText('PICKED'), '已取件·配送中', '§5 状态文案同源');
    t.eq(state.statusText('BOGUS'), '', '§5 未知状态文案为空');
    t.eq(state.progressIndex('SUBMITTED'), 0, '§5 进度起点');
    t.eq(state.progressIndex('COMPLETED'), 4, '§5 进度终点');
    t.eq(state.progressIndex('CANCELLED'), -1, '§5 取消不占进度');
    t.eq(state.progressIndex('EXCEPTION'), -1, '§5 异常不占进度');
    t.eq(state.actionRule('order.accept'), rules['order.accept'], '§5.1 动作查询返回同一规则对象');
    t.eq(state.actionRule('order.noSuchAction'), null, '§5.1 未登记动作查询返回 null');
  });
}

// ---------------------------------------------------------------- §5.2 枚举文案
function sectionEnumsCopy(h) {
  h.section('§5.2 状态中文与取消原因枚举', (t) => {
    t.eq(enums.ORDER_STATUS_TEXT, {
      SUBMITTED: '待接单',
      ACCEPTED: '已接单',
      PICKED: '已取件·配送中',
      DELIVERED: '已送达·待确认',
      COMPLETED: '已完成',
      CANCELLED: '已取消',
      EXCEPTION: '异常·待处理'
    }, '§5.2 七状态中文与 CONTRACT 一致');
    t.eq(enums.CANCEL_REASONS.CUSTOMER.length, 5, '§5.2 顾客取消原因 5 项');
    t.eq(enums.CANCEL_REASONS.PARTNER.length, 4, '§5.2 兼职取消原因 4 项');
    t.eq(enums.CANCEL_REASONS.SYSTEM.length, 1, '§5.2 系统取消原因 1 项');
    const allReasons = [].concat(enums.CANCEL_REASONS.CUSTOMER, enums.CANCEL_REASONS.PARTNER,
      enums.CANCEL_REASONS.SYSTEM);
    t.notEmpty(allReasons, '§5.2 取消原因样本');
    t.check(allReasons.every((item) => /^[A-Z_]+$/.test(item.code) && item.text.length > 0),
      '§5.2 取消原因 code/text 都非空且格式合法');
    t.check(enums.CANCEL_REASONS.CUSTOMER.some((i) => i.code === enums.OTHER_REASON_CODE)
      && enums.CANCEL_REASONS.PARTNER.some((i) => i.code === enums.OTHER_REASON_CODE),
    '§5.2 顾客/兼职都有 OTHER（必填备注）');
    t.eq(enums.CANCEL_REASON_TEXT.CHANGED_MIND, '不需要了', '§5.2 取消原因文案单源');
    t.eq(enums.RELEASE_REASONS.length, 5, '§5.2 解绑原因 5 项');
    t.check(enums.RELEASE_REASONS.every((i) => !!i.code && !!i.text), '§5.2 解绑原因 code/text 非空');
    t.eq(enums.EXCEPTION_CODES.length, 6, '§5.2 异常原因 6 项');
    t.check(enums.EXCEPTION_CODES.some((i) => i.code === enums.EXCEPTION_OTHER_CODE), '§5.2 异常含 OTHER');
    t.eq(Object.keys(enums.CODE_STATUS).sort(), ['NEED_CODE', 'OK'], '§5.2 codeStatus 两值');
    t.eq(enums.CODE_STATUS_TEXT.NEED_CODE, '需补充取件码', '§5.2 codeStatus 文案');
    t.eq(Object.keys(enums.APPOINT_TYPE).sort(), ['ASAP', 'SLOT'], '§5.2 预约类型两值');
    t.eq(enums.PARTNER_STATUS_LABELS.CLOSED, '已注销', '§1 兼职状态文案');
    t.eq(enums.VIEW_MODE_TEXT.READONLY, '开发者只读视角', '§1.3 只读视角文案');
    t.eq(enums.ROLE_LABELS.CUSTOMER, '顾客', '§1 角色文案');
  });
}

// ---------------------------------------------------------------- §6 服务类型 / §4.2 公开配置
function sectionServices(h) {
  h.section('§6 服务类型与 §4.2 公开配置（只表达做什么）', (t) => {
    t.eq(enums.SERVICES.length, 5, '§6 服务类型 5 类');
    t.eq(enums.SERVICE_CODES.slice(),
      ['PICKUP_STD', 'PICKUP_DOOR', 'PICKUP_URGENT', 'DROP_OFF', 'CUSTOM'], '§6 服务码与 CONTRACT 一致');
    t.check(enums.SERVICES.every((s) => Object.keys(s).sort().join(',') === 'code,desc,name'),
      '§6 服务项只有 code/name/desc 三键');
    t.check(enums.SERVICES.every((s) => !!s.name && !!s.desc), '§6 服务项名称与说明非空');
    t.eq(defaults.DEFAULT_CONFIG.serviceCatalog,
      enums.SERVICES.map((s) => ({ code: s.code, name: s.name, desc: s.desc })), '§6 出厂配置服务目录同源');
    t.check(defaults.PUBLIC_CONFIG_KEYS.indexOf('serviceCatalog') !== -1, '§6 公开配置下发服务目录');
    t.check(['aiFallback', 'subscribeTemplates', 'recognitionFailureRetentionDays',
      'testAccountMaxPerRole', 'testDataRetentionDays']
      .every((key) => defaults.PUBLIC_CONFIG_KEYS.indexOf(key) === -1),
    '§4.2 公开配置不含 AI/模板/治理参数');
    t.check(defaults.PUBLIC_CONFIG_KEYS.indexOf('viewTicketTtlMinutes') !== -1,
      '§2.10 公开配置含票据 TTL（切换会话页展示 30 分钟）');
    const publicConfig = defaults.pickPublicConfig(defaults.DEFAULT_CONFIG);
    t.eq(Object.keys(publicConfig).sort(),
      defaults.PUBLIC_CONFIG_KEYS.concat('subscribeEnabled').sort(), '§4.2 公开配置只含白名单键');
    t.check(publicConfig.serviceCatalog.length === 5 && typeof publicConfig.subscribeEnabled === 'boolean',
      '§4.2 公开配置裁剪后字段可用');
    t.eq(defaults.UPLOAD_LIMITS.avatarMaxBytes, defaults.DEFAULT_CONFIG.avatarMaxBytes, '§11 头像上限同源');
    t.eq(defaults.DEFAULT_CONFIG.avatarMaxBytes, 200 * 1024, '§11 头像上限 200KB');
  });
}

// ---------------------------------------------------------------- §8 订单视图
function sectionOrderView(h) {
  h.section('§8 订单视图（四档动线 / 状态桶 / counts 六项）', (t) => {
    t.eq(orderView.COUNTS_KEYS.slice(),
      ['submitted', 'accepted', 'picked', 'delivered', 'exception', 'todayCompleted'],
      '§8 工作台 counts 六项键名');
    const counts = orderView.countsTemplate();
    t.check(orderView.COUNTS_KEYS.every((key) => counts[key] === 0)
      && Object.keys(counts).length === orderView.COUNTS_KEYS.length, '§8 counts 模板六项全零');
    const bucketStatuses = [];
    Object.keys(orderView.STATUS_BUCKETS).forEach((bucket) => {
      orderView.STATUS_BUCKETS[bucket].forEach((status) => bucketStatuses.push(status));
    });
    t.eq(bucketStatuses.slice().sort(), state.STATUS_LIST.slice().sort(), '§8 状态桶覆盖七状态且不重不漏');
    t.eq(orderView.bucketOf(STATUS.SUBMITTED), 'submitted', '§8 待接单进 submitted 桶');
    t.eq(orderView.bucketOf(STATUS.EXCEPTION), 'exception', '§8 异常进 exception 桶');
    t.eq(orderView.bucketOf(STATUS.COMPLETED), 'history', '§8 已完成进 history 桶');
    t.eq(orderView.bucketOf(STATUS.CANCELLED), 'history', '§8 已取消进 history 桶');
    t.eq(orderView.bucketOf('BOGUS'), '', '§8 未知状态无桶');
    t.eq(orderView.PICKUP_TIERS.map((item) => item.tier), [1, 2, 3, 4], '§8 四档顺序固定');
    t.eq(orderView.PICKUP_TIERS.map((item) => item.text), ['需查明', '快递柜', '分段码', '其他'],
      '§8 四档中文与 CONTRACT 一致');

    t.eq(orderView.pickupTier({ parcel: { codeStatus: 'NEED_CODE' } }), 1, '§8 需查明为第 1 档');
    t.eq(orderView.pickupTier({ parcel: { lockerNo: 'A12', pickupCode: '1234' } }), 2, '§8 有柜号为第 2 档');
    t.eq(orderView.pickupTier({ parcel: { pickupCode: '12-34' } }), 3, '§8 码含非数字为第 3 档');
    t.eq(orderView.pickupTier({ parcel: { pickupCode: '2468' } }), 4, '§8 纯数字码为第 4 档');
    t.eq(orderView.pickupTier({}), 4, '§8 空订单落第 4 档兜底');
    t.eq([1, 2, 3, 4].map(orderView.pickupTierText), ['需查明', '快递柜', '分段码', '其他'],
      '§8 档位文案查询');
    t.eq(orderView.pickupTierText(9), '', '§8 未知档位文案为空');
    t.eq(orderView.statusText(STATUS.PICKED), '已取件·配送中', '§8 视图状态文案同源');

    const o1 = { orderNo: 'N1', parcel: { codeStatus: 'NEED_CODE' } };
    const o2 = { orderNo: 'N2', parcel: { lockerNo: 'A12', pickupCode: '1234' } };
    const o3 = { orderNo: 'N3', parcel: { pickupCode: '12-34' } };
    const o4 = { orderNo: 'N4', parcel: { pickupCode: '2468' } };
    const o5 = { orderNo: 'N5', parcel: { pickupCode: '1234' } };
    const input = [o4, o2, o5, o1, o3];
    const sorted = orderView.sortByPickupRoute(input);
    t.notEmpty(sorted, '§8 排序样本非空');
    t.eq(sorted.map((item) => item.orderNo), ['N1', 'N2', 'N3', 'N5', 'N4'],
      '§8 四档排序：档位优先、同档按码中数字升序');
    t.eq(input.map((item) => item.orderNo), ['N4', 'N2', 'N5', 'N1', 'N3'], '§8 排序不修改入参顺序');
    t.eq(orderView.sortByPickupRoute(null), [], '§8 非数组入参返回空数组');
    t.eq(orderView.comparePickupRoute(o4, o4), 0, '§8 同一订单比较为 0');
    t.eq(orderView.sortByStatusUpdatedDesc([
      { orderNo: 'a', statusUpdatedAt: 100 },
      { orderNo: 'b', statusUpdatedAt: 300 },
      { orderNo: 'c', statusUpdatedAt: 200 }
    ]).map((item) => item.orderNo), ['b', 'c', 'a'], '§8 进行中按状态更新时间倒序');
    t.eq(orderView.sortByFinishedDesc([
      { orderNo: 'a', completedAt: 100, cancelledAt: 0 },
      { orderNo: 'b', completedAt: 0, cancelledAt: 300 },
      { orderNo: 'c', completedAt: 200, cancelledAt: 0 }
    ]).map((item) => item.orderNo), ['b', 'c', 'a'], '§8 已结束按完成/取消时间倒序');
    t.eq(orderView.sortByFinishedDesc(undefined), [], '§8 非数组已结束排序返回空数组');
  });
}

// ---------------------------------------------------------------- §8 展示格式化
function sectionFormat(h) {
  h.section('§8 展示格式化（锚+键 / 相对时间 / 尾号）', (t) => {
    t.eq(format.ANCHOR_SEPARATOR, ' · ', '§8 锚+键分隔符固定');
    t.eq(format.anchorLine(['D4-522A', '尾号6678', '小王']), 'D4-522A · 尾号6678 · 小王',
      '§8 锚+键三段拼装');
    t.eq(format.anchorLine(['D4-522A', '', '  ', '小王']), 'D4-522A · 小王', '§8 锚+键跳过空段');
    t.eq(format.anchorLine(['D4-522A', null, undefined, 5]), 'D4-522A', '§8 锚+键忽略非字符串段');
    t.eq(format.anchorLine(null), '', '§8 非数组锚+键返回空串');
    t.eq(format.tailLabel('6678'), '尾号6678', '§8 尾号 4 位展示');
    t.eq(format.tailLabel('678'), '', '§8 尾号非 4 位不展示');
    t.eq(format.tailLabel(''), '', '§8 空尾号不展示');
    t.eq(format.pad2(7), '07', '§8 两位补零');
    t.eq(format.truncate('一二三四五', 3), '一二…', '§8 超长文本截断带省略号');
    t.eq(format.truncate('一二三', 3), '一二三', '§8 不超长原样返回');
    t.eq(format.truncate(null, 3), '', '§8 非字符串截断返回空串');

    const day = new Date(2026, 0, 5, 9, 7, 0).getTime();
    t.eq(format.formatDate(day), '2026-01-05', '§8 日期格式 YYYY-MM-DD');
    t.eq(format.formatTime(day), '09:07', '§8 时间格式 HH:mm');
    t.eq(format.formatDateTime(day), '2026-01-05 09:07', '§8 日期时间拼接');
    t.eq(format.formatDate(0), '', '§8 非法时间返回空串');
    const now = new Date(2026, 0, 5, 12, 0, 0).getTime();
    t.eq(format.formatRelative(day, now), '今天 09:07', '§8 当天相对时间');
    t.eq(format.formatRelative(new Date(2026, 0, 4, 23, 5, 0).getTime(), now), '昨天 23:05',
      '§8 昨天相对时间');
    t.eq(format.formatRelative(new Date(2025, 11, 20, 9, 0, 0).getTime(), now), '12-20 09:00',
      '§8 一年内相对时间带月日');
    t.eq(format.formatRelative(new Date(2025, 0, 1, 8, 0, 0).getTime(), now), '2025-01-01 08:00',
      '§8 超过一年显示完整日期');
    t.eq(format.formatRelative(day, 0), '2026-01-05 09:07', '§8 缺 serverNow 回落完整时间');
  });
}

// ---------------------------------------------------------------- §3 字段校验
function sectionValidate(h) {
  h.section('§3 字段校验（文本上限 / 编号形态 / 宿舍身份）', (t) => {
    t.eq(validate.TEXT_LIMITS, {
      note: 200, deliveryNote: 100, partnerNote: 100, msg: 200, exception: 200,
      lockerNo: 10, displayName: 20, releaseNote: 100, failureNote: 100
    }, '§3 文本上限与 CONTRACT 一致');
    t.check(validate.validateText('a'.repeat(200), 200, 'note', true).ok, '§3 恰好达上限通过');
    t.eq(validate.validateText('a'.repeat(201), 200, 'note', true).reason, 'TOO_LONG', '§3 超上限拒绝');
    t.eq(validate.validateText('  x  ', 200, 'note', false).value, 'x', '§3 文本去首尾空白');
    t.eq(validate.validateText('', 200, 'note', true).reason, 'REQUIRED', '§3 必填文本不接受空串');
    t.eq(validate.textLength('😀'), 1, '§3 文本长度按码点计（emoji 算 1）');
    t.eq(validate.validateDisplayName('一'.repeat(21)).truncated, true, '§3 昵称超 20 字截断');
    t.eq(validate.validateDisplayName('一'.repeat(21)).value.length, 20, '§3 昵称截断到 20 字');
    t.eq(validate.validateDisplayName('   ').reason, 'REQUIRED', '§3 昵称必填');
    t.eq(validate.validateDisplayName(5).reason, 'TYPE', '§3 昵称类型校验');

    t.check(validate.validatePickupCode('1234').ok, '§3 取件码 4 位合法');
    t.check(validate.validatePickupCode('12').ok === false, '§3 取件码过短拒绝');
    t.check(validate.validatePickupCode('1234567890123').ok === false, '§3 取件码超 12 位拒绝');
    t.check(validate.validatePickupCode('123 456').ok, '§3 取件码允许分隔空白');
    t.eq(validate.validatePickupCode('x'.repeat(41)).reason, 'TOO_LONG', '§3 取件码原始输入超 40 拒绝');
    t.eq(validate.validatePickupCode('').value, '', '§3 取件码允许为空（待补）');
    t.check(validate.validateTrackingTail('12345').ok, '§3 运单尾号 5 位合法');
    t.check(validate.validateTrackingTail('1234').ok === false, '§3 运单尾号 4 位拒绝');
    t.check(validate.validatePhoneTail('1234').ok, '§3 手机尾号 4 位合法');
    t.check(validate.validatePhoneTail('12345').ok === false, '§3 手机尾号 5 位拒绝');

    t.check(validate.validateCustomerNo('c-abcd-2345').ok, '§3 顾客编号小写/连字符可归一');
    t.eq(validate.validateCustomerNo('c-abcd-2345').canonical, 'CABCD2345', '§3 顾客编号归一大写去连字符');
    t.eq(validate.validateCustomerNo('P-ABC-234').field, 'customerNo', '§3 顾客编号错前缀按字段拒绝');
    t.check(validate.validatePartnerNo('p abc 234').ok, '§3 兼职编号空格可归一');
    t.check(validate.validateDeveloperNo('DEV-01').ok, '§3 开发者编号合法');
    t.check(validate.validateDeveloperNo('DEV-1').ok === false, '§3 开发者编号必须两位');
    t.eq(validate.canonicalCode('Ｃ－７Ｋ２Ｍ－９ＱＸ４'), 'C7K2M9QX4', '§3 全角编号归一为半角大写');
    t.check(validate.validateClientRequestId('a'.repeat(16)).ok, '§3 幂等键 16 位合法');
    t.check(validate.validateClientRequestId('a'.repeat(15)).ok === false, '§3 幂等键短于 16 拒绝');
    t.check(validate.validateClientRequestId('a'.repeat(16) + '$').ok === false, '§3 幂等键非法字符拒绝');

    t.check(validate.validateCancelReason('OTHER', 'CUSTOMER').ok, '§3 顾客可选 OTHER 取消原因');
    t.eq(validate.validateCancelReason('TIMEOUT_UNACCEPTED', 'CUSTOMER').reason, 'NOT_ALLOWED',
      '§3 顾客不可选系统取消原因');
    t.eq(validate.validateCancelNote('OTHER', '').reason, 'REQUIRED', '§3 OTHER 取消必须填备注');
    t.check(validate.validateCancelNote('CHANGED_MIND', '').ok, '§3 非 OTHER 备注可空');
    t.eq(validate.validateException('OTHER', '').reason, 'REQUIRED', '§3 异常 OTHER 必须填说明');
    t.eq(validate.validateException('NO_SUCH_CODE', 'x').reason, 'NOT_ALLOWED', '§3 异常原因必须在六值内');
    t.check(validate.validateException('CODE_INVALID', '码被撕').ok, '§3 合法异常原因通过');

    t.eq(validate.validateDormIdentity({ zone: 'd', buildingNo: '4', room: '0522' }).dormKey, 'D4-522',
      '§3 宿舍身份归一出 dormKey');
    t.eq(validate.validateDormIdentity({ zone: 'D', buildingNo: 4, room: '99' }).reason, 'RANGE',
      '§3 宿舍号小于 100 拒绝');
    t.eq(validate.validateDormIdentity({ zone: 'Z', buildingNo: 4, room: '522' }).field, 'zone',
      '§3 非五苑拒绝');
    t.eq(validate.validateDormIdentity({ zone: 'D', buildingNo: 11, room: '522' }).reason, 'RANGE',
      '§3 栋号超 10 拒绝');
    t.check(validate.validateConfirmText('删除', '删除').ok, '§3 二次确认文案匹配通过');
    t.eq(validate.validateConfirmText('删除吗', '删除').reason, 'NOT_ALLOWED', '§3 二次确认文案不匹配拒绝');
  });
}

// ---------------------------------------------------------------- §3.1 编号
function sectionIds(h) {
  h.section('§3.1 唯一编号（归一 / 解析 / 展示往返 / 零生成）', (t) => {
    t.eq(ids.normalizeInput(' Ｃ－７Ｋ２Ｍ－９ＱＸ４ '), 'C7K2M9QX4', '§3.1 编号输入归一');
    t.check(ids.isCustomerNo('Ｃ－７Ｋ２Ｍ－９ＱＸ４'), '§3.1 全角顾客编号可识别');
    const parsedCustomer = ids.parseNo('C-ABCD-2345');
    t.check(parsedCustomer.ok, '§3.1 合法顾客编号可解析');
    t.eq(parsedCustomer.kind, ids.NO_KIND.CUSTOMER, '§3.1 顾客编号种类');
    t.eq(parsedCustomer.canonical, 'CABCD2345', '§3.1 顾客编号 canonical');
    t.eq(parsedCustomer.display, 'C-ABCD-2345', '§3.1 顾客编号展示分组 4-4');
    t.eq(ids.displayNo(ids.NO_KIND.CUSTOMER, 'CABCD2345'), 'C-ABCD-2345', '§3.1 展示幂等');
    t.eq(ids.displayNo(ids.NO_KIND.CUSTOMER, 'C123'), 'C123', '§3.1 长度不足展示回落 canonical');
    const parsedPartner = ids.parseNo('P-ABC-234');
    t.check(parsedPartner.ok, '§3.1 合法兼职编号可解析');
    t.eq(ids.displayNo(parsedPartner.kind, parsedPartner.display), parsedPartner.display,
      '§3.1 display→parse→display 往返等值');
    t.eq(ids.displayInvitationCode('23456789ABCD'), '2345-6789-ABCD', '§3.1 邀请码按 4-4-4 展示');
    t.check(ids.isPartnerNo('P-ABC-234') && !ids.isCustomerNo('P-ABC-234'), '§3.1 错前缀不当顾客编号');
    t.check(ids.isDeveloperNo('DEV-01'), '§3.1 开发者编号可识别');
    t.eq(ids.parseNo('DEV-1').reason, 'DEVELOPER_PREFIX', '§3.1 开发者编号格式错误提示前缀');
    t.eq(ids.detectKind('dev-01'), ids.NO_KIND.DEVELOPER, '§3.1 前缀判定容忍小写与连字符');
    t.eq(ids.prefixHint('C-ABCD-2345').reason, 'CUSTOMER_PREFIX', '§3.1 错前缀提示原因码');
    t.check(ids.prefixHint('C-ABCD-2345').message.length > 0, '§3.1 错前缀提示文案非空');
    t.check(ids.parseNo('C-ABCD-234').ok === false, '§3.1 长度不足的顾客编号不可解析');
    t.check(ids.parseNo('').ok === false, '§3.1 空串不可解析');
    const idsSource = fs.readFileSync(path.join(ROOT, 'utils/ids.js'), 'utf8');
    t.check(!/Math\s*\.\s*random/.test(idsSource), '§3.1 客户端编号零件零 random 调用（生成只在云端）');
    t.check(Object.keys(ids).every((name) => !/generat/i.test(name)), '§3.1 客户端编号零件不导出生成函数');
  });
}

// ---------------------------------------------------------------- §3 roomTag
function sectionRoomTag(h) {
  h.section('§3 roomTag（大写 / Excel 序 / 排序）', (t) => {
    const cases = [[1, 'A'], [26, 'Z'], [27, 'AA'], [52, 'AZ'], [53, 'BA'], [702, 'ZZ'], [703, 'AAA']];
    cases.forEach((pair) => {
      t.eq(roomTag.toTag(pair[0]), pair[1], '§3 roomTag 序号→标签 ' + pair[0] + '→' + pair[1]);
    });
    t.check(cases.every((pair) => roomTag.tagRank(roomTag.toTag(pair[0])) === pair[0]),
      '§3 roomTag 序号↔标签互逆');
    t.check([0, -1, 1.5, 1e9 + 0.5, '1'].every((seq) => roomTag.toTag(seq) === ''),
      '§3 roomTag 非法序号返回空串');
    t.check(['a', '', 'A1', '1'].every((tag) => roomTag.tagRank(tag) === 0),
      '§3 roomTag 非法标签回推 0');
    t.check(roomTag.isValidTag('AA') && roomTag.isValidTag('A'), '§3 roomTag 大写字母合法');
    t.check(!roomTag.isValidTag('aa') && !roomTag.isValidTag(''), '§3 roomTag 小写/空串非法');
    t.check(!roomTag.isValidTag('A1'), '§3 roomTag 含数字非法');
    t.eq(roomTag.formatDormTag('D4-522', 'AA'), 'D4-522AA', '§3 宿舍+标签展示拼装');
    t.eq(roomTag.formatDormTag('D4-522', 'a'), 'D4-522', '§3 非法标签不拼展示');
    t.eq(roomTag.formatDormTag('', 'A'), '', '§3 空 dormKey 展示为空');
    const unsorted = ['AA', 'Z', 'A', 'AB'];
    t.eq(unsorted.slice().sort(roomTag.compareByDormTag), ['A', 'Z', 'AA', 'AB'],
      '§3 同宿舍按 Excel 序（A 在 AA 前，禁字符串排序）');
    t.check(roomTag.compareByDormTag({ dormKey: 'D4-522', tag: 'A' },
      { dormKey: 'D5-101', tag: 'A' }) < 0, '§3 不同宿舍先比 dormKey');
    t.check(roomTag.compareByDormTag('D4-522', 'D4-522A') < 0, '§3 无标签排在已分配标签前');
    t.check(roomTag.compareByDormTag({ dormKey: 'D4-522', tag: 'A' },
      { dormKey: 'D4-522', tag: 'A' }) === 0, '§3 同宿舍同标签比较为 0');
    t.check(enums.ROOM_TAG_PATTERN.test('AAA') && !enums.ROOM_TAG_PATTERN.test('aa'),
      '§3 roomTag 落库正则只认大写');
  });
}

// ---------------------------------------------------------------- §7 启动分流
function sectionLaunchRoute(h) {
  h.section('§7 启动分流（viewContext / 开发者 / 无角色 / 资料未完）', (t) => {
    t.eq(route.CUSTOMER_HOME, '/pages/customer/home/index', '§7 顾客首页路径');
    t.eq(route.PARTNER_WORKBENCH, '/pages/partner/workbench/index', '§7 兼职工作台路径');
    t.eq(route.ADMIN_OVERVIEW, '/pkg-admin/pages/overview/index', '§7 开发者后台路径');
    t.eq(route.ROLE_PAGE, '/pages/role/index', '§7 选角色页路径');
    t.eq(route.PROFILE_PAGE, '/pages/profile/index', '§7 资料页路径');

    const asCustomer = route.decideLaunchRoute({ viewContext: { viewMode: 'READONLY', role: 'CUSTOMER' } });
    t.eq(asCustomer.url, route.CUSTOMER_HOME, '§1.2 只读视角（顾客）进顾客首页');
    t.eq(asCustomer.reason, 'VIEW_CONTEXT', '§1.2 只读视角分流原因');
    t.eq(route.decideLaunchRoute({ viewContext: { viewMode: 'TEST_WRITE', role: 'PARTNER' } }).url,
      route.PARTNER_WORKBENCH, '§1.3 切换会话（兼职）进兼职工作台');
    t.eq(route.decideLaunchRoute({
      viewContext: { viewMode: 'READONLY', role: 'CUSTOMER' }, isDeveloper: true, hasRole: false
    }).reason, 'VIEW_CONTEXT', '§1.2 切换会话优先于开发者/无角色分流');
    t.eq(route.decideLaunchRoute({ isDeveloper: true }).reason, 'DEVELOPER', '§1.1 开发者进后台');
    t.eq(route.decideLaunchRoute({ isDeveloper: true }).url, route.ADMIN_OVERVIEW, '§1.1 开发者后台路径');
    t.eq(route.decideLaunchRoute({ hasRole: false }).reason, 'NO_ROLE', '§7 无角色进选角色页');
    t.eq(route.decideLaunchRoute({ hasRole: false }).url, route.ROLE_PAGE, '§7 无角色路径');
    t.eq(route.decideLaunchRoute({}).reason, 'NO_ROLE', '§7 空快照按无角色处理');

    const partnerProfile = route.decideLaunchRoute({
      hasRole: true, activeRole: 'PARTNER', partner: { profileComplete: false }
    });
    t.eq(partnerProfile.url, route.PROFILE_PAGE, '§7 兼职资料未完进资料页');
    t.eq(partnerProfile.reason, 'PARTNER_PROFILE', '§7 兼职资料未完分流原因');
    t.eq(route.decideLaunchRoute({
      hasRole: true, activeRole: 'PARTNER', partner: { profileComplete: true, status: 'SUSPENDED' }
    }).reason, 'PARTNER_INACTIVE', '§7 兼职停用进资料页');
    t.eq(route.decideLaunchRoute({
      hasRole: true, activeRole: 'PARTNER', partner: { profileComplete: true, status: 'CLOSED' }
    }).reason, 'PARTNER_INACTIVE', '§7 兼职注销进资料页');
    const partnerReady = route.decideLaunchRoute({
      hasRole: true, activeRole: 'PARTNER', partner: { profileComplete: true, status: 'ACTIVE' }
    });
    t.eq(partnerReady.url, route.PARTNER_WORKBENCH, '§7 兼职就绪进工作台');
    t.eq(partnerReady.reason, 'PARTNER_ACTIVE', '§7 兼职就绪分流原因');
    const customerProfile = route.decideLaunchRoute({
      hasRole: true, activeRole: 'CUSTOMER', customer: { profileComplete: false }
    });
    t.eq(customerProfile.url, route.PROFILE_PAGE, '§7 顾客资料未完进资料页');
    t.eq(customerProfile.reason, 'CUSTOMER_PROFILE', '§7 顾客资料未完分流原因');
    const customerReady = route.decideLaunchRoute({
      hasRole: true, activeRole: 'CUSTOMER', customer: { profileComplete: true }
    });
    t.eq(customerReady.url, route.CUSTOMER_HOME, '§7 顾客就绪进首页');
    t.eq(customerReady.reason, 'CUSTOMER_READY', '§7 顾客就绪分流原因');

    t.check(route.isRolePageAllowed('/pages/customer/home/index',
      { viewContext: { viewMode: 'READONLY', role: 'CUSTOMER' } }), '§7 只读视角可进对应角色页');
    t.check(!route.isRolePageAllowed('/pages/partner/workbench/index',
      { viewContext: { viewMode: 'READONLY', role: 'CUSTOMER' } }), '§7 只读视角不可跨角色页');
    t.check(!route.isRolePageAllowed('/pages/customer/home/index', {}), '§7 无角色不可进角色页');
    t.check(route.isRolePageAllowed('/pages/partner/workbench/index', { activeRole: 'PARTNER' }),
      '§7 兼职可进兼职页');
    t.check(!route.isRolePageAllowed('/pages/customer/home/index', { activeRole: 'PARTNER' }),
      '§7 兼职不可进顾客页');
    t.check(route.isRolePageAllowed('/pages/customer/home/index', { activeRole: 'CUSTOMER' }),
      '§7 顾客可进顾客页');
    t.check(!route.isRolePageAllowed('/pages/partner/workbench/index', { activeRole: 'CUSTOMER' }),
      '§7 顾客不可进兼职页');
  });
}

// ---------------------------------------------------------------- 页面零件
function buildWaitingConfig() {
  return { orderTimeoutMinutes: 120, autoCompleteHours: 24 };
}

function sectionStatusViewPart(h) {
  h.section('§7 页面零件 status-view（动作可达性 / 进度 / 文案）', (t) => {
    t.eq(statusView.statusText(STATUS.PICKED), '已取件·配送中', '§7 零件状态文案同源');
    t.eq(statusView.eventText({ note: '已放门口' }), '已放门口', '§7 事件有备注优先展示备注');
    t.eq(statusView.eventText({ toStatus: STATUS.ACCEPTED }), '订单状态：已接单', '§7 事件按目标状态展示');
    t.eq(statusView.eventText(null), '', '§7 空事件不展示');
    t.check(statusView.canCancel({ status: STATUS.SUBMITTED }), '§7 待接单可取消');
    t.check(!statusView.canCancel({ status: STATUS.PICKED }), '§7 已取件不可取消');
    t.check(statusView.canCancel({ status: STATUS.EXCEPTION, exception: { fromStatus: STATUS.ACCEPTED } }),
      '§7 异常单按上报来源判定可取消');
    t.check(statusView.canConfirmDelivery({ status: STATUS.DELIVERED }), '§7 已送达可确认');
    t.check(!statusView.canConfirmDelivery({ status: STATUS.PICKED }), '§7 未送达不可确认');
    t.check(statusView.canDeleteRecord({ status: STATUS.COMPLETED }), '§7 已完成可删记录');
    t.check(!statusView.canDeleteRecord({ status: STATUS.COMPLETED, deletedByCustomerAt: 1 }),
      '§7 已删记录不可重复删');
    t.check(statusView.canMessage({ status: STATUS.PICKED }), '§7 进行中可留言');
    t.check(!statusView.canMessage({ status: STATUS.CANCELLED }), '§7 已取消不可留言');
    t.check(statusView.canMessage({ status: STATUS.COMPLETED }), '§7 已完成可回看留言');
    t.check(statusView.canViewImage({ image: { fileId: 'cloud://x' } }), '§7 有图可看');
    t.check(!statusView.canViewImage({ image: {} }), '§7 无 fileId 不可看');
    const reasons = statusView.cancelReasons();
    t.eq(reasons.length, 5, '§7 顾客取消原因 5 项');
    t.eq(reasons[0], { code: 'CHANGED_MIND', label: '不需要了' }, '§7 取消原因首项文案');
    const steps = statusView.progressSteps({ status: STATUS.PICKED });
    t.eq(steps.map((step) => step.label), ['下单', '已接单', '已取件', '已送达', '已完成'], '§7 进度条标签固定');
    t.eq(steps.map((step) => step.state), ['done', 'done', 'current', 'future', 'future'], '§7 进度条状态');
    const cancelledSteps = statusView.progressSteps({ status: STATUS.CANCELLED });
    t.check(cancelledSteps[0].state === 'done' && cancelledSteps.every((s) => s.state !== 'current'),
      '§7 取消单无当前步');
    const config = buildWaitingConfig();
    const submitted = { status: STATUS.SUBMITTED, statusUpdatedAt: '2026-01-05 09:07:00' };
    const waiting = statusView.waitingHint(submitted, config, format);
    t.check(waiting.indexOf('等待接单') === 0 && waiting.indexOf('截止 2026-01-05 11:07') !== -1,
      '§7 待接单截止时间按配置计算');
    t.check(statusView.waitingHint({ status: STATUS.DELIVERED }, config, format).indexOf('24 小时') !== -1,
      '§7 送达后自动完成提示');
    t.eq(statusView.waitingHint({ status: STATUS.ACCEPTED }, config, format), '', '§7 其他状态无等待提示');
    t.eq(statusView.waitingHint(submitted, null, format), '', '§7 缺配置时不展示截止时间');
  });
}

function sectionOrderCreateModel(h) {
  h.section('§7 页面零件 order-create model（四步视图模型）', (t) => {
    t.eq(createModel.STEP_TITLES.slice(), ['截图', '核对', '服务', '提交'], '§7 下单四步标题');
    t.eq(createModel.stepTitle(1), '截图', '§7 第一步标题');
    t.eq(createModel.stepTitle(9), '', '§7 越界步骤返回空串');
    t.eq(createModel.MAX_BATCH, 5, '§7 一图多码批量上限 5');

    const now = new Date(2026, 0, 5, 21, 30, 0);
    const slots = createModel.appointmentSlots(now);
    t.eq(slots.length, 6, '§7 六个预约时段');
    t.eq(slots[0].label, '今天 08:00-12:00', '§7 时段标签');
    t.eq(slots.map((slot) => slot.expired), [true, true, false, false, false, false],
      '§7 已结束时段标记 expired');
    t.check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(slots[0].startAt), '§7 时段起点 ISO 形状');

    const stationList = createModel.stationOptions();
    t.eq(stationList.length, 8, '§7 站点选择器 8 个');
    t.eq(stationList[0].id, 'P1', '§7 站点选择器首项 P1');
    t.eq(createModel.stationName('P1'), '西苑顺丰快递（西苑五食堂）', '§7 站点名称同源');
    t.eq(createModel.stationName('P9'), '', '§7 未知站点无名称');

    const catalog = { serviceCatalog: defaults.DEFAULT_CONFIG.serviceCatalog };
    const filtered = createModel.serviceOptions(catalog, {
      services: [{ code: 'PICKUP_STD', enabled: true }, { code: 'PICKUP_DOOR', enabled: false }]
    });
    t.eq(filtered.length, 1, '§7 只保留兼职开启的服务类型');
    t.eq(filtered[0].code, 'PICKUP_STD', '§7 开启的服务类型 code 正确');
    t.eq(createModel.serviceOptions(catalog, {}).length, 5, '§7 未配置服务开关时展示全部类型');

    const emptyItem = createModel.makeItem({});
    t.eq(emptyItem.codeStatus, 'NONE', '§7 空件不可提交（codeStatus=NONE）');
    t.check(!!emptyItem.formErrors.station && !!emptyItem.formErrors.codeStatus, '§7 空件行内提示齐全');
    t.check(/^item_\d+$/.test(emptyItem.key), '§7 件 key 由模块自增生成');
    t.check(emptyItem.checked === true, '§7 新件默认勾选');
    const validItem = createModel.makeItem({
      stationId: 'P1', stationName: '西苑顺丰快递（西苑五食堂）', pickupCode: '123456'
    });
    t.eq(validItem.codeStatus, 'OK', '§7 有站点有码可提交');
    const tailItem = createModel.makeItem({ stationId: 'P1', trackingTail: '12345' });
    t.eq(tailItem.codeStatus, 'NEED_CODE', '§7 无码有尾号可先提交');

    t.eq(createModel.canSubmit([]).reason, '至少选择一件再提交', '§7 空选不可提交');
    t.eq(createModel.canSubmit([].concat(
      new Array(6).fill(0).map(() => createModel.makeItem({ stationId: 'P1', pickupCode: '123456' }))
    )).reason, '一图最多拆 5 件', '§7 超 5 件不可提交');
    t.check(createModel.canSubmit([validItem]).ok, '§7 单件合法可提交');
    const unchecked = createModel.makeItem({ stationId: 'P1', pickupCode: '123456' });
    unchecked.checked = false;
    t.check(createModel.canSubmit([unchecked]).ok === false, '§7 全不勾选不可提交');
    t.check(createModel.canSubmit([validItem]).items.length === 1, '§7 提交只返回勾选件');

    const single = createModel.buildPayload([validItem], 'ticket-1', 'file-1');
    t.eq(single.single, true, '§7 单件标记 single');
    t.eq(single.batch, false, '§7 单件不标 batch');
    t.eq(single.items[0].parcel.stationName, '西苑顺丰快递（西苑五食堂）', '§7 提交补全站点名称');
    t.eq(single.items[0].appoint, { type: 'ASAP' }, '§7 默认尽快');
    t.eq(single.ticket, 'ticket-1', '§7 票据透传');
    t.eq(single.image, 'file-1', '§7 图片透传');
    const batch = createModel.buildPayload([validItem, tailItem], 'ticket-2', 'file-2');
    t.eq(batch.batch, true, '§7 多件标记 batch');
    t.eq(batch.items.length, 2, '§7 多件明细齐全');

    t.eq(createModel.summaryText(validItem), '西苑顺丰快递（西苑五食堂） · 123456', '§7 摘要行拼接');
    t.eq(createModel.summaryText(createModel.makeItem({})), '待补充', '§7 空件摘要提示待补充');
  });
}

function register(h) {
  sectionStatusMachine(h);
  sectionActionRules(h);
  sectionEnumsCopy(h);
  sectionServices(h);
  sectionOrderView(h);
  sectionFormat(h);
  sectionValidate(h);
  sectionIds(h);
  sectionRoomTag(h);
  sectionLaunchRoute(h);
  sectionStatusViewPart(h);
  sectionOrderCreateModel(h);
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-state' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }),
    'selftest-state');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
