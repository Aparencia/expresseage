'use strict';
/**
 * tools/selftest-order-partner-cases.js — 批 6-A 兼职域套件的夹具/期望值（selftest-order-partner 拆分子文件）。
 *
 * 为什么拆：门禁 #18 要求 tools/*.js 单文件 ≤1000 行；本文件承担 fake DB 装配、文档种子、DTO 断言期望、
 * 批量动作/动作矩阵助手与通用断言助手，主套件只保留 A~H 断言段落（同样 ≤1000 行）。
 * 口径：期望值逐字来自 docs/V4_CONTRACT.md §5/§7、docs/V4_DATA_MODEL.md §2.5/§4.1/§7.5/§8/§12、
 *       docs/V4_UX_PARTNER.md §4.2/§4.6/§4.7，不从生产实现抄值（防同源恒真）。
 */
const path = require('path');
const fs = require('fs');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const ORDERS_DIR = path.join(API, 'handlers/order');
const app = require(path.join(API, 'app.js'));
const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const enums = require(path.join(API, 'shared/enums.js'));
const listPartnerHandler = require(path.join(ORDERS_DIR, 'listPartner.js'));
const acceptHandler = require(path.join(ORDERS_DIR, 'accept.js'));

const {
  ROLES, PARTNER_STATUS, ORDER_STATUS, VIEW_MODE, CODE_STATUS, USER_STATUS
} = enums;
const { SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED, CANCELLED, EXCEPTION } = ORDER_STATUS;

const EXPECTED_ASSERTIONS = 128;
const NOW = Date.parse('2026-10-22T10:00:00+08:00');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const C1 = 'openid-b6-c1';
const P1 = 'openid-b6-p1';
const PID1 = 'partner-b6-1';
const C2 = 'openid-b6-c2';
const P2 = 'openid-b6-p2';
const PID2 = 'partner-b6-2';
const TEST_C = 'TEST-b6-customer';
const TEST_P = 'TEST-b6-partner';
const TEST_PID = 'partner-b6-test';
const TEMP_URL = 'https://tmp.example/b6';
// 契约逐字口径：补码事件 note 独立写字面量（不复用生产常量，避免同源恒真）
const CODE_FILLED_NOTE = '兼职已补齐取件码';
const COUNTS_KEYS = ['submitted', 'accepted', 'picked', 'delivered', 'exception', 'todayCompleted'];
// listPartner 行 DTO 允许的顶层键（白名单：多一个=可能泄漏 raw 文档字段）
// v1.0 一单多包裹（D23/D24/D25）：新增 parcels/images/delivery/manualEntry；parcel/image 为历史单兼容键。
const DTO_ROW_KEYS = [
  'orderNo', 'status', 'statusText', 'bucket', 'progressIndex', 'needCode', 'failureHint', 'source',
  'service', 'appoint', 'parcel', 'parcels', 'note', 'phoneTail', 'dorm', 'delivery', 'manualEntry',
  'guest', 'exception', 'deliveryNote',
  'cancelReason', 'cancelReasonText', 'cancelledBy', 'cancelledByText', 'customerNo', 'partnerNo',
  'image', 'images', 'counterpart', 'actions', 'version', 'statusUpdatedAt', 'createdAt', 'updatedAt', 'acceptedAt',
  'pickedAt', 'deliveredAt', 'completedAt', 'cancelledAt', 'deletedByCustomerAt'
];
// 列表/详情 DTO 不得出现的内部键（`fileId` 只能经 order.imageUrl 另签；openid/主键/幂等键一律不出）
const DTO_BANNED_KEYS = [
  '_id', 'id', 'openid', 'customerId', 'customerOpenid', 'partnerId', 'partnerOpenid',
  'clientRequestId', 'requestKey', 'cloudPath', 'claimTokenHash', 'claimToken', 'batchActionId',
  'fileId', 'actorId', 'payload', 'uploaderOpenid', 'adminOpenid'
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
    requestId: 'req-partner-b6',
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
  return 'b6-' + seqText + '-' + tagText;
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

function bindingDoc(customerId, partnerId, id) {
  return {
    _id: id, customerId, partnerId, status: 'ACTIVE', activeKey: customerId, roomTag: 'A',
    dormSnapshot: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4' },
    tagKey: partnerId + ':D4-522:A', allocSeq: 1, boundAt: NOW - 10 * DAY
  };
}

function orderDoc(orderNo, status, extra) {
  const overrides = extra || {};
  const parcel = Object.assign({
    stationId: 'P1', stationName: 'P1 一号站', pickupCode: 'A12345', lockerNo: '', trackingTail: '',
    codeStatus: CODE_STATUS.OK, recognitionSource: 'RULE', confidence: 'HIGH'
  }, overrides.parcel || {});
  const base = {
    _id: 'o-' + orderNo, orderNo, requestKey: 'rk-' + orderNo,
    customerId: C1, customerOpenid: C1, customerNo: 'CABCDEFGH',
    partnerId: PID1, partnerOpenid: P1, partnerNo: 'PAAAAAA',
    source: 'CUSTOMER', isTest: false, status,
    parcel,
    dorm: { zone: 'D', buildingNo: 4, room: '522', buildingText: 'D4', dormKey: 'D4-522', roomTag: 'A' },
    guest: null, phoneTail: '1234',
    service: { code: 'PICKUP_STD', name: '标准代取' }, appoint: { type: 'ASAP' },
    note: '', image: {}, exception: null, deliveryNote: '', cancelReason: '', cancelledBy: '',
    deletedByCustomerAt: null, version: 3,
    statusUpdatedAt: new Date(NOW - 500), createdAt: new Date(NOW - 5000), updatedAt: new Date(NOW - 500),
    acceptedAt: null, pickedAt: null, deliveredAt: null, completedAt: null, cancelledAt: null
  };
  Object.keys(overrides).forEach((key) => {
    if (key !== 'parcel') {
      base[key] = overrides[key];
    }
  });
  return base;
}

function world(options) {
  const opts = options || {};
  const partnerExtra = { status: opts.partnerStatus || PARTNER_STATUS.ACTIVE };
  if (opts.deletedAt) {
    partnerExtra.deletedAt = opts.deletedAt;
  }
  const db = createTestDb();
  db.seed('users', [
    userDoc(C1, [ROLES.CUSTOMER]), userDoc(P1, [ROLES.PARTNER]),
    userDoc(C2, [ROLES.CUSTOMER]), userDoc(P2, [ROLES.PARTNER]),
    userDoc(TEST_C, [ROLES.CUSTOMER], { isTestAccount: true }),
    userDoc(TEST_P, [ROLES.PARTNER], { isTestAccount: true })
  ]);
  db.seed('customers', [customerDoc(C1, 'CABCDEFGH'), customerDoc(C2, 'CHIJKLMNP'), customerDoc(TEST_C, 'CTESTAAAA')]);
  db.seed('partners', [
    partnerDoc(P1, PID1, 'PAAAAAA', partnerExtra),
    partnerDoc(P2, PID2, 'PBBBBBB'),
    partnerDoc(TEST_P, TEST_PID, 'PCCCCCC')
  ]);
  db.seed('bindings', [bindingDoc(C1, PID1, 'bind-b6-c1'), bindingDoc(C2, PID2, 'bind-b6-c2')]);
  if (opts.orders) {
    db.seed('orders', opts.orders);
  }
  return db;
}

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

function versionsOf(db) {
  return rowsOf(db).map((row) => row.version);
}

function pickRow(list, orderNo) {
  return (list || []).filter((row) => row.orderNo === orderNo)[0] || null;
}

function actionKeysOf(dtoOrRow) {
  return ((dtoOrRow && dtoOrRow.actions) || []).map((item) => item.key).sort();
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

function handlerFiles() {
  return fs.readdirSync(ORDERS_DIR).filter((name) => name.slice(-3) === '.js')
    .map((name) => path.join(ORDERS_DIR, name));
}

function relOf(full) {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

async function closedPartnerMatrix(partnerStatus) {
  const db = world({ partnerStatus });
  db.seed('orders', [
    orderDoc('20261022-8101', SUBMITTED),
    orderDoc('20261022-8102', SUBMITTED),
    orderDoc('20261022-8103', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
    orderDoc('20261022-8104', PICKED, { acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 1000) }),
    orderDoc('20261022-8105', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
    orderDoc('20261022-8106', SUBMITTED)
  ]);
  const api = apiOf(db, P1);
  const calls = [
    ['order.accept', { orderNo: '20261022-8101' }],
    ['order.reject', { orderNo: '20261022-8102', reason: 'TOO_BUSY' }],
    ['order.markPicked', { orderNo: '20261022-8103' }],
    ['order.markDelivered', { orderNo: '20261022-8104' }],
    ['order.reportException', { orderNo: '20261022-8105', code: 'OTHER', text: '兼职已停用' }],
    ['order.correct', { orderNo: '20261022-8106', patch: { pickupCode: 'B12345' } }]
  ];
  const codes = [];
  for (let i = 0; i < calls.length; i += 1) {
    const res = await api.call(calls[i][0], calls[i][1], { clientRequestId: nextCrid('closed-' + i) });
    codes.push(res.code);
  }
  return { db, codes };
}

function actionNameOfKey(key) {
  const map = {
    accept: 'order.accept', reject: 'order.reject', pick: 'order.markPicked', deliver: 'order.markDelivered',
    undoPick: 'order.undo', undoDeliver: 'order.undo', exception: 'order.reportException',
    resolve: 'order.resolveException', correct: 'order.correct', cancel: 'order.cancel'
  };
  return map[key] || '';
}

// ---------------------------------------------------------------- 导出（主套件解构使用）
module.exports = {
  EXPECTED_ASSERTIONS,
  ALL_COLLECTION_NAMES,
  NOW,
  HOUR,
  DAY,
  C1,
  P1,
  PID1,
  C2,
  P2,
  PID2,
  TEST_C,
  TEST_P,
  TEST_PID,
  TEMP_URL,
  CODE_FILLED_NOTE,
  COUNTS_KEYS,
  DTO_ROW_KEYS,
  DTO_BANNED_KEYS,
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
  ROOT,
  API,
  ORDERS_DIR,
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
  orderDoc,
  world,
  eventsFor,
  allEventsOf,
  rowsOf,
  rowOf,
  versionsOf,
  pickRow,
  actionKeysOf,
  collectKeyPaths,
  expectCode,
  expectField,
  errorCodeOf,
  handlerFiles,
  relOf,
  closedPartnerMatrix,
  actionNameOfKey
};
