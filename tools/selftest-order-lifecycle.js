'use strict';
/**
 * tools/selftest-order-lifecycle.js — 批 5「顾客订单闭环」端到端断言套件（task-63；契约 A~E）。
 *
 * 覆盖（Lead 冻结的批 5 接口契约 A~F + 套件覆盖 A~I）：
 *   A. order.get 顾客 DTO：必要字段齐全 / 事件裁剪恰为 {type,at,actorRole,note}（无 _id/actorId/payload/
 *      requestKey）/ 递归零内部键 / 真实会话不下发 isTest；七状态 × 顾客 actions 矩阵逐格；
 *      COMPLETED 软删后只剩 reorder；EXCEPTION 依 exception.fromStatus 的可取消分支；
 *      confirm/deleteRecord/reorder 中文文案；image {hasImage,cleaned} 两态；兼职终态不再给 message。
 *   B. order.listCustomer：三桶筛选与服务端排序 / 游标分页不重不漏 / 软删隐藏 / counts 三值（与列表口径
 *      一致、不受 keyword 影响、测试单隔离）/ keyword / 非法 status → VALIDATION_FAILED。
 *   C. order.cancel：SUBMITTED/ACCEPTED 成功（status/cancelReason/cancelledBy/cancelledAt + CANCELLED
 *      事件）/ PICKED/DELIVERED → INVALID_TRANSITION / EXCEPTION 依 fromStatus / OTHER 缺备注 /
 *      重放 duplicated 不重复写事件 / expectedVersion → CONFLICT。
 *   D. order.confirmDelivery：DELIVERED→COMPLETED + completedAt/COMPLETED 事件/version 递增；
 *      非 DELIVERED → INVALID_TRANSITION；重放幂等。
 *   E. order.deleteRecord：COMPLETED 软删（落库 + 列表隐藏 + DELETED_BY_CUSTOMER 事件）；
 *      非 COMPLETED → INVALID_STATE；重复调用 duplicated 且时间不变。
 *   F. 越权负向：他人订单 get/cancel/confirm → FORBIDDEN；兼职越权 confirm/取消他单拒绝；
 *      admin 真实会话 DTO 脱敏（取件码/尾号打码、房间清空、无 actions、零 openid/内部键）；
 *      测试单对真实会话不可见、TEST_WRITE 会话可见；READONLY 写拒绝。
 *   G. message：send 状态矩阵（EXCEPTION 可发；COMPLETED/CANCELLED 拒绝）/ 他人订单拒绝 / ≤200 超限 /
 *      同 clientRequestId 幂等；message.list 订单模式倒序 + 游标；消息中心 unread 与 markRead 水位只前进。
 *   H. order.imageUrl：cleaned → NOT_FOUND 指定文案 / 无图 → NOT_FOUND / 归属校验 / 云替身签发
 *      expiresAt=now+300s / 云失败 → DEPENDENCY_FAILED。
 *   I. order.correct 补码事件 note（批 5 补丁-A）：NEED_CODE 补码 → ORDER_CORRECTED.note=「兼职已补齐取件码」
 *      且落库 payload.codeStatusChanged=true；已 OK 改柜号 / 清空取件码（OK→NEED_CODE）→ note 空串。
 *      跨三单正控：3 条更正事件中仅 1 条带补码 note（恒写/丢写/条件写反均判红）。
 *
 * 纪律：fake DB 注入 + 真实 handler，不连真库、不 mock 全局 wx；先合法基线再反例，样本非空；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）；口径唯一源 docs/V4_CONTRACT.md §5。
 * 取数：node tools/selftest-order-lifecycle.js | Select-Object -Last 2
 */
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');

const app = require(path.join(API, 'app.js'));
const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const enums = require(path.join(API, 'shared/enums.js'));
const mask = require(path.join(API, 'db/dto/mask.js'));

const listCustomerHandler = require(path.join(API, 'handlers/order/listCustomer.js'));
const getOrderHandler = require(path.join(API, 'handlers/order/get.js'));
const cancelOrderHandler = require(path.join(API, 'handlers/order/cancel.js'));

const { ROLES, USER_STATUS, PARTNER_STATUS, BINDING_STATUS, ORDER_STATUS } = enums;
const NOW = Date.parse('2026-10-22T10:00:00+08:00');
const HOUR = 3600 * 1000;
const URL_TTL_MS = 300 * 1000;
const ISO_NOW = new Date(NOW).toISOString();
const C1 = 'openid-lc-c1';
const P1 = 'openid-lc-p1';
const PID1 = 'partner-lc-1';
const C2 = 'openid-lc-c2';
const TEST_C = 'openid-lc-test-c';
const TEST_P = 'openid-lc-test-p';
const TEMP_URL = 'https://tmp.example/lifecycle';
// 批 5 补丁-A 契约：补码事件 note 逐字口径；这里独立写字面量、不复用生产常量，避免「同源恒真」
const CODE_FILLED_NOTE = '兼职已补齐取件码';

const ALL_COLLECTION_NAMES = Object.keys(COLLECTIONS).map((key) => COLLECTIONS[key]);

const EXPECTED_ASSERTIONS = 98;

// ---------------------------------------------------------------- fake DB / api 装配
function uniqueIndexesForApi() {
  return {
    users: [['_id']],
    customers: [['customerNo'], ['_id']],
    partners: [['openid'], ['partnerNo']],
    bindings: [['activeKey'], ['tagKey']],
    orders: [['orderNo'], ['requestKey']],
    order_events: [['requestKey']],
    order_messages: [['requestKey']],
    counters: [['key']]
  };
}

function createTestDb() {
  const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
  ALL_COLLECTION_NAMES.forEach((name) => db.seed(name, []));
  return db;
}

function cloudStub(options) {
  const opt = options || {};
  return {
    openapi: { security: { msgSecCheck: async () => ({ errCode: 0, result: { suggest: 'pass', label: 100 } }) } },
    getTempFileURL: opt.failTempUrl
      ? async () => { throw new Error('cloud getTempFileURL failed'); }
      : async (input) => ({
        fileList: (input.fileList || []).map((file) => ({ fileID: file.fileID, tempFileURL: TEMP_URL, status: 0 }))
      }),
    deleteFile: async () => ({ fileList: [] })
  };
}

function apiOf(db, openid, options) {
  const opt = options || {};
  return app.createApi({
    db,
    now: () => (opt.now === undefined ? NOW : opt.now),
    openid,
    env: {},
    cloud: opt.cloud || cloudStub()
  });
}

// 直调 handler（绕中间件：注入 admin / TEST_WRITE / READONLY 身份）
function handlerCtx(db, openid, options) {
  const opt = options || {};
  const dao = createDao(db);
  return {
    dao,
    ids: app.bindIds(dao, NOW),
    now: NOW,
    env: {},
    cloud: cloudStub(),
    openid,
    identity: Object.assign(app.baseIdentity(openid), opt.identity || {}),
    requestId: 'req-order-lifecycle',
    clientRequestId: opt.clientRequestId || nextCrid('handler'),
    expectedVersion: opt.expectedVersion,
    config: {}
  };
}

let CRID_SEQ = 0;
function nextCrid(tag) {
  CRID_SEQ += 1;
  // 16~32 位 [A-Za-z0-9_-]（shared/validate 的 clientRequestId 形态闸）；序号保证唯一
  const seqText = String(CRID_SEQ).padStart(6, '0');
  let tagText = String(tag || 'x').replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
  while (tagText.length < 6) tagText += 'x';
  return 'lc-' + seqText + '-' + tagText;
}

let SEED_SEQ = 0;

// ---------------------------------------------------------------- 文档种子
function userDoc(id, roles, extra) {
  return Object.assign({
    _id: id, roles: roles || [], status: USER_STATUS.ACTIVE, isTestAccount: false,
    createdByDeveloperNo: '', privacyConsent: null, messageReadAt: 0, deletionRequestedAt: 0,
    createdAt: NOW - 30 * 24 * HOUR, updatedAt: NOW
  }, extra || {});
}

function customerDoc(id, extra) {
  return Object.assign({
    _id: id, customerNo: 'CABCDEFGH', displayName: '小王', phoneTail: '1234',
    zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', profileCompleted: true,
    avatarFileId: '', createdAt: NOW - 30 * 24 * HOUR, updatedAt: NOW
  }, extra || {});
}

function partnerDoc(id, openid, extra) {
  return Object.assign({
    _id: id, openid, partnerNo: 'PABC234', displayName: '小李', status: PARTNER_STATUS.ACTIVE,
    avatarFileId: '', serviceConfig: { services: [], zones: ['D'], acceptingOrders: true },
    stats: {}, createdAt: NOW - 30 * 24 * HOUR, updatedAt: NOW
  }, extra || {});
}

function bindingDoc(customerId, partnerId) {
  return {
    _id: 'lc-binding-1', activeKey: customerId, customerId, partnerId, status: BINDING_STATUS.ACTIVE,
    roomTag: 'A', allocSeq: 1, tagKey: partnerId + ':D4-522:A', dormSnapshot: {},
    partnerNote: '', boundAt: NOW - 30 * 24 * HOUR, updatedAt: NOW,
    releasedAt: null, releaseReason: '', releaseNote: '', releasedBy: ''
  };
}

function parcelOf(extra) {
  return Object.assign({
    stationId: 'P3', stationName: '西苑快递中心', pickupCode: 'A12345', lockerNo: '',
    trackingTail: '12345', codeStatus: 'OK', recognitionSource: 'RULE', confidence: ''
  }, extra || {});
}

function dormOf() {
  return { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', roomTag: 'A' };
}

function imageDoc(extra) {
  return Object.assign({
    fileId: 'cloud://env.bucket/orders/lc/image.jpg', width: 800, height: 1200, uploadedAt: NOW
  }, extra || {});
}

function orderDoc(orderNo, status, extra) {
  const doc = {
    _id: 'lc-o-' + orderNo, orderNo, customerId: C1, customerOpenid: C1, customerNo: 'CABCDEFGH',
    partnerId: PID1, partnerOpenid: P1, partnerNo: 'PABC234', isTest: false, source: 'CUSTOMER',
    status, version: 1, service: { code: 'PICKUP_STD', name: '标准代取' },
    appoint: { type: 'ASAP' }, parcel: parcelOf(), note: '', phoneTail: '1234',
    dorm: dormOf(), guest: null, exception: null, deliveryNote: '', cancelReason: '', cancelledBy: '',
    image: imageDoc(), createdAt: NOW - 3 * HOUR, updatedAt: NOW, statusUpdatedAt: NOW,
    acceptedAt: 0, pickedAt: 0, deliveredAt: 0, completedAt: 0, cancelledAt: 0,
    deletedByCustomerAt: 0, requestKey: C1 + ':seed:' + orderNo
  };
  return Object.assign(doc, extra || {});
}

function eventDoc(orderId, orderNo, type, extra) {
  SEED_SEQ += 1;
  return Object.assign({
    _id: 'lc-e-' + SEED_SEQ, orderId, orderNo, type, fromStatus: ORDER_STATUS.SUBMITTED,
    toStatus: type === 'ACCEPTED' ? ORDER_STATUS.ACCEPTED : ORDER_STATUS.SUBMITTED,
    actorRole: ROLES.PARTNER, actorId: P1, impersonatedBy: '', at: new Date(NOW - HOUR),
    note: '', payload: {}, requestKey: 'seed-evt-' + SEED_SEQ
  }, extra || {});
}

function messageDoc(orderId, fromRole, fromId, text, atMs, extra) {
  SEED_SEQ += 1;
  return Object.assign({
    _id: 'lc-m-' + SEED_SEQ, orderId, fromRole, fromId, text, templateCode: null,
    createdAt: new Date(atMs), readAt: null, requestKey: fromId + ':seed-msg-' + SEED_SEQ
  }, extra || {});
}

// 世界：顾客 + 兼职 + ACTIVE 绑定（可选测试账号/TEST 订单）
function seedWorld(options) {
  const opt = options || {};
  const db = opt.db || createTestDb();
  db.seed('users', [
    userDoc(C1, [ROLES.CUSTOMER]),
    userDoc(P1, [ROLES.PARTNER]),
    userDoc(TEST_C, [ROLES.CUSTOMER], { isTestAccount: true }),
    userDoc(TEST_P, [ROLES.PARTNER], { isTestAccount: true })
  ]);
  db.seed('customers', [
    customerDoc(C1),
    customerDoc(TEST_C, { customerNo: 'CABCDEFGJ', displayName: '测试小王' })
  ]);
  db.seed('partners', [
    partnerDoc(PID1, P1),
    partnerDoc('partner-lc-test', TEST_P, { partnerNo: 'PABC235', displayName: '测试小李' })
  ]);
  db.seed('bindings', [bindingDoc(C1, PID1)]);
  return db;
}

// ---------------------------------------------------------------- 断言小工具
async function expectCode(t, resPromise, code, label) {
  const res = await resPromise;
  const ok = res && res.ok !== true && res.code === code;
  t.check(ok, label + '（实际 code=' + (res && res.code) + '）');
  return res;
}

async function expectField(t, resPromise, code, field, label) {
  const res = await resPromise;
  const data = (res && res.data) || {};
  const ok = res && res.ok !== true && res.code === code && data.field === field;
  t.check(ok, label + '（实际 code=' + (res && res.code) + ', field=' + data.field + '）');
  return res;
}

async function errorCodeOf(promise) {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    return error && error.code ? error.code : 'INTERNAL_ERROR';
  }
}

function collectKeys(value, out) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, out));
    return out;
  }
  Object.keys(value).forEach((key) => {
    out.add(key);
    collectKeys(value[key], out);
  });
  return out;
}

const DTO_FORBIDDEN_KEYS = ['_id', 'requestKey', 'customerOpenid', 'partnerOpenid', 'customerId',
  'partnerId', 'clientRequestId', 'batchActionId', 'cloudPath', 'actorId', 'payload'];
const ADMIN_FORBIDDEN_KEYS = ['_id', 'openid', 'customerOpenid', 'partnerOpenid', 'customerId',
  'partnerId', 'requestKey', 'clientRequestId', 'actorId', 'fileId', 'cloudPath', 'isTest', 'impersonatedBy'];

function leakKeysOf(value, forbidden) {
  const keys = collectKeys(value, new Set());
  return forbidden.filter((key) => keys.has(key));
}

function orderNosOf(res) {
  return ((res.data && res.data.list) || []).map((item) => item.orderNo);
}

function actionKeysOf(orderDto) {
  return (orderDto.actions || []).map((action) => action.key);
}

function dbOrder(db, orderNo) {
  return db.dump('orders').filter((row) => row.orderNo === orderNo)[0];
}

function dbEventsOf(db, orderNo) {
  return db.dump('order_events').filter((row) => row.orderNo === orderNo);
}

// 批 5 补丁-A：从真实 order.get 的裁剪事件里取 ORDER_CORRECTED；DB 侧取落库事件核 payload/note
function correctedEventsOf(res) {
  const events = (res && res.data && res.data.events) || [];
  return events.filter((event) => event.type === 'ORDER_CORRECTED');
}

function dbCorrectedEventOf(db, orderNo) {
  return dbEventsOf(db, orderNo).filter((event) => event.type === 'ORDER_CORRECTED')[0] || {};
}

function dbMessagesOf(db, orderId) {
  return db.dump('order_messages').filter((row) => row.orderId === orderId);
}

// ---------------------------------------------------------------- 分节装配（异步串行）
let serialQueue = Promise.resolve();
function serial(fn) {
  const run = serialQueue.then(fn);
  serialQueue = run.catch(() => {});
  return run;
}

function register(h) {
  const asyncSection = (title, fn) => h.section(title, (t) => serial(() => {
    h.sectionTitle = title;
    return fn(t);
  }));

  // ---------------------------------------------------------------- A order.get DTO + 动作矩阵
  asyncSection('A. order.get 顾客 DTO / 事件裁剪 / 七状态动作矩阵 / image 两态（契约 A、B）', async (t) => {
    const NO = {
      SUBMITTED: '20261022-0001',
      ACCEPTED: '20261022-0002',
      PICKED: '20261022-0003',
      DELIVERED: '20261022-0004',
      COMPLETED: '20261022-0005',
      CANCELLED: '20261022-0006',
      EXCEPTION: '20261022-0007',
      DELETED: '20261022-0008',
      EXCEPTION_PICKED: '20261022-0009',
      CLEANED: '20261022-0010',
      NO_IMAGE: '20261022-0011'
    };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.SUBMITTED, ORDER_STATUS.SUBMITTED, { statusUpdatedAt: NOW - 1000 }),
      orderDoc(NO.ACCEPTED, ORDER_STATUS.ACCEPTED, { acceptedAt: NOW - 900, statusUpdatedAt: NOW - 900 }),
      orderDoc(NO.PICKED, ORDER_STATUS.PICKED, { acceptedAt: NOW - 900, pickedAt: 0, statusUpdatedAt: NOW - 800 }),
      orderDoc(NO.DELIVERED, ORDER_STATUS.DELIVERED, { deliveredAt: NOW - 700, statusUpdatedAt: NOW - 700 }),
      orderDoc(NO.COMPLETED, ORDER_STATUS.COMPLETED, { completedAt: NOW - 600, statusUpdatedAt: NOW - 600 }),
      orderDoc(NO.CANCELLED, ORDER_STATUS.CANCELLED, { cancelledAt: NOW - 500, cancelReason: 'CHANGED_MIND', cancelledBy: ROLES.CUSTOMER }),
      orderDoc(NO.EXCEPTION, ORDER_STATUS.EXCEPTION, {
        statusUpdatedAt: NOW - 400,
        exception: { code: 'OTHER', text: '联系不上顾客', fromStatus: ORDER_STATUS.ACCEPTED, by: ROLES.PARTNER, at: NOW - 450 }
      }),
      orderDoc(NO.DELETED, ORDER_STATUS.COMPLETED, { completedAt: NOW - 300, deletedByCustomerAt: NOW - 200 }),
      orderDoc(NO.EXCEPTION_PICKED, ORDER_STATUS.EXCEPTION, {
        statusUpdatedAt: NOW - 350,
        exception: { code: 'PARCEL_NOT_FOUND', text: '找不到件', fromStatus: ORDER_STATUS.PICKED, by: ROLES.PARTNER, at: NOW - 360 }
      }),
      orderDoc(NO.CLEANED, ORDER_STATUS.CANCELLED, {
        cancelledAt: NOW - 250, cancelReason: 'CHANGED_MIND', cancelledBy: ROLES.CUSTOMER,
        image: imageDoc({ cleanedAt: NOW - 100 })
      }),
      orderDoc(NO.NO_IMAGE, ORDER_STATUS.SUBMITTED, { image: {}, statusUpdatedAt: NOW - 240 })
    ]);
    db.seed('order_events', [
      eventDoc('lc-o-' + NO.SUBMITTED, NO.SUBMITTED, 'ORDER_CREATED', {
        fromStatus: '', toStatus: ORDER_STATUS.SUBMITTED, actorRole: ROLES.CUSTOMER, actorId: C1, at: new Date(NOW - 3000)
      }),
      eventDoc('lc-o-' + NO.SUBMITTED, NO.SUBMITTED, 'ACCEPTED', { at: new Date(NOW - 2000) }),
      eventDoc('lc-o-' + NO.SUBMITTED, NO.SUBMITTED, 'PICKED', {
        fromStatus: ORDER_STATUS.ACCEPTED, toStatus: ORDER_STATUS.PICKED, at: new Date(NOW - 1000)
      })
    ]);
    const cApi = apiOf(db, C1);
    const pApi = apiOf(db, P1);

    const base = await cApi.call('order.get', { orderNo: NO.SUBMITTED });
    t.check(base.ok === true && base.data.order.orderNo === NO.SUBMITTED, 'A1 本人订单 order.get 成功');
    t.eq([base.data.order.status, base.data.order.statusText, base.data.order.bucket, base.data.order.progressIndex],
      [ORDER_STATUS.SUBMITTED, '待接单', 'submitted', 0],
      'A2 DTO 状态三件套（status/statusText/bucket/progressIndex）由服务端下发');
    t.eq([base.data.order.parcel.pickupCode, base.data.order.parcel.stationName, base.data.order.service.code,
      base.data.order.service.name, base.data.order.appoint.type,
      base.data.order.counterpart && base.data.order.counterpart.displayName],
    ['A12345', '西苑快递中心', 'PICKUP_STD', '标准代取', 'ASAP', '小李'],
    'A3 必要字段齐全（取件码/站点/服务/预约/对方昵称仅 ACTIVE 绑定内下发）');
    const events = base.data.events || [];
    t.eq(events.length, 3, 'A4 事件按时间正序全量返回（基线 3 条）');
    t.eq(Array.from(new Set(events.map((item) => Object.keys(item).sort().join(',')))), ['actorRole,at,note,type'],
      'A5 事件裁剪恰为 {type,at,actorRole,note}（无 actorId/payload/requestKey/_id）');
    t.eq(leakKeysOf(events, DTO_FORBIDDEN_KEYS), [], 'A6 事件递归零内部键（不泄露 openid/请求键）');
    t.eq(leakKeysOf(base.data.order, DTO_FORBIDDEN_KEYS), [], 'A7 订单 DTO 递归零内部键（_id/openid/cloudPath 不出云）');
    t.check(!('isTest' in base.data.order) && !('impersonatedBy' in base.data.order),
      'A8 真实会话 DTO 不下发 isTest/impersonatedBy');

    const matrix = {};
    const statuses = [ORDER_STATUS.SUBMITTED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PICKED,
      ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED, ORDER_STATUS.EXCEPTION];
    for (let i = 0; i < statuses.length; i += 1) {
      const status = statuses[i];
      const res = await cApi.call('order.get', { orderNo: NO[status] });
      matrix[status] = res.data.order.actions;
    }
    const matrixCases = [
      ['A9', ORDER_STATUS.SUBMITTED, ['cancel', 'message']],
      ['A10', ORDER_STATUS.ACCEPTED, ['cancel', 'message']],
      ['A11', ORDER_STATUS.PICKED, ['message']],
      ['A12', ORDER_STATUS.DELIVERED, ['confirm', 'message']],
      ['A13', ORDER_STATUS.COMPLETED, ['deleteRecord', 'reorder']],
      ['A14', ORDER_STATUS.CANCELLED, ['reorder']],
      ['A15', ORDER_STATUS.EXCEPTION, ['message', 'cancel']]
    ];
    matrixCases.forEach((item) => {
      t.eq(actionKeysOf({ actions: matrix[item[1]] }), item[2],
        item[0] + ' ' + item[1] + ' 顾客 actions 矩阵（实际 ' + JSON.stringify(actionKeysOf({ actions: matrix[item[1]] })) + '）');
    });
    const deleted = await cApi.call('order.get', { orderNo: NO.DELETED });
    t.eq(actionKeysOf(deleted.data.order), ['reorder'],
      'A16 COMPLETED 已软删（deletedByCustomerAt 非空）→ 只给 reorder，不再给 deleteRecord');
    const exceptionPicked = await cApi.call('order.get', { orderNo: NO.EXCEPTION_PICKED });
    t.eq(actionKeysOf(exceptionPicked.data.order), ['message'],
      'A17 EXCEPTION 且 exception.fromStatus=PICKED → 不可取消（只留留言，canCustomerCancel=false）');
    t.eq(matrix[ORDER_STATUS.COMPLETED].map((action) => action.label), ['删除这条记录', '再次下单'],
      'A18 COMPLETED 中文文案：删除这条记录 / 再次下单');
    t.eq(matrix[ORDER_STATUS.DELIVERED].map((action) => action.key + ':' + action.label),
      ['confirm:确认已收到', 'message:留言'],
    'A19 DELIVERED 中文文案：confirm=确认已收到、message=留言');

    const normalImage = await cApi.call('order.get', { orderNo: NO.SUBMITTED });
    t.eq([Object.keys(normalImage.data.order.image), normalImage.data.order.image.hasImage,
      normalImage.data.order.image.cleaned, normalImage.data.order.image.status],
    [['index', 'status', 'hasImage', 'cleaned'], true, false, 'AVAILABLE'],
    'A20 image DTO 基线 {index,status,hasImage,cleaned}（有 fileId 且未清理，v1.0 多图加 index/status）');
    const cleanedImage = await cApi.call('order.get', { orderNo: NO.CLEANED });
    t.eq([cleanedImage.data.order.image.hasImage, cleanedImage.data.order.image.cleaned], [false, true],
      'A21 image DTO 已清理态 {hasImage:false, cleaned:true}（cleanup 写 cleanedAt 后不再可看）');
    const partnerCompleted = await pApi.call('order.get', { orderNo: NO.COMPLETED });
    const partnerCancelled = await pApi.call('order.get', { orderNo: NO.CANCELLED });
    t.eq([actionKeysOf(partnerCompleted.data.order), actionKeysOf(partnerCancelled.data.order)], [[], []],
      'A22 兼职侧终态（COMPLETED/CANCELLED）不再给 message（留言只读归档）');
    const partnerPicked = await pApi.call('order.get', { orderNo: NO.PICKED });
    t.eq(actionKeysOf(partnerPicked.data.order), ['deliver', 'exception', 'correct', 'cancel', 'message'],
      'A23 兼职侧进行中沿用既有键（PICKED：deliver/exception/correct/cancel/message）');
    const noImage = await cApi.call('order.get', { orderNo: NO.NO_IMAGE });
    t.eq([Object.keys(noImage.data.order.image), noImage.data.order.image.hasImage, noImage.data.order.image.cleaned],
      [['index', 'status', 'hasImage', 'cleaned'], false, false],
      'A24 无 fileId 订单 image={hasImage:false, cleaned:false}（未清理但也没有可看截图）');
    t.notEmpty(matrix[ORDER_STATUS.SUBMITTED], 'A 组模型样本非空（actions 断言非空集）');
  });

  // ---------------------------------------------------------------- B listCustomer
  asyncSection('B. order.listCustomer 三桶筛选/排序/游标/counts/keyword/隔离（契约 C）', async (t) => {
    const NO = {
      S1: '20261022-0101', S2: '20261022-0102', S3: '20261022-0103',
      C1: '20261022-0104', C2: '20261022-0105',
      X1: '20261022-0106', X2: '20261022-0107',
      DEL: '20261022-0108', TEST: '20261022-0109'
    };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.S1, ORDER_STATUS.SUBMITTED, { statusUpdatedAt: NOW - 3000 }),
      orderDoc(NO.S2, ORDER_STATUS.ACCEPTED, { acceptedAt: NOW - 2500, statusUpdatedAt: NOW - 2000 }),
      orderDoc(NO.S3, ORDER_STATUS.PICKED, { acceptedAt: NOW - 2500, statusUpdatedAt: NOW - 1000, parcel: parcelOf({ pickupCode: 'ZZZ99' }) }),
      orderDoc(NO.C1, ORDER_STATUS.COMPLETED, { completedAt: NOW - 5000 }),
      orderDoc(NO.C2, ORDER_STATUS.COMPLETED, { completedAt: NOW - 4000 }),
      orderDoc(NO.X1, ORDER_STATUS.CANCELLED, { cancelledAt: NOW - 7000 }),
      orderDoc(NO.X2, ORDER_STATUS.CANCELLED, { cancelledAt: NOW - 6000 }),
      orderDoc(NO.DEL, ORDER_STATUS.COMPLETED, { completedAt: NOW - 2000, deletedByCustomerAt: NOW - 1500 }),
      orderDoc(NO.TEST, ORDER_STATUS.SUBMITTED, { customerId: TEST_C, customerOpenid: TEST_C, isTest: true, statusUpdatedAt: NOW - 500 })
    ]);
    const cApi = apiOf(db, C1);

    const inProgress = await cApi.call('order.listCustomer', { status: 'IN_PROGRESS' });
    t.eq([inProgress.ok, inProgress.data.list.length, orderNosOf(inProgress)],
      [true, 3, [NO.S3, NO.S2, NO.S1]],
      'B1 进行中桶：5 状态合并 + statusUpdatedAt desc 服务端排序');
    const completed = await cApi.call('order.listCustomer', { status: 'COMPLETED' });
    t.eq([completed.data.list.length, orderNosOf(completed)], [2, [NO.C2, NO.C1]],
      'B2 已完成桶：completedAt desc，软删记录隐藏（DEL 不在列表）');
    const cancelled = await cApi.call('order.listCustomer', { status: 'CANCELLED' });
    t.eq([cancelled.data.list.length, orderNosOf(cancelled)], [2, [NO.X2, NO.X1]],
      'B3 已取消桶：cancelledAt desc');
    const defaultList = await cApi.call('order.listCustomer', {});
    t.eq(orderNosOf(defaultList), orderNosOf(inProgress), 'B4 无 status 默认等价 IN_PROGRESS（只增不改既有口径）');
    await expectField(t, cApi.call('order.listCustomer', { status: 'ARCHIVED' }), 'VALIDATION_FAILED', 'status',
      'B5 非法 status → VALIDATION_FAILED 且 data.field=status');

    const page1 = await cApi.call('order.listCustomer', { status: 'IN_PROGRESS', limit: 2 });
    t.eq([orderNosOf(page1), page1.data.nextCursor !== null], [[NO.S3, NO.S2], true],
      'B6 游标分页第一页 2 条 + 非空 nextCursor');
    const page2 = await cApi.call('order.listCustomer', { status: 'IN_PROGRESS', limit: 2, cursor: page1.data.nextCursor });
    t.eq([orderNosOf(page2), page2.data.nextCursor], [[NO.S1], null],
      'B7 第二页取余量 1 条且 nextCursor=null');
    t.eq([orderNosOf(page1).concat(orderNosOf(page2)), 3],
      [orderNosOf(inProgress), 3],
      'B8 游标翻页不重不漏（两页并集 === 全量列表）');

    t.eq([inProgress.data.counts.ongoing, inProgress.data.counts.completed, inProgress.data.counts.cancelled,
      inProgress.data.list.length, completed.data.list.length, cancelled.data.list.length],
    [3, 2, 2, 3, 2, 2],
    'B9 counts 三桶恒为全量口径（不随 status 筛选变）+ 各桶列表长度与计数一致（软删/测试单不计）');
    const keyword = await cApi.call('order.listCustomer', { status: 'IN_PROGRESS', keyword: 'zzz99' });
    t.eq([keyword.data.list.length, orderNosOf(keyword), keyword.data.counts], [1, [NO.S3], inProgress.data.counts],
      'B10 keyword 过滤生效且不影响 counts（tab 角标不随搜索抖动）');

    const testCtx = handlerCtx(db, TEST_C, { identity: { role: ROLES.CUSTOMER, viewMode: enums.VIEW_MODE.TEST_WRITE } });
    const testList = await listCustomerHandler(testCtx, {});
    t.eq([testList.list.map((item) => item.orderNo), testList.counts], [[NO.TEST], { ongoing: 1, completed: 0, cancelled: 0 }],
      'B11 测试会话只看测试单、counts 独立（真实会话的 B9 已排除测试单）');
    t.eq([inProgress.data.list[0].actions, inProgress.data.list[0].counterpart], [[], null],
      'B12 列表项不带动作条与对方资料（详情才下发，节省载荷）');
  });

  // ---------------------------------------------------------------- C order.cancel
  asyncSection('C. order.cancel 顾客取消：状态矩阵/原因/幂等/乐观锁（契约 F）', async (t) => {
    const NO = {
      SUB: '20261022-0201', ACC: '20261022-0202', PICK: '20261022-0203', DELIV: '20261022-0204',
      EXA: '20261022-0205', EXP: '20261022-0206', OTHER: '20261022-0207',
      VERSION: '20261022-0208', REASON: '20261022-0209', EXS: '20261022-0210'
    };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.SUB, ORDER_STATUS.SUBMITTED),
      orderDoc(NO.ACC, ORDER_STATUS.ACCEPTED, { acceptedAt: NOW - HOUR }),
      orderDoc(NO.PICK, ORDER_STATUS.PICKED, { acceptedAt: NOW - HOUR, pickedAt: NOW - 1000 }),
      orderDoc(NO.DELIV, ORDER_STATUS.DELIVERED, { deliveredAt: NOW - 1000 }),
      orderDoc(NO.EXA, ORDER_STATUS.EXCEPTION, {
        exception: { code: 'CUSTOMER_UNREACHABLE', text: '联系不上', fromStatus: ORDER_STATUS.ACCEPTED, by: ROLES.PARTNER, at: NOW - 1000 }
      }),
      orderDoc(NO.EXP, ORDER_STATUS.EXCEPTION, {
        exception: { code: 'PARCEL_NOT_FOUND', text: '找不到件', fromStatus: ORDER_STATUS.PICKED, by: ROLES.PARTNER, at: NOW - 1000 }
      }),
      orderDoc(NO.OTHER, ORDER_STATUS.SUBMITTED),
      orderDoc(NO.VERSION, ORDER_STATUS.SUBMITTED),
      orderDoc(NO.REASON, ORDER_STATUS.SUBMITTED),
      orderDoc(NO.EXS, ORDER_STATUS.EXCEPTION, {
        exception: { code: 'CABINET_ERROR', text: '柜门坏了', fromStatus: ORDER_STATUS.SUBMITTED, by: ROLES.PARTNER, at: NOW - 1000 }
      })
    ]);
    const cApi = apiOf(db, C1);

    const subCancel = await cApi.call('order.cancel', { orderNo: NO.SUB, reason: 'CHANGED_MIND' },
      { clientRequestId: nextCrid('cancel-sub') });
    t.eq([subCancel.ok, subCancel.data.order.status, subCancel.data.order.cancelReason,
      subCancel.data.order.cancelledBy],
    [true, ORDER_STATUS.CANCELLED, 'CHANGED_MIND', ROLES.CUSTOMER],
    'C1 SUBMITTED 顾客取消成功：status=CANCELLED + cancelReason + cancelledBy=CUSTOMER');
    const subDoc = dbOrder(db, NO.SUB);
    t.eq([subDoc.status, subDoc.cancelReason, subDoc.cancelledBy, subDoc.cancelledAt instanceof Date,
      subDoc.version, subDoc.cancelledAt.getTime()],
    [ORDER_STATUS.CANCELLED, 'CHANGED_MIND', ROLES.CUSTOMER, true, 2, NOW],
    'C2 取消落库：cancelledAt=server now + version 递增 1→2');
    const subEvents = dbEventsOf(db, NO.SUB);
    t.eq(subEvents.map((item) => [item.type, item.fromStatus, item.toStatus, item.actorRole, item.payload.cancelReason]),
      [['CANCELLED', ORDER_STATUS.SUBMITTED, ORDER_STATUS.CANCELLED, ROLES.CUSTOMER, 'CHANGED_MIND']],
      'C3 写且仅写 1 条 CANCELLED 事件（fromStatus/toStatus/actorRole/payload.cancelReason 齐全）');

    const accCancel = await cApi.call('order.cancel', { orderNo: NO.ACC, reason: 'WRONG_INFO' },
      { clientRequestId: nextCrid('cancel-acc') });
    t.eq([accCancel.ok, accCancel.data.order.status, dbOrder(db, NO.ACC).cancelledBy],
      [true, ORDER_STATUS.CANCELLED, ROLES.CUSTOMER], 'C4 ACCEPTED（未取件）顾客可取消');
    await expectCode(t, cApi.call('order.cancel', { orderNo: NO.PICK, reason: 'CHANGED_MIND' },
      { clientRequestId: nextCrid('cancel-pick') }), 'INVALID_TRANSITION',
    'C5 PICKED 顾客不能单方取消 → INVALID_TRANSITION（走异常/留言）');
    await expectCode(t, cApi.call('order.cancel', { orderNo: NO.DELIV, reason: 'CHANGED_MIND' },
      { clientRequestId: nextCrid('cancel-deliv') }), 'INVALID_TRANSITION',
    'C6 DELIVERED 顾客不能单方取消 → INVALID_TRANSITION');
    const exCancel = await cApi.call('order.cancel', { orderNo: NO.EXA, reason: 'CHANGED_MIND' },
      { clientRequestId: nextCrid('cancel-exa') });
    t.eq([exCancel.ok, exCancel.data.order.status], [true, ORDER_STATUS.CANCELLED],
      'C7 EXCEPTION 且 fromStatus=ACCEPTED → 允许顾客取消（canCustomerCancel=true）');
    const exSubCancel = await cApi.call('order.cancel', { orderNo: NO.EXS, reason: 'CHANGED_MIND' },
      { clientRequestId: nextCrid('cancel-exs') });
    t.eq([exSubCancel.ok, exSubCancel.data.order.status], [true, ORDER_STATUS.CANCELLED],
      'C8 EXCEPTION 且 fromStatus=SUBMITTED → 同样允许顾客取消（可取消分支两值都覆盖）');
    await expectCode(t, cApi.call('order.cancel', { orderNo: NO.EXP, reason: 'CHANGED_MIND' },
      { clientRequestId: nextCrid('cancel-exp') }), 'INVALID_TRANSITION',
    'C9 EXCEPTION 且 fromStatus=PICKED → 拒绝取消（已取件不在可取消分支）');
    await expectField(t, cApi.call('order.cancel', { orderNo: NO.OTHER, reason: 'OTHER' },
      { clientRequestId: nextCrid('cancel-other-no-note') }), 'VALIDATION_FAILED', 'note',
    'C10 reason=OTHER 缺备注 → VALIDATION_FAILED 且 data.field=note');
    const otherOk = await cApi.call('order.cancel', { orderNo: NO.OTHER, reason: 'OTHER', note: '地址写错了' },
      { clientRequestId: nextCrid('cancel-other') });
    t.eq([otherOk.ok, dbOrder(db, NO.OTHER).cancelReason, dbOrder(db, NO.OTHER).cancelNoteText === undefined],
      [true, 'OTHER', true], 'C11 reason=OTHER 补备注后取消成功（原因按枚举落库）');

    const replayCrid = nextCrid('cancel-replay');
    const firstReplay = await cApi.call('order.cancel', { orderNo: NO.VERSION, reason: 'DUPLICATE' },
      { clientRequestId: replayCrid });
    const eventsBeforeReplay = dbEventsOf(db, NO.VERSION).length;
    const secondReplay = await cApi.call('order.cancel', { orderNo: NO.VERSION, reason: 'DUPLICATE' },
      { clientRequestId: replayCrid });
    t.eq([firstReplay.ok, secondReplay.ok, secondReplay.data.duplicated,
      dbOrder(db, NO.VERSION).version, dbEventsOf(db, NO.VERSION).length],
    [true, true, true, 2, eventsBeforeReplay],
    'C12 同 clientRequestId 重放 → duplicated=true，不重复写事件、不再递增 version');
    await expectCode(t, cApi.call('order.cancel', { orderNo: NO.VERSION, reason: 'CHANGED_MIND' },
      { clientRequestId: nextCrid('cancel-version'), expectedVersion: 99 }), 'CONFLICT',
    'C13 expectedVersion 与当前 version 不符 → CONFLICT（乐观锁）');
    await expectField(t, cApi.call('order.cancel', { orderNo: NO.REASON, reason: 'PRICE_ISSUE' },
      { clientRequestId: nextCrid('cancel-bad-reason') }), 'VALIDATION_FAILED', 'reason',
    'C14 非枚举原因（含已删除口径）→ VALIDATION_FAILED 且 data.field=reason');
    t.notEmpty(db.dump('order_events'), 'C 组事件样本非空');
  });

  // ---------------------------------------------------------------- D confirmDelivery
  asyncSection('D. order.confirmDelivery：DELIVERED→COMPLETED / 非法流转 / 幂等（契约 F）', async (t) => {
    const NO = { DELIV: '20261022-0301', SUB: '20261022-0302' };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.DELIV, ORDER_STATUS.DELIVERED, { deliveredAt: NOW - 1000, statusUpdatedAt: NOW - 1000 }),
      orderDoc(NO.SUB, ORDER_STATUS.SUBMITTED)
    ]);
    const cApi = apiOf(db, C1);
    const confirmCrid = nextCrid('confirm');
    const done = await cApi.call('order.confirmDelivery', { orderNo: NO.DELIV }, { clientRequestId: confirmCrid });
    t.eq([done.ok, done.data.order.status, done.data.order.completedAt !== '', done.data.order.version],
      [true, ORDER_STATUS.COMPLETED, true, 2],
      'D1 DELIVERED 顾客确认 → COMPLETED + completedAt 下发 + version 1→2');
    const doneDoc = dbOrder(db, NO.DELIV);
    const doneEvents = dbEventsOf(db, NO.DELIV);
    t.eq([doneDoc.completedAt instanceof Date, doneDoc.completedAt.getTime(), doneDoc.status,
      doneEvents.length, doneEvents[0].type, doneEvents[0].fromStatus, doneEvents[0].toStatus,
      doneEvents[0].actorRole],
    [true, NOW, ORDER_STATUS.COMPLETED, 1, 'COMPLETED', ORDER_STATUS.DELIVERED,
      ORDER_STATUS.COMPLETED, ROLES.CUSTOMER],
    'D2 完成落库 + COMPLETED 事件（from DELIVERED → COMPLETED，actorRole=CUSTOMER）');
    await expectCode(t, cApi.call('order.confirmDelivery', { orderNo: NO.SUB },
      { clientRequestId: nextCrid('confirm-sub') }), 'INVALID_TRANSITION',
    'D3 非 DELIVERED（SUBMITTED）确认送达 → INVALID_TRANSITION');
    const replay = await cApi.call('order.confirmDelivery', { orderNo: NO.DELIV }, { clientRequestId: confirmCrid });
    t.eq([replay.ok, replay.data.duplicated, dbOrder(db, NO.DELIV).version, dbEventsOf(db, NO.DELIV).length],
      [true, true, 2, 1], 'D4 同 clientRequestId 重放幂等（duplicated、不再写事件、不递增 version）');
  });

  // ---------------------------------------------------------------- E deleteRecord
  asyncSection('E. order.deleteRecord：COMPLETED 软删 / 列表隐藏 / 重复幂等（契约 F）', async (t) => {
    const NO = { DONE: '20261022-0401', SUB: '20261022-0402' };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.DONE, ORDER_STATUS.COMPLETED, { completedAt: NOW - 2000 }),
      orderDoc(NO.SUB, ORDER_STATUS.SUBMITTED)
    ]);
    const cApi = apiOf(db, C1);
    const listed = await cApi.call('order.listCustomer', { status: 'COMPLETED' });
    t.check(listed.data.list.length === 1 && orderNosOf(listed)[0] === NO.DONE,
      'E1 基线：已完成列表可见 1 条（删除前置条件）');
    const delCrid = nextCrid('delete');
    const deleted = await cApi.call('order.deleteRecord', { orderNo: NO.DONE }, { clientRequestId: delCrid });
    t.eq([deleted.ok, deleted.data.deletedByCustomerAt], [true, ISO_NOW],
      'E2 软删成功并回 deletedByCustomerAt=server now（ISO）');
    const delDoc = dbOrder(db, NO.DONE);
    const delEvents = dbEventsOf(db, NO.DONE);
    t.eq([delDoc.deletedByCustomerAt instanceof Date, delDoc.deletedByCustomerAt.getTime(),
      delDoc.status, delDoc.version, delEvents.length, delEvents[0].type, delEvents[0].actorRole],
    [true, NOW, ORDER_STATUS.COMPLETED, 2, 1, 'DELETED_BY_CUSTOMER', ROLES.CUSTOMER],
    'E3 落库 deletedByCustomerAt + DELETED_BY_CUSTOMER 事件；订单状态不变只软删');
    const hideList = await cApi.call('order.listCustomer', { status: 'COMPLETED' });
    t.eq([hideList.data.list.length, hideList.data.counts.completed], [0, 0],
      'E4 软删后列表隐藏且 counts.completed 同步减 1（只从本人列表隐藏，不硬删）');
    await expectCode(t, cApi.call('order.deleteRecord', { orderNo: NO.SUB },
      { clientRequestId: nextCrid('delete-sub') }), 'INVALID_STATE',
    'E5 非 COMPLETED（SUBMITTED）删除记录 → INVALID_STATE');
    const repeat = await cApi.call('order.deleteRecord', { orderNo: NO.DONE }, { clientRequestId: delCrid });
    const repeatedAgain = await cApi.call('order.deleteRecord', { orderNo: NO.DONE }, { clientRequestId: nextCrid('delete-again') });
    t.eq([repeat.data.duplicated, repeatedAgain.data.duplicated,
      repeat.data.deletedByCustomerAt, repeatedAgain.data.deletedByCustomerAt,
      dbOrder(db, NO.DONE).version, dbEventsOf(db, NO.DONE).length],
    [true, true, ISO_NOW, ISO_NOW, 2, 1],
    'E6 重复调用（同/不同 clientRequestId）duplicated=true 且首次删除时间不变、不重复写事件');
  });

  // ---------------------------------------------------------------- F 越权负向
  asyncSection('F. 越权负向：他人订单/兼职越权/admin 脱敏/测试单隔离/READONLY（契约 F）', async (t) => {
    const NO = {
      OTHER: '20261022-0501', DELIV: '20261022-0502', FOREIGN: '20261022-0503',
      ADMIN: '20261022-0504', TEST: '20261022-0505', READONLY: '20261022-0506'
    };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.OTHER, ORDER_STATUS.COMPLETED, { customerId: C2, customerOpenid: C2, customerNo: 'CABCDEFGK', completedAt: NOW - 1000 }),
      orderDoc(NO.DELIV, ORDER_STATUS.DELIVERED, { deliveredAt: NOW - 1000 }),
      orderDoc(NO.FOREIGN, ORDER_STATUS.SUBMITTED, { partnerId: 'partner-lc-other', partnerOpenid: 'openid-lc-other-p', partnerNo: 'PABC999' }),
      orderDoc(NO.ADMIN, ORDER_STATUS.SUBMITTED, { statusUpdatedAt: NOW - 1000 }),
      orderDoc(NO.TEST, ORDER_STATUS.SUBMITTED, { customerId: TEST_C, customerOpenid: TEST_C, isTest: true, statusUpdatedAt: NOW - 900 }),
      orderDoc(NO.READONLY, ORDER_STATUS.SUBMITTED, { statusUpdatedAt: NOW - 800 })
    ]);
    const cApi = apiOf(db, C1);
    const pApi = apiOf(db, P1);
    await expectCode(t, cApi.call('order.get', { orderNo: NO.OTHER }), 'FORBIDDEN',
      'F1 他人订单 order.get → FORBIDDEN（订单双方之外不可见）');
    await expectCode(t, cApi.call('order.cancel', { orderNo: NO.OTHER, reason: 'CHANGED_MIND' },
      { clientRequestId: nextCrid('f-cancel-other') }), 'FORBIDDEN',
    'F2 他人订单 order.cancel → FORBIDDEN（越权写零落库）');
    await expectCode(t, cApi.call('order.confirmDelivery', { orderNo: NO.OTHER },
      { clientRequestId: nextCrid('f-confirm-other') }), 'FORBIDDEN',
    'F3 他人订单 order.confirmDelivery → FORBIDDEN');
    await expectCode(t, pApi.call('order.confirmDelivery', { orderNo: NO.DELIV },
      { clientRequestId: nextCrid('f-partner-confirm') }), 'FORBIDDEN',
    'F4 兼职不能代顾客确认送达（角色矩阵仅 CUSTOMER）→ FORBIDDEN');
    await expectCode(t, pApi.call('order.cancel', { orderNo: NO.FOREIGN, reason: 'TOO_BUSY' },
      { clientRequestId: nextCrid('f-partner-cancel') }), 'FORBIDDEN',
    'F5 兼职不能取消他人订单 → FORBIDDEN');

    const adminCtx = handlerCtx(db, 'openid-lc-admin', { identity: { role: enums.CANCELLED_BY.ADMIN, developerNo: 'DEV001' } });
    const adminView = await getOrderHandler(adminCtx, { orderNo: NO.ADMIN });
    t.eq([adminView.order.parcel.pickupCode, adminView.order.phoneTail, adminView.order.dorm.room,
      adminView.order.dorm.dormKey, adminView.order.actions.length],
    [mask.maskPickupCode('A12345'), mask.maskPhoneTail('1234'), '', '', 0],
    'F6 admin 真实会话 DTO 强制脱敏（取件码首末位/尾号后 2 位/房间清空/无动作条）');
    t.eq(leakKeysOf(adminView.order, ADMIN_FORBIDDEN_KEYS), [],
      'F7 admin 真实会话 DTO 递归零 openid/_id/fileId/cloudPath（完整 L3 只经只读视角审计）');

    const foreignTest = await cApi.call('order.get', { orderNo: NO.TEST });
    t.check(foreignTest.ok !== true && (foreignTest.code === 'FORBIDDEN' || foreignTest.code === 'NOT_FOUND'),
      'F8 测试单对真实会话不可见（他人测试单 → FORBIDDEN/NOT_FOUND，实际 ' + foreignTest.code + '）');
    const dirtyDb = seedWorld();
    dirtyDb.seed('orders', [orderDoc(NO.TEST, ORDER_STATUS.SUBMITTED, { isTest: true })]);
    const dirtyRes = await apiOf(dirtyDb, C1).call('order.get', { orderNo: NO.TEST });
    t.check(dirtyRes.ok !== true && dirtyRes.code === 'NOT_FOUND',
      'F9 真实会话查「本人但 isTest=true」脏数据单 → NOT_FOUND（assertTestOrderVisible 兜底，实际 '
      + dirtyRes.code + '）');
    const testCtx = handlerCtx(db, TEST_C, { identity: { role: ROLES.CUSTOMER, viewMode: enums.VIEW_MODE.TEST_WRITE } });
    const testView = await getOrderHandler(testCtx, { orderNo: NO.TEST });
    t.eq([testView.order.orderNo, testView.order.isTest, testView.order.actions.length > 0],
      [NO.TEST, true, true], 'F10 TEST_WRITE 会话可见测试单且下发 isTest/动作条');
    const readOnlyCtx = handlerCtx(db, C1, { identity: { role: ROLES.CUSTOMER, viewMode: enums.VIEW_MODE.READONLY } });
    const readOnlyCode = await errorCodeOf(cancelOrderHandler(readOnlyCtx, {
      orderNo: NO.READONLY, reason: 'CHANGED_MIND'
    }));
    t.eq(readOnlyCode, 'FORBIDDEN', 'F11 READONLY 切换会话的写动作在 handler 层也拒绝 → FORBIDDEN（双保险）');
  });

  // ---------------------------------------------------------------- G message
  asyncSection('G. message.send 状态闸/越权/长度/幂等 + message.list 两模式与已读水位', async (t) => {
    const NO = {
      SUB: '20261022-0601', EXC: '20261022-0602', DONE: '20261022-0603',
      CANCEL: '20261022-0604', OTHER: '20261022-0605', OVER: '20261022-0606'
    };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.SUB, ORDER_STATUS.SUBMITTED),
      orderDoc(NO.EXC, ORDER_STATUS.EXCEPTION, {
        exception: { code: 'CUSTOMER_UNREACHABLE', text: '联系不上', fromStatus: ORDER_STATUS.ACCEPTED, by: ROLES.PARTNER, at: NOW - 1000 }
      }),
      orderDoc(NO.DONE, ORDER_STATUS.COMPLETED, { completedAt: NOW - 1000 }),
      orderDoc(NO.CANCEL, ORDER_STATUS.CANCELLED, { cancelledAt: NOW - 1000, cancelReason: 'CHANGED_MIND', cancelledBy: ROLES.CUSTOMER }),
      orderDoc(NO.OTHER, ORDER_STATUS.SUBMITTED, { customerId: C2, customerOpenid: C2 }),
      orderDoc(NO.OVER, ORDER_STATUS.SUBMITTED)
    ]);
    const cApi = apiOf(db, C1);
    const pApi = apiOf(db, P1);

    const cridExc = nextCrid('msg-exc');
    const excMsg = await cApi.call('message.send', { orderNo: NO.EXC, text: '快递放门口就行' }, { clientRequestId: cridExc });
    t.eq([excMsg.ok, excMsg.data.message.fromRole, excMsg.data.message.text, excMsg.data.message.orderNo],
      [true, ROLES.CUSTOMER, '快递放门口就行', NO.EXC],
      'G1 EXCEPTION 订单顾客可留言（进行中五态之一，与 actions 矩阵一致）');
    const pMsg = await pApi.call('message.send', { orderNo: NO.SUB, text: '马上到' }, { clientRequestId: nextCrid('msg-p') });
    t.eq([pMsg.ok, pMsg.data.message.fromRole], [true, ROLES.PARTNER], 'G2 SUBMITTED 订单兼职可留言（双方均可）');
    await expectCode(t, cApi.call('message.send', { orderNo: NO.DONE, text: '完成后再问一句' },
      { clientRequestId: nextCrid('msg-done') }), 'INVALID_TRANSITION',
    'G3 COMPLETED 订单留言 → INVALID_TRANSITION（终态只读归档，无 message 动作）');
    await expectCode(t, cApi.call('message.send', { orderNo: NO.CANCEL, text: '取消后再问一句' },
      { clientRequestId: nextCrid('msg-cancel') }), 'INVALID_TRANSITION',
    'G4 CANCELLED 订单留言 → INVALID_TRANSITION');
    await expectCode(t, cApi.call('message.send', { orderNo: NO.OTHER, text: '越权留言' },
      { clientRequestId: nextCrid('msg-other') }), 'FORBIDDEN',
    'G5 他人订单留言 → FORBIDDEN');
    await expectField(t, cApi.call('message.send', { orderNo: NO.OVER, text: 'x'.repeat(201) },
      { clientRequestId: nextCrid('msg-long') }), 'VALIDATION_FAILED', 'text',
    'G6 留言 >200 字 → VALIDATION_FAILED 且 data.field=text');
    const replay = await cApi.call('message.send', { orderNo: NO.EXC, text: '快递放门口就行' }, { clientRequestId: cridExc });
    t.eq([replay.data.duplicated, dbMessagesOf(db, 'lc-o-' + NO.EXC).length], [true, 1],
      'G7 同 clientRequestId 重放 → duplicated=true 且不落第二条留言');

    // 订单模式：倒序 + 游标（独立订单，避免与上面已发留言互相污染时间序）
    const listOrderNo = '20261022-0607';
    db.seed('orders', [orderDoc(listOrderNo, ORDER_STATUS.SUBMITTED, { statusUpdatedAt: NOW - 5000 })]);
    const orderId = 'lc-o-' + listOrderNo;
    db.seed('order_messages', [
      messageDoc(orderId, ROLES.PARTNER, P1, 'A 第一条', NOW - 3000),
      messageDoc(orderId, ROLES.CUSTOMER, C1, 'B 第二条', NOW - 2000),
      messageDoc(orderId, ROLES.PARTNER, P1, 'C 第三条', NOW - 1000)
    ]);
    const page1 = await cApi.call('message.list', { orderNo: listOrderNo, limit: 2 });
    t.eq([page1.ok, page1.data.list.length, page1.data.list.map((item) => item.text), page1.data.orderNo],
      [true, 2, ['C 第三条', 'B 第二条'], listOrderNo],
      'G8 订单留言模式：按 createdAt desc 倒序（只回订单模式字段）');
    t.check(page1.data.nextCursor !== null && typeof page1.data.nextCursor.sortValue === 'number',
      'G9 订单留言模式 nextCursor 非空（{sortValue,tie} 游标）');
    const page2 = await cApi.call('message.list', { orderNo: listOrderNo, limit: 2, cursor: page1.data.nextCursor });
    const pageTexts = page1.data.list.map((item) => item.text).concat(page2.data.list.map((item) => item.text));
    t.eq([page2.data.list.map((item) => item.text), pageTexts.length,
      new Set(pageTexts).size], [['A 第一条'], 3, 3],
    'G10 第二页补齐余量且两页不重不漏');

    // 消息中心模式：unread 与已读水位只前进
    const centerDb = seedWorld();
    const centerOrderNo = '20261022-0701';
    centerDb.seed('orders', [orderDoc(centerOrderNo, ORDER_STATUS.SUBMITTED, { statusUpdatedAt: NOW - 3000 })]);
    centerDb.seed('order_events', [eventDoc('lc-o-' + centerOrderNo, centerOrderNo, 'ACCEPTED', { at: new Date(NOW - 4000) })]);
    centerDb.seed('order_messages', [
      messageDoc('lc-o-' + centerOrderNo, ROLES.PARTNER, P1, '对方留言（未读）', NOW - 2000),
      messageDoc('lc-o-' + centerOrderNo, ROLES.CUSTOMER, C1, '我的留言（自己已读）', NOW - 1000)
    ]);
    const centerApi = apiOf(centerDb, C1);
    const center = await centerApi.call('message.list', {});
    t.eq([center.ok, center.data.unreadMessages, center.data.unread, center.data.list.length > 0],
      [true, 1, 1, true], 'G11 消息中心模式：只统计「对方发来且未读」的 MESSAGE（自己发的不计）');
    const readRes = await centerApi.call('message.markRead', { scope: 'ORDER', orderNo: centerOrderNo },
      { clientRequestId: nextCrid('mark-read') });
    t.eq([readRes.ok, readRes.data.orderMessagesRead, readRes.data.messageReadAt], [true, 1, ISO_NOW],
      'G12 markRead ORDER：对方留言置已读 1 条 + users.messageReadAt 推进到 server now');
    const centerAfter = await centerApi.call('message.list', {});
    t.eq(centerAfter.data.unreadMessages, 0, 'G13 已读后消息中心 unreadMessages=0');
    const earlierApi = apiOf(centerDb, C1, { now: NOW - HOUR });
    const backRes = await earlierApi.call('message.markRead', { scope: 'ALL' }, { clientRequestId: nextCrid('mark-read-old') });
    t.eq(backRes.data.messageReadAt, ISO_NOW, 'G14 更早时间调用 markRead → 已读水位只前进不倒退');
    const centerRows = centerDb.dump('order_messages');
    const partnerRow = centerRows.filter((row) => row.fromRole === ROLES.PARTNER)[0];
    const mineRow = centerRows.filter((row) => row.fromRole === ROLES.CUSTOMER)[0];
    t.eq([centerDb.dump('users').filter((row) => row._id === C1)[0].messageReadAt.getTime(),
      !!partnerRow.readAt, mineRow.readAt], [NOW, true, null],
    'G15 水位落库：users.messageReadAt=server now、对方留言 readAt 落库、自己留言不标已读');

    // 契约 D 强约束：message.send 可用状态集必须与 order.get 顾客 actions 里的 message 动作完全一致
    const matrixDb = seedWorld();
    const matrixNos = {};
    const matrixStatuses = [ORDER_STATUS.SUBMITTED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PICKED,
      ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED, ORDER_STATUS.EXCEPTION];
    matrixStatuses.forEach((status, index) => {
      const orderNo = '20261022-09' + String(index + 1).padStart(2, '0');
      matrixNos[status] = orderNo;
      matrixDb.seed('orders', [orderDoc(orderNo, status, {
        acceptedAt: index >= 1 ? NOW - 1000 : 0,
        pickedAt: index >= 2 ? NOW - 1000 : 0,
        deliveredAt: index >= 3 ? NOW - 1000 : 0,
        completedAt: status === ORDER_STATUS.COMPLETED ? NOW - 1000 : 0,
        cancelledAt: status === ORDER_STATUS.CANCELLED ? NOW - 1000 : 0,
        exception: status === ORDER_STATUS.EXCEPTION
          ? { code: 'OTHER', text: '异常', fromStatus: ORDER_STATUS.ACCEPTED, by: ROLES.PARTNER, at: NOW - 1000 }
          : null,
        statusUpdatedAt: NOW - 1000
      })]);
    });
    const matrixApi = apiOf(matrixDb, C1);
    const hasMessageAction = [];
    const sendAllowed = [];
    for (let i = 0; i < matrixStatuses.length; i += 1) {
      const status = matrixStatuses[i];
      const detail = await matrixApi.call('order.get', { orderNo: matrixNos[status] });
      hasMessageAction.push(actionKeysOf(detail.data.order).indexOf('message') >= 0);
      const sent = await matrixApi.call('message.send', { orderNo: matrixNos[status], text: '状态一致性探针' },
        { clientRequestId: nextCrid('matrix-msg') });
      sendAllowed.push(sent.ok === true);
    }
    t.eq([hasMessageAction, sendAllowed],
      [[true, true, true, true, false, false, true], [true, true, true, true, false, false, true]],
      'G16 强一致：order.get 的 message 动作集 === message.send 放行集（七状态逐格，终态两格双拒绝）');
  });

  // ---------------------------------------------------------------- H imageUrl
  asyncSection('H. order.imageUrl：cleaned 拒绝/无图/归属/临时 URL TTL/依赖失败（契约 E）', async (t) => {
    const NO = { CLEANED: '20261022-0801', EMPTY: '20261022-0802', OTHER: '20261022-0803', NORMAL: '20261022-0804' };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.CLEANED, ORDER_STATUS.CANCELLED, {
        cancelledAt: NOW - 2000, image: imageDoc({ cleanedAt: NOW - 1000 })
      }),
      orderDoc(NO.EMPTY, ORDER_STATUS.SUBMITTED, { image: {} }),
      orderDoc(NO.OTHER, ORDER_STATUS.COMPLETED, {
        customerId: C2, customerOpenid: C2, completedAt: NOW - 1000
      }),
      orderDoc(NO.NORMAL, ORDER_STATUS.DELIVERED, { deliveredAt: NOW - 1000 })
    ]);
    const cApi = apiOf(db, C1);
    const cleaned = await cApi.call('order.imageUrl', { orderNo: NO.CLEANED });
    t.eq([cleaned.ok, cleaned.code, cleaned.message],
      [false, 'NOT_FOUND', '截图已按隐私策略删除（完成/取消 7 天后）'],
      'H1 已清理截图 → NOT_FOUND + 指定人话文案（不再签发任何 URL）');
    await expectCode(t, cApi.call('order.imageUrl', { orderNo: NO.EMPTY }), 'NOT_FOUND',
      'H2 无截图订单 → NOT_FOUND');
    await expectCode(t, cApi.call('order.imageUrl', { orderNo: NO.OTHER }), 'FORBIDDEN',
      'H3 他人订单截图 → FORBIDDEN（归属校验先于签发）');
    const normal = await cApi.call('order.imageUrl', { orderNo: NO.NORMAL });
    t.eq([normal.ok, normal.data.url, normal.data.expiresAt],
      [true, TEMP_URL, new Date(NOW + URL_TTL_MS).toISOString()],
      'H4 正常订单签发 5 分钟临时 URL（expiresAt=now+300s，URL 不落库）');
    const failingApi = apiOf(db, C1, { cloud: cloudStub({ failTempUrl: true }) });
    await expectCode(t, failingApi.call('order.imageUrl', { orderNo: NO.NORMAL }), 'DEPENDENCY_FAILED',
      'H5 云存储取临时 URL 失败 → DEPENDENCY_FAILED（不泄露内部错误）');
  });

  // ---------------------------------------------------------------- I order.correct 补码事件 note
  asyncSection('I. order.correct 补码事件 note：补齐 / 非补码 / 清空码 三态（批 5 补丁-A）', async (t) => {
    const NO = { FILL: '20261022-0901', REWRITE: '20261022-0902', CLEAR: '20261022-0903' };
    const db = seedWorld();
    db.seed('orders', [
      orderDoc(NO.FILL, ORDER_STATUS.ACCEPTED, {
        acceptedAt: NOW - 1800,
        parcel: parcelOf({ pickupCode: '', codeStatus: 'NEED_CODE' })
      }),
      orderDoc(NO.REWRITE, ORDER_STATUS.ACCEPTED, { acceptedAt: NOW - 1700 }),
      orderDoc(NO.CLEAR, ORDER_STATUS.ACCEPTED, { acceptedAt: NOW - 1600 })
    ]);
    const cApi = apiOf(db, C1);
    const pApi = apiOf(db, P1);

    // 正例：NEED_CODE→OK 补码；note 走真实 order.get，payload.codeStatusChanged 走落库（DTO 已裁 payload）
    const filled = await pApi.call('order.correct', { orderNo: NO.FILL, patch: { pickupCode: 'B67890' } });
    const fillEvents = correctedEventsOf(await cApi.call('order.get', { orderNo: NO.FILL }));
    const fillDbPayload = dbCorrectedEventOf(db, NO.FILL).payload || {};
    t.eq([filled.ok, filled.data.correctedFields, fillEvents.length, fillEvents[0] && fillEvents[0].note,
      fillDbPayload.codeStatusChanged],
    [true, ['pickupCode'], 1, CODE_FILLED_NOTE, true],
    'I1 NEED_CODE 补码 → 恰 1 条 ORDER_CORRECTED，note=「兼职已补齐取件码」，落库 payload.codeStatusChanged=true');

    // 反例：已 OK 订单改柜号（非补码）→ note 空串、payload 无 codeStatusChanged
    const rewrite = await pApi.call('order.correct', { orderNo: NO.REWRITE, patch: { lockerNo: 'B-12' } });
    const rewriteEvents = correctedEventsOf(await cApi.call('order.get', { orderNo: NO.REWRITE }));
    const rewriteDbPayload = dbCorrectedEventOf(db, NO.REWRITE).payload || {};
    t.eq([rewrite.ok, rewrite.data.correctedFields, rewriteEvents[0] && rewriteEvents[0].note,
      rewriteDbPayload.codeStatusChanged],
    [true, ['lockerNo'], '', undefined],
    'I2 已 OK 订单改柜号（非补码）→ 事件 note 为空串、payload 无 codeStatusChanged');

    // 反例：清空取件码（OK→NEED_CODE）不是「补齐」，note 必须为空
    const cleared = await pApi.call('order.correct', { orderNo: NO.CLEAR, patch: { pickupCode: '' } });
    const clearEvents = correctedEventsOf(await cApi.call('order.get', { orderNo: NO.CLEAR }));
    const clearDbPayload = dbCorrectedEventOf(db, NO.CLEAR).payload || {};
    t.eq([cleared.ok, cleared.data.order.parcel.codeStatus, clearEvents[0] && clearEvents[0].note,
      clearDbPayload.codeStatusChanged],
    [true, 'NEED_CODE', '', undefined],
    'I3 清空码 OK→NEED_CODE 不算「补齐」→ note 空串、payload 无 codeStatusChanged（需码状态回退）');

    // 有牙正控：三张单共 3 条更正事件，只有补码那条带标记（恒写 note→3 红；丢写→0 红；条件写反→红）
    const allCorrections = fillEvents.concat(rewriteEvents, clearEvents);
    t.eq([allCorrections.length, allCorrections.filter((event) => event.note === CODE_FILLED_NOTE).length],
      [3, 1], 'I4 跨三单正控：3 条 ORDER_CORRECTED 中恰 1 条带「兼职已补齐取件码」（样本非空、判据非恒真）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-order-lifecycle' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-order-lifecycle');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
