'use strict';
/**
 * tools/selftest-partner-pages.js — 批 7-C「端侧客户档案闭环」断言套件（task-73；A~G）。
 *
 * A. 客户列表模型：服务端 keyword 透传 / 游标分页合并去重 / 空态与引导区分 / 错误保留旧数据+上次成功时间 /
 *    首屏不出"新顾客已绑定"提示、刷新才出 / READONLY·会话入口显隐。
 * B. 顾客详情模型：getCustomer 装配 / 编号与宿舍行 / 自然日分组(今天/昨天/更早)与小计 / 更早游标 /
 *    解绑资格(进行中置灰+原因) / READONLY 置灰 / 空历史单。
 * C. 解绑流程：原因必填≤100 → 固定枚举 PARTNER_INITIATED → 二次确认文案 → 成功/失败文案。
 * D. 代客下单两条路径：bindingId vs guest 互斥 / 逐件 batch(≤5) / 站点·码·尾号·柜号·备注·dormKey·服务启用 /
 *    幂等键生命周期 / 识别预填只填空白 / 结果块 N 单 / 失败分类人话。
 * E. 字段校验矩阵（逐字段反例，样本非空）。
 * F. READONLY/TEST_WRITE + fake transport：api 层包络、READONLY 写动作零请求、TEST_WRITE 注入 viewTicket、
 *    分享卡片只带兼职编号（不 mock 全局 wx）。
 * G. 静态纪律：页面零 wx.cloud/状态字面量/random/本地存储、pkg-partner 零绑定入口文案、
 *    零金额词、行数闸、四件套齐全、语法可编译。
 *
 * 纪律：纯件 + api 层 fake transport（禁 mock 全局 wx、不连网络）；先合法基线再反例；
 *      EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-partner-pages.js | Select-Object -Last 2
 */
const path = require('path');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const fsutil = require('./lib/fsutil');
const zeroMoney = require('./zero-money-scan');
const project = require('./lib/project');

const client = require(path.join(ROOT, 'api/client.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const partnerApi = require(path.join(ROOT, 'api/modules/partner.js'));
const orderApi = require(path.join(ROOT, 'api/modules/order.js'));
const aiApi = require(path.join(ROOT, 'api/modules/ai.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const stations = require(path.join(ROOT, 'shared/stations.js'));
const zones = require(path.join(ROOT, 'shared/zones.js'));
const customerView = require(path.join(ROOT, 'utils/customer-view.js'));
const listModel = require(path.join(ROOT, 'pages/partner/customers/parts/list-model.js'));
const detailView = require(path.join(ROOT, 'pkg-partner/pages/customer-detail/parts/detail-view.js'));
const unbindFlow = require(path.join(ROOT, 'pkg-partner/pages/customer-detail/parts/unbind-flow.js'));
const formModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/form-model.js'));
const resultModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/result-model.js'));
const shareCard = require(path.join(ROOT, 'pages/profile/parts/share-card.js'));

// 注意：F 段（异步 fake transport）必须注册在最后——harness 的异步断言在 await 之后才计入，
// 若后面再注册同步段，console 的节标题会被后注册的段名覆盖。
const EXPECTED_ASSERTIONS = 156; // 实际断言总数（少算/多算都判红）

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 22, 10, 0, 0).getTime();
const BOUND_MS = new Date(2026, 9, 18, 14, 20, 0).getTime();

const CONFIG = {
  zoneLabels: { D: 'D 区', X: 'X 区', N: 'N 区', B: 'B 区', C: 'C 区' },
  serviceCatalog: [
    { code: 'PICKUP_STD', name: '标准代取' },
    { code: 'PICKUP_DOOR', name: '送寝上门' },
    { code: 'DROP_OFF', name: '代寄快递' }
  ]
};
const PARTNER = {
  serviceConfig: {
    services: [
      { code: 'PICKUP_STD', enabled: true },
      { code: 'PICKUP_DOOR', enabled: true },
      { code: 'DROP_OFF', enabled: false }
    ],
    zones: ['D', 'X'],
    acceptingOrders: true
  }
};

function bindingRow(id, overrides) {
  return Object.assign({
    bindingId: id,
    customerNo: 'C7K2M9QX4',
    dormKey: 'D4-522',
    roomTag: 'A',
    displayName: '小王',
    avatarFileId: 'cloud://test.env/avatars/x.jpg',
    phoneTail: '6678',
    buildingText: 'D4',
    partnerNote: '常放门口鞋柜',
    boundAt: BOUND_MS,
    activeOrderCount: 2
  }, overrides || {});
}

const ROW_1 = bindingRow('b1', { roomTag: 'a' });
const ROW_2 = bindingRow('b2', {
  customerNo: 'C9X1N2B3', dormKey: 'X2-301', roomTag: 'B', displayName: '',
  phoneTail: '', buildingText: 'X2', boundAt: 0, activeOrderCount: 0, avatarFileId: '', partnerNote: ''
});

// order.listPartner 行 DTO：状态/文案 + service{name} + ISO 时间戳（与 cloud _dto.buildOrderDto 同形）
function orderRow(orderNo, status, statusText, at, overrides) {
  const row = Object.assign({
    orderNo: orderNo,
    status: status,
    statusText: statusText,
    service: { code: 'PICKUP_STD', name: '标准代取' },
    createdAt: at,
    deliveredAt: 0,
    completedAt: 0,
    cancelledAt: 0
  }, overrides || {});
  ['createdAt', 'deliveredAt', 'completedAt', 'cancelledAt'].forEach((key) => {
    if (typeof row[key] === 'number' && row[key] > 0) {
      row[key] = new Date(row[key]).toISOString();
    }
  });
  return row;
}

// 该顾客订单（order.listPartner view=customer 的 list；历史单单一来源）
function customerOrders() {
  return [
    orderRow('20261022-0001', enums.ORDER_STATUS.COMPLETED, '已完成', NOW - 2 * HOUR, { completedAt: NOW - 2 * HOUR }),
    orderRow('20261022-0002', enums.ORDER_STATUS.ACCEPTED, '已接单', NOW - 3 * HOUR),
    orderRow('20261021-0003', enums.ORDER_STATUS.DELIVERED, '已送达·待确认', NOW - DAY - 2 * HOUR, { deliveredAt: NOW - DAY - 2 * HOUR }),
    orderRow('20261015-0004', enums.ORDER_STATUS.SUBMITTED, '待接单', NOW - 7 * DAY)
  ];
}

// partner.getCustomer 只取档案+解绑资格（orders 字段本页不消费）
function profileData(overrides) {
  return Object.assign({
    customer: ROW_1,
    activeOrderCount: 2,
    unbindEligibility: { canUnbind: false, activeOrderCount: 2 },
    partnerNo: 'P8F3K2M'
  }, overrides || {});
}

function boundState() {
  const state = formModel.createInitialState({
    config: CONFIG, partner: PARTNER, bindingList: [ROW_1, ROW_2], nowMs: NOW
  });
  state.items = [{ pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785' }];
  state.stationIndex = 4;
  return state;
}

function guestState() {
  const state = formModel.createInitialState({ config: CONFIG, partner: PARTNER, bindingList: [], nowMs: NOW });
  state.customerMode = 'GUEST';
  state.guest = { displayName: '小张', phoneTail: '6678', zone: 'D', buildingNo: '4', room: '522', dormKey: '' };
  state.items = [{ pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785' }];
  state.stationIndex = 4;
  return state;
}

function mutate(state, patch) {
  return Object.assign({}, state, patch);
}

function textOfRel(rel) {
  return fsutil.readText(path.join(ROOT, rel)) || '';
}

function stubTransport(fn) {
  client.setTransport(fn);
}

const MY_FILES = [
  'pages/partner/customers/index.js',
  'pages/partner/customers/index.wxml',
  'pages/partner/customers/parts/list-model.js',
  'pkg-partner/pages/customer-detail/index.js',
  'pkg-partner/pages/customer-detail/index.wxml',
  'pkg-partner/pages/customer-detail/parts/detail-view.js',
  'pkg-partner/pages/customer-detail/parts/unbind-flow.js',
  'pkg-partner/pages/create-on-behalf/index.js',
  'pkg-partner/pages/create-on-behalf/index.wxml',
  'pkg-partner/pages/create-on-behalf/parts/form-model.js',
  'pkg-partner/pages/create-on-behalf/parts/result-model.js',
  'utils/customer-view.js'
];

const PAGE_SCRIPTS = [
  'pages/partner/customers/index.js',
  'pkg-partner/pages/customer-detail/index.js',
  'pkg-partner/pages/create-on-behalf/index.js'
];

const PAGE_FILES = [
  'pages/partner/customers/index',
  'pkg-partner/pages/customer-detail/index',
  'pkg-partner/pages/create-on-behalf/index'
];

function register(h) {
  // ------------------------------------------------------------------ A 客户列表
  h.section('A. 客户列表：服务端 keyword/游标分页/空态/错误保留旧数据（§3.5、§7.4 listBindings）', (t) => {
    const state = listModel.createState();
    t.eq([state.rows, state.keyword, state.loading, state.nextCursor, state.hasLoaded],
      [[], '', true, '', false], 'A1 初始状态：无本地缓存行、loading、无游标（首屏走服务端）');
    t.eq(listModel.refreshQuery(state), { keyword: '', limit: 20 }, 'A2 首屏查询只带 {keyword,limit=20}（无 cursor；§7.4）');
    t.eq(listModel.nextQuery(state), null, 'A3 无游标时触底不请求下一页（不空转）');

    const keywordState = listModel.applyKeyword(state, '  小王 ');
    t.eq([keywordState.keyword, keywordState.rows, keywordState.loading, keywordState.nextCursor],
      ['小王', [], true, ''], 'A4 关键词变化：清空旧行与游标，交服务端搜索（客户端不本地过滤）');
    t.eq(customerView.normalizeKeyword('A'.repeat(40)).length, 30, 'A5 关键词归一化上限 30 字（防超长请求）');
    t.eq(listModel.applyKeyword(keywordState, '小王'), keywordState, 'A6 关键词未变不重置列表（避免输入抖动清空）');

    const first = listModel.applyResponse(listModel.createState(), { list: [ROW_2, ROW_1], nextCursor: 'cur-1' }, { nowMs: NOW });
    t.eq([first.rows.length, first.nextCursor, first.loading, first.hasLoaded], [2, 'cur-1', false, true],
      'A7 首屏响应装配：2 行 + nextCursor（服务端已排序，客户端不重排）');
    t.eq(first.rows.map((row) => row.bindingId), ['b2', 'b1'], 'A8 行顺序保持服务端顺序（不按昵称/编号本地二次排序）');
    t.eq([first.rows[0].displayNameText, first.rows[0].anchorKeyText], ['未填称呼', 'X2-301B'],
      'A9 昵称缺失回落「未填称呼」；锚+键 = 宿舍标识+大写 roomTag（D7 大写展示）');
    t.eq([first.rows[1].roomTagText, first.rows[1].tailText || first.rows[1].phoneTailText, first.rows[1].boundAtText],
      ['A', '尾号6678', '10-18'], 'A10 roomTag 大写；尾号四位；绑定日期 MM-DD（§3.5 行信息）');
    t.eq(customerView.dedupeRows([ROW_1, ROW_1]).length, 1, 'A11 同一 bindingId 去重（分页边界重复不重复渲染）');

    t.eq(first.newRows.length, 0, 'A12 首屏不把已有顾客误报为「新绑定」（hasLoaded 闸）');
    const refresh = listModel.applyResponse(first, { list: [ROW_1, ROW_2, bindingRow('b3')], nextCursor: '' }, { nowMs: NOW + 1000 });
    t.eq(refresh.newRows.map((row) => row.bindingId), ['b3'], 'A13 onShow 重拉检测到顾客新绑定（顾客发起）');
    t.eq(customerView.buildBannerText(refresh.newRows), '新顾客 D4-522A 已绑定（顾客发起）',
      'A14 顶部提示文案「新顾客 D4-522A 已绑定（顾客发起）」（§3.5 状态）');
    t.eq(listModel.applyMoreResponse(refresh, { list: [ROW_1, bindingRow('b4')], nextCursor: '' }, { nowMs: NOW + 2000 }).rows.length,
      4, 'A15 触底追加：跨页去重后 4 行（b1 重复不重复显示）');
    t.eq(listModel.nextQuery(listModel.applyMoreResponse(first, { list: [], nextCursor: 'cur-9' })), { keyword: '', limit: 20, cursor: 'cur-9' },
      'A16 触底查询透传服务端 nextCursor（游标分页，不本地切片）');

    const skeleton = customerView.listStateOf({ rows: [], loading: true, error: '', keyword: '', nextCursor: '' });
    t.check(skeleton.mode === 'skeleton' && skeleton.showSkeleton === true && skeleton.skeletonRows.length === 3,
      'A17 首屏骨架态（loading 且无行）');
    const errorOnly = customerView.listStateOf({ rows: [], loading: false, error: '没连上服务器', keyword: '', nextCursor: '' });
    t.check(errorOnly.mode === 'error' && errorOnly.errorText === '没连上服务器',
      'A18 无旧数据的错误态：错误卡 + 重试（不假装成功）');
    const stale = customerView.listStateOf({ rows: first.rows, loading: false, error: '没连上服务器', keyword: '', lastSuccessAt: NOW, nextCursor: 'cur-1' });
    t.check(stale.mode === 'list' && stale.staleText.indexOf('没连上服务器') >= 0
      && stale.staleText.indexOf('10:00') >= 0,
    'A19 有旧数据的错误态：保留旧行 + 「显示的是 10:00 的数据」（§10 无网络）');
    const emptyGuide = customerView.listStateOf({ rows: [], loading: false, error: '', keyword: '', nextCursor: '' });
    t.check(emptyGuide.mode === 'empty' && emptyGuide.emptyText.indexOf('还没有顾客绑定你') >= 0
      && emptyGuide.emptyText.indexOf('绑定只能由顾客发起') >= 0 && emptyGuide.emptyActionText === '分享绑定卡片',
    'A20 空态引导：绑定只能由顾客发起 + 分享绑定卡片（无「添加/绑定」入口）');
    const emptySearch = customerView.listStateOf({ rows: [], loading: false, error: '', keyword: '赵六', nextCursor: '' });
    t.check(emptySearch.emptyText === '这个搜索下没有顾客' && emptySearch.emptyActionText === '清空搜索',
      'A21 搜索空态与引导空态区分（不是"还没有顾客"）');

    const snapshot = listModel.buildSnapshot(first, { partnerNo: 'P8F3K2M', readonly: true, session: true });
    t.check(snapshot.showCreateEntry === false && snapshot.showShare === false && snapshot.readonly === true,
      'A22 READONLY 隐藏代客下单入口；切换会话隐藏分享（§6.3/§6.4）');
    t.eq([snapshot.headingText, snapshot.rows.length], ['客户', 2], 'A23 有游标时标题不写死总数（服务端分页口径）');
    t.eq(listModel.buildSnapshot(listModel.applyResponse(first, { list: [ROW_1], nextCursor: '' }), {}).headingText, '客户（1）',
      'A24 无更多页时才显示已加载总数');
    t.notEmpty(first.rows, 'A 组样本非空（防止空集全绿）');
  });

  // ------------------------------------------------------------------ B 顾客详情
  h.section('B. 顾客详情：档案+解绑资格/自然日分组/更早游标（§3.6；订单单一来源 listPartner view=customer）', (t) => {
    const orders = customerOrders();
    const data = profileData();
    const snapshot = detailView.buildSnapshot(data, { orders: orders, nextCursor: 'cursor-2', nowMs: NOW });
    t.eq([snapshot.view.anchorText, snapshot.view.anchorKeyText], ['D4-522A', 'D4-522A · 尾号6678 · 小王'],
      'B1 身份行：宿舍标识 + 大写 roomTag + 尾号 + 昵称（不显示 openid）');
    t.eq([snapshot.view.customerNo, snapshot.view.phoneTailText], ['C7K2M9QX4', '尾号6678'],
      'B2 顾客编号原样返回（展示格式由 id-text 组件统一），尾号四位单独展示');
    t.eq(snapshot.view.boundAtText, '2026-10-18 14:20', 'B3 绑定时间到分钟（§3.6 字段）');
    t.eq([snapshot.view.zoneText, snapshot.view.buildingText, snapshot.view.roomText], ['D 区', 'D4', '522'],
      'B4 苑/楼栋/宿舍由 dormKey 解析（展示口径 §3）');
    t.eq(detailView.buildDormParts('BAD-KEY'), { zoneText: '', buildingText: '', roomText: '' },
      'B5 dormKey 非法时逐级回落为空（不猜宿舍）');
    t.eq(snapshot.view.partnerNote, '常放门口鞋柜', 'B6 兼职私有备注取 DTO（顾客不可见）');
    t.eq(snapshot.partnerNo, 'P8F3K2M', 'B7 partnerNo（本人编号小字）随 getCustomer 档案响应返回');

    t.eq(snapshot.sections.map((section) => section.label), ['今天', '昨天', '更早'],
      'B8 历史单按自然日分组：今天/昨天/更早（§3.6）');
    t.eq(snapshot.sections.map((section) => section.rows.length), [2, 1, 1], 'B9 各组行数：今天 2、昨天 1、更早 1');
    t.eq(snapshot.sections[0].summaryText, '已完成 1 · 进行中 1',
      'B10 今天小计：已完成/进行中由服务端 status 现算（不本地猜状态文案）');
    t.eq(snapshot.sections[1].summaryText, '进行中 1', 'B11 昨天小计：已送达属进行中（服务端 status 分组）');
    t.eq(snapshot.sections[2].rows[0].timeText, customerView.timeText(NOW - 7 * DAY) + ' ' + customerView.timeHM(NOW - 7 * DAY),
      'B12 行时间取 DTO 时间戳格式化（ISO 字符串同样解析）');
    t.eq([snapshot.sections[2].rows[0].orderNo, snapshot.sections[2].rows[0].statusText, snapshot.sections[2].rows[0].serviceName],
      ['20261015-0004', '待接单', '标准代取'], 'B13 行字段：orderNo/状态中文/服务名（service.name 单一来源）');

    const shuffled = detailView.buildSnapshot(profileData({ unbindEligibility: { canUnbind: true, activeOrderCount: 0 } }), {
      orders: [orders[3], orders[2], orders[0], orders[1]], nextCursor: 'n', nowMs: NOW
    });
    t.eq(shuffled.sections.map((section) => section.key), ['today', 'yesterday', 'earlier'],
      'B14 分组顺序固定（数据乱序也不改变今天/昨天/更早顺序）');
    t.eq(detailView.mergeOrderPages(orders, [orders[0], orderRow('20261020-0009', enums.ORDER_STATUS.CANCELLED, '已取消', NOW - 2 * DAY)]).map((row) => row.orderNo),
      ['20261022-0001', '20261022-0002', '20261021-0003', '20261015-0004', '20261020-0009'],
      'B15 「查看更早」合并：按 orderNo 去重、保持先后（游标分页）');
    t.eq(detailView.buildProfileQuery('b1'), { bindingId: 'b1' },
      'B16 档案接口只传 bindingId（getCustomer 的 orders 不消费；页面参数不透传顾客 openid）');
    t.eq(detailView.buildOrdersQuery('b1'), { view: 'customer', bindingId: 'b1', limit: 20 },
      'B17 历史单首屏即走 order.listPartner({view:\'customer\'})（单一来源、服务端排序）');
    t.eq(detailView.buildOrdersQuery('b1', 'cursor-2'), { view: 'customer', bindingId: 'b1', limit: 20, cursor: 'cursor-2' },
      'B18 更早查询透传 listPartner 的 nextCursor（同一接口同一排序/扫描窗口径）');
    t.check(snapshot.showMore === true && snapshot.nextCursor === 'cursor-2', 'B19 有 nextCursor 才显示「查看更早」');
    t.check(detailView.buildSnapshot(data, { orders: orders, nextCursor: 'cursor-2', nowMs: NOW, loadingMore: true }).moreText === '正在加载…',
      'B20 加载中按钮文案「正在加载…」');

    t.check(snapshot.unbind.disabled === true && snapshot.unbind.lockText === '还有 2 单未完成，完成后才能解绑',
      'B21 进行中订单时解绑置灰 + 原因（§3.6）');
    const eligible = detailView.buildSnapshot(profileData({ unbindEligibility: { canUnbind: true, activeOrderCount: 0 } }), {
      orders: orders, nextCursor: '', nowMs: NOW
    });
    t.check(eligible.unbind.disabled === false && eligible.unbind.lockText === '' && eligible.unbind.buttonText === '解绑顾客',
      'B22 无进行中订单可解绑（资格判据取服务端 unbindEligibility）');
    t.check(detailView.buildSnapshot(data, { orders: orders, nowMs: NOW, readonly: true }).unbind.lockText === '开发者只读视角不能操作',
      'B23 READONLY：解绑置灰并提示只读（§6.3）');
    const emptyOrders = detailView.buildSnapshot({
      customer: ROW_2, unbindEligibility: { canUnbind: true, activeOrderCount: 0 }, partnerNo: 'P'
    }, { orders: [], nextCursor: '', nowMs: NOW });
    t.check(emptyOrders.hasOrders === false && emptyOrders.emptyOrdersText === '还没有历史订单' && emptyOrders.showMore === false,
      'B24 无历史订单空态（不画假行）');
    t.notEmpty(snapshot.sections, 'B 组样本非空（防止空集全绿）');
  });

  // ------------------------------------------------------------------ C 解绑流程
  h.section('C. 解绑流程：原因必填≤100 + 固定枚举 + 二次确认文案（§3.6、§7.4）', (t) => {
    t.eq(unbindFlow.validateNote('').message, '原因必填，写一句就好', 'C1 原因为空被挡（必填）');
    t.eq(unbindFlow.validateNote('   ').message, '原因必填，写一句就好', 'C2 纯空白等价于空（不静默通过）');
    t.eq(unbindFlow.validateNote('字'.repeat(101)).message, '说明不能超过 100 字', 'C3 原因超过 100 字被挡（releaseNote 上限）');
    t.eq(unbindFlow.validateNote('  顾客毕业离校  '), { ok: true, note: '顾客毕业离校', message: '' },
      'C4 合法原因去首尾空白后通过');
    t.eq(unbindFlow.buildPayload('b1', ' 顾客毕业离校 '), {
      ok: true, data: { bindingId: 'b1', reason: 'PARTNER_INITIATED', note: '顾客毕业离校' }, message: ''
    }, 'C5 提交体：bindingId + 固定枚举 reason=PARTNER_INITIATED + note（兼职侧释放原因，§7.4）');
    t.check(unbindFlow.buildPayload('', '原因').ok === false
      && unbindFlow.buildPayload('', '原因').message.indexOf('没有找到') >= 0,
    'C6 缺 bindingId 直接挡（不盲发请求）');
    t.check(unbindFlow.buildPayload('b1', '  ').ok === false, 'C7 原因为空不构造提交体');
    t.check(unbindFlow.confirmDialog().content.indexOf('解绑后顾客需重新绑定才能下单，历史订单保留') >= 0,
      'C8 二次确认文案写清后果（UX §3.6 固定文案）');
    t.check(unbindFlow.firstDialog().placeholderText.indexOf('原因（必填') >= 0,
      'C9 弹窗提示原因必填（≤100）');
    t.eq([unbindFlow.successText(false), unbindFlow.successText(true)],
      ['已解绑，已通知顾客', '已解绑，已通知顾客（测试数据）'], 'C10 成功文案：已通知顾客；TEST_WRITE 点明测试数据');
    t.eq([unbindFlow.failureText({ message: '解绑失败，请重试' }), unbindFlow.failureText(null)],
      ['解绑失败，请重试', '解绑失败，请重试'], 'C11 失败文案取服务端人话/兜底（不暴露错误码）');
    t.eq(unbindFlow.reasonText(), enums.RELEASE_REASON_TEXT.PARTNER_INITIATED,
      'C12 原因枚举单源 shared/enums（页面不复制一套文案）');
  });

  // ------------------------------------------------------------------ D 代客下单两路径
  h.section('D. 代客下单：bindingId vs guest 互斥/逐件 batch/幂等键/识别预填/结果块（§3.4、§7.5）', (t) => {
    t.eq(formModel.serviceOptionsOf(CONFIG, PARTNER).map((item) => item.code), ['PICKUP_STD', 'PICKUP_DOOR'],
      'D1 服务类型只列本人已启用（未启用 DROP_OFF 不出现，§6/§8）');
    t.eq(formModel.serviceOptionsOf(CONFIG, { serviceConfig: { services: [] } }), [],
      'D2 未启用任何服务时返回空（fail closed，不给默认兜底服务）');
    t.eq(formModel.zoneOptionsOf(CONFIG, PARTNER).map((item) => item.key), ['D', 'X'],
      'D3 苑值域按本人服务范围（serviceConfig.zones）收窄');
    const bindOptions = formModel.buildBindingOptions([ROW_1, { displayName: '无编号' }, ROW_2]);
    t.eq(bindOptions.map((item) => item.label), ['小王', '未填称呼'], 'D4 绑定档案选项：只有 bindingId 的行入选、昵称缺失回落');
    t.eq(Object.keys(bindOptions[0]).sort(), ['bindingId', 'label', 'sub'], 'D5 已绑定路径只带 bindingId（不透传顾客 openid/身份）');
    t.eq(formModel.createInitialState({ config: CONFIG, partner: PARTNER, bindingList: [ROW_1], nowMs: NOW }).customerMode, 'BOUND',
      'D6 有绑定档案时默认「已绑定」路径（两条路都存在）');
    t.eq(formModel.createInitialState({ config: CONFIG, partner: PARTNER, bindingList: [], nowMs: NOW }).customerMode, 'GUEST',
      'D7 无绑定档案时默认「新顾客」路径（代客单不产生绑定）');

    const bound = boundState();
    t.eq(formModel.validate(bound), '', 'D8 已绑定路径合法基线可提交（先合法基线）');
    const boundPayload = formModel.buildPayload(bound);
    t.eq([boundPayload.ok, boundPayload.batch], [true, false], 'D9 单件已绑定路径 → order.create');
    t.eq([boundPayload.data.bindingId, 'guest' in boundPayload.data, boundPayload.data.serviceCode],
      ['b1', false, 'PICKUP_STD'], 'D10 已绑定路径带 bindingId、不带 guest（二选一）');
    t.eq(boundPayload.data.parcel, {
      pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785',
      stationId: 'P4', stationName: stations.stationNameOf('P4')
    }, 'D11 parcel：码/柜号/尾号 + P1~P8 站点（不自建站点）');
    t.eq(boundPayload.data.appoint, { type: 'ASAP' }, 'D12 预约 ASAP 只带 type（不带时段起止）');

    const guest = guestState();
    t.eq(formModel.validate(guest), '', 'D13 新顾客路径合法基线可提交（先合法基线）');
    const guestPayload = formModel.buildPayload(guest);
    t.eq([guestPayload.batch, 'bindingId' in guestPayload.data], [false, false],
      'D14 新顾客路径不带 bindingId（二选一）');
    t.eq(guestPayload.data.guest, {
      displayName: '小张', phoneTail: '6678', zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522'
    }, 'D15 guest 快照：dormKey 端侧拼装、楼栋归一为数字（送达要用）');
    t.eq(Object.keys(guestPayload.data).filter((key) => key === 'bindingId' || key === 'guest').length, 1,
      'D16 两份 payload 都只有顾客身份键之一（bindingId XOR guest）');

    const batchState = mutate(bound, {
      items: [
        { pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785' },
        { pickupCode: '27-2-7017', lockerNo: '', trackingTail: '' }
      ],
      imageFileId: 'cloud://test.env/ticket.jpg', imageTicketId: 'ticket-it'
    });
    const batch = formModel.buildPayload(batchState);
    t.check(batch.ok && batch.batch === true && batch.data.items.length === 2,
      'D17 一图多码（2 件）→ order.createBatch，items 逐条');
    t.eq([batch.data.image, batch.data.ticket, batch.data.bindingId], [{ fileId: 'cloud://test.env/ticket.jpg' }, 'ticket-it', 'b1'],
      'D18 createBatch 顶层共用同一 fileId/ticket，已绑定路径 bindingId 顶层');
    t.eq(batch.data.items[1].parcel.pickupCode, '27-2-7017', 'D19 逐条 parcel 独立（不合并成一条）');
    const guestBatch = formModel.buildPayload(mutate(guestState(), {
      items: [{ pickupCode: '1-1-1', lockerNo: '', trackingTail: '' }, { pickupCode: '2-2-2', lockerNo: '', trackingTail: '' }]
    }));
    t.eq(guestBatch.data.items.map((item) => item.guest.dormKey), ['D4-522', 'D4-522'],
      'D20 新顾客批量：guest 逐条带（接口约定 items[i].guest）');
    t.check(!('bindingId' in guestBatch.data), 'D21 新顾客批量顶层不带 bindingId（互斥）');
    t.eq(formModel.MAX_CREATE_LIMIT || formModel.BATCH_MAX, 5, 'D22 一图多码上限 = 5（order-state.MAX_CREATE_BATCH）');
    t.eq(formModel.validate(mutate(bound, {
      items: [1, 2, 3, 4, 5, 6].map((index) => ({ pickupCode: '码' + index, lockerNo: '', trackingTail: '' }))
    })), '一图多码最多 5 件，请分次提交', 'D23 超过 5 件被挡（不拆单不静默丢件）');

    const goodSignature = formModel.contentSignature(bound);
    const reused = formModel.ensureRequestKey({ clientRequestId: 'REQ_ABCDEFGHIJKLMNOP', signature: goodSignature },
      goodSignature, { makeId: () => 'NEW_ID_1234567890', isValid: () => true });
    t.eq(reused.clientRequestId, 'REQ_ABCDEFGHIJKLMNOP', 'D24 同内容重试复用同一幂等键（失败重试不重复建单）');
    const regenerated = formModel.ensureRequestKey({ clientRequestId: 'REQ_ABCDEFGHIJKLMNOP', signature: goodSignature },
      formModel.contentSignature(mutate(bound, { note: '换了备注' })), { makeId: () => 'NEW_ID_1234567890', isValid: () => true });
    t.eq(regenerated.clientRequestId, 'NEW_ID_1234567890', 'D25 内容变化重新生成幂等键（旧键不复用）');
    const invalidOld = formModel.ensureRequestKey({ clientRequestId: 'bad', signature: goodSignature }, goodSignature,
      { makeId: () => 'NEW_ID_1234567890', isValid: () => false });
    t.eq(invalidOld.clientRequestId, 'NEW_ID_1234567890', 'D26 旧键非法也重新生成（不把非法键发给服务端）');
    t.check(formModel.contentSignature(bound) === formModel.contentSignature(mutate(bound, {})),
      'D27 同内容签名稳定（不因对象引用变化换键）');

    const recognition = formModel.applyRecognition(mutate(bound, {
      items: [{ pickupCode: '手填码', lockerNo: '', trackingTail: '' }]
    }), { recognized: true, pickupCode: 'AI码', lockerNo: '5 号柜', trackingTail: '12345', stationId: 'P6' });
    t.eq(recognition.items[0], { pickupCode: '手填码', lockerNo: '5 号柜', trackingTail: '12345' },
      'D28 识别预填只填空白字段（手填优先，不覆盖用户输入）');
    t.eq(recognition.stationIndex, 6, 'D29 识别到的站点命中 P1~P8 才选中 picker');
    t.eq(recognition.reviewText.indexOf('已按截图预填'), 0, 'D30 预填提示「已按截图预填，请核对（以手填为准）」');
    const failedRecognition = formModel.applyRecognition(bound, { recognized: false, failureId: 'F-100' });
    t.check(failedRecognition.reviewText.indexOf('已反馈开发者复核') > 0 && failedRecognition.recognitionFailureId === 'F-100',
      'D31 识别失败静默降级：提示已反馈复核 + failureId 关联（不阻塞手填）');

    const singleResult = resultModel.buildResult({ orderNo: '20261022-0031' }, { customerMode: 'BOUND' });
    t.check(singleResult.visible && singleResult.rows.length === 1 && singleResult.rows[0].orderNo === '20261022-0031'
      && singleResult.title === '订单已提交', 'D32 结果块：单件列出 orderNo/可点（§3.4 成功先出结果块）');
    const guestResult = resultModel.buildResult({ orderNo: '20261022-0032' }, { customerMode: 'GUEST' });
    t.check(guestResult.hintLines.length === 4
      && guestResult.hintLines.join('').indexOf('未绑定') >= 0
      && guestResult.hintLines.join('').indexOf('自动完成') >= 0,
    'D33 guest 成功必须展示未绑定/线下告知/自动完成提示块（§3.4）');
    const batchResult = resultModel.buildResult({ orders: ['20261022-0031', { orderNo: '20261022-0032' }, '20261022-0033'] }, { customerMode: 'BOUND' });
    t.check(batchResult.rows.length === 3 && batchResult.title === '本次提交 3 单'
      && batchResult.rows.map((row) => row.label).join('|') === '第 1 单|第 2 单|第 3 单',
    'D34 一图多码结果块逐条列 N 个 orderNo（同一 fileId 拆单）');
    const duplicateResult = resultModel.buildResult({ duplicated: true, orderNo: '20261022-0031' }, { customerMode: 'GUEST' });
    t.check(duplicateResult.visible && duplicateResult.duplicateText.indexOf('不会重复建单') >= 0,
      'D35 重复提交（幂等命中）给出说明，不报错也不重复建单');

    const appoints = formModel.buildAppointOptions(NOW);
    t.check(appoints.length === 4 && appoints[0].key === 'ASAP' && appoints[1].key === 'SLOT'
      && appoints[1].startAt < appoints[1].endAt, 'D36 预约选项：尽快 + 今天三时段（起止成对）');

    t.eq(formModel.failureText({ code: 'PARTNER_CLOSED' }), '接单已关闭，暂时不能下单；已有订单不受影响。',
      'D37 PARTNER_CLOSED 人话（§3.4/§10）');
    t.eq(formModel.failureText({ code: 'VALIDATION_FAILED', message: '运单尾号必须是 5 位数字' }), '运单尾号必须是 5 位数字',
      'D38 VALIDATION_FAILED 保留服务端字段级人话（不换空话）');
    t.eq([formModel.failureText({ code: 'RATE_LIMITED' }), formModel.failureText({ code: 'INTERNAL_ERROR' })],
      [errorCopy.CODE_COPY.RATE_LIMITED, errorCopy.CODE_COPY.INTERNAL_ERROR],
      'D39 其余 13 码统一取 shared/error-copy（错误码不暴露给用户）');
    t.eq(formModel.failureText({ code: 'TEAPOT' }), errorCopy.UNKNOWN_CODE_COPY, 'D40 未登记码回退 UNKNOWN_CODE_COPY');
    t.notEmpty(boundPayload.data.parcel.pickupCode, 'D 组样本非空（防止空集全绿）');
  });

  // ------------------------------------------------------------------ E 字段校验矩阵
  h.section('E. 字段校验矩阵：站点/码/尾号/柜号/备注/dormKey/服务启用（§3.4 字段校验）', (t) => {
    t.eq(stations.listStations().map((item) => item.id), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
      'E1 站点值域恰为 P1~P8（复用 shared/stations，不自建）');
    const stationOptions = formModel.stationOptionsOf();
    t.check(stationOptions.length === 9 && stationOptions[0].id === ''
      && stationOptions.slice(1).every((item) => stations.isStationId(item.id)),
    'E2 站点 picker：空 = 暂不指定（NEED_CODE 机制）+ P1~P8 全部可选');
    t.eq(formModel.validate(mutate(boundState(), { services: [] })),
      '还没有启用任何服务类型，先去「服务类型与范围」启用后再代客下单', 'E3 未启用服务被挡（不给默认可提交）');
    t.eq(formModel.validate(mutate(boundState(), { bindingIndex: 99 })), '请选择一位已绑定的顾客',
      'E4 已绑定路径未选档案被挡（不靠昵称猜身份）');
    t.eq(formModel.validate(mutate(guestState(), { guest: { displayName: '', phoneTail: '', zone: 'D', buildingNo: '4', room: '522' } })),
      '代客单需要填顾客称呼（送达时要用）', 'E5 guest 称呼必填（送达要用）');
    t.eq(formModel.validate(mutate(guestState(), { guest: { displayName: '小张', phoneTail: '12', zone: 'D', buildingNo: '4', room: '522' } })),
      '手机尾号是 4 位数字，或留空', 'E6 guest 尾号必须 4 位数字或留空');
    t.eq(formModel.validate(mutate(guestState(), { guest: { displayName: '小张', phoneTail: '', zone: 'Z', buildingNo: '4', room: '522' } })),
      '请选择苑', 'E7 guest 苑必须在五苑内（不收非法苑）');
    t.eq(formModel.validate(mutate(guestState(), { guest: { displayName: '小张', phoneTail: '', zone: 'D', buildingNo: '11', room: '522' } })),
      '楼栋号是 1~10 的数字', 'E8 楼栋号值域 1~10');
    t.eq(formModel.validate(mutate(guestState(), { guest: { displayName: '小张', phoneTail: '', zone: 'D', buildingNo: '4', room: '99' } })),
      '宿舍号至少 3 位数字', 'E9 宿舍号下限（非法 dormKey 不落库）');
    t.eq(formModel.validate(mutate(boundState(), { items: [{ pickupCode: '', lockerNo: '', trackingTail: '' }] })),
      '至少填取件码或运单尾号，两者都空无法建单', 'E10 码与尾号都空不可提交（§3.4）');
    t.eq(formModel.validate(mutate(boundState(), { items: [{ pickupCode: 'A'.repeat(41), lockerNo: '', trackingTail: '' }] })),
      '取件码最多 40 字', 'E11 取件码 ≤40（与 order-edit 上限同源）');
    t.eq(formModel.validate(mutate(boundState(), { items: [{ pickupCode: '码', lockerNo: 'X'.repeat(11), trackingTail: '' }] })),
      '柜号最多 10 字', 'E12 柜号 ≤10');
    t.eq(formModel.validate(mutate(boundState(), { items: [{ pickupCode: '码', lockerNo: '', trackingTail: '1234' }] })),
      '运单尾号必须是 5 位数字', 'E13 运单尾号恰 5 位数字');
    t.eq(formModel.validate(mutate(boundState(), { note: '备'.repeat(201) })), '备注最多 200 字',
      'E14 备注 ≤200 字（不静默截断）');
    t.eq(formModel.validate(mutate(boundState(), { imageFileId: 'cloud://x.jpg', imageTicketId: '' })),
      '截图票据缺失，请重新选择截图', 'E15 截图 fileId 与 ticket 必须成对（不拿半套参数提交）');
    const badStation = mutate(boundState(), { stationIndex: 1 });
    badStation.stationOptions = badStation.stationOptions.slice();
    badStation.stationOptions[1] = { id: 'P9', name: '非法站点' };
    t.eq(formModel.validate(badStation), '驿站站点不在可选范围内，请重新选择', 'E16 非 P1~P8 站点被挡（不放宽站点值域）');
    t.eq(formModel.validateParcel({ pickupCode: '', lockerNo: '', trackingTail: '12345' }, 1),
      '', 'E17 逐件校验：只有尾号也合法（NEED_CODE 机制）');
    t.eq(formModel.validateParcel({ pickupCode: '码', lockerNo: '', trackingTail: '1234' }, 1),
      '第 2 件：运单尾号必须是 5 位数字', 'E18 批量逐件错误带件号（用户知道改哪一条）');
  });

  // ------------------------------------------------------------------ G 静态纪律
  h.section('G. 静态纪律：页面零判据/零绑定入口/零金额/行数/四件套（§2 铁律、门禁 #18/#21/#22/#28）', (t) => {
    const statusLiterals = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
    const layerBad = [];
    PAGE_SCRIPTS.forEach((rel) => {
      const code = fsutil.stripComments(textOfRel(rel));
      if (/wx\.cloud\./.test(code)) layerBad.push(rel + ':wx.cloud');
      if (/Math\.random|\brandom\(/.test(code)) layerBad.push(rel + ':random');
      statusLiterals.forEach((status) => {
        if (new RegExp("['\"]" + status + "['\"]").test(code)) layerBad.push(rel + ':' + status);
      });
    });
    t.eq(layerBad, [], 'G1 页面脚本零 wx.cloud/random/七状态字面量（#21 页面层零判据）');

    const actionHits = [];
    PAGE_SCRIPTS.concat(MY_FILES.filter((rel) => rel.endsWith('.js') && rel.indexOf('/parts/') >= 0)).forEach((rel) => {
      const code = fsutil.stripComments(textOfRel(rel));
      const re = /['"]([a-z][a-zA-Z]+\.[a-zA-Z]+)['"]/g;
      let match;
      while ((match = re.exec(code))) {
        if (project.ACTIONS[match[1]]) actionHits.push(rel + ':' + match[1]);
      }
    });
    t.eq(actionHits, [], 'G2 页面/纯件层不直接拼 action 字符串（动作入口统一 api/modules）');

    const forbidden = ['绑定顾客', '添加顾客', '导入顾客'];
    const pkgBad = [];
    MY_FILES.filter((rel) => rel.indexOf('pkg-partner/') === 0).forEach((rel) => {
      const source = textOfRel(rel);
      forbidden.forEach((word) => {
        if (source.indexOf(word) !== -1) pkgBad.push(rel + ':' + word);
      });
      ['bind.create', 'bind.release'].forEach((word) => {
        if (source.indexOf(word) !== -1) pkgBad.push(rel + ':' + word);
      });
    });
    t.eq(pkgBad, [], 'G3 pkg-partner 零绑定入口文案/零 bind.* 直调（铁律 §7、门禁 #28）');

    const storageHits = MY_FILES.filter((rel) => rel.endsWith('.js'))
      .map((rel) => ({ rel: rel, hits: (fsutil.stripComments(textOfRel(rel)).match(/wx\.[A-Za-z]*Storage[A-Za-z]*/g) || []) }))
      .filter((item) => item.hits.length > 0);
    t.eq(storageHits, [], 'G4 本地存储零直写（唯一写口 utils/storage.js，门禁 #15）');

    const detailSource = textOfRel('pkg-partner/pages/customer-detail/index.js');
    const detailModel = textOfRel('pkg-partner/pages/customer-detail/parts/detail-view.js');
    t.check(detailSource.indexOf('getCustomer') >= 0 && detailSource.indexOf('orderApi.listPartner') >= 0
      && detailModel.indexOf("view: 'customer'") >= 0 && detailSource.indexOf('keyword:') === -1,
    'G5 详情页：档案取 getCustomer、历史单单一来源 order.listPartner(view=customer)，不再用 keyword 冒充该顾客订单');
    const customersSource = textOfRel('pages/partner/customers/index.js')
      + textOfRel('pages/partner/customers/parts/list-model.js');
    t.check(customersSource.indexOf('filterByKeyword') === -1 && customersSource.indexOf('onReachBottom') >= 0
      && customersSource.indexOf('onShow') >= 0, 'G6 列表页：无本地全量过滤、有触底分页、onShow 重拉（缺陷修复锁定）');
    const createModel = textOfRel('pkg-partner/pages/create-on-behalf/parts/form-model.js');
    t.check(createModel.indexOf("data.bindingId = binding.bindingId") >= 0 && createModel.indexOf('row.guest = Object.assign') >= 0,
      'G7 代客单两条路径都在请求体构造处落地（bindingId / guest 互斥）');

    const wxmls = PAGE_FILES.map((rel) => textOfRel(rel + '.wxml'));
    t.check(wxmls.every((wxml) => wxml.indexOf('switch-bar') >= 0),
      'G8 三个页面都引用 switch-bar（切换会话条；#23）');
    t.check(wxmls[0].indexOf('showCreateEntry') >= 0 && wxmls[0].indexOf('bannerText') >= 0,
      'G9 客户列表 WXML：READONLY 入口显隐 + 新绑定提示');
    t.check(wxmls[1].indexOf('unbind.lockText') >= 0 && wxmls[1].indexOf('sections') >= 0 && wxmls[1].indexOf('id-text') >= 0,
      'G10 顾客详情 WXML：解绑置灰原因 + 自然日分组 + 编号组件');
    t.check(wxmls[2].indexOf('result.rows') >= 0 && wxmls[2].indexOf('result.hintLines') >= 0
      && wxmls[2].indexOf('items') >= 0, 'G11 代客下单 WXML：结果块 N 单 + guest 提示块 + 逐件表单');

    const moneyHits = [];
    MY_FILES.forEach((rel) => {
      zeroMoney.scanText(textOfRel(rel)).forEach((hit) => moneyHits.push(rel + ':' + hit.token));
    });
    t.eq(moneyHits, [], 'G12 零金额词表零命中（门禁 #22；服务只表达做什么）');

    const openidHits = MY_FILES.filter((rel) => {
      const code = rel.endsWith('.js') ? fsutil.stripComments(textOfRel(rel)) : textOfRel(rel);
      return /customerOpenid|openid\s*[:=]/.test(code);
    });
    t.eq(openidHits, [], 'G13 端侧零 openid 透传/展示（页面参数一律 bindingId，§7.4 批 7）');

    const tooLong = [];
    PAGE_SCRIPTS.concat(MY_FILES.filter((rel) => rel.endsWith('.js'))).forEach((rel) => {
      const lines = fsutil.countLines(path.join(ROOT, rel));
      if (lines > 500) tooLong.push(rel + ':' + lines);
    });
    t.eq(tooLong, [], 'G14 页面/纯件脚本均 ≤500 行（#18）');
    t.check(fsutil.countLines(path.join(ROOT, 'tools/selftest-partner-pages.js')) <= 1000,
      'G15 本测试文件 ≤1000 行（#18 测试档）');

    const missing = [];
    PAGE_FILES.forEach((base) => {
      ['js', 'wxml', 'wxss', 'json'].forEach((ext) => {
        if (!fsutil.exists(path.join(ROOT, base + '.' + ext))) missing.push(base + '.' + ext);
      });
    });
    t.eq(missing, [], 'G16 三个页面四件套齐全（#03）');

    const syntaxBad = [];
    PAGE_SCRIPTS.concat(MY_FILES.filter((rel) => rel.endsWith('.js'))).forEach((rel) => {
      const checked = fsutil.syntaxCheck(textOfRel(rel), rel);
      if (!checked.ok) syntaxBad.push(rel + ':' + checked.error);
    });
    t.eq(syntaxBad, [], 'G17 页面/纯件脚本均可编译（#02 node 语法）');
  });
  // ------------------------------------------------------------------ F READONLY/TEST_WRITE + transport
  h.section('F. READONLY/TEST_WRITE 与 fake transport：包络/零请求/票据/分享（§6.3、§6.4）', async (t) => {
    const captured = [];
    try {
      store.reset();
      stubTransport((payload) => {
        captured.push(payload);
        return Promise.resolve({ ok: true, data: { list: [], nextCursor: null }, serverTime: NOW });
      });
      t.eq(client.isWriteAction('partner.unbindCustomer'), true, 'F1 api 层登记解绑为写动作（READONLY 二道闸前置）');
      t.eq(client.isWriteAction('partner.getCustomer'), false, 'F2 getCustomer 是只读动作（切换会话可读）');

      await partnerApi.listBindings({ keyword: 'D4', limit: 20 });
      t.eq([captured[0].action, captured[0].data], ['partner.listBindings', { keyword: 'D4', limit: 20 }],
        'F3 列表请求：action=partner.listBindings、data 原样透传服务端搜索参数');
      t.check(client.CLIENT_REQUEST_ID_PATTERN.test(captured[0].clientRequestId) === true,
        'F4 每个请求由 api 层注入合法 clientRequestId（幂等键）');
      await partnerApi.getCustomer(detailView.buildProfileQuery('b1'));
      t.eq([captured[1].action, captured[1].data], ['partner.getCustomer', { bindingId: 'b1' }],
        'F5 档案请求：getCustomer 只取档案+解绑资格（orders 不消费；页面参数不含顾客 openid）');
      await orderApi.listPartner(detailView.buildOrdersQuery('b1', 'cur-2'));
      t.eq([captured[2].action, captured[2].data],
        ['order.listPartner', { view: 'customer', bindingId: 'b1', limit: 20, cursor: 'cur-2' }],
        'F5b 历史单单一来源：order.listPartner view=customer（服务端排序/游标/扫描窗与工作台一致）');

      const payload = formModel.buildPayload(boundState());
      await orderApi.create(payload.data, { clientRequestId: 'REQ_ABCDEFGHIJKLMNOP' });
      t.eq([captured[3].action, captured[3].data.bindingId, captured[3].clientRequestId],
        ['order.create', 'b1', 'REQ_ABCDEFGHIJKLMNOP'], 'F6 已绑定代客单经 api 层透传 bindingId + 显式幂等键');
      const batchPayload = formModel.buildPayload(mutate(boundState(), {
        items: [{ pickupCode: '27-2-7016', lockerNo: '', trackingTail: '' }, { pickupCode: '27-2-7017', lockerNo: '', trackingTail: '' }]
      }));
      await orderApi.createBatch(batchPayload.data, { clientRequestId: 'REQ_ABCDEFGHIJKLMNOP' });
      t.eq([captured[4].action, captured[4].data.items.length], ['order.createBatch', 2],
        'F7 多件经 api 层走 order.createBatch（同一截图拆单）');

      store.setViewContext({ viewMode: 'READONLY', viewTicket: 'ticket-ro', role: 'PARTNER', targetNo: 'P8F3K2M' });
      const before = captured.length;
      let roError = null;
      try {
        await partnerApi.unbindCustomer({ bindingId: 'b1', reason: 'PARTNER_INITIATED', note: '原因' });
      } catch (err) {
        roError = err;
      }
      t.check(roError !== null && roError.code === 'FORBIDDEN' && roError.message === '开发者只读视角不能操作'
        && captured.length === before, 'F8 READONLY：解绑在 api 层先被拒，transport 零调用（前端二道闸）');
      let roNoteError = null;
      try {
        await partnerApi.saveCustomerNote({ bindingId: 'b1', partnerNote: 'x' });
      } catch (err) {
        roNoteError = err;
      }
      t.check(roNoteError !== null && roNoteError.code === 'FORBIDDEN' && captured.length === before,
        'F9 READONLY：备注保存在 api 层被拒，零请求');
      let roCreateError = null;
      try {
        await orderApi.create(payload.data);
      } catch (err) {
        roCreateError = err;
      }
      t.check(roCreateError !== null && roCreateError.code === 'FORBIDDEN' && captured.length === before,
        'F10 READONLY：代客下单在 api 层被拒，零请求（§6.3 入口隐藏 + 服务端双保险）');
      let roAiError = null;
      try {
        await aiApi.parseParcel({ role: 'PARTNER' });
      } catch (err) {
        roAiError = err;
      }
      t.check(roAiError !== null && roAiError.code === 'FORBIDDEN' && captured.length === before,
        'F11 READONLY：识别兜底（ai.parseParcel）也被拒，零请求');
      t.eq([client.isWriteAction('order.create'), client.isWriteAction('order.createBatch')], [true, true],
        'F12 两条下单接口都登记为写动作（READONLY 矩阵覆盖）');

      store.setViewContext({ viewMode: 'TEST_WRITE', viewTicket: 'ticket-tw', role: 'PARTNER', targetNo: 'P8F3K2M', targetIsTest: true });
      await partnerApi.unbindCustomer({ bindingId: 'b1', reason: 'PARTNER_INITIATED', note: '原因' });
      t.eq([captured[captured.length - 1].viewTicket, captured[captured.length - 1].action],
        ['ticket-tw', 'partner.unbindCustomer'], 'F13 TEST_WRITE：写动作放行且 api 层注入 viewTicket（服务端再校验测试数据）');

      store.clearViewContext();
      t.eq([client.isWriteAction('partner.listBindings'), client.isWriteAction('partner.stats')], [false, false],
        'F14 只读接口（listBindings/stats）不因会话被本地禁读');
    } finally {
      client.restoreTransport();
      store.reset();
    }

    t.eq(shareCard.buildShareMessage({
      isCustomer: false, viewSession: true, partnerCard: { partnerNo: 'P8F3K2M' }
    }).path, '/pages/role/index', 'F15 切换会话隐藏分享（回通用首页分享，不外发他人页面）');
    const share = shareCard.buildShareMessage({ isCustomer: false, viewSession: false, partnerCard: { partnerNo: 'P8F3K2M' } });
    t.check(share.path === '/pages/role/index?bind=P8F3K2M'
      && share.title === '我在做校园代取，凭兼职编号找我下单',
    'F16 分享绑定卡片只带兼职编号（不带昵称/头像/宿舍/尾号，§7）；顾客自己发起绑定');
    t.eq(formModel.MODE_LABEL.BOUND, '已绑定（对方发起）', 'F17 两条顾客路径文案单源（已绑定/新顾客）');
  });

}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-partner-pages' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-partner-pages');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
