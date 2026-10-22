'use strict';
/**
 * tools/selftest-cloud-dual.js — 双角色 openid（users.roles 同时含 CUSTOMER+PARTNER）端到端断言。
 *
 * 来源：代码审查 P1 M-01（R-A1-01「双角色 openid 角色解析为空 → 订单/消息/AI 全 FORBIDDEN」）。
 * 口径：ARCHITECTURE §4.1「双角色口径（Lead 冻结）」——服务端权限只看 users.roles 是否包含动作所需业务角色，
 *       不依赖客户端 activeRole；同一 openid 双角色时两类动作都允许；identity.role 按动作域解析。
 *
 * 覆盖：A) auth 动作域角色解析（含 ai.parseParcel 按入参 role 选定）；B) 双角色全链路（listCustomer/create/
 *       get 两侧/listPartner/accept/message.list 聚合/message.send fromRole/ai.parseParcel）；
 *       C) 单角色基线不回归（越权仍 FORBIDDEN）。
 *
 * 挂载：独立 register 形态套件，由 tools/selftest.js 的 SUITES 聚合运行（同 TD-029 拆分先例：
 *       selftest-cloud.js 已到 1000 行红线，故本文件独立成套）；也可独立运行 node tools/selftest-cloud-dual.js。
 * 纪律：fake DB 注入、不连真库、不 mock 全局 wx；断言数与 EXPECTED_ASSERTIONS 精确相等（少算/多算都判红）。
 */
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');
const { createTestDb, cloudStub } = require('./selftest-cloud-fixtures');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const app = require(path.join(API, 'app.js'));
const { createDao } = require(path.join(API, 'db/dao.js'));
const { ROLES, USER_STATUS, ORDER_STATUS, PARTNER_STATUS, SERVICES } = require(path.join(API, 'shared/enums.js'));
const auth = require(path.join(API, 'middleware/auth.js'));

const NOW = Date.parse('2026-10-21T12:00:00+08:00');
const DUAL = 'openid-dual';
const DUAL_PARTNER_ID = 'partner-dual';
const PARTNER_ORDER_NO = '20261021-0007';
const PLAIN_PARTNER_ORDER_NO = '20261021-0008';
const SERVICE_CODES = SERVICES.map((item) => item.code);

const EXPECTED_ASSERTIONS = 36;

function serviceConfigOf(extra) {
  return Object.assign({
    services: SERVICE_CODES.map((code) => ({ code, enabled: true })),
    zones: ['D', 'X', 'N', 'B', 'C'],
    acceptingOrders: true
  }, extra || {});
}

function userDoc(id, roles, extra) {
  return Object.assign({
    _id: id,
    roles: roles || [],
    status: USER_STATUS.ACTIVE,
    isTestAccount: false,
    privacyConsent: { version: 'v4.0', at: NOW }
  }, extra || {});
}

function customerDoc(id, customerNo, extra) {
  return Object.assign({
    _id: id,
    customerNo,
    displayName: '小王',
    phoneTail: '1234',
    zone: 'D',
    buildingNo: 4,
    room: '522',
    dormKey: 'D4-522',
    profileCompleted: true
  }, extra || {});
}

function partnerDoc(id, openid, partnerNo, extra) {
  return Object.assign({
    _id: id,
    openid,
    partnerNo,
    displayName: '小双',
    status: PARTNER_STATUS.ACTIVE,
    serviceConfig: serviceConfigOf()
  }, extra || {});
}

// 双角色账号：本人既有 customers 行（顾客侧），也有 partners 行（兼职侧）；顾客侧绑定到另一个兼职（禁止自绑）。
// 三个单角色账号用于「不回归」基线。
function seedDb() {
  const db = createTestDb();
  db.seed('users', [
    userDoc(DUAL, [ROLES.CUSTOMER, ROLES.PARTNER]),
    userDoc('openid-plain-customer', [ROLES.CUSTOMER]),
    userDoc('openid-plain-partner', [ROLES.PARTNER]),
    userDoc('openid-other-partner', [ROLES.PARTNER]),
    userDoc('openid-bound-c', [ROLES.CUSTOMER])
  ]);
  db.seed('customers', [
    customerDoc(DUAL, 'CABCDEFGH'),
    customerDoc('openid-plain-customer', 'CABCDEFGJ', { room: '523', dormKey: 'D4-523', displayName: '小李' }),
    customerDoc('openid-bound-c', 'CABCDEFGK', { room: '524', dormKey: 'D4-524', displayName: '小周' })
  ]);
  db.seed('partners', [
    partnerDoc(DUAL_PARTNER_ID, DUAL, 'PABC23'),
    partnerDoc('partner-other', 'openid-other-partner', 'PABC234', { displayName: '小张' }),
    partnerDoc('partner-plain', 'openid-plain-partner', 'PABC235', { displayName: '小刘' })
  ]);
  db.seed('bindings', [
    { _id: 'binding-dual', activeKey: DUAL, customerId: DUAL, partnerId: 'partner-other', status: 'ACTIVE', roomTag: 'A', dormSnapshot: { dormKey: 'D4-522' } },
    { _id: 'binding-bound', activeKey: 'openid-bound-c', customerId: 'openid-bound-c', partnerId: DUAL_PARTNER_ID, status: 'ACTIVE', roomTag: 'B', dormSnapshot: { dormKey: 'D4-524' } },
    { _id: 'binding-plain-c', activeKey: 'openid-plain-customer', customerId: 'openid-plain-customer', partnerId: 'partner-plain', status: 'ACTIVE', roomTag: 'A', dormSnapshot: { dormKey: 'D4-523' } }
  ]);
  const orderSeed = (id, orderNo, requestKey, overrides) => Object.assign({
    _id: id,
    orderNo,
    requestKey,
    customerId: 'openid-plain-customer',
    customerOpenid: 'openid-plain-customer',
    customerNo: 'CABCDEFGJ',
    partnerId: DUAL_PARTNER_ID,
    partnerOpenid: DUAL,
    partnerNo: 'PABC23',
    source: 'CUSTOMER',
    isTest: false,
    status: ORDER_STATUS.SUBMITTED,
    statusUpdatedAt: NOW,
    createdAt: NOW,
    version: 1,
    parcel: { stationId: 'P3', pickupCode: 'A123' }
  }, overrides || {});
  db.seed('orders', [
    orderSeed('order-dual-partner', PARTNER_ORDER_NO, DUAL + ':seed-partner-1'),
    orderSeed('order-plain-partner', PLAIN_PARTNER_ORDER_NO, 'openid-plain-partner:seed-1', {
      partnerId: 'partner-plain', partnerOpenid: 'openid-plain-partner', partnerNo: 'PABC235'
    })
  ]);
  return db;
}

function apiOf(db, openid) {
  return app.createApi({ db, now: () => NOW, openid, env: {}, cloud: cloudStub('pass') });
}

// v1.0 单入口 payload：无截图手填（manualEntry=true，包裹不带 imageIndex）
function createPayload(extra) {
  return Object.assign({
    parcels: [{ parcel: { stationId: 'P3', pickupCode: 'A12345', lockerNo: 'B-01', trackingTail: '12345' } }],
    serviceCode: 'PICKUP_STD',
    appoint: { type: 'ASAP' },
    manualEntry: true
  }, extra || {});
}

function guestOf() {
  return { displayName: '代客小王', phoneTail: '5678', zone: 'D', buildingNo: 4, room: '522' };
}

// auth 中间件直调：返回本次动作解析出的 identity（roles 归一 + role 按动作域）。
async function identityOfAction(action, payload, openid, roles) {
  const db = createTestDb();
  db.seed('users', [userDoc(openid, roles || [])]);
  const ctx = {
    dao: createDao(db),
    ids: {},
    now: NOW,
    env: {},
    cloud: {},
    openid,
    identity: app.baseIdentity(openid),
    requestId: 'req-dual-selftest',
    clientRequestId: '',
    expectedVersion: undefined,
    config: {}
  };
  const state = {
    action,
    payload: payload || {},
    ctx,
    meta: { spec: { visibility: 'client', write: false }, configSeeded: false, requestId: 'req-dual-selftest' }
  };
  await auth.middleware(state);
  return { role: ctx.identity.role, roles: ctx.identity.roles };
}

function keysOfActions(dto) {
  return (dto && Array.isArray(dto.actions) ? dto.actions : []).map((item) => item.key);
}

// 异步分节串行执行：harness 的 sectionTitle 是全局态，并发跑会让失败标签串到别的节（与 selftest-cloud 同款）。
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
  const section = asyncSection;
  const DUAL_ROLES = [ROLES.CUSTOMER, ROLES.PARTNER];
  const sameRoles = (roles) => Array.isArray(roles)
    && roles.slice().sort().join(',') === DUAL_ROLES.slice().sort().join(',');

  // ---------------------------------------------------------------- A auth 动作域角色解析
  section('§7.3 双角色：auth 按动作域解析 identity.role + identity.roles 归一', async (t) => {
    const rolesCase = await identityOfAction('order.get', {}, DUAL, DUAL_ROLES);
    t.check(sameRoles(rolesCase.roles), 'A1 双角色 users.roles 归一为 identity.roles=[CUSTOMER,PARTNER]（权限判定唯一依据）',
      JSON.stringify(rolesCase.roles));
    const cases = [
      ['order.listCustomer', {}, ROLES.CUSTOMER, 'A2 order.listCustomer 需 CUSTOMER'],
      ['order.listPartner', {}, ROLES.PARTNER, 'A3 order.listPartner 需 PARTNER'],
      ['order.accept', {}, ROLES.PARTNER, 'A4 order.accept 需 PARTNER'],
      ['bind.create', {}, ROLES.CUSTOMER, 'A5 bind.create 需 CUSTOMER'],
      ['order.create', {}, '', 'A6 order.create 双角色歧义动作不归一（handler 按入参选侧）'],
      ['order.get', {}, '', 'A7 order.get 双角色歧义动作不归一（handler 按订单归属判侧）'],
      ['message.list', {}, '', 'A8 message.list 双角色歧义动作不归一（消息中心聚合两侧）'],
      ['ai.parseParcel', { role: ROLES.CUSTOMER }, ROLES.CUSTOMER, 'A9 ai.parseParcel 按入参 role=CUSTOMER 选定动作域角色'],
      ['ai.parseParcel', { role: ROLES.PARTNER }, ROLES.PARTNER, 'A10 ai.parseParcel 按入参 role=PARTNER 选定动作域角色']
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const item = cases[i];
      const got = await identityOfAction(item[0], item[1], DUAL, DUAL_ROLES);
      t.check(got.role === item[2] && sameRoles(got.roles), item[3], 'role=' + JSON.stringify(got.role));
    }
  });

  // ---------------------------------------------------------------- B 双角色全链路
  section('§7.3 双角色：订单双侧 / 消息中心 / 留言 fromRole / AI 识别全链路可用', async (t) => {
    const db = seedDb();
    const api = apiOf(db, DUAL);
    const listCustomer = await api.call('order.listCustomer', {});
    t.check(listCustomer.ok === true && Array.isArray(listCustomer.data.list),
      'B1 双角色 order.listCustomer 可用（顾客侧列表）', listCustomer.code || 'ok');

    const created = await api.call('order.create', createPayload({ note: '放门口' }), { clientRequestId: 'dual-create-000000000001' });
    t.check(created.ok === true && !!created.data.orderNo,
      'B2 双角色 order.create 无 guest/bindingId → 按 CUSTOMER 顾客本人下单成功', created.code || 'ok');
    const customerOrderNo = created.ok ? created.data.orderNo : '';
    const customerOrder = db.dump('orders').filter((row) => row.orderNo === customerOrderNo)[0] || {};
    t.eq([customerOrder.source, customerOrder.customerId], ['CUSTOMER', DUAL],
      'B3 顾客单落库 source=CUSTOMER、customerId=本人（双角色不误判为代客单）');
    const createdEvent = db.dump('order_events').filter((row) => row.orderNo === customerOrderNo && row.type === 'ORDER_CREATED')[0] || {};
    t.eq(createdEvent.actorRole, ROLES.CUSTOMER, 'B4 ORDER_CREATED 事件 actorRole=CUSTOMER（不再因双角色写空角色）');
    const getCustomer = await api.call('order.get', { orderNo: customerOrderNo });
    const customerActionKeys = keysOfActions(getCustomer.data && getCustomer.data.order);
    t.check(getCustomer.ok === true && customerActionKeys.indexOf('accept') < 0 && customerActionKeys.indexOf('cancel') >= 0,
      'B5 双角色 order.get 本人顾客单可用且按顾客侧下发动作条（无 accept，有 cancel）', customerActionKeys.join('/'));

    const guestCreated = await api.call('order.create', createPayload({ guest: guestOf() }), { clientRequestId: 'dual-create-000000000002' });
    t.check(guestCreated.ok === true, 'B6 双角色 order.create 带 guest → 按 PARTNER 代客下单成功', guestCreated.code || 'ok');
    const guestOrderNo = guestCreated.ok ? guestCreated.data.orderNo : '';
    const guestOrder = db.dump('orders').filter((row) => row.orderNo === guestOrderNo)[0] || {};
    t.eq([guestOrder.source, guestOrder.customerId], ['PARTNER', ''],
      'B7 代客单落库 source=PARTNER、customerId 为空（guest 快照，不写 bindings）');
    const getGuest = await api.call('order.get', { orderNo: guestOrderNo });
    t.check(getGuest.ok === true && keysOfActions(getGuest.data && getGuest.data.order).indexOf('accept') >= 0,
      'B8 双角色 order.get 兼职侧代客单可用且按兼职侧下发动作条（含 accept）',
      keysOfActions(getGuest.data && getGuest.data.order).join('/'));

    const accept = await api.call('order.accept', { orderNo: PARTNER_ORDER_NO, expectedVersion: 1 }, { clientRequestId: 'dual-accept-000000000001' });
    t.check(accept.ok === true, 'B9 双角色 order.accept 兼职侧订单可用', accept.code || 'ok');
    const acceptedEvent = db.dump('order_events').filter((row) => row.orderNo === PARTNER_ORDER_NO && row.type === 'ACCEPTED')[0] || {};
    t.eq(acceptedEvent.actorRole, ROLES.PARTNER, 'B10 ACCEPTED 事件 actorRole=PARTNER（动作域角色按侧别落库）');
    const listPartner = await api.call('order.listPartner', { view: 'workbench' });
    t.check(listPartner.ok === true && Array.isArray(listPartner.data.list) && listPartner.data.list.length > 0,
      'B11 双角色 order.listPartner 可用（兼职侧列表非空）', listPartner.code || 'ok');

    const center = await api.call('message.list', {});
    t.check(center.ok === true && Array.isArray(center.data.list), 'B12 双角色 message.list 可用（消息中心）', center.code || 'ok');
    const centerOrderNos = (center.data && Array.isArray(center.data.list) ? center.data.list : [])
      .map((item) => item.orderNo || '').filter((no) => no !== '');
    t.check(centerOrderNos.indexOf(customerOrderNo) >= 0 && centerOrderNos.indexOf(PARTNER_ORDER_NO) >= 0,
      'B13 双角色消息中心聚合两侧订单（顾客单 + 兼职单都在同一视图）',
      'customer=' + customerOrderNo + ' partner=' + PARTNER_ORDER_NO + ' got=' + centerOrderNos.join(','));

    const partnerMsg = await api.call('message.send', { orderNo: PARTNER_ORDER_NO, text: '兼职侧留言' }, { clientRequestId: 'dual-msg-00000000000001' });
    t.eq(partnerMsg.ok === true && (partnerMsg.data.message || {}).fromRole, ROLES.PARTNER,
      'B14 双角色在兼职侧订单留言 fromRole=PARTNER（按订单归属判定，不取 activeRole）');
    const customerMsg = await api.call('message.send', { orderNo: customerOrderNo, text: '顾客侧留言' }, { clientRequestId: 'dual-msg-00000000000002' });
    t.eq(customerMsg.ok === true && (customerMsg.data.message || {}).fromRole, ROLES.CUSTOMER,
      'B15 双角色在顾客侧订单留言 fromRole=CUSTOMER（同一 openid 两侧 fromRole 按单归属）');

    const aiCustomer = await api.call('ai.parseParcel', { ocrTextMasked: '取件码 A1-23 菜鸟驿站', role: ROLES.CUSTOMER, uploadTicketId: '' },
      { clientRequestId: 'dual-ai-00000000000001' });
    t.check(aiCustomer.ok === true, 'B16 双角色 ai.parseParcel（role=CUSTOMER）可用', aiCustomer.code || 'ok');
    const aiPartner = await api.call('ai.parseParcel', { ocrTextMasked: '取件码 A1-23 菜鸟驿站', role: ROLES.PARTNER, uploadTicketId: '' },
      { clientRequestId: 'dual-ai-00000000000002' });
    t.check(aiPartner.ok === true, 'B17 双角色 ai.parseParcel（role=PARTNER）可用', aiPartner.code || 'ok');
    const aiBad = await api.call('ai.parseParcel', { ocrTextMasked: '取件码 A1-23', role: 'SYSTEM', uploadTicketId: '' },
      { clientRequestId: 'dual-ai-00000000000003' });
    t.eq(aiBad.code, 'FORBIDDEN', 'B18 反例：ai.parseParcel 入参 role 非业务角色 → FORBIDDEN（不按分身穿权）');

    const boundCreated = await api.call('order.create', createPayload({ bindingId: 'binding-bound' }),
      { clientRequestId: 'dual-create-000000000003' });
    t.check(boundCreated.ok === true, 'B19 双角色 order.create 带 bindingId → 按 PARTNER 绑定顾客代客单成功', boundCreated.code || 'ok');
    const boundOrderNo = boundCreated.ok ? boundCreated.data.orderNo : '';
    const boundOrder = db.dump('orders').filter((row) => row.orderNo === boundOrderNo)[0] || {};
    t.eq([boundOrder.source, boundOrder.customerId], ['PARTNER', 'openid-bound-c'],
      'B20 绑定代客单落库 source=PARTNER、customerId=被绑定顾客（非调用方本人）');
    t.notEmpty(db.dump('orders'), '双角色全链路样本非空');
  });

  // ---------------------------------------------------------------- C 单角色基线不回归
  section('§7.3 双角色修复后单角色基线不回归：越权仍 FORBIDDEN、正常动作仍可用', async (t) => {
    const cDb = seedDb();
    const cApi = apiOf(cDb, 'openid-plain-customer');
    t.eq((await cApi.call('order.listPartner', { view: 'workbench' })).code, 'FORBIDDEN',
      'C1 单角色顾客调 order.listPartner → FORBIDDEN（未因双角色放宽）');
    const cCreated = await cApi.call('order.create', createPayload(), { clientRequestId: 'plain-create-0000000001' });
    t.check(cCreated.ok === true, 'C2 单角色顾客 order.create 顾客本人单仍可用', cCreated.code || 'ok');
    t.check((await cApi.call('message.list', {})).ok === true, 'C3 单角色顾客 message.list 仍可用');

    const pDb = seedDb();
    const pApi = apiOf(pDb, 'openid-plain-partner');
    t.eq((await pApi.call('order.listCustomer', {})).code, 'FORBIDDEN',
      'C4 单角色兼职调 order.listCustomer → FORBIDDEN（未因双角色放宽）');
    const pAccept = await pApi.call('order.accept', { orderNo: PLAIN_PARTNER_ORDER_NO, expectedVersion: 1 },
      { clientRequestId: 'plain-accept-00000000001' });
    t.check(pAccept.ok === true, 'C5 单角色兼职 order.accept 仍可用', pAccept.code || 'ok');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-cloud-dual' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-cloud-dual');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
