'use strict';
/**
 * tools/lib/order-server-cases.js — selftest-order 的 fake DB/api 装配、文档种子与断言助手（拆分子文件）。
 *
 * 为什么拆：门禁 #18「tools 单文件 ≤1000 行」——selftest-order.js 已满闸；D47 预约「最晚可接受时间」
 *   需在同一套件继续加断言，故把装配/种子/助手整体下沉到本文件，主套件只保留 A~H 断言段落。
 * 口径：期望值逐字来自 docs/contract/V4_CONTRACT.md §4.2/§5.2、docs/data/V4_DATA_MODEL.md §2.5/§4.5、
 *   docs/engineering/V4_ENGINEERING.md §6.3 ADR（fake DB 注入、不 mock 全局 wx），不从生产实现抄值。
 */
const fs = require('fs');
const path = require('path');
const fsutil = require('./fsutil');
const { createFakeDb } = require('../fake-db');

const ROOT = path.resolve(__dirname, '../..');
const API = path.join(ROOT, 'cloudfunctions/api');

const app = require(path.join(API, 'app.js'));
const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const enums = require(path.join(API, 'shared/enums.js'));
const stations = require(path.join(API, 'shared/stations.js'));
const orderState = require(path.join(API, 'shared/order-state.js'));

const { ROLES, USER_STATUS, PARTNER_STATUS, BINDING_STATUS, ORDER_STATUS, SERVICE_CODES, UPLOAD_PURPOSE } = enums;
const NOW = Date.parse('2026-10-22T10:00:00+08:00');
const DAY_KEY = '20261022';
const ORDER_NO_RE = /^\d{8}-\d{4}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;


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
    counters: [['key']],
    admin_audit: [['requestKey']],
    admin_view_sessions: [['requestKey']],
    upload_tickets: [['ticket']],
    recognition_failures: [['failureNo'], ['requestKey']]
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
    getTempFileURL: async (input) => ({ fileList: (input.fileList || []).map((f) => ({ fileID: f.fileID, tempFileURL: 'https://tmp.example/x', status: 0 })) }),
    deleteFile: async () => ({ fileList: [] })
  };
}

function apiOf(db, openid, cloud) {
  return app.createApi({ db, now: () => NOW, openid, env: {}, cloud: cloud || cloudStub() });
}

// ---------------------------------------------------------------- 文档种子
function userDoc(id, roles, extra) {
  return Object.assign({
    _id: id, roles: roles || [], status: USER_STATUS.ACTIVE, isTestAccount: false, createdByDeveloperNo: '',
    privacyConsent: null, messageReadAt: 0, deletionRequestedAt: 0, createdAt: NOW, updatedAt: NOW
  }, extra || {});
}

function customerDoc(id, extra) {
  return Object.assign({
    _id: id, customerNo: 'CABCDEFGH', displayName: '小王', phoneTail: '1234',
    zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', profileCompleted: true,
    avatarFileId: '', createdAt: NOW, updatedAt: NOW
  }, extra || {});
}

function serviceConfigOf(extra) {
  return Object.assign({
    services: SERVICE_CODES.map((code) => ({ code, enabled: true })),
    zones: ['D', 'X', 'N', 'B', 'C'],
    acceptingOrders: true
  }, extra || {});
}

function partnerDoc(id, openid, partnerNo, extra) {
  return Object.assign({
    _id: id, openid, partnerNo, displayName: '小李', status: PARTNER_STATUS.ACTIVE,
    avatarFileId: '', serviceConfig: serviceConfigOf(), stats: {}, createdAt: NOW, updatedAt: NOW
  }, extra || {});
}

function bindingDoc(id, customerId, partnerId, extra) {
  const opts = extra || {};
  return Object.assign({
    _id: id, activeKey: customerId, customerId, partnerId, status: BINDING_STATUS.ACTIVE,
    roomTag: 'A', allocSeq: 1, tagKey: partnerId + ':D4-522:A',
    dormSnapshot: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4' },
    partnerNote: '', boundAt: NOW, updatedAt: NOW, releasedAt: null, releaseReason: '', releaseNote: '', releasedBy: ''
  }, opts);
}

// 顾客世界：users/customers/partners/bindings 四件套；可选测试/停用/无绑定等变体
function seedWorld(options) {
  const opt = options || {};
  const db = opt.db || createTestDb();
  const cOpenid = opt.customerOpenid || 'openid-oc-c';
  const pOpenid = opt.partnerOpenid || 'openid-oc-p';
  const pId = opt.partnerId || 'partner-oc';
  const cNo = opt.customerNo || 'CABCDEFGH';
  db.seed('users', [
    userDoc(cOpenid, opt.customerRoles || [ROLES.CUSTOMER], { isTestAccount: opt.customerIsTest === true }),
    userDoc(pOpenid, opt.partnerRoles || [ROLES.PARTNER], { isTestAccount: opt.partnerIsTest === true })
  ].concat(opt.extraUsers || []));
  db.seed('customers', [customerDoc(cOpenid, Object.assign({ customerNo: cNo }, opt.customer || {}))]);
  const partner = partnerDoc(pId, pOpenid, opt.partnerNo || 'PABC234', opt.partner || {});
  db.seed('partners', [partner]);
  if (opt.binding !== false) {
    db.seed('bindings', [bindingDoc(opt.bindingId || 'binding-oc', cOpenid, pId, opt.binding || {})]);
  }
  return { db, customerOpenid: cOpenid, partnerOpenid: pOpenid, partnerId: pId, partner, customerNo: cNo };
}

// ---------------------------------------------------------------- 入参构造
let CRID_SEQ = 0;
function nextCrid(tag) {
  CRID_SEQ += 1;
  return 'oc-' + (tag || 'x') + '-' + String(CRID_SEQ).padStart(12, '0');
}

function parcelOf(extra) {
  return Object.assign({ stationId: 'P3', pickupCode: 'A12345', lockerNo: 'B-01', trackingTail: '12345' }, extra || {});
}

function createPayload(extra) {
  const opt = Object.assign({ parcel: parcelOf(), serviceCode: 'PICKUP_STD', appoint: { type: 'ASAP' }, note: '放门口' }, extra || {});
  const payload = Object.assign({}, opt);
  const parcel = payload.parcel === undefined ? parcelOf() : payload.parcel;
  delete payload.parcel;
  payload.parcels = payload.parcels || [{ parcel }];
  return payload;
}

let TICKET_SEQ = 0;
function seedTicket(db, openid, extra) {
  TICKET_SEQ += 1;
  const ticket = 'T' + String(TICKET_SEQ).padStart(31, '0');
  const doc = Object.assign({
    ticket, openid, purpose: UPLOAD_PURPOSE.TICKET, cloudPath: 'orders/' + ticket + '/image.jpg',
    draftId: 'DRAFT0000000000000001', size: 1024, contentType: '', expiresAt: NOW + 5 * 60 * 1000,
    usedAt: null, createdAt: new Date(NOW)
  }, extra || {});
  db.seed('upload_tickets', [doc]);
  return doc;
}

function parcelsOf(order) {
  const list = order && Array.isArray(order.parcels) ? order.parcels : [];
  if (list.length > 0) return list;
  return order && order.parcel ? [order.parcel] : [];
}
function parcel0(order) {
  return parcelsOf(order)[0] || {};
}
function imagesOf(order) {
  const list = order && Array.isArray(order.images) ? order.images : [];
  if (list.length > 0) return list;
  return order && order.image ? [order.image] : [];
}
function imageOf(ticket, extra) {
  return Object.assign({ fileId: 'cloud://env.bucket/' + ticket.cloudPath, width: 800, height: 1200, size: 1024 }, extra || {});
}

let FAIL_SEQ = 0;
function failureNoOf() {
  FAIL_SEQ += 1;
  return 'F-' + DAY_KEY + '-' + String(FAIL_SEQ).padStart(6, '2').replace(/0/g, 'A').replace(/1/g, 'B');
}

function seedFailure(db, openid, extra) {
  const failureNo = (extra && extra.failureNo) || failureNoOf();
  const doc = Object.assign({
    _id: 'failure-' + failureNo,
    failureNo, requestKey: openid + ':ai-' + failureNo, failureCode: 'PARSE_MISS', sourceRole: 'CUSTOMER',
    uploaderOpenid: openid, uploadTicketId: '', fileId: '', orderId: '', ocrTextMasked: '',
    ruleResult: {}, aiTried: false, aiModel: '', aiResult: null, aiErrorCode: '',
    status: 'PENDING', retentionDays: 30, createdAt: new Date(NOW), reviewedAt: null
  }, extra || {});
  db.seed('recognition_failures', [doc]);
  return doc;
}

// ---------------------------------------------------------------- 断言小工具
function resField(res) {
  return res && res.data && res.data.field;
}

async function expectCode(t, resPromise, code, label) {
  const res = await resPromise;
  const ok = res && res.ok !== true && res.code === code;
  t.check(ok, label + '（实际 code=' + (res && res.code) + '）');
  return res;
}

async function expectField(t, resPromise, code, field, label) {
  const res = await resPromise;
  const ok = res && res.ok !== true && res.code === code && resField(res) === field;
  t.check(ok, label + '（实际 code=' + (res && res.code) + ', field=' + resField(res) + '）');
  return res;
}

function collectKeys(value, out) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) { value.forEach((item) => collectKeys(item, out)); return out; }
  Object.keys(value).forEach((key) => { out.add(key); collectKeys(value[key], out); });
  return out;
}

const DTO_FORBIDDEN_KEYS = ['_id', 'requestKey', 'customerOpenid', 'partnerOpenid', 'customerId', 'partnerId',
  'clientRequestId', 'batchActionId', 'cloudPath', 'claimTokenHash', 'isTest', 'impersonatedBy'];

function dtoLeaksOf(dto) {
  const keys = collectKeys(dto, new Set());
  return DTO_FORBIDDEN_KEYS.filter((key) => keys.has(key));
}

// ---------------------------------------------------------------- 直调 handler（绕中间件：只读视角/事务注入）
function handlerCtx(db, openid, extra) {
  const opts = extra || {};
  const realDao = createDao(db);
  const ctx = {
    dao: opts.dao || realDao,
    ids: app.bindIds(opts.dao || realDao, NOW),
    now: NOW,
    env: {},
    cloud: cloudStub(),
    openid,
    identity: Object.assign(app.baseIdentity(openid), opts.identity || {}),
    requestId: 'req-order-selftest',
    clientRequestId: opts.clientRequestId || nextCrid('handler'),
    expectedVersion: undefined,
    config: {}
  };
  return ctx;
}

// 小写集合键静态回归（口径同 selftest-bind-cloud §H：COLLECTIONS.<小写> 让 dao 抛未登记集合）
const LOWERCASE_COLLECTION_KEY_RE = /(^|[^A-Za-z0-9_$])COLLECTIONS\.([a-z][A-Za-z0-9_$]*)/;

function lowercaseCollectionKeyHitsInText(code) {
  const hits = [];
  String(code).split('\n').forEach((line, index) => {
    LOWERCASE_COLLECTION_KEY_RE.lastIndex = 0;
    const match = line.match(LOWERCASE_COLLECTION_KEY_RE);
    if (!match) return;
    if (match[2] === 'length' || match[2] === 'indexOf') return;
    hits.push(':' + (index + 1) + ': ' + line.trim());
  });
  return hits;
}

function listJs(dir, out) {
  const acc = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJs(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.js')) acc.push(full);
  });
  return acc;
}

function scanLowercaseKeys(fileList) {
  const hits = [];
  fileList.forEach((full) => {
    const code = fsutil.stripComments(fs.readFileSync(full, 'utf8'));
    lowercaseCollectionKeyHitsInText(code).forEach((hit) => hits.push(path.relative(ROOT, full).replace(/\\/g, '/') + hit));
  });
  return hits;
}

// ---------------------------------------------------------------- 分节装配（异步串行：sectionTitle 是全局的）
let serialQueue = Promise.resolve();
function serial(fn) {
  const run = serialQueue.then(fn);
  serialQueue = run.catch(() => {});
  return run;
}

module.exports = {
  fs: fs, path: path, fsutil: fsutil, ROOT: ROOT, API: API, app: app, createDao: createDao,
  COLLECTIONS: COLLECTIONS, enums: enums, stations: stations, orderState: orderState,
  ROLES: ROLES, USER_STATUS: USER_STATUS, PARTNER_STATUS: PARTNER_STATUS, BINDING_STATUS: BINDING_STATUS,
  ORDER_STATUS: ORDER_STATUS, SERVICE_CODES: SERVICE_CODES, UPLOAD_PURPOSE: UPLOAD_PURPOSE,
  NOW: NOW, DAY_KEY: DAY_KEY, ORDER_NO_RE: ORDER_NO_RE, CLIENT_ID_RE: CLIENT_ID_RE,
  ALL_COLLECTION_NAMES: ALL_COLLECTION_NAMES,
  uniqueIndexesForApi: uniqueIndexesForApi, createTestDb: createTestDb, cloudStub: cloudStub, apiOf: apiOf,
  userDoc: userDoc, customerDoc: customerDoc, serviceConfigOf: serviceConfigOf, partnerDoc: partnerDoc,
  bindingDoc: bindingDoc, seedWorld: seedWorld, nextCrid: nextCrid, parcelOf: parcelOf,
  createPayload: createPayload, seedTicket: seedTicket, parcelsOf: parcelsOf, parcel0: parcel0,
  imagesOf: imagesOf, imageOf: imageOf, failureNoOf: failureNoOf, seedFailure: seedFailure,
  resField: resField, expectCode: expectCode, expectField: expectField, collectKeys: collectKeys,
  dtoLeaksOf: dtoLeaksOf, handlerCtx: handlerCtx,
  lowercaseCollectionKeyHitsInText: lowercaseCollectionKeyHitsInText, listJs: listJs,
  scanLowercaseKeys: scanLowercaseKeys, serial: serial
};
