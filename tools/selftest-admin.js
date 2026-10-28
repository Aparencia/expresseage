'use strict';
/**
 * tools/selftest-admin.js — 批 8「开发者后台服务端」断言套件（task-75；A~G + 维护闸）。
 *
 * A 白名单/身份闸：ADMIN_OPENIDS fail-closed（缺失/空/非法 JSON）、非白名单/顾客/兼职调 admin.*、伪造 developerNo 无效、
 *   票据身份调 admin.* 拒绝、多开发者映射；维护模式读放行/写拒绝/admin 放行/关闭后写恢复。
 * B 脱敏 DTO：顾客/兼职/订单列表与详情、审计，递归零 avatarFileId/openid/_id/完整 L3/roomTag/房间号；昵称 maskDisplayName。
 * C 邀请码生命周期：createInvites 数量/有效期/备注/码形态/批次/整批返回/幂等；revokeInvite 仅 UNUSED；审计不含完整码。
 * D 列表/详情/审计/config/stats：默认排除测试数据 + includeTest 开关；updateConfig 白名单与范围（DATA_MODEL §7.6）；
 *   stats 排除测试账号与 isTest 订单、抬头 developerNo=环境映射值（伪造入参无效）、counts 键集对齐文档；审计只读脱敏。
 * E 异常介入取消（TD-046）：admin 仅 EXCEPTION、cancelledBy=ADMIN、ORDER_ANOMALY_CANCEL 审计、幂等；非 EXCEPTION
 *   INVALID_TRANSITION；顾客/兼职路径回归；后台不代操作其它订单动作。
 * F 识别失败复核四动作：list 默认 PENDING/counts、get 临时 URL 5 分钟 + 每次 FAILURE_IMAGE_VIEW、
 *   fix 只回填识别三字段（+recognitionSource=MANUAL）/不改状态归属/审计 FAILURE_FIX、ignore 备注必填/审计 FAILURE_IGNORE、
 *   notifyUploader 站内消息同日幂等。
 * G 负向矩阵与静态纪律：action 注册表 23 个、错误码 ∈ 13 码集、admin 域零 db.collection、_dto 零 avatarFileId/adminOpenid。
 * H v1.0（D23/D24/D25）：后台多包裹/无截图手填/delivery 脱敏/按件补录/合并窗口配置 —— 用例表在
 *   tools/lib/admin-v1-cases.js（拆出控本文件 ≤1000 行，门禁 #18；断言数合并计入 EXPECTED_ASSERTIONS）。
 *
 * 纪律：fake DB + createApi 全链路（app.js 中间件链）或 handler 直调，不 mock 全局 wx、不连真实网络/真库；
 *      先合法基线再反例；EXPECTED_ASSERTIONS 与实际精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-admin.js | Select-Object -Last 2
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { createHarness, installCrashGuard } = require('./selftest');
const { createFakeDb } = require('./fake-db');
const { createApi } = require(path.join(ROOT, 'cloudfunctions/api/app.js'));
const sharedActions = require(path.join(ROOT, 'cloudfunctions/api/shared/actions.js'));
// v1.0（D23/D24/D25）用例表：拆出以控本文件 ≤1000 行（门禁 #18），断言数合并计
const v1Cases = require(path.join(__dirname, 'lib', 'admin-v1-cases.js'));

const EXPECTED_ASSERTIONS = 220 + v1Cases.EXPECTED_ASSERTIONS + 14; // +14：v1.1/D32 站点名称配置

const NOW = Date.UTC(2026, 9, 22, 4, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LEGACY_AUDIT_PREFIX = 'VIEW' + '_' + 'AS' + '_';

const ADMIN = 'admin-openid';
const ADMIN2 = 'admin2-openid';
const C1 = 'c1-openid';
const C2 = 'c2-openid';
const P1 = 'p1-openid';
const TEST_C = 'TEST-CUST0000001';
const TEST_P = 'TEST-PART0000001';
const TEST_PID = 'test-pid-1';
const PID1 = 'pid-1';
const VIEW_TICKET = 'T'.repeat(32);

const ENV = { ADMIN_OPENIDS: JSON.stringify({ [ADMIN]: 'DEV-01', [ADMIN2]: 'DEV-02' }) };
const NO_ENV = {};
const BAD_ENV = { ADMIN_OPENIDS: '{not-json' };
const EMPTY_ENV = { ADMIN_OPENIDS: '  ' };

const CLOUD = {
  async getTempFileURL(params) {
    return {
      fileList: (params && params.fileList ? params.fileList : []).map((fileID) => ({
        fileID,
        tempFileURL: 'https://tmp.example.invalid/' + encodeURIComponent(fileID)
      }))
    };
  }
};

const UNIQUE = {
  orders: [['orderNo'], ['requestKey']],
  order_events: [['requestKey']],
  admin_audit: [['requestKey']],
  invitation_codes: [['code']],
  admin_view_sessions: [['requestKey']],
  counters: [['key']],
  recognition_failures: [['failureNo']],
  order_messages: [['requestKey']]
};

const ERROR_CODES = [
  'VALIDATION_FAILED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INVALID_TRANSITION', 'INVALID_STATE',
  'RATE_LIMITED', 'INVITE_EXPIRED', 'INVITE_USED', 'VIEW_TICKET_EXPIRED', 'PARTNER_CLOSED',
  'DEPENDENCY_FAILED', 'INTERNAL_ERROR'
];

// ── 夹具 ─────────────────────────────────────────────────────────────────────
function orderDoc(orderNo, status, extra) {
  const base = {
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
    source: 'CUSTOMER',
    service: { code: 'PICKUP_STD', name: '标准代取' },
    dorm: { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522' },
    phoneTail: '6678',
    parcel: {
      stationId: 'P1', stationName: '菜鸟驿站P1', pickupCode: 'A1234', lockerNo: '12号柜',
      trackingTail: '7788', codeStatus: 'OK'
    },
    image: { fileId: 'cloud://env/orders/t1/image.jpg', cloudPath: 'orders/t1/image.jpg' },
    createdAt: new Date(NOW - 5 * HOUR),
    statusUpdatedAt: new Date(NOW - 1 * HOUR),
    updatedAt: new Date(NOW - 1 * HOUR)
  };
  return Object.assign(base, extra || {});
}

function userDoc(openid, roles, extra) {
  return Object.assign({
    _id: openid,
    roles: roles || [],
    status: 'ACTIVE',
    isTestAccount: false,
    messageReadAt: 0,
    privacyConsent: { version: 'v4.0', at: NOW },
    createdAt: new Date(NOW - 30 * DAY),
    updatedAt: new Date(NOW - DAY)
  }, extra || {});
}

function failureDoc(failureNo, status, extra) {
  return Object.assign({
    failureNo,
    status,
    failureCode: 'PARSE_MISS',
    sourceRole: 'CUSTOMER',
    uploaderOpenid: C1,
    orderId: 'ord-ex',
    fileId: 'cloud://env/orders/t1/image.jpg',
    ocrTextMasked: '驿站 P1 取件码 **** 尾号 ****',
    ruleResult: { stationId: '', pickupCode: '' },
    aiTried: true,
    aiModel: 'deepseek-chat',
    aiResult: { stationId: 'P1' },
    aiErrorCode: '',
    retentionDays: 30,
    resolution: null,
    reviewedAt: null,
    createdAt: new Date(NOW - 2 * HOUR),
    updatedAt: new Date(NOW - 2 * HOUR)
  }, extra || {});
}

function world(options) {
  const opts = options || {};
  const db = createFakeDb({ uniqueIndexes: UNIQUE });
  db.seed('users', [
    userDoc(ADMIN, []),
    userDoc(ADMIN2, []),
    userDoc(C1, ['CUSTOMER']),
    userDoc(C2, ['CUSTOMER']),
    userDoc(P1, ['PARTNER']),
    userDoc(TEST_C, ['CUSTOMER'], { isTestAccount: true, createdByDeveloperNo: 'DEV-01', privacyConsent: null }),
    userDoc(TEST_P, ['PARTNER'], { isTestAccount: true, createdByDeveloperNo: 'DEV-01', privacyConsent: null })
  ]);
  db.seed('config', [Object.assign({
    _id: 'global',
    privacyVersion: 'v4.0',
    maintenance: { enabled: false, text: '' },
    announcement: { enabled: false, title: '', text: '', updatedAt: 0 }
  }, opts.config || {})]);
  db.seed('customers', [
    {
      _id: C1, customerNo: 'CADEFGHJK', displayName: '小王', zone: 'D', buildingNo: 4, room: '522',
      phoneTail: '6678', avatarFileId: 'cloud://env/avatars/customer/c1.jpg', profileCompleted: true,
      createdAt: new Date(NOW - 30 * DAY), updatedAt: new Date(NOW - DAY)
    },
    {
      _id: C2, customerNo: 'CBBBBBBB', displayName: '小李', zone: 'X', buildingNo: 3, room: '301',
      phoneTail: '5678', profileCompleted: true, createdAt: new Date(NOW - 20 * DAY), updatedAt: new Date(NOW - DAY)
    },
    {
      _id: TEST_C, customerNo: 'CTESTAAAA', displayName: '测试-小王', zone: 'D', buildingNo: 4, room: '101',
      profileCompleted: true, createdAt: new Date(NOW - 2 * DAY), updatedAt: new Date(NOW - DAY)
    }
  ]);
  db.seed('partners', [
    {
      _id: PID1, openid: P1, partnerNo: 'PAAAAAA', displayName: '老张', status: 'ACTIVE',
      avatarFileId: 'cloud://env/avatars/partner/p1.jpg',
      serviceConfig: { services: [{ code: 'PICKUP_STD', enabled: true }], zones: ['D'], acceptingOrders: true },
      stats: { todayOrders: 1, totalOrders: 2, completedOrders: 1, cancelledOrders: 0, activeOrders: 1 },
      createdAt: new Date(NOW - 40 * DAY), updatedAt: new Date(NOW - DAY)
    },
    {
      _id: TEST_PID, openid: TEST_P, partnerNo: 'PTESTAA', displayName: '测试-老张', status: 'ACTIVE',
      serviceConfig: { services: [{ code: 'PICKUP_STD', enabled: true }], zones: ['D'], acceptingOrders: true },
      stats: { todayOrders: 0, totalOrders: 0, completedOrders: 0, cancelledOrders: 0, activeOrders: 0 },
      createdAt: new Date(NOW - 2 * DAY), updatedAt: new Date(NOW - DAY)
    }
  ]);
  db.seed('bindings', [{
    _id: 'bind-1', customerId: C1, partnerId: PID1, status: 'ACTIVE', activeKey: C1 + ':ACTIVE',
    roomTag: 'A', dormSnapshot: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4' },
    boundAt: new Date(NOW - 10 * DAY), releasedAt: null
  }]);
  db.seed('orders', [
    orderDoc('20260101-0001', 'EXCEPTION', {
      _id: 'ord-ex',
      exception: { code: 'CODE_INVALID', text: '码失效', fromStatus: 'PICKED', by: 'PARTNER', at: new Date(NOW - HOUR) }
    }),
    orderDoc('20260101-0002', 'SUBMITTED', { _id: 'ord-sub' }),
    orderDoc('20260101-0003', 'COMPLETED', {
      completedAt: new Date(NOW - 3 * HOUR), statusUpdatedAt: new Date(NOW - 3 * HOUR)
    }),
    orderDoc('20260101-0005', 'ACCEPTED', {
      customerId: C2, customerOpenid: C2, customerNo: 'CBBBBBBB', statusUpdatedAt: new Date(NOW - 30 * MINUTE)
    }),
    orderDoc('20260101-0004', 'SUBMITTED', {
      customerId: TEST_C, customerOpenid: TEST_C, customerNo: 'CTESTAAAA',
      partnerId: TEST_PID, partnerOpenid: TEST_P, partnerNo: 'PTESTAA', isTest: true
    }),
    orderDoc('20260101-0006', 'EXCEPTION', {
      customerId: TEST_C, customerOpenid: TEST_C, customerNo: 'CTESTAAAA',
      partnerId: TEST_PID, partnerOpenid: TEST_P, partnerNo: 'PTESTAA', isTest: true,
      exception: { code: 'OTHER', text: '测试异常', fromStatus: 'ACCEPTED', by: 'PARTNER', at: new Date(NOW - HOUR) }
    })
  ]);
  db.seed('order_events', [{
    _id: 'ev-ex-1', orderId: 'ord-ex', orderNo: '20260101-0001', type: 'EXCEPTION_REPORTED',
    fromStatus: 'PICKED', toStatus: 'EXCEPTION', actorRole: 'PARTNER', actorId: P1,
    impersonatedBy: '', at: new Date(NOW - HOUR), note: '码失效', payload: {}, requestKey: 'ev-ex-1'
  }]);
  db.seed('invitation_codes', [
    {
      _id: 'inv-unused', code: 'ABCDEFGHJKLM', status: 'UNUSED', batchId: 'B20261022-01',
      expiresAt: new Date(NOW + 7 * DAY), usedBy: '', usedAt: null, note: '首批',
      createdBy: 'DEV-01', createdAt: new Date(NOW - HOUR), revokedAt: null, revokedBy: '', updatedAt: new Date(NOW - HOUR)
    },
    {
      _id: 'inv-used', code: 'CDEFGHJKLMNP', status: 'USED', batchId: 'B20261022-01',
      expiresAt: new Date(NOW + 7 * DAY), usedBy: PID1, usedAt: new Date(NOW - 30 * MINUTE), note: '',
      createdBy: 'DEV-01', createdAt: new Date(NOW - 2 * HOUR), revokedAt: null, revokedBy: '', updatedAt: new Date(NOW - 2 * HOUR)
    },
    {
      _id: 'inv-expired', code: 'DEFGHJKLMNPQ', status: 'EXPIRED', batchId: 'B20261021-01',
      expiresAt: new Date(NOW - DAY), usedBy: '', usedAt: null, note: '',
      createdBy: 'DEV-01', createdAt: new Date(NOW - 2 * DAY), revokedAt: null, revokedBy: '', updatedAt: new Date(NOW - DAY)
    },
    {
      _id: 'inv-revoked', code: 'EFGHJKLMNPQR', status: 'REVOKED', batchId: 'B20261021-02',
      expiresAt: new Date(NOW + 3 * DAY), usedBy: '', usedAt: null, note: '',
      createdBy: 'DEV-01', createdAt: new Date(NOW - 2 * DAY), revokedAt: new Date(NOW - DAY),
      revokedBy: 'DEV-01', updatedAt: new Date(NOW - DAY)
    }
  ]);
  db.seed('recognition_failures', [
    failureDoc('F-20260101-ABCDEF', 'PENDING'),
    failureDoc('F-20260101-ABGHJK', 'PENDING', { orderId: '', sourceRole: 'PARTNER', uploaderOpenid: P1 }),
    failureDoc('F-20260101-ABJKLM', 'PENDING', { failureCode: 'LOW_CONFIDENCE', createdAt: new Date(NOW - 3 * HOUR) }),
    failureDoc('F-20260101-ABNPQR', 'FIXED', {
      resolution: { stationId: 'P1', note: '', by: 'DEV-01', at: new Date(NOW - MINUTE) },
      reviewedAt: new Date(NOW - MINUTE)
    }),
    failureDoc('F-20260101-ABSTUV', 'IGNORED', {
      resolution: { note: '无需处理', by: 'DEV-01', at: new Date(NOW - MINUTE) },
      reviewedAt: new Date(NOW - MINUTE)
    })
  ]);
  db.seed('admin_audit', [{
    action: 'PARTNER_SUSPEND', developerNo: 'DEV-01', target: { type: 'partner', id: 'PAAAAAA' },
    detail: { keys: ['orderTimeoutMinutes'] }, at: new Date(NOW - 10 * MINUTE), requestKey: 'base-audit-1'
  }]);
  db.seed('admin_view_sessions', [{
    _id: VIEW_TICKET, requestKey: 'switch-1', adminOpenid: ADMIN, developerNo: 'DEV-01',
    viewMode: 'READONLY', role: 'CUSTOMER', targetId: C1, targetNo: 'CADEFGHJK',
    targetDisplayName: '小王', targetIsTest: false,
    createdAt: new Date(NOW - 5 * MINUTE), expiresAt: new Date(NOW + 25 * MINUTE), endedAt: null
  }]);
  if (opts.maintenance === true) {
    db.seed('config', [Object.assign(db.dump('config')[0], { maintenance: { enabled: true, text: '维护中' } })]);
  }
  return db;
}

function apiOf(db, openid, options) {
  const opts = options || {};
  return createApi({
    db,
    now: NOW,
    env: opts.env === undefined ? ENV : opts.env,
    cloud: CLOUD,
    openid
  });
}

function nextCrid(tag, index) {
  return 'TASK75ADMIN' + String(tag || '').toUpperCase().padEnd(4, 'X') + String(index || 1).padStart(3, '0');
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

function auditsOf(db, action) {
  const rows = db.dump('admin_audit') || [];
  return action ? rows.filter((row) => row.action === action) : rows;
}

async function expectCode(t, promise, code, message) {
  const res = await promise;
  t.eq(res && res.ok, false, message + '（期望失败）');
  t.eq(res && res.code, code, message);
  return res;
}

// ── A. 白名单 / 身份闸 / 维护闸 ──────────────────────────────────────────────
async function sectionA(h) {
  h.section('§A 白名单 fail-closed / 身份闸 / 维护闸', async (t) => {
    const db = world();
    await expectCode(t, apiOf(db, ADMIN, { env: NO_ENV }).call('admin.stats', {}), 'FORBIDDEN',
      'A1 ADMIN_OPENIDS 缺失 → admin.* FORBIDDEN（fail-closed）');
    await expectCode(t, apiOf(db, ADMIN, { env: EMPTY_ENV }).call('admin.stats', {}), 'FORBIDDEN',
      'A2 ADMIN_OPENIDS 空串 → admin.* FORBIDDEN');
    await expectCode(t, apiOf(db, ADMIN, { env: BAD_ENV }).call('admin.listCustomers', {}), 'FORBIDDEN',
      'A3 ADMIN_OPENIDS 非法 JSON → admin.* FORBIDDEN');
    await expectCode(t, apiOf(db, C2).call('admin.listCustomers', {}), 'FORBIDDEN',
      'A4 非白名单 openid 调 admin.* → FORBIDDEN');
    await expectCode(t, apiOf(db, C1).call('admin.stats', {}), 'FORBIDDEN',
      'A5 顾客身份调 admin.stats → FORBIDDEN（前端隐藏不算边界）');
    await expectCode(t, apiOf(db, P1).call('admin.getOrder', { orderNo: '20260101-0001' }), 'FORBIDDEN',
      'A6 兼职身份调 admin.getOrder → FORBIDDEN');
    await expectCode(t, apiOf(db, ADMIN).call('admin.listCustomers', {}, { viewTicket: VIEW_TICKET }), 'FORBIDDEN',
      'A7 切换会话票据调 admin.* → FORBIDDEN（后台治理不受会话影响）');
    const forged = await apiOf(db, ADMIN).call('admin.listCustomers',
      { developerNo: 'DEV-99', adminOpenid: 'x', openid: C1 }, { clientRequestId: nextCrid('a7') });
    t.eq([forged.ok, forged.data && forged.data.list.length > 0], [true, true],
      'A8 伪造 developerNo/openid 参数无效：鉴权只认 OPENID + env 映射，查询照常');
    const multi = await apiOf(db, ADMIN2).call('admin.stats', {});
    t.eq([multi.ok, typeof multi.data.counts], [true, 'object'],
      'A9 多开发者映射可用（DEV-02 独立白名单身份）');
    const writeNoCrid = await apiOf(db, ADMIN).call('admin.updateConfig',
      { config: { orderTimeoutMinutes: 90 } }, { clientRequestId: '' });
    t.eq([writeNoCrid.ok, writeNoCrid.code, writeNoCrid.data && writeNoCrid.data.field],
      [false, 'VALIDATION_FAILED', 'clientRequestId'],
      'A10 admin 写动作缺合法 clientRequestId → VALIDATION_FAILED（data.field 指向请求标识）');
    const mdb = world({ maintenance: true });
    const mCust = apiOf(mdb, C1);
    const bootstrap = await mCust.call('user.bootstrap', {});
    t.eq([bootstrap.ok, bootstrap.data.configPublic.maintenance.enabled], [true, true],
      'A11 维护中 user.bootstrap 读放行且下发 maintenance.enabled=true（端侧可展示全屏公告）');
    const publicConfig = await mCust.call('config.getPublic', {});
    t.eq([publicConfig.ok, publicConfig.data.maintenance.enabled], [true, true],
      'A12 维护中 config.getPublic 读放行（DATA_MODEL §2.10 / UX §7.5「读不受影响」）');
    const mList = await mCust.call('message.list', {});
    t.eq(mList.ok, true, 'A13 维护中 message.list 读放行');
    await expectCode(t, mCust.call('order.create', { partnerNo: 'PAAAAAA' }), 'INVALID_STATE',
      'A14 维护中客户端写动作 → INVALID_STATE');
    const mAdmin = await apiOf(mdb, ADMIN).call('admin.stats', {});
    t.eq(mAdmin.ok, true, 'A15 维护中 admin.* 放行（后台可用；维护闸 admin 例外）');
    const after = await apiOf(world(), C1).call('order.create', { partnerNo: 'PAAAAAA' });
    t.check(after.code !== 'INVALID_STATE', 'A16 维护关闭后写动作不再被维护闸拒绝（进入业务校验）');
    const actionsSource = fs.readFileSync(path.join(ROOT, 'cloudfunctions/api/middleware/auth.js'), 'utf8');
    t.check(/ADMIN_BUSINESS_ACTIONS/.test(actionsSource) && /order\.cancel/.test(actionsSource),
      'A17 身份解析按动作域收口（auth 源含 ADMIN_BUSINESS_ACTIONS=order.cancel）');
    const devNoForged = await apiOf(db, ADMIN).call('admin.createInvites',
      { count: 1, expiresInHours: 24 }, { clientRequestId: nextCrid('a18') });
    t.eq(devNoForged.ok, true, 'A18 白名单开发者 admin 写动作可用（基线：非空集）');
  });
}

// ── B. 脱敏 DTO ─────────────────────────────────────────────────────────────
const DTO_BANNED = ['avatarFileId', 'openid', 'adminOpenid', 'uploaderOpenid', 'roomTag', 'room', 'fileId',
  '_id', 'requestKey', 'isTestAccount', 'createdByDeveloperNo'];

async function sectionB(h) {
  h.section('§B 后台 DTO 默认脱敏（无头像 fileId/openid/完整 L3/房间号）', async (t) => {
    const db = world();
    const api = apiOf(db, ADMIN);
    const customers = await api.call('admin.listCustomers', {});
    t.eq(keysOf(customers.data), ['includeTest', 'list', 'nextCursor'], 'B1 listCustomers 响应顶层键恰三项');
    const customerRow = customers.data.list.find((row) => row.customerNo === 'CADEFGHJK');
    t.check(!!customerRow, 'B2 真实顾客出现在默认列表（非空集）');
    t.eq(customerRow.displayName, '小***', 'B3 昵称脱敏=首字 + 固定 3 星（DATA_MODEL §7.7，不随原文长度）');
    t.eq([customerRow.phoneTail, customerRow.dorm], ['**78', 'D4'],
      'B4 手机尾号仅后 2 位、宿舍只到苑+楼栋（无房间号）');
    t.eq(bannedKeysOf(customerRow, DTO_BANNED, 'listCustomers'), [], 'B5 顾客列表行递归零内部键/头像 fileId/roomTag');
    const detail = await api.call('admin.getCustomer', { customerNo: 'C-ADEF-GHJK' });
    t.eq(detail.ok, true, 'B6 getCustomer 基线可读');
    t.eq(keysOf(detail.data), ['customer', 'recentOrders'], 'B7 getCustomer 响应顶层键恰为 customer/recentOrders');
    t.eq(bannedKeysOf(detail.data, DTO_BANNED, 'getCustomer'), [], 'B8 顾客详情递归零头像 fileId/openid/roomTag');
    t.check(detail.data.customer.orderSummary && typeof detail.data.customer.orderSummary.activeOrders === 'number',
      'B9 顾客详情含订单概览（进行中/完成/取消/异常/总数）');
    const orderRow = detail.data.recentOrders[0];
    t.check(!!orderRow && orderRow.orderNo === '20260101-0001', 'B10 最近订单按 statusUpdatedAt desc 取真实单');
    const partners = await api.call('admin.listPartners', {});
    const partnerRow = partners.data.list.find((row) => row.partnerNo === 'PAAAAAA');
    t.eq([partnerRow.displayName, keysOf(partnerRow.stats)],
      ['老***', ['completedOrders', 'todayOrders', 'totalOrders']],
      'B11 兼职昵称脱敏、单量统计只含三个单量键（零收入字段）');
    t.eq(bannedKeysOf(partnerRow, DTO_BANNED, 'listPartners'), [], 'B12 兼职列表行零头像 fileId/openid');
    const orders = await api.call('admin.listOrders', {});
    const exRow = orders.data.list.find((row) => row.orderNo === '20260101-0001');
    t.eq(bannedKeysOf(exRow, ['pickupCode', 'lockerNo', 'trackingTail', 'room', 'roomTag', 'avatarFileId', 'openid'],
      'listOrders'), [], 'B13 订单列表行不含取件码/柜号/运单尾号/房间号/头像 fileId');
    const orderDetail = await api.call('admin.getOrder', { orderNo: '20260101-0001' });
    t.eq(orderDetail.data.order.parcel.pickupCode, 'A***4', 'B14 详情取件码打码=保首尾各 1 位、中间星');
    t.eq([orderDetail.data.order.parcel.lockerNo, orderDetail.data.order.parcel.trackingTail], ['***', '***88'],
      'B15 柜号只表示有值、运单尾号仅后 2 位');
    t.eq([orderDetail.data.order.customerDisplayName, orderDetail.data.order.partnerDisplayName],
      ['小***', '老***'], 'B16 订单详情双方昵称脱敏');
    t.check(orderDetail.data.order.imageUploaded === true
      && orderDetail.data.order.image === undefined, 'B17 详情只给「有截图」布尔，不给任何 URL/fileId');
    t.eq(bannedKeysOf(orderDetail.data.order, ['avatarFileId', 'openid', 'roomTag', 'room', 'fileId', 'cloudPath'], 'getOrder'), [],
      'B18 订单详情递归零 fileId/openid/roomTag/房间号字段');
    t.eq([orderDetail.data.order.dorm, orderDetail.data.order.phoneTail], ['D4', '**78'],
      'B19 宿舍只到苑+楼栋、尾号仅后 2 位（脱敏值仍在）');
    t.eq(JSON.stringify(orderDetail.data).indexOf('cloud://'), -1, 'B19 订单详情响应零云存储 fileId 字面量');
    const audit = await api.call('admin.listAudit', { limit: 20 });
    t.eq(keysOf(audit.data.list[0]), ['action', 'at', 'detail', 'developerNo', 'target'],
      'B20 审计行只含 action/at/detail/developerNo/target（不含 adminOpenid）');
    t.eq(bannedKeysOf(audit.data.list, ['adminOpenid', 'openid'], 'listAudit'), [], 'B21 审计列表零 openid 泄漏');
    t.eq(bannedKeysOf(orders.data.list, DTO_BANNED, 'listOrders'), [], 'B22 订单列表递归零内部键');
  });
}

// ── C. 邀请码生命周期 ───────────────────────────────────────────────────────
async function sectionC(h) {
  h.section('§C 邀请码生命周期（生成/有效期/备注/作废/审计/列表）', async (t) => {
    const db = world();
    const api = apiOf(db, ADMIN);
    const created = await api.call('admin.createInvites',
      { count: 2, expiresInHours: 72, note: '开学补人' }, { clientRequestId: nextCrid('c1') });
    t.eq([created.ok, created.data.codes.length], [true, 2], 'C1 批量发码 count=2 返回两条完整码（本次响应用作整批复制）');
    t.check(created.data.codes.every((code) => /^[A-Z2-9]{12}$/.test(code)), 'C2 码形态=12 位 32 字母表字符');
    t.eq(created.data.expiresAt instanceof String, false, 'C3 expiresAt 为服务端日期对象（非字符串时间）');
    t.eq(new Date(created.data.expiresAt).getTime() - NOW, 72 * HOUR, 'C4 有效期=72 小时（服务端时间基准）');
    t.check(/^B\d{8}-\d{2}$/.test(created.data.batchId), 'C5 批次号由服务端生成（B{day}-{seq}）');
    const createAudit = auditsOf(db, 'INVITE_CREATE')[0];
    t.eq([createAudit.developerNo, createAudit.detail.count, createAudit.detail.batchId],
      ['DEV-01', 2, created.data.batchId], 'C6 审计 INVITE_CREATE 记 developerNo/数量/批次');
    t.eq(JSON.stringify(createAudit.detail).indexOf(created.data.codes[0]), -1,
      'C7 审计 detail 不含完整码（只有后 4 位 codeTails）');
    const replay = await api.call('admin.createInvites',
      { count: 2, expiresInHours: 72, note: '开学补人' }, { clientRequestId: nextCrid('c1') });
    t.eq([replay.data.duplicated, replay.data.batchId], [true, created.data.batchId],
      'C8 同 clientRequestId 重放：返回原批次码 + duplicated=true（不重复生成）');
    t.eq(db.dump('invitation_codes').length, 4 + 2, 'C9 重放未新增邀请码行（幂等）');
    await expectCode(t, api.call('admin.createInvites', { count: 51 }, { clientRequestId: nextCrid('c10') }),
      'VALIDATION_FAILED', 'C10 count=51 超单批上限 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.createInvites', { count: 0 }, { clientRequestId: nextCrid('c11') }),
      'VALIDATION_FAILED', 'C11 count=0 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.createInvites', { count: 1.5 }, { clientRequestId: nextCrid('c12') }),
      'VALIDATION_FAILED', 'C12 count 非整数 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.createInvites',
      { count: 1, expiresInHours: 12 }, { clientRequestId: nextCrid('c13') }), 'VALIDATION_FAILED',
    'C13 有效期不在 24/72/168/720 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.createInvites',
      { count: 1, note: 'x'.repeat(51) }, { clientRequestId: nextCrid('c14') }), 'VALIDATION_FAILED',
    'C14 备注 >50 字 → VALIDATION_FAILED');
    const listUnused = await api.call('admin.listInvites', { status: 'UNUSED' });
    t.check(listUnused.data.list.length >= 2 && listUnused.data.list.every((row) => row.status === 'UNUSED'),
      'C15 listInvites 状态筛选生效（全部 UNUSED）');
    t.eq(listUnused.data.list[0].codeTail.length, 4, 'C16 列表回 codeTail=后 4 位（UI 掩码锚）');
    const usedRow = (await api.call('admin.listInvites', { status: 'USED' })).data.list[0];
    t.eq([usedRow.usedByPartnerNo, usedRow.usedByDisplayName, usedRow.status],
      ['PAAAAAA', '老***', 'USED'], 'C17 USED 行回使用人=兼职编号+脱敏昵称+状态');
    const revoke = await api.call('admin.revokeInvite',
      { invitationCode: 'ABCDEFGHJKLM', reason: '发错人' }, { clientRequestId: nextCrid('c18') });
    t.eq([revoke.ok, revoke.data.status, revoke.data.codeTail], [true, 'REVOKED', 'JKLM'],
      'C18 UNUSED 可作废 → REVOKED + 后 4 位');
    const revokeAudit = auditsOf(db, 'INVITE_REVOKE')[0];
    t.eq([revokeAudit.target.id, JSON.stringify(revokeAudit.detail).indexOf('ABCDEFGHJKLM')],
      ['ABCDEFGHJKLM', -1], 'C19 审计 INVITE_REVOKE 有作废锚但不含完整码明文 detail');
    const revokeAgain = await api.call('admin.revokeInvite',
      { invitationCode: 'ABCDEFGHJKLM' }, { clientRequestId: nextCrid('c20') });
    t.eq(revokeAgain.data.duplicated, true, 'C20 已作废再作废 → 幂等 duplicated=true');
    await expectCode(t, api.call('admin.revokeInvite',
      { invitationCode: 'CDEFGHJKLMNP' }, { clientRequestId: nextCrid('c21') }), 'INVALID_STATE',
    'C21 USED 不可作废 → INVALID_STATE（状态机 UNUSED→REVOKED 唯一）');
    await expectCode(t, api.call('admin.revokeInvite',
      { invitationCode: 'DEFGHJKLMNPQ' }, { clientRequestId: nextCrid('c22') }), 'INVALID_STATE',
    'C22 EXPIRED 不可作废 → INVALID_STATE');
    await expectCode(t, api.call('admin.revokeInvite',
      { invitationCode: 'ZYXWVUTSRQPN' }, { clientRequestId: nextCrid('c23') }), 'NOT_FOUND',
    'C23 不存在码作废 → NOT_FOUND');
    await expectCode(t, api.call('admin.revokeInvite',
      { invitationCode: 'abc' }, { clientRequestId: nextCrid('c24') }), 'VALIDATION_FAILED',
    'C24 码格式错 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.listInvites', { status: 'BROKEN' }), 'VALIDATION_FAILED',
      'C25 非法状态筛选 → VALIDATION_FAILED');
    const paged = await api.call('admin.listInvites', { limit: 2 });
    t.check(paged.data.list.length === 2 && !!paged.data.nextCursor,
      'C26 邀请码列表分页 limit=2 返回 nextCursor');
  });
}

// ── D. 列表/详情/审计/config/stats ──────────────────────────────────────────
async function sectionD(h) {
  h.section('§D 列表默认排除测试数据 / config 白名单与范围 / stats 排除测试', async (t) => {
    const db = world();
    const api = apiOf(db, ADMIN);
    const customers = await api.call('admin.listCustomers', {});
    t.eq(customers.data.includeTest, false, 'D1 顾客列表默认 includeTest=false');
    t.eq(customers.data.list.filter((row) => row.isTest === true).length, 0,
      'D2 顾客列表默认排除测试账号');
    const withTestCustomers = await api.call('admin.listCustomers', { includeTest: true });
    t.eq(withTestCustomers.data.list.filter((row) => row.isTest === true).length, 1,
      'D3 includeTest=true 才出现测试账号并带 isTest 标签');
    const partners = await api.call('admin.listPartners', {});
    t.eq(partners.data.list.filter((row) => row.isTest === true).length, 0, 'D4 兼职列表默认排除测试账号');
    const orders = await api.call('admin.listOrders', {});
    t.eq([orders.data.list.length, orders.data.includeTest],
      [4, false], 'D5 订单列表默认 includeTest=false（6 单中排除 2 张测试单 = 4）');
    const withTest = await api.call('admin.listOrders', { includeTest: true });
    t.eq(withTest.data.list.filter((row) => row.isTest === true).length, 2,
      'D6 includeTest=true 出现测试单（行带 isTest 标签）');
    const exOnly = await api.call('admin.listOrders', { status: 'EXCEPTION' });
    t.eq(exOnly.data.list.map((row) => row.orderNo), ['20260101-0001'],
      'D7 异常工单筛选只回真实 EXCEPTION 单（测试异常单默认过滤）');
    await expectCode(t, api.call('admin.listOrders', { status: 'NOPE' }), 'VALIDATION_FAILED',
      'D8 非法状态筛选 → VALIDATION_FAILED');
    const byKeyword = await api.call('admin.listOrders', { keyword: '20260101-000' });
    t.check(byKeyword.data.list.length >= 4, 'D9 订单号前缀关键词命中（后台允许枚举/搜索）');
    await expectCode(t, api.call('admin.getCustomer', { customerNo: 'C-TEST-AAAA' }), 'NOT_FOUND',
      'D10 测试顾客默认 NOT_FOUND（统一「记录不存在或已注销」）');
    const testCustomer = await api.call('admin.getCustomer', { customerNo: 'CTESTAAAA', includeTest: true });
    t.eq([testCustomer.ok, testCustomer.data.customer.isTest], [true, true],
      'D11 includeTest=true 可查看测试顾客（脱敏口径不变）');
    await expectCode(t, api.call('admin.getOrder', { orderNo: '20260101-0004' }), 'NOT_FOUND',
      'D12 测试订单默认 NOT_FOUND');
    const testOrder = await api.call('admin.getOrder', { orderNo: '20260101-0004', includeTest: true });
    t.eq([testOrder.ok, testOrder.data.order.isTest], [true, true], 'D13 includeTest=true 可进测试订单详情');
    const cfgOk = await api.call('admin.updateConfig', {
      config: { orderTimeoutMinutes: 90, avatarMaxBytes: 204800, testAccountMaxPerRole: 2, testDataRetentionDays: 30 }
    }, { clientRequestId: nextCrid('d14') });
    t.eq([cfgOk.ok, cfgOk.data.config.orderTimeoutMinutes, cfgOk.data.config.avatarMaxBytes,
      cfgOk.data.config.testAccountMaxPerRole], [true, 90, 204800, 2],
    'D14 白名单数值键可写（DATA_MODEL §7.6：含 testAccountMaxPerRole/testDataRetentionDays）');
    const cfgAudit = auditsOf(db, 'CONFIG_UPDATE')[0];
    t.check(!!cfgAudit && cfgAudit.detail.keys.indexOf('orderTimeoutMinutes') >= 0
      && cfgAudit.detail.keys.indexOf('avatarMaxBytes') >= 0, 'D15 配置变更写 CONFIG_UPDATE 审计（含键名清单）');
    await expectCode(t, api.call('admin.updateConfig', { config: { avatarMaxBytes: 204801 } },
      { clientRequestId: nextCrid('d16') }), 'VALIDATION_FAILED',
    'D16 avatarMaxBytes=204801 越界 → VALIDATION_FAILED（上限=200KB 隐私承诺）');
    await expectCode(t, api.call('admin.updateConfig', { config: { avatarMaxBytes: 102399 } },
      { clientRequestId: nextCrid('d17') }), 'VALIDATION_FAILED', 'D17 avatarMaxBytes 低于 100KB → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.updateConfig', { config: { screenshotRetentionDays: 8 } },
      { clientRequestId: nextCrid('d18') }), 'VALIDATION_FAILED', 'D18 截图留存 >7 天 → VALIDATION_FAILED（隐私承诺上限）');
    await expectCode(t, api.call('admin.updateConfig', { config: { recognitionFailureRetentionDays: 31 } },
      { clientRequestId: nextCrid('d19') }), 'VALIDATION_FAILED', 'D19 识别失败留存 >30 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.updateConfig', { config: { viewTicketTtlMinutes: 4 } },
      { clientRequestId: nextCrid('d20') }), 'VALIDATION_FAILED', 'D20 切换会话时长 <5 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.updateConfig', { config: { testDataRetentionDays: 91 } },
      { clientRequestId: nextCrid('d21') }), 'VALIDATION_FAILED', 'D21 测试数据留存 >90 → VALIDATION_FAILED');
    const privacyOk = await api.call('admin.updateConfig', { config: { privacyVersion: 'v4.1.0' } },
      { clientRequestId: nextCrid('d22') });
    t.eq([privacyOk.ok, privacyOk.data.config.privacyVersion], [true, 'v4.1.0'],
      'D22 privacyVersion 是白名单文本键（隐私定稿流程可写 + 审计）');
    await expectCode(t, api.call('admin.updateConfig', { config: { privacyVersion: '   ' } },
      { clientRequestId: nextCrid('d23') }), 'VALIDATION_FAILED', 'D23 privacyVersion 空串 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.updateConfig', { config: { privacyVersion: 'v'.repeat(33) } },
      { clientRequestId: nextCrid('d24') }), 'VALIDATION_FAILED', 'D24 privacyVersion >32 字 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.updateConfig', { config: { aiFallback: { enabled: false } } },
      { clientRequestId: nextCrid('d25') }), 'VALIDATION_FAILED',
    'D25 aiFallback 不在白名单 → VALIDATION_FAILED（只读展示，写入走部署配置）');
    await expectCode(t, api.call('admin.updateConfig', { config: { unknownKey: 1 } },
      { clientRequestId: nextCrid('d26') }), 'VALIDATION_FAILED', 'D26 未知键 → VALIDATION_FAILED');
    await expectCode(t, api.call('admin.updateConfig', { config: {} }, { clientRequestId: nextCrid('d27') }),
      'VALIDATION_FAILED', 'D27 空配置 → VALIDATION_FAILED（至少改一项）');
    const stats = await api.call('admin.stats', {});
    t.eq([stats.data.counts.orders, stats.data.test.testOrders], [4, 2],
      'D28 stats 订单数排除测试单、另单列 test.testOrders');
    t.eq(stats.data.counts.users, 5, 'D29 stats 用户数排除测试账号（7 行含 2 测试）');
    t.eq(stats.data.counts.exceptions, 1, 'D30 stats 异常单排除测试异常单');
    t.eq(stats.data.today.orders, 4, 'D31 stats 今日订单只计非测试单');
    t.eq([stats.data.counts.pendingRecognitionFailures, stats.data.counts.activeSwitchSessions], [3, 1],
      'D32 stats 待复核=PENDING 计数、活跃切换会话=1（未过期且未结束）');
    t.eq(bannedKeysOf(stats.data.recentAudit, ['adminOpenid', 'openid'], 'stats.recentAudit'), [],
      'D33 stats 审计区块零 openid');
    await expectCode(t, api.call('admin.stats', { range: 'nope' }), 'VALIDATION_FAILED',
      'D34 stats 非法区间 → VALIDATION_FAILED');
    t.eq(stats.data.developerNo, 'DEV-01',
      'D35 stats 返回抬头 developerNo=ADMIN_OPENIDS 映射值（UX_DEVELOPER §3.1 抬头数据源）');
    const forgedDevNo = await api.call('admin.stats', { developerNo: 'DEV-99' });
    t.eq(forgedDevNo.data.developerNo, 'DEV-01', 'D36 stats.developerNo 只认环境映射身份，入参伪造无效');
    const secondDev = await apiOf(db, ADMIN2).call('admin.stats', {});
    t.eq([secondDev.ok, secondDev.data.developerNo], [true, 'DEV-02'],
      'D37 DEV-02 抬头为本人编号（多开发者各看各的）');
    t.eq(keysOf(stats.data.counts), ['activePartners', 'activeSwitchSessions', 'customers', 'exceptions',
      'orders', 'partners', 'pendingOrders', 'pendingRecognitionFailures', 'users'],
    'D38 counts 键集 = DATA_MODEL §7.6 八项 + UX §3.1 识别失败卡（pendingRecognitionFailures），无收入字段');
  });
}

// ── D2. 站点名称配置（v1.1/D32：白名单/校验/公开子集/审计/旧配置回退） ───────
async function sectionD2(h) {
  h.section('§D2 站点名称配置（D32：白名单/值域校验/公开子集/审计/旧配置回退）', async (t) => {
    const db = world();
    const api = apiOf(db, ADMIN);
    // 旧 config 文档无 stations：读层回退内置默认（8 条固定 id）
    const stats0 = await api.call('admin.stats', {});
    t.eq(stats0.data.config.stations.map((item) => item.id),
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
      'D2-1 旧 config 文档缺 stations 时 admin.stats 回退内置默认 8 条');
    t.eq(stats0.data.config.stations[2].name, '西苑一栋南面快递中心', 'D2-2 回退默认名与内置站点表一致');
    const public0 = await apiOf(db, C1).call('config.getPublic', {});
    t.eq([public0.data.stations.length, public0.data.stations[0].id, public0.data.stations[0].name],
      [8, 'P1', '西苑顺丰快递（西苑五食堂）'], 'D2-3 config.getPublic 下发 stations（客户端选择器/识别用名称）');
    // 合法基线：改 P1/P5 名称（去空白后落库）
    const custom = stats0.data.config.stations.map((item) => {
      if (item.id === 'P1') return { id: 'P1', name: ' 西苑顺丰快递东门 ' };
      if (item.id === 'P5') return { id: 'P5', name: '西苑菜鸟驿站东门' };
      return { id: item.id, name: item.name };
    });
    const updated = await api.call('admin.updateConfig', { config: { stations: custom } },
      { clientRequestId: nextCrid('d2a') });
    t.eq([updated.ok, updated.data.config.stations[0].name, updated.data.config.stations[4].name],
      [true, '西苑顺丰快递东门', '西苑菜鸟驿站东门'], 'D2-4 stations 是 admin.updateConfig 白名单键（名称 trim 后落库）');
    t.eq(updated.data.config.stations.length, 8, 'D2-5 返回配置仍固定 8 条（不增删站点 id）');
    const audit = auditsOf(db, 'CONFIG_UPDATE').filter((row) => (row.detail.keys || []).indexOf('stations') >= 0)[0];
    const beforeText = audit && audit.detail.changes.stations ? String(audit.detail.changes.stations.before) : '';
    const afterText = audit && audit.detail.changes.stations ? String(audit.detail.changes.stations.after) : '';
    t.check(!!audit && beforeText.length > 0 && afterText.length > 0 && beforeText !== afterText
      && beforeText.length <= 120 && afterText.length <= 120,
    'D2-6 改站点名写 CONFIG_UPDATE 审计（before/after 摘要，沿用 120 字截断）');
    const stats1 = await api.call('admin.stats', {});
    t.check(stats1.data.config.stations[4].name === '西苑菜鸟驿站东门',
      'D2-7 admin.stats 配置区块反映新名称（后台配置页回填数据源）');
    const public1 = await apiOf(db, C1).call('config.getPublic', {});
    t.check(public1.data.stations[4].name === '西苑菜鸟驿站东门',
      'D2-8 config.getPublic 下一次请求即生效（客户端选择器/识别用新名）');
    // 校验：固定 8 id、非空、1~20 字、唯一；非法整表整体拒绝，不半写入
    const validStations = updated.data.config.stations;
    const invalidCases = [
      validStations.slice(0, 7),
      validStations.map((item, index) => (index === 0 ? { id: item.id, name: '   ' } : item)),
      validStations.map((item, index) => (index === 0 ? { id: item.id, name: '站'.repeat(21) } : item)),
      validStations.map((item, index) => (index === 1 ? { id: item.id, name: validStations[0].name } : item)),
      validStations.map((item, index) => (index === 0 ? { id: 'P9', name: '自建驿站' } : item)),
      validStations.concat([{ id: 'P9', name: '自建驿站' }])
    ];
    const invalidResults = [];
    for (let i = 0; i < invalidCases.length; i += 1) {
      invalidResults.push(await api.call('admin.updateConfig', { config: { stations: invalidCases[i] } },
        { clientRequestId: nextCrid('d2b' + i) }));
    }
    t.eq(invalidResults.map((res) => [res.ok, res.code]),
      invalidCases.map(() => [false, 'VALIDATION_FAILED']),
      'D2-9 站点校验：缺条/空名/超 20 字/重名/未知 id/重复编码 → VALIDATION_FAILED');
    t.eq(invalidResults[0].data.field, 'stations', 'D2-10 校验失败 data.field=stations（前端可定位）');
    const statsAfterInvalid = await api.call('admin.stats', {});
    t.check(statsAfterInvalid.data.config.stations[4].name === '西苑菜鸟驿站东门',
      'D2-11 非法整表被拒后配置未被半写入（仍为上一次合法值）');
    // 旧库兼容：admin.bootstrap 给缺 stations 的旧 config 文档补默认种子键
    const db2 = world();
    const boot = await apiOf(db2, ADMIN).call('admin.bootstrap', {}, { clientRequestId: nextCrid('d2c') });
    const rawConfig = (db2.dump('config') || [])[0] || {};
    t.eq([boot.ok, boot.data.configSeeded], [true, true], 'D2-12 admin.bootstrap 可对旧配置补齐种子键');
    t.eq([Array.isArray(rawConfig.stations), rawConfig.stations.length], [true, 8],
      'D2-13 bootstrap 后 config 文档落 stations 8 条（旧库不用先迁移）');
    const bootAudit = auditsOf(db2, 'BOOTSTRAP')[0];
    t.check(!!bootAudit && (bootAudit.detail.filledKeys || []).indexOf('stations') >= 0,
      'D2-14 BOOTSTRAP 审计 filledKeys 记录补了 stations');
  });
}

// ── E. 异常介入取消（TD-046） ───────────────────────────────────────────────
async function sectionE(h) {
  h.section('§E TD-046 异常介入取消（admin 仅 EXCEPTION + 审计 + 幂等）', async (t) => {
    const db = world();
    const adminApi = apiOf(db, ADMIN);
    const res = await adminApi.call('order.cancel',
      { orderNo: '20260101-0001', reason: 'CHANGED_MIND', note: '' }, { clientRequestId: nextCrid('e1') });
    const order = res.data && res.data.order ? res.data.order : {};
    t.eq([res.ok, order.status, order.cancelledBy, order.cancelReason],
      [true, 'CANCELLED', 'ADMIN', 'CHANGED_MIND'], 'E1 admin 取消 EXCEPTION 单成功：CANCELLED + cancelledBy=ADMIN');
    const cancelAudit = auditsOf(db, 'ORDER_ANOMALY_CANCEL');
    t.eq([cancelAudit.length, cancelAudit[0].developerNo, cancelAudit[0].detail.reason,
      cancelAudit[0].detail.fromStatus], [1, 'DEV-01', 'CHANGED_MIND', 'EXCEPTION'],
    'E2 审计 ORDER_ANOMALY_CANCEL 落库（developerNo/原因/原状态）');
    t.eq(bannedKeysOf(cancelAudit[0].detail, ['openid', 'pickupCode', 'displayName', 'avatarFileId', 'room'],
      'anomaly-cancel'), [], 'E3 审计 detail 不含 L3/openid/完整昵称');
    const events = db.dump('order_events').filter((row) => row.orderNo === '20260101-0001');
    const cancelledEvent = events.filter((row) => row.type === 'CANCELLED')[0] || {};
    t.eq([events.length, cancelledEvent.type, cancelledEvent.actorRole, cancelledEvent.fromStatus,
      cancelledEvent.toStatus], [2, 'CANCELLED', 'ADMIN', 'EXCEPTION', 'CANCELLED'],
    'E4 订单事件 CANCELLED 由 ADMIN 写入（fromStatus=EXCEPTION）');
    t.eq(cancelledEvent.actorId, ADMIN, 'E5 事件 actorId=开发者 openid（审计可追溯）');
    await expectCode(t, adminApi.call('order.cancel',
      { orderNo: '20260101-0002', reason: 'CHANGED_MIND' }, { clientRequestId: nextCrid('e6') }),
    'INVALID_TRANSITION', 'E6 admin 取消非 EXCEPTION（SUBMITTED）→ INVALID_TRANSITION');
    await expectCode(t, adminApi.call('order.cancel',
      { orderNo: '20260101-0003', reason: 'CHANGED_MIND' }, { clientRequestId: nextCrid('e7') }),
    'INVALID_TRANSITION', 'E7 admin 取消终态（COMPLETED）→ INVALID_TRANSITION');
    const reasonApi = apiOf(world(), ADMIN);
    await expectCode(t, reasonApi.call('order.cancel',
      { orderNo: '20260101-0001', note: '' }, { clientRequestId: nextCrid('e8') }),
    'VALIDATION_FAILED', 'E8 admin 取消原因必填（缺 reason → VALIDATION_FAILED）');
    await expectCode(t, reasonApi.call('order.cancel',
      { orderNo: '20260101-0001', reason: 'OTHER', note: '' }, { clientRequestId: nextCrid('e9') }),
    'VALIDATION_FAILED', 'E9 OTHER 原因必须填备注（CONTRACT §5.2）');
    await expectCode(t, adminApi.call('order.cancel',
      { orderNo: '20260101-0006', reason: 'CHANGED_MIND' }, { clientRequestId: nextCrid('e10') }),
    'NOT_FOUND', 'E10 测试订单不可执行真实治理（后台介入取消 → NOT_FOUND）');
    await expectCode(t, adminApi.call('order.cancel',
      { orderNo: '20990101-0001', reason: 'CHANGED_MIND' }, { clientRequestId: nextCrid('e11') }),
    'NOT_FOUND', 'E11 不存在的订单 → NOT_FOUND');
    await expectCode(t, adminApi.call('order.resolveException', { orderNo: '20260101-0006' }),
      'FORBIDDEN', 'E12 后台不得代执行其它订单状态动作（resolveException → FORBIDDEN）');
    const replayDb = world();
    const replayApi = apiOf(replayDb, ADMIN);
    const crid = nextCrid('e13');
    await replayApi.call('order.cancel', { orderNo: '20260101-0001', reason: 'CHANGED_MIND' }, { clientRequestId: crid });
    const replay = await replayApi.call('order.cancel',
      { orderNo: '20260101-0001', reason: 'CHANGED_MIND' }, { clientRequestId: crid });
    t.eq([replay.data.duplicated, replayDb.dump('order_events').filter((row) => row.type === 'CANCELLED').length,
      auditsOf(replayDb, 'ORDER_ANOMALY_CANCEL').length], [true, 1, 1],
    'E13 同 clientRequestId 重放：duplicated=true 且事件/审计各只 1 条');
    const customerDb = world();
    const customerApi = apiOf(customerDb, C1);
    const custCancel = await customerApi.call('order.cancel',
      { orderNo: '20260101-0002', reason: 'CHANGED_MIND' }, { clientRequestId: nextCrid('e14') });
    t.eq([custCancel.ok, custCancel.data.order.cancelledBy], [true, 'CUSTOMER'],
      'E14 顾客路径回归：本人 SUBMITTED 单可取消（cancelledBy=CUSTOMER）');
    await expectCode(t, customerApi.call('order.cancel',
      { orderNo: '20260101-0001', reason: 'CHANGED_MIND' }, { clientRequestId: nextCrid('e15') }),
    'INVALID_TRANSITION', 'E15 顾客取消 EXCEPTION（fromStatus=PICKED）→ INVALID_TRANSITION（顾客不可单方取消）');
    const partnerDb = world();
    const partnerApi = apiOf(partnerDb, P1);
    const partnerCancel = await partnerApi.call('order.cancel',
      { orderNo: '20260101-0002', reason: 'TOO_BUSY' }, { clientRequestId: nextCrid('e16') });
    t.eq([partnerCancel.ok, partnerCancel.data.order.cancelledBy], [true, 'PARTNER'],
      'E16 兼职路径回归：拒单原因枚举可用（cancelledBy=PARTNER）');
    await expectCode(t, partnerApi.call('order.cancel',
      { orderNo: '20260101-0001', reason: 'TIMEOUT_UNACCEPTED' }, { clientRequestId: nextCrid('e17') }),
    'VALIDATION_FAILED', 'E17 兼职路径不接受系统原因码（原因枚举按角色隔离）');
  });
}

// ── F. 识别失败复核四动作 ───────────────────────────────────────────────────
async function sectionF(h) {
  h.section('§F 识别失败复核：list/get(原图+审计)/fix(只回填三字段)/ignore(备注必填)', async (t) => {
    const db = world();
    const api = apiOf(db, ADMIN);
    const list = await api.call('admin.listRecognitionFailures', {});
    t.eq(list.data.list.map((row) => row.failureNo),
      ['F-20260101-ABCDEF', 'F-20260101-ABGHJK', 'F-20260101-ABJKLM'], 'F1 默认 status=PENDING 且列表按 createdAt desc');
    t.eq(keysOf(list.data.counts), ['FIXED', 'IGNORED', 'PENDING'], 'F2 counts 三档键齐全（服务端计数不前端推算）');
    t.eq([list.data.counts.PENDING, list.data.counts.FIXED, list.data.counts.IGNORED], [3, 1, 1],
      'F3 counts 与服务端状态计数一致');
    t.eq(keysOf(list.data.list[0]), ['aiErrorCode', 'aiTried', 'createdAt', 'failureCode', 'failureNo', 'hasImage',
      'orderNo', 'reviewedAt', 'sourceRole', 'status', 'uploaderDisplayName', 'uploaderNo'],
    'F4 列表行字段白名单（无 fileId/uploaderOpenid/原图 URL）');
    t.eq(list.data.list[0].uploaderDisplayName, '小***', 'F5 上传人昵称脱敏（编号+脱敏昵称）');
    t.eq(bannedKeysOf(list.data.list, ['fileId', 'uploaderOpenid', 'openid', 'ocrTextMasked', 'imageUrl'],
      'recognitionList'), [], 'F6 列表零 fileId/openid/OCR 全文/原图 URL');
    t.eq((await api.call('admin.listRecognitionFailures', { status: 'FIXED' })).data.list.length, 1,
      'F7 状态筛选 FIXED 生效');
    t.eq((await api.call('admin.listRecognitionFailures', { failureCode: 'LOW_CONFIDENCE' })).data.list.length, 1,
      'F8 失败码筛选生效');
    await expectCode(t, api.call('admin.listRecognitionFailures', { status: 'X' }), 'VALIDATION_FAILED',
      'F9 非法复核状态 → VALIDATION_FAILED');
    const detail = await api.call('admin.getRecognitionFailure', { failureNo: 'F-20260101-ABCDEF' });
    t.check(/^https:\/\//.test(detail.data.imageUrl), 'F10 get 返回临时 URL（服务端 getTempFileURL 注入替身）');
    t.eq(new Date(detail.data.expiresAt).getTime() - NOW, 5 * MINUTE, 'F11 临时 URL 有效期=5 分钟');
    t.eq(detail.data.ocrTextMasked, '驿站 P1 取件码 **** 尾号 ****', 'F12 OCR 文本为已去敏副本（只读展示）');
    const viewAudits = auditsOf(db, 'FAILURE_IMAGE_VIEW');
    t.eq(viewAudits.length, 1, 'F13 每次查看原图落 FAILURE_IMAGE_VIEW 审计（1 次查看=1 条）');
    t.eq(bannedKeysOf(detail.data, ['fileId', 'uploaderOpenid', 'openid'], 'failureDetail'), [],
      'F14 详情不返回 fileId/uploaderOpenid（只给 5 分钟 URL）');
    await api.call('admin.getRecognitionFailure', { failureNo: 'F-20260101-ABCDEF' });
    t.eq(auditsOf(db, 'FAILURE_IMAGE_VIEW').length, 2, 'F15 第二次查看再落一条审计（逐次审计，不批量）');
    t.eq(bannedKeysOf(auditsOf(db, 'FAILURE_IMAGE_VIEW')[0].detail,
      ['imageUrl', 'url', 'ocrTextMasked', 'uploaderOpenid', 'fileId'], 'viewAudit'), [],
    'F16 原图审计 detail 不含 URL/OCR 全文/openid');
    const beforeFixAudits = auditsOf(db, 'FAILURE_IMAGE_VIEW').length;
    const noImage = await api.call('admin.getRecognitionFailure', { failureNo: 'F-20260101-ABCDEF', withImage: false });
    t.eq([noImage.data.imageUrl, auditsOf(db, 'FAILURE_IMAGE_VIEW').length], [undefined, beforeFixAudits],
      'F17 withImage=false 不取图也不写查看审计（仅字段复核）');
    await expectCode(t, api.call('admin.getRecognitionFailure', { failureNo: 'F-NOPE' }), 'VALIDATION_FAILED',
      'F18 非法 failureNo → VALIDATION_FAILED');
    const eventsBefore = db.dump('order_events').length;
    const fix = await api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-ABCDEF', stationId: 'P1', pickupCode: 'B5678' }, { clientRequestId: nextCrid('f19') });
    t.eq([fix.ok, fix.data.status, fix.data.resolution.by], [true, 'FIXED', 'DEV-01'],
      'F19 补录成功：status=FIXED + resolution.by=developerNo');
    t.eq(fix.data.orderPatchedFields.slice().sort(), ['pickupCode', 'stationId', 'stationName'],
      'F20 只回填识别三字段（stationId/stationName/pickupCode）');
    const patchedOrder = db.dump('orders').find((row) => row._id === 'ord-ex');
    t.eq([patchedOrder.parcel.stationId, patchedOrder.parcel.pickupCode, patchedOrder.parcel.recognitionSource,
      patchedOrder.parcel.stationName.length > 0], ['P1', 'B5678', 'MANUAL', true],
    'F21 订单 parcel 回填三字段（stationName 由服务端站点表回填）+ recognitionSource=MANUAL');
    t.eq([patchedOrder.status, patchedOrder.customerId, patchedOrder.partnerId, patchedOrder.version],
      ['EXCEPTION', C1, PID1, 2], 'F22 不改订单状态/归属，仅 version+1');
    t.eq(db.dump('order_events').length, eventsBefore, 'F23 补录不写订单事件（不代确认/不推进状态）');
    const fixAudit = auditsOf(db, 'FAILURE_FIX')[0];
    t.eq([fixAudit.detail.failureNo, fixAudit.detail.orderPatched, JSON.stringify(fixAudit.detail).indexOf('B5678')],
      ['F-20260101-ABCDEF', true, -1], 'F24 审计 FAILURE_FIX 不含取件码明文/原图/OCR');
    await expectCode(t, api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-ABGHJK', stationId: 'P9' }, { clientRequestId: nextCrid('f25') }),
    'VALIDATION_FAILED', 'F25 站点非 P1~P8 → VALIDATION_FAILED（不允许自由文本）');
    await expectCode(t, api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-ABGHJK' }, { clientRequestId: nextCrid('f26') }),
    'VALIDATION_FAILED', 'F26 站点与取件码全空 → VALIDATION_FAILED');
    const fixAgain = await api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-ABCDEF', stationId: 'P1' }, { clientRequestId: nextCrid('f27') });
    t.eq(fixAgain.data.duplicated, true, 'F27 已 FIXED 再次补录 → 自然幂等 duplicated=true');
    await expectCode(t, api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-ABSTUV', stationId: 'P1' }, { clientRequestId: nextCrid('f28') }),
    'INVALID_STATE', 'F28 已 IGNORED 记录补录 → INVALID_STATE（终态不可重开）');
    const noOrderFix = await api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-ABGHJK', stationId: 'P2', note: '补站点' }, { clientRequestId: nextCrid('f29') });
    t.eq([noOrderFix.data.status, noOrderFix.data.orderPatchedFields], ['FIXED', []],
      'F29 无关联订单记录：只更新复核记录、不回填订单');
    await expectCode(t, api.call('admin.ignoreRecognitionFailure',
      { failureNo: 'F-20260101-ABJKLM', note: '' }, { clientRequestId: nextCrid('f30') }), 'VALIDATION_FAILED',
    'F30 忽略备注必填（空备注 → VALIDATION_FAILED）');
    await expectCode(t, api.call('admin.ignoreRecognitionFailure',
      { failureNo: 'F-20260101-ABJKLM', note: 'x'.repeat(101) }, { clientRequestId: nextCrid('f31') }),
    'VALIDATION_FAILED', 'F31 忽略备注 >100 字 → VALIDATION_FAILED');
    const ignore = await api.call('admin.ignoreRecognitionFailure',
      { failureNo: 'F-20260101-ABJKLM', note: '重复图', notifyUploader: true }, { clientRequestId: nextCrid('f32') });
    t.eq([ignore.ok, ignore.data.status, ignore.data.resolution.note], [true, 'IGNORED', '重复图'],
      'F32 忽略成功：status=IGNORED + resolution.note');
    t.check(auditsOf(db, 'FAILURE_IGNORE').length === 1, 'F33 审计 FAILURE_IGNORE 落库');
    const notifyRows = db.dump('order_messages').filter((row) => row.templateCode === 'RECOGNITION_REVIEW');
    t.eq([ignore.data.notified, notifyRows.length, notifyRows[0].fromId], [true, 1, 'SYSTEM'],
      'F34 notifyUploader=true 写站内通知（不单拆动作；FAILURE_IGNORE 一条）');
    const fixNotify = await api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-ABGHJK', stationId: 'P2', notifyUploader: true }, { clientRequestId: nextCrid('f35') });
    t.eq([fixNotify.data.notified, db.dump('order_messages').length], [false, notifyRows.length],
      'F35 无关联订单时通知不发（无订单可挂，notified=false）');
    await expectCode(t, api.call('admin.ignoreRecognitionFailure',
      { failureNo: 'F-20260101-ABNPQR', note: 'x' }, { clientRequestId: nextCrid('f36') }),
    'INVALID_STATE', 'F36 已 FIXED 记录不能改为忽略 → INVALID_STATE');
    const ignoreAgain = await api.call('admin.ignoreRecognitionFailure',
      { failureNo: 'F-20260101-ABSTUV', note: '再次忽略' }, { clientRequestId: nextCrid('f37') });
    t.eq(ignoreAgain.data.duplicated, true, 'F37 已 IGNORED 再次忽略 → duplicated=true');
  });
}

// ── G. 负向矩阵与静态纪律 ───────────────────────────────────────────────────
async function sectionG(h) {
  h.section('§G 负向矩阵 / 注册表 / 错误码 / 静态纪律', async (t) => {
    const adminActions = Object.keys(sharedActions.ACTION_MAP).filter((action) => action.indexOf('admin.') === 0);
    t.eq(adminActions.length, 23, 'G1 admin 动作注册表 23 个（CONTRACT §5.3 全集）');
    const registry = require(path.join(ROOT, 'cloudfunctions/api/handlers/admin/index.js'));
    t.eq(Object.keys(registry.actions).length, 23, 'G2 handlers/admin/index.js 注册 23 个 handler');
    const db = world();
    const api = apiOf(db, ADMIN);
    const db2 = world();
    const codes = [];
    const failCases = [
      api.call('admin.getCustomer', { customerNo: 'C-ZZZZ-ZZZZ' }),
      api.call('admin.getOrder', { orderNo: 'bad' }),
      apiOf(db2, C1).call('admin.stats', {}),
      apiOf(db2, ADMIN, { env: NO_ENV }).call('admin.stats', {}),
      api.call('admin.updateConfig', { config: { avatarMaxBytes: 1 } }, { clientRequestId: nextCrid('g3') }),
      api.call('admin.revokeInvite', { invitationCode: 'CDEFGHJKLMNP' }, { clientRequestId: nextCrid('g4') })
    ];
    for (const item of failCases) {
      const res = await item;
      if (!res.ok) {
        codes.push(res.code);
      }
    }
    t.eq(codes.length, 6, 'G3 六类失败路径都有错误码（样本非空）');
    t.eq(codes.filter((code) => ERROR_CODES.indexOf(code) < 0), [], 'G4 失败码 ∈ CONTRACT §5.3 的 13 码集');
    const legacy = await api.call('admin.listAudit', { action: LEGACY_AUDIT_PREFIX + 'START' });
    t.eq(legacy.ok, true, 'G5 审计筛选兼容旧切换会话名（读侧映射为 ACCOUNT_SWITCH_START）');
    const adminDir = path.join(ROOT, 'cloudfunctions/api/handlers/admin');
    const files = fs.readdirSync(adminDir).filter((name) => name.endsWith('.js'));
    const collectionHits = files.filter((name) => /db\.collection\(/.test(fs.readFileSync(path.join(adminDir, name), 'utf8')));
    t.eq(collectionHits, [], 'G6 admin 域零 db.collection（只经 dao.js）');
    const dtoText = fs.readFileSync(path.join(adminDir, '_dto.js'), 'utf8');
    t.eq([/avatarFileId\s*:/.test(dtoText), dtoText.indexOf('adminOpenid')], [false, -1],
      'G7 后台 DTO 源文件零 avatarFileId 赋值/adminOpenid');
    const messagesApi = apiOf(db2, C1);
    await expectCode(t, messagesApi.call('admin.createInvites', { count: 1 },
      { clientRequestId: nextCrid('g8') }), 'FORBIDDEN', 'G8 顾客调 admin 写动作 → FORBIDDEN（与读同码）');
    const unauthenticated = createApi({ db: db2, now: NOW, env: ENV, openid: '' });
    await expectCode(t, unauthenticated.call('admin.stats', {}), 'FORBIDDEN',
      'G9 未登录（无 OPENID）调 admin.* → FORBIDDEN');
  });
}

// ── 注册 ─────────────────────────────────────────────────────────────────────
function register(h) {
  h.setExpected(EXPECTED_ASSERTIONS);
  sectionA(h);
  sectionB(h);
  sectionC(h);
  sectionD(h);
  sectionD2(h);
  sectionE(h);
  sectionF(h);
  sectionG(h);
  v1Cases.register(h, {
    world,
    apiOf,
    failureDoc,
    expectCode,
    keysOf,
    bannedKeysOf,
    auditsOf,
    nextCrid,
    ADMIN,
    C1,
    PID1,
    P1,
    NOW,
    HOUR
  });
}

module.exports = {
  EXPECTED_ASSERTIONS,
  register,
  DTO_BANNED,
  ERROR_CODES
};

if (require.main === module) {
  const h = createHarness({ name: 'selftest-admin' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-admin');
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
