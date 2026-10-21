'use strict';
/**
 * tools/selftest-deletion.js — 批 9「注销 / 数据删除链路」端到端判据套件（task-83）。
 *
 * A user.deleteAccount handler：confirmText 校验 / 进行中订单拦截且零写入 / 事务撤销 ACTIVE 绑定
 *   （CUSTOMER_ACCOUNT_CLOSED）+ 清 partnerNote / users DEACTIVATED + deletionRequestedAt /
 *   非顾客角色与 READONLY 会话拒绝 / 重复注销（duplicated）分支。
 * B cleanup.runAccountDeletion 阶段一（申请后每轮）：customers PII 匿名化 + 头像文件删除、订单立即匿名化
 *   （含 EXCEPTION 等非终态单）+ 截图清理、留言/事件去标识、识别失败 uploaderOpenid/fileId 清空并按引用计数删图、
 *   上传票据删除、切换会话 endedAt + ACCOUNT_SWITCH_END(TARGET_DELETED) 幂等、历史 bindings.partnerNote 清理。
 * C 阶段二（deletionRequestedAt+30d 时间旅行）：物理删 users/customers/bindings/tickets + 头像兜底删除、
 *   阈值前不动、重跑 acted 收敛 0、批上限 100 可重入、缺 deletionRequestedAt 脏数据跳过。
 * D 兼职 CLOSED 链路（DATA_MODEL §10.3）：释放绑定（PARTNER_CLOSED）+ 清 partnerNote、进行中订单转 EXCEPTION
 *   + ORDER_ANOMALY 事件、partners 匿名化（displayName/avatarFileId/停用与关闭原因）并删头像文件、
 *   invitation_codes.usedBy 置空保留 usedAt/batchId、识别失败匿名化与引用计数删图、
 *   CLOSED 后不可预览/再激活/被绑定/接单/恢复。
 * E 缺陷修复回归与边界/失败隔离：拒绝路径零写入、删文件失败不炸 sweep、脏数据不崩、空世界 acted=0、
 *   重复 CLOSED 不重复写订单事件。
 * F 端侧注销路径静态判据：pages/profile 两步确认文案 + 「注销」确认文本单源 + 调用形态；privacy-text 注销条款一致。
 *
 * 纪律：fake DB 注入、不 mock 全局 wx、不连真库/真云；EXPECTED_ASSERTIONS 与实际断言数精确相等；
 *      先合法基线再反例；每条断言文字带 §节号。取数：node tools/selftest-deletion.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLEANUP = path.join(ROOT, 'cloudfunctions/cleanup');

const { createHarness, installCrashGuard } = require('./selftest');
const fake = require('./fake-db');
const { createApi } = require(path.join(ROOT, 'cloudfunctions/api/app.js'));
const { createDao: createApiDao } = require(path.join(ROOT, 'cloudfunctions/api/db/dao.js'));
const { createDao: createCleanupDao } = require(path.join(CLEANUP, 'db/dao.js'));
const accountsSweep = require(path.join(CLEANUP, 'sweeps/accounts.js'));
const { COLLECTIONS } = require(path.join(ROOT, 'shared/collections.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const auditActions = require(path.join(ROOT, 'shared/audit-actions.js'));

// harness 完整性闸：先占位，首跑按真实断言数回填（少算/多算都判红）。
const EXPECTED_ASSERTIONS = 89;

const NOW = Date.parse('2026-10-22T12:00:00+08:00');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ADMIN = 'admin-openid';
const ENV = { ADMIN_OPENIDS: JSON.stringify({ [ADMIN]: 'DEV-01' }) };
const CUST = 'CUST-A';
const PARTNER_OPENID = 'PARTNER-A';
const PARTNER_ID = 'p-1';
const VIEW_TICKET = 'T'.repeat(32);
const COLLECTION_NAMES = Object.keys(COLLECTIONS).map((key) => COLLECTIONS[key]);

// ---------------------------------------------------------------- 测试桩
// 云存储替身：记录删除调用；可注入"删除失败"验证 sweep/handler 的容错分支。
function createCloud(options) {
  const opts = options || {};
  const deleted = [];
  const attempted = [];
  return {
    deleted,
    attempted,
    openapi: { security: { async msgSecCheck() { return { result: { suggest: 'pass' } }; } } },
    async deleteFile(payload) {
      const list = payload && Array.isArray(payload.fileList) ? payload.fileList : [];
      list.forEach((fileId) => {
        attempted.push(fileId);
        if (opts.throwOnDelete === true) {
          throw new Error('cloud.deleteFile 失败（测试注入）');
        }
      });
      list.forEach((fileId) => deleted.push(fileId));
      return { fileList: list.map((fileID) => ({ fileID, status: 0 })) };
    }
  };
}

function makeWorld(seed) {
  const db = fake.createFakeDb({
    uniqueIndexes: {
      users: [['_id']],
      customers: [['_id'], ['customerNo']],
      partners: [['openid'], ['partnerNo']],
      orders: [['orderNo'], ['requestKey']],
      order_events: [['requestKey']],
      admin_audit: [['requestKey']],
      admin_view_sessions: [['requestKey']],
      invitation_codes: [['code']],
      bindings: [['activeKey']],
      recognition_failures: [['failureNo']],
      upload_tickets: [['ticket']],
      counters: [['key']]
    }
  });
  COLLECTION_NAMES.forEach((name) => db.seed(name, []));
  const world = seed || {};
  Object.keys(world).forEach((name) => db.seed(name, world[name]));
  return db;
}

function userOf(openid, extra) {
  return Object.assign({
    _id: openid,
    roles: [enums.ROLES.CUSTOMER],
    status: enums.USER_STATUS.ACTIVE,
    isTestAccount: false,
    privacyConsent: { version: 'v4.0', at: NOW - 100 * DAY },
    messageReadAt: 0,
    createdAt: NOW - 100 * DAY,
    updatedAt: NOW - DAY
  }, extra || {});
}

function customerOf(openid, extra) {
  return Object.assign({
    _id: openid,
    customerNo: 'C' + 'ABCDEFGH',
    displayName: '小王',
    avatarFileId: 'cloud://avatar-' + openid + '.jpg',
    zone: 'D',
    buildingNo: 4,
    room: '522',
    dormKey: 'D4-522',
    phoneTail: '6678',
    profileCompleted: true,
    createdAt: NOW - 100 * DAY,
    updatedAt: NOW - DAY
  }, extra || {});
}

function partnerOf(openid, extra) {
  return Object.assign({
    _id: PARTNER_ID,
    openid: openid,
    partnerNo: 'PAAAAAA',
    displayName: '老张',
    avatarFileId: 'cloud://avatar-' + openid + '.jpg',
    status: enums.PARTNER_STATUS.ACTIVE,
    serviceConfig: { services: [{ code: 'PICKUP_STD', enabled: true }], zones: ['D'], acceptingOrders: true },
    stats: { todayOrders: 1, totalOrders: 2, completedOrders: 1, cancelledOrders: 0, activeOrders: 1 },
    suspendedAt: null,
    suspendedReason: '',
    deletedAt: null,
    closedReason: '',
    activatedAt: NOW - 60 * DAY,
    createdAt: NOW - 60 * DAY,
    updatedAt: NOW - DAY
  }, extra || {});
}

function dormOf() {
  return { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'D4-522A' };
}

function bindingOf(id, customerId, partnerId, extra) {
  return Object.assign({
    _id: id,
    customerId: customerId,
    partnerId: partnerId,
    status: enums.BINDING_STATUS.ACTIVE,
    activeKey: customerId,
    roomTag: 'A',
    allocSeq: 1,
    tagKey: partnerId + ':D4-522:A',
    dormSnapshot: dormOf(),
    partnerNote: '放门口',
    boundAt: NOW - 10 * DAY,
    releasedAt: null,
    releaseReason: '',
    releaseNote: '',
    releasedBy: '',
    updatedAt: NOW - 10 * DAY
  }, extra || {});
}

let orderSeq = 0;
function orderOf(id, extra) {
  orderSeq += 1;
  const orderNo = '20261022-' + String(1000 + orderSeq);
  const base = {
    _id: id,
    orderNo: orderNo,
    customerId: CUST,
    customerOpenid: CUST,
    customerNo: 'CADEFGHJK',
    partnerId: PARTNER_ID,
    partnerOpenid: PARTNER_OPENID,
    partnerNo: 'PAAAAAA',
    isTest: false,
    version: 1,
    source: 'CUSTOMER',
    service: { code: 'PICKUP_STD', name: '标准代取' },
    dorm: dormOf(),
    guest: null,
    phoneTail: '6678',
    note: '放门口',
    deliveryNote: '到了打电话',
    cancelReason: '',
    exception: null,
    parcel: {
      stationId: 'P1', stationName: '菜鸟驿站P1', pickupCode: 'A1234',
      lockerNo: '12号柜', trackingTail: '7788', codeStatus: enums.CODE_STATUS.OK
    },
    image: { fileId: '', width: 0, height: 0, failureId: '', cleanedAt: null },
    createdAt: new Date(NOW - 5 * HOUR),
    statusUpdatedAt: new Date(NOW - 5 * HOUR),
    updatedAt: new Date(NOW - 5 * HOUR)
  };
  return Object.assign(base, extra || {});
}

function failureOf(id, extra) {
  return Object.assign({
    _id: id,
    failureNo: 'F-20261001-' + id.toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(6, 'X').slice(0, 6),
    requestKey: 'rf-' + id,
    status: enums.FAILURE_STATUS.PENDING,
    failureCode: 'PARSE_MISS',
    sourceRole: 'CUSTOMER',
    uploaderOpenid: CUST,
    orderId: '',
    fileId: '',
    ocrTextMasked: '驿站 P1 取件码 ****',
    ruleResult: { stationId: '', pickupCode: '' },
    aiTried: false,
    aiModel: '',
    aiResult: null,
    aiErrorCode: '',
    retentionDays: 30,
    resolution: null,
    reviewedAt: null,
    createdAt: new Date(NOW - 2 * DAY),
    updatedAt: new Date(NOW - 2 * DAY)
  }, extra || {});
}

function ticketOf(id, openid, extra) {
  return Object.assign({
    _id: 'ticket-doc-' + id,
    ticket: 'TK' + id.toUpperCase(),
    openid: openid,
    purpose: enums.UPLOAD_PURPOSE.TICKET,
    cloudPath: 'orders/TK' + id.toUpperCase() + '/image.jpg',
    expiresAt: NOW + HOUR,
    usedAt: null,
    createdAt: NOW - DAY
  }, extra || {});
}

function sessionOf(id, targetId, extra) {
  return Object.assign({
    _id: id,
    requestKey: 'switch-' + id,
    adminOpenid: ADMIN,
    developerNo: 'DEV-01',
    viewMode: enums.VIEW_MODE.READONLY,
    role: enums.ROLES.CUSTOMER,
    targetId: targetId,
    targetNo: 'CADEFGHJK',
    targetDisplayName: '小王',
    targetIsTest: false,
    createdAt: NOW - HOUR,
    expiresAt: NOW + HOUR,
    endedAt: null
  }, extra || {});
}

function inviteOf(id, extra) {
  return Object.assign({
    _id: 'invite-' + id,
    code: 'INV' + id.toUpperCase().padEnd(8, 'X'),
    status: enums.INVITATION_STATUS.USED,
    batchId: 'B20261001-01',
    usedBy: PARTNER_ID,
    usedAt: new Date(NOW - 40 * DAY),
    expiresAt: new Date(NOW + 7 * DAY),
    note: '',
    createdBy: 'DEV-01',
    createdAt: new Date(NOW - 40 * DAY),
    revokedAt: null,
    revokedBy: '',
    updatedAt: new Date(NOW - 40 * DAY)
  }, extra || {});
}

function apiOf(db, openid, options) {
  const opts = options || {};
  return createApi({
    db: db,
    now: NOW,
    env: opts.env === undefined ? ENV : opts.env,
    cloud: opts.cloud || createCloud(),
    openid: openid
  });
}

let cleanupCtxSeq = 0;
function cleanupCtx(db, options) {
  const opts = options || {};
  cleanupCtxSeq += 1;
  return {
    dao: createCleanupDao(db),
    db: db,
    cloud: opts.cloud || createCloud(),
    env: {},
    config: opts.config || {},
    now: typeof opts.now === 'number' ? opts.now : NOW,
    requestId: 'selftest-deletion-' + cleanupCtxSeq,
    COLLECTIONS: COLLECTIONS
  };
}

function nextCrid(tag, index) {
  return 'TASK83DEL' + String(tag || '').toUpperCase().padEnd(4, 'X') + String(index || 1).padStart(3, '0');
}

function dateMs(value) {
  return value instanceof Date ? value.getTime() : value;
}

function byId(db, name, id) {
  return db.dump(name).filter((row) => row._id === id)[0];
}

function auditsOf(db, action) {
  return db.dump(COLLECTIONS.ADMIN_AUDIT).filter((row) => row.action === action);
}

function countOf(db, name) {
  return db.count(name);
}

// ---------------------------------------------------------------- §A handler
async function sectionA(t) {
  const db = makeWorld({
    users: [userOf(CUST), userOf(PARTNER_OPENID, { roles: [enums.ROLES.PARTNER] })],
    customers: [customerOf(CUST)],
    partners: [partnerOf(PARTNER_OPENID)],
    bindings: [bindingOf('bind-a', CUST, PARTNER_ID, { partnerNote: '放门口' })],
    orders: [orderOf('ord-done-a', {
      status: enums.ORDER_STATUS.COMPLETED,
      statusUpdatedAt: new Date(NOW - 2 * HOUR),
      completedAt: new Date(NOW - 2 * HOUR)
    })]
  });
  const cloud = createCloud();
  const api = apiOf(db, CUST, { cloud });
  const res = await api.call('user.deleteAccount', { confirmText: '注销', reason: '毕业离校' });
  t.eq([res.ok, res.data.duplicated, res.data.deletionRequestedAt], [true, false, NOW],
    '§A 无进行中订单可注销：deletionRequestedAt=注入 now、duplicated=false（合法基线）');
  const user = byId(db, COLLECTIONS.USERS, CUST);
  t.eq([user.status, dateMs(user.deletionRequestedAt)], [enums.USER_STATUS.DEACTIVATED, NOW],
    '§A users.status=DEACTIVATED + deletionRequestedAt 落库（DATA_MODEL §10.4）');
  const binding = byId(db, COLLECTIONS.BINDINGS, 'bind-a');
  t.eq([binding.status, binding.releaseReason, binding.releasedBy],
    [enums.BINDING_STATUS.RELEASED, 'CUSTOMER_ACCOUNT_CLOSED', enums.CANCELLED_BY.CUSTOMER],
    '§A 事务内 ACTIVE 绑定 → RELEASED（CUSTOMER_ACCOUNT_CLOSED / releasedBy=CUSTOMER）');
  t.eq([binding.releaseNote, dateMs(binding.releasedAt)], ['毕业离校', NOW],
    '§A 释放行保留原因说明 + releasedAt=now');
  t.eq(binding.partnerNote, '', '§A 注销时清 bindings.partnerNote（DATA_MODEL §10.3：顾客注销删 partnerNote）');

  const activeDb = makeWorld({
    users: [userOf(CUST)],
    customers: [customerOf(CUST)],
    partners: [partnerOf(PARTNER_OPENID)],
    bindings: [bindingOf('bind-active', CUST, PARTNER_ID)],
    orders: [orderOf('ord-active', { status: enums.ORDER_STATUS.SUBMITTED, statusUpdatedAt: new Date(NOW - HOUR) })]
  });
  const reject = await apiOf(activeDb, CUST).call('user.deleteAccount', { confirmText: '注销' });
  t.eq([reject.ok, reject.code], [false, 'INVALID_STATE'],
    '§A 有进行中订单 → INVALID_STATE（不进入注销流程）');
  t.eq([byId(activeDb, COLLECTIONS.USERS, CUST).status, byId(activeDb, COLLECTIONS.BINDINGS, 'bind-active').status,
    byId(activeDb, COLLECTIONS.ORDERS, 'ord-active').status],
  [enums.USER_STATUS.ACTIVE, enums.BINDING_STATUS.ACTIVE, enums.ORDER_STATUS.SUBMITTED],
  '§A 拒绝路径零写入：用户/绑定/订单原样（事务未启动）');

  const badText = await apiOf(makeWorld({ users: [userOf(CUST)], customers: [customerOf(CUST)] }), CUST)
    .call('user.deleteAccount', { confirmText: '取消' });
  t.eq([badText.ok, badText.code, badText.data && badText.data.field], [false, 'VALIDATION_FAILED', 'confirmText'],
    '§A confirmText 不是「注销」→ VALIDATION_FAILED 且 field=confirmText');
  const noText = await apiOf(makeWorld({ users: [userOf(CUST)], customers: [customerOf(CUST)] }), CUST)
    .call('user.deleteAccount', {});
  t.eq([noText.ok, noText.code], [false, 'VALIDATION_FAILED'], '§A 缺 confirmText → VALIDATION_FAILED');

  const partnerOnly = makeWorld({ users: [userOf('P-ONLY', { roles: [enums.ROLES.PARTNER] })] });
  const wrongRole = await apiOf(partnerOnly, 'P-ONLY').call('user.deleteAccount', { confirmText: '注销' });
  t.eq([wrongRole.ok, wrongRole.code], [false, 'FORBIDDEN'], '§A 非顾客身份（PARTNER）→ FORBIDDEN');

  const viewDb = makeWorld({
    users: [userOf(CUST)],
    customers: [customerOf(CUST)],
    admin_view_sessions: [sessionOf(VIEW_TICKET, CUST)]
  });
  const readonly = await apiOf(viewDb, ADMIN).call('user.deleteAccount',
    { confirmText: '注销' }, { viewTicket: VIEW_TICKET });
  t.eq([readonly.ok, readonly.code], [false, 'FORBIDDEN'],
    '§A 真实账号 READONLY 切换会话调注销 → FORBIDDEN（服务端兜底，CONTRACT §1.2）');

  const freeDb = makeWorld({ users: [userOf(CUST)], customers: [customerOf(CUST)] });
  const free = await apiOf(freeDb, CUST).call('user.deleteAccount', { confirmText: '注销' });
  t.eq([free.ok, free.data.duplicated], [true, false], '§A 无 ACTIVE 绑定也可注销（绑定释放是可选分支）');

  // 重复注销：DATA_MODEL §7.6「DEACTIVATED 后重复返回」由 handler 幂等分支承担。
  // 说明：整链路上 auth 中间件会先按「账号已停用」拒绝一切动作（CONTRACT §11.4「注销后只回 DEACTIVATED」），
  // 因此这里按 ENGINEERING §6.3「handler 单测（注入 fake DB）」直调 handler 验证幂等分支本身。
  const dupDb = makeWorld({
    users: [userOf('CUST-DUP', {
      status: enums.USER_STATUS.DEACTIVATED,
      deletionRequestedAt: new Date(NOW - 5 * DAY)
    })],
    customers: [customerOf('CUST-DUP')]
  });
  const handler = require(path.join(ROOT, 'cloudfunctions/api/handlers/user/deleteAccount.js')).handler;
  const dup = await handler({
    dao: createApiDao(dupDb),
    now: NOW,
    cloud: createCloud(),
    openid: 'CUST-DUP',
    identity: {
      actorOpenid: 'CUST-DUP', effectiveOpenid: 'CUST-DUP', role: enums.ROLES.CUSTOMER,
      viewMode: '', viewTicketId: '', developerNo: ''
    }
  }, { confirmText: '注销' });
  t.eq([dup.duplicated, dup.deletionRequestedAt], [true, NOW - 5 * DAY],
    '§A 重复注销幂等：返回原 deletionRequestedAt + duplicated=true');
  t.eq(dateMs(byId(dupDb, COLLECTIONS.USERS, 'CUST-DUP').deletionRequestedAt), NOW - 5 * DAY,
    '§A 重复注销不重写 deletionRequestedAt（幂等零写入）');

  // 中间件层闸（真实链路）：隐私同意闸 / 维护模式写闸都先于 handler 生效。
  const gateDb = makeWorld({ users: [userOf(CUST, { privacyConsent: null })], customers: [customerOf(CUST)] });
  gateDb.seed(COLLECTIONS.CONFIG, [{ _id: 'global', privacyVersion: 'v4.0', maintenance: { enabled: false, text: '' } }]);
  const noConsent = await apiOf(gateDb, CUST).call('user.deleteAccount', { confirmText: '注销' });
  t.eq([noConsent.ok, noConsent.code], [false, 'INVALID_STATE'],
    '§A 隐私同意闸（中间件层）：未同意当前隐私版本 → INVALID_STATE');
  const maintainDb = makeWorld({ users: [userOf(CUST)], customers: [customerOf(CUST)] });
  maintainDb.seed(COLLECTIONS.CONFIG, [{ _id: 'global', privacyVersion: 'v4.0', maintenance: { enabled: true, text: '维护中' } }]);
  const maintained = await apiOf(maintainDb, CUST).call('user.deleteAccount', { confirmText: '注销' });
  t.eq([maintained.ok, maintained.code], [false, 'INVALID_STATE'],
    '§A 维护闸（中间件层）：维护中客户端写动作（注销）→ INVALID_STATE（读放行不影响本动作）');
}

// ---------------------------------------------------------------- §B 阶段一
async function sectionB(t) {
  const avatar = 'cloud://avatar-del.jpg';
  const sharedShot = 'cloud://shot-b1.jpg';
  const db = makeWorld({
    users: [userOf(CUST, { status: enums.USER_STATUS.DEACTIVATED, deletionRequestedAt: new Date(NOW - 10 * DAY) })],
    customers: [customerOf(CUST, { customerNo: 'CDELDEL1', avatarFileId: avatar })],
    partners: [partnerOf(PARTNER_OPENID)],
    bindings: [
      bindingOf('bind-released', CUST, PARTNER_ID, {
        status: enums.BINDING_STATUS.RELEASED,
        activeKey: CUST + ':RELEASED:bind-released',
        partnerNote: '放门口',
        releasedAt: new Date(NOW - 10 * DAY),
        releaseReason: 'CUSTOMER_ACCOUNT_CLOSED'
      }),
      bindingOf('bind-old', CUST, PARTNER_ID, {
        status: enums.BINDING_STATUS.RELEASED,
        activeKey: CUST + ':RELEASED:bind-old',
        partnerNote: '历史备注',
        releasedAt: new Date(NOW - 40 * DAY),
        releaseReason: 'CUSTOMER_INITIATED'
      })
    ],
    orders: [
      orderOf('b-order-1', {
        customerNo: 'CDELDEL1',
        status: enums.ORDER_STATUS.COMPLETED,
        statusUpdatedAt: new Date(NOW - 5 * DAY),
        completedAt: new Date(NOW - 5 * DAY),
        image: { fileId: sharedShot, width: 800, height: 600, failureId: '' }
      }),
      orderOf('b-order-2', {
        customerNo: 'CDELDEL1',
        status: enums.ORDER_STATUS.EXCEPTION,
        statusUpdatedAt: new Date(NOW - 3 * DAY),
        exception: { code: 'OTHER', text: '异常备注', fromStatus: 'PICKED', by: 'PARTNER', at: new Date(NOW - 3 * DAY) },
        image: { fileId: 'cloud://shot-b2.jpg', width: 800, height: 600, failureId: '' }
      })
    ],
    order_messages: [{
      _id: 'b-msg-1', orderId: 'b-order-1', fromRole: 'CUSTOMER', fromId: CUST,
      text: '取件码 1234', createdAt: new Date(NOW - 5 * DAY)
    }],
    order_events: [{
      _id: 'b-evt-1', orderId: 'b-order-1', type: 'ORDER_CREATED', actorRole: 'CUSTOMER',
      actorId: CUST, payload: { note: 'PII' }, at: new Date(NOW - 5 * DAY), requestKey: 'b-evt-1'
    }],
    recognition_failures: [
      failureOf('b-f-1', { uploaderOpenid: CUST, orderId: 'b-order-1', fileId: sharedShot }),
      failureOf('b-f-2', { uploaderOpenid: CUST, status: enums.FAILURE_STATUS.IGNORED, fileId: 'cloud://fail-only.jpg' })
    ],
    upload_tickets: [ticketOf('b-tk', CUST)],
    admin_view_sessions: [sessionOf(VIEW_TICKET, CUST)]
  });
  const cloud = createCloud();
  const ctx = cleanupCtx(db, { cloud });
  const result = await accountsSweep.runAccountDeletion(ctx);
  t.eq([result.scanned, result.acted, result.failed], [1, 1, 0],
    '§B 注销申请 10 天：阶段一执行 1 个账号、无失败');
  const customer = byId(db, COLLECTIONS.CUSTOMERS, CUST);
  t.eq([customer.displayName, customer.avatarFileId, customer.phoneTail, customer.zone, customer.buildingNo,
    customer.room, customer.dormKey, customer.profileCompleted],
  ['', '', '', '', 0, '', '', false],
  '§B customers PII 匿名化：昵称/头像/尾号/宿舍清空 + profileCompleted=false（DATA_MODEL §10.3）');
  t.eq([dateMs(customer.deletedAt), dateMs(customer.anonymizedAt), dateMs(customer.purgeAt)],
    [NOW, NOW, NOW + 30 * DAY],
    '§B customers 写 deletedAt/anonymizedAt/purgeAt（30 天时间线）');
  t.eq(cloud.deleted.indexOf(avatar) !== -1, true, '§B 注销立即删头像云文件（不等 30 天）');
  const order1 = byId(db, COLLECTIONS.ORDERS, 'b-order-1');
  t.eq([order1.customerId, order1.customerOpenid, order1.customerNo, order1.phoneTail, order1.note,
    order1.deliveryNote, order1.cancelReason, order1.dorm, order1.guest],
  ['', '', '', '', '', '', '', null, null],
  '§B 订单立即匿名化：去 openid/编号快照/尾号/备注/宿舍（不等 180 天）');
  t.eq([order1.parcel.pickupCode, order1.parcel.lockerNo, order1.parcel.trackingTail,
    order1.parcel.stationName, order1.parcel.stationId],
  ['', '', '', '', 'P1'], '§B 订单匿名化清取件码/柜号/尾号/站名、保留 stationId');
  t.eq([order1.image.fileId, dateMs(order1.image.cleanedAt), dateMs(order1.anonymizedAt)],
    ['', NOW, NOW], '§B 订单截图引用清空 + cleanedAt/anonymizedAt=注入 now');
  const order2 = byId(db, COLLECTIONS.ORDERS, 'b-order-2');
  t.eq([order2.customerId, order2.exception, dateMs(order2.anonymizedAt)], ['', null, NOW],
    '§B 非终态（EXCEPTION）订单同样立即匿名化：异常说明也清空');
  const message = byId(db, COLLECTIONS.ORDER_MESSAGES, 'b-msg-1');
  t.eq([message.text, message.fromId], ['[已删除]', ''], '§B order_messages：text=[已删除]、fromId 清空');
  const event = byId(db, COLLECTIONS.ORDER_EVENTS, 'b-evt-1');
  t.eq([event.actorId, event.payload], ['', {}], '§B order_events：actorId 清空、payload 去 PII');
  const failure1 = byId(db, COLLECTIONS.RECOGNITION_FAILURES, 'b-f-1');
  t.eq([failure1.uploaderOpenid, failure1.fileId, failure1.ocrTextMasked], ['', '', '驿站 P1 取件码 ****'],
    '§B 识别失败记录 uploaderOpenid/fileId 清空、已去敏 OCR 文本保留至到期(§13.2)');
  t.eq(byId(db, COLLECTIONS.RECOGNITION_FAILURES, 'b-f-2').fileId, '',
    '§B 识别失败原图引用清空（第二类：无订单共享的独立截图）');
  t.eq([cloud.deleted.indexOf(sharedShot) !== -1, cloud.deleted.indexOf('cloud://fail-only.jpg') !== -1],
    [true, true],
    '§B 原图按引用计数删除：订单侧先清引用，失败记录侧再清 → 两个 fileId 都删（§10.3）');
  t.eq(countOf(db, COLLECTIONS.UPLOAD_TICKETS), 0, '§B 注销清上传票据');
  const session = byId(db, COLLECTIONS.ADMIN_VIEW_SESSIONS, VIEW_TICKET);
  const endAudits = auditsOf(db, auditActions.AUDIT_ACTIONS.ACCOUNT_SWITCH_END);
  t.eq([dateMs(session.endedAt), endAudits.length, endAudits[0] && endAudits[0].detail.reason],
    [NOW, 1, 'TARGET_DELETED'], '§B 目标账号有效切换会话立即 endedAt + 1 条 ACCOUNT_SWITCH_END(TARGET_DELETED)');
  t.eq([byId(db, COLLECTIONS.BINDINGS, 'bind-released').partnerNote,
    byId(db, COLLECTIONS.BINDINGS, 'bind-old').partnerNote], ['', ''],
  '§B 阶段一清历史 bindings.partnerNote（含已释放历史行，DATA_MODEL §10.3）');
  t.eq([countOf(db, COLLECTIONS.USERS), byId(db, COLLECTIONS.USERS, CUST).status],
    [1, enums.USER_STATUS.DEACTIVATED], '§B 30 天前不物理删 users（阶段一只匿名化）');
  const rerun = await accountsSweep.runAccountDeletion(ctx);
  t.eq(rerun.acted, 0, '§B 重跑幂等：阶段一已处理 → acted=0');
  t.eq(auditsOf(db, auditActions.AUDIT_ACTIONS.ACCOUNT_SWITCH_END).length, 1,
    '§B 重跑不重复写 ACCOUNT_SWITCH_END（requestKey 幂等）');
}

// ---------------------------------------------------------------- §C 阶段二
async function sectionC(t) {
  const db = makeWorld({
    users: [
      userOf('C-GONE', { status: enums.USER_STATUS.DEACTIVATED, deletionRequestedAt: new Date(NOW - 31 * DAY) }),
      userOf('C-KEEP', { status: enums.USER_STATUS.DEACTIVATED, deletionRequestedAt: new Date(NOW - 29 * DAY) })
    ],
    customers: [
      customerOf('C-GONE', { customerNo: 'CGONEGON', avatarFileId: 'cloud://avatar-gone.jpg' }),
      customerOf('C-KEEP', { customerNo: 'CKEEPKEE', avatarFileId: '' })
    ],
    bindings: [bindingOf('bind-gone', 'C-GONE', PARTNER_ID, {
      status: enums.BINDING_STATUS.RELEASED,
      activeKey: 'C-GONE:RELEASED:bind-gone',
      partnerNote: '',
      releasedAt: new Date(NOW - 31 * DAY)
    })],
    upload_tickets: [ticketOf('c-tk', 'C-GONE')],
    admin_view_sessions: [sessionOf('S'.repeat(32), 'C-GONE')]
  });
  const cloud = createCloud();
  const ctx = cleanupCtx(db, { cloud });
  const result = await accountsSweep.runAccountDeletion(ctx);
  t.eq([result.scanned, result.failed], [2, 0], '§C 两个注销申请均被扫描、无失败');
  t.eq([countOf(db, COLLECTIONS.USERS), countOf(db, COLLECTIONS.CUSTOMERS),
    countOf(db, COLLECTIONS.BINDINGS), countOf(db, COLLECTIONS.UPLOAD_TICKETS)], [1, 1, 0, 0],
  '§C 申请满 30 天：物理删 users/customers/bindings/票据（29 天账号保留）');
  t.eq(byId(db, COLLECTIONS.USERS, 'C-GONE'), undefined, '§C 到期账号 users 行物理删除');
  t.eq([byId(db, COLLECTIONS.USERS, 'C-KEEP') !== undefined,
    byId(db, COLLECTIONS.CUSTOMERS, 'C-KEEP').anonymizedAt instanceof Date], [true, true],
  '§C 阈值前（29 天）：只做阶段一匿名化、不物理删');
  t.eq(cloud.deleted.indexOf('cloud://avatar-gone.jpg') !== -1, true, '§C 阶段二头像文件兜底删除');
  t.eq(cloud.deleted.filter((fileId) => fileId === 'cloud://avatar-gone.jpg').length, 1,
    '§C 头像文件只删一次（阶段二兜底不重复删）');
  const rerun = await accountsSweep.runAccountDeletion(ctx);
  t.eq([rerun.acted, rerun.failed], [0, 0], '§C 重跑幂等：已删账号不再命中，acted 收敛为 0');
  t.eq(auditsOf(db, auditActions.AUDIT_ACTIONS.ACCOUNT_SWITCH_END).length, 1,
    '§C 重跑不重复写审计');

  // 批上限：BATCH=100，120 个到期账号分两轮清完（不堆死后续轮次）
  const batchUsers = [];
  for (let i = 0; i < 120; i += 1) {
    batchUsers.push(userOf('C-BATCH-' + i, {
      status: enums.USER_STATUS.DEACTIVATED,
      deletionRequestedAt: new Date(NOW - 31 * DAY - i * MINUTE)
    }));
  }
  const batchDb = makeWorld({ users: batchUsers });
  const batchCtx = cleanupCtx(batchDb);
  const first = await accountsSweep.runAccountDeletion(batchCtx);
  const second = await accountsSweep.runAccountDeletion(batchCtx);
  const third = await accountsSweep.runAccountDeletion(batchCtx);
  t.eq([first.acted, second.acted, third.acted], [100, 20, 0],
    '§C 批上限 100：120 个到期账号两轮清完、第三轮 acted=0（可重入）');
  t.eq(countOf(batchDb, COLLECTIONS.USERS), 0, '§C 批处理完成后到期账号全部物理删');

  const dirtyDb = makeWorld({
    users: [userOf('C-DIRTY', { status: enums.USER_STATUS.DEACTIVATED, deletionRequestedAt: null })]
  });
  const dirty = await accountsSweep.runAccountDeletion(cleanupCtx(dirtyDb));
  t.eq([dirty.scanned, dirty.acted, dirty.failed], [0, 0, 0],
    '§C 缺 deletionRequestedAt 的脏数据跳过（不误删、不崩）');
  t.eq(byId(dirtyDb, COLLECTIONS.USERS, 'C-DIRTY') !== undefined, true, '§C 脏数据账号原样保留');
}

// ---------------------------------------------------------------- §D 兼职 CLOSED
async function sectionD(t) {
  const partnerAvatar = 'cloud://avatar-' + PARTNER_OPENID + '.jpg';
  const sharedShot = 'cloud://shot-ord-sub.jpg';
  const db = makeWorld({
    users: [userOf(CUST), userOf('CUST-B', { roles: [enums.ROLES.CUSTOMER] }),
      userOf(PARTNER_OPENID, { roles: [enums.ROLES.PARTNER] }), userOf(ADMIN, { roles: [] })],
    customers: [customerOf(CUST), customerOf('CUST-B', { customerNo: 'CBBBBBBB', displayName: '小李' })],
    partners: [partnerOf(PARTNER_OPENID, { suspendedReason: '临时停用', closedReason: '' })],
    bindings: [bindingOf('bind-d', CUST, PARTNER_ID, { partnerNote: '放门口' })],
    orders: [
      orderOf('ord-sub', { status: enums.ORDER_STATUS.SUBMITTED, image: { fileId: sharedShot, width: 800, height: 600, failureId: '' } }),
      orderOf('ord-acc', { status: enums.ORDER_STATUS.ACCEPTED }),
      orderOf('ord-pick', { status: enums.ORDER_STATUS.PICKED }),
      orderOf('ord-del', { status: enums.ORDER_STATUS.DELIVERED, deliveredAt: new Date(NOW - HOUR) }),
      orderOf('ord-done', { status: enums.ORDER_STATUS.COMPLETED, completedAt: new Date(NOW - 10 * DAY) })
    ],
    invitation_codes: [
      inviteOf('used', { usedBy: PARTNER_ID }),
      inviteOf('other', { code: 'INVOTHER1', usedBy: 'other-partner-id' }),
      inviteOf('unused', {
        code: 'ABCDEFGHJKLM',
        status: enums.INVITATION_STATUS.UNUSED,
        usedBy: '',
        usedAt: null
      })
    ],
    recognition_failures: [
      failureOf('d-f-1', { uploaderOpenid: PARTNER_OPENID, orderId: 'ord-sub', fileId: 'cloud://fail-only-p1.jpg' }),
      failureOf('d-f-2', { uploaderOpenid: PARTNER_OPENID, orderId: 'ord-sub', fileId: sharedShot })
    ]
  });
  const cloud = createCloud();
  const adminApi = apiOf(db, ADMIN, { cloud });
  const subOrderNo = byId(db, COLLECTIONS.ORDERS, 'ord-sub').orderNo;
  const crid = nextCrid('d', 1);
  const closed = await adminApi.call('admin.setPartnerStatus',
    { partnerNo: 'PAAAAAA', status: enums.PARTNER_STATUS.CLOSED, reason: '毕业离开' },
    { clientRequestId: crid });
  t.eq([closed.ok, closed.data.affectedBindings, closed.data.affectedOrders], [true, 1, 3],
    '§D 注销兼职：释放 1 条绑定、3 单进行中（SUBMITTED/ACCEPTED/PICKED）转异常');
  const binding = byId(db, COLLECTIONS.BINDINGS, 'bind-d');
  t.eq([binding.status, binding.releaseReason, binding.releasedBy],
    [enums.BINDING_STATUS.RELEASED, 'PARTNER_CLOSED', 'ADMIN'],
    '§D 绑定释放原因 PARTNER_CLOSED / releasedBy=ADMIN');
  t.eq(binding.partnerNote, '', '§D 释放时清 bindings.partnerNote（DATA_MODEL §10.3：CLOSED 随释放清空）');
  t.eq([byId(db, COLLECTIONS.ORDERS, 'ord-sub').status, byId(db, COLLECTIONS.ORDERS, 'ord-acc').status,
    byId(db, COLLECTIONS.ORDERS, 'ord-pick').status],
  [enums.ORDER_STATUS.EXCEPTION, enums.ORDER_STATUS.EXCEPTION, enums.ORDER_STATUS.EXCEPTION],
  '§D 进行中三单 → EXCEPTION');
  const exOrder = byId(db, COLLECTIONS.ORDERS, 'ord-sub');
  t.eq([exOrder.exception.code, exOrder.exception.by, exOrder.exception.fromStatus, exOrder.version],
    ['OTHER', 'ADMIN', enums.ORDER_STATUS.SUBMITTED, 2],
    '§D 异常记录 by=ADMIN/code=OTHER/fromStatus 原状态/version+1');
  t.eq([byId(db, COLLECTIONS.ORDERS, 'ord-del').status, byId(db, COLLECTIONS.ORDERS, 'ord-done').status],
    [enums.ORDER_STATUS.DELIVERED, enums.ORDER_STATUS.COMPLETED],
    '§D DELIVERED 交 auto-complete、COMPLETED 终态不动（§8 状态矩阵）');
  const events = db.dump(COLLECTIONS.ORDER_EVENTS).filter((row) => row.actorRole === 'ADMIN');
  t.eq([events.length, events.filter((row) => row.type === 'EXCEPTION_REPORTED').length],
    [3, 3], '§D 每单写 ORDER_ANOMALY（EXCEPTION_REPORTED）事件，共 3 条');
  t.eq([events[0].actorId, events[0].impersonatedBy], [ADMIN, ''],
    '§D 事件 actorId=执行管理员 openid（可追溯、无模拟标记）');
  const partner = byId(db, COLLECTIONS.PARTNERS, PARTNER_ID);
  t.eq([partner.status, dateMs(partner.deletedAt)], [enums.PARTNER_STATUS.CLOSED, NOW],
    '§D partners.status=CLOSED + deletedAt=now');
  t.eq([partner.displayName, partner.avatarFileId], ['', ''],
    '§D partners 匿名化：displayName/avatarFileId 清空（DATA_MODEL §10.3）');
  t.eq([partner.suspendedReason, partner.closedReason], ['', ''],
    '§D 停用/关闭原因清空（审计由 admin_audit.detail.reason 保留）');
  t.eq(partner.serviceConfig.acceptingOrders, false, '§D CLOSED 后 serviceConfig.acceptingOrders=false');
  t.eq(cloud.deleted.indexOf(partnerAvatar) !== -1, true, '§D 删兼职头像云文件');
  const inviteUsed = byId(db, COLLECTIONS.INVITATION_CODES, 'invite-used');
  t.eq([inviteUsed.usedBy, dateMs(inviteUsed.usedAt), inviteUsed.batchId, inviteUsed.status],
    ['', NOW - 40 * DAY, 'B20261001-01', enums.INVITATION_STATUS.USED],
    '§D invitation_codes.usedBy 置空、保留 usedAt/batchId/状态（审计可追溯）');
  t.eq(byId(db, COLLECTIONS.INVITATION_CODES, 'invite-other').usedBy, 'other-partner-id',
    '§D 其他兼职的邀请码记录不被误清');
  const failure1 = byId(db, COLLECTIONS.RECOGNITION_FAILURES, 'd-f-1');
  const failure2 = byId(db, COLLECTIONS.RECOGNITION_FAILURES, 'd-f-2');
  t.eq([failure1.uploaderOpenid, failure1.fileId, failure2.uploaderOpenid, failure2.fileId], ['', '', '', ''],
    '§D 兼职 CLOSED 同口径：识别失败 uploaderOpenid/fileId 清空（§10.3）');
  t.eq([cloud.deleted.indexOf('cloud://fail-only-p1.jpg') !== -1, cloud.deleted.indexOf(sharedShot) === -1],
    [true, true],
    '§D 识别失败原图按引用计数删：无订单引用的删、仍被订单引用的保留');
  const audits = auditsOf(db, 'PARTNER_SUSPEND');
  t.eq([audits.length, audits[0].detail.to, audits[0].detail.reason, audits[0].developerNo],
    [1, enums.PARTNER_STATUS.CLOSED, '毕业离开', 'DEV-01'],
    '§D 审计 PARTNER_SUSPEND + detail.to=CLOSED + 原因/开发者编号保留');
  t.eq([closed.data.partner.status, closed.data.partner.statusText, closed.data.partner.displayName],
    [enums.PARTNER_STATUS.CLOSED, '已注销', ''], '§D 响应 DTO：CLOSED + 文案「已注销」+ 昵称已匿名化');

  const replay = await adminApi.call('admin.setPartnerStatus',
    { partnerNo: 'PAAAAAA', status: enums.PARTNER_STATUS.CLOSED, reason: '毕业离开' },
    { clientRequestId: crid });
  t.eq(replay.data.duplicated, true, '§D 同 clientRequestId 重放 → duplicated=true');
  t.eq(events.length, 3, '§D 重放不重复写订单事件');

  const publicView = await apiOf(db, 'CUST-B', { cloud }).call('partner.getPublic', { partnerNo: 'PAAAAAA' });
  t.eq([publicView.ok, publicView.code], [false, 'NOT_FOUND'], '§D CLOSED 后 partner.getPublic 不可再进入（NOT_FOUND）');
  const activate = await apiOf(db, PARTNER_OPENID, { cloud }).call('partner.activate',
    { invitationCode: 'ABCDEFGHJKLM', displayName: '老张' });
  t.eq([activate.ok, activate.code], [false, 'CONFLICT'], '§D CLOSED openid 不可再激活（CONFLICT，编号作废）');
  const accept = await apiOf(db, PARTNER_OPENID, { cloud }).call('order.accept', { orderNo: subOrderNo });
  t.eq([accept.ok, accept.code], [false, 'PARTNER_CLOSED'], '§D CLOSED 兼职不可接单（PARTNER_CLOSED）');
  const restore = await adminApi.call('admin.setPartnerStatus',
    { partnerNo: 'PAAAAAA', status: enums.PARTNER_STATUS.ACTIVE, reason: '' },
    { clientRequestId: nextCrid('d', 2) });
  t.eq([restore.ok, restore.code], [false, 'INVALID_TRANSITION'], '§D CLOSED 不可恢复（INVALID_TRANSITION）');
}

// ---------------------------------------------------------------- §E 修复回归/边界
async function sectionE(t) {
  const emptyDb = makeWorld({});
  const emptyResult = await accountsSweep.runAccountDeletion(cleanupCtx(emptyDb));
  t.eq([emptyResult.scanned, emptyResult.acted, emptyResult.failed], [0, 0, 0],
    '§E 空库账号清理不空跑失败（scanned/acted/failed 全 0）');

  const avatar = 'cloud://avatar-fail.jpg';
  const throwDb = makeWorld({
    users: [userOf(CUST, { status: enums.USER_STATUS.DEACTIVATED, deletionRequestedAt: new Date(NOW - 10 * DAY) })],
    customers: [customerOf(CUST, { customerNo: 'CDELFAIL', avatarFileId: avatar })]
  });
  const throwCloud = createCloud({ throwOnDelete: true });
  const throwResult = await accountsSweep.runAccountDeletion(cleanupCtx(throwDb, { cloud: throwCloud }));
  t.eq([throwResult.failed, byId(throwDb, COLLECTIONS.CUSTOMERS, CUST).avatarFileId], [0, ''],
    '§E 删云文件失败不炸 sweep：failed=0，头像引用仍清空（下轮重试）');
  t.eq(throwCloud.attempted.indexOf(avatar) !== -1, true, '§E 删除失败路径真实调用过云存储删除（不是跳过的假绿）');

  const goneAvatar = 'cloud://avatar-gone-fail.jpg';
  const goneDb = makeWorld({
    users: [userOf('C-GONE', { status: enums.USER_STATUS.DEACTIVATED, deletionRequestedAt: new Date(NOW - 31 * DAY) })],
    customers: [customerOf('C-GONE', { customerNo: 'CGONEFAIL', avatarFileId: goneAvatar })]
  });
  const goneResult = await accountsSweep.runAccountDeletion(cleanupCtx(goneDb, { cloud: createCloud({ throwOnDelete: true }) }));
  t.eq([goneResult.failed, countOf(goneDb, COLLECTIONS.USERS), countOf(goneDb, COLLECTIONS.CUSTOMERS)], [0, 0, 0],
    '§E 阶段二头像兜底删除失败仍物理删账号（兜底失败不回滚、不失败计数）');

  const dirtyDb = makeWorld({ users: [userOf('C-NOCUSTOMER', {
    status: enums.USER_STATUS.DEACTIVATED,
    deletionRequestedAt: new Date(NOW - 10 * DAY)
  })] });
  const dirtyResult = await accountsSweep.runAccountDeletion(cleanupCtx(dirtyDb));
  t.eq([dirtyResult.failed, dirtyResult.acted], [0, 0],
    '§E 缺 customers 行的脏账号阶段一不崩（无关联数据 → 0 动作）');

  // 重复 CLOSED（新 clientRequestId）：订单事件不重复写、匿名化不回填。
  const db = makeWorld({
    users: [userOf(CUST), userOf(ADMIN, { roles: [] })],
    customers: [customerOf(CUST)],
    partners: [partnerOf(PARTNER_OPENID)],
    bindings: [bindingOf('bind-e', CUST, PARTNER_ID)],
    orders: [orderOf('ord-e', { status: enums.ORDER_STATUS.SUBMITTED })]
  });
  const cloud = createCloud();
  const adminApi = apiOf(db, ADMIN, { cloud });
  await adminApi.call('admin.setPartnerStatus',
    { partnerNo: 'PAAAAAA', status: enums.PARTNER_STATUS.CLOSED, reason: '注销' },
    { clientRequestId: nextCrid('e', 1) });
  const second = await adminApi.call('admin.setPartnerStatus',
    { partnerNo: 'PAAAAAA', status: enums.PARTNER_STATUS.CLOSED, reason: '注销' },
    { clientRequestId: nextCrid('e', 2) });
  t.eq([second.ok, db.dump(COLLECTIONS.ORDER_EVENTS).length],
    [true, 1], '§E 重复 CLOSED（新请求号）订单事件不重复写（订单已非进行中）');
  t.eq(byId(db, COLLECTIONS.PARTNERS, PARTNER_ID).displayName, '', '§E 重复 CLOSED 匿名化保持空值（不回填 PII）');
}

// ---------------------------------------------------------------- §F 端侧静态
function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function sectionF(t) {
  const profile = readText('pages/profile/index.js');
  const profileWxml = readText('pages/profile/index.wxml');
  const privacy = readText('pkg-customer/parts/privacy-text.js');
  const userModule = readText('api/modules/user.js');
  const userHandlers = readText('cloudfunctions/api/handlers/user/index.js');

  t.eq(profile.indexOf("const DELETION_CONFIRM_TEXT = '注销';") !== -1, true,
    '§F 「注销」确认文本单源常量在 pages/profile（不散落字面量）');
  t.eq(profile.split('DELETION_CONFIRM_TEXT').length - 1, 3,
    '§F 确认文本单源被三处引用：常量定义 / 输入比对 / 请求入参');
  const markers = ['注销不可撤销', 'editable: true', '输入「注销」两个字', '确定注销'];
  t.eq(markers.filter((marker) => profile.indexOf(marker) < 0), [],
    '§F 两步确认四要素齐全（不可撤销说明 / 可输入弹窗 / 输入提示 / 确认按钮文案）');
  t.eq(profile.indexOf('userApi.deleteAccount({ confirmText: DELETION_CONFIRM_TEXT })') !== -1, true,
    '§F 调用形态：userApi.deleteAccount 只传单源确认文本（不在页面拼 payload）');
  t.eq(profile.indexOf('wx.cloud.') , -1, '§F 页面层零 wx.cloud 直连（分层铁律）');
  t.eq(profile.indexOf('注销失败') !== -1, true, '§F 失败提示说真话并给下一步（错误 toast 兜底）');
  t.eq(profileWxml.indexOf('注销账号') !== -1, true, '§F 「我的」页有注销账号入口');
  const privacyMarkers = ['我的 → 账号 → 注销账号', '有进行中订单需先处理', '唯一编号作废', '30 天内物理删除'];
  t.eq(privacyMarkers.filter((marker) => privacy.indexOf(marker) < 0), [],
    '§F 隐私文本注销条款与实现一致（入口路径/进行中订单闸/编号作废/30 天物理删）');
  t.eq(userModule.indexOf("client.call('user.deleteAccount', body)") !== -1, true,
    '§F 客户端 user 域走统一 api 模块（动作名只在 api/ 出现）');
  t.eq(userHandlers.indexOf("'user.deleteAccount': deleteAccount.handler") !== -1, true,
    '§F handler 注册表接线存在（user.deleteAccount → handlers/user/deleteAccount）');
}

// ---------------------------------------------------------------- 注册
function register(h) {
  h.section('§B9 注销/数据删除链路（user.deleteAccount + cleanup 两阶段 + 兼职 CLOSED 端到端）', async (t) => {
    await sectionA(t);
    await sectionB(t);
    await sectionC(t);
    await sectionD(t);
    await sectionE(t);
    await sectionF(t);
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-deletion' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-deletion');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
