'use strict';
/**
 * tools/selftest-messages.js — 批 8「消息中心服务端」断言套件（task-75）。
 *
 * A 聚合口径：消息中心 = order_events（状态类）+ order_messages + config.announcement 合并视图，无 notifications 集合；
 *   顾客/兼职两角色各自只看本人订单；公告项形状；系统通知按历史绑定兼职归属过滤；测试数据隔离。
 * B 已读水位：users.messageReadAt 只前进；事件 read 与水位一致；own/系统通知 read 语义；unread=未读留言计数。
 * C markRead：scope 枚举/ORDER 归属/幂等/READONLY 拒写/后台只读不可代操作；ORDER scope 只标对方留言。
 * D 分页：limit/cursor 不重不漏、末页 nextCursor=null、unread 与游标无关。
 * E 公告：enabled 开关生效（关闭不下发）、标题/正文/read 语义。
 * F 权限与写动作：非顾客/兼职身份拒绝、他人订单拒绝、终态留言闸、文本上限、真实×测试隔离、message.send 幂等。
 * G 静态纪律：无 notifications 集合、message 域零 db.collection、DTO 键白名单、READONLY 读白名单含 message.list。
 *
 * 纪律：fake DB + createApi 全链路（app.js 中间件链）或 handler 直调；不 mock 全局 wx、不连真实网络/真库；
 *      先合法基线再反例；EXPECTED_ASSERTIONS 与实际精确相等。
 * 取数：node tools/selftest-messages.js | Select-Object -Last 2
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { createHarness, installCrashGuard } = require('./selftest');
const { createFakeDb } = require('./fake-db');
const { createApi } = require(path.join(ROOT, 'cloudfunctions/api/app.js'));
const messageCommon = require(path.join(ROOT, 'cloudfunctions/api/handlers/message/_common.js'));
const switchSession = require(path.join(ROOT, 'cloudfunctions/api/middleware/switch-session.js'));
const collections = require(path.join(ROOT, 'cloudfunctions/api/shared/collections.js'));

const EXPECTED_ASSERTIONS = 89;

const NOW = Date.UTC(2026, 9, 22, 5, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const C1 = 'c1-openid';
const C2 = 'c2-openid';
const P1 = 'p1-openid';
const P2 = 'p2-openid';
const P3 = 'p3-openid';
const PID1 = 'pid-1';
const PID2 = 'pid-2';
const PID3 = 'pid-3';
const TEST_C = 'TEST-CUST0000001';
const TEST_P = 'TEST-PART0000001';
const TEST_PID = 'test-pid-1';
const VIEW_TICKET = 'T'.repeat(32);

const ADMIN_ENV = { ADMIN_OPENIDS: JSON.stringify({ 'admin-openid': 'DEV-01' }) };
const READONLY_TICKET = 'R'.repeat(32);
const TEST_WRITE_TICKET = 'W'.repeat(32);

function userDoc(openid, roles, extra) {
  return Object.assign({
    _id: openid,
    roles: roles || [],
    status: 'ACTIVE',
    isTestAccount: false,
    messageReadAt: 0,
    privacyConsent: { version: 'v4.0', at: NOW },
    createdAt: new Date(NOW - 30 * 24 * HOUR),
    updatedAt: new Date(NOW - HOUR)
  }, extra || {});
}

function orderDoc(orderNo, status, extra) {
  return Object.assign({
    orderNo,
    status,
    customerId: C1,
    customerOpenid: C1,
    customerNo: 'CADEFGHJK',
    partnerId: PID1,
    partnerOpenid: P1,
    partnerNo: 'PAAAAAA',
    isTest: false,
    version: 1,
    service: { code: 'PICKUP_STD', name: '标准代取' },
    dorm: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522' },
    parcel: { stationId: 'P1', stationName: '菜鸟驿站P1', pickupCode: 'A1234', lockerNo: '12号柜', trackingTail: '7788' },
    createdAt: new Date(NOW - 2 * HOUR),
    statusUpdatedAt: new Date(NOW - HOUR),
    updatedAt: new Date(NOW - HOUR)
  }, extra || {});
}

function messageDoc(orderId, fromRole, fromId, text, at, extra) {
  return Object.assign({
    orderId,
    fromRole,
    fromId,
    text,
    templateCode: null,
    createdAt: new Date(at),
    readAt: null,
    requestKey: 'msg-' + orderId + '-' + fromId + '-' + at
  }, extra || {});
}

function eventDoc(orderId, orderNo, type, toStatus, at, extra) {
  return Object.assign({
    orderId,
    orderNo,
    type,
    fromStatus: 'SUBMITTED',
    toStatus,
    actorRole: 'PARTNER',
    actorId: P1,
    impersonatedBy: '',
    at: new Date(at),
    note: '',
    payload: {},
    requestKey: 'ev-' + orderId + '-' + at
  }, extra || {});
}

function world(options) {
  const opts = options || {};
  const db = createFakeDb({
    uniqueIndexes: {
      orders: [['orderNo'], ['requestKey']],
      order_events: [['requestKey']],
      order_messages: [['requestKey']],
      bindings: [['activeKey']]
    }
  });
  db.seed('users', [
    userDoc(C1, ['CUSTOMER']),
    userDoc(C2, ['CUSTOMER']),
    userDoc(P1, ['PARTNER']),
    userDoc(P2, ['PARTNER']),
    userDoc(P3, ['PARTNER']),
    userDoc(TEST_C, ['CUSTOMER'], { isTestAccount: true, privacyConsent: null }),
    userDoc(TEST_P, ['PARTNER'], { isTestAccount: true, privacyConsent: null })
  ]);
  db.seed('config', [{
    _id: 'global',
    privacyVersion: 'v4.0',
    maintenance: { enabled: false, text: '' },
    announcement: opts.announcement === undefined
      ? { enabled: true, title: '开学季', text: '驿站 22:00 关门，请尽早取件。', updatedAt: NOW - 3 * HOUR }
      : opts.announcement
  }]);
  db.seed('partners', [
    { _id: PID1, openid: P1, partnerNo: 'PAAAAAA', displayName: '老张', status: 'ACTIVE', serviceConfig: {} },
    { _id: PID2, openid: P2, partnerNo: 'PBBBBBB', displayName: '老王', status: 'ACTIVE', serviceConfig: {} },
    { _id: PID3, openid: P3, partnerNo: 'PCCCCCC', displayName: '老李', status: 'ACTIVE', serviceConfig: {} },
    { _id: TEST_PID, openid: TEST_P, partnerNo: 'PTESTAA', displayName: '测试-老张', status: 'ACTIVE', serviceConfig: {} }
  ]);
  db.seed('customers', [
    { _id: C1, customerNo: 'CADEFGHJK', displayName: '小王', zone: 'D', buildingNo: 4, room: '522', profileCompleted: true },
    { _id: C2, customerNo: 'CBBBBBBB', displayName: '小李', zone: 'X', buildingNo: 3, room: '301', profileCompleted: true }
  ]);
  db.seed('bindings', [
    {
      _id: 'bind-active', customerId: C1, partnerId: PID1, status: 'ACTIVE',
      activeKey: C1 + ':ACTIVE:' + PID1, roomTag: 'A', boundAt: new Date(NOW - 10 * 24 * HOUR)
    },
    {
      _id: 'bind-released', customerId: C1, partnerId: PID2, status: 'RELEASED',
      activeKey: C1 + ':RELEASED:bind-released', roomTag: 'B',
      boundAt: new Date(NOW - 20 * 24 * HOUR), releasedAt: new Date(NOW - 2 * 24 * HOUR)
    }
  ]);
  db.seed('orders', [
    orderDoc('20260101-0001', 'SUBMITTED', { _id: 'ord-1' }),
    orderDoc('20260101-0002', 'COMPLETED', {
      _id: 'ord-2', completedAt: new Date(NOW - 20 * HOUR), statusUpdatedAt: new Date(NOW - 20 * HOUR)
    }),
    orderDoc('20260101-0003', 'SUBMITTED', {
      _id: 'ord-other', customerId: C2, customerOpenid: C2, customerNo: 'CBBBBBBB'
    }),
    orderDoc('20260101-0007', 'SUBMITTED', {
      _id: 'ord-p2', customerId: C2, customerOpenid: C2, customerNo: 'CBBBBBBB',
      partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB'
    }),
    orderDoc('20260101-0005', 'COMPLETED', {
      _id: 'ord-deleted', deletedByCustomerAt: new Date(NOW - HOUR)
    }),
    orderDoc('20260101-0004', 'SUBMITTED', {
      _id: 'ord-test', customerId: TEST_C, customerOpenid: TEST_C, customerNo: 'CTESTAAAA',
      partnerId: TEST_PID, partnerOpenid: TEST_P, partnerNo: 'PTESTAA', isTest: true
    })
  ]);
  db.seed('order_events', [
    eventDoc('ord-1', '20260101-0001', 'ACCEPTED', 'ACCEPTED', NOW - 90 * MINUTE,
      { fromStatus: 'SUBMITTED', note: '' }),
    eventDoc('ord-1', '20260101-0001', 'CANCELLED', 'CANCELLED', NOW - 60 * MINUTE,
      { fromStatus: 'ACCEPTED', actorRole: 'CUSTOMER', actorId: C1, note: '不需要了' }),
    eventDoc('ord-2', '20260101-0002', 'COMPLETED', 'COMPLETED', NOW - 20 * HOUR, { fromStatus: 'DELIVERED' }),
    eventDoc('ord-other', '20260101-0003', 'ACCEPTED', 'ACCEPTED', NOW - 70 * MINUTE, { fromStatus: 'SUBMITTED' }),
    eventDoc('ord-p2', '20260101-0007', 'ACCEPTED', 'ACCEPTED', NOW - 65 * MINUTE, {
      fromStatus: 'SUBMITTED', actorId: P2, actorRole: 'PARTNER'
    }),
    eventDoc('ord-test', '20260101-0004', 'ACCEPTED', 'ACCEPTED', NOW - 40 * MINUTE, { fromStatus: 'SUBMITTED' })
  ]);
  db.seed('order_messages', [
    messageDoc('ord-1', 'CUSTOMER', C1, '麻烦放到楼下', NOW - 80 * MINUTE),
    messageDoc('ord-1', 'PARTNER', P1, '好的，10 分钟到', NOW - 70 * MINUTE),
    messageDoc('ord-1', 'PARTNER', P1, '已取到', NOW - 50 * MINUTE),
    messageDoc('ord-2', 'CUSTOMER', C2, '别人订单的留言', NOW - 19 * HOUR),
    messageDoc('ord-test', 'PARTNER', TEST_P, '测试留言', NOW - 30 * MINUTE, { isTest: true }),
    messageDoc('', 'PARTNER', P1, '你与老张的绑定已解除', NOW - 5 * HOUR,
      { templateCode: 'BIND_RELEASED' }),
    messageDoc('', 'PARTNER', P3, '无关兼职的通知', NOW - 4 * HOUR,
      { templateCode: 'BIND_RELEASED' })
  ]);
  db.seed('admin_view_sessions', [
    {
      _id: READONLY_TICKET, requestKey: 'session-readonly', adminOpenid: 'admin-openid',
      developerNo: 'DEV-01', viewMode: 'READONLY', role: 'CUSTOMER', targetId: C1,
      targetNo: 'CADEFGHJK', targetDisplayName: '小王', targetIsTest: false,
      createdAt: new Date(NOW - 5 * MINUTE), expiresAt: new Date(NOW + 25 * MINUTE), endedAt: null
    },
    {
      _id: TEST_WRITE_TICKET, requestKey: 'session-testwrite', adminOpenid: 'admin-openid',
      developerNo: 'DEV-01', viewMode: 'TEST_WRITE', role: 'CUSTOMER', targetId: TEST_C,
      targetNo: 'CTESTAAAA', targetDisplayName: '测试-小王', targetIsTest: true,
      createdAt: new Date(NOW - 5 * MINUTE), expiresAt: new Date(NOW + 25 * MINUTE), endedAt: null
    }
  ]);
  return db;
}

function apiOf(db, openid, options) {
  const opts = options || {};
  return createApi({ db, now: opts.now === undefined ? NOW : opts.now, env: opts.env || {}, openid });
}

function nextCrid(tag, index) {
  return 'TASK75MSG' + String(tag || '').toUpperCase().padEnd(4, 'X') + String(index || 1).padStart(3, '0');
}

async function expectCode(t, promise, code, message) {
  const res = await promise;
  t.eq(res && res.ok, false, message + '（期望失败）');
  t.eq(res && res.code, code, message);
  return res;
}

function itemTypes(list) {
  return (list || []).map((item) => item.type);
}

function findItem(list, predicate) {
  return (list || []).filter(predicate)[0] || null;
}

// ── A. 聚合口径 ─────────────────────────────────────────────────────────────
async function sectionA(h) {
  h.section('§A 消息中心聚合（事件+留言+公告+系统通知，无 notifications 集合）', async (t) => {
    const db = world();
    const api = apiOf(db, C1);
    const res = await api.call('message.list', {});
    t.eq([res.ok, typeof res.data.unread], [true, 'number'], 'A1 顾客消息中心可读且返回 unread 计数');
    const types = itemTypes(res.data.list);
    t.check(types.indexOf('EVENT') >= 0 && types.indexOf('MESSAGE') >= 0 && types.indexOf('ANNOUNCEMENT') >= 0,
      'A2 合并视图含状态事件 + 订单留言 + 公告（样本非空）');
    const announcement = findItem(res.data.list, (item) => item.type === 'ANNOUNCEMENT');
    t.eq([announcement.title, announcement.text, announcement.read, announcement.orderNo],
      ['开学季', '驿站 22:00 关门，请尽早取件。', true, ''], 'A3 公告项形状：标题/正文/恒已读/无订单号');
    t.eq(bannedKeysOf(res.data.list, ['openid', 'fromId', 'actorId', 'payload', 'pickupCode', 'lockerNo',
      'trackingTail', 'phoneTail', 'room'], 'messageList'), [], 'A4 消息项零 openid/内部 id/L3 字段');
    t.eq(keysOf(findItem(res.data.list, (item) => item.type === 'EVENT')),
      ['at', 'fromRole', 'orderNo', 'read', 'text', 'title', 'type'], 'A5 事件项键白名单（type/title/text/orderNo/at/read/fromRole）');
    t.eq(keysOf(findItem(res.data.list, (item) => item.type === 'MESSAGE')),
      ['at', 'fromRole', 'orderNo', 'read', 'templateCode', 'text', 'title', 'type'], 'A6 留言项键白名单（含 templateCode 判别位，无内部 id）');
    const selfOrderMode = await api.call('message.list', { orderNo: '20260101-0001' });
    t.eq(findItem(selfOrderMode.data.list, (item) => item.text === '麻烦放到楼下').read,
      true, 'A7 自己发的留言恒 read=true（不参与未读）');
    t.eq(findItem(res.data.list, (item) => item.text === '好的，10 分钟到').read, false,
      'A8 对方发来且 readAt=null 的留言 read=false');
    const notice = findItem(res.data.list, (item) => item.type === 'NOTICE');
    t.eq([notice.title, notice.templateCode, notice.orderNo], ['系统通知', 'BIND_RELEASED', ''],
      'A9 系统通知单独成型（历史绑定兼职来源）');
    t.eq(res.data.list.filter((item) => item.text === '无关兼职的通知').length, 0,
      'A10 系统通知归属过滤：非历史绑定兼职来源不下发');
    t.eq(res.data.list.filter((item) => item.orderNo === '20260101-0003').length, 0,
      'A11 他人订单的事件/留言不进入本人消息中心');
    t.eq(res.data.list.filter((item) => item.orderNo === '20260101-0005').length, 0,
      'A12 顾客已删除的订单记录不进消息中心');
    t.eq(res.data.list.filter((item) => item.orderNo === '20260101-0004').length, 0,
      'A13 真实会话不混入测试订单事件/留言（测试数据隔离）');
    const pApi = apiOf(db, P1);
    const partnerRes = await pApi.call('message.list', {});
    t.eq([partnerRes.ok, itemTypes(partnerRes.data.list).indexOf('EVENT') >= 0,
      itemTypes(partnerRes.data.list).indexOf('MESSAGE') >= 0], [true, true, true],
    'A14 兼职消息中心聚合本人订单事件 + 留言');
    t.eq(partnerRes.data.list.filter((item) => item.orderNo === '20260101-0007').length, 0,
      'A15 兼职也只看自己名下订单（P2 的单不进入 P1 消息中心）');
    const orderMode = await api.call('message.list', { orderNo: '20260101-0001' });
    t.eq([orderMode.data.orderNo, orderMode.data.side, orderMode.data.list.length],
      ['20260101-0001', 'CUSTOMER', 3], 'A16 订单模式：该单 3 条留言（事件只在消息中心聚合）、side 标识参与方');
    t.eq(orderMode.data.list[0].at >= orderMode.data.list[1].at, true, 'A17 订单留言倒序（at desc）');
    t.eq(collections.COLLECTIONS.notifications, undefined, 'A18 集合注册表无 notifications（聚合视图不建集合）');
  });
}

function keysOf(value) {
  return Object.keys(value || {}).sort();
}

function bannedKeysOf(value, banned, from) {
  const hits = [];
  const walk = (node, prefix) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    Object.keys(node).forEach((key) => {
      const at = prefix ? prefix + '.' + key : key;
      if (banned.indexOf(key) >= 0) {
        hits.push(at + '<-' + from);
      }
      walk(node[key], at);
    });
  };
  walk(value, '');
  return hits.sort();
}

// ── B. 已读水位 / 未读 ──────────────────────────────────────────────────────
async function sectionB(h) {
  h.section('§B 已读水位 users.messageReadAt 与 unread 计数', async (t) => {
    const db = world();
    const api = apiOf(db, C1);
    const first = await api.call('message.list', {});
    const firstEvents = first.data.list.filter((item) => item.type === 'EVENT');
    t.eq([firstEvents.length, firstEvents.every((item) => item.read === false)], [3, true], 
      'B1 水位=0 时全部事件 read=false（3 条：进行中单 2 + 已完成单 1）');
    t.eq([first.data.messageReadAt, first.data.unread], ['', 2],
      'B2 messageReadAt 初始空串、unread=2（两条对方未读留言；自己的不计）');
    const markAll = await api.call('message.markRead', { scope: 'ALL' }, { clientRequestId: nextCrid('b3') });
    t.eq([markAll.ok, markAll.data.messageReadAt, markAll.data.orderMessagesRead],
      [true, new Date(NOW).toISOString(), 0], 'B3 markRead ALL 只推进水位、不动单条 readAt');
    const afterAll = await api.call('message.list', {});
    t.eq(afterAll.data.messageReadAt, new Date(NOW).toISOString(), 'B4 列表回报的 messageReadAt 与服务端水位一致');
    t.eq(afterAll.data.list.filter((item) => item.type === 'EVENT').every((item) => item.read === true), true,
      'B5 水位推进后事件按 at<=水位 判为已读');
    t.eq(afterAll.data.unread, 2, 'B6 未读留言不因 ALL 水位自动已读（readAt 仍 null，需 ORDER scope）');
    const markOrder = await api.call('message.markRead', { scope: 'ORDER', orderNo: '20260101-0001' },
      { clientRequestId: nextCrid('b7') });
    t.eq([markOrder.ok, markOrder.data.orderMessagesRead], [true, 2], 'B7 markRead ORDER 只把该单对方 2 条留言置 readAt');
    const afterOrder = await api.call('message.list', {});
    t.eq(afterOrder.data.unread, 0, 'B8 ORDER scope 后 unread=0（自己的留言本就不计）');
    t.eq(afterOrder.data.list.filter((item) => item.type === 'MESSAGE' && item.fromRole === 'PARTNER')
      .every((item) => item.read === true), true, 'B9 对方留言 read=true（readAt 已写）');
    const again = await api.call('message.markRead', { scope: 'ALL' }, { clientRequestId: nextCrid('b10') });
    t.eq(again.data.messageReadAt, new Date(NOW).toISOString(), 'B10 重复 markRead：水位只前进不倒退');
    const userRow = db.dump('users').find((row) => row._id === C1);
    t.eq(new Date(userRow.messageReadAt).getTime(), NOW, 'B11 水位落库 users.messageReadAt（服务端时间）');
    const handlerCtx = {
      dao: require(path.join(ROOT, 'cloudfunctions/api/db/dao.js')).createDao(db),
      ids: {}, now: NOW - HOUR, env: {}, openid: C1,
      identity: { actorOpenid: C1, effectiveOpenid: C1, role: 'CUSTOMER', isTestAccount: false, viewMode: '', viewTicketId: '', developerNo: '' },
      requestId: 'req-msg-b12', clientRequestId: nextCrid('b12'), expectedVersion: undefined, config: {}
    };
    const markReadHandler = require(path.join(ROOT, 'cloudfunctions/api/handlers/message/markRead.js'));
    const backdated = await markReadHandler(handlerCtx, { scope: 'ALL' });
    t.eq(backdated.messageReadAt, new Date(NOW).toISOString(),
      'B12 更早的服务端时间调用也不回退水位（forward 取 max）');
  });
}

// ── C. markRead 边界 ────────────────────────────────────────────────────────
async function sectionC(h) {
  h.section('§C markRead 参数/归属/只读/后台只读', async (t) => {
    const db = world();
    const api = apiOf(db, C1);
    await expectCode(t, api.call('message.markRead', {}, { clientRequestId: nextCrid('c1') }),
      'VALIDATION_FAILED', 'C1 缺 scope → VALIDATION_FAILED');
    await expectCode(t, api.call('message.markRead', { scope: 'NOPE' }, { clientRequestId: nextCrid('c2') }),
      'VALIDATION_FAILED', 'C2 非法 scope → VALIDATION_FAILED');
    await expectCode(t, api.call('message.markRead', { scope: 'ORDER' }, { clientRequestId: nextCrid('c3') }),
      'VALIDATION_FAILED', 'C3 ORDER scope 缺 orderNo → VALIDATION_FAILED');
    await expectCode(t, api.call('message.markRead', { scope: 'ORDER', orderNo: 'bad' },
      { clientRequestId: nextCrid('c4') }), 'VALIDATION_FAILED', 'C4 orderNo 格式错 → VALIDATION_FAILED');
    await expectCode(t, api.call('message.markRead', { scope: 'ORDER', orderNo: '20260101-0003' },
      { clientRequestId: nextCrid('c5') }), 'FORBIDDEN', 'C5 他人订单 markRead → FORBIDDEN（不泄露存在性）');
    await expectCode(t, api.call('message.markRead', { scope: 'ORDER', orderNo: '20990101-0001' },
      { clientRequestId: nextCrid('c6') }), 'NOT_FOUND', 'C6 不存在订单 markRead → NOT_FOUND');
    const readonly = await apiOf(db, 'admin-openid', { env: ADMIN_ENV }).call('message.markRead', { scope: 'ALL' },
      { clientRequestId: nextCrid('c7'), viewTicket: READONLY_TICKET });
    t.eq([readonly.ok, readonly.code], [false, 'FORBIDDEN'], 'C7 READONLY 切换会话写动作 → FORBIDDEN（只读双保险）');
    const adminDb = world();
    const adminRoleCtx = {
      dao: require(path.join(ROOT, 'cloudfunctions/api/db/dao.js')).createDao(adminDb),
      ids: {}, now: NOW, env: {}, openid: 'admin-openid',
      identity: {
        actorOpenid: 'admin-openid', effectiveOpenid: 'admin-openid', role: 'ADMIN',
        isTestAccount: false, viewMode: '', viewTicketId: '', developerNo: 'DEV-01'
      },
      requestId: 'req-msg-c8', clientRequestId: nextCrid('c8'), expectedVersion: undefined, config: {}
    };
    let adminReadError = null;
    try {
      await require(path.join(ROOT, 'cloudfunctions/api/handlers/message/markRead.js'))(adminRoleCtx,
        { scope: 'ORDER', orderNo: '20260101-0001' });
    } catch (error) {
      adminReadError = error;
    }
    t.eq([adminReadError && adminReadError.code, adminReadError && adminReadError.message],
      ['FORBIDDEN', '后台不能代操作订单留言'], 'C8 ADMIN 身份不能代改他人留言已读状态（权限矩阵：留言只读）');
    const testWriteMark = await apiOf(adminDb, 'admin-openid', { env: ADMIN_ENV }).call('message.markRead', { scope: 'ALL' },
      { clientRequestId: nextCrid('c9'), viewTicket: TEST_WRITE_TICKET });
    t.eq([testWriteMark.ok, testWriteMark.code], [true, undefined],
      'C9 TEST_WRITE（测试账号可写）markRead 放行（写测试账号自己的水位）');
    const testUser = adminDb.dump('users').find((row) => row._id === TEST_C);
    t.eq(new Date(testUser.messageReadAt).getTime(), NOW, 'C10 TEST_WRITE 水位写到 effectiveOpenid（合成测试账号）');
  });
}

// ── D. 分页 ─────────────────────────────────────────────────────────────────
async function sectionD(h) {
  h.section('§D 消息中心分页（limit/cursor，unread 与游标无关）', async (t) => {
    const db = world();
    const api = apiOf(db, C1);
    const full = await api.call('message.list', { limit: 100 });
    const total = full.data.list.length;
    t.check(total >= 8, 'D1 全量样本非空（>=8 条合并项）');
    const page1 = await api.call('message.list', { limit: 3 });
    const cursor = page1.data.nextCursor;
    t.check(page1.data.list.length === 3 && !!cursor, 'D2 limit=3 首页 3 条 + nextCursor');
    const page2 = await api.call('message.list', { limit: 3, cursor });
    const keys1 = page1.data.list.map((item) => item.type + '|' + item.at + '|' + item.orderNo);
    const keys2 = page2.data.list.map((item) => item.type + '|' + item.at + '|' + item.orderNo);
    t.eq(keys1.filter((key) => keys2.indexOf(key) >= 0), [], 'D3 第二页与首页不重叠');
    t.eq([page2.data.unread, page1.data.unread], [2, 2], 'D4 unread 与分页游标无关（两次读数一致）');
    const seen = [];
    let cursorNext = null;
    let pages = 0;
    for (;;) {
      const page = await api.call('message.list', { limit: 3, cursor: cursorNext });
      page.data.list.forEach((item) => seen.push(item.at + '|' + item.orderNo + '|' + item.text));
      cursorNext = page.data.nextCursor;
      pages += 1;
      if (!cursorNext || pages > 10) {
        break;
      }
    }
    t.eq([seen.length, new Set(seen).size], [total, total], 'D5 游标翻页取尽全量且不重不漏');
    t.eq(cursorNext, null, 'D6 末页 nextCursor=null');
    const tail = await api.call('message.list', { limit: 100 });
    t.eq(tail.data.nextCursor, null, 'D7 单页取尽时 nextCursor=null');
  });
}

// ── E. 公告开关 ─────────────────────────────────────────────────────────────
async function sectionE(h) {
  h.section('§E 公告开关（enabled=false 不下发）', async (t) => {
    const enabledDb = world();
    const enabledRes = await apiOf(enabledDb, C1).call('message.list', {});
    t.check(enabledRes.data.list.some((item) => item.type === 'ANNOUNCEMENT'), 'E1 enabled=true 时公告下发');
    const disabledDb = world({
      announcement: { enabled: false, title: '开学季', text: '驿站 22:00 关门。', updatedAt: NOW }
    });
    const disabledRes = await apiOf(disabledDb, C1).call('message.list', {});
    t.eq(disabledRes.data.list.filter((item) => item.type === 'ANNOUNCEMENT').length, 0,
      'E2 enabled=false 时公告不下发（开关生效，不是只看正文非空）');
    t.eq(await messageCommon.buildAnnouncementItem({ announcement: { enabled: false, text: 'x' } }), null,
      'E3 buildAnnouncementItem：关闭 → null');
    const stringRes = await messageCommon.buildAnnouncementItem({ announcement: '仅正文公告' });
    t.eq([stringRes.type, stringRes.title, stringRes.text], ['ANNOUNCEMENT', '公告', '仅正文公告'],
      'E4 兼容旧字符串公告形态（无开关位按启用处理）');
    const emptyRes = await messageCommon.buildAnnouncementItem({ announcement: { enabled: true, title: 't', text: '' } });
    t.eq(emptyRes, null, 'E5 正文为空不下发');
  });
}

// ── F. 权限与写动作 ─────────────────────────────────────────────────────────
async function sectionF(h) {
  h.section('§F 权限 / 留言写动作 / 真实×测试隔离', async (t) => {
    const db = world();
    const customerApi = apiOf(db, C1);
    const sent = await customerApi.call('message.send',
      { orderNo: '20260101-0001', text: '我到了' }, { clientRequestId: nextCrid('f1') });
    t.eq([sent.ok, sent.data.message.text, sent.data.message.fromRole, sent.data.message.orderNo],
      [true, '我到了', 'CUSTOMER', '20260101-0001'], 'F1 顾客给本人进行中订单留言成功');
    const replay = await customerApi.call('message.send',
      { orderNo: '20260101-0001', text: '我到了' }, { clientRequestId: nextCrid('f1') });
    t.eq([replay.data.duplicated, db.dump('order_messages').filter((row) => row.text === '我到了').length],
      [true, 1], 'F2 同 clientRequestId 重放：duplicated=true 且不重复落库');
    await expectCode(t, customerApi.call('message.send', { orderNo: '20260101-0001', text: '' },
      { clientRequestId: nextCrid('f3') }), 'VALIDATION_FAILED', 'F3 空留言 → VALIDATION_FAILED');
    await expectCode(t, customerApi.call('message.send', { orderNo: '20260101-0001', text: 'x'.repeat(201) },
      { clientRequestId: nextCrid('f4') }), 'VALIDATION_FAILED', 'F4 留言 >200 字 → VALIDATION_FAILED');
    await expectCode(t, customerApi.call('message.send', { orderNo: '20260101-0002', text: '还能发吗' },
      { clientRequestId: nextCrid('f5') }), 'INVALID_TRANSITION', 'F5 终态订单留言 → INVALID_TRANSITION（只读归档）');
    await expectCode(t, customerApi.call('message.send', { orderNo: '20260101-0003', text: '越权' },
      { clientRequestId: nextCrid('f6') }), 'FORBIDDEN', 'F6 他人订单留言 → FORBIDDEN');
    await expectCode(t, customerApi.call('message.send', { orderNo: '20260101-0004', text: '测试单' },
      { clientRequestId: nextCrid('f7') }), 'FORBIDDEN', 'F7 真实会话对测试订单留言 → FORBIDDEN（归属不可见，不泄露隔离存在性）');
    const partnerApi = apiOf(db, P1);
    const partnerSent = await partnerApi.call('message.send',
      { orderNo: '20260101-0001', text: '马上到' }, { clientRequestId: nextCrid('f8') });
    t.eq([partnerSent.ok, partnerSent.data.message.fromRole], [true, 'PARTNER'],
      'F8 兼职给本人订单留言成功（fromRole=PARTNER）');
    t.eq(db.dump('order_messages').find((row) => row.text === '马上到').fromId, P1,
      'F9 留言 fromId=业务身份 openid（归属可审计）');
    const testWriteApi = apiOf(db, 'admin-openid', { env: ADMIN_ENV });
    const testSend = await testWriteApi.call('message.send', { orderNo: '20260101-0004', text: '测试会话留言' },
      { clientRequestId: nextCrid('f10'), viewTicket: TEST_WRITE_TICKET });
    t.eq([testSend.ok, testSend.data.message.orderNo], [true, '20260101-0004'],
      'F10 TEST_WRITE 会话可写测试订单留言');
    t.eq(db.dump('order_messages').find((row) => row.text === '测试会话留言').fromId, TEST_C,
      'F11 TEST_WRITE 留言 fromId=effectiveOpenid（测试账号合成身份）');
    const readonlyList = await apiOf(db, 'admin-openid', { env: ADMIN_ENV }).call('message.list', {}, { viewTicket: READONLY_TICKET });
    t.eq([readonlyList.ok, itemTypes(readonlyList.data.list).indexOf('EVENT') >= 0], [true, true],
      'F12 READONLY 切换会话可读消息中心（白名单内只读）');
    const testWriteList = await testWriteApi.call('message.list', {}, { viewTicket: TEST_WRITE_TICKET });
    t.eq([testWriteList.ok, testWriteList.data.list.filter((item) => item.orderNo === '20260101-0004').length > 0,
      testWriteList.data.list.filter((item) => item.orderNo === '20260101-0001').length],
    [true, true, 0], 'F13 TEST_WRITE 消息中心只看测试数据（真实订单事件不混入）');
    const noRoleApi = apiOf(db, 'nobody-openid');
    await expectCode(t, noRoleApi.call('message.list', {}), 'FORBIDDEN',
      'F14 无业务角色身份调消息中心 → FORBIDDEN（不新增错误码）');
    const adminApi = apiOf(db, 'admin-openid', { env: ADMIN_ENV });
    await expectCode(t, adminApi.call('message.list', {}), 'FORBIDDEN',
      'F15 开发者本人无业务角色 → 消息中心 FORBIDDEN（后台消息走 admin.* 聚合）');
    const crossList = await customerApi.call('message.list', { orderNo: '20260101-0003' });
    await expectCode(t, customerApi.call('message.list', { orderNo: '20260101-0003' }), 'FORBIDDEN',
      'F16 订单模式读他人订单留言 → FORBIDDEN');
    t.eq(crossList.ok, false, 'F17 越权订单模式失败基线（样本非空）');
  });
}

// ── G. 静态纪律 ─────────────────────────────────────────────────────────────
async function sectionG(h) {
  h.section('§G 静态纪律（无 notifications / 零 db.collection / DTO 键白名单）', async (t) => {
    t.eq(Object.keys(collections.COLLECTIONS).filter((key) => key === 'notifications'), [],
      'G1 集合注册表零 notifications（DATA_MODEL §2：聚合视图不建集合）');
    const dir = path.join(ROOT, 'cloudfunctions/api/handlers/message');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js'));
    const hits = files.filter((name) => /db\.collection\(/.test(fs.readFileSync(path.join(dir, name), 'utf8')));
    t.eq(hits, [], 'G2 message 域零 db.collection（只经 dao.js）');
    const source = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
    t.eq([/COLLECTIONS\.notifications/.test(source), source.indexOf('pickupCode'), source.indexOf('avatarFileId')],
      [false, -1, -1], 'G3 message 域零 notifications 集合访问/L3/头像 fileId 引用');
    t.eq(switchSession.VIEW_READ_WHITELIST.indexOf('message.list') >= 0, true,
      'G4 READONLY 读白名单含 message.list（目标本人消息中心可读）');
    t.eq(switchSession.VIEW_READ_WHITELIST.indexOf('message.markRead') >= 0, false,
      'G5 写动作 markRead 不在读白名单（READONLY 拒写双保险）');
    t.eq(messageCommon.SYSTEM_FROM, 'SYSTEM', 'G6 系统通知 fromId 哨兵常量唯一');
  });
}

// ── 注册 ─────────────────────────────────────────────────────────────────────
function register(h) {
  h.setExpected(EXPECTED_ASSERTIONS);
  sectionA(h);
  sectionB(h);
  sectionC(h);
  sectionD(h);
  sectionE(h);
  sectionF(h);
  sectionG(h);
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-messages' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-messages');
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
