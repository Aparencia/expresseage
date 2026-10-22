'use strict';
/**
 * tools/selftest-admin-pages.js — 批 8-T3「开发者后台端侧 11 页」断言套件（pkg-admin/**）。
 *
 * 覆盖：
 *   §0.3/§11.4/§11.5  五态文案纯件（网络/业务错误分流、无权限说明、空态区分）
 *   §3.1~§3.11        11 页视图模型：脱敏展示、状态标签、测试行「测试」标签、危险确认后果句、表单校验
 *   §5.2/§6.7         列表默认脱敏（服务端 DTO）与测试数据开关/标签口径
 *   §7.2~§7.5         治理动作前置条件与二次确认文案（停用/恢复、介入取消、配置保存、维护开关、测试账号删除/清空）
 *   §5.6/§8.6         识别失败复核：原图按钮、AI 排障码中文映射、补录只回填识别字段、忽略备注必填
 *   §7.2 API 适配层     admin.* 经 api/client 的 transport 注入：动作名/入参/读重试/写不重试/错误映射（不 mock 全局 wx）
 *   静态纪律          四件套齐全、单文件 ≤500 行、零 wx.cloud/七状态字面量/random/本地存储/avatarFileId/孤立 TEST、
 *                     无权限态与错误文案绑定、零金额、语法可编译
 *
 * 纪律：纯件 + api 层 fake transport；不 mock 全局 wx / Page；EXPECTED_ASSERTIONS 与断言数精确相等。
 * 取数：node tools/selftest-admin-pages.js | Select-Object -Last 2
 */
const path = require('path');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const fsutil = require('./lib/fsutil');
const zeroMoney = require('./zero-money-scan');

const client = require(path.join(ROOT, 'api/client.js'));
const adminApi = require(path.join(ROOT, 'api/modules/admin.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));

const copy = require(path.join(ROOT, 'pkg-admin/common/copy.js'));
const C = require(path.join(ROOT, 'pkg-admin/common/constants.js'));

const overviewVm = require(path.join(ROOT, 'pkg-admin/pages/overview/parts/view-model.js'));
const inviteVm = require(path.join(ROOT, 'pkg-admin/pages/invite-codes/parts/view-model.js'));
const customersVm = require(path.join(ROOT, 'pkg-admin/pages/customers/parts/view-model.js'));
const customerDetailVm = require(path.join(ROOT, 'pkg-admin/pages/customer-detail/parts/view-model.js'));
const partnersVm = require(path.join(ROOT, 'pkg-admin/pages/partners/parts/view-model.js'));
const ordersVm = require(path.join(ROOT, 'pkg-admin/pages/orders/parts/view-model.js'));
const orderDetailVm = require(path.join(ROOT, 'pkg-admin/pages/order-detail/parts/view-model.js'));
const configVm = require(path.join(ROOT, 'pkg-admin/pages/config/parts/view-model.js'));
const accountSwitchVm = require(path.join(ROOT, 'pkg-admin/pages/account-switch/parts/view-model.js'));
const reviewVm = require(path.join(ROOT, 'pkg-admin/pages/recognition-review/parts/view-model.js'));
const messagesVm = require(path.join(ROOT, 'pkg-admin/pages/messages/parts/view-model.js'));

const EXPECTED_ASSERTIONS = 145;

const ADMIN_PAGES = ['overview', 'invite-codes', 'customers', 'customer-detail', 'partners', 'orders',
  'order-detail', 'config', 'account-switch', 'messages', 'recognition-review'];
const STATUS_LITERALS = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
const PAGE_SIZE = 20;

function rel(relPath) {
  return path.join(ROOT, relPath);
}

function textOf(relPath) {
  return fsutil.readText(rel(relPath)) || '';
}

function has(relPath) {
  return fsutil.isFile(rel(relPath));
}

function sampleConfig() {
  return {
    zoneLabels: { D: 'D 区', X: 'X 区', N: 'N 区', B: 'B 区', C: 'C 区' },
    serviceCatalog: [
      { code: 'PICKUP_STD', name: '标准代取', desc: '到站取件送寝', enabled: true },
      { code: 'PICKUP_DOOR', name: '送寝上门', desc: '', enabled: false }
    ],
    announcement: { enabled: true, title: '开学通知', text: '请关注取件时间' },
    maintenance: { enabled: false, text: '维护说明' },
    orderTimeoutMinutes: 120,
    autoCompleteHours: 24,
    screenshotRetentionDays: 7,
    recognitionFailureRetentionDays: 30,
    viewTicketTtlMinutes: 45,
    avatarMaxBytes: 204800,
    aiFallback: { enabled: true },
    testAccountMaxPerRole: 3,
    testDataRetentionDays: 30
  };
}

function okResult(data) {
  return { ok: true, data: data === undefined ? {} : data, serverTime: Date.now() };
}

function register(h) {
  // ------------------------------------------------------------------ A. 五态文案纯件
  h.section('A §0.3/§11.5 五态文案：网络错误说真话、业务错误透传服务端、无权限有说明', (t) => {
    t.check(copy.NETWORK_CODES.length === 2 && copy.NETWORK_CODES.indexOf('DEPENDENCY_FAILED') >= 0
      && copy.NETWORK_CODES.indexOf('INTERNAL_ERROR') >= 0, '网络类错误只认 DEPENDENCY_FAILED/INTERNAL_ERROR 两码');
    const networkText = copy.errorText({ code: 'DEPENDENCY_FAILED', message: '网络超时，请检查网络后重试' });
    t.check(networkText.indexOf('没连上服务器') >= 0 && networkText.indexOf('重试') >= 0,
      '网络错误用统一文案且给下一步（不把底层英文透给用户）');
    t.eq(copy.errorText({ code: 'NOT_FOUND', message: '记录不存在或已注销。' }), '记录不存在或已注销。',
      '业务错误原样展示服务端 message（INVITE_*/NOT_FOUND 等）');
    t.eq(copy.errorText({ code: 'FORBIDDEN', message: 'x' }), '', 'FORBIDDEN 不进普通错误条（由无权限五态接管）');
    const forbidden = copy.forbiddenView();
    t.check(forbidden.title.indexOf('后台权限') >= 0 && forbidden.text.length > 0
      && copy.listEmptyText({ keyword: '' }) !== copy.listEmptyText({ keyword: 'C-7K2M', searchEmpty: '没有找到。' }),
    '无权限整页说明文案 + 真空态与搜索空态文案必须区分');
  });

  // ------------------------------------------------------------------ B. 总览
  h.section('B §3.1 总览：统计卡/红点/状态条/审计区块（统计排除测试数据由服务端保证）', (t) => {
    const built = overviewVm.buildCounts({
      counts: { todayOrders: 9, exceptions: 2, activePartners: 3, customers: 12, pendingRecognitionFailures: 4 },
      today: { orders: 9 }
    });
    t.eq(built.counts, { todayOrders: 9, exceptions: 2, activePartners: 3, customers: 12, pendingFailures: 4 },
      '统计卡五格：今日订单/异常/活跃兼职/顾客/识别失败待复核（顾客=counts.customers）');
    t.eq(built.badge, 6, '红点 = 待处理异常 + PENDING 识别失败（只计真实数据）');
    const legacy = overviewVm.buildCounts({ counts: { pendingFailures: 2, exceptions: 1 } });
    t.check(legacy.counts.pendingFailures === 2 && legacy.badge === 3, '旧字段 pendingFailures 兼容回退且红点正确');
    t.eq(overviewVm.buildCounts({}).badge, 0, '空 stats 不抛错且红点为 0');
    const bar = overviewVm.buildStatusBar({
      maintenance: { enabled: true, text: '系统维护中' },
      announcement: { enabled: true, title: '开学通知' }
    });
    t.check(bar.length === 2 && bar[0].indexOf('维护中') >= 0 && bar[1].indexOf('公告') >= 0,
      '维护中 + 公告已启用两条状态条，顺序固定（维护在前）');
    t.eq(overviewVm.buildStatusBar({}).length, 0, '未开启维护/公告时无状态条');
    const audit = overviewVm.decorateAuditList([
      { action: 'PARTNER_SUSPEND', developerNo: 'DEV-01', target: { no: 'P-7K2-M9X' }, at: Date.now() },
      { action: 'UNKNOWN_ACTION', developerNo: '', target: null, at: 0 }
    ]);
    t.check(audit[0].actionText === C.AUDIT_ACTION_LABELS.PARTNER_SUSPEND && audit[0].developerNo === 'DEV-01'
      && audit[0].targetText === 'P-7K2-M9X', '审计行映射中文动作 + developerNo + target（不显示 openid）');
    t.check(audit[1].actionText === overviewVm.AUDIT_FALLBACK, '未登记动作回退「其他操作」不空行');
  });

  // ------------------------------------------------------------------ B2. 总览抬头与「顾客」卡口径
  h.section('B2 §3.1 总览抬头 developerNo + 「顾客」卡：只展示不鉴权、无值降级、零 undefined/NaN', (t) => {
    const overviewJs = textOf('pkg-admin/pages/overview/index.js');
    const overviewWxml = textOf('pkg-admin/pages/overview/index.wxml');
    const overviewVmText = textOf('pkg-admin/pages/overview/parts/view-model.js');
    t.eq(overviewVm.buildHeader({ developerNo: 'DEV-01' }),
      { developerNo: 'DEV-01', subtitle: 'DEV-01 · 仅用于治理与排障' },
      'admin.stats.developerNo 有值时抬头 = {developerNo} · 仅用于治理与排障');
    t.eq(overviewVm.buildHeader({ developerNo: '' }), { developerNo: '', subtitle: '仅用于治理与排障' },
      '无 developerNo 时降级为治理提示（不显示空编号/占位）');
    t.eq(overviewVm.buildHeader({ developerNo: '  DEV-02  ' }).developerNo, 'DEV-02',
      '编号去首尾空白后再展示（服务端脏值不裂版）');
    t.eq([overviewVm.buildHeader({}).developerNo, overviewVm.buildHeader({ developerNo: null }).subtitle,
      overviewVm.buildHeader(undefined).subtitle], ['', '仅用于治理与排障', '仅用于治理与排障'],
    '空 stats / null / undefined 均走降级分支且不抛错');
    t.check(!/undefined|NaN/.test(JSON.stringify([
      overviewVm.buildHeader({}), overviewVm.buildHeader({ developerNo: null }),
      overviewVm.buildHeader({ developerNo: 'DEV-01' })
    ])), '抬头任何分支都不渲染 undefined/NaN 字面量');
    t.check(overviewWxml.indexOf('{{header.subtitle}}') >= 0 && overviewWxml.indexOf('{{developerNo') < 0,
      '抬头渲染 header.subtitle（编号文案由纯件单源给出，页面不拼文案）');
    const developerNoLines = overviewWxml.split('\n').filter(function withDeveloperNo(line) {
      return line.indexOf('developerNo') >= 0;
    });
    t.check(developerNoLines.length === 1 && developerNoLines[0].indexOf('{{item.developerNo}}') >= 0
      && !/wx:if|wx:elif|hidden|forbidden|bindtap|data-/.test(developerNoLines[0])
      && overviewJs.indexOf('developerNo') < 0,
    'developerNo 在页面仅 1 处纯展示（审计行），页面脚本零引用 → 不进任何权限/分支判断');
    t.check(overviewJs.indexOf('forbidden') < 0,
      '总览页不自行判无权限（FORBIDDEN 只由 common/feedback 接管，与编号无关）');
    t.check(overviewWxml.indexOf('>顾客<') >= 0 && overviewWxml.indexOf('活跃顾客') < 0,
      '顾客卡标签为「顾客」（DATA_MODEL §7.6 counts 只有 customers，无「活跃顾客」口径漂移）');
    t.check(overviewWxml.indexOf('bindtap="onOpenCustomers"') >= 0
      && /bindtap="onOpenCustomers"[\s\S]*?<text class="stat-label">顾客<\/text>/.test(overviewWxml),
    '「顾客」卡点击跳 customers（onOpenCustomers 入口保留）');
    t.eq(overviewJs.indexOf('PAGE_URLS.customers') >= 0, true, 'onOpenCustomers 目标地址取自 constants.customers');
    t.eq(overviewVmText.indexOf('activeCustomers'), -1,
      '视图模型不再兼容 activeCustomers 别名（服务端不新增该计数，避免口径漂移）');
    const driftCounts = overviewVm.buildCounts({ counts: { activeCustomers: 9 } }).counts;
    t.check(driftCounts.customers === 0 && !/undefined|NaN/.test(JSON.stringify(driftCounts)),
      '服务端多给 activeCustomers 也不消费：顾客卡显示 0 而非 undefined/NaN');
    const emptyCounts = overviewVm.buildCounts({ counts: {} }).counts;
    t.check(emptyCounts.customers === 0 && emptyCounts.todayOrders === 0,
      '服务端计数缺省时顾客卡显示 0（空态不裂版）');
    t.check(overviewWxml.indexOf('加载中…') >= 0 && overviewWxml.indexOf('暂无审计记录。') >= 0
      && overviewWxml.indexOf('{{error}}') >= 0,
    '总览三档状态：加载中/审计空态/错误条（错误文案来自 copy，不硬编码网络句）');
  });

  // ------------------------------------------------------------------ C. 邀请码
  h.section('C §3.2/§4 邀请码：状态筛选/掩码/作废前置/生成表单校验', (t) => {
    const tabs = inviteVm.buildTabs('UNUSED', { '': 32, UNUSED: 20 });
    const activeTab = tabs.filter(function findActive(tab) { return tab.active; })[0];
    t.check(tabs.length === C.INVITE_STATUS_TABS.length && activeTab.key === 'UNUSED' && activeTab.countText === ' 20',
      '状态筛选 tab 覆盖全部注册状态、高亮当前状态、计数取服务端 counts');
    const unusedRow = inviteVm.decorateRow({
      invitationCode: 'ABCD-EFGH-9XYZ', status: 'UNUSED', batchId: 'B1',
      expiresAt: Date.now(), createdAt: Date.now(), note: '首批'
    });
    t.check(unusedRow.codeMasked.indexOf('9XYZ') >= 0 && unusedRow.codeMasked.indexOf('ABCD') < 0
      && unusedRow.invitationCode === 'ABCD-EFGH-9XYZ',
    '列表只展示掩码（****-****-后4），完整码只留在内存供作废调用');
    t.check(unusedRow.isUnused === true && unusedRow.statusText === C.INVITE_STATUS_LABELS.UNUSED,
      '未使用行展示中文状态并可作废');
    const usedRow = inviteVm.decorateRow({
      invitationCode: 'ABCD-EFGH-1AAA', status: 'USED', usedByPartnerNo: 'P-7K2-M9X',
      usedByDisplayName: '小**', usedAt: Date.now()
    });
    t.check(usedRow.isUnused === false && usedRow.usedByText.indexOf('P-7K2-M9X') >= 0,
      '已使用行只读展示使用人兼职编号+脱敏昵称');
    t.eq([
      inviteVm.revokeBlockedCopy(enums.INVITATION_STATUS.USED),
      inviteVm.revokeBlockedCopy(enums.INVITATION_STATUS.EXPIRED),
      inviteVm.revokeBlockedCopy(enums.INVITATION_STATUS.REVOKED),
      inviteVm.revokeBlockedCopy(enums.INVITATION_STATUS.UNUSED)
    ], [
      '这个邀请码已被使用，不能作废。',
      '这个邀请码已过期，无需作废。',
      '这个邀请码已作废，无需重复作废。',
      ''
    ], '作废前置按真实状态分支（已使用/已过期/已作废/可作废）');
    const createMatrix = [
      inviteVm.validateCreate({ count: '0', note: '' }).ok,
      inviteVm.validateCreate({ count: '51', note: '' }).ok,
      inviteVm.validateCreate({ count: '50', note: '' }).ok,
      inviteVm.validateCreate({ count: '1', note: 'x'.repeat(51) }).ok,
      inviteVm.validateCreate({ count: '3', note: '  首批  ' }).note
    ];
    t.eq(createMatrix, [false, false, true, false, '首批'], '生成表单校验：数量 1~50、备注 ≤50、提交前去空白');
    t.check(inviteVm.pickExpires(2).label.indexOf('7') >= 0, '默认有效期 = 7 天（索引 2）');
    const result = inviteVm.buildResult({ batchId: 'B2', expiresAt: Date.now(), codes: ['AAA', 'BBB'] });
    t.check(result.count === 2 && result.codeText === 'AAA\nBBB' && result.batchId === 'B2',
      '批量结果整批可复制（换行拼接）+ 批次号展示');
  });

  // ------------------------------------------------------------------ D. 顾客列表/详情
  h.section('D §3.3/§3.4 顾客列表与详情：脱敏行/绑定/订单摘要/测试标签', (t) => {
    const row = customersVm.decorateRow({
      customerNo: 'C-7K2M-9QX4', displayName: '小**', dormText: 'D4', profileCompleted: true,
      bindingPartnerNo: 'P-7K2-M9X', inProgressCount: 1, totalCount: 12
    });
    t.check(row.displayName === '小**' && row.bindingText === '已绑定 P-7K2-M9X'
      && row.progressText === '进行中 1 / 累计 12' && row.profileText === '资料完整',
    '顾客行：脱敏昵称/绑定编号/订单进度/资料完整度');
    t.eq(customersVm.decorateRow({ customerNo: 'C-1' }).displayName, '—', '昵称缺失显示占位不裂版');
    t.eq(customersVm.decorateRow({ customerNo: 'C-2', isTest: true }).isTest, true, '测试账号行带「测试」标签数据');
    t.check(customersVm.shouldSearch('') === true && customersVm.shouldSearch('C') === false
      && customersVm.shouldSearch('C-7') === true, '搜索门槛：≥2 字符才发请求，清空则回首页');
    t.check(customersVm.emptyTextOf('') !== customersVm.emptyTextOf('C-7K2M'),
      '列表空态与搜索空态文案区分（§11.5）');

    const detail = customerDetailVm.buildDetailView({
      customer: { customerNo: 'C-7K2M-9QX4', displayName: '小**', dormText: 'D4', phoneTail: '**78', profileCompleted: true },
      bindingSummary: { partnerNo: 'P-7K2-M9X', displayName: '小**', status: 'ACTIVE', boundAt: Date.now() },
      orderSummary: { inProgress: 1, completed: 12, exception: 0 },
      recentOrders: [{ orderNo: 'D4-522A-0001', status: 'SUBMITTED', statusText: '待接单', dormText: 'D4', isTest: true }]
    }, 'C-7K2M-9QX4');
    t.check(detail.customer.phoneTailText === '**78' && detail.customer.displayName === '小**',
      '详情手机尾号只展示后 2 位、昵称按脱敏 DTO 展示');
    t.check(detail.binding.partnerNo === 'P-7K2-M9X' && detail.binding.statusText.length > 0,
      '绑定卡展示兼职编号与中文状态');
    t.eq(detail.orderSummaryText, '进行中 1 · 已完成 12 · 异常 0', '订单摘要三段式');
    t.check(detail.recentOrders[0].isTest === true && detail.recentOrders[0].statusText === '待接单',
      '最近订单测试行带标签且状态中文');
    t.eq(customerDetailVm.buildDetailView({ customer: {} }, 'C-FALLBACK').customer.customerNo, 'C-FALLBACK',
      '服务端缺编号时回退路由参数');
  });

  // ------------------------------------------------------------------ E. 兼职列表（治理动作）
  h.section('E §3.5/§7.2 兼职列表：停启用前置/后果句/原因必填/切换边界/测试账号禁治理', (t) => {
    const active = partnersVm.decorateRow({
      partnerNo: 'P-7K2-M9X', status: 'ACTIVE', displayName: '小**', bindingCount: 6, todayOrders: 8, totalOrders: 240
    }, '');
    t.check(active.canSuspend === true && active.canResume === false && active.canSwitch === true,
      'ACTIVE 行只给停用入口且可进入只读切换');
    const suspended = partnersVm.decorateRow({ partnerNo: 'P-1', status: 'SUSPENDED', displayName: '小**' }, 'P-1');
    t.check(suspended.canResume === true && suspended.canSuspend === false && suspended.canSwitch === false,
      'SUSPENDED 行只给恢复入口且不可进入切换（§6.2 只列 ACTIVE）');
    const closed = partnersVm.decorateRow({ partnerNo: 'P-2', status: 'CLOSED' }, '');
    t.check(closed.canSuspend === false && closed.canResume === false && closed.canSwitch === false,
      'CLOSED 行只读、无治理与切换入口');
    const testRow = partnersVm.decorateRow({ partnerNo: 'TEST-1', status: 'ACTIVE', isTest: true }, '');
    t.check(testRow.canSuspend === false && testRow.canResume === false && testRow.canSwitch === true,
      '测试账号不可执行真实治理动作，但可进入测试切换');
    t.check(partnersVm.isGovernanceBlocked(testRow) === true && partnersVm.isGovernanceBlocked(active) === false,
      '测试账号治理守卫（事件层再挡）且真实账号放行');
    t.check(partnersVm.suspendConfirmContent(active).indexOf('P-7K2-M9X') >= 0
      && partnersVm.suspendConfirmContent(active).indexOf('转异常') >= 0,
    '停用确认后果句含目标编号与订单转异常后果');
    t.check(partnersVm.resumeConfirmContent(active).indexOf('恢复') >= 0
      && partnersVm.resumeConfirmContent(active).indexOf('异常订单') >= 0,
    '恢复确认说明恢复范围与历史异常仍需逐单处理');
    t.eq([
      partnersVm.validateSuspendReason('').ok,
      partnersVm.validateSuspendReason('x'.repeat(101)).ok,
      partnersVm.validateSuspendReason('  误操作  ').reason
    ], [false, false, '误操作'], '停用原因必填、≤100、提交前去空白');
    t.eq(partnersVm.buildTabs('SUSPENDED').filter(function active2(x) { return x.active; })[0].key,
      'SUSPENDED', '状态筛选 tab 高亮正确');
  });

  // ------------------------------------------------------------------ F. 订单总览
  h.section('F §3.6 订单总览：脱敏行/异常中文/测试标签/三种空态', (t) => {
    const row = ordersVm.decorateRow({
      orderNo: 'D4-522A-0001', status: 'SUBMITTED', statusText: '待接单', serviceName: '标准代取',
      dormText: 'D4', exception: { codeText: '兼职账号已停用', reportedAt: Date.now() }, isTest: true
    });
    t.check(row.statusText === '待接单' && row.exceptionText === '兼职账号已停用' && row.isTest === true,
      '订单行：中文状态 + 中文异常说明 + 测试标签');
    t.eq(ordersVm.exceptionTextOf({ code: 'OTHER' }).indexOf('OTHER'), -1, '兜底不把内部异常码透给用户');
    t.eq([
      ordersVm.buildEmptyText({ keyword: 'D4-522A' }),
      ordersVm.buildEmptyText({ activeStatus: 'EXCEPTION' }),
      ordersVm.buildEmptyText({ activeStatus: '' })
    ], [
      '没有找到匹配的订单，换个订单号或编号试试。',
      '没有待处理的异常工单。',
      '当前筛选下没有订单。'
    ], '搜索空/异常空/筛选空三种空态文案必须区分');
    t.eq(ordersVm.buildTabs('EXCEPTION', { EXCEPTION: 2 })
      .filter(function hasCount(x) { return x.countText !== ''; })[0].countText, ' 2', '状态 tab 计数取服务端 counts');
  });

  // ------------------------------------------------------------------ G. 订单详情（异常介入取消）
  h.section('G §3.7/§7.3 订单详情：仅真实 EXCEPTION 可介入取消 + 原因必填 ≤200', (t) => {
    t.eq([
      orderDetailVm.canCancelOrder({ status: 'EXCEPTION', isTest: false }),
      orderDetailVm.canCancelOrder({ status: 'EXCEPTION', isTest: true }),
      orderDetailVm.canCancelOrder({ status: 'SUBMITTED', isTest: false })
    ], [true, false, false], '介入取消仅真实 EXCEPTION 单可见（测试单按测试流程清理）');
    const built = orderDetailVm.buildDetailView({
      order: {
        orderNo: 'D4-522A-0001', status: 'EXCEPTION', statusText: '异常', isTest: true,
        impersonatedBy: 'DEV-01', customerNo: 'C-7K2M-9QX4', customerDisplayName: '小**',
        partnerNo: 'P-7K2-M9X', parcel: { stationId: 'P4', stationName: '菜鸟驿站', pickupCode: '7***9', lockerNo: '*号柜' }
      },
      events: [{ type: 'SUBMIT', at: Date.now() }]
    }, 'D4-522A-0001');
    t.check(built.order.orderNo === 'D4-522A-0001' && built.order.customerName === '小**'
      && built.order.pickupCodeText === '7***9' && built.order.stationText === 'P4 菜鸟驿站',
    '详情装配订单号/脱敏昵称/脱敏取件码/站点编号+名称');
    t.check(built.order.impersonatedBy === 'DEV-01' && built.events.length === 1,
      '测试单追溯行只显示 developerNo，时间线逐条装配');
    t.eq(built.canCancel, false, '测试单 canCancel=false（组合条件生效）');
    t.eq([
      orderDetailVm.validateCancelNote('').ok,
      orderDetailVm.validateCancelNote('x'.repeat(201)).ok,
      orderDetailVm.validateCancelNote('  重复派单  ').note
    ], [false, false, '重复派单'], '介入原因必填、≤200、提交前去空白');
    t.check(orderDetailVm.cancelConfirmContent({ orderNo: 'D4-1', statusText: '异常' }).indexOf('不可恢复') >= 0,
      '介入取消确认含不可恢复后果句');
  });

  // ------------------------------------------------------------------ H. 全局配置
  h.section('H §3.8/§7.4 全局配置：可编辑白名单/值域/变更清单/维护开关与只读项', (t) => {
    const form = configVm.buildForm(sampleConfig());
    t.eq({
      zones: form.zones.length,
      firstZone: form.zones[0].value,
      services: form.services.length,
      serviceName: form.services[0].name,
      serviceKeys: Object.keys(form.services[0]),
      announcement: form.announcement.title,
      ttl: form.ttlMinutes,
      recognition: form.recognitionFailureRetentionDays,
      avatarKb: form.avatarMaxKb,
      screenshot: form.screenshotRetentionDays
    }, {
      zones: 5,
      firstZone: 'D 区',
      services: 2,
      serviceName: '标准代取',
      serviceKeys: ['code', 'name', 'desc'],
      announcement: '开学通知',
      ttl: '45',
      recognition: '30',
      avatarKb: '200',
      screenshot: '7'
    }, '配置表单回填：苑名/服务模板（仅 code/name/desc）/公告/切换会话/识别失败留存/头像KB/截图留存');
    const readonly = configVm.buildReadonlyInfo(sampleConfig());
    t.check(readonly.aiFallbackText.indexOf('只读') >= 0 && readonly.testAccountMaxPerRole === '3',
      'aiFallback 与测试账号上限只读展示（不在本页开放编辑）');
    const payload = configVm.buildPayload({
      zones: [{ key: 'D', value: ' D 区 ' }, { key: 'X', value: 'X 区' }, { key: 'N', value: 'N 区' },
        { key: 'B', value: 'B 区' }, { key: 'C', value: 'C 区' }],
      services: [{ code: 'PICKUP_STD', name: ' 标准代取 ', desc: ' 到站 ', enabled: true }],
      announcement: { enabled: true, title: ' 开学通知 ', text: '正文' },
      maintenance: { enabled: false, text: '' },
      orderTimeoutMinutes: '120', autoCompleteHours: '24', screenshotRetentionDays: '7',
      recognitionFailureRetentionDays: '21', ttlMinutes: '30', avatarMaxKb: '200'
    });
    t.check(payload.zoneLabels.D === 'D 区' && payload.serviceCatalog[0].name === '标准代取'
      && payload.recognitionFailureRetentionDays === 21 && payload.avatarMaxBytes === 204800,
    '上行 payload 去空白、识别失败留存可编辑、头像 KB→字节换算');
    t.eq(Object.keys(payload.serviceCatalog[0]), ['code', 'name', 'desc'],
      '服务类型上行只有 code/name/desc（无 enabled：CONTRACT §6/DATA_MODEL §2.10 口径）');
    const configPageJs = textOf('pkg-admin/pages/config/index.js');
    const configWxml = textOf('pkg-admin/pages/config/index.wxml');
    const serviceSection = configWxml.split('服务类型模板')[1].split('苑名')[0] || '';
    t.check(serviceSection.indexOf('<switch') < 0 && serviceSection.indexOf('onServiceToggle') < 0
      && serviceSection.indexOf('启用') < 0,
    'config 服务类型区不含启用/停用开关文案与 toggle 事件（无效控件已移除）');
    t.check(configPageJs.length > 0 && configPageJs.indexOf('onServiceToggle') < 0,
      'config 页面脚本无 onServiceToggle 残留（服务类型只编辑名称/说明）');
    t.eq([
      configVm.validatePayload(payload),
      configVm.validatePayload(Object.assign({}, payload, { orderTimeoutMinutes: 9 })).indexOf('10~1440') >= 0,
      configVm.validatePayload(Object.assign({}, payload, { autoCompleteHours: 169 })).indexOf('1~168') >= 0,
      configVm.validatePayload(Object.assign({}, payload, { screenshotRetentionDays: 8 })).indexOf('7 天') >= 0,
      configVm.validatePayload(Object.assign({}, payload, { recognitionFailureRetentionDays: 6 })).indexOf('7~30') >= 0,
      configVm.validatePayload(Object.assign({}, payload, { recognitionFailureRetentionDays: 31 })).indexOf('7~30') >= 0,
      configVm.validatePayload(Object.assign({}, payload, { ttlMinutes: 4 })).indexOf('5~60') >= 0,
      configVm.validatePayload(Object.assign({}, payload, { ttlMinutes: 61 })).indexOf('5~60') >= 0,
      configVm.validatePayload(Object.assign({}, payload, { avatarMaxBytes: 201 * 1024 })).indexOf('100~200KB') >= 0,
      configVm.validatePayload(Object.assign({}, payload, {
        announcement: { enabled: true, title: 'x'.repeat(31), text: '' }
      })).indexOf('30 字') >= 0,
      configVm.validatePayload(Object.assign({}, payload, {
        zoneLabels: { D: 'D 区', X: '', N: 'N 区', B: 'B 区', C: 'C 区' }
      })).indexOf('不能为空') >= 0
    ], ['', true, true, true, true, true, true, true, true, true, true],
    '配置值域：超时/自动完成/留存上限/识别失败留存 7~30/切换会话 5~60/头像 ≤200KB/公告≤30/苑名非空');
    t.eq(configVm.collectChanges(payload, payload).length, 0, '无变化时变更清单为空（不触发二次确认）');
    const changes = configVm.collectChanges(payload, Object.assign({}, payload, {
      recognitionFailureRetentionDays: 30, maintenance: { enabled: true, text: '' }
    }));
    t.check(changes.indexOf('识别失败留存天数') >= 0 && changes.indexOf('维护模式') >= 0,
      '变更清单按中文字段名列出（二次确认用）');
    const apiPayload = configVm.buildApiPayload(payload, C.CONFIG_TTL_KEY);
    t.check(apiPayload[C.CONFIG_TTL_KEY] === 30 && apiPayload.ttlMinutes === undefined,
      '上行把 ttlMinutes 改名为契约字段 viewTicketTtlMinutes，不残留展示字段');
    const onCopy = configVm.maintenanceConfirmContent(true);
    const offCopy = configVm.maintenanceConfirmContent(false);
    t.check(onCopy.indexOf('写操作被拒绝') >= 0 && offCopy.indexOf('恢复读写') >= 0 && onCopy !== offCopy,
      '维护开启/关闭分别二次确认且后果句不同（§7.5）');
  });

  // ------------------------------------------------------------------ I. 账号切换
  h.section('I §3.9/§6 账号切换：候选/测试账号/额度/搜索入参/确认文案/危险确认', (t) => {
    t.check(accountSwitchVm.buildTabs('test').filter(function active(x) { return x.active; })[0].key === 'test'
      && accountSwitchVm.buildRoleChips('PARTNER').filter(function active(x) { return x.active; })[0].key === 'PARTNER',
    '真实/测试 tab 与角色 chips 高亮正确');
    const partnerCandidate = accountSwitchVm.decorateCandidate({
      partnerNo: 'P-7K2-M9X', displayName: '小**', status: 'ACTIVE', bindingCount: 6
    }, true);
    t.check(partnerCandidate.targetNo === 'P-7K2-M9X' && partnerCandidate.rawTargetNo === 'P-7K2-M9X'
      && partnerCandidate.role === 'PARTNER', '兼职候选行带编号/角色/原始编号（供 viewAsStart 调用）');
    t.eq(accountSwitchVm.decorateCandidate({ customerNo: 'C-7K2M-9QX4', profileCompleted: true }, false).statusText,
      '资料完整', '顾客候选行显示资料完整度');
    const testAccount = accountSwitchVm.decorateTestAccount({
      targetNo: 'C-ABCD-2345', role: 'CUSTOMER', displayName: '测试-小王', isTestAccount: true, testLastUsedAt: Date.now()
    });
    t.check(testAccount.isTestAccount === true && testAccount.roleText === C.ROLE_LABELS.CUSTOMER
      && testAccount.lastUsedText !== '未使用', '测试账号行标记 isTestAccount/角色/最近使用时间');
    const custSearch = accountSwitchVm.buildRealSearchParams({ role: 'CUSTOMER', keyword: ' C-7K2M ', limit: 10 });
    const partnerSearch = accountSwitchVm.buildRealSearchParams({ role: 'PARTNER', keyword: 'P-7K2-M9X', limit: 10 });
    t.check(custSearch.action === 'listCustomers' && custSearch.payload.includeTest === false
      && custSearch.payload.status === undefined && custSearch.payload.keyword === 'C-7K2M'
      && partnerSearch.action === 'listPartners' && partnerSearch.payload.status === 'ACTIVE',
    '真实搜索：排除测试账号、兼职只列 ACTIVE、关键词去空白');
    t.check(accountSwitchVm.buildRealConfirmContent({
      roleText: '顾客', targetNo: 'C-7K2M-9QX4', displayName: '小**'
    }, 30).indexOf('只读视角') >= 0, '真实进入确认含只读视角说明');
    t.check(accountSwitchVm.buildTestConfirmContent({ roleText: '顾客', targetNo: 'C-ABCD-2345' }, 30)
      .indexOf('写入测试数据') >= 0, '测试进入确认必须写明只写测试数据');
    const blockedQuota = accountSwitchVm.quotaState({
      role: 'CUSTOMER', customerUsed: 3, partnerUsed: 0, totalUsed: 3, maxPerRole: 3, maxTotal: 6
    });
    t.check(blockedQuota.blocked === true && blockedQuota.copy.indexOf('3') >= 0
      && accountSwitchVm.quotaState({
        role: 'PARTNER', customerUsed: 3, partnerUsed: 2, totalUsed: 5, maxPerRole: 3, maxTotal: 6
      }).blocked === false, '额度：每角色满禁新建、另一角色有余量放行');
    t.eq([
      accountSwitchVm.validateCreateName('').ok,
      accountSwitchVm.validateCreateName('x'.repeat(21)).ok,
      accountSwitchVm.validateCreateName('  测试-小王  ').displayName
    ], [false, false, '测试-小王'], '测试账号昵称必填、≤20、去空白后提交');
    const deleteCopy = accountSwitchVm.buildDeleteConfirmContent(
      { targetNo: 'C-ABCD-2345', displayName: '测试-小王' },
      { removedCounts: { orders: 3, messages: 1, bindings: 1, failures: 0, events: 5, avatarFiles: 2 }, sessionsEnded: 1 }
    );
    t.check(deleteCopy.indexOf('测试订单 3 条') >= 0 && deleteCopy.indexOf('输入“删除”') >= 0
      && deleteCopy.indexOf('活跃切换会话') >= 0, '删除测试账号确认含 dry-run 计数/双条件/会话结束后果');
    t.check(accountSwitchVm.buildPurgeConfirmContent({ orders: 4, messages: 2, bindings: 1, failures: 3 })
      .indexOf('测试账号保留') >= 0, '清空测试数据确认写明只清数据保留账号');
  });

  // ------------------------------------------------------------------ J. 识别失败复核
  h.section('J §3.11/§5.6 识别失败复核：脱敏列表/详情/AI 排障码/补录与忽略校验', (t) => {
    const row = reviewVm.decorateRow({
      failureNo: 'F-2026-0001', failureCode: 'NO_TEXT', sourceRole: 'CUSTOMER',
      uploaderNo: 'C-7K2M-9QX4', uploaderDisplayName: '小**', createdAt: Date.now(), status: 'PENDING'
    }, 'F-2026-0001');
    t.check(row.uploaderText.indexOf('C-7K2M-9QX4') >= 0 && row.uploaderText.indexOf('小**') >= 0
      && row.failureCodeText === C.FAILURE_CODE_LABELS.NO_TEXT && row.expanded === true,
    '上传人只给编号+脱敏昵称、失败码中文、行展开状态回写');
    const detail = reviewVm.decorateDetail({
      failureNo: 'F-1', failureCode: 'LOW_CONFIDENCE', sourceRole: 'PARTNER', uploaderNo: 'P-7K2-M9X',
      uploaderDisplayName: '小**', status: 'PENDING', ocrTextMasked: 'x'.repeat(1300),
      ruleResult: { stationId: 'P4', pickupCode: '1234' }, aiTried: true, aiModel: 'deepseek-chat',
      aiResult: { stationId: 'P4', pickupCode: '1234', confidence: 0.92 }, aiErrorCode: 'TIMEOUT',
      createdAt: Date.now()
    });
    t.check(detail.ocrFoldable === true && detail.ocrShort.length < detail.ocrText.length
      && detail.canReview === true, 'OCR 超长折叠；PENDING 记录可补录/忽略');
    t.check(detail.aiTriedText === '已尝试' && detail.aiModelText === 'deepseek-chat'
      && detail.aiErrorText.indexOf('超时') >= 0 && detail.aiErrorText.indexOf('TIMEOUT') < 0,
    'AI 尝试摘要只读展示；内部排障码映射中文（不暴露英文码）');
    t.check(detail.ruleText.indexOf('站点 P4') >= 0 && detail.aiResultText.indexOf('置信度 0.92') >= 0,
      '规则结果与 AI 结果摘要展示站点/取件码/置信度');
    t.check(reviewVm.aiErrorLabel('') === '' && reviewVm.aiErrorLabel('BRAND_NEW').indexOf('识别失败入队') >= 0,
      '无排障码不显示；未登记排障码给兜底人话');
    t.eq(reviewVm.decorateDetail({ failureNo: 'F-2', status: 'FIXED' }).canReview, false,
      '已处理记录不可重复补录（INVALID_STATE 由服务端兜底）');
    const params = reviewVm.buildParams({ activeStatus: 'PENDING', activeCode: 'NO_TEXT', activeSource: 'CUSTOMER',
      activeDate: '7', limit: PAGE_SIZE }, 1000000000000);
    t.check(params.status === 'PENDING' && params.failureCode === 'NO_TEXT' && params.sourceRole === 'CUSTOMER'
      && params.dateFrom === 1000000000000 - 7 * reviewVm.DAY_MS
      && reviewVm.buildParams({ activeStatus: 'PENDING', activeDate: '0', limit: 20 }, 0).dateFrom === undefined,
    '筛选参数：状态/失败码/来源角色/近7天 dateFrom（全部日期不传）');
    t.eq([
      reviewVm.buildEmptyText('PENDING'),
      reviewVm.buildEmptyText('FIXED'),
      reviewVm.validateFix({ stationId: '', pickupCode: '' }).ok,
      reviewVm.validateFix({ stationId: 'P9', pickupCode: '' }).ok,
      reviewVm.validateFix({ stationId: 'P4', pickupCode: '' }).ok,
      reviewVm.validateFix({ stationId: '', pickupCode: 'x'.repeat(41) }).ok
    ], [
      '还没有识别失败记录。识别失败时系统会自动入队，可在这里排查。',
      '没有符合当前筛选的识别失败记录。',
      false,
      false,
      true,
      false
    ], '空态区分 + 补录校验（站点∈P1~P8 或取件码非空、≤40 位）');
    t.check(reviewVm.fixConfirmContent('P4', '1234').indexOf('不改订单状态') >= 0,
      '补录确认写明只回填识别字段（不改状态/不代确认/不建单）');
    t.eq([
      reviewVm.validateIgnoreNote('   ').ok,
      reviewVm.validateIgnoreNote('x'.repeat(101)).ok,
      reviewVm.validateIgnoreNote('  误识别  ').note
    ], [false, false, '误识别'], '忽略备注必填、≤100、去空白后提交');
  });

  // ------------------------------------------------------------------ K. 后台消息
  h.section('K §2.5/§3.10 后台消息：异常工单/识别失败摘要/系统状态/服务端计数', (t) => {
    const order = messagesVm.decorateOrder({
      orderNo: 'D4-522A-0001', partnerNo: 'P-7K2-M9X',
      exception: { codeText: '兼职账号已停用', reportedAt: Date.now() }
    });
    t.check(order.exceptionText === '兼职账号已停用' && order.partnerNo === 'P-7K2-M9X',
      '异常工单摘要行含中文异常说明与兼职编号');
    const failure = messagesVm.decorateFailure({
      failureNo: 'F-1', failureCode: 'NO_TEXT', sourceRole: 'CUSTOMER',
      uploaderNo: 'C-7K2M-9QX4', uploaderDisplayName: '小**', createdAt: Date.now()
    });
    t.check(failure.failureCodeText === C.FAILURE_CODE_LABELS.NO_TEXT && failure.uploaderText.indexOf('C-7K2M-9QX4') >= 0,
      '识别失败摘要行脱敏展示');
    t.check(messagesVm.buildSystemLines({ maintenance: { enabled: true, text: '维护中' } })[0].indexOf('维护中') >= 0
      && messagesVm.buildSystemLines({}).length === 0, '系统状态提示：维护中；未开启时无状态卡');
    const totals = messagesVm.buildTotals({ counts: { exceptions: 25, pendingRecognitionFailures: 7 } },
      { exceptions: new Array(20), failures: [1] });
    t.check(totals.exceptionTotal === 25 && totals.failureTotal === 7
      && totals.hasAny === true, '标题计数用服务端总数（不被分页截断）');
    t.eq(messagesVm.buildTotals({}, { exceptions: [1, 2], failures: [] }).exceptionTotal, 2,
      '服务端缺计数时回退当前页条数');
  });

  // ------------------------------------------------------------------ L. api 适配层（fake transport）
  h.section('L §7.2 admin.* 经 api/client：动作名/入参/读重试/写不重试/错误映射（不 mock 全局 wx）', async (t) => {
    const seen = [];
    try {
      client.setTransport((payload) => {
        seen.push(payload);
        return Promise.resolve(okResult({ counts: {} }));
      });
      const stats = await adminApi.stats({});
      t.check(seen[0].action === 'admin.stats' && /^[A-Za-z0-9_-]{24}$/.test(String(seen[0].clientRequestId))
        && stats && typeof stats === 'object', 'stats 包络动作名逐字 admin.stats + 24 位 clientRequestId');
      seen.length = 0;
      await adminApi.listCustomers({ keyword: 'C-7K2M', includeTest: false, limit: 20 });
      t.eq(seen[0].data, { keyword: 'C-7K2M', includeTest: false, limit: 20 }, '列表入参原样透传（keyword/includeTest/limit）');
      seen.length = 0;
      await adminApi.updateConfig({ config: { orderTimeoutMinutes: 120 } });
      t.eq(seen[0].data, { config: { orderTimeoutMinutes: 120 } }, 'updateConfig 入参按 { config: {...} } 包络');
      seen.length = 0;
      await adminApi.viewAsStart({ role: 'CUSTOMER', targetNo: 'C-7K2M-9QX4', mode: 'READONLY' });
      t.eq(seen[0].data, { role: 'CUSTOMER', targetNo: 'C-7K2M-9QX4', mode: 'READONLY' },
        'viewAsStart 入参含 role/targetNo/mode');
      seen.length = 0;
      await adminApi.deleteTestAccount({ targetNo: 'C-ABCD-2345', confirmText: '删除' });
      t.eq(seen[0].data, { targetNo: 'C-ABCD-2345', confirmText: '删除' }, '删除测试账号带二次确认文案');
      seen.length = 0;
      await adminApi.purgeTestData({ dryRun: true });
      t.eq(seen[0].data, { dryRun: true }, '清空测试数据 dry-run 入参');
      seen.length = 0;
      await adminApi.createInvites({ count: 1, expiresInHours: 168, note: '首批' });
      t.eq(seen[0].data, { count: 1, expiresInHours: 168, note: '首批' }, 'createInvites 入参原样透传（count/有效期/备注）');
      let readAttempts = 0;
      client.setTransport(() => {
        readAttempts += 1;
        if (readAttempts === 1) return Promise.reject(new client.CallError('DEPENDENCY_FAILED', '读首次失败'));
        return Promise.resolve(okResult({ list: [] }));
      });
      const retried = await adminApi.listPartners({ keyword: 'P-7K2-M9X' });
      t.check(readAttempts === 2 && Array.isArray(retried.list), '读动作自动重试一次后成功');
      let writeAttempts = 0;
      client.setTransport(() => {
        writeAttempts += 1;
        return Promise.reject(new client.CallError('DEPENDENCY_FAILED', '写失败'));
      });
      let caught = null;
      try {
        await adminApi.setPartnerStatus({ partnerNo: 'P-7K2-M9X', status: 'SUSPENDED', reason: '测试' });
      } catch (err) {
        caught = err;
      }
      t.check(writeAttempts === 1 && caught !== null, '写动作不自动重试（治理动作防重复提交）');
      client.setTransport(() => Promise.resolve({ ok: false, code: 'CONFLICT' }));
      caught = null;
      try {
        await adminApi.revokeInvite({ invitationCode: 'ABCD-EFGH-9XYZ', reason: '后台作废' });
      } catch (err) {
        caught = err;
      }
      t.check(caught !== null && caught.code === 'CONFLICT' && caught.message === errorCopy.CODE_COPY.CONFLICT,
        '失败按 13 码人话映射（不透出英文码）');
    } finally {
      client.restoreTransport();
    }
  });

  // ------------------------------------------------------------------ M. 静态纪律
  h.section('M 静态纪律：四件套/行数/页面层零判据/零 avatarFileId/零孤立 TEST/无权限与错误绑定', (t) => {
    const missing = [];
    ADMIN_PAGES.forEach((name) => {
      ['index.js', 'index.json', 'index.wxml', 'index.wxss'].forEach((ext) => {
        const relPath = 'pkg-admin/pages/' + name + '/' + ext;
        if (!has(relPath)) missing.push(relPath);
      });
    });
    t.eq(missing, [], '11 页四件套齐全（44 件，缺 0）');
    const pageJs = ADMIN_PAGES.map(function relOf(name) {
      return 'pkg-admin/pages/' + name + '/index.js';
    });
    t.eq(pageJs.filter(function tooLong(relPath) {
      return fsutil.countLines(rel(relPath)) > 500;
    }), [], '11 页 index.js 均 ≤500 行（account-switch/recognition-review 不膨胀）');
    const allJs = pageJs.concat([
      'pkg-admin/common/constants.js', 'pkg-admin/common/format.js', 'pkg-admin/common/feedback.js',
      'pkg-admin/common/copy.js'
    ]);
    const sourceOf = function text(relPath) {
      return textOf(relPath);
    };
    t.eq(allJs.filter(function hasCloud(relPath) { return /wx\.cloud\./.test(sourceOf(relPath)); }),
      [], '后台页面层零 wx.cloud.*（不直连云）');
    const statusHits = [];
    pageJs.forEach(function scanStatus(relPath) {
      const code = fsutil.stripComments(sourceOf(relPath));
      STATUS_LITERALS.forEach(function scanLiteral(literal) {
        if (new RegExp("['\"]" + literal + "['\"]").test(code)) statusHits.push(relPath + ':' + literal);
      });
    });
    t.eq(statusHits, [], '页面层零七状态字符串字面量（复用 check #21 口径）');
    t.eq(allJs.filter(function hasRandom(relPath) {
      return /Math\.random|\brandom\(/.test(fsutil.stripComments(sourceOf(relPath)));
    }), [], '页面层零 random（编号/roomTag 生成不在端侧）');
    t.eq(allJs.filter(function hasStorage(relPath) {
      return /wx\.[A-Za-z]*Storage[A-Za-z]*/.test(sourceOf(relPath));
    }), [], '页面层零本地存储读写（票据只存内存，§6.3）');
    const adminFiles = ADMIN_PAGES.reduce(function scan(acc, name) {
      ['index.js', 'index.wxml'].forEach(function scanFile(ext) {
        acc.push('pkg-admin/pages/' + name + '/' + ext);
      });
      return acc;
    }, []);
    t.eq(adminFiles.filter(function hasAvatar(relPath) {
      return textOf(relPath).indexOf('avatarFileId') >= 0;
    }), [], 'pkg-admin 全量零 avatarFileId（门禁 #29）');
    t.eq(adminFiles.filter(function hasOpenid(relPath) {
      return /(?<![A-Za-z0-9_-])openid(?![A-Za-z0-9_-])/i.test(textOf(relPath));
    }), [], '后台页面零 openid 字面量/字段透出');
    const testLiteral = /(?<![A-Za-z0-9_])TEST(?![A-Za-z0-9_])/;
    t.eq(adminFiles.filter(function hasTestLiteral(relPath) {
      const raw = textOf(relPath);
      const src = relPath.endsWith('.js') ? fsutil.stripComments(raw) : raw.replace(/<!--[\s\S]*?-->/g, '');
      return testLiteral.test(src);
    }), [], '后台零孤立 TEST 字面量（行标签用中文「测试」，门禁 #31）');
    t.eq(ADMIN_PAGES.filter(function lacksForbidden(name) {
      const wxml = textOf('pkg-admin/pages/' + name + '/index.wxml');
      return wxml.indexOf('wx:if="{{forbidden}}"') < 0 || wxml.indexOf('{{!forbidden}}') < 0
        || wxml.indexOf('{{forbidden.title}}') < 0;
    }), [], '11 页都有无权限整页说明并隐藏数据区（不显示后台空壳）');
    t.eq(ADMIN_PAGES.filter(function lacksError(name) {
      const wxml = textOf('pkg-admin/pages/' + name + '/index.wxml');
      return wxml.indexOf('{{error}}') < 0 || wxml.indexOf('没连上服务器') >= 0;
    }), [], '错误条绑定服务端/统一文案（页面不再硬编码网络错误句）');
    const moneyHits = [];
    allJs.forEach(function scanMoney(relPath) {
      zeroMoney.scanText(textOf(relPath)).forEach(function hit(hitInfo) {
        moneyHits.push(relPath + ':' + hitInfo.token);
      });
    });
    t.eq(moneyHits, [], '后台页面层零金额词表命中（门禁 #22 同源）');
    const partsFiles = ADMIN_PAGES.map(function partsOf(name) {
      return 'pkg-admin/pages/' + name + '/parts/view-model.js';
    });
    t.eq(partsFiles.filter(has), partsFiles, '11 页均抽出可测纯件 parts/view-model.js（页面只做取参/setData/转发）');
    t.eq(partsFiles.concat(allJs).filter(function badSyntax(relPath) {
      return !fsutil.syntaxCheck(textOf(relPath), relPath).ok;
    }), [], '页面/零件语法可编译（node --check 同口径）');
  });

  // ------------------------------------------------------------------ N. 边界
  h.section('N §0.4/§6 后台页边界：零 switch-bar/test-badge 引用、零分享入口、票据不落盘', (t) => {
    const scanned = [];
    ADMIN_PAGES.forEach(function eachPage(name) {
      ['index.js', 'index.wxml'].forEach(function eachFile(ext) {
        scanned.push({ rel: 'pkg-admin/pages/' + name + '/' + ext, text: textOf('pkg-admin/pages/' + name + '/' + ext) });
      });
    });
    const switchHits = [];
    scanned.forEach(function scan(item) {
      ['switch-bar', 'test-badge'].forEach(function scanKey(key) {
        if (item.text.indexOf(key) >= 0) switchHits.push(item.rel + ':' + key);
      });
    });
    t.eq(switchHits, [], 'pkg-admin 零 switch-bar/test-badge 引用（门禁 #31）');
    t.eq(scanned.filter(function hasShare(item) {
      return /onShareAppMessage|onShareTimeline|open-type="share"/.test(item.text);
    }).map(function relOf(item) { return item.rel; }), [], '后台页零分享/转发入口（治理数据不外传）');
    const accountPage = textOf('pkg-admin/pages/account-switch/index.js');
    t.check(accountPage.indexOf('session.enterViewContext') >= 0 && accountPage.indexOf('store.setViewContext') < 0
      && accountPage.indexOf('localStorage') < 0 && accountPage.indexOf('setStorage') < 0,
    '切换开启经 session.enterViewContext（viewContext 入内存 + bootstrap 水合目标身份；票据不落盘）');
    const viewTicketLiteral = /(?<![A-Za-z0-9_])viewTicket(?![A-Za-z0-9])/;
    t.eq(ADMIN_PAGES.filter(function hasTicket(name) {
      return viewTicketLiteral.test(textOf('pkg-admin/pages/' + name + '/index.js'));
    }), [], '后台页源码零裸 viewTicket 变量名（门禁 #23；键名从 constants 分片取）');
    t.check(Object.keys(C.PAGE_URLS).filter(function notLaunch(key) {
      return key !== 'launch';
    }).every(function isAdmin(key) {
      return C.PAGE_URLS[key].indexOf('/pkg-admin/pages/') === 0;
    }), '后台导航地址表只含后台页（不跨到顾客/兼职页）');
  });
  // ------------------------------------------------------------------ O. 补充口径（跨页一致性）
  h.section('O 补充：未知错误兜底/列表装配/时间格式/测试标签渲染/边界值', (t) => {
    t.eq(copy.errorText({ code: 'BRAND_NEW_CODE', message: '' }), copy.UNKNOWN_ERROR_TEXT,
      '未登记错误码 / 空 message 回落到统一兜底文案');
    t.eq(ordersVm.decorateList([{ orderNo: 'D4-1' }, { orderNo: 'D4-2' }]).length, 2, '订单列表逐条装配');
    t.eq(customersVm.decorateList([{ customerNo: 'C-1' }, { customerNo: 'C-2' }]).length, 2, '顾客列表逐条装配');
    const partnerRow = partnersVm.decorateRow({
      partnerNo: 'P-7K2-M9X', status: 'SUSPENDED', displayName: '小**',
      bindingCount: 6, todayOrders: 8, totalOrders: 240, serviceCount: 3, suspendedReason: '违规操作'
    }, '');
    t.check(partnerRow.bindingText === '绑定 6' && partnerRow.orderText === '今日 8 / 累计 240'
      && partnerRow.serviceCount === 3 && partnerRow.suspendedReason === '违规操作',
    '兼职行：绑定数/单量/服务项数/停用原因展示');
    const event = orderDetailVm.decorateEvent({ at: Date.now() });
    t.check(event.label === '状态更新' && event.atText.length > 0, '时间线事件缺标签时给「状态更新」兜底');
    const resolved = reviewVm.decorateDetail({
      failureNo: 'F-9', status: 'IGNORED', resolution: { note: '已过保留期自动忽略', at: Date.now() }
    });
    t.check(resolved.resolutionNote.indexOf('保留期') >= 0 && resolved.resolutionAtText.length > 0,
      '已处理记录展示处理结果与复核时间');
    t.eq(reviewVm.buildAiResultText('已识别但未关联'), '已识别但未关联', 'AI 结果字符串摘要原样展示');
    const avatarBoundary = configVm.validatePayload(configVm.buildPayload(Object.assign({}, configVm.emptyForm(), {
      zones: [{ key: 'D', value: 'D 区' }, { key: 'X', value: 'X 区' }, { key: 'N', value: 'N 区' },
        { key: 'B', value: 'B 区' }, { key: 'C', value: 'C 区' }],
      services: [], announcement: { enabled: false, title: '', text: '' },
      maintenance: { enabled: false, text: '' }, orderTimeoutMinutes: '120', autoCompleteHours: '24',
      screenshotRetentionDays: '7', recognitionFailureRetentionDays: '30', ttlMinutes: '30', avatarMaxKb: '100'
    })));
    t.eq(avatarBoundary, '', '头像大小上限 100KB 边界合法（服务端 min=102400）');
    const auditWithTime = overviewVm.decorateAudit({ action: 'INVITE_CREATE', developerNo: 'DEV-01', target: 'batch', at: Date.now() });
    t.check(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(auditWithTime.timeText), '审计时间按服务端时间格式化（YYYY-MM-DD HH:mm）');
    const taggedPages = ['customers', 'partners', 'orders', 'customer-detail', 'order-detail']
      .filter(function hasTag(name) {
        return textOf('pkg-admin/pages/' + name + '/index.wxml').indexOf('tag-test') >= 0;
      });
    t.eq(taggedPages.length, 5, '顾客/兼职/订单/两个详情页都渲染中文「测试」行标签（TD-030）');
    t.check(textOf('pkg-admin/pages/account-switch/index.wxml').indexOf('测试账号（可写）') >= 0,
      '账号切换页测试 tab 用中文标识（不用英文 TEST 字面量）');
    t.eq(accountSwitchVm.buildTabs('real').map(function keyOf(tab) { return tab.key; }), ['real', 'test'],
      '账号切换 tab 固定真实/测试两档');
    t.check(textOf('pkg-admin/pages/overview/index.wxml').indexOf('识别失败待复核') >= 0,
      '总览含「识别失败待复核」统计卡与复核入口（D16/D17 入口）');
    t.check(textOf('pkg-admin/pages/messages/index.wxml').indexOf('去复核') >= 0,
      '后台消息页识别失败摘要行给「去复核」跳转');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-admin-pages' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-admin-pages');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
