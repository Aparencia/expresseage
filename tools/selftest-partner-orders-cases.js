'use strict';
/**
 * tools/selftest-partner-orders-cases.js — 批 7-B「云端代客下单 + order.listPartner view=customer」夹具。
 *
 * 为什么拆：门禁 #18 要求 tools/*.js 单文件 ≤1000 行；本文件承担 fake DB 装配、文档种子、
 * DTO 白名单期望与通用断言助手，主套件只保留 A~G 断言段落（同样 ≤1000 行）。
 * 口径：docs/V4_DATA_MODEL.md §2.5（orders.guest/source/customerNo）、§4.7（requestKey 归属）、
 *       §4.8 块 A（已绑定顾客 / guest 两分支伪代码）、§7.5 order.create/createBatch/listPartner 行 +
 *       「批 7 兼职客户与运营（只增不改语义）」①~⑥；docs/V4_UX_PARTNER.md §3.4/§3.6/§7。
 * 期望值逐字来自文档，不抄生产实现（防同源恒真）。
 */
const path = require('path');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const ORDERS_DIR = path.join(API, 'handlers/order');
const app = require(path.join(API, 'app.js'));
const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const enums = require(path.join(API, 'shared/enums.js'));

const { ROLES, PARTNER_STATUS, ORDER_STATUS, VIEW_MODE, CODE_STATUS, USER_STATUS, BINDING_STATUS } = enums;
const { SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED, CANCELLED, EXCEPTION } = ORDER_STATUS;

// 主套件实际断言数（写入 EXPECTED_ASSERTIONS 前先跑一次取真实值；少算/多算都判红）。
const EXPECTED_ASSERTIONS = 89;
const NOW = Date.parse('2026-10-22T10:00:00+08:00');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// 身份：C1/P1 为主绑定对（roomTag=B、绑定快照与顾客资料故意漂移，验证 dorm 取「顾客资料+当前 roomTag」）。
const C1 = 'openid-b7-c1';
const P1 = 'openid-b7-p1';
const PID1 = 'partner-b7-1';
const C2 = 'openid-b7-c2';
const P2 = 'openid-b7-p2';
const PID2 = 'partner-b7-2';
const C3 = 'openid-b7-c3'; // 只有 RELEASED 绑定（无 ACTIVE）
const C4 = 'openid-b7-c4'; // 资料已注销（deletedAt）
const TEST_C = 'TEST-b7-customer';
const TEST_P = 'TEST-b7-partner';
const TEST_PID = 'partner-b7-test';
const BIND_C1 = 'bind-b7-c1';
const BIND_C2 = 'bind-b7-c2';
const BIND_RELEASED = 'bind-b7-c3-rel';
const BIND_DELETED = 'bind-b7-c4-del';
const BIND_CROSS = 'bind-b7-cross';
const BIND_TEST = 'bind-b7-test';
const CUSTOMER_NO = 'CB7B7B7B';
const PARTNER_NO = 'PATB701';
const TEMP_URL = 'https://tmp.example/b7';
// listPartner 行 DTO 不得出现的内部键（`fileId` 只能经 order.imageUrl 另签；openid/主键/幂等键一律不出）
const DTO_BANNED_KEYS = [
  '_id', 'id', 'openid', 'customerId', 'customerOpenid', 'partnerId', 'partnerOpenid',
  'clientRequestId', 'requestKey', 'cloudPath', 'claimTokenHash', 'claimToken', 'batchActionId',
  'fileId', 'actorId', 'payload', 'uploaderOpenid', 'adminOpenid', 'avatarFileId'
];
const ALL_COLLECTION_NAMES = Object.keys(COLLECTIONS).map((key) => COLLECTIONS[key]);

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

// 直调 handler（绕中间件：注入 TEST_WRITE / READONLY 身份）
function handlerCtxOf(db, openid, identity) {
  const dao = createDao(db);
  return {
    dao,
    ids: app.bindIds(dao, NOW),
    now: NOW,
    env: {},
    cloud: cloudStub(),
    openid,
    identity: Object.assign(app.baseIdentity(openid), identity || {}),
    requestId: 'req-partner-orders-b7',
    clientRequestId: nextCrid('handler'),
    expectedVersion: undefined,
    config: {}
  };
}

let CRID_SEQ = 0;
function nextCrid(tag) {
  CRID_SEQ += 1;
  const seqText = String(CRID_SEQ).padStart(6, '0');
  let tagText = String(tag || 'x').replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
  while (tagText.length < 6) tagText += 'x';
  return 'b7-' + seqText + '-' + tagText;
}

const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------- 文档种子
function userDoc(id, roles, extra) {
  return Object.assign({
    _id: id, roles: roles || [], status: USER_STATUS.ACTIVE, isTestAccount: false,
    createdByDeveloperNo: '', privacyConsent: null, messageReadAt: 0, deletionRequestedAt: 0,
    createdAt: NOW - 30 * DAY, updatedAt: NOW
  }, extra || {});
}

function customerDoc(id, customerNo, extra) {
  return Object.assign({
    _id: id, customerNo, displayName: '小王', phoneTail: '1234', zone: 'D', buildingNo: 4, room: '522',
    dormKey: 'D4-522', profileCompleted: true, avatarFileId: '', createdAt: NOW - 30 * DAY, updatedAt: NOW
  }, extra || {});
}

function partnerDoc(openid, id, partnerNo, extra) {
  return Object.assign({
    _id: id, openid, partnerNo, displayName: '小李', avatarFileId: '',
    status: PARTNER_STATUS.ACTIVE, deletedAt: null,
    serviceConfig: { services: [{ code: 'PICKUP_STD', enabled: true }], zones: ['D'], acceptingOrders: true },
    stats: { totalOrders: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, todayOrders: 0, updatedAt: NOW },
    activatedAt: NOW - 30 * DAY, createdAt: NOW - 30 * DAY, updatedAt: NOW
  }, extra || {});
}

function bindingDoc(customerId, partnerId, id, extra) {
  return Object.assign({
    _id: id, customerId, partnerId, status: BINDING_STATUS.ACTIVE, activeKey: customerId, roomTag: 'A',
    dormSnapshot: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4' },
    tagKey: 'tag-' + id, allocSeq: 1, boundAt: NOW - 10 * DAY
  }, extra || {});
}

// 绑定路径：binding.dormSnapshot 故意是旧宿舍 D4-301，顾客资料是当前 D4-522 →
// 订单 dorm 必须取「顾客当前资料 + 当前 roomTag」，不能抄绑定快照。
function bindingDriftOf() {
  return {
    roomTag: 'B',
    dormSnapshot: { zone: 'D', buildingNo: 4, room: '301', dormKey: 'D4-301', buildingText: 'D4' }
  };
}

function orderRow(orderNo, extra) {
  const overrides = extra || {};
  const base = {
    _id: 'o-' + orderNo, orderNo, requestKey: 'rk-' + orderNo,
    customerId: C1, customerOpenid: C1, customerNo: CUSTOMER_NO,
    partnerId: PID1, partnerOpenid: P1, partnerNo: PARTNER_NO,
    source: 'CUSTOMER', isTest: false, status: SUBMITTED,
    parcel: {
      stationId: 'P1', stationName: 'P1 一号站', pickupCode: 'A12345', lockerNo: '', trackingTail: '',
      codeStatus: CODE_STATUS.OK, recognitionSource: 'RULE', confidence: 'HIGH'
    },
    dorm: { zone: 'D', buildingNo: 4, room: '522', buildingText: 'D4', dormKey: 'D4-522', roomTag: 'B' },
    guest: null, phoneTail: '1234',
    service: { code: 'PICKUP_STD', name: '标准代取' }, appoint: { type: 'ASAP' },
    note: '', image: {}, exception: null, deliveryNote: '', cancelReason: '', cancelledBy: '',
    deletedByCustomerAt: null, version: 1,
    statusUpdatedAt: new Date(NOW - 500), createdAt: new Date(NOW - 5000), updatedAt: new Date(NOW - 500),
    acceptedAt: null, pickedAt: null, deliveredAt: null, completedAt: null, cancelledAt: null
  };
  Object.keys(overrides).forEach((key) => {
    base[key] = overrides[key];
  });
  return base;
}

// 代客单（guest）：顾客身份三空 + guest 快照，顾客无访问路径。
function guestOrderRow(orderNo, extra) {
  const overrides = Object.assign({
    customerId: '', customerOpenid: '', customerNo: '', source: 'PARTNER', phoneTail: '5678',
    dorm: null,
    guest: {
      displayName: '代客小张', phoneTail: '5678', zone: 'D', buildingNo: 4, room: '522',
      buildingText: 'D4', dormKey: 'D4-522'
    }
  }, extra || {});
  return orderRow(orderNo, overrides);
}

function world(options) {
  const opts = options || {};
  const partnerExtra = { status: opts.partnerStatus || PARTNER_STATUS.ACTIVE };
  const db = createTestDb();
  db.seed('users', [
    userDoc(C1, [ROLES.CUSTOMER]), userDoc(P1, [ROLES.PARTNER]),
    userDoc(C2, [ROLES.CUSTOMER]), userDoc(P2, [ROLES.PARTNER]),
    userDoc(C3, [ROLES.CUSTOMER]), userDoc(C4, [ROLES.CUSTOMER]),
    userDoc(TEST_C, [ROLES.CUSTOMER], { isTestAccount: true }),
    userDoc(TEST_P, [ROLES.PARTNER], { isTestAccount: true })
  ]);
  db.seed('customers', [
    customerDoc(C1, CUSTOMER_NO),
    customerDoc(C2, 'CB7B7B7C'),
    customerDoc(C3, 'CB7B7B7D'),
    customerDoc(C4, 'CB7B7B7E', { deletedAt: new Date(NOW - DAY) }),
    customerDoc(TEST_C, 'CB7B7B7F')
  ]);
  db.seed('partners', [
    partnerDoc(P1, PID1, PARTNER_NO, partnerExtra),
    partnerDoc(P2, PID2, 'PATB702'),
    partnerDoc(TEST_P, TEST_PID, 'PATB703')
  ]);
  db.seed('bindings', [
    bindingDoc(C1, PID1, BIND_C1, bindingDriftOf()),
    bindingDoc(C2, PID2, BIND_C2, { roomTag: 'A' }),
    bindingDoc(C3, PID1, BIND_RELEASED, {
      status: BINDING_STATUS.RELEASED, roomTag: 'C',
      activeKey: C3 + ':RELEASED:' + BIND_RELEASED, releasedAt: new Date(NOW - DAY)
    }),
    bindingDoc(C4, PID1, BIND_DELETED, { roomTag: 'D' }),
    bindingDoc(C1, TEST_PID, BIND_CROSS, { roomTag: 'E' }),
    bindingDoc(TEST_C, TEST_PID, BIND_TEST, { roomTag: 'A' })
  ]);
  if (opts.orders) {
    db.seed('orders', opts.orders);
  }
  return db;
}

// ---------------------------------------------------------------- 下单入参（最小合法形态：无截图 → image 省略）
function createInput(extra) {
  return Object.assign({
    parcel: { stationId: 'P1', pickupCode: 'A12345' },
    serviceCode: 'PICKUP_STD',
    appoint: { type: 'ASAP' }
  }, extra || {});
}

function guestInput(extra) {
  return Object.assign({
    displayName: '代客小张', phoneTail: '5678', zone: 'D', buildingNo: 4, room: '522'
  }, extra || {});
}

function batchInput(items, extra) {
  return Object.assign({
    items: items || [], ticket: 'ticket-not-used'
  }, extra || {});
}

// ---------------------------------------------------------------- 断言助手
function eventsFor(db, orderNo) {
  return db.dump('order_events')
    .filter((event) => event.orderNo === orderNo)
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

function allEventsOf(db) {
  return db.dump('order_events');
}

function rowsOf(db) {
  return db.dump('orders');
}

function rowOf(db, orderNo) {
  return rowsOf(db).filter((row) => row.orderNo === orderNo)[0] || null;
}

function pickRow(list, orderNo) {
  return (list || []).filter((row) => row.orderNo === orderNo)[0] || null;
}

function actionKeysOf(row) {
  return ((row && row.actions) || []).map((item) => item.key).sort();
}

function collectKeyPaths(value, banned, prefix, out) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKeyPaths(item, banned, prefix + '[' + index + ']', out));
    return out;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    Object.keys(value).forEach((key) => {
      const next = prefix ? prefix + '.' + key : key;
      if (banned.indexOf(key) >= 0) {
        out.push(next);
      }
      collectKeyPaths(value[key], banned, next, out);
    });
  }
  return out;
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

module.exports = {
  EXPECTED_ASSERTIONS,
  ALL_COLLECTION_NAMES,
  ROOT,
  API,
  ORDERS_DIR,
  NOW,
  HOUR,
  DAY,
  C1,
  P1,
  PID1,
  C2,
  P2,
  PID2,
  C3,
  C4,
  TEST_C,
  TEST_P,
  TEST_PID,
  BIND_C1,
  BIND_C2,
  BIND_RELEASED,
  BIND_DELETED,
  BIND_CROSS,
  BIND_TEST,
  CUSTOMER_NO,
  PARTNER_NO,
  TEMP_URL,
  DTO_BANNED_KEYS,
  ROLES,
  PARTNER_STATUS,
  ORDER_STATUS,
  VIEW_MODE,
  CODE_STATUS,
  USER_STATUS,
  BINDING_STATUS,
  SUBMITTED,
  ACCEPTED,
  PICKED,
  DELIVERED,
  COMPLETED,
  CANCELLED,
  EXCEPTION,
  uniqueIndexesForApi,
  createTestDb,
  cloudStub,
  apiOf,
  apiOfAt,
  handlerCtxOf,
  nextCrid,
  iso,
  userDoc,
  customerDoc,
  partnerDoc,
  bindingDoc,
  orderRow,
  guestOrderRow,
  world,
  createInput,
  guestInput,
  batchInput,
  eventsFor,
  allEventsOf,
  rowsOf,
  rowOf,
  pickRow,
  actionKeysOf,
  collectKeyPaths,
  expectCode,
  expectField,
  errorCodeOf
};
