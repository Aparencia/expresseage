'use strict';
/**
 * tools/selftest-message-pages.js — 批 8-T4「消息中心/公告/红点/维护模式」端侧断言套件（task-78 A~F）。
 *
 * 覆盖：
 *   A. 顾客消息中心视图模型：分桶（公告置顶去重）/排序/未读/已读水位/时间格式化/空态/红点补丁；
 *   B. 兼职消息中心视图模型：全部/订单/留言/公告分类、未读与水位、追加合并去重排序、红点补丁；
 *   C. api/modules/message 经 api/client transport 注入：list/markRead 请求与响应映射、读重试/写不重试、
 *      READONLY 写拦截零请求、viewTicket 注入、13 码人话与维护错误优先级；
 *   D. 红点单源：消息页只改 messages、工作台 loadView.badgePatch 保留 messages、我的页读同一 store 键、
 *      custom-tab-bar 两角色「我的」格 badgeKey=messages；
 *   E. utils/maintenance.js 全分支：配置归一（缺失/关闭/单对象/非布尔/非字符串/数组）、默认文案、opts 覆写、
 *      写拒绝文案（维护命中/隐私同意不误判/错误码不符）；
 *   F. 静态纪律：两消息页+home/workbench 四件套/无 wx.cloud/无本地存储敏感值/零金额/无 avatarFileId/行数、
 *      维护组件页面级注册（不改 app.json）、home/workbench onShow 挂钩与写拒绝文案接线、语法可编译。
 *
 * 纪律：纯件 + api 层 fake transport（禁 mock 全局 wx、不连网络）；先合法基线再反例；样本非空；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-message-pages.js | Select-Object -Last 2
 */
const path = require('path');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const fsutil = require('./lib/fsutil');
const zeroMoney = require('./zero-money-scan');

const customerView = require(path.join(ROOT, 'pkg-customer/pages/messages/parts/message-view.js'));
const partnerView = require(path.join(ROOT, 'pkg-partner/pages/messages/parts/message-view.js'));
const loadView = require(path.join(ROOT, 'pages/partner/workbench/parts/load-view.js'));
const profileVm = require(path.join(ROOT, 'pages/profile/parts/view-model.js'));
const maintenance = require(path.join(ROOT, 'utils/maintenance.js'));
const messageApi = require(path.join(ROOT, 'api/modules/message.js'));
const client = require(path.join(ROOT, 'api/client.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));

const EXPECTED_ASSERTIONS = 149; // 实际断言总数（运行后校准；少算/多算都判红）

const NOW = Date.parse('2026-10-22T12:00:00+08:00');
const WRITE_REJECTED = '系统维护中，暂时不能提交；急单请留言或联系开发者。';
const EMPTY_ALL = '还没有消息';
const EMPTY_FILTER = '当前分类下还没有消息';
const EMPTY_CUSTOMER = '还没有消息。订单有进展时，这里会提醒你。';
const READONLY_COPY = '开发者只读视角不能操作';

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

function existsOf(rel) {
  return fsutil.exists(path.join(ROOT, rel));
}

function stripped(rel) {
  return fsutil.stripComments(textOf(rel));
}

const CUSTOMER_RAW = [
  { type: 'EVENT', title: '已接单', text: '20261022-0031 已接单', orderNo: '20261022-0031', at: '2026-10-22T11:58:00+08:00', read: false },
  { type: 'MESSAGE', title: '兼职留言', text: '放门口就行', orderNo: '20261022-0031', at: '2026-10-22T11:40:00+08:00', read: false },
  { type: 'ANNOUNCEMENT', title: '公告', text: '高峰期提醒', orderNo: '', at: '2026-10-22T10:00:00+08:00', read: true },
  { type: 'NOTICE', title: '系统通知', text: '你与 D4-522A 的绑定已解除', orderNo: '', at: '2026-10-21T09:00:00+08:00', read: true }
];

const PARTNER_RAW = [
  { type: 'EVENT', title: '已接单', text: '20261022-0031 已接单', orderNo: '20261022-0031', at: '2026-10-22T11:58:00+08:00', read: false },
  { type: 'MESSAGE', title: '顾客留言', text: '放门口就行', orderNo: '20261022-0031', at: '2026-10-22T11:40:00+08:00', read: false },
  { type: 'MESSAGE', title: '顾客留言', text: '另一单留言', orderNo: '20261022-0032', at: '2026-10-22T11:20:00+08:00', read: false },
  { type: 'NOTICE', title: '系统通知', text: '绑定已解除', orderNo: '', at: '2026-10-21T09:00:00+08:00', read: false },
  { type: 'ANNOUNCEMENT', title: '公告', text: '高峰期提醒', orderNo: '', at: '2026-10-22T10:00:00+08:00', read: true }
];

const FILES = {
  customerPage: 'pkg-customer/pages/messages/index.js',
  customerWxml: 'pkg-customer/pages/messages/index.wxml',
  customerJson: 'pkg-customer/pages/messages/index.json',
  customerWxss: 'pkg-customer/pages/messages/index.wxss',
  customerParts: 'pkg-customer/pages/messages/parts/message-view.js',
  partnerPage: 'pkg-partner/pages/messages/index.js',
  partnerWxml: 'pkg-partner/pages/messages/index.wxml',
  partnerJson: 'pkg-partner/pages/messages/index.json',
  partnerWxss: 'pkg-partner/pages/messages/index.wxss',
  partnerParts: 'pkg-partner/pages/messages/parts/message-view.js',
  home: 'pages/customer/home/index.js',
  homeWxml: 'pages/customer/home/index.wxml',
  orders: 'pages/customer/orders/index.js',
  homeJson: 'pages/customer/home/index.json',
  workbench: 'pages/partner/workbench/index.js',
  workbenchWxml: 'pages/partner/workbench/index.wxml',
  workbenchJson: 'pages/partner/workbench/index.json',
  workbenchHook: 'pages/partner/workbench/parts/maintenance-hook.js',
  workbenchActions: 'pages/partner/workbench/parts/page-actions.js',
  componentJs: 'components/maintenance-mask/index.js',
  componentJson: 'components/maintenance-mask/index.json',
  componentWxml: 'components/maintenance-mask/index.wxml',
  componentWxss: 'components/maintenance-mask/index.wxss',
  util: 'utils/maintenance.js',
  profileWxml: 'pages/profile/index.wxml',
  tabJs: 'custom-tab-bar/index.js',
  tabWxml: 'custom-tab-bar/index.wxml',
  appJson: 'app.json'
};

function register(h) {
  // ---------------------------------------------------------------- A 顾客消息视图模型
  h.section('A. 顾客消息视图模型：公告置顶去重/未读/水位/时间/空态/红点补丁', (t) => {
    const items = customerView.buildItems(CUSTOMER_RAW, NOW);
    t.eq(items.length, 4, 'A1 四条聚合 DTO 全部成条目（事件/留言/公告/系统通知）');
    t.eq(items[0].typeLabel, '订单动态', 'A2 EVENT 类型中文标签');
    t.eq([items[0].unread, items[1].unread, items[2].unread], [true, true, false], 'A3 未读标记 = DTO read===false');
    t.eq(items[0].time, '2 分钟前', 'A4 时间格式化：2 分钟前');
    t.eq(items[1].time, '20 分钟前', 'A5 时间格式化：20 分钟前');
    t.eq(items[3].time, '昨天 09:00', 'A6 时间格式化：跨天显示「昨天 HH:mm」');
    t.eq(new Set(items.map((item) => item.id)).size, 4, 'A7 条目 id 互不重复（wx:key 稳定）');

    const pinned = customerView.pinAnnouncement(CUSTOMER_RAW, null, NOW);
    t.check(!!pinned.announcement, 'A8 首屏公告置顶卡片非空（合法基线）');
    t.eq(pinned.announcement.headline, '高峰期提醒', 'A9 默认标题「公告」时 headline 取正文（不出现「公告：公告」）');
    t.eq(pinned.announcement.title, '公告', 'A10 公告标题保留服务端值');
    t.eq(pinned.items.length, 3, 'A11 列表剔除公告项（不重复展示）');
    t.check(pinned.items.every((item) => item.type !== 'ANNOUNCEMENT'), 'A12 常规列表不含 ANNOUNCEMENT 条目');

    const named = customerView.pinAnnouncement([
      { type: 'ANNOUNCEMENT', title: '国庆安排', text: '10 月 1 日暂停接单', at: '' }
    ], null, NOW);
    t.eq([named.announcement.headline, named.announcement.body], ['国庆安排', '10 月 1 日暂停接单'],
      'A13 具名公告：headline=标题、body=正文');
    t.eq(named.items.length, 0, 'A14 公告项不进常规列表（空列表合法）');

    const fallback = customerView.pinAnnouncement([], { enabled: true, title: '公告', text: '停水通知' }, NOW);
    t.eq(fallback.announcement.headline, '停水通知', 'A15 服务端无公告项时回落 config.announcement（enabled=true）');
    t.eq(customerView.pinAnnouncement([], { enabled: false, text: '停水通知' }, NOW).announcement, null,
      'A16 config.announcement.enabled=false 一律不展示（DATA_MODEL §2.10）');
    t.eq(customerView.pinAnnouncement([], null, NOW).announcement, null, 'A17 无公告（列表与配置都空）→ 空态不显示公告卡');

    const watermark = '2026-10-22T11:50:00+08:00';
    const marked = customerView.applyReadWatermark(items, watermark);
    t.eq([marked[0].unread, marked[1].unread], [true, false], 'A18 已读水位：晚于水位仍未读、早于水位置已读');
    t.eq(customerView.applyReadWatermark(items, '').every((item) => !item.unread), true,
      'A19 水位缺失（markRead ALL 返回空）→ 全部标为已读回落');
    t.eq(items[0].unread, true, 'A20 水位应用不修改原数组（纯函数）');

    const merged = customerView.mergePage([items[0], items[1]], [items[0], items[3]]);
    t.eq(merged.length, 3, 'A21 追加页合并按 id 去重（跨页重复不二次展示）');
    t.check(merged[0].atMs >= merged[merged.length - 1].atMs, 'A22 追加页合并按时间倒序');
    t.eq(customerView.mergePage(null, null), [], 'A23 合并空输入安全返回空数组');

    const badges = { workbenchPending: 3, messages: 4 };
    t.eq(customerView.badgePatchOf(badges), { workbenchPending: 3, messages: 0 },
      'A24 红点补丁只归零 messages、保留 workbenchPending（不互相覆盖）');
    t.eq(badges.messages, 4, 'A25 红点补丁不修改入参（纯函数）');
    t.eq(customerView.EMPTY_TEXT, EMPTY_CUSTOMER, 'A26 空态文案与 UX_CUSTOMER §3.9 一致');
    t.eq(customerView.READONLY_COPY, READONLY_COPY, 'A27 只读会话文案单源');
    t.eq(customerView.buildItems([{ type: 'EVENT', text: '' }, { type: 'MESSAGE', text: '有内容' }]).length, 1,
      'A28 空文本/空标题 DTO 不成条目（防御脏数据）');
    t.eq(customerView.buildItems(null), [], 'A29 非数组输入安全返回空数组');
  });

  // ---------------------------------------------------------------- B 兼职消息视图模型
  h.section('B. 兼职消息视图模型：全部/订单/留言/公告分类、未读水位、合并、红点补丁', (t) => {
    const items = partnerView.buildMessages(PARTNER_RAW);
    t.eq(items.length, 5, 'B1 五条聚合 DTO 全部成条目');
    t.eq(partnerView.applyFilter(items, 'order').length, 1, 'B2 「订单」桶只含状态事件');
    t.eq(partnerView.applyFilter(items, 'message').length, 3, 'B3 「留言」桶含订单留言+系统通知（4 chip 无死条目）');
    t.eq(partnerView.applyFilter(items, 'announcement').length, 1, 'B4 「公告」桶只含公告项');
    t.eq(partnerView.applyFilter(items, 'all').length, 5, 'B5 「全部」桶不过滤');
    t.eq(partnerView.filterKeyOf('nope'), 'all', 'B6 未知分类 key 回落「全部」不崩');
    t.eq(partnerView.filtersWithCounts(items).map((filter) => filter.key), ['all', 'order', 'message', 'announcement'],
      'B7 分类 chip 顺序 = 全部/订单/留言/公告');
    t.eq(partnerView.filtersWithCounts(items).map((filter) => filter.label), ['全部', '订单', '留言', '公告'],
      'B8 分类 chip 中文标签');
    t.eq(partnerView.filtersWithCounts(items).map((filter) => filter.count), [5, 1, 3, 1],
      'B9 分类 chip 计数与条目一致');
    t.eq(partnerView.emptyTextOf('all'), EMPTY_ALL, 'B10 全部空态文案「还没有消息」');
    t.eq(partnerView.emptyTextOf('order'), EMPTY_FILTER, 'B11 分类空态文案（不冒充分类业务文案）');
    t.eq(partnerView.countUnread(items), 4, 'B12 未读计数含 EVENT/MESSAGE/NOTICE（read=true 的公告不计）');
    t.eq(partnerView.unreadBadgeCount(items), 3,
      'B13 红点口径（D29）= 未读留言+未读状态事件；NOTICE/公告未读不计入红点');
    t.eq(partnerView.readAtMs('2026-10-22T11:50:00+08:00'), Date.parse('2026-10-22T11:50:00+08:00'),
      'B14 已读水位 ISO 字符串转毫秒');
    t.eq([partnerView.readAtMs(''), partnerView.readAtMs(null)], [0, 0], 'B15 水位缺失/非法回 0');
    t.eq(items[0].atText, '2026-10-22 11:58', 'B16 时间格式化 YYYY-MM-DD HH:mm');
    t.eq(items[0].route, '/pkg-partner/pages/order-detail/index?orderNo=20261022-0031', 'B17 订单类条目路由带 orderNo');
    t.eq(items[4].route, '', 'B18 公告项无订单路由（不可误跳）');

    t.eq(partnerView.applyAllRead(items).every((item) => !item.unread), true, 'B19 全部已读：所有条目 unread=false');
    const orderRead = partnerView.applyOrderRead(items, '20261022-0031', '2026-10-22T11:50:00+08:00');
    t.eq([orderRead[0].unread, orderRead[1].unread], [false, false], 'B20 单订单已读：该订单事件+留言置已读');
    t.eq(orderRead[2].unread, true, 'B21 单订单已读：其他订单留言保持未读');
    const watermarkItems = partnerView.buildMessages([
      { type: 'EVENT', orderNo: '20261022-0032', text: 'B 单事件', at: '2026-10-22T11:45:00+08:00', read: false },
      { type: 'MESSAGE', orderNo: '20261022-0032', text: 'B 单留言', at: '2026-10-22T11:44:00+08:00', read: false }
    ]);
    const watermarkRead = partnerView.applyOrderRead(watermarkItems, '20261022-0031', '2026-10-22T11:50:00+08:00');
    t.eq([watermarkRead[0].unread, watermarkRead[1].unread], [false, true],
      'B22 已读水位只作用于状态事件，不误标记其他订单留言');

    const page = partnerView.buildMessages([
      { type: 'MESSAGE', orderNo: '20261022-0031', text: '新留言', at: '2026-10-22T12:00:00+08:00', read: false }
    ]);
    const appendMerged = partnerView.mergeMessages(items, page.concat([items[0]]));
    t.eq(appendMerged.length, 6, 'B23 追加合并按 id 去重');
    t.check(appendMerged[0].atMs >= appendMerged[1].atMs, 'B24 追加合并按时间倒序');
    t.eq(partnerView.mergeMessages(null, null), [], 'B25 合并空输入安全');
    t.eq(partnerView.badgePatchOf({ workbenchPending: 2, messages: 5 }, 1), { workbenchPending: 2, messages: 1 },
      'B26 红点补丁只改 messages、保留 workbenchPending');
    t.eq(partnerView.badgePatchOf({ messages: 5 }, 'NaN'), { messages: 0 }, 'B27 异常未读数安全归零');
    t.eq(partnerView.buildMessages([{ type: 'MESSAGE', text: '' }]), [], 'B28 空内容 DTO 不成条目');
    t.eq(partnerView.buildMessages(PARTNER_RAW)[4].typeLabel, '公告', 'B29 公告类型中文标签');
    t.eq(partnerView.buildMessages([{ type: 'MESSAGE', text: 'x', read: true }])[0].unread, false,
      'B30 read=true 不显示未读圆点');
    t.eq(partnerView.READONLY_COPY, READONLY_COPY, 'B31 只读会话文案单源');

    // D29 红点：服务端 unread 优先（含状态事件），旧字段 unreadMessages 仅留言 → 缺 unread 时回落本地新口径
    t.eq(partnerView.serverUnreadOf({ unread: 5, unreadMessages: 2 }, items), 5,
      'B32 服务端 unread=5/unreadMessages=2 → 红点取 5（D29 新口径优先）');
    t.eq(partnerView.serverUnreadOf({ unreadMessages: 2 }, items), 3,
      'B33 仅返回旧字段 unreadMessages 时回落本地新口径计数 3（不沿用只算留言的旧字段）');
    t.eq(partnerView.serverUnreadOf({ unread: -3 }, items), 0, 'B34 服务端 unread 负数一律钳到 0（不为负）');
    t.eq(partnerView.serverUnreadOf(null, items), 3, 'B35 无 unread 字段（含 data 为空）回落本地计数，空数据不崩');
    const orderBefore = items.filter((item) => item.orderNo === '20261022-0031');
    const orderReadAfter = partnerView.applyOrderRead(items, '20261022-0031', '2026-10-22T11:50:00+08:00');
    t.eq([partnerView.unreadBadgeCount(orderBefore), partnerView.unreadBadgeCount(orderReadAfter)],
      [2, 1], 'B36 markOrderRead 后该单 MESSAGE+EVENT 未读均减（红点 3→1，跨单水位一并收敛）');
    t.check(/view\.serverUnreadOf/.test(textOf(FILES.partnerPage))
      && /view\.unreadBadgeCount/.test(textOf(FILES.partnerPage)),
    'B37 页面红点取值/单订单扣减均走纯件新口径（不保留「只算未读留言」旧实现）');
  });

  // ---------------------------------------------------------------- C api 层（fake transport）
  h.section('C. api/modules/message：fake transport 请求/响应映射、重试策略、READONLY/ticket', async (t) => {
    store.reset();
    const calls = [];
    let handler = null;
    client.setTransport(function fake(payload) {
      calls.push(payload);
      return handler(payload);
    });
    const respond = (data) => function ok() {
      return Promise.resolve({ ok: true, serverTime: Date.now(), data: data });
    };
    try {
      handler = respond({ list: [], nextCursor: null, messageReadAt: '', unreadMessages: 0 });
      const listData = await messageApi.list({ limit: 30 });
      t.eq(calls[0].action, 'message.list', 'C1 message.list 请求 action 正确');
      t.eq(calls[0].data, { limit: 30 }, 'C2 message.list 入参原样透传（分页 limit）');
      t.eq(listData.unreadMessages, 0, 'C3 message.list 响应 data 映射返回');

      calls.length = 0;
      let attempt = 0;
      handler = function retryOnce() {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new client.CallError('INTERNAL_ERROR', '临时故障'));
        }
        return Promise.resolve({ ok: true, serverTime: Date.now(), data: { list: [] } });
      };
      await messageApi.list({});
      t.eq([calls.length, attempt], [2, 2], 'C4 读动作失败按 RETRYABLE_CODES 重试一次后成功');

      calls.length = 0;
      handler = respond({ messageReadAt: '2026-10-22T12:00:00.000Z', orderMessagesRead: 1 });
      const readData = await messageApi.markRead({ scope: 'ALL' });
      t.eq([calls[0].action, calls[0].data], ['message.markRead', { scope: 'ALL' }],
        'C5/C6 markRead 请求 action 与 scope=ALL 透传');
      t.eq(readData.messageReadAt, '2026-10-22T12:00:00.000Z', 'C7 markRead 响应 messageReadAt 映射');

      calls.length = 0;
      handler = function alwaysFail() {
        return Promise.reject(new client.CallError('INTERNAL_ERROR', '写失败'));
      };
      let writeError = null;
      try {
        await messageApi.markRead({ scope: 'ALL' });
      } catch (err) {
        writeError = err;
      }
      t.eq([writeError && writeError.code, calls.length], ['INTERNAL_ERROR', 1], 'C8 写动作不自动重试（一次请求即抛出）');

      calls.length = 0;
      handler = respond({ list: [] });
      store.setViewContext({ viewMode: 'READONLY', role: 'CUSTOMER', targetNo: 'C-1234' });
      let readonlyError = null;
      try {
        await messageApi.markRead({ scope: 'ALL' });
      } catch (err) {
        readonlyError = err;
      }
      t.eq([readonlyError && readonlyError.code, calls.length], ['FORBIDDEN', 0],
        'C9 READONLY 会话 markRead 客户端即拦（零请求，服务端二道闸）');
      store.setViewContext({ viewMode: 'READONLY', role: 'CUSTOMER', viewTicket: 'VT-0001', targetNo: 'C-1234' });
      calls.length = 0;
      await messageApi.list({});
      t.eq(calls[0].viewTicket, 'VT-0001', 'C10 只读会话读动作注入 viewTicket（票据只经 api/client）');
      store.clearViewContext();

      calls.length = 0;
      handler = function invalidState() {
        return Promise.resolve({ ok: false, code: 'INVALID_STATE', serverTime: Date.now() });
      };
      let codeError = null;
      try {
        await messageApi.list({});
      } catch (err) {
        codeError = err;
      }
      t.eq(codeError && codeError.message, errorCopy.CODE_COPY.INVALID_STATE,
        'C11 失败无 message 时回落 shared/error-copy 人话（不上屏英文 code）');

      handler = function maintenanceState() {
        return Promise.resolve({
          ok: false, code: 'INVALID_STATE', message: '系统维护中，请稍后再试', serverTime: Date.now()
        });
      };
      let maintenanceError = null;
      try {
        await messageApi.markRead({ scope: 'ALL' });
      } catch (err) {
        maintenanceError = err;
      }
      t.eq([maintenanceError && maintenanceError.message,
        maintenance.writeRejectedTextOf(maintenanceError)],
      ['系统维护中，请稍后再试', WRITE_REJECTED], 'C12 服务端维护文案保留 + 端侧统一维护写拒绝文案命中');
    } finally {
      client.restoreTransport();
      store.reset();
    }
  });

  // ---------------------------------------------------------------- D 红点单源
  h.section('D. 红点单源：消息页归零不覆盖工作台角标；我的格/入口同读 badges.messages', (t) => {
    t.eq(loadView.badgePatch({ submitted: 5, messages: 0 }, { workbenchPending: 1, messages: 2 }),
      { workbenchPending: 5, messages: 2 }, 'D1 工作台角标只改 workbenchPending、保留 messages');
    t.eq(loadView.badgePatch({ submitted: 0 }, { messages: 2 }), { workbenchPending: 0, messages: 2 },
      'D2 工作台角标无历史键时不吞 messages');

    store.reset();
    store.patch({ badges: { workbenchPending: 3, messages: 4 } });
    store.patch({ badges: customerView.badgePatchOf(store.get('badges')) });
    t.eq(store.get('badges'), { workbenchPending: 3, messages: 0 },
      'D3 消息页全部已读：messages 归零、workbenchPending 逐字节保留');
    store.patch({ badges: loadView.badgePatch({ submitted: 2 }, store.get('badges')) });
    t.eq(store.get('badges'), { workbenchPending: 2, messages: 0 },
      'D4 工作台刷新后不把已归零的 messages 重新点亮（双向不覆盖）');

    t.eq(profileVm.buildVm({ badges: { messages: 2 } }).messagesBadge, 2,
      'D5 我的页红点读 store.badges.messages（同源）');
    t.eq(profileVm.buildVm({ badges: {} }).messagesBadge, 0, 'D6 无未读时我的页红点为 0');

    const tabJs = textOf(FILES.tabJs);
    const profileBadges = tabJs.match(/pagePath: 'pages\/profile\/index'[^\n]*badgeKey: 'messages'/g) || [];
    t.eq(profileBadges.length, 2, 'D7 两角色「我的」tab 均带 badgeKey=messages（我的格未读红点）');
    t.check(/item\.badgeKey\s*&&\s*badges\[item\.badgeKey\]/.test(textOf(FILES.tabWxml)),
      'D8 custom-tab-bar wxml 按 badgeKey 渲染红点（订阅 store 自动刷新）');

    const profileWxml = textOf(FILES.profileWxml);
    t.eq((profileWxml.match(/wx:if="\{\{messagesBadge\}\}" class="red-dot"/g) || []).length, 2,
      'D9 我的页消息入口为红点（顾客+兼职两视图，UX_CUSTOMER §3.5/§8.2）');
    t.check(/Object\.assign\(\{ workbenchPending: 0 \}, badges, \{ messages: messages \}\)/.test(textOf(FILES.home)),
      'D10 首页未读刷新保留 workbenchPending（只改 messages）');
    t.check(/vm\.badges\.messages/.test(textOf(FILES.homeWxml)), 'D11 首页铃铛红点按 badges.messages 渲染');
    t.check(/badgePatchOf/.test(textOf(FILES.partnerPage)), 'D12 兼职消息页红点补丁走纯件（不手写覆盖）');

    // A 批 P1-5：顾客「订单」格数量角标 ordersOngoing（数量角标不清零，与红点语义区分）
    const ordersTabBadge = textOf(FILES.tabJs)
      .match(/pagePath: 'pages\/customer\/orders\/index'[^\n]*badgeKey: 'ordersOngoing'/g) || [];
    t.eq(ordersTabBadge.length, 1, 'D13 顾客「订单」tab 按 badgeKey=ordersOngoing 渲染数量角标（P1-5）');
    t.check(/ordersOngoing/.test(textOf(FILES.home)) && /counts\.ongoing/.test(textOf(FILES.home)),
      'D14 首页用 order.listCustomer 的 counts.ongoing 更新 ordersOngoing（onShow/下拉刷新，无轮询）');
    t.check(/ordersOngoing/.test(textOf(FILES.orders)) && /counts\.ongoing/.test(textOf(FILES.orders)),
      'D15 订单列表同源更新 ordersOngoing（服务端 counts 不受 tab/关键词影响）');
    t.check(!/ordersOngoing:\s*0/.test(textOf(FILES.home)) && !/ordersOngoing:\s*0/.test(textOf(FILES.orders)),
      'D16 页面无「进列表/点击清零」写法（数量角标不清零）');
    store.reset();
    store.patch({ badges: Object.assign({}, store.get('badges'), { ordersOngoing: 3 }) });
    store.patch({ badges: Object.assign({}, store.get('badges'), { messages: 2 }) });
    t.eq(store.get('badges'), { workbenchPending: 0, messages: 2, ordersOngoing: 3 },
      'D17 ordersOngoing 与 messages 双向不覆盖（同一 badges 键合并、保留其他键）');
    store.reset();
  });

  // ---------------------------------------------------------------- E 维护模式纯件
  h.section('E. utils/maintenance 全分支：配置归一/默认文案/opts/写拒绝文案', (t) => {
    const EMPTY_VIEW = { enabled: false, text: '', title: '', blocked: false, copy: '' };
    t.eq(maintenance.buildMaintenanceView(null), EMPTY_VIEW, 'E1 配置缺失 → 未维护（全空视图）');
    t.eq(maintenance.buildMaintenanceView(undefined), EMPTY_VIEW, 'E2 配置 undefined → 未维护');
    t.eq(maintenance.buildMaintenanceView({ privacyVersion: 'v1' }).enabled, false, 'E3 无 maintenance 块的 configPublic → 未维护');
    t.eq(maintenance.buildMaintenanceView({ maintenance: { enabled: false, text: '恢复中' } }).enabled, false,
      'E4 maintenance.enabled=false → 未维护');

    const enabled = maintenance.buildMaintenanceView({ maintenance: { enabled: true, text: '  预计 10:30 恢复  ' } });
    t.eq(enabled.text, '预计 10:30 恢复', 'E5 maintenance.text 去首尾空白');
    t.eq(enabled.title, '系统维护中', 'E6 维护标题固定文案（UX_DEVELOPER §7.5）');
    t.eq(enabled.blocked, true, 'E7 维护中写入口 blocked=true');
    t.eq(enabled.copy, WRITE_REJECTED, 'E8 写动作被拒统一维护文案');
    t.eq(maintenance.buildMaintenanceView({ enabled: true, text: '单对象维护' }).enabled, true,
      'E9 也接受 maintenance 单对象形态（容错旧缓存）');
    t.eq(maintenance.buildMaintenanceView({ maintenance: { enabled: true, text: '' } }).text,
      '系统维护中，请稍后再来；急单请留言或联系开发者。', 'E10 维护中 text 为空 → 兜底真话文案（不显示占位符）');
    t.eq(maintenance.buildMaintenanceView({ maintenance: { enabled: true, text: '' } }, { defaultText: '自定义说明' }).text,
      '自定义说明', 'E11 opts.defaultText 可覆写兜底文案');
    t.eq(maintenance.buildMaintenanceView({ maintenance: { enabled: true, text: 'x' } }, { title: '维护通知' }).title,
      '维护通知', 'E12 opts.title 可覆写标题');
    t.eq(maintenance.buildMaintenanceView(null, { title: '维护通知' }).title, '', 'E13 未维护时 opts.title 不生效（不误报维护）');
    t.eq(maintenance.buildMaintenanceView({ maintenance: { enabled: 'yes', text: 'x' } }).enabled, false,
      'E14 enabled 非布尔 true 一律不认（严格 ===true，不猜）');
    t.eq(maintenance.buildMaintenanceView({ maintenance: { enabled: true, text: 123 } }).text,
      '系统维护中，请稍后再来；急单请留言或联系开发者。', 'E15 text 非字符串 → 兜底文案');
    t.eq(maintenance.buildMaintenanceView({ maintenance: null }).enabled, false, 'E16 maintenance=null → 未维护');
    t.eq(maintenance.buildMaintenanceView({ maintenance: [] }).enabled, false, 'E17 maintenance 非对象数组 → 未维护');
    t.eq(Object.keys(enabled).sort(), ['blocked', 'copy', 'enabled', 'text', 'title'],
      'E18 视图键集合固定五键 {enabled,text,title,blocked,copy}');

    t.eq(maintenance.writeRejectedTextOf(null), '', 'E19 无错误 → 空串（调用方回落原文案）');
    t.eq(maintenance.writeRejectedTextOf({ code: 'INVALID_STATE', message: '系统维护中，请稍后再试' }), WRITE_REJECTED,
      'E20 服务端维护闸错误（INVALID_STATE+维护）→ 统一维护文案');
    t.eq(maintenance.writeRejectedTextOf({ code: 'INVALID_STATE', message: '请先同意最新隐私保护指引' }), '',
      'E21 隐私同意闸同为 INVALID_STATE 但不误判为维护');
    t.eq(maintenance.writeRejectedTextOf({ code: 'FORBIDDEN', message: '系统维护中' }), '',
      'E22 错误码不符（FORBIDDEN）不套维护文案');
    t.eq(maintenance.writeRejectedTextOf({ code: 'INVALID_STATE', message: '维护中' }), WRITE_REJECTED,
      'E23 服务端短文案「维护中」也命中');
  });

  // ---------------------------------------------------------------- F 静态纪律/挂钩
  h.section('F. 静态纪律：四件套/无 wx.cloud/无存储敏感值/零金额/行数/组件页面级注册/挂钩', (t) => {
    const pageFiles = [FILES.customerPage, FILES.partnerPage];
    const fourPiece = (prefix) => ['.js', '.json', '.wxml', '.wxss'].every((ext) => existsOf(prefix + ext));
    t.eq([fourPiece('pkg-customer/pages/messages/index'), fourPiece('pkg-partner/pages/messages/index')],
      [true, true], 'F1/F2 两消息页四件套齐全');
    t.check([FILES.customerWxml, FILES.partnerWxml].every((file) => textOf(file).indexOf('<switch-bar') >= 0),
      'F3 两消息页保留切换会话顶栏（#23 不旁路）');
    t.check(pageFiles.every((file) => stripped(file).indexOf('wx.cloud') === -1),
      'F4 两消息页零 wx.cloud.*（页面层零直连）');
    t.check(pageFiles.every((file) => !/wx\.(get|set|remove)Storage/.test(stripped(file) || ''))
      && !/StorageSync/.test(stripped(FILES.customerPage) + stripped(FILES.partnerPage)),
    'F5 两消息页零本地存储调用（公告/维护关闭只做会话态）');
    t.check(pageFiles.every((file) => textOf(file).indexOf('avatarFileId') === -1),
      'F6 消息页不出现 avatarFileId（通知不含头像/昵称）');
    t.check(pageFiles.every((file) => !/pickupCode|phoneTail|lockerNo|openid/.test(stripped(file) || '')),
      'F7 消息页零 L3 敏感字段字面量（取件码/尾号/柜号/openid）');

    const zhStatuses = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
    const statusHits = [];
    pageFiles.forEach((file) => {
      const source = stripped(file) || '';
      zhStatuses.forEach((status) => {
        if (new RegExp("['\"]" + status + "['\"]").test(source)) {
          statusHits.push(file + ':' + status);
        }
      });
    });
    t.eq(statusHits, [], 'F8 两消息页零七状态字符串字面量（#21 页面层零判据）');

    const customerPage = textOf(FILES.customerPage);
    t.check(/guard\(\)/.test(customerPage) && /messageApi\.list\(\{ limit: PAGE_SIZE \}\)/.test(customerPage)
      && /messageApi\.markRead\(\{ scope: 'ALL' \}\)/.test(customerPage) && /loadMore\(\)/.test(customerPage)
      && /onCloseAnnouncement/.test(customerPage),
    'F9 顾客消息页：身份闸/首屏 list/已读水位上报/游标分页/公告会话内关闭接线');
    t.check(/clearBadge/.test(customerPage) && /messages: 0/.test(customerPage),
      'F10 顾客消息页全部已读后红点归零（badges.messages 单源，兼容 E13 断言）');

    const partnerPage = textOf(FILES.partnerPage);
    t.check(/onFilterTap/.test(partnerPage) && /view\.applyFilter/.test(partnerPage)
      && /setInterval\(\(\) => this\.poll\(\), POLL_MS\)/.test(partnerPage)
      && /onHide\(\)\s*\{[\s\S]*stopPolling/.test(partnerPage) && /onUnload\(\)\s*\{[\s\S]*stopPolling/.test(partnerPage),
    'F11 兼职消息页：分类 chip + 30s 轮询 + onHide/onUnload 停表');
    t.check(/readonly/.test(partnerPage) && /view\.READONLY_COPY/.test(partnerPage)
      && /scope: 'ORDER'/.test(partnerPage),
    'F12 兼职消息页：READONLY 标记已读置灰（不写）+ 单订单已读 scope=ORDER');
    t.check(/view\.mergeMessages/.test(partnerPage) && /badgePatchOf/.test(textOf(FILES.partnerParts)),
      'F13 兼职消息页追加合并去重 + 红点补丁纯件');

    const homeWxml = textOf(FILES.homeWxml);
    t.check(/<maintenance-mask/.test(homeWxml) && /enabled="\{\{maintenance\.visible\}\}"/.test(homeWxml),
      'F14 顾客首页 wxml 挂维护遮罩并绑定 enabled');
    const homeJson = fsutil.readJson(path.join(ROOT, FILES.homeJson));
    t.eq(homeJson.usingComponents && homeJson.usingComponents['maintenance-mask'],
      '/components/maintenance-mask/index', 'F15 顾客首页 json 页面级注册维护组件（不改 app.json）');
    t.check(/utils\/maintenance/.test(textOf(FILES.home)) && /maintenance\.buildMaintenanceView/.test(textOf(FILES.home)),
      'F16 顾客首页 index.js 引用纯件并调用 buildMaintenanceView');
    t.check(/onShow\(\)\s*\{[\s\S]*this\.refreshConfig\(\)/.test(textOf(FILES.home))
      && /refreshConfig\(\)/.test(textOf(FILES.home)),
    'F17 顾客首页 onShow 60s 节流刷 configPublic（维护/公告生效）');
    t.check(/function announcementOf/.test(textOf(FILES.home)) && /enabled === false/.test(textOf(FILES.home)),
      'F18 顾客首页公告按 announcement.enabled 展示（关闭即不展示）');

    t.check(/<maintenance-mask/.test(textOf(FILES.workbenchWxml))
      && /enabled="\{\{maintenance\.visible\}\}"/.test(textOf(FILES.workbenchWxml)),
    'F19 兼职工作台 wxml 挂维护遮罩并绑定 enabled');
    const workbenchJson = fsutil.readJson(path.join(ROOT, FILES.workbenchJson));
    t.eq(workbenchJson.usingComponents && workbenchJson.usingComponents['maintenance-mask'],
      '/components/maintenance-mask/index', 'F20 兼职工作台 json 页面级注册维护组件');
    const hook = textOf(FILES.workbenchHook);
    t.check(/utils\/maintenance/.test(hook) && /buildMaintenanceView/.test(hook) && /syncMaintenance/.test(hook),
      'F21 工作台维护挂钩引用纯件（configPublic → 遮罩）');
    t.check(/onShow\(\)\s*\{[\s\S]*this\.syncMaintenance\(\)/.test(textOf(FILES.workbench))
      && /onShow\(\)\s*\{[\s\S]*this\.refreshConfig\(\)/.test(textOf(FILES.workbench)),
    'F22 工作台 onShow 读 store configPublic.maintenance（遮罩 + 60s 刷新）');
    t.check(/writeRejectedTextOf/.test(textOf(FILES.workbenchActions)) && /syncMaintenance/.test(textOf(FILES.workbenchActions)),
      'F23 工作台写动作被维护闸拒绝 → 统一维护文案上屏（不吞错、不暴露英文码）');

    t.check([FILES.componentJs, FILES.componentJson, FILES.componentWxml, FILES.componentWxss]
      .every((file) => existsOf(file)), 'F24 维护遮罩组件四件套齐全');
    t.eq(fsutil.readJson(path.join(ROOT, FILES.componentJson)).component, true, 'F25 组件 json component=true');
    t.check(/bindtap="onAck"/.test(textOf(FILES.componentWxml)) && /catchtap="noop"/.test(textOf(FILES.componentWxml)),
      'F26 遮罩 ack 关闭 + 自身吞点击防穿透');
    const appJson = fsutil.readJson(path.join(ROOT, FILES.appJson));
    t.eq((appJson.usingComponents || {})['maintenance-mask'], undefined,
      'F27 maintenance-mask 仅页面级注册（app.json 全局注册零改动）');

    const lineLimited = [
      FILES.customerPage, FILES.customerParts, FILES.partnerPage, FILES.partnerParts,
      FILES.home, FILES.homeWxml, FILES.workbench, FILES.workbenchHook, FILES.workbenchActions,
      FILES.componentJs, FILES.util, FILES.tabJs
    ];
    const over = lineLimited.filter(function tooLong(rel) {
      return fsutil.lineCount(fsutil.readText(path.join(ROOT, rel))) > 500;
    });
    t.eq(over, [], 'F28 新增/修改源码单文件 ≤500 行（AGENTS §4.2 门禁 #18 口径）');

    const suiteLines = fsutil.lineCount(fsutil.readText(path.join(ROOT, 'tools/selftest-message-pages.js')));
    t.eq([suiteLines <= 1000, fsutil.syntaxCheck(textOf('tools/selftest-message-pages.js'), 'selftest-message-pages').ok],
      [true, true], 'F29 本套件 ≤1000 行且语法可编译');

    const zm = zeroMoney.run({ scope: 'source' });
    const mine = {
      files: [FILES.customerPage, FILES.customerParts, FILES.partnerPage, FILES.partnerParts,
        FILES.home, FILES.homeWxml, FILES.workbench, FILES.workbenchHook, FILES.workbenchActions,
        FILES.componentWxml, FILES.componentWxss, FILES.util]
    };
    const moneyHits = zm.hits.filter((hit) => mine.files.indexOf(hit.file) >= 0);
    t.eq(moneyHits, [], 'F30 新增/修改文案零金额词（tools/zero-money-scan.js 官方扫描器）');

    const storageHits = [];
    [FILES.home, FILES.workbench, FILES.workbenchHook, FILES.customerPage, FILES.partnerPage].forEach((file) => {
      const source = stripped(file) || '';
      const hits = source.match(/(maintenance|announcement|announcementClosed|maintenanceClosed)[^\n]*Storage|Storage[^\n]*(maintenance|announcement)/g);
      if (hits) storageHits.push(file + ':' + hits.join(','));
    });
    t.eq(storageHits, [], 'F31 维护/公告会话态不写本地存储（只内存态，无敏感值落盘）');

    const syntaxBad = [FILES.customerPage, FILES.customerParts, FILES.partnerPage, FILES.partnerParts,
      FILES.home, FILES.workbench, FILES.workbenchHook, FILES.workbenchActions, FILES.componentJs, FILES.util]
      .filter((file) => !fsutil.syntaxCheck(textOf(file), file).ok);
    t.eq(syntaxBad, [], 'F32 全部新增/修改 JS 语法可编译（node --check 等价）');

    const componentWxss = textOf(FILES.componentWxss);
    t.check(/\.mm-mask/.test(componentWxss) && /\.mm-card/.test(componentWxss)
      && /\.mm-btn/.test(componentWxss) && /\.mm-title/.test(componentWxss),
    'F33 组件 wxss 定义 wxml 使用的全部类（#9 真机无样式静默失败）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-message-pages' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-message-pages');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
