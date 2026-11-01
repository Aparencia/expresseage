'use strict';
/**
 * tools/selftest-partner-pages.js — 代客下单/客户档案端侧断言套件（A~O；D44 同批 + T5-A 收口）。
 * A 客户列表 / B 顾客详情 / C 解绑流程 / D 代客下单两路径 / E 字段校验矩阵 / F READONLY+transport /
 * G 静态纪律 / H 激活页邀请码 / I 代客缺陷回归 / J 服务类型目录 / K D42 头像 / N D44 站点按件+多图+识别预填 /
 * O T5-A TD-084 逐件识别兜底·幂等键按件·超限请分单·预约请求时校时（TD-083 结果块配置化在 D 段）。
 * 纪律：纯件 + api 层 fake transport（禁 mock 全局 wx、不连网络）；先合法基线再反例；样本非空；
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
const customerView = require(path.join(ROOT, 'utils/customer-view.js'));
const listModel = require(path.join(ROOT, 'pages/partner/customers/parts/list-model.js'));
const detailView = require(path.join(ROOT, 'pkg-partner/pages/customer-detail/parts/detail-view.js'));
const unbindFlow = require(path.join(ROOT, 'pkg-partner/pages/customer-detail/parts/unbind-flow.js'));
const formModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/form-model.js'));
const resultModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/result-model.js'));
const payloadModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/payload-model.js'));
const presetModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/preset-model.js'));
const recognizeModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/recognize-model.js'));
const serviceSettingsModel = require(path.join(ROOT, 'pkg-partner/pages/service-settings/parts/service-model.js'));
const shareCard = require(path.join(ROOT, 'pages/profile/parts/share-card.js'));
const codeInput = require(path.join(ROOT, 'pkg-partner/pages/activate/parts/code-input-model.js'));

// 注意：F 段（异步 fake transport）必须注册在最后——harness 的异步断言在 await 之后才计入，
// 若后面再注册同步段，console 的节标题会被后注册的段名覆盖。
// 226 + 17：T5-A 收口（TD-083 结果块配置化 3 条 + TD-084 逐件兜底/幂等粒度/超限/请求时校时 14 条）
// 243 + P 组批20-C 首屏流式/占位/排序置底/底部安全区（36 条，拆到 tools/lib/partner-pages-cases.js）
const cases = require(path.join(__dirname, 'lib', 'partner-pages-cases.js'));
const EXPECTED_ASSERTIONS = 243 + cases.PERF_EXPECTED_ASSERTIONS;

// TD-083/T5-A 拆件：夹具/静态扫描样本拆到 tools/lib/partner-pages-cases.js（控测试文件 ≤950 行，门禁 #18；
// tools/lib 不参与 tools/selftest.js 注册完整性闸，先例 tools/lib/workbench-cases.js）。
const {
  CONFIG, PARTNER, NOW, DAY, ROW_1, ROW_2, STATUS_LITERALS, bindingRow, orderRow,
  customerOrders, profileData, withStation, parcelOf, ticketFile,
  boundState, guestState, mutate, textOfRel, stubTransport,
  MY_FILES, PAGE_SCRIPTS, PAGE_FILES
} = cases;

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
    t.check(skeleton.mode === 'skeleton' && skeleton.showSkeleton === true && skeleton.skeletonRows.length === 6,
      'A17 首屏骨架态：6 张灰色占位卡（loading 且无行；批20-C 由 3 张加到 6 张）');
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
    t.eq([snapshot.view.zoneText, snapshot.view.buildingText, snapshot.view.roomText], ['东苑', 'D4', '522'],
      'B4 苑/楼栋/宿舍由 dormKey 解析（展示口径 §3；D8 裁决默认东苑）');
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
    t.eq(formModel.serviceOptionsOf(CONFIG, PARTNER).map((item) => item.code), ['PICKUP_STD', 'PICKUP_LOW'],
      'D1 服务类型只列本人已启用（未启用 DROP_OFF 不出现；D41 新目录，§6/§8）');
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
    const boundPayload = payloadModel.buildPayload(bound);
    t.eq([boundPayload.ok, boundPayload.batch], [true, false], 'D9 单件已绑定路径 → order.create');
    t.eq([boundPayload.data.bindingId, 'guest' in boundPayload.data, boundPayload.data.serviceCode],
      ['b1', false, 'PICKUP_STD'], 'D10 已绑定路径带 bindingId、不带 guest（二选一）');
    t.eq(boundPayload.data.parcels, [{
      pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785',
      stationId: 'P4', stationName: stations.stationNameOf('P4')
    }], 'D11 parcels[]：单件也是数组（v1.0 单入口，不再 parcel{}）');
    t.eq(boundPayload.data.appoint, { type: 'ASAP' }, 'D12 预约 ASAP 只带 type（不带时段起止）');
    const guest = guestState();
    t.eq(formModel.validate(guest), '', 'D13 新顾客路径合法基线可提交（先合法基线）');
    const guestPayload = payloadModel.buildPayload(guest);
    t.eq([guestPayload.batch, 'bindingId' in guestPayload.data], [false, false],
      'D14 新顾客路径不带 bindingId（二选一）');
    t.eq(guestPayload.data.guest, {
      displayName: '小张', phoneTail: '6678', zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522'
    }, 'D15 guest 快照：dormKey 端侧拼装、楼栋归一为数字（送达要用）');
    t.eq(Object.keys(guestPayload.data).filter((key) => key === 'bindingId' || key === 'guest').length, 1,
      'D16 两份 payload 都只有顾客身份键之一（bindingId XOR guest）');
    const batchFile = ticketFile(1);
    const batchState = mutate(bound, {
      items: [
        parcelOf({ pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785' }),
        parcelOf({ pickupCode: '27-2-7017' })
      ],
      files: [batchFile]
    });
    const batch = payloadModel.buildPayload(batchState);
    t.check(batch.ok && batch.batch === false && batch.data.parcels.length === 2 && !('items' in batch.data),
      'D17 一图多码（2 件）→ 同一 order.create 的 parcels[]（createBatch 移除）');
    t.eq([batch.data.images, batch.data.tickets, batch.data.bindingId],
      [[{ fileId: batchFile.fileId }], [batchFile.uploadTicketId], 'b1'],
      'D18 顶层 images[]/tickets[] 与 bindingId 同单提交（一单多包裹）');
    t.eq(batch.data.parcels[1].pickupCode, '27-2-7017', 'D19 逐件 parcel 独立（不合并成一条）');
    const guestBatch = payloadModel.buildPayload(mutate(guestState(), {
      items: [parcelOf({ pickupCode: '1-1-1' }), parcelOf({ pickupCode: '2-2-2' })]
    }));
    t.check(guestBatch.data.parcels.length === 2 && guestBatch.data.guest.dormKey === 'D4-522',
      'D20 新顾客多件：guest 顶层快照 + parcels 逐件（不再 items[i].guest）');
    t.check(!('bindingId' in guestBatch.data), 'D21 新顾客路径不带 bindingId（互斥）');
    t.eq(formModel.BATCH_MAX, 10, 'D22 单次一图多码上限 = 10（CONTRACT D23：一单 1~10 件）');
    t.eq(formModel.validate(mutate(bound, {
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((index) => parcelOf({ pickupCode: '码' + index }))
    })), '一单最多 10 件，请分单', 'D23 超过 10 件被挡（不拆单不静默丢件；件数上限文案单源 formModel.PARCEL_LIMIT_TEXT）');
    const goodSignature = payloadModel.contentSignature(bound);
    const reused = formModel.ensureRequestKey({ clientRequestId: 'REQ_ABCDEFGHIJKLMNOP', signature: goodSignature },
      goodSignature, { makeId: () => 'NEW_ID_1234567890', isValid: () => true });
    t.eq(reused.clientRequestId, 'REQ_ABCDEFGHIJKLMNOP', 'D24 同内容重试复用同一幂等键（失败重试不重复建单）');
    const regenerated = formModel.ensureRequestKey({ clientRequestId: 'REQ_ABCDEFGHIJKLMNOP', signature: goodSignature },
      payloadModel.contentSignature(mutate(bound, { note: '换了备注' })), { makeId: () => 'NEW_ID_1234567890', isValid: () => true });
    t.eq(regenerated.clientRequestId, 'NEW_ID_1234567890', 'D25 内容变化重新生成幂等键（旧键不复用）');
    const invalidOld = formModel.ensureRequestKey({ clientRequestId: 'bad', signature: goodSignature }, goodSignature,
      { makeId: () => 'NEW_ID_1234567890', isValid: () => false });
    t.eq(invalidOld.clientRequestId, 'NEW_ID_1234567890', 'D26 旧键非法也重新生成（不把非法键发给服务端）');
    t.check(payloadModel.contentSignature(bound) === payloadModel.contentSignature(mutate(bound, {})),
      'D27 同内容签名稳定（不因对象引用变化换键）');
    const seedItem = Object.assign(formModel.emptyParcel(1), { pickupCode: '手填码' });
    const recognition = recognizeModel.mergeRecognizedItems(mutate(bound, { items: [seedItem] }),
      [{ pickupCode: 'AI码', lockerNo: '5 号柜', trackingTail: '12345', stationId: 'P6', imageIndex: 0 }]);
    t.eq([recognition.items[0].pickupCode, recognition.items[0].lockerNo, recognition.items[0].trackingTail],
      ['手填码', '', ''], 'D28 手填件不被识别结果覆盖（手填优先，只填空白件）');
    t.eq([recognition.items[1].pickupCode, recognition.items[1].lockerNo, recognition.items[1].stationId,
      recognition.items[1].stationIndex, recognition.items[1].imageIndex],
    ['AI码', '5 号柜', 'P6', 5, 0], 'D29 识别到的站点命中 P1~P8 才写入；imageIndex 指向来源图');
    t.eq(recognizeModel.recognitionTextOf({ filled: recognition.filled }).indexOf('已按截图预填'), 0,
      'D30 预填提示「已按截图预填，请核对（以手填为准）」');
    const failedText = recognizeModel.recognitionTextOf({ filled: 0, failed: 1, failureId: 'F-100' });
    t.check(failedText.indexOf('已反馈开发者复核') > 0,
      'D31 识别失败静默降级：提示已反馈复核（不阻塞手填）');
    const singleResult = resultModel.buildResult({ orderNo: '20261022-0031' }, { customerMode: 'BOUND' });
    t.check(singleResult.visible && singleResult.rows.length === 1 && singleResult.rows[0].orderNo === '20261022-0031'
      && singleResult.title === '订单已提交', 'D32 结果块：单件列出 orderNo/可点（§3.4 成功先出结果块）');
    const guestResult = resultModel.buildResult({ orderNo: '20261022-0032' }, { customerMode: 'GUEST' });
    t.check(guestResult.hintLines.length === 4
      && guestResult.hintLines.join('').indexOf('未绑定') >= 0
      && guestResult.hintLines.join('').indexOf('自动完成') >= 0,
    'D33 guest 成功必须展示未绑定/线下告知/自动完成提示块（§3.4）');
    const guestLate = resultModel.buildResult({ orderNo: '20261022-0033' },
      { customerMode: 'GUEST', config: { autoCompleteAt: '22:30' } });
    t.check(guestLate.hintLines.length === 4 && guestLate.hintLines[3].indexOf('每天 22:30 自动完成') >= 0
      && guestLate.hintLines.join('').indexOf('23:50') < 0,
    'D33b guest 提示块自动完成时刻随公开配置 config.autoCompleteAt（TD-083：22:30 不再写死 23:50）');
    const guestDefault = resultModel.buildResult({ orderNo: '20261022-0034' },
      { customerMode: 'GUEST', config: { autoCompleteAt: '25:99' } });
    t.check(guestDefault.hintLines[3].indexOf('每天 22:00 自动完成') >= 0,
      'D33c 配置缺失/非法（25:99）回退出厂默认 22:00（D51；config/defaults 唯一默认）');
    const oneOrderResult = resultModel.buildResult({ orderNo: '20261022-0031', parcels: [{}, {}, {}] }, { customerMode: 'BOUND' });
    t.check(oneOrderResult.rows.length === 1 && oneOrderResult.title === '订单已提交'
      && oneOrderResult.rows[0].label === '点开查看进度',
    'D34 多包裹仍是 1 张订单结果块（v1.0 一单多包裹，不拆 N 单）');
    const duplicateResult = resultModel.buildResult({ duplicated: true, orderNo: '20261022-0031' }, { customerMode: 'GUEST' });
    t.check(duplicateResult.visible && duplicateResult.duplicateText.indexOf('不会重复建单') >= 0,
      'D35 重复提交（幂等命中）给出说明，不报错也不重复建单');
    const appointState = formModel.createAppointState(NOW);
    t.eq([appointState.type, appointState.date, appointState.time], ['ASAP', '2026-10-22', '12:00'],
      'D36 代客预约默认尽快（D47：预约与顾客下单同模型，预选值就绪）');
    const latestAppoint = formModel.appointPatchWithType({ appoint: appointState }, 'LATEST', NOW).appoint;
    t.eq([latestAppoint.type, latestAppoint.latestText, formModel.appointViewOf({ appoint: latestAppoint }).appointText],
      ['LATEST', '最晚 10月22日 12:00', '最晚 10月22日 12:00'],
      'D36b 代客切换「最晚时间」→ 摘要「最晚 M月D日 HH:MM」（与顾客端同文案）');
    t.eq(formModel.appointPayloadOf({ appoint: latestAppoint }),
      { type: 'LATEST', latestAt: '2026-10-22T12:00:00+08:00' },
      'D36c 代客载荷 appoint={type:LATEST, latestAt:ISO+08:00}（服务端再按 now 收紧）');
    t.eq(formModel.appointSignatureOf({ appoint: latestAppoint })
      !== formModel.appointSignatureOf({ appoint: appointState }), true,
    'D36d 预约变化进代客幂等签名（换键不吞新内容）');
    const staleAppoint = formModel.appointPatchWithDate({ appoint: latestAppoint }, '2026-10-01', NOW).appoint;
    t.check(formModel.validate(mutate(bound, { appoint: staleAppoint })).indexOf('30 分钟') >= 0,
      'D36e 过去的最晚时间 → 代客提交前拦截并给人话（服务端仍唯一权威）');
    const appointXml = textOfRel('pkg-partner/pages/create-on-behalf/index.wxml');
    t.check(/onAppointType/.test(appointXml) && /onAppointDate/.test(appointXml)
      && /onAppointTime/.test(appointXml) && /onAppointPreset/.test(appointXml)
      && /最晚时间/.test(appointXml) && appointXml.indexOf('value="SLOT"') < 0,
    'D36f 代客下单 UI：尽快/最晚时间 + 日期/时间/预设，SLOT 不可新选（D47）');
    t.eq(formModel.failureText({ code: 'PARTNER_CLOSED' }), '接单已关闭，暂时不能下单；已有订单不受影响。',
      'D37 PARTNER_CLOSED 人话（§3.4/§10）');
    t.eq(formModel.failureText({ code: 'VALIDATION_FAILED', message: '运单尾号必须是 5 位数字' }), '运单尾号必须是 5 位数字',
      'D38 VALIDATION_FAILED 保留服务端字段级人话（不换空话）');
    t.eq([formModel.failureText({ code: 'RATE_LIMITED' }), formModel.failureText({ code: 'INTERNAL_ERROR' })],
      [errorCopy.CODE_COPY.RATE_LIMITED, errorCopy.CODE_COPY.INTERNAL_ERROR],
      'D39 其余 13 码统一取 shared/error-copy（错误码不暴露给用户）');
    t.eq(formModel.failureText({ code: 'TEAPOT' }), errorCopy.UNKNOWN_CODE_COPY, 'D40 未登记码回退 UNKNOWN_CODE_COPY');
    const manualPayload = payloadModel.buildPayload(mutate(guestState(), { files: [] }));
    t.check(manualPayload.data.manualEntry === true && !('images' in manualPayload.data)
      && !('tickets' in manualPayload.data), 'D41 无截图手填（D24）：manualEntry=true 且 images/tickets 缺省');
    const imagePayload = payloadModel.buildPayload(guestState());
    t.check(imagePayload.data.manualEntry === false && imagePayload.data.images.length === 1
      && imagePayload.data.tickets[0] === ticketFile(1).uploadTicketId,
    'D42 有截图：manualEntry=false + images[]/tickets[] 成对（多图 0~10，D44）');
    t.eq(manualPayload.data.delivery, {
      zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4',
      recipientName: '小张', phoneTail: '6678'
    }, 'D43 代客单 delivery（D25）：本单地址=guest 快照（含收件人），不写回顾客资料');
    t.check(!('delivery' in boundPayload.data), 'D44 已绑定路径不传 delivery（服务端按下单人宿舍默认）');
    const failPayload = payloadModel.buildPayload(mutate(bound, {
      items: [Object.assign(parcelOf({ pickupCode: '27-2-7016' }), { failureId: 'F-9' })]
    }));
    t.eq(failPayload.data.parcels[0].failureId, 'F-9', 'D45 识别失败件关联 failureId（逐件回填，首件）');
    const createPage = textOfRel('pkg-partner/pages/create-on-behalf/index.js');
    t.check(createPage.indexOf('payloadModel.buildPayload') >= 0 && createPage.indexOf('orderApi.createBatch') === -1,
      'D46 页面接线到 v1.0 单入口（order.create），不再 createBatch');
    const resultSrc = textOfRel('pkg-partner/pages/create-on-behalf/parts/result-model.js');
    t.check(createPage.indexOf('config: this.config') >= 0
      && resultSrc.indexOf('DEFAULT_CONFIG.autoCompleteAt') >= 0 && resultSrc.indexOf('23:50') < 0,
    'D46b 结果块接线：页面注入公开配置、纯件零时刻字面量（D43/TD-083 单源 config/defaults）');
    t.notEmpty(boundPayload.data.parcels[0].pickupCode, 'D 组样本非空（防止空集全绿）');
  });
  // ------------------------------------------------------------------ E 字段校验矩阵
  h.section('E. 字段校验矩阵：站点/码/尾号/柜号/备注/dormKey/服务启用（§3.4 字段校验）', (t) => {
    t.eq(stations.listStations().map((item) => item.id), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
      'E1 站点值域恰为 P1~P8（复用 shared/stations，不自建）');
    const stationOptions = formModel.stationOptionsOf();
    t.check(stationOptions.length === stations.STATION_COUNT
      && stationOptions.every((item) => stations.isStationId(item.id)),
    'E2 站点 picker 恰为 P1~P8 全部可选（D44 去「暂不指定」：每件必须选站点）');
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
    t.eq(formModel.validate(mutate(boundState(), { items: [parcelOf({})] })),
      '至少填取件码或运单尾号，两者都空无法建单', 'E10 码与尾号都空不可提交（§3.4）');
    t.eq(formModel.validate(mutate(boundState(), { items: [parcelOf({ pickupCode: 'A'.repeat(41) })] })),
      '取件码最多 40 字', 'E11 取件码 ≤40（与 order-edit 上限同源）');
    t.eq(formModel.validate(mutate(boundState(), { items: [parcelOf({ pickupCode: '码', lockerNo: 'X'.repeat(11) })] })),
      '柜号最多 10 字', 'E12 柜号 ≤10');
    t.eq(formModel.validate(mutate(boundState(), { items: [parcelOf({ pickupCode: '码', trackingTail: '1234' })] })),
      '运单尾号必须是 5 位数字', 'E13 运单尾号恰 5 位数字');
    t.eq(formModel.validate(mutate(boundState(), { note: '备'.repeat(201) })), '备注最多 200 字',
      'E14 备注 ≤200 字（不静默截断）');
    t.eq(formModel.validate(mutate(boundState(), { files: [{ fileId: 'cloud://x.jpg' }] })),
      '截图票据缺失，请重新选择截图', 'E15 截图 fileId 与 ticket 必须成对（不拿半套参数提交）');
    const badStation = mutate(boundState(), {
      items: [Object.assign(parcelOf({ pickupCode: '码' }), { stationId: 'P9' })]
    });
    t.eq(formModel.validate(badStation), '请选择驿站站点', 'E16 非 P1~P8 站点被挡（D44 逐件站点值域不放宽）');
    t.eq(formModel.validateParcel({ pickupCode: '', lockerNo: '', trackingTail: '12345' }, 1),
      '', 'E17 逐件校验：只有尾号也合法（NEED_CODE 机制）');
    t.eq(formModel.validateParcel({ pickupCode: '码', lockerNo: '', trackingTail: '1234' }, 1),
      '第 2 件：运单尾号必须是 5 位数字', 'E18 批量逐件错误带件号（用户知道改哪一条）');
  });
  // ------------------------------------------------------------------ N D44 站点按件/多图/识别预填
  h.section('N. D44 代客下单：站点按件继承/逐件必填/多图 0~10/识别预填按件拆/校验回正确步骤', (t) => {
    const createWxml = textOfRel('pkg-partner/pages/create-on-behalf/index.wxml');
    const createPage = textOfRel('pkg-partner/pages/create-on-behalf/index.js');
    const formSrc = textOfRel('pkg-partner/pages/create-on-behalf/parts/form-model.js');
    const blankStation = Object.assign(parcelOf({ pickupCode: '27-2-7017' }), { stationId: '', stationName: '', stationIndex: 0, stationTouched: false });
    const twoItems = mutate(boundState(), { items: [parcelOf({ pickupCode: '27-2-7016' }), blankStation] });
    t.eq(formModel.validateDetailed(twoItems), { message: '第 2 件：请选择驿站站点', step: formModel.STEP_PARCELS },
      'N1 第二件未选站点被拦（D44 逐件必填；失败步骤=取件信息，旧实现一律跳第 1 步）');
    const options = formModel.stationOptionsOf();
    const chosenTwo = Object.assign({}, twoItems, formModel.applyItemStation(twoItems, 1, formModel.stationIndexOf(options, 'P6')));
    t.eq(formModel.validateDetailed(chosenTwo), { message: '', step: 0 }, 'N2 两件各选站点后可提交（站点按件，不再整单同站）');
    t.eq(payloadModel.buildPayload(chosenTwo).data.parcels.map((row) => [row.stationId, row.stationName]),
      [['P4', stations.stationNameOf('P4')], ['P6', stations.stationNameOf('P6')]],
      'N3 payload 逐件输出各自 stationId/stationName（旧实现把页面级 currentStation 复制给每件）');
    t.eq(chosenTwo.items.map((item) => item.stationIndex),
      [formModel.stationIndexOf(options, 'P4'), formModel.stationIndexOf(options, 'P6')],
      'N3b 每件 picker 回显各自站点下标（stationIndex 取站点值域下标，不是件下标）');
    const inheritState = mutate(boundState(), { items: [
      parcelOf({ pickupCode: '1' }),
      Object.assign(parcelOf({ pickupCode: '2' }), { stationTouched: false }),
      parcelOf({ pickupCode: '3', stationId: 'P6' })
    ] });
    t.eq(formModel.applyItemStation(inheritState, 0, formModel.stationIndexOf(options, 'P5')).items.map((item) => item.stationId),
      ['P5', 'P5', 'P6'], 'N4 首件站点变化：未单独改过的后续件继承，单独改过的件不被覆盖');
    const appended = formModel.appendParcel(mutate(boundState(), { items: [parcelOf({ pickupCode: '1', stationId: 'P8' })] }));
    t.eq([appended.items.length, appended.items[1].stationId, appended.items[1].key !== appended.items[0].key],
      [2, 'P8', true], 'N5 再填一件默认继承首件站点 + 稳定 key（可逐件改）');
    t.check(/wx:for="\{\{items\}\}" wx:key="key"/.test(createWxml) && createWxml.indexOf('wx:key="index"') < 0,
      'N6 逐件列表 wx:key 用稳定 key（不用 index：删除中间件视图会错位）');
    t.check((createWxml.match(/onItemStationChange/g) || []).length === 1 && /data-index="\{\{index\}\}"/.test(createWxml)
      && createPage.indexOf('onItemStationChange') >= 0 && createPage.indexOf('dataset.index') >= 0
      && createWxml.indexOf('disabled="\{\{readonly\}\}"') >= 0,
    'N7 每件站点 picker：data-index 逐件写 + readonly 置灰 + 事件接线（页面零判据）');
    t.check([fsutil.stripComments(createPage), fsutil.stripComments(formSrc), createWxml].join(' ').indexOf('暂不指定') < 0,
      'N8 去「暂不指定」默认值（服务端逐件必填，旧默认值=必然提交失败）');
    t.eq([formModel.validateDetailed(mutate(guestState(), { guest: {} })).step,
      formModel.validateDetailed(twoItems).step,
      formModel.validateDetailed(mutate(boundState(), { note: '备'.repeat(201) })).step,
      formModel.validateDetailed(mutate(boundState(), { services: [] })).step],
    [formModel.STEP_CUSTOMER, formModel.STEP_PARCELS, formModel.STEP_SERVICE, formModel.STEP_SERVICE],
    'N9 本地校验失败回正确步骤（顾客=1 / 件与站点=2 / 服务与备注=3）');
    t.notEmpty(payloadModel.buildPayload(boundState()).data.parcels, 'N 组样本非空（防止空集全绿）');
  });
  // ------------------------------------------------------------------ G 静态纪律
  h.section('G. 静态纪律：页面零判据/零绑定入口/零金额/行数/四件套（§2 铁律、门禁 #18/#21/#22/#28）', (t) => {
    const layerBad = [];
    PAGE_SCRIPTS.forEach((rel) => {
      const code = fsutil.stripComments(textOfRel(rel));
      if (/wx\.cloud\./.test(code)) layerBad.push(rel + ':wx.cloud');
      if (/Math\.random|\brandom\(/.test(code)) layerBad.push(rel + ':random');
      STATUS_LITERALS.forEach((status) => {
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
    const createModel = textOfRel('pkg-partner/pages/create-on-behalf/parts/payload-model.js');
    t.check(createModel.indexOf('data.bindingId = binding.bindingId') >= 0 && createModel.indexOf('data.guest = guest') >= 0
      && createModel.indexOf('parcels: parcels') >= 0,
    'G7 代客单 v1.0 请求体单源：bindingId / guest 互斥 + parcels[] 落在一处（parts/payload-model）');
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
    t.check(fsutil.countLines(path.join(ROOT, 'tools/selftest-partner-pages.js')) <= 950
      && fsutil.countLines(path.join(ROOT, 'tools/lib/partner-pages-cases.js')) <= 950,
    'G15 本测试文件与 tools/lib/partner-pages-cases.js 均 ≤950 行（#18 测试档 + 本批拆件预算）');
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
  // ------------------------------------------------------------------ H 激活页邀请码输入回显
  h.section('H. 激活页邀请码输入：逐字符回显不清空/归一/分组/提交闸（UX_PARTNER §3.1/§3.2）', (t) => {
    t.eq(codeInput.stateOfInput('A'), { codeRaw: 'A', codeDisplay: 'A' },
      'H1 输入 1 个字符就保留回显（回归：不得因未满 12 位清空输入框）');
    t.eq(codeInput.stateOfInput(''), { codeRaw: '', codeDisplay: '' }, 'H2 空输入回显空串且不报错');
    t.eq(codeInput.stateOfInput('abcd-2345-efgh'), { codeRaw: 'ABCD2345EFGH', codeDisplay: 'ABCD-2345-EFGH' },
      'H3 小写+连字符输入即归一为大写 12 位并 4 位分组回显');
    t.eq(codeInput.stateOfInput(' ＡＢＣＤ－２３４５－ＥＦＧＨ ').codeDisplay, 'ABCD-2345-EFGH',
      'H4 全角字母/数字/连字符与空格一并归一（粘贴微信里的全角码也能用）');
    t.eq(codeInput.stateOfInput('ABCD2345EFGHXYZ'), { codeRaw: 'ABCD2345EFGH', codeDisplay: 'ABCD-2345-EFGH' },
      'H5 超过 12 位截断（回显不会超过输入框 14 字符上限）');
    t.eq(codeInput.stateOfInput('ABCDE').codeDisplay, 'ABCD-E', 'H6 半截输入按 4 位分组（ABCDE → ABCD-E）');
    t.eq(['A', 'AB', 'ABC', 'ABCD', 'ABCDE'].map((v) => codeInput.stateOfInput(v).codeRaw), ['A', 'AB', 'ABC', 'ABCD', 'ABCDE'],
      'H7 逐字符输入任意前缀都原样保留（不清空/不回退）');
    t.eq([codeInput.isValid('ABCD2345EFG'), codeInput.isValid('ABCD2345EFGH'), codeInput.isValid('ABCD2345EFGI')],
      [false, true, false], 'H8 提交闸：未满 12 位/含字母表外字符（I）不通过，满 12 位合法码通过');
    const activateSrc = textOfRel('pkg-partner/pages/activate/index.js');
    t.check(activateSrc.indexOf("'./parts/code-input-model'") >= 0
      && activateSrc.indexOf('codeInput.stateOfInput') >= 0
      && activateSrc.indexOf('validateInvitationCode') < 0,
    'H9 激活页回显接线到纯件：不再用整串校验读 canonical（真实缺陷回归闸）');
  });
  // ------------------------------------------------------------------ I 代客下单三项缺陷回归
  h.section('I. 代客下单缺陷回归：预约预选过滤已过时刻/SLOT 降级/识别兜底入口/预置顾客不猜（M-35/M-41/M-42/D47）', (t) => {
    const noon = new Date(2026, 9, 22, 13, 30, 0).getTime();
    const dusk = new Date(2026, 9, 22, 20, 30, 0).getTime();
    const night = new Date(2026, 9, 22, 22, 30, 0).getTime();
    const noonState = formModel.createAppointState(noon);
    t.eq([noonState.type, noonState.dateText, noonState.time], ['ASAP', '今天', '18:00'],
      'I1 预约默认尽快；最晚时间预选过滤已过时刻（13:30 → 今天 18:00，30 分钟粒度）');
    const duskState = formModel.createAppointState(dusk);
    t.eq([duskState.dateText, duskState.time], ['今天', '22:00'], 'I2 20:30 → 今天 22:00（当天更早预设已过）');
    const nightState = formModel.createAppointState(night);
    t.eq([nightState.dateText, nightState.time], ['明天', '12:00'],
      'I3 22:30 当天预设全过 → 自动顺延到明天最近预设（不构造已过时刻）');
    t.eq(noonState.notice, '', 'I4 正常单选「尽快」不显示降级提示（不打扰）');
    t.check(formModel.createAppointState(night, 'SLOT').notice.indexOf('最晚时间') >= 0,
      'I5 历史 SLOT 预填 → 降级「尽快」并提示（D47 新单不可选 SLOT）');
    const createPage = textOfRel('pkg-partner/pages/create-on-behalf/index.js');
    const createWxml = textOfRel('pkg-partner/pages/create-on-behalf/index.wxml');
    t.check(createPage.indexOf('serverNowMs()') >= 0 && createWxml.indexOf('appointNotice') >= 0,
      'I6 页面按 store.serverTimeSkew 校时并渲染预约提示（不用设备钟过滤）');
    const presetFound = presetModel.applyPresetBinding(
      formModel.createInitialState({ config: CONFIG, partner: PARTNER, bindingList: [ROW_1, ROW_2], nowMs: NOW }), 'b2');
    t.eq([presetFound.customerMode, presetFound.bindingIndex, presetFound.presetMiss], ['BOUND', 1, false],
      'I7 ?bindingId= 命中时选中该档案（不再默认第 0 位）');
    const presetMiss = presetModel.applyPresetBinding(
      formModel.createInitialState({ config: CONFIG, partner: PARTNER, bindingList: [ROW_1], nowMs: NOW }), 'b-not-in-window');
    t.eq([presetMiss.bindingIndex, presetMiss.presetMiss, formModel.currentBinding(presetMiss)], [-1, true, null],
      'I8 ?bindingId= 不在 50 条窗口内 → 不猜、不默认选中第 0 位（bindingIndex=-1）');
    t.eq(formModel.validate(presetMiss), '请选择一位已绑定的顾客', 'I9 预置未命中的表单不可提交（拦住错误顾客建单）');
    const noPreset = formModel.createInitialState({ config: CONFIG, partner: PARTNER, bindingList: [ROW_1], nowMs: NOW });
    t.eq([presetModel.applyPresetBinding(noPreset, '') === noPreset, noPreset.presetMiss], [true, false],
      'I10 无 ?bindingId= 时不改默认路径（普通入口不受影响）');
    t.check(createPage.indexOf("'./parts/preset-model'") >= 0 && createPage.indexOf('presetModel.applyPresetBinding') >= 0
      && createWxml.indexOf('presetMiss') >= 0, 'I11 页面接线到预置纯件并在 WXML 给「请选择顾客」态');
    const recognizeFlowSrc = textOfRel('pkg-partner/pages/create-on-behalf/parts/recognize-flow.js');
    t.check(recognizeFlowSrc.indexOf('aiApi.parseParcel') >= 0 && recognizeFlowSrc.indexOf('uploadTicketId') >= 0
      && recognizeFlowSrc.indexOf("role: 'PARTNER'") >= 0,
    'I12 识别兜底按 D23/C2：NO_TEXT 不外呼但服务端入复核队列（识别零件逐图带 uploadTicketId/fileId）');
    t.check(createPage.indexOf('recognizeFlow.identifyFiles') >= 0 && createWxml.indexOf('反馈开发者复核') >= 0
      && createWxml.indexOf('手填优先') >= 0 && createWxml.indexOf('识别失败兜底') === -1,
    'I13 选图自动识别接线 + 入口文案「反馈开发者复核」+ 手填优先（不再叫识别失败兜底）');
  });
  // ------------------------------------------------------------------ J 服务类型目录（D41）
  h.section('J. 服务类型目录 D41：新 5 类/停用 PICKUP_DOOR 灰显不可选/保存载荷只含目录内 code', (t) => {
    const rows = serviceSettingsModel.rowsOf(CONFIG.serviceCatalog, [
      { code: 'PICKUP_STD', enabled: true },
      { code: 'PICKUP_LOW', enabled: false },
      { code: 'PICKUP_DOOR', enabled: true }
    ]);
    t.eq(rows.map((item) => item.code),
      ['PICKUP_STD', 'PICKUP_LOW', 'PICKUP_URGENT', 'DROP_OFF', 'CUSTOM', 'PICKUP_DOOR'],
      'J1 目录固定 5 类（新顺序，CUSTOM 末项）+ 旧配置里的停用类型排最后');
    t.check(rows[0].desc.indexOf('寝室门口') >= 0 && rows[1].desc.indexOf('楼下') >= 0,
      'J2 D41 说明区分两档：标准代取=送到寝室门口，送至楼下=宿舍楼下/约定地点');
    t.eq([rows[5].name, rows[5].desc, rows[5].enabled, rows[5].legacy],
      ['送寝上门（已停用）', serviceSettingsModel.LEGACY_DESC, false, true],
      'J3 停用 PICKUP_DOOR：历史展示名、灰显、不启用');
    t.eq(serviceSettingsModel.toggleRow(rows, 5), null,
      'J4 停用类型不可勾选（toggle 返回 null，不报错、不改数据）');
    t.eq(serviceSettingsModel.toggleRow(rows, 1).map((item) => item.enabled),
      [true, true, false, false, false, false], 'J5 目录内类型可正常勾选（LOW 反转）');
    t.eq(serviceSettingsModel.buildPayload(rows).services,
      [{ code: 'PICKUP_STD', enabled: true }, { code: 'PICKUP_LOW', enabled: false },
        { code: 'PICKUP_URGENT', enabled: false }, { code: 'DROP_OFF', enabled: false },
        { code: 'CUSTOM', enabled: false }],
      'J6 保存载荷只含目录内 5 类 code（停用 PICKUP_DOOR 不提交）');
    t.check(serviceSettingsModel.hasLegacy(rows) === true, 'J7 有停用历史类型时页面给说明条');
    const legacyRows = serviceSettingsModel.catalogRowsOf([
      { code: 'PICKUP_STD', name: '标准代取', desc: '驿站取件送到宿舍楼下/约定地点' },
      { code: 'PICKUP_DOOR', name: '送寝上门', desc: '送到寝室门口（上楼）' },
      { code: 'DROP_OFF', name: '代寄快递', desc: '顾客把件交给兼职，兼职送驿站寄出' }
    ]);
    t.eq(legacyRows.map((item) => item.code), enums.SERVICE_CODES.slice(),
      'J8 旧目录整表回退新 5 类（不把旧目录原样渲染）');
    t.check(legacyRows[0].desc.indexOf('寝室门口') >= 0,
      'J9 旧目录回退后标准代取说明为新语义（不是旧的楼下说明）');
    const servicePageJs = textOfRel('pkg-partner/pages/service-settings/index.js');
    const servicePageWxml = textOfRel('pkg-partner/pages/service-settings/index.wxml');
    t.check(servicePageJs.indexOf("'./parts/service-model'") >= 0
      && servicePageWxml.indexOf('service-row-disabled') >= 0 && servicePageWxml.indexOf('hasLegacy') >= 0,
    'J10 服务设置页接线行模型：停用类型灰显且不可勾选（页面不另写判据）');
    t.check(servicePageJs.indexOf('store.patch({ partner: partner })') >= 0,
      'J11 保存后回写 store 用 patch（set 是 (key,value)，误用会写 [object Object] 键且 partner 不更新）');
  });
  // ------------------------------------------------------------------ K D42/task-20 兼职看绑定顾客头像
  h.section('K. D42/task-20 兼职看绑定顾客头像：src 优先/retry 接线/fileId 回退/file-id 零命中/激活页预览', (t) => {
    // K1/K2 行模型：服务端随 DTO 下发 avatarUrl（src 优先），未签发回落空串（avatar-view 再退默认头像）
    const signedRows = listModel.attachAvatarUrls(
      customerView.buildListRows([ROW_1, ROW_2]),
      [Object.assign({}, ROW_1, { avatarUrl: 'https://tmp.example/c.jpg' }), ROW_2]
    );
    t.eq([signedRows[0].avatarUrl, signedRows[1].avatarUrl], ['https://tmp.example/c.jpg', ''],
      'K1 客户列表行：avatarUrl 按 bindingId 透传；未签发=空串（src 优先/fileId 回退）');
    const avatarState = listModel.applyResponse(listModel.createState(),
      { list: [Object.assign({}, ROW_1, { avatarUrl: 'https://tmp.example/c.jpg' })], nextCursor: null }, { nowMs: NOW });
    t.eq(avatarState.rows[0].avatarUrl, 'https://tmp.example/c.jpg',
      'K2 applyResponse 后行保留服务端 avatarUrl（首屏/下拉/触底同一装配）');
    const customersWxml = textOfRel('pages/partner/customers/index.wxml');
    t.check(customersWxml.indexOf('src="{{item.avatarUrl}}"') >= 0
      && customersWxml.indexOf('fileId="{{item.avatarFileId}}"') >= 0
      && customersWxml.indexOf('bindretry="onAvatarRetry"') >= 0,
    'K3 客户列表 WXML：头像 src 优先 + fileId 回退 + 失败可点重签（retry）');
    t.check(textOfRel('pages/partner/customers/index.js').indexOf('onAvatarRetry()') >= 0,
      'K4 客户列表页：retry 事件接线到重拉（服务端重签 5 分钟 URL）');
    t.eq(detailView.identityOf(Object.assign({}, ROW_1, { avatarUrl: 'https://tmp.example/c.jpg' })).avatarUrl,
      'https://tmp.example/c.jpg',
      'K5 顾客详情视图：身份行 avatarUrl 取服务端临时 URL（avatarFileId 保留回退）');
    const detailJs = textOfRel('pkg-partner/pages/customer-detail/index.js');
    const avatarRefreshJs = textOfRel('pkg-partner/pages/customer-detail/parts/avatar-refresh.js');
    t.check(textOfRel('pkg-partner/pages/customer-detail/index.wxml').indexOf('src="{{view.avatarUrl}}"') >= 0
      && textOfRel('pkg-partner/pages/customer-detail/index.wxml').indexOf('bindretry="onAvatarRetry"') >= 0
      && detailJs.indexOf("require('./parts/avatar-refresh')") >= 0 && detailJs.indexOf('avatarRefresh.pullLatest(this)') >= 0
      && avatarRefreshJs.indexOf('partnerApi.getCustomer') >= 0 && avatarRefreshJs.indexOf("'view.avatarUrl'") >= 0
      && avatarRefreshJs.indexOf('orderApi') === -1,
    'K6 顾客详情：onShow/retry 只重签身份行头像（parts/avatar-refresh 单点，不重拉订单页）');
    const partnerOrderWxml = textOfRel('pkg-partner/pages/order-detail/index.wxml');
    const partnerOrderJs = textOfRel('pkg-partner/pages/order-detail/index.js');
    t.check(partnerOrderWxml.indexOf('src="{{order.counterpart.avatarUrl}}"') >= 0
      && partnerOrderWxml.indexOf('bindretry="onCounterpartAvatarRetry"') >= 0
      && partnerOrderJs.indexOf('onCounterpartAvatarRetry()') >= 0,
    'K7 兼职订单详情 counterpart（兼职→顾客）头像 src 优先 + retry 重拉 DTO');
    const activateWxml = textOfRel('pkg-partner/pages/activate/index.wxml');
    const activateJs = textOfRel('pkg-partner/pages/activate/index.js');
    t.check(activateWxml.indexOf('src="{{avatarPreview}}"') >= 0
      && activateWxml.indexOf('src="{{activated.avatarUrl || avatarPreview}}"') >= 0
      && activateJs.indexOf('avatarPreview: filePath') >= 0,
    'K8 激活页：选头像后本机临时路径预览（私有存储不直读 cloud://），结果块优先服务端临时 URL');
    t.check(activateJs.indexOf('userApi.avatarUrl()') >= 0 && activateJs.indexOf('refreshActivatedAvatar') >= 0
      && activateJs.indexOf("'activated.avatarUrl'") >= 0,
    'K9 激活成功页本人头像：经 user.avatarUrl 换 5 分钟临时 URL（失败保持默认头像位，不阻断激活结果）');
    const wxmlFiles = fsutil.walk(ROOT, { exts: new Set(['.wxml']) });
    const hyphenHits = wxmlFiles.filter((full) => fsutil.readText(full).indexOf('file-id=') >= 0).map((full) => fsutil.rel(full));
    t.eq(hyphenHits, [], 'K11 全仓 WXML 零 file-id= 驼峰写法（D42 fileId 单一写法；实际扫描 ' + wxmlFiles.length + ' 个文件）');
    const partnerWxmls = [
      'pages/partner/customers/index.wxml',
      'pkg-partner/pages/customer-detail/index.wxml',
      'pkg-partner/pages/order-detail/index.wxml',
      'pkg-partner/pages/activate/index.wxml'
    ];
    const noSrc = [];
    partnerWxmls.forEach((rel) => {
      const tags = textOfRel(rel).match(/<avatar-view[^>]*>/g) || [];
      tags.forEach((tag) => {
        if (tag.indexOf('fileId=') >= 0 && tag.indexOf('src=') < 0) noSrc.push(rel + ':' + tag.trim());
      });
    });
    t.eq(noSrc, [], 'K12 兼职端 avatar-view：凡传 fileId 必同时传 src（禁止直读 cloud:// 私有文件）');

    // TD-069：<image-picker> 自定义组件属性统一 kebab-case（max-count），与项目其它用法一致
    const camelAttrTagsOf = (text) => (String(text).match(/<image-picker[^>]*>/g) || [])
      .filter((tag) => tag.indexOf('maxCount=') >= 0);
    t.eq(camelAttrTagsOf('<image-picker purpose="TICKET" maxCount="{{1}}" />').length, 1,
      'K13 有牙正控：驼峰 maxCount= 属性样本被扫出（判据不是空转全绿）');
    const camelWxmlHits = wxmlFiles.filter((full) => camelAttrTagsOf(fsutil.readText(full)).length > 0)
      .map((full) => fsutil.rel(full));
    t.eq(camelWxmlHits, [], 'K14 全仓 WXML <image-picker> 零驼峰 maxCount= 属性（TD-069；实际扫描 '
      + wxmlFiles.length + ' 个文件）');
    t.check(textOfRel('pkg-partner/pages/create-on-behalf/index.wxml').indexOf('max-count="{{imageMax}}"') >= 0
      && /imageMax: formModel.IMAGE_MAX/.test(textOfRel('pkg-partner/pages/create-on-behalf/index.js')),
    'K15 代客下单页 kebab-case max-count="{{imageMax}}"（D44 多图 0~10；数值单源 formModel.IMAGE_MAX）');
    t.check(textOfRel('components/image-picker/index.js').indexOf('maxCount: { type: Number, value: 1 }') >= 0,
      'K16 组件仍声明 maxCount 属性且默认值=1（kebab-case 自动映射，显式传 1 行为不变）');
  });
  // ------------------------------------------------------------------ O TD-084 识别兜底/幂等粒度与提示收口
  h.section('O. TD-084 识别兜底/幂等粒度与提示：逐件 AI 兜底/幂等键按件/超限「请分单」/预约取请求时 serverNow', (t) => {
    const createPage = textOfRel('pkg-partner/pages/create-on-behalf/index.js');
    const flowSrc = textOfRel('pkg-partner/pages/create-on-behalf/parts/recognize-flow.js');
    const modelSrc = textOfRel('pkg-partner/pages/create-on-behalf/parts/recognize-model.js');
    const formSrc = textOfRel('pkg-partner/pages/create-on-behalf/parts/form-model.js');
    const payloadSrc = textOfRel('pkg-partner/pages/create-on-behalf/parts/payload-model.js');
    // ① 逐件兜底目标：缺码/缺站点才算，规则可用的件不外呼（AI 次数按件有界）
    const targets = [
      Object.assign(parcelOf({ pickupCode: '' }), { stationId: 'P4' }),
      parcelOf({ pickupCode: '27-2-7016', trackingTail: '66785' }),
      Object.assign(parcelOf({ pickupCode: '' }), { stationId: '', stationName: '', stationIndex: 0 })
    ];
    const indexes = recognizeModel.aiFallbackIndexesOf(targets);
    t.eq([indexes, targets.length], [[0, 2], 3],
      'O1 兜底目标逐件判定：只列缺站点/缺码件（规则已填好的件不外呼，外呼次数 ≤件数）');
    // ② 逐件兜底结果回写 + failureId 按件派生（同图多件不共键，DATA_MODEL §4.9）
    const calls = [
      { index: 0, value: { recognized: true, confidence: 'HIGH', source: 'DEEPSEEK', pickupCode: '207-3-1014', failureId: 'F-20261101-AAAAAA' } },
      { index: 2, value: { recognized: true, confidence: 'HIGH', source: 'DEEPSEEK', stationId: 'P6', pickupCode: '12345678', failureId: 'F-20261101-BBBBBB' } }
    ];
    const merged = recognizeModel.applyAiFallbacksOf(targets, calls);
    t.eq([merged.items[0].pickupCode, merged.items[2].pickupCode, merged.items[2].stationId],
      ['207-3-1014', '12345678', 'P6'], 'O2 同图多缺码件逐件兜底并各自回写到对应件（不再只回写第一件）');
    t.eq([merged.items[0].failureId, merged.items[2].failureId, merged.items[0].failureId !== merged.items[2].failureId],
      ['F-20261101-AAAAAA', 'F-20261101-BBBBBB', true],
      'O3 failureId 按件落（同图多件不共键；建单可按件关联各自复核记录）');
    t.eq([merged.items[1].pickupCode, merged.changed], ['27-2-7016', 2],
      'O4 规则已填好的件不被兜底改写；changed 只计实际回写件');
    const ticket = ticketFile(1).uploadTicketId;
    const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => recognizeModel.failureRequestIdOf(ticket, index, '取件码 207-3-1014'));
    t.eq(new Set(ids).size, 10,
      'O5 同图 10 件派生的入队幂等键两两不同（逐件各一条失败记录，服务端不按文本相似度合并）');
    // ③ 超限不静默丢件：合并达上限返回 overflow，用 formModel 唯一文案显式提示「请分单」
    const twelve = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seq) => ({ pickupCode: '27-2-70' + (10 + seq) }));
    const capped = recognizeModel.mergeRecognizedItems(mutate(boundState(), { items: [], parcelSeq: 0 }), twelve);
    t.eq([capped.items.length, capped.overflow], [10, 2], 'O6 识别结果超过 10 件：合并 10 件、overflow=2（不再静默丢弃）');
    t.eq([recognizeModel.recognitionTextOf({ filled: 0, overflow: capped.overflow }),
      recognizeModel.recognitionTextOf({ overflow: 1 })],
    [formModel.PARCEL_LIMIT_TEXT, formModel.PARCEL_LIMIT_TEXT],
    'O7 超限提示走 formModel.PARCEL_LIMIT_TEXT（文案单源，不造第二处字面量）');
    t.check(formModel.PARCEL_LIMIT_TEXT === '一单最多 10 件，请分单'
      && (modelSrc.match(/一单最多/g) || []).length === 0 && (createPage.match(/一单最多/g) || []).length === 0
      && formSrc.indexOf('PARCEL_LIMIT_TEXT =') >= 0,
    'O8 「一单最多 10 件，请分单」唯一字面量在 form-model（TD-084③ 文案单源）');
    t.eq(recognizeModel.recognitionTextOf({ filled: 2, overflow: 1 }),
      recognizeModel.PREFILL_TEXT + '；' + formModel.PARCEL_LIMIT_TEXT,
      'O9 有预填也有溢出：先请核对再提示分单（两个提示都不丢）');
    t.check(createPage.indexOf('overflow: merged.overflow') >= 0,
      'O10 页面把 overflow 交给提示文案（识别完成即显式告知，不静默）');
    // ④ 预约校验取「请求时」serverNow：旧快照放行 → 请求时拒绝
    const appointAt = Object.assign({}, formModel.createAppointState(NOW), { type: 'LATEST', date: '2026-10-22', time: '12:00' });
    const stalePass = formModel.validate(mutate(boundState(), { appoint: appointAt, nowMs: NOW }));
    const fresh = formModel.validateDetailed(mutate(boundState(), { appoint: appointAt, nowMs: NOW }),
      { nowMs: Date.parse('2026-10-22T12:30:00+08:00') });
    t.eq([stalePass, fresh.step, fresh.message.indexOf('30 分钟') >= 0], ['', formModel.STEP_SERVICE, true],
      'O11 旧 nowMs 快照放行、请求时 serverNow 拒绝（TD-084④ 反例：长停留不再先放行后被服务端拒）');
    const submitSrc = createPage.slice(createPage.indexOf('onSubmit()'));
    t.check(submitSrc.indexOf('payloadModel.buildPayload(this.state, { nowMs: serverNowMs() })') >= 0
      && payloadSrc.indexOf('validateDetailed(source, options)') >= 0
      && createPage.indexOf('serverTimeSkew') >= 0,
    'O12 页面提交时现取 serverNow（store.serverTimeSkew 校时），纯件按 options.nowMs 校验（不再用 onLoad 快照）');
    t.check(flowSrc.indexOf('recognizeModel.aiFallbackIndexesOf') >= 0 && flowSrc.indexOf('recognizeModel.applyAiFallbacksOf') >= 0
      && flowSrc.indexOf('failureRequestIdOf(textOf(file.uploadTicketId), itemIndex, maskedText)') >= 0
      && flowSrc.indexOf('failureId: one.failureId') < 0,
    'O13 识别编排接线：逐件兜底 + 幂等键按件下标派生 + 不再把整图 failureId 复制给每件');
    t.notEmpty(merged.items, 'O 组样本非空（防止空集全绿）');
  });
  // ------------------------------------------------------------------ P 批20-C 首屏流式/占位/排序置底
  h.section('P. 批20-C：客户页首屏 6 张灰占位/分片 setData/刷新行级 diff 沿用头像/空 dormKey 置底/底部安全区',
    (t) => cases.perfChecks(t));
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

      const payload = payloadModel.buildPayload(boundState());
      await orderApi.create(payload.data, { clientRequestId: 'REQ_ABCDEFGHIJKLMNOP' });
      t.eq([captured[3].action, captured[3].data.bindingId, captured[3].clientRequestId],
        ['order.create', 'b1', 'REQ_ABCDEFGHIJKLMNOP'], 'F6 已绑定代客单经 api 层透传 bindingId + 显式幂等键');
      const batchPayload = payloadModel.buildPayload(mutate(boundState(), {
        items: [parcelOf({ pickupCode: '27-2-7016' }), parcelOf({ pickupCode: '27-2-7017' })]
      }));
      await orderApi.create(batchPayload.data, { clientRequestId: 'REQ_ABCDEFGHIJKLMNOP' });
      t.eq([captured[4].action, captured[4].data.parcels.length], ['order.create', 2],
        'F7 多件经 api 层仍走 order.create（v1.0 一单多包裹；createBatch 移除）');

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
      t.eq([client.isWriteAction('order.create'), client.isWriteAction('order.createBatch'), typeof orderApi.createBatch],
        [true, false, 'undefined'],
        'F12 单入口：order.create 已登记写动作；order.createBatch 已移除（未登记、模块无导出）');

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
    }).path, '/pages/launch/index', 'F15 切换会话隐藏分享（回通用入口页分享，不外发他人页面）');
    const share = shareCard.buildShareMessage({ isCustomer: false, viewSession: false, partnerCard: { partnerNo: 'P8F3K2M' } });
    t.check(share.path === '/pages/launch/index?bind=P8F3K2M'
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
