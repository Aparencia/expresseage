'use strict';
/**
 * tools/lib/order-flow-cases.js — selftest-order-flow 的夹具/样本/助手（拆分子文件）。
 *
 * 为什么拆：门禁 #18「tools 单文件 ≤1000 行」——selftest-order-flow.js 已满闸；把常量/样本、
 *   页面层扫描助手、I 组 fake DB 联调夹具与 P0-1/P1-10 用例桩下沉到本文件，主套件只保留 A~S 断言段落。
 * 非独立套件：由 tools/selftest-order-flow.js require 后解构使用（tools/lib 不参与 selftest 注册完整性闸）。
 * 口径：夹具形状 = 现行契约（docs/contract/V4_CONTRACT.md §4.3/§5.3、docs/data/V4_DATA_MODEL.md §2.5）；
 *      页面层/取件码等值域与服务端同源，不另抄一份。
 */
const fs = require('fs');
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '../..');
const model = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/model.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const { createFakeDb } = require('../fake-db');
const CLOUD_API = path.join(ROOT, 'cloudfunctions/api');
const app = require(path.join(CLOUD_API, 'app.js'));
const { COLLECTIONS } = require(path.join(CLOUD_API, 'shared/collections.js'));
const serverEnums = require(path.join(CLOUD_API, 'shared/enums.js'));

const ORDER_CREATE_PAGE = 'pkg-customer/pages/order-create/index.js';
const ORDER_CREATE_WXML = 'pkg-customer/pages/order-create/index.wxml';
const ORDER_MODEL = 'pkg-customer/pages/order-create/parts/model.js';
const PAGE_SCOPE = 'pkg-customer/pages/order-create/';
const STATUS_LITERALS = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
// 与云端 handlers/order/_parcel.js 同值域（客户端只透传/归一手填，不新增值）
const RECOGNITION_SOURCES = ['RULE', 'MANUAL', 'DEEPSEEK'];
const CONFIDENCE_VALUES = ['HIGH', 'MEDIUM', 'LOW'];

const TICKET = 'TK-ORDER-FLOW-0001';
const IMAGE = { fileId: 'cloud://test.env/orders/TKT/image.jpg', width: 1080, height: 1440, size: 320000 };

const ITEM_A = 'item-a';

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

function listJs(dirRel) {
  const out = [];
  const walk = (rel) => {
    fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).forEach((entry) => {
      const child = rel + '/' + entry.name;
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(child);
      }
    });
  };
  walk(dirRel);
  return out.sort();
}

function stationItem(extra) {
  return model.makeItem(Object.assign({ stationId: 'P3', pickupCode: 'A12345' }, extra || {}), {
    serviceCode: enums.SERVICE_CODES[0]
  });
}

// P0-1/P1-10 收口用例的页面实例桩：只提供 applyIdentify/runIdentify 消费的 data/setData/itemDefaults/onOcrPhase
function identifyPageOf() {
  return {
    data: { step: 1, ocrState: 'idle', files: [], perImage: [], images: [], tickets: [], items: [] },
    itemDefaults: function defaults() { return {}; },
    setData: function setData(patch) { Object.assign(this.data, patch); },
    onOcrPhase: function onOcrPhase(state) { this.data.ocrState = (state && state.phase) || this.data.ocrState; }
  };
}

// P0-1 多图夹具：第 seq 张截图（localPath/fileId/上传票据齐全）
function imageFileOf(seq) {
  return { localPath: 'wxfile://tmp/ticket-' + seq + '.jpg',
    fileId: 'cloud://test.env/orders/TKT/image-' + seq + '.jpg', uploadTicketId: 'TK-ORDER-FLOW-00' + seq };
}

// v1.0（D23）：order.create 单入口载荷：{parcels[], images[], tickets[], serviceCode, appoint, note, delivery?, manualEntry}
function payloadOf(items, options) {
  const opt = options || {};
  const images = opt.images === undefined ? [IMAGE] : opt.images;
  const tickets = opt.tickets === undefined ? (images.length ? [TICKET] : []) : opt.tickets;
  return model.buildPayload({
    items: items,
    images: images,
    tickets: tickets,
    serviceCode: opt.serviceCode === undefined ? enums.SERVICE_CODES[0] : opt.serviceCode,
    appoint: opt.appoint || { type: 'ASAP' },
    note: opt.note || '',
    delivery: opt.delivery || null
  });
}

// 页面层全文（页面 + parts）：v1.0 逻辑已拆到 parts/，静态断言需扫整条下单链路
function orderFlowSource() {
  return listJs(PAGE_SCOPE).map((rel) => textOf(rel)).join('\n');
}

// ── I 组联调夹具：fake DB + 真实 order handler（不连真云、不 mock wx）────────────
const IT_NOW = Date.parse('2026-10-22T12:00:00+08:00');
const IT_TICKET = 'TK-IT-SINGLE-0001';
const IT_IMAGE = { fileId: 'cloud://test.env/orders/TKT/image.jpg', width: 1080, height: 1440, size: 320000 };
const IT_TICKET_BATCH = 'TK-IT-BATCH-0001';
const IT_IMAGE_BATCH = { fileId: 'cloud://test.env/orders/BTCH/image.jpg', width: 1080, height: 1440, size: 300000 };

function ticketDoc(ticketId, cloudPath) {
  return {
    _id: 'upload-' + ticketId, ticket: ticketId, openid: 'openid-it-c', cloudPath: cloudPath,
    purpose: serverEnums.UPLOAD_PURPOSE.TICKET, draftId: 'draft-it',
    createdAt: IT_NOW, expiresAt: IT_NOW + 3600000, usedAt: 0
  };
}

function uniqueIndexesForApi() {
  return {
    users: [['_id']],
    customers: [['customerNo'], ['_id']],
    partners: [['openid'], ['partnerNo']],
    bindings: [['activeKey'], ['tagKey']],
    orders: [['orderNo'], ['requestKey']],
    order_events: [['requestKey']],
    order_messages: [['requestKey']],
    counters: [['key']],
    upload_tickets: [['ticket']],
    recognition_failures: [['failureNo'], ['requestKey']],
    config: [['key']]
  };
}

function createOrderDb() {
  const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
  Object.keys(COLLECTIONS).forEach((key) => db.seed(COLLECTIONS[key], []));
  db.seed('users', [
    { _id: 'openid-it-c', roles: ['CUSTOMER'], status: 'ACTIVE', isTestAccount: false, createdAt: IT_NOW, updatedAt: IT_NOW },
    { _id: 'openid-it-p', roles: ['PARTNER'], status: 'ACTIVE', isTestAccount: false, createdAt: IT_NOW, updatedAt: IT_NOW }
  ]);
  db.seed('customers', [{
    _id: 'openid-it-c', customerNo: 'CITFIXTUR', displayName: '小测', phoneTail: '1234',
    zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', profileCompleted: true,
    avatarFileId: '', createdAt: IT_NOW, updatedAt: IT_NOW
  }]);
  db.seed('partners', [{
    _id: 'partner-it', openid: 'openid-it-p', partnerNo: 'PITFIX1', displayName: '小兼',
    status: 'ACTIVE', avatarFileId: '', stats: {},
    serviceConfig: {
      services: [{ code: serverEnums.SERVICE_CODES[0], enabled: true },
        { code: serverEnums.SERVICE_CODES[1], enabled: true }],
      zones: ['D', 'X', 'N', 'B', 'C'],
      acceptingOrders: true
    },
    createdAt: IT_NOW, updatedAt: IT_NOW
  }]);
  db.seed('bindings', [{
    _id: 'binding-it', activeKey: 'openid-it-c', customerId: 'openid-it-c', partnerId: 'partner-it',
    status: 'ACTIVE', roomTag: 'A', allocSeq: 1, tagKey: 'partner-it:D4-522:A',
    dormSnapshot: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4' },
    partnerNote: '', boundAt: IT_NOW, updatedAt: IT_NOW,
    releasedAt: null, releaseReason: '', releaseNote: '', releasedBy: ''
  }]);
  db.seed('upload_tickets', [
    ticketDoc(IT_TICKET, 'orders/TKT/image.jpg'),
    ticketDoc(IT_TICKET_BATCH, 'orders/BTCH/image.jpg')
  ]);
  return db;
}

function orderApiOf(db) {
  return app.createApi({ db: db, now: () => IT_NOW, openid: 'openid-it-c', env: {}, cloud: {} });
}

// 有牙扫描（G 组）：同一函数既扫真实页面层，也接受合成样本做正控/反例
function pageLayerHits(code) {
  const hits = [];
  const src = fsutil.stripComments(String(code || ''));
  if (/wx\.cloud\./.test(src)) hits.push('wx.cloud.*');
  if (/(^|[^.\w])fetch\s*\(/.test(src)) hits.push('fetch(');
  if (/Math\.random|\brandom\(/.test(src)) hits.push('random');
  STATUS_LITERALS.forEach((status) => {
    if (new RegExp("['\"]" + status + "['\"]").test(src)) hits.push('状态字面量 ' + status);
  });
  if (/['"]order\.(create|createBatch)['"]/.test(src)) hits.push('自拼 action 名 order.create');
  return hits;
}

module.exports = {
  ORDER_CREATE_PAGE, ORDER_CREATE_WXML, ORDER_MODEL, PAGE_SCOPE, RECOGNITION_SOURCES,
  CONFIDENCE_VALUES, TICKET, IMAGE, IT_TICKET, IT_IMAGE, IT_TICKET_BATCH, IT_IMAGE_BATCH,
  textOf, listJs, stationItem, identifyPageOf, imageFileOf, payloadOf, orderFlowSource,
  createOrderDb, orderApiOf, pageLayerHits
};
