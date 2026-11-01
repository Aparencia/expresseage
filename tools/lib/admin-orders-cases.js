'use strict';
/**
 * tools/lib/admin-orders-cases.js — 后台「订单行用户称呼」用例（批 20-F）：
 *   服务端：admin.listOrders 行内 customerDisplayName/partnerDisplayName（按本页批量取名、maskedName 脱敏、
 *           代客单 guest 快照兜底、无归属留空、零完整昵称/内部键、单页查询预算不随行数增长、游标第二页同样带称呼）；
 *   端侧：订单总览/后台消息异常单的「顾客：称呼（编号）」「兼职：称呼（编号）」展示（缺侧省略、不裸拼编号）。
 * 非独立套件：serverChecks 由 selftest-cloud 注册，clientChecks 由 selftest-admin-pages 注册。
 * 拆出原因：门禁 #18 测试文件 ≤1000 行，两个套件都已在上限附近；断言数合并计入各自 EXPECTED_ASSERTIONS。
 *
 * 口径：DATA_MODEL §5.2/§7.7（admin 列表行脱敏投影）、UX_DEVELOPER §3.3/§3.6/§3.10。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const { createTestDb } = require('../selftest-cloud-fixtures');
const app = require(path.join(API, 'app.js'));
const ordersVm = require(path.join(ROOT, 'pkg-admin/pages/orders/parts/view-model.js'));
const messagesVm = require(path.join(ROOT, 'pkg-admin/pages/messages/parts/view-model.js'));

const NOW = Date.parse('2026-10-21T12:00:00+08:00');
const HOUR = 60 * 60 * 1000;
const ADMIN_OPENID = 'openid-admin-dev01';
const ADMIN_ENV = { ADMIN_OPENIDS: JSON.stringify({ [ADMIN_OPENID]: 'DEV-01' }) };

// 行内内部键（称呼来自批量取名，但列表行本身不得透出这些内部标识）
const SENSITIVE_ROW_KEYS = ['_id', 'openid', 'customerId', 'customerOpenid', 'partnerId',
  'partnerOpenid', 'requestKey'];

function orderDoc(orderNo, extra) {
  return Object.assign({
    orderNo: orderNo,
    requestKey: 'orders-cases:' + orderNo,
    status: 'SUBMITTED',
    source: 'CUSTOMER',
    isTest: false,
    version: 1,
    statusUpdatedAt: new Date(NOW - HOUR),
    createdAt: new Date(NOW - 2 * HOUR),
    dorm: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522' },
    service: { code: 'PICKUP_STD', name: '标准代取' },
    parcels: [{ itemIndex: 0, stationId: 'P1', pickupCode: 'A9999', codeStatus: 'OK' }]
  }, extra || {});
}

// 4 张单覆盖四类边界：正常（双方都在）、代客（无 customerId，只有 guest 快照）、无归属（用户已删）、
// 异常（消息页数据源）。raw 文档故意带内部键，供「正控」证明下面的零泄漏扫描有牙。
function world() {
  const db = createTestDb();
  db.seed('customers', [{
    _id: 'openid-c1', customerNo: 'CABCDEFGH', displayName: '张小三', profileCompleted: true,
    zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522'
  }]);
  db.seed('partners', [{
    _id: 'partner-1', openid: 'openid-p1', partnerNo: 'PABC234', displayName: '李大四',
    status: 'ACTIVE', serviceConfig: { acceptingOrders: true }
  }]);
  db.seed('orders', [
    orderDoc('20261021-2001', {
      _id: 'order-name-1', customerId: 'openid-c1', customerOpenid: 'openid-c1', customerNo: 'CABCDEFGH',
      partnerId: 'partner-1', partnerOpenid: 'openid-p1', partnerNo: 'PABC234',
      statusUpdatedAt: new Date(NOW)
    }),
    orderDoc('20261021-2002', {
      _id: 'order-name-2', customerId: '', customerNo: '', source: 'PARTNER',
      partnerId: 'partner-1', partnerOpenid: 'openid-p1', partnerNo: 'PABC234',
      guest: { displayName: '王五五', phoneTail: '5678', dormKey: 'D4-522' },
      statusUpdatedAt: new Date(NOW - HOUR)
    }),
    orderDoc('20261021-2003', {
      _id: 'order-name-3', customerId: 'openid-gone', customerNo: 'CZZZZZZZ',
      partnerId: 'partner-gone', partnerNo: 'PZZZZZZ',
      statusUpdatedAt: new Date(NOW - 2 * HOUR)
    }),
    orderDoc('20261021-2004', {
      _id: 'order-name-4', customerId: 'openid-c1', customerNo: 'CABCDEFGH',
      partnerId: 'partner-1', partnerNo: 'PABC234', status: 'EXCEPTION',
      exception: { code: 'PARTNER_OFF', text: '', codeText: '兼职账号已停用', fromStatus: 'ACCEPTED', at: new Date(NOW - 30 * 60 * 1000) },
      statusUpdatedAt: new Date(NOW - 3 * HOUR)
    })
  ]);
  return db;
}

function keysDeepOf(value, keys) {
  const hits = [];
  function walk(node) {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    Object.keys(node).forEach(function step(key) {
      if (keys.indexOf(key) >= 0) {
        hits.push(key);
      }
      walk(node[key]);
    });
  }
  walk(value);
  return hits;
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ── 服务端：admin.listOrders 行称呼 DTO ───────────────────────────────────────
async function serverChecks(t) {
  const db = world();
  const api = app.createApi({ db: db, now: function now() { return NOW; }, openid: ADMIN_OPENID, env: ADMIN_ENV });
  const page = await api.call('admin.listOrders', {});
  const byNo = {};
  page.data.list.forEach(function index(row) { byNo[row.orderNo] = row; });
  const namePairs = page.data.list.map(function pair(row) {
    return [row.orderNo, row.customerDisplayName, row.partnerDisplayName];
  });
  t.eq(namePairs, [
    ['20261021-2001', '张***', '李***'],
    ['20261021-2002', '王***', '李***'],
    ['20261021-2003', '', ''],
    ['20261021-2004', '张***', '李***']
  ], 'admin.listOrders 行称呼：正常单双方 maskedName 脱敏；代客单（无 customerId）顾客回退 guest 快照；'
    + '无归属（用户已删/取不到）留空，不编造称呼');
  t.eq(['张小三', '李大四', '王五五'].filter(function leaked(name) {
    return JSON.stringify(page.data).indexOf(name) >= 0;
  }), [], 'admin.listOrders 响应零完整昵称（列表行只出首字 + ***，完整称呼只留在只读视角）');
  t.eq(keysDeepOf(page.data, SENSITIVE_ROW_KEYS), [],
    'admin.listOrders 行递归零 _id/openid/customerId/partnerId/requestKey（取名不透内部键）');
  const rawOrder = db.dump('orders').filter(function find(row) { return row._id === 'order-name-1'; })[0] || {};
  t.eq(SENSITIVE_ROW_KEYS.filter(function has(key) {
    return Object.prototype.hasOwnProperty.call(rawOrder, key);
  }).sort(), ['_id', 'customerId', 'customerOpenid', 'partnerId', 'partnerOpenid', 'requestKey'],
  'admin.listOrders 正控：fake-db raw order 文档确实含内部键（上面的零泄漏扫描有牙，非空集）');
  const beforeOne = db.stats.reads;
  const tinyPage = await api.call('admin.listOrders', { limit: 1 });
  const tinyReads = db.stats.reads - beforeOne;
  const beforeAll = db.stats.reads;
  const fullPage = await api.call('admin.listOrders', { limit: 4 });
  const fullReads = db.stats.reads - beforeAll;
  t.check(tinyPage.data.list.length === 1 && fullPage.data.list.length === 4 && tinyReads === fullReads,
    'admin.listOrders 查询预算：1 行页与 4 行页查询次数相同（顾客/兼职按本页批量 in，无逐单 N+1）');
  const firstPage = await api.call('admin.listOrders', { limit: 2 });
  const secondPage = await api.call('admin.listOrders', { limit: 2, cursor: firstPage.data.nextCursor });
  t.eq(secondPage.data.list.map(function pair(row) {
    return [row.orderNo, row.customerDisplayName, row.partnerDisplayName];
  }), [['20261021-2003', '', ''], ['20261021-2004', '张***', '李***']],
  'admin.listOrders 游标第二页同样带称呼（取名在分页之后，不依赖首页/一次性全量）');
  const exceptions = await api.call('admin.listOrders', { status: 'EXCEPTION' });
  t.eq([exceptions.data.list.map(function no(row) { return row.orderNo; }),
    exceptions.data.list.map(function name(row) { return row.customerDisplayName + '/' + row.partnerDisplayName; })],
  [['20261021-2004'], ['张***/李***']],
  'admin.listOrders 异常筛选（后台消息页数据源）行内同样带双方脱敏称呼');
  t.eq([byNo['20261021-2002'].customerNo, byNo['20261021-2002'].partnerNo], ['', 'PABC234'],
    'admin.listOrders 代客单保留空顾客编号 + 兼职编号（UI 可只显示一侧，不补假编号）');
}

// ── 端侧：订单总览行的「称呼（编号）」展示 ───────────────────────────────────
function ordersClientChecks(t) {
  const row = ordersVm.decorateRow({
    orderNo: '20261021-2001', customerNo: 'CABCDEFGH', customerDisplayName: '张***',
    partnerNo: 'PABC234', partnerDisplayName: '李***'
  });
  t.eq([row.customerText, row.partnerText], ['张***（CABCDEFGH）', '李***（PABC234）'],
    '订单总览行：顾客/兼职显示「称呼（编号）」');
  const onlyNo = ordersVm.decorateRow({ customerNo: 'CABCDEFGH' });
  const onlyName = ordersVm.decorateRow({ partnerDisplayName: '李***' });
  const bare = ordersVm.decorateRow({});
  t.eq([onlyNo.customerText, onlyName.partnerText, bare.customerText, bare.partnerText],
    ['CABCDEFGH', '李***', '', ''],
    '订单总览行：缺称呼时只显示编号、缺编号时只显示称呼、都没有则空串（行内省略）');
  const ordersWxml = readText('pkg-admin/pages/orders/index.wxml');
  t.eq([
    ordersWxml.indexOf('顾客：{{item.customerText}}') >= 0,
    ordersWxml.indexOf('兼职：{{item.partnerText}}') >= 0,
    ordersWxml.indexOf('item.partnerNo') < 0
  ], [true, true, true], '订单总览 WXML：渲染顾客/兼职称呼行；异常行不再裸拼 partnerNo（改由称呼行承担）');
}

// ── 端侧：后台消息异常单行的「称呼（编号）」展示 ─────────────────────────────
function messagesClientChecks(t) {
  const messageRow = messagesVm.decorateOrder({
    orderNo: '20261021-2004', customerNo: 'CABCDEFGH', customerDisplayName: '张***',
    partnerNo: 'PABC234', partnerDisplayName: '李***',
    exception: { codeText: '兼职账号已停用', reportedAt: NOW }
  });
  t.eq([messageRow.customerText, messageRow.partnerText, messageRow.exceptionText],
    ['张***（CABCDEFGH）', '李***（PABC234）', '兼职账号已停用'],
    '后台消息异常单：顾客/兼职称呼与中文异常说明并列展示');
  t.eq([
    messagesVm.decorateOrder({}).customerText,
    messagesVm.decorateOrder({ partnerNo: 'PABC234' }).partnerText
  ], ['', 'PABC234'], '后台消息异常单：无称呼留空省略、只有编号时只显示编号');
  const messagesWxml = readText('pkg-admin/pages/messages/index.wxml');
  t.eq([
    messagesWxml.indexOf('顾客：{{item.customerText}}') >= 0,
    messagesWxml.indexOf('兼职：{{item.partnerText}}') >= 0,
    messagesWxml.indexOf('item.partnerNo') < 0
  ], [true, true, true], '后台消息 WXML：异常单渲染顾客/兼职称呼行，不再裸拼 partnerNo');
}

const SERVER_ASSERTIONS = 8;
const CLIENT_ASSERTIONS = 6;
const EXPECTED_ASSERTIONS = SERVER_ASSERTIONS + CLIENT_ASSERTIONS;

module.exports = {
  SERVER_ASSERTIONS,
  CLIENT_ASSERTIONS,
  EXPECTED_ASSERTIONS,
  serverChecks,
  ordersClientChecks,
  messagesClientChecks
};
