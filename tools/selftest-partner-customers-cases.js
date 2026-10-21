'use strict';
/**
 * tools/selftest-partner-customers-cases.js — 批 7-A「兼职客户档案/统计」云端侧套件的夹具/期望值。
 *
 * 为什么拆：门禁 #18 要求 tools/*.js 单文件 ≤1000 行；本文件承担 fake DB 装配、文档种子、DTO 白名单与
 * 通用断言助手，主套件只保留 A~F 断言段落（同样 ≤1000 行）。
 * 口径：docs/V4_DATA_MODEL.md §7.4 表格 + 「批 7 兼职客户与运营（只增不改语义）」、§4.5/§5.2/§5.3/§6.6、
 *       §2.3/§2.4/§2.5；docs/V4_CONTRACT.md §9；docs/V4_UX_PARTNER.md §3.5/§3.6/§3.8/§7/§9。
 * 期望值逐字来自文档，不从生产实现抄值（防同源恒真）；时间点全部相对固定 NOW 推导。
 */
const path = require('path');
const fs = require('fs');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const PARTNER_DIR = path.join(API, 'handlers/partner');
const app = require(path.join(API, 'app.js'));
const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const enums = require(path.join(API, 'shared/enums.js'));

const { ROLES, PARTNER_STATUS, ORDER_STATUS, VIEW_MODE, CODE_STATUS, USER_STATUS } = enums;
const { SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED, CANCELLED, EXCEPTION } = ORDER_STATUS;

// 断言总数（精确相等；改断言必须同步改此数字，少算/多算都判红）。
const EXPECTED_ASSERTIONS = 129;

const NOW = Date.parse('2026-10-22T10:00:00+08:00'); // 上海时间 2026-10-22（周四）10:00
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const TODAY_START = NOW - 10 * HOUR; // 上海自然日 00:00
const YESTERDAY_START = TODAY_START - DAY;
const WEEK_START = Date.parse('2026-10-19T00:00:00+08:00'); // 周一起
const MONTH_START = Date.parse('2026-10-01T00:00:00+08:00');

// 账号与主键（真实 + 测试两侧；测试账号合成 openid 与 users._id 同值）
const C1 = 'openid-b7-c1';
const C2 = 'openid-b7-c2';
const C3 = 'openid-b7-c3';
const C4 = 'openid-b7-c4';
const C5 = 'openid-b7-c5';
const C6 = 'openid-b7-c6';
const C7 = 'openid-b7-c7';
const P1 = 'openid-b7-p1';
const PID1 = 'partner-b7-1';
const P2 = 'openid-b7-p2';
const PID2 = 'partner-b7-2';
const TEST_C = 'TEST-b7-customer';
const TEST_P = 'TEST-b7-partner';
const TEST_PID = 'partner-b7-test';
const B1 = 'bind-b7-1';
const B2 = 'bind-b7-2';
const B3 = 'bind-b7-3';
const B4 = 'bind-b7-4';
const B5 = 'bind-b7-5';
const B6 = 'bind-b7-6';
const B7 = 'bind-b7-7';
const BT = 'bind-b7-test';

// 客户档案行顶层键白名单（多一个=可能泄漏 raw 文档字段；avatarFileId 仅 ACTIVE 绑定且有头像时下发）
const BINDING_ROW_KEYS = [
  'bindingId', 'customerNo', 'dormKey', 'buildingText', 'roomTag', 'displayName',
  'phoneTail', 'partnerNote', 'boundAt', 'activeOrderCount', 'avatarFileId'
];
// 客户详情订单行：DATA_MODEL §7.4 明确只含 orderNo/status/statusText/serviceName/时间戳（可选时间戳按需出现）
const ORDER_ROW_KEYS = ['orderNo', 'status', 'statusText', 'serviceName', 'createdAt',
  'deliveredAt', 'completedAt', 'cancelledAt'];
// 内部键一律不得出现在任何客户域 DTO（openid/主键/幂等键/票据/存储路径）
const DTO_BANNED_KEYS = [
  '_id', 'id', 'openid', 'customerId', 'customerOpenid', 'partnerId', 'partnerOpenid',
  'clientRequestId', 'requestKey', 'activeKey', 'tagKey', 'allocSeq', 'cloudPath', 'fileId',
  'batchActionId', 'impersonatedBy', 'isTest', 'exception', 'parcel', 'pickupCode', 'lockerNo',
  'trackingTail', 'actions', 'counterpart', 'version'
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
      fileList: (input.fileList || []).map((file) => ({ fileID: file.fileID, tempFileURL: 'https://tmp.example/b7', status: 0 }))
    }),
    deleteFile: async () => ({ fileList: [] })
  };
}

function apiOf(db, openid) {
  return app.createApi({ db, now: () => NOW, openid, env: {}, cloud: cloudStub() });
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
    requestId: 'req-partner-b7',
    clientRequestId: nextCrid('handler'),
    expectedVersion: undefined,
    config: {}
  };
}

let CRID_SEQ = 0;
function nextCrid(tag) {
  CRID_SEQ += 1;
  let tagText = String(tag || 'x').replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
  while (tagText.length < 6) {
    tagText += 'x';
  }
  return 'b7-' + String(CRID_SEQ).padStart(6, '0') + '-' + tagText;
}

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
    _id: id, openid, partnerNo, displayName: '阿杰', avatarFileId: '',
    status: PARTNER_STATUS.ACTIVE, deletedAt: null,
    serviceConfig: { services: [{ code: 'PICKUP_STD', enabled: true }], zones: ['D'], acceptingOrders: true },
    stats: { totalOrders: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, todayOrders: 0, updatedAt: NOW },
    activatedAt: NOW - 30 * DAY, createdAt: NOW - 30 * DAY, updatedAt: NOW
  }, extra || {});
}

function bindingDoc(customerId, partnerId, id, extra) {
  const overrides = Object.assign({}, extra || {});
  const dormKey = overrides.dormKey || 'D4-522';
  const roomTag = overrides.roomTag || 'A';
  const allocSeq = overrides.allocSeq === undefined ? 1 : overrides.allocSeq;
  delete overrides.dormKey;
  delete overrides.roomTag;
  delete overrides.allocSeq;
  const parts = dormKey.split('-');
  const buildingText = parts[0];
  const room = parts[1];
  return Object.assign({
    _id: id, customerId, partnerId, status: enums.BINDING_STATUS.ACTIVE, activeKey: customerId,
    roomTag, allocSeq,
    dormSnapshot: { zone: buildingText.charAt(0), buildingNo: Number(buildingText.slice(1)), room, dormKey, buildingText },
    tagKey: partnerId + ':' + dormKey + ':' + roomTag,
    partnerNote: '', boundAt: NOW - 10 * DAY, updatedAt: NOW,
    releasedAt: null, releaseReason: '', releaseNote: '', releasedBy: ''
  }, overrides);
}

function orderDoc(orderNo, status, extra) {
  const overrides = Object.assign({}, extra || {});
  const base = {
    _id: 'o-' + orderNo, orderNo, requestKey: 'rk-' + orderNo,
    customerId: C1, customerOpenid: C1, customerNo: 'CABCDEFGH',
    partnerId: PID1, partnerOpenid: P1, partnerNo: 'PAAAAAA',
    source: 'CUSTOMER', isTest: false, status,
    parcel: {
      stationId: 'P1', stationName: 'P1 一号站', pickupCode: 'A12345', lockerNo: '', trackingTail: '',
      codeStatus: CODE_STATUS.OK
    },
    dorm: { zone: 'D', buildingNo: 4, room: '522', buildingText: 'D4', dormKey: 'D4-522', roomTag: 'A' },
    guest: null, phoneTail: '6678',
    service: { code: 'PICKUP_STD', name: '标准代取' }, appoint: { type: 'ASAP' },
    note: '', image: {}, exception: null, deliveryNote: '', cancelReason: '', cancelledBy: '',
    version: 2,
    statusUpdatedAt: new Date(NOW - 500), createdAt: new Date(NOW - 5000), updatedAt: new Date(NOW - 500),
    acceptedAt: null, pickedAt: null, deliveredAt: null, completedAt: null, cancelledAt: null
  };
  Object.keys(overrides).forEach((key) => {
    base[key] = overrides[key];
  });
  return base;
}

function world(options) {
  const opts = options || {};
  const db = createTestDb();
  db.seed('users', [
    userDoc(C1, [ROLES.CUSTOMER]), userDoc(C2, [ROLES.CUSTOMER]), userDoc(C3, [ROLES.CUSTOMER]),
    userDoc(C4, [ROLES.CUSTOMER]), userDoc(C5, [ROLES.CUSTOMER]), userDoc(C6, [ROLES.CUSTOMER]),
    userDoc(C7, [ROLES.CUSTOMER]), userDoc(P1, [ROLES.PARTNER]), userDoc(P2, [ROLES.PARTNER]),
    userDoc(TEST_C, [ROLES.CUSTOMER], { isTestAccount: true }),
    userDoc(TEST_P, [ROLES.PARTNER], { isTestAccount: true })
  ]);
  db.seed('customers', [
    customerDoc(C1, 'CADEFGHJK', {
      displayName: '小王', phoneTail: '6678', dormKey: 'D4-522',
      avatarFileId: 'cloud://avatar-c1.jpg'
    }),
    customerDoc(C2, 'CHIJKLMNP', { displayName: '小李', phoneTail: '1234', dormKey: 'D4-1002', room: '1002' }),
    customerDoc(C3, 'CPQRSTUVW', { displayName: '小张', phoneTail: '9999', zone: 'X', buildingNo: 2, dormKey: 'X2-301', room: '301' }),
    customerDoc(C4, 'CDEFGHJKL', { displayName: '小赵', phoneTail: '4321', buildingNo: 10, dormKey: 'D10-1001', room: '1001' }),
    customerDoc(C5, 'CJKLMNPQR', { displayName: '小陈', phoneTail: '5555', dormKey: 'D4-522' }),
    customerDoc(C6, 'CMNPQRSTU', { displayName: '小周', phoneTail: '6666', buildingNo: 5, dormKey: 'D5-101', room: '101' }),
    customerDoc(C7, 'CRSTUVWXY', { displayName: '小吴', phoneTail: '7777', dormKey: 'D4-700', room: '700' }),
    customerDoc(TEST_C, 'CTESTAAAA', { displayName: '测试顾客', phoneTail: '0000' })
  ]);
  db.seed('partners', [
    partnerDoc(P1, PID1, 'PAAAAAA', { status: opts.partnerStatus || PARTNER_STATUS.ACTIVE }),
    partnerDoc(P2, PID2, 'PBBBBBB'),
    partnerDoc(TEST_P, TEST_PID, 'PCCCCCC')
  ]);
  db.seed('bindings', [
    bindingDoc(C1, PID1, B1, { dormKey: 'D4-522', roomTag: 'A', allocSeq: 1 }),
    bindingDoc(C5, PID1, B2, { dormKey: 'D4-522', roomTag: 'B', allocSeq: 2 }),
    bindingDoc(C2, PID1, B3, { dormKey: 'D4-1002', roomTag: 'A', allocSeq: 1 }),
    bindingDoc(C4, PID1, B4, { dormKey: 'D10-1001', roomTag: 'A', allocSeq: 1 }),
    bindingDoc(C3, PID1, B5, { dormKey: 'X2-301', roomTag: 'A', allocSeq: 1 }),
    bindingDoc(C6, PID1, B6, {
      dormKey: 'D5-101', roomTag: 'A', allocSeq: 1, status: enums.BINDING_STATUS.RELEASED,
      activeKey: C6 + ':RELEASED:' + B6, releasedAt: new Date(NOW - 2 * DAY),
      releaseReason: 'PARTNER_INITIATED', releasedBy: enums.CANCELLED_BY.PARTNER
    }),
    bindingDoc(C7, PID2, B7, { dormKey: 'D4-700', roomTag: 'A', allocSeq: 1 }),
    bindingDoc(TEST_C, TEST_PID, BT, { dormKey: 'D4-522', roomTag: 'A', allocSeq: 1 })
  ]);
  if (opts.orders) {
    db.seed('orders', opts.orders);
  }
  return db;
}

// ---------------------------------------------------------------- 断言助手
// 列表取行：pickRow(list, value) 默认按 bindingId；pickRow(list, field, value) 指定字段。
function pickRow(list, fieldOrValue, maybeValue) {
  const byField = maybeValue !== undefined;
  const field = byField ? fieldOrValue : 'bindingId';
  const value = byField ? maybeValue : fieldOrValue;
  return (list || []).filter((row) => row && row[field] === value)[0] || null;
}

function rowsOf(db, collection) {
  return db.dump(collection);
}

function collectKeyPaths(value, banned, prefix, out) {
  const outList = out || [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKeyPaths(item, banned, (prefix || '') + '[' + index + ']', outList));
    return outList;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    Object.keys(value).forEach((key) => {
      const next = prefix ? prefix + '.' + key : key;
      if (banned.indexOf(key) >= 0) {
        outList.push(next);
      }
      collectKeyPaths(value[key], banned, next, outList);
    });
  }
  return outList;
}

// 统一错误形状：{code, field, message}（直调 handler 用；api.call 用 expectField/expectCode）
async function errorInfoOf(fn) {
  try {
    await fn();
    return { code: 'NO_ERROR', field: undefined, message: '' };
  } catch (error) {
    return {
      code: (error && error.code) || 'UNKNOWN',
      field: error && error.data ? error.data.field : undefined,
      message: (error && error.message) || ''
    };
  }
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

function jsonOf(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function handlerFiles() {
  return fs.readdirSync(PARTNER_DIR).filter((name) => name.slice(-3) === '.js')
    .map((name) => path.join(PARTNER_DIR, name));
}

function relOf(full) {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

module.exports = {
  EXPECTED_ASSERTIONS,
  NOW,
  HOUR,
  DAY,
  TODAY_START,
  YESTERDAY_START,
  WEEK_START,
  MONTH_START,
  C1,
  C2,
  C3,
  C4,
  C5,
  C6,
  C7,
  P1,
  PID1,
  P2,
  PID2,
  TEST_C,
  TEST_P,
  TEST_PID,
  B1,
  B2,
  B3,
  B4,
  B5,
  B6,
  B7,
  BT,
  BINDING_ROW_KEYS,
  ORDER_ROW_KEYS,
  DTO_BANNED_KEYS,
  ALL_COLLECTION_NAMES,
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
  PARTNER_DIR,
  uniqueIndexesForApi,
  createTestDb,
  cloudStub,
  apiOf,
  handlerCtxOf,
  nextCrid,
  userDoc,
  customerDoc,
  partnerDoc,
  bindingDoc,
  orderDoc,
  world,
  pickRow,
  rowsOf,
  collectKeyPaths,
  errorInfoOf,
  expectCode,
  expectField,
  jsonOf,
  handlerFiles,
  relOf
};
