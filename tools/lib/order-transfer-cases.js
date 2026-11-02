'use strict';
/**
 * tools/lib/order-transfer-cases.js — 批 26 D58 转派套件（tools/selftest-transfer.js）夹具/助手拆分件。
 *
 * 为什么拆：门禁 #18 要求 tools/*.js 单文件 ≤1000 行；本文件承担 fake DB 装配、文档种子、DTO 期望键集、
 * 通用断言助手与「匿名化单源 = cleanup retention」的清理环境装配，主套件只保留 T1~T13 断言段落。
 * 口径：docs/contract/V4_CONTRACT.md §13 D58 行、docs/data/V4_DATA_MODEL.md §2.5/§8.4、
 *       docs/archive/reviews/2026-11-03_BATCH26_27_INTERFACE_DRAFT.md §1.2~§1.4；期望值逐条对照草案，不抄实现输出。
 */
const path = require('path');
const fs = require('fs');
const { createFakeDb } = require('../fake-db');

const ROOT = path.resolve(__dirname, '../..');
const API = path.join(ROOT, 'cloudfunctions/api');
const CLEANUP = path.join(ROOT, 'cloudfunctions/cleanup');
const ORDERS_DIR = path.join(API, 'handlers/order');
const app = require(path.join(API, 'app.js'));
const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const enums = require(path.join(API, 'shared/enums.js'));
const cleanupCollections = require(path.join(CLEANUP, 'shared/collections.js')).COLLECTIONS;
const cleanupDao = require(path.join(CLEANUP, 'db/dao.js'));
const retention = require(path.join(CLEANUP, 'sweeps/retention.js'));

const { ROLES, PARTNER_STATUS, ORDER_STATUS, VIEW_MODE, CODE_STATUS, USER_STATUS } = enums;
const { SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED, CANCELLED, EXCEPTION } = ORDER_STATUS;
const TRANSFER_STATUS = enums.TRANSFER_STATUS;
const TRANSFER_REASON = enums.TRANSFER_RESOLVE_REASON;

const NOW = Date.parse('2026-11-03T10:00:00+08:00');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const C1 = 'openid-b26-c1';
const P1 = 'openid-b26-p1';
const PID1 = 'partner-b26-1';
const P2 = 'openid-b26-p2';
const PID2 = 'partner-b26-2';
const P3 = 'openid-b26-p3';
const PID3 = 'partner-b26-3';
const TEST_C = 'TEST-b26-customer';
const TEST_P = 'TEST-b26-partner';
const TEST_PID = 'partner-b26-test';
const TEST_P2 = 'TEST-b26-partner2';
const TEST_PID2 = 'partner-b26-test2';
const PRIVACY_VERSION = 'v4.0.0';
const CONSENT = { version: PRIVACY_VERSION, at: NOW };
const TEMP_URL = 'https://tmp.example/b26';
// 转派块键集（草案 §1.4 白名单）：双方 7 键 / 顾客 2 键 / admin 只读投影 8 键（含后台详情页消费的
// requestedAt/resolvedAt/resolveReasonText；无 openid/内部 id，见 handlers/admin/_dto.transferBrief）
const PARTNER_TRANSFER_KEYS = ['expiresAt', 'fromPartnerNo', 'requestedAt', 'resolveReason', 'resolvedAt', 'status', 'toPartnerNo'];
const CUSTOMER_TRANSFER_KEYS = ['status', 'toPartnerNo'];
const ADMIN_TRANSFER_KEYS = ['expiresAt', 'fromPartnerNo', 'requestedAt', 'resolveReason', 'resolveReasonText',
  'resolvedAt', 'status', 'toPartnerNo'];
const TRANSFER_BLOCK_KEYS = ['expiresAt', 'fromPartnerId', 'fromPartnerNo', 'requestedAt', 'resolveReason',
  'resolvedAt', 'status', 'toPartnerId', 'toPartnerNo'];
// DTO 内不得出现的内部键（字符级扫描：目标兼职视图断言字符串里不含这些词）
const TRANSFER_TARGET_BANNED = ['displayName', 'avatarUrl', 'customerNo', 'openid', 'toPartnerId', 'fromPartnerId'];

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
  Object.keys(COLLECTIONS).forEach((key) => db.seed(COLLECTIONS[key], []));
  return db;
}

function cloudStub() {
  return {
    openapi: { security: { msgSecCheck: async () => ({ errCode: 0, result: { suggest: 'pass', label: 100 } }) } },
    getTempFileURL: async (input) => ({
      fileList: (input.fileList || []).map((file) => ({ fileID: file.fileID, tempFileURL: TEMP_URL, status: 0 }))
    }),
    deleteFile: async () => ({ fileList: [] })
  };
}

function apiOf(db, openid) {
  return app.createApi({ db, now: () => NOW, openid, env: {}, cloud: cloudStub() });
}

function apiOfAt(db, openid, nowMs) {
  return app.createApi({ db, now: () => nowMs, openid, env: {}, cloud: cloudStub() });
}

// 直调 handler（绕中间件：注入 TEST_WRITE / READONLY 身份，用于隔离与只读闸）
function handlerCtxOf(db, openid, identity, requestId) {
  const dao = createDao(db);
  const ctx = {
    dao,
    ids: app.bindIds(dao, NOW),
    now: NOW,
    env: {},
    cloud: cloudStub(),
    openid,
    identity: Object.assign(app.baseIdentity(openid), identity || {}),
    requestId: requestId || 'req-b26-transfer',
    clientRequestId: 'crid-' + String(requestId || 'handler'),
    expectedVersion: undefined,
    config: {}
  };
  return ctx;
}

function handlerCtxWithCrid(db, openid, identity, tag) {
  const ctx = handlerCtxOf(db, openid, identity, tag);
  ctx.clientRequestId = nextCrid(tag);
  return ctx;
}

let CRID_SEQ = 0;
function nextCrid(tag) {
  CRID_SEQ += 1;
  let text = String(tag || 'x').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  while (text.length < 8) text += 'x';
  return 'b26-' + String(CRID_SEQ).padStart(5, '0') + '-' + text;
}

const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------- 文档种子
function userDoc(id, roles, extra) {
  return Object.assign({
    _id: id,
    roles: roles || [],
    status: USER_STATUS.ACTIVE,
    isTestAccount: false,
    createdByDeveloperNo: '',
    privacyConsent: CONSENT,
    messageReadAt: 0,
    deletionRequestedAt: 0,
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW
  }, extra || {});
}

function customerDoc(id, customerNo, extra) {
  return Object.assign({
    _id: id,
    customerNo,
    displayName: '顾客甲',
    phoneTail: '1234',
    zone: 'D',
    buildingNo: 4,
    room: '522',
    dormKey: 'D4-522',
    profileCompleted: true,
    avatarFileId: '',
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW
  }, extra || {});
}

function partnerDoc(openid, id, partnerNo, extra) {
  return Object.assign({
    _id: id,
    openid,
    partnerNo,
    displayName: '兼职' + partnerNo.slice(-1),
    avatarFileId: '',
    status: PARTNER_STATUS.ACTIVE,
    deletedAt: null,
    serviceConfig: { services: [{ code: 'PICKUP_STD', enabled: true }], zones: ['D'], acceptingOrders: true },
    stats: { totalOrders: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, todayOrders: 0, updatedAt: NOW },
    activatedAt: NOW - 30 * DAY,
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW
  }, extra || {});
}

function bindingDoc(customerId, partnerId, id) {
  return {
    _id: id,
    customerId,
    partnerId,
    status: 'ACTIVE',
    activeKey: customerId,
    roomTag: 'A',
    dormSnapshot: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4' },
    tagKey: partnerId + ':D4-522:A',
    allocSeq: 1,
    boundAt: NOW - 10 * DAY
  };
}

function orderDoc(orderNo, status, extra) {
  const overrides = extra || {};
  const parcel = Object.assign({
    stationId: 'P1',
    stationName: 'P1 一号站',
    pickupCode: 'A12345',
    lockerNo: '',
    trackingTail: '',
    codeStatus: CODE_STATUS.OK,
    recognitionSource: 'RULE',
    confidence: 'HIGH'
  }, overrides.parcel || {});
  const base = {
    _id: 'o-' + orderNo,
    orderNo,
    requestKey: 'rk-' + orderNo,
    customerId: C1,
    customerOpenid: C1,
    customerNo: 'CABCDEFGH',
    partnerId: PID1,
    partnerOpenid: P1,
    partnerNo: 'PAAAAAA',
    source: 'CUSTOMER',
    isTest: false,
    status,
    parcel,
    dorm: { zone: 'D', buildingNo: 4, room: '522', buildingText: 'D4', dormKey: 'D4-522', roomTag: 'A' },
    guest: null,
    phoneTail: '1234',
    service: { code: 'PICKUP_STD', name: '标准代取' },
    appoint: { type: 'ASAP' },
    note: '',
    image: {},
    exception: null,
    deliveryNote: '',
    cancelReason: '',
    cancelledBy: '',
    deletedByCustomerAt: null,
    version: 3,
    statusUpdatedAt: new Date(NOW - 500),
    createdAt: new Date(NOW - 5000),
    updatedAt: new Date(NOW - 500),
    acceptedAt: status === SUBMITTED ? null : new Date(NOW - 2000),
    pickedAt: null,
    deliveredAt: null,
    completedAt: null,
    cancelledAt: null
  };
  Object.keys(overrides).forEach((key) => {
    if (key !== 'parcel') {
      base[key] = overrides[key];
    }
  });
  return base;
}

// orders.transfer 块（草案 §1.2.1 九键整值；缺省 = 从未转派 → DTO null）
function transferBlock(extra) {
  return Object.assign({
    status: TRANSFER_STATUS.PENDING,
    fromPartnerId: PID1,
    fromPartnerNo: 'PAAAAAA',
    toPartnerId: PID2,
    toPartnerNo: 'PBBBBBB',
    requestedAt: new Date(NOW - 2 * MINUTE),
    expiresAt: new Date(NOW + 8 * MINUTE),
    resolvedAt: '',
    resolveReason: ''
  }, extra || {});
}

function acceptedTransferBlock(extra) {
  return transferBlock(Object.assign({
    status: TRANSFER_STATUS.ACCEPTED,
    resolvedAt: new Date(NOW - MINUTE),
    resolveReason: TRANSFER_REASON.TARGET_ACCEPTED
  }, extra || {}));
}

// config 种子：转派 TTL/限流（出厂默认同值；测试用高阈值避免非 T7 组误触限流）
function configDoc(extra) {
  return Object.assign({
    _id: 'global',
    privacyVersion: PRIVACY_VERSION,
    transferTtlMinutes: 10,
    transferRate: { perMinute: 50, perDay: 500 }
  }, extra || {});
}

function world(options) {
  const opts = options || {};
  const db = createTestDb();
  const partnerExtra = { status: opts.partnerStatus || PARTNER_STATUS.ACTIVE };
  db.seed('users', [
    userDoc(C1, [ROLES.CUSTOMER]),
    userDoc(P1, [ROLES.PARTNER]),
    userDoc(P2, [ROLES.PARTNER]),
    userDoc(P3, [ROLES.PARTNER]),
    userDoc(TEST_C, [ROLES.CUSTOMER], { isTestAccount: true }),
    userDoc(TEST_P, [ROLES.PARTNER], { isTestAccount: true }),
    userDoc(TEST_P2, [ROLES.PARTNER], { isTestAccount: true })
  ]);
  db.seed('customers', [
    customerDoc(C1, 'CABCDEFGH'),
    customerDoc(TEST_C, 'CTESTAAAA', { displayName: '测试顾客' })
  ]);
  db.seed('partners', [
    partnerDoc(P1, PID1, 'PAAAAAA', Object.assign({ displayName: '阿甲' }, partnerExtra)),
    partnerDoc(P2, PID2, 'PBBBBBB', { displayName: '阿乙' }),
    partnerDoc(P3, PID3, 'PCCCCCC', { displayName: '阿丙' }),
    partnerDoc(TEST_P, TEST_PID, 'PTESTAA', { displayName: '测试兼职' }),
    partnerDoc(TEST_P2, TEST_PID2, 'PTESTBB', { displayName: '测试兼职二' })
  ]);
  db.seed('bindings', [bindingDoc(C1, PID1, 'bind-b26-c1')]);
  db.seed('config', [configDoc(opts.config)]);
  if (opts.orders) {
    db.seed('orders', opts.orders);
  }
  return db;
}

// ---------------------------------------------------------------- 读取/断言助手
function rowsOf(db) {
  return db.dump(COLLECTIONS.ORDERS);
}

function rowOf(db, orderNo) {
  return rowsOf(db).filter((row) => row.orderNo === orderNo)[0] || null;
}

function eventsFor(db, orderNo) {
  return db.dump(COLLECTIONS.ORDER_EVENTS)
    .filter((event) => event.orderNo === orderNo)
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

function eventTypesOf(db, orderNo) {
  return eventsFor(db, orderNo).map((event) => event.type);
}

function countersOf(db) {
  return db.dump(COLLECTIONS.COUNTERS);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function transferKeysOf(dto) {
  return dto && dto.transfer ? Object.keys(dto.transfer).sort() : null;
}

function jsonOf(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function bannedHitsOf(value) {
  const text = jsonOf(value);
  return TRANSFER_TARGET_BANNED.filter((word) => text.indexOf(word) !== -1);
}

function topKeysOf(dto) {
  return Object.keys(dto || {}).sort();
}

async function expectCode(t, promise, code, message) {
  const res = await promise;
  t.eq([res.ok, res.code], [false, code], message);
  return res;
}

async function expectField(t, promise, code, field, message) {
  const res = await promise;
  t.eq([res.ok, res.code, res.data && res.data.field], [false, code, field], message);
  return res;
}

async function errorCodeOf(promise) {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (error) {
    return (error && error.code) || (error && error.message) || 'UNKNOWN';
  }
}

function orderFiles() {
  return fs.readdirSync(ORDERS_DIR).filter((name) => name.slice(-3) === '.js')
    .map((name) => path.join(ORDERS_DIR, name));
}

function relOf(full) {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

// ---------------------------------------------------------------- T12：匿名化单源 = cleanup retention
function cleanupTestDb() {
  const db = createFakeDb({
    uniqueIndexes: {
      users: [['_id']],
      customers: [['_id'], ['customerNo']],
      partners: [['openid'], ['partnerNo']],
      orders: [['orderNo'], ['requestKey']],
      order_events: [['requestKey']],
      counters: [['key']],
      admin_audit: [['requestKey']],
      admin_view_sessions: [['requestKey']],
      upload_tickets: [['ticket']],
      recognition_failures: [['failureNo'], ['requestKey']]
    }
  });
  Object.keys(cleanupCollections).forEach((key) => db.seed(cleanupCollections[key], []));
  return db;
}

function cleanupCtx(db) {
  return {
    dao: cleanupDao.createDao(db),
    db,
    cloud: { deleteFile: async () => ({ fileList: [] }) },
    env: {},
    config: {},
    now: NOW,
    requestId: 'selftest-transfer-cleanup',
    COLLECTIONS: cleanupCollections
  };
}

module.exports = {
  EXPECTED_ASSERTIONS: 0, // 占位：由主套件按实跑回填（本文件不承载套件计数）
  ROOT,
  API,
  CLEANUP,
  ORDERS_DIR,
  NOW,
  MINUTE,
  HOUR,
  DAY,
  C1,
  P1,
  PID1,
  P2,
  PID2,
  P3,
  PID3,
  TEST_C,
  TEST_P,
  TEST_PID,
  TEST_P2,
  TEST_PID2,
  PRIVACY_VERSION,
  CONSENT,
  TEMP_URL,
  TRANSFER_STATUS,
  TRANSFER_REASON,
  PARTNER_TRANSFER_KEYS,
  CUSTOMER_TRANSFER_KEYS,
  ADMIN_TRANSFER_KEYS,
  TRANSFER_BLOCK_KEYS,
  TRANSFER_TARGET_BANNED,
  ROLES,
  PARTNER_STATUS,
  ORDER_STATUS,
  VIEW_MODE,
  CODE_STATUS,
  USER_STATUS,
  SUBMITTED,
  ACCEPTED,
  PICKED,
  DELIVERED,
  COMPLETED,
  CANCELLED,
  EXCEPTION,
  enums,
  retention,
  uniqueIndexesForApi,
  createTestDb,
  cloudStub,
  apiOf,
  apiOfAt,
  handlerCtxOf,
  handlerCtxWithCrid,
  nextCrid,
  iso,
  userDoc,
  customerDoc,
  partnerDoc,
  bindingDoc,
  orderDoc,
  transferBlock,
  acceptedTransferBlock,
  configDoc,
  world,
  rowsOf,
  rowOf,
  eventsFor,
  eventTypesOf,
  countersOf,
  sameJson,
  transferKeysOf,
  jsonOf,
  bannedHitsOf,
  topKeysOf,
  expectCode,
  expectField,
  errorCodeOf,
  orderFiles,
  relOf,
  cleanupTestDb,
  cleanupCtx
};
