'use strict';
/**
 * tools/selftest-order.js — 云端订单建单引擎端到端断言套件（批 4-A / task-60）。
 *
 * 背景：order.create/createBatch + 上传票据/图片路径此前只有 selftest-bind-cloud G 组（acceptingOrders）
 *       一条旁证，建单引擎（_create/_parcel/_store/_dto + upload.prepare/cancel）几乎零覆盖；
 *       selftest-cloud 已 999/1000 行（TD-029），故本文件独立成套、register 形态由 tools/selftest.js 聚合。
 *
 * 覆盖（A~H；CONTRACT §4.2/§5.2/§1.3、DATA_MODEL §4.5/§4.8/§4.9/§2.10/§2.12/§7.6）：
 *   A. 单件快乐路径：订单/事件 ORDER_CREATED/counters 自增；DTO 无内部键；orderNo 格式；
 *      stationName 服务端按 stationId 派生（不信任客户端）；recognitionSource/confidence/dorm/phoneTail 快照。
 *   B. 幂等：同 clientRequestId → 同 orderNo + duplicated，订单/事件/计数器不增；不同 id → 新单；跨身份独立。
 *   C. 票据与图片：prepare 前缀/TTL/用途/归属/大小与类型闸；cancel 归属/幂等/已消费；下单侧
 *      ticket 缺失/非本人/过期/用途不符/已消费/fileId 不匹配/size/contentType；拆单共享票据一次性消费。
 *   D. 批量原子性：3 单成功（orderNo 连续、requestKey :itemIndex、事件 itemIndex）；0/6 件 VALIDATION；
 *      中间一件非法整批 0 单 0 事件票据仍可用；部分已存在 CONFLICT；全已存在 duplicated；
 *      事务中途失败整体回滚（0 单 0 事件、 counters 不消耗、票据不消费）。
 *   E. 守卫：资料未完整/无绑定/绑定异常/兼职 CLOSED/SUSPENDED/注销/接单关闭/真实×测试/只读视角/无角色；
 *      PARTNER 代客单 guest 必填+范围+快照，且不写 bindings。
 *   F. 字段闸：站点/码/柜号/尾号/note/预约/服务类型与启用/服务范围/未知字段/缺 parcel。
 *   G. 识别失败关联：recognition.failureId 优先、回填 orderId/fileId、非本人/非法格式静默丢弃不阻断、
 *      拆单共享 fileId 但 image.failureId 按单独立（逐单补齐失败记录，CONTRACT §4.3）。
 *   H. 静态回退闸：小写集合键正控/反例/全仓零命中、_create 幂等与单事务分支存在性、MAX_CREATE_BATCH=5。
 *
 * 纪律：fake DB 注入、不连真库、不 mock 全局 wx；先合法基线再反例，样本非空；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-order.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard } = require('./selftest');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
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

const EXPECTED_ASSERTIONS = 126;

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
  const payload = { parcel: parcelOf(), serviceCode: 'PICKUP_STD', appoint: { type: 'ASAP' }, note: '放门口' };
  Object.keys(extra || {}).forEach((key) => { payload[key] = extra[key]; });
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

function register(h) {
  const asyncSection = (title, fn) => h.section(title, (t) => serial(() => {
    h.sectionTitle = title;
    return fn(t);
  }));

  // ---------------------------------------------------------------- A 单件快乐路径
  asyncSection('A. 单件快乐路径（落库/事件/取号/DTO/站点派生/识别与宿舍快照）', async (t) => {
    const world = seedWorld();
    const db = world.db;
    const ticket = seedTicket(db, world.customerOpenid);
    const cridA = nextCrid('a');
    const payload = createPayload({
      parcel: parcelOf({ stationName: '客户端乱填的站点名', recognitionSource: 'DEEPSEEK', confidence: 'HIGH' }),
      note: '  放门口  ',
      ticket: ticket.ticket,
      image: imageOf(ticket)
    });
    const created = await apiOf(db, world.customerOpenid).call('order.create', payload, { clientRequestId: cridA });
    t.check(created.ok === true && !created.data.duplicated && ORDER_NO_RE.test(created.data.orderNo)
      && created.data.order && created.data.order.status === ORDER_STATUS.SUBMITTED,
    'A1 顾客建单成功：orderNo 形如 YYYYMMDD-XXXX、状态 SUBMITTED、非重放（实际 ' + created.code + '/' + created.data.orderNo + '）');
    const orders = db.dump('orders');
    const events = db.dump('order_events');
    const counter = db.dump('counters').filter((row) => row.key === 'orderNo:' + DAY_KEY)[0];
    t.eq([orders.length, events.length, counter && counter.seq], [1, 1, 1],
      'A2 订单 1 条 + ORDER_CREATED 事件 1 条 + counters(orderNo:day) 自增到 1');
    t.eq([events[0].type, events[0].fromStatus, events[0].toStatus, events[0].actorRole],
      ['ORDER_CREATED', '', ORDER_STATUS.SUBMITTED, ROLES.CUSTOMER],
    'A3 事件快照 ORDER_CREATED（from="" → SUBMITTED，actorRole=CUSTOMER）');
    const order = orders[0];
    t.eq([order.customerId, order.customerOpenid, order.customerNo, order.partnerId, order.partnerOpenid,
      order.partnerNo, order.source, order.isTest, order.version, order.requestKey],
    [world.customerOpenid, world.customerOpenid, world.customerNo, world.partnerId, world.partnerOpenid,
      'PABC234', 'CUSTOMER', false, 1, world.customerOpenid + ':' + cridA],
    'A4 订单身份/编号快照 + requestKey={customerId}:{clientRequestId} + isTest=false + version=1');
    t.eq([order.parcel.stationId, order.parcel.stationName], ['P3', stations.stationNameOf('P3')],
      'A5 客户端乱填 stationName 被忽略：站名由服务端按 stationId 派生（' + stations.stationNameOf('P3') + '）');
    t.eq([order.parcel.pickupCode, order.parcel.lockerNo, order.parcel.trackingTail, order.parcel.codeStatus,
      order.parcel.recognitionSource, order.parcel.confidence],
    ['A12345', 'B-01', '12345', 'OK', 'DEEPSEEK', 'HIGH'],
    'A6 取件码/柜号/尾号/识别来源与置信度按入参快照（confidence 仅合法枚举才写）');
    t.eq([order.dorm.zone, order.dorm.buildingNo, order.dorm.room, order.dorm.dormKey, order.dorm.roomTag,
      order.phoneTail], ['D', 4, '522', 'D4-522', 'A', '1234'],
    'A7 宿舍快照来自顾客资料 + 当前绑定 roomTag，手机尾号来自顾客资料');
    t.eq([order.service.code, order.service.name], ['PICKUP_STD', enums.serviceNameOf('PICKUP_STD')],
      'A8 服务类型快照：code 入参 + name 由服务端下发（不信任客户端）');
    t.eq(dtoLeaksOf(created.data.order), [], 'A9 建单响应 DTO 零内部字段（_id/requestKey/openid/cloudPath/clientRequestId 等）');
    t.eq([created.data.order.orderNo, created.data.order.statusText !== '', created.data.order.bucket,
      created.data.order.parcel.codeStatusText], [order.orderNo, true, 'submitted', '取件码可用'],
    'A10 DTO 含 orderNo/statusText/bucket/parcel.codeStatusText（页面只渲染不判状态机）');
    t.eq([created.data.order.image.hasImage, created.data.order.image.cleaned, Object.keys(created.data.order.image)],
      [true, false, ['hasImage', 'cleaned']],
      'A11 DTO 图片只回 {hasImage:true, cleaned:false}（fileId/cloudPath 不出云；批5 契约 B 只增 cleaned 字段）');
    t.eq([order.note, order.appoint.type], ['放门口', 'ASAP'], 'A12 note 去首尾空白、appoint ASAP 快照');
    const stationOnly = await apiOf(db, world.customerOpenid).call('order.create', createPayload({
      parcel: { stationName: '西苑一栋南面快递中心', pickupCode: 'B67890' }
    }), { clientRequestId: nextCrid('a2') });
    t.eq([stationOnly.ok, stationOnly.data.order.parcel.stationId, stationOnly.data.order.parcel.stationName],
      [true, 'P3', stations.stationNameOf('P3')],
    'A13 只传 stationName（正式名）也能归一到 P3 并回填服务端站名');
    const aiAdopted = await apiOf(db, world.customerOpenid).call('order.create', createPayload({
      parcel: parcelOf(), recognition: { source: 'DEEPSEEK' }
    }), { clientRequestId: nextCrid('a3') });
    t.eq([aiAdopted.ok, aiAdopted.data.order.parcel.recognitionSource, aiAdopted.data.order.parcel.recognitionSourceLabel],
      [true, 'DEEPSEEK', 'AI 辅助'],
    'A14 AI 兜底被采纳（recognition.source=DEEPSEEK）→ 订单快照 recognitionSource=DEEPSEEK（DATA_MODEL §4.9）');
    t.notEmpty(db.dump('orders'), 'A 组样本非空');
  });

  // ---------------------------------------------------------------- B 幂等
  asyncSection('B. 幂等（同 clientRequestId 同单 / 不同 id 新单 / 跨身份独立）', async (t) => {
    const world = seedWorld();
    const db = world.db;
    const api = apiOf(db, world.customerOpenid);
    const cridB = nextCrid('b');
    const first = await api.call('order.create', createPayload(), { clientRequestId: cridB });
    t.check(first.ok === true && ORDER_NO_RE.test(first.data.orderNo), 'B1 基线建单成功');
    const replay = await api.call('order.create', createPayload({ note: '重试请求' }), { clientRequestId: cridB });
    t.check(replay.ok === true && replay.data.duplicated === true && replay.data.orderNo === first.data.orderNo,
      'B2 同 clientRequestId 重放 → duplicated=true 且 orderNo 相同');
    t.eq([db.dump('orders').length, db.dump('order_events').length,
      db.dump('counters').filter((row) => row.key === 'orderNo:' + DAY_KEY)[0].seq], [1, 1, 1],
    'B3 重放不新增订单/事件、不重复消耗当日序号');
    const other = await api.call('order.create', createPayload(), { clientRequestId: nextCrid('b2') });
    t.check(other.ok === true && other.data.orderNo !== first.data.orderNo,
      'B4 不同 clientRequestId → 新订单（orderNo 不同）');
    t.eq([db.dump('orders').length, db.dump('order_events').length], [2, 2], 'B5 新请求各落 1 条订单/事件');
    const replayAgain = await api.call('order.create', createPayload(), { clientRequestId: cridB });
    t.eq([replayAgain.data.duplicated, db.dump('orders').length], [true, 2], 'B6 重放多次仍只 1 单（幂等稳定）');
    // 跨身份独立：另一顾客用同一 clientRequestId 不复用他人订单
    const otherC = seedWorld({
      db: createTestDb(), customerOpenid: 'openid-oc-c2', customerNo: 'CABCDEFGJ',
      partnerId: 'partner-oc2', partnerOpenid: 'openid-oc-p2', partnerNo: 'PABC235'
    });
    const foreign = await apiOf(otherC.db, otherC.customerOpenid).call('order.create', createPayload(), { clientRequestId: cridB });
    t.eq([foreign.ok, otherC.db.dump('orders').length, otherC.db.dump('orders')[0].requestKey],
      [true, 1, otherC.customerOpenid + ':' + cridB],
    'B7 同一 clientRequestId 跨身份请求键含 owner，互不复用（不越权读他人订单）');
    t.notEmpty(db.dump('orders'), 'B 组样本非空');
  });

  // ---------------------------------------------------------------- C 票据与图片
  asyncSection('C. 票据与图片（prepare 前缀/TTL/用途/大小类型；cancel；下单侧六类拒绝；一次性消费）', async (t) => {
    const world = seedWorld();
    const db = world.db;
    const cApi = apiOf(db, world.customerOpenid);
    const pApi = apiOf(db, world.partnerOpenid);
    const prepared = await cApi.call('upload.prepare', { purpose: UPLOAD_PURPOSE.TICKET, size: 1024 }, { clientRequestId: nextCrid('c') });
    t.check(prepared.ok === true && enums.TOKEN_PATTERN.test(prepared.data.ticket)
      && prepared.data.cloudPath === 'orders/' + prepared.data.ticket + '/image.jpg'
      && CLIENT_ID_RE.test(prepared.data.draftId),
    'C1 upload.prepare(TICKET)：32 位票据、cloudPath=orders/{ticket}/image.jpg、draftId 16~32 位');
    t.eq([prepared.data.purpose, typeof prepared.data.expiresAt], [UPLOAD_PURPOSE.TICKET, 'number'],
      'C2 upload.prepare 回 purpose=TICKET + expiresAt 数值（TTL 由 C3 精确断言）');
    const ticketRow = db.dump('upload_tickets').filter((row) => row.ticket === prepared.data.ticket)[0];
    t.eq([new Date(prepared.data.expiresAt).getTime() - new Date(ticketRow.createdAt).getTime(), ticketRow.usedAt],
      [5 * 60 * 1000, null], 'C3 票据 TTL=5 分钟、初始 usedAt=null');
    const noBind = seedWorld({ db: createTestDb(), binding: false, customer: { profileCompleted: true } });
    await expectCode(t, apiOf(noBind.db, noBind.customerOpenid).call('upload.prepare',
      { purpose: UPLOAD_PURPOSE.TICKET, size: 1024 }, { clientRequestId: nextCrid('c2') }), 'INVALID_STATE',
    'C4 未绑定兼职的顾客 upload.prepare(TICKET) → INVALID_STATE');
    await expectField(t, cApi.call('upload.prepare', { purpose: 'OTHER' }, { clientRequestId: nextCrid('c3') }),
      'VALIDATION_FAILED', 'purpose', 'C5 非法用途 → VALIDATION(data.field=purpose)');
    await expectField(t, cApi.call('upload.prepare', { purpose: UPLOAD_PURPOSE.TICKET, size: 600 * 1024 },
      { clientRequestId: nextCrid('c4') }), 'VALIDATION_FAILED', 'size', 'C6 截图 >500KB → VALIDATION(data.field=size)');
    await expectField(t, cApi.call('upload.prepare', { purpose: UPLOAD_PURPOSE.TICKET, contentType: 'image/gif' },
      { clientRequestId: nextCrid('c5') }), 'VALIDATION_FAILED', 'contentType', 'C7 非 jpg/png contentType → VALIDATION(data.field=contentType)');
    const partnerPrepared = await pApi.call('upload.prepare', { purpose: UPLOAD_PURPOSE.TICKET, size: 2048 }, { clientRequestId: nextCrid('c6') });
    t.check(partnerPrepared.ok === true && partnerPrepared.data.cloudPath.indexOf('orders/') === 0,
      'C8 兼职（ACTIVE）也可取截图票据（代客单路径）');
    const avatar = await cApi.call('upload.prepare', { purpose: UPLOAD_PURPOSE.AVATAR, size: 100 * 1024, contentType: 'image/png' },
      { clientRequestId: nextCrid('c7') });
    t.check(avatar.ok === true && avatar.data.cloudPath.indexOf('avatars/customer/') === 0
      && /\.jpg$/.test(avatar.data.cloudPath), 'C9 AVATAR 票据路径 avatars/customer/{random}.jpg（不含 openid）');
    await expectField(t, cApi.call('upload.prepare', { purpose: UPLOAD_PURPOSE.AVATAR, size: 300 * 1024 },
      { clientRequestId: nextCrid('c8') }), 'VALIDATION_FAILED', 'size', 'C10 头像 >200KB → VALIDATION(data.field=size)');
    // upload.cancel：基线/幂等/非本人/已消费/缺参
    const cancelTicket = seedTicket(db, world.customerOpenid);
    const cancelRes = await cApi.call('upload.cancel', { uploadTicketId: cancelTicket.ticket }, { clientRequestId: nextCrid('c9') });
    const repeatCancel = await cApi.call('upload.cancel', { uploadTicketId: cancelTicket.ticket }, { clientRequestId: nextCrid('c10') });
    t.eq([cancelRes.data.cancelled, repeatCancel.data.cancelled,
      db.dump('upload_tickets').filter((row) => row.ticket === cancelTicket.ticket).length], [true, false, 0],
    'C11 upload.cancel 基线 true、重复调用自然幂等 false、票据已删除');
    await expectCode(t, cApi.call('upload.cancel', { uploadTicketId: partnerPrepared.data.ticket }, { clientRequestId: nextCrid('c11') }),
      'NOT_FOUND', 'C12 撤销非本人票据 → NOT_FOUND');
    const emptyCancel = await cApi.call('upload.cancel', {}, { clientRequestId: nextCrid('c12') });
    t.eq(emptyCancel.data.cancelled, false, 'C13 缺票据参数 → {cancelled:false}（不报错）');
    // 下单侧拒绝：无 ticket / 非本人 / 过期 / 用途不符 / 已消费 / fileId 不匹配 / size / contentType
    const noTicket = createPayload({ image: { fileId: 'cloud://env.bucket/x.jpg' } });
    await expectField(t, cApi.call('order.create', noTicket, { clientRequestId: nextCrid('c13') }),
      'VALIDATION_FAILED', 'ticket', 'C14 带 image 无 ticket → VALIDATION(data.field=ticket)');
    const otherTicket = seedTicket(db, 'openid-oc-other');
    await expectCode(t, cApi.call('order.create', createPayload({ ticket: otherTicket.ticket, image: imageOf(otherTicket) }),
      { clientRequestId: nextCrid('c14') }), 'NOT_FOUND', 'C15 用非本人票据下单 → NOT_FOUND');
    const expired = seedTicket(db, world.customerOpenid, { expiresAt: NOW - 1000 });
    await expectCode(t, cApi.call('order.create', createPayload({ ticket: expired.ticket, image: imageOf(expired) }),
      { clientRequestId: nextCrid('c15') }), 'INVALID_STATE', 'C16 过期票据 → INVALID_STATE');
    const avatarTicket = seedTicket(db, world.customerOpenid, { purpose: UPLOAD_PURPOSE.AVATAR, cloudPath: 'avatars/customer/x.jpg' });
    await expectField(t, cApi.call('order.create', createPayload({ ticket: avatarTicket.ticket, image: imageOf(avatarTicket) }),
      { clientRequestId: nextCrid('c16') }), 'VALIDATION_FAILED', 'ticket', 'C17 头像票据当截图用 → VALIDATION(data.field=ticket)');
    const matchTicket = seedTicket(db, world.customerOpenid);
    await expectField(t, cApi.call('order.create', createPayload({
      ticket: matchTicket.ticket, image: { fileId: 'cloud://env.bucket/orders/other/image.jpg', size: 1024 }
    }), { clientRequestId: nextCrid('c17') }), 'VALIDATION_FAILED', 'image', 'C18 fileId 与票据 cloudPath 不匹配 → VALIDATION(data.field=image)');
    const sizeTicket = seedTicket(db, world.customerOpenid);
    await expectField(t, cApi.call('order.create', createPayload({
      ticket: sizeTicket.ticket, image: imageOf(sizeTicket, { size: 600 * 1024 })
    }), { clientRequestId: nextCrid('c18') }), 'VALIDATION_FAILED', 'image', 'C19 截图 >500KB → VALIDATION(data.field=image)');
    const mimeTicket = seedTicket(db, world.customerOpenid);
    await expectField(t, cApi.call('order.create', createPayload({
      ticket: mimeTicket.ticket, image: imageOf(mimeTicket, { contentType: 'image/gif' })
    }), { clientRequestId: nextCrid('c19') }), 'VALIDATION_FAILED', 'image', 'C20 非 jpg/png 截图 → VALIDATION(data.field=image)');
    const okTicket = seedTicket(db, world.customerOpenid);
    const cridC = nextCrid('c-ok');
    const okCreate = await cApi.call('order.create', createPayload({ ticket: okTicket.ticket, image: imageOf(okTicket) },
      { clientRequestId: cridC }), { clientRequestId: cridC });
    t.check(okCreate.ok === true, 'C21 合法票据+图片建单成功');
    const usedRow = db.dump('upload_tickets').filter((row) => row.ticket === okTicket.ticket)[0];
    t.eq([usedRow.usedAt instanceof Date, usedRow.usedAt.getTime()], [true, NOW], 'C22 建单成功在事务内消费票据（usedAt=服务端 now）');
    const okOrder = db.dump('orders')[0];
    t.eq([okOrder.image.fileId, okOrder.image.width, okOrder.image.height,
      new Date(okOrder.image.uploadedAt).getTime(), okOrder.image.cloudPath], [imageOf(okTicket).fileId, 800, 1200, NOW, okTicket.cloudPath],
    'C23 订单 image 快照 {fileId,width,height,uploadedAt,cloudPath}（cloudPath 仅服务端内部）');
    // 已消费票据 + 同 clientRequestId 重放：票据一次性优先（TD-027 同口径，Lead 已裁决接受）
    await expectCode(t, cApi.call('order.create', createPayload({ ticket: okTicket.ticket, image: imageOf(okTicket) },
      { clientRequestId: cridC }), { clientRequestId: cridC }), 'INVALID_STATE',
    'C24 已消费票据重放 → INVALID_STATE（票据一次性优先于幂等，TD-027 同口径）');
    t.eq(db.dump('orders').length, 1, 'C25 重放失败不产生第二单（仍 1 单）');
    t.notEmpty(db.dump('upload_tickets'), 'C 组样本非空');
  });

  // ---------------------------------------------------------------- D 批量原子性
  asyncSection('D. 批量原子性（3 单成功/0 与 6 件/中间非法整批不建/部分 CONFLICT/全重复 duplicated/事务回滚）', async (t) => {
    const world = seedWorld();
    const db = world.db;
    const cApi = apiOf(db, world.customerOpenid);
    const ticket = seedTicket(db, world.customerOpenid);
    const cridD = nextCrid('d');
    const items = [
      createPayload({ parcel: parcelOf({ pickupCode: 'A10001' }) }),
      createPayload({ parcel: parcelOf({ pickupCode: 'A10002' }) }),
      createPayload({ parcel: parcelOf({ pickupCode: 'A10003' }) })
    ].map((p) => ({ parcel: p.parcel, serviceCode: p.serviceCode, appoint: p.appoint, note: p.note }));
    const batch = await cApi.call('order.createBatch', { items, ticket: ticket.ticket, image: imageOf(ticket) }, { clientRequestId: cridD });
    t.check(batch.ok === true && batch.data.orders.length === 3, 'D1 批量 3 单成功（orders[] 长度 3）');
    const rows = db.dump('orders');
    t.eq(rows.map((row) => row.orderNo), [DAY_KEY + '-0001', DAY_KEY + '-0002', DAY_KEY + '-0003'],
      'D2 同事务连取 3 个序号：orderNo 连续（0001~0003）');
    t.eq(rows.map((row) => row.requestKey), [0, 1, 2].map((i) => world.customerOpenid + ':' + cridD + ':' + i),
      'D3 每条 requestKey={identity}:{clientRequestId}:{itemIndex}（批量逐单幂等键）');
    const events = db.dump('order_events');
    t.eq([events.length, events.map((event) => event.payload.itemIndex)], [3, [0, 1, 2]],
      'D4 事件 3 条且 payload.itemIndex=0/1/2（可按单追溯）');
    t.eq([db.dump('counters').filter((row) => row.key === 'orderNo:' + DAY_KEY)[0].seq,
      db.dump('upload_tickets').filter((row) => row.ticket === ticket.ticket)[0].usedAt instanceof Date], [3, true],
    'D5 counters 到 3 且共享票据在事务内消费一次');
    // 跨域回归（Lead 授权修 cloudfunctions/api/lib/id-generator.js 的一行）：当天首单是拆单 N 件时，
    // 首次取号必须一次预留 total 个；否则同日下一次下单从 2 开始，撞已用 orderNo → INTERNAL_ERROR（修复前首红）。
    const afterBatchTicket = seedTicket(db, world.customerOpenid);
    const afterBatch = await cApi.call('order.create', createPayload({ ticket: afterBatchTicket.ticket, image: imageOf(afterBatchTicket) }),
      { clientRequestId: nextCrid('d-regression') });
    t.check(afterBatch.ok === true && afterBatch.data.orderNo === DAY_KEY + '-0004',
      'D5b 当天首单是拆单 3 件 → 当天第二次下单成功且 orderNo=0004（修复前 INTERNAL_ERROR 首红）');
    t.eq(db.dump('counters').filter((row) => row.key === 'orderNo:' + DAY_KEY)[0].seq, 4,
      'D5c 取号计数器连续到 4（首次预留 total 个，不重复占号）');
    const before = [db.dump('orders').length, db.dump('order_events').length];
    await expectField(t, cApi.call('order.createBatch', { items: [], ticket: ticket.ticket, image: imageOf(ticket) },
      { clientRequestId: nextCrid('d2') }), 'VALIDATION_FAILED', 'items', 'D6 0 件 → VALIDATION(data.field=items)');
    const six = [0, 1, 2, 3, 4, 5].map((i) => ({ parcel: parcelOf({ pickupCode: 'A2000' + i }), serviceCode: 'PICKUP_STD' }));
    await expectField(t, cApi.call('order.createBatch', { items: six, ticket: ticket.ticket, image: imageOf(ticket) },
      { clientRequestId: nextCrid('d3') }), 'VALIDATION_FAILED', 'items', 'D7 6 件 > 上限 5 → VALIDATION(data.field=items)');
    const midTicket = seedTicket(db, world.customerOpenid);
    const badItems = [
      { parcel: parcelOf({ pickupCode: 'A30001' }), serviceCode: 'PICKUP_STD' },
      { parcel: parcelOf({ pickupCode: '!!!' }), serviceCode: 'PICKUP_STD' },
      { parcel: parcelOf({ pickupCode: 'A30003' }), serviceCode: 'PICKUP_STD' }
    ];
    await expectField(t, cApi.call('order.createBatch', { items: badItems, ticket: midTicket.ticket, image: imageOf(midTicket) },
      { clientRequestId: nextCrid('d4') }), 'VALIDATION_FAILED', 'pickupCode',
    'D8 中间一件取件码非法 → VALIDATION(data.field=pickupCode)（先全量校验再开事务）');
    t.eq([db.dump('orders').length, db.dump('order_events').length,
      db.dump('upload_tickets').filter((row) => row.ticket === midTicket.ticket)[0].usedAt], [before[0], before[1], null],
    'D9 整批 0 单 0 事件、票据仍可用（未被消费）');
    // 部分已存在 → CONFLICT（模拟同一 clientRequestId 前一批已落 1 条）
    const cridPartial = nextCrid('d5');
    db.seed('orders', [Object.assign({}, {
      _id: 'order-oc-partial', orderNo: DAY_KEY + '-9001', requestKey: world.customerOpenid + ':' + cridPartial + ':1',
      customerId: world.customerOpenid, customerOpenid: world.customerOpenid, customerNo: world.customerNo,
      partnerId: world.partnerId, partnerOpenid: world.partnerOpenid, partnerNo: 'PABC234', source: 'CUSTOMER',
      isTest: false, status: ORDER_STATUS.SUBMITTED, parcel: parcelOf(), version: 1,
      statusUpdatedAt: new Date(NOW), createdAt: new Date(NOW)
    })]);
    const countBeforePartial = db.dump('orders').length;
    const partialTicket = seedTicket(db, world.customerOpenid);
    await expectCode(t, cApi.call('order.createBatch', { items: items.slice(0, 2), ticket: partialTicket.ticket, image: imageOf(partialTicket) },
      { clientRequestId: cridPartial }), 'CONFLICT', 'D10 部分 itemIndex 已存在 → CONFLICT（幂等键不一致，不静默重建）');
    t.eq([db.dump('orders').length, db.dump('order_events').length], [countBeforePartial, before[1]],
      'D11 CONFLICT 后不补建剩余单、不写事件');
    // 全已存在 → duplicated（同 clientRequestId 整批重放；无图路径避开"票据一次性优先"，见 C24/TD-027 口径）
    const replayCrid = nextCrid('d6');
    const replayItems = items.slice(0, 2);
    const firstBatch = await cApi.call('order.createBatch', { items: replayItems }, { clientRequestId: replayCrid });
    const replayBatch = await cApi.call('order.createBatch', { items: replayItems }, { clientRequestId: replayCrid });
    t.check(firstBatch.ok === true && replayBatch.ok === true && replayBatch.data.duplicated === true,
      'D12 同 clientRequestId 整批重放 → duplicated=true');
    t.eq(replayBatch.data.orders.map((order) => order.orderNo), firstBatch.data.orders.map((order) => order.orderNo),
      'D13 重放返回同一批 orderNo（不重复创建）');
    t.eq([db.dump('orders').length, db.dump('order_events').length], [countBeforePartial + 2, before[1] + 2],
      'D14 重放不新增订单/事件');
    // 事务中途失败 → 整体回滚：0 单 0 事件、counters 不消耗、票据不消费
    const rollbackDb = seedWorld().db;
    const rollbackTicket = seedTicket(rollbackDb, 'openid-oc-c');
    const realDao = createDao(rollbackDb);
    let orderAdds = 0;
    const flakyDao = Object.assign({}, realDao, {
      transaction: async (fn) => realDao.transaction(async (trx) => {
        const wrapped = Object.assign({}, trx, {
          add: async (collection, doc) => {
            if (collection === COLLECTIONS.ORDERS) {
              orderAdds += 1;
              if (orderAdds === 2) throw new Error('boom');
            }
            return trx.add(collection, doc);
          }
        });
        return fn(wrapped);
      })
    });
    const ctx = handlerCtx(rollbackDb, 'openid-oc-c', { dao: flakyDao, identity: { role: ROLES.CUSTOMER } });
    let rollbackError = null;
    try {
      await require(path.join(API, 'handlers/order/createBatch.js'))(ctx, {
        items: replayItems, ticket: rollbackTicket.ticket, image: imageOf(rollbackTicket)
      });
    } catch (error) {
      rollbackError = error;
    }
    t.check(!!rollbackError && rollbackError.message === 'boom',
      'D15 事务中途失败错误原样上抛（不吞；实际 ' + (rollbackError && rollbackError.message) + '）');
    t.eq([rollbackDb.dump('orders').length, rollbackDb.dump('order_events').length], [0, 0],
      'D16 事务回滚：0 单 0 事件（单事务原子创建）');
    t.eq([rollbackDb.dump('counters').filter((row) => row.key === 'orderNo:' + DAY_KEY).length,
      rollbackDb.dump('upload_tickets').filter((row) => row.ticket === rollbackTicket.ticket)[0].usedAt], [0, null],
    'D17 回滚不消耗当日序号、不消费票据');
    t.notEmpty(db.dump('orders'), 'D 组样本非空');
  });

  // ---------------------------------------------------------------- E 守卫
  asyncSection('E. 守卫（资料/绑定/兼职状态/接单开关/真实×测试/只读/无角色/代客单 guest）', async (t) => {
    const noProfile = seedWorld({ db: createTestDb(), customer: { profileCompleted: false } });
    await expectCode(t, apiOf(noProfile.db, noProfile.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e1') }), 'INVALID_STATE', 'E1 顾客资料未完善 → INVALID_STATE');
    const noBinding = seedWorld({ db: createTestDb(), binding: false });
    await expectCode(t, apiOf(noBinding.db, noBinding.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e2') }), 'INVALID_STATE', 'E2 无 ACTIVE 绑定 → INVALID_STATE');
    const noPartner = seedWorld({ db: createTestDb() });
    await createDao(noPartner.db).remove(COLLECTIONS.PARTNERS, noPartner.partnerId);
    await expectCode(t, apiOf(noPartner.db, noPartner.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e3') }), 'INVALID_STATE', 'E3 绑定指向的兼职不存在 → INVALID_STATE（不静默建单）');
    const closed = PARTNER_STATUS.CLOSED;
    const suspended = PARTNER_STATUS.SUSPENDED;
    const closedWorld = seedWorld({ db: createTestDb(), partner: { status: closed } });
    const suspendedWorld = seedWorld({ db: createTestDb(), partner: { status: suspended } });
    const deletedWorld = seedWorld({ db: createTestDb(), partner: { deletedAt: NOW } });
    const codes = [];
    codes.push((await apiOf(closedWorld.db, closedWorld.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e4') })).code);
    codes.push((await apiOf(suspendedWorld.db, suspendedWorld.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e5') })).code);
    codes.push((await apiOf(deletedWorld.db, deletedWorld.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e6') })).code);
    t.eq(codes, ['PARTNER_CLOSED', 'PARTNER_CLOSED', 'PARTNER_CLOSED'],
      'E4 兼职 CLOSED / SUSPENDED / 注销 → 全部 PARTNER_CLOSED');
    t.eq([closedWorld.db.dump('orders').length, suspendedWorld.db.dump('orders').length,
      deletedWorld.db.dump('orders').length], [0, 0, 0], 'E5 三种关闭态零建单');
    const closedAccepting = seedWorld({ db: createTestDb(), partner: { serviceConfig: serviceConfigOf({ acceptingOrders: false }) } });
    await expectCode(t, apiOf(closedAccepting.db, closedAccepting.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e7') }), 'PARTNER_CLOSED', 'E6 acceptingOrders=false → PARTNER_CLOSED（服务端仍拦）');
    t.eq(closedAccepting.db.dump('orders').length, 0, 'E7 接单关闭时零建单');
    // 真实×测试互操作：双向 FORBIDDEN 且零写入
    const rxRealToTest = seedWorld({
      db: createTestDb(), customerOpenid: 'openid-e-real-c', partnerOpenid: 'TEST-EPARTNER', partnerId: 'partner-e-test',
      partnerNo: 'PTEST24', partnerIsTest: true
    });
    const rxTestToReal = seedWorld({
      db: createTestDb(), customerOpenid: 'TEST-ECUSTOMER', customerNo: 'CABCDEFGK',
      customerIsTest: true, partnerOpenid: 'openid-e-real-p', partnerId: 'partner-e-real', partnerNo: 'PABC236'
    });
    const rxCodes = [];
    rxCodes.push((await apiOf(rxRealToTest.db, rxRealToTest.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e8') })).code);
    rxCodes.push((await apiOf(rxTestToReal.db, rxTestToReal.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('e9') })).code);
    t.eq(rxCodes, ['FORBIDDEN', 'FORBIDDEN'], 'E8 真实顾客×测试兼职 / 测试顾客×真实兼职 → FORBIDDEN（双向隔离）');
    t.eq([rxRealToTest.db.dump('orders').length, rxTestToReal.db.dump('orders').length], [0, 0],
      'E9 真实×测试零建单（拒绝而非事后清理）');
    // PARTNER 代客单：guest 必填/字段/范围
    const pWorld = seedWorld({ db: createTestDb() });
    const pApi = apiOf(pWorld.db, pWorld.partnerOpenid);
    const guest = { displayName: '小张', phoneTail: '5678', zone: 'D', buildingNo: 4, room: '522' };
    await expectField(t, pApi.call('order.create', createPayload(), { clientRequestId: nextCrid('e10') }),
      'VALIDATION_FAILED', 'guest', 'E10 兼职代客单缺 guest → VALIDATION(data.field=guest)');
    await expectField(t, pApi.call('order.create', createPayload({ guest: Object.assign({}, guest, { phoneTail: '12345' }) }),
      { clientRequestId: nextCrid('e11') }), 'VALIDATION_FAILED', 'phoneTail', 'E11 guest 手机尾号非 4 位 → VALIDATION(data.field=phoneTail)');
    const narrowZone = seedWorld({ db: createTestDb(), partner: { serviceConfig: serviceConfigOf({ zones: ['X'] }) } });
    await expectField(t, apiOf(narrowZone.db, narrowZone.partnerOpenid).call('order.create',
      createPayload({ guest: guest }), { clientRequestId: nextCrid('e12') }), 'VALIDATION_FAILED', 'zone',
    'E12 guest 苑不在兼职服务范围 → VALIDATION(data.field=zone)');
    const bindCountBefore = pWorld.db.dump('bindings').length;
    const guestOrder = await pApi.call('order.create', createPayload({ guest: guest }), { clientRequestId: nextCrid('e13') });
    const guestRow = pWorld.db.dump('orders')[0];
    t.check(guestOrder.ok === true && guestOrder.data.order.guest && guestOrder.data.order.guest.dormKey === 'D4-522',
      'E13 兼职代客单成功：DTO guest 含服务端 derive 的 dormKey');
    t.eq([guestRow.source, guestRow.customerId, guestRow.customerOpenid, guestRow.customerNo, guestRow.guest.zone,
      guestRow.guest.buildingText, guestRow.guest.phoneTail, guestRow.phoneTail],
    ['PARTNER', '', '', '', 'D', 'D4', '5678', '5678'],
    'E14 代客单身份字段为空、guest 快照完整（dormKey/buildingText 服务端 derive）');
    t.eq([pWorld.db.dump('bindings').length, bindCountBefore], [1, 1], 'E15 代客单不写 bindings（绑定只能由顾客发起）');
    // 只读视角 / 无业务角色
    const roCtx = handlerCtx(pWorld.db, pWorld.customerOpenid, { identity: { role: ROLES.CUSTOMER, viewMode: 'READONLY' } });
    let roError = null;
    try {
      await require(path.join(API, 'handlers/order/create.js'))(roCtx, createPayload());
    } catch (error) {
      roError = error;
    }
    t.eq(roError && roError.code, 'FORBIDDEN', 'E16 READONLY 切换会话不能下单 → FORBIDDEN');
    const noRoleCtx = handlerCtx(pWorld.db, 'openid-e-norole', { identity: { role: '' } });
    let noRoleError = null;
    try {
      await require(path.join(API, 'handlers/order/create.js'))(noRoleCtx, createPayload());
    } catch (error) {
      noRoleError = error;
    }
    t.eq(noRoleError && noRoleError.code, 'FORBIDDEN', 'E17 解析不出业务角色（roles=[]）→ FORBIDDEN');
    t.notEmpty(pWorld.db.dump('orders'), 'E 组样本非空');
  });

  // ---------------------------------------------------------------- F 字段闸
  asyncSection('F. 字段闸（站点/码/柜号/尾号/note/预约/服务/范围/未知字段/缺 parcel）', async (t) => {
    const world = seedWorld();
    const db = world.db;
    const cApi = apiOf(db, world.customerOpenid);
    const crid = (tag) => nextCrid('f-' + tag);
    await expectField(t, cApi.call('order.create', createPayload({ parcel: parcelOf({ stationId: 'P9' }) }),
      { clientRequestId: crid('1') }), 'VALIDATION_FAILED', 'stationId', 'F1 非法站点 P9 → VALIDATION(data.field=stationId)');
    await expectField(t, cApi.call('order.create', createPayload({ parcel: { stationName: '不存在的驿站', pickupCode: 'A12345' } }),
      { clientRequestId: crid('2') }), 'VALIDATION_FAILED', 'stationId', 'F2 站名无法归一 → VALIDATION(data.field=stationId)');
    await expectField(t, cApi.call('order.create', createPayload({ parcel: parcelOf({ pickupCode: '1'.repeat(41) }) }),
      { clientRequestId: crid('3') }), 'VALIDATION_FAILED', 'pickupCode', 'F3 取件码原始长度 >40 → VALIDATION(data.field=pickupCode)');
    await expectField(t, cApi.call('order.create', createPayload({ parcel: parcelOf({ pickupCode: '!!' }) }),
      { clientRequestId: crid('4') }), 'VALIDATION_FAILED', 'pickupCode', 'F4 取件码含非法字符 → VALIDATION(data.field=pickupCode)');
    const emptyCode = await cApi.call('order.create', createPayload({ parcel: { stationId: '', pickupCode: '' } }),
      { clientRequestId: crid('5') });
    t.eq([emptyCode.ok, emptyCode.data.order.needCode, emptyCode.data.order.parcel.stationId],
      [true, true, ''], 'F5 站点/码都为空 → 允许建单并标 needCode（兼职 order.correct 补录）');
    await expectField(t, cApi.call('order.create', createPayload({ parcel: parcelOf({ lockerNo: '1'.repeat(11) }) }),
      { clientRequestId: crid('6') }), 'VALIDATION_FAILED', 'lockerNo', 'F6 柜号 >10 字 → VALIDATION(data.field=lockerNo)');
    const tailCodes = [];
    tailCodes.push((await cApi.call('order.create', createPayload({ parcel: parcelOf({ trackingTail: '1234' }) }),
      { clientRequestId: crid('7') })).code);
    tailCodes.push((await cApi.call('order.create', createPayload({ parcel: parcelOf({ trackingTail: '123456' }) }),
      { clientRequestId: crid('8') })).code);
    t.eq(tailCodes, ['VALIDATION_FAILED', 'VALIDATION_FAILED'], 'F7 运单尾号非恰好 5 位 → VALIDATION_FAILED');
    await expectField(t, cApi.call('order.create', createPayload({ note: 'x'.repeat(201) }),
      { clientRequestId: crid('9') }), 'VALIDATION_FAILED', 'note', 'F8 备注 >200 字 → VALIDATION(data.field=note)');
    await expectField(t, cApi.call('order.create', createPayload({
      appoint: { type: 'SLOT', startAt: NOW - 3600000, endAt: NOW - 1800000 }
    }), { clientRequestId: crid('10') }), 'VALIDATION_FAILED', 'appoint', 'F9 预约过去时段 → VALIDATION(data.field=appoint)');
    const slotOrder = await cApi.call('order.create', createPayload({
      appoint: { type: 'SLOT', startAt: NOW + 3600000, endAt: NOW + 7200000 }
    }), { clientRequestId: crid('11') });
    t.eq([slotOrder.ok, slotOrder.data.order.appoint.type, slotOrder.data.order.appoint.startAt],
      [true, 'SLOT', new Date(NOW + 3600000).toISOString()], 'F10 预约未来时段成功且 DTO 回 ISO 时间');
    await expectField(t, cApi.call('order.create', createPayload({ serviceCode: 'NOT_A_SERVICE' }),
      { clientRequestId: crid('12') }), 'VALIDATION_FAILED', 'serviceCode', 'F11 服务类型不在 SERVICE_CODES → VALIDATION(data.field=serviceCode)');
    const disabledWorld = seedWorld({ db: createTestDb(), partner: {
      serviceConfig: serviceConfigOf({ services: SERVICE_CODES.map((code) => ({ code, enabled: code === 'PICKUP_STD' })) })
    } });
    await expectField(t, apiOf(disabledWorld.db, disabledWorld.customerOpenid).call('order.create',
      createPayload({ serviceCode: 'PICKUP_DOOR' }), { clientRequestId: nextCrid('f13') }), 'VALIDATION_FAILED', 'serviceCode',
    'F12 兼职未启用该服务类型 → VALIDATION(data.field=serviceCode)');
    const zoneWorld = seedWorld({ db: createTestDb(), partner: { serviceConfig: serviceConfigOf({ zones: ['X'] }) } });
    await expectField(t, apiOf(zoneWorld.db, zoneWorld.customerOpenid).call('order.create', createPayload(),
      { clientRequestId: nextCrid('f14') }), 'VALIDATION_FAILED', 'zone', 'F13 顾客苑不在服务范围 → VALIDATION(data.field=zone)');
    const unknownKeyRes = await cApi.call('order.create', createPayload({ unexpectedKey: 1 }), { clientRequestId: crid('15') });
    t.check(unknownKeyRes.ok !== true && unknownKeyRes.code === 'VALIDATION_FAILED' && resField(unknownKeyRes) === 'unexpectedKey',
      'F14 未知顶层字段 → VALIDATION(data.field=未知键名)（零金额口径 #12：不认识的字段不得静默入库）');
    await expectField(t, cApi.call('order.create', { serviceCode: 'PICKUP_STD' }, { clientRequestId: crid('16') }),
      'VALIDATION_FAILED', 'parcel', 'F15 缺 parcel → VALIDATION(data.field=parcel)');
    const batchUnknown = await cApi.call('order.createBatch', { items: [], unexpectedKey: 1 }, { clientRequestId: crid('17') });
    t.check(batchUnknown.ok !== true && batchUnknown.code === 'VALIDATION_FAILED',
      'F16 批量未知顶层字段同样拒绝（幂等/参数闸先于任何写入）');
    t.notEmpty(db.dump('orders'), 'F 组样本非空');
  });

  // ---------------------------------------------------------------- G 识别失败关联
  asyncSection('G. 识别失败关联（逐单 recognition.failureId / 回填 orderId+fileId / 非法静默丢弃 / 拆单不串）', async (t) => {
    const world = seedWorld();
    const db = world.db;
    const cApi = apiOf(db, world.customerOpenid);
    const recordA = seedFailure(db, world.customerOpenid);
    const ticket1 = seedTicket(db, world.customerOpenid);
    const created = await cApi.call('order.create', createPayload({
      parcel: { stationId: '', pickupCode: '' }, ticket: ticket1.ticket, image: imageOf(ticket1),
      recognition: { failureId: recordA.failureNo }
    }), { clientRequestId: nextCrid('g') });
    const order1 = db.dump('orders')[0];
    t.check(created.ok === true && order1.image.failureId === recordA._id,
      'G1 recognition.failureId 命中本人记录 → orders.image.failureId=记录 _id');
    const recordARow = db.dump('recognition_failures').filter((row) => row._id === recordA._id)[0];
    t.eq([recordARow.orderId, recordARow.fileId], [order1._id, order1.image.fileId],
      'G2 建单后回填记录 orderId=本单、fileId=订单原图');
    const recordB = seedFailure(db, world.customerOpenid);
    const ticket2 = seedTicket(db, world.customerOpenid);
    const viaImage = await cApi.call('order.create', createPayload({
      parcel: { stationId: '', pickupCode: '' }, ticket: ticket2.ticket, image: imageOf(ticket2, { failureId: recordB.failureNo })
    }), { clientRequestId: nextCrid('g2') });
    t.check(viaImage.ok === true && db.dump('orders')[1].image.failureId === recordB._id,
      'G3 image.failureId 兼容旧入参 → 关联成功');
    const recordC = seedFailure(db, world.customerOpenid);
    const recordD = seedFailure(db, world.customerOpenid);
    const ticket3 = seedTicket(db, world.customerOpenid);
    const both = await cApi.call('order.create', createPayload({
      ticket: ticket3.ticket, image: imageOf(ticket3, { failureId: recordC.failureNo }),
      recognition: { failureId: recordD.failureNo }
    }), { clientRequestId: nextCrid('g3') });
    const order3 = db.dump('orders')[2];
    t.eq([both.ok, order3.image.failureId,
      db.dump('recognition_failures').filter((row) => row._id === recordC._id)[0].orderId], [true, recordD._id, ''],
    'G4 recognition.failureId 优先于 image.failureId（二选一优先口径）');
    const otherRecord = seedFailure(db, 'openid-oc-other');
    const ticket4 = seedTicket(db, world.customerOpenid);
    const notMine = await cApi.call('order.create', createPayload({
      ticket: ticket4.ticket, image: imageOf(ticket4), recognition: { failureId: otherRecord.failureNo }
    }), { clientRequestId: nextCrid('g4') });
    t.eq([notMine.ok, Object.prototype.hasOwnProperty.call(db.dump('orders')[3].image, 'failureId'),
      db.dump('recognition_failures').filter((row) => row._id === otherRecord._id)[0].orderId], [true, false, ''],
    'G5 非本人失败记录 → 静默丢弃不阻断下单、不越权回填');
    const ticket5 = seedTicket(db, world.customerOpenid);
    const badFormat = await cApi.call('order.create', createPayload({
      ticket: ticket5.ticket, image: imageOf(ticket5), recognition: { failureId: 'not-a-failure-no' }
    }), { clientRequestId: nextCrid('g5') });
    t.eq([badFormat.ok, Object.prototype.hasOwnProperty.call(db.dump('orders')[4].image, 'failureId')], [true, false],
      'G6 非法 failureId 形态 → 静默丢弃、订单照常创建');
    // 拆单 2 单各带不同 failureId：各单 image.failureId 指向自己的记录、逐条回填 orderId/fileId、互不串
    const batchRec1 = seedFailure(db, world.customerOpenid);
    const batchRec2 = seedFailure(db, world.customerOpenid);
    const batchTicket = seedTicket(db, world.customerOpenid);
    const perItemItems = [
      { parcel: { stationId: '', pickupCode: '' }, serviceCode: 'PICKUP_STD', recognition: { failureId: batchRec1.failureNo } },
      { parcel: parcelOf({ pickupCode: 'B77889' }), serviceCode: 'PICKUP_STD', recognition: { failureId: batchRec2.failureNo } }
    ];
    const perItemBatch = await cApi.call('order.createBatch', {
      items: perItemItems, ticket: batchTicket.ticket, image: imageOf(batchTicket)
    }, { clientRequestId: nextCrid('g6') });
    const perItemOrders = db.dump('orders').slice(5);
    t.check(perItemBatch.ok === true && perItemOrders.length === 2, 'G7 拆单 2 单（每单各带 failureId）建单成功');
    t.eq(perItemOrders.map((order) => order.image.failureId), [batchRec1._id, batchRec2._id],
      'G8 每单 image.failureId 指向本单自己的失败记录（不串单）');
    const recRows = db.dump('recognition_failures');
    const recRow1 = recRows.filter((row) => row._id === batchRec1._id)[0];
    const recRow2 = recRows.filter((row) => row._id === batchRec2._id)[0];
    t.eq([[recRow1.orderId, recRow1.fileId], [recRow2.orderId, recRow2.fileId]],
      [[perItemOrders[0]._id, perItemOrders[0].image.fileId], [perItemOrders[1]._id, perItemOrders[1].image.fileId]],
    'G9 事务后逐条回填：各自 orderId/fileId 指向各自订单（同一 fileId 共享）');
    t.eq([recRow1.failureNo === batchRec2.failureNo,
      perItemOrders[0].image.fileId === perItemOrders[1].image.fileId], [false, true],
    'G10 两单 failureNo 互异、fileId 共享（同一截图）');
    // 只带顶层 recognition.failureId → 只回退 item0，其余单不得串用同一记录
    const topRec = seedFailure(db, world.customerOpenid);
    const topTicket = seedTicket(db, world.customerOpenid);
    const topItems = [
      { parcel: { stationId: '', pickupCode: '' }, serviceCode: 'PICKUP_STD' },
      { parcel: parcelOf({ pickupCode: 'C88990' }), serviceCode: 'PICKUP_STD' }
    ];
    const topBatch = await cApi.call('order.createBatch', {
      items: topItems, ticket: topTicket.ticket, image: imageOf(topTicket), recognition: { failureId: topRec.failureNo }
    }, { clientRequestId: nextCrid('g7') });
    const topOrders = db.dump('orders').slice(7);
    t.check(topBatch.ok === true && topOrders.length === 2, 'G11 顶层 recognition.failureId 拆单 2 单建单成功');
    t.eq([topOrders[0].image.failureId, Object.prototype.hasOwnProperty.call(topOrders[1].image, 'failureId')], [topRec._id, false],
      'G12 顶层 failureId 只回退 item0；其余单 image.failureId 不存在（不串用同一记录）');
    const topRow = db.dump('recognition_failures').filter((row) => row._id === topRec._id)[0];
    t.eq([topRow.orderId, topRow.fileId, db.dump('recognition_failures').length], [topOrders[0]._id, topOrders[0].image.fileId, recRows.length + 1],
      'G13 顶层记录只回填 item0 的 orderId/fileId；服务端不补建记录（写入唯一入口仍是 ai.parseParcel）');
    // 同 clientRequestId 整批重放 → duplicated、不新增订单、不重复回填记录（无图路径避开票据一次性优先）
    const replayCridG = nextCrid('g8');
    const replayItemsG = [topItems[0], topItems[1]];
    const firstReplay = await cApi.call('order.createBatch', { items: replayItemsG }, { clientRequestId: replayCridG });
    const ordersBeforeReplay = db.dump('orders').length;
    const recCountBefore = db.dump('recognition_failures').length;
    const secondReplay = await cApi.call('order.createBatch', { items: replayItemsG }, { clientRequestId: replayCridG });
    t.check(firstReplay.ok === true && secondReplay.ok === true && secondReplay.data.duplicated === true
      && db.dump('orders').length === ordersBeforeReplay && db.dump('recognition_failures').length === recCountBefore,
    'G14 同 clientRequestId 整批重放：duplicated 且不新增订单/不回填新记录');
    t.notEmpty(db.dump('recognition_failures'), 'G 组样本非空');
  });

  // ---------------------------------------------------------------- H 静态回退闸
  asyncSection('H. 静态回退闸（小写集合键/幂等与单事务分支存在性/批量上限）', async (t) => {
    const controlHit = lowercaseCollectionKeyHitsInText(fsutil.stripComments(
      'ctx.dao.findOne(COLLECTIONS.orders, { where: {} });\n'
    ));
    t.eq(controlHit.length, 1, 'H1 正控：小写集合键 COLLECTIONS.orders 被扫描命中（扫描有牙）');
    const controlClean = lowercaseCollectionKeyHitsInText(fsutil.stripComments(
      'const a = COLLECTIONS.ORDERS;\nconst b = ALL_COLLECTIONS.length;\n// 注释里的 COLLECTIONS.orders 不算命中\n'
    ));
    t.eq(controlClean.length, 0, 'H2 反例：大写键/ALL_COLLECTIONS/注释内小写键不误伤');
    const targetFiles = listJs(path.join(API, 'handlers/order')).concat(listJs(path.join(API, 'handlers/upload')));
    t.check(targetFiles.length >= 20, 'H3 扫描样本非空（order+upload handlers 共 ' + targetFiles.length + ' 个文件）');
    t.eq(scanLowercaseKeys(targetFiles), [], 'H4 order/upload handlers 零小写集合键（COLLECTIONS.<小写> 会抛未登记集合）');
    const createCode = fsutil.stripComments(fs.readFileSync(path.join(API, 'handlers/order/_create.js'), 'utf8'));
    t.check(createCode.indexOf('findExistingByRequestKey') !== -1 && createCode.indexOf('duplicated: true') !== -1,
      'H5 _create.js 幂等分支存在（requestKey 预查 + duplicated 返回，防回退成"每次新单"）');
    t.check(createCode.indexOf('nextOrderNos') !== -1 && createCode.indexOf('trx.add(COLLECTIONS.ORDERS') !== -1,
      'H6 批量在单事务内连取序号并插单（不拆成多次事务）');
    t.eq([orderState.MAX_CREATE_BATCH, enums.FAILURE_NO_PATTERN.test('F-' + DAY_KEY + '-ABCDEF'),
      enums.FAILURE_NO_PATTERN.test('F-' + DAY_KEY + '-000000')], [5, true, false],
    'H7 批量上限=5 且 failureNo 形态闸有效（正控/反例）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-order' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-order');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
