'use strict';
/**
 * tools/selftest-order-flow.js — 批 4-C 顾客下单四步端侧断言套件（ENGINEERING §7.2 接入范式）。
 *
 * 覆盖（任务 task-62 A~G；UX §4.3/§4.4/§4.8/§12.2 AC-C-10~20/51~54、ARCHITECTURE §3.1/§3.2/§4.3）：
 *   A. 站点选择器只来自 P1~P8（别名归一后仍是正式站，无自建站名；判不准留空）
 *   B. 服务类型只有名称+说明（只展示兼职已启用项；零金额键值；说明随类型下发）
 *   C. canSubmit 五态与上界（空选/超 5 件/缺站点/无码无尾号/形态闸/恰好 5 件可提交）
 *   D. buildPayload：单件/拆单/每件独立预约备注/共享 image/单件顶层与拆单件级 failureId/
 *      recognitionSource/confidence（值域与服务端一致）
 *   E. submission id 生命周期：格式、重试复用、件级内容变更重生成、成功清空
 *   F. api/client transport 注入：显式 clientRequestId 进包络、非法回退自生成、写动作不重试、
 *      读动作重试、13 码→人话、超时以 CallError（人话）向上，不外抛原始错误
 *   G. 页面层静态：零 wx.cloud.*、零七状态字面量、零 random、零自拼 order.create 字面量；
 *      Step4 接线（ensureSubmission/clearSubmission/clientRequestId）、逐件预约备注控件、
 *      服务说明/截图预览/识别原文/AI 兜底三态文案与「取消」入口
 *   H. 逐件 AI 兜底纯件：按单调用/同一票据/独立 failureId/规则优先不外呼/只填空/
 *      某件失败只降级该件/降级 DTO 只预填/recognitionSource 优先级 MANUAL > AI 来源 > RULE/
 *      D29 低置信（LOW+DEEPSEEK）不写入、只挂建议快照、采纳后 DEEPSEEK+LOW 进载荷、手填不被覆盖
 *   I. 服务端契约联调（fake DB，真实 handler）：严格白名单接受/拒绝、recognition.source 落库、
 *      拆单逐单 source 不串、ORDER_CREATED 事件与零写入
 *   K/L/M（批 10 A 批）：P1-8 相册授权修正、P1-4 换图替换/重试/失败卡两条出路（D24）、
 *      P1-6 提交前服务范围预检、P1-9「其他代办」强制备注（纯件 + 有牙扫描 + 页面接线）
 *
 * 纪律：不 mock 全局 wx（api/client 用 setTransport 注入替身）；fake 数据、不连真云；
 *       先合法基线再反例；样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-order-flow.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard } = require('./selftest');

const ROOT = path.resolve(__dirname, '..');

const model = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/model.js'));
const ocrFlow = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/ocr-flow.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const stations = require(path.join(ROOT, 'shared/stations.js'));
const orderState = require(path.join(ROOT, 'shared/order-state.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const client = require(path.join(ROOT, 'api/client.js'));
const orderApi = require(path.join(ROOT, 'api/modules/order.js'));
const aiApi = require(path.join(ROOT, 'api/modules/ai.js'));
const zeroMoney = require(path.join(ROOT, 'tools/zero-money-scan.js'));
const avatar = require(path.join(ROOT, 'utils/avatar.js'));
const filesFlow = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/files-flow.js'));
const precheck = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/precheck.js'));
const pickerState = require(path.join(ROOT, 'components/image-picker/state.js'));
const { createFakeDb } = require('./fake-db');

const CLOUD_API = path.join(ROOT, 'cloudfunctions/api');
const app = require(path.join(CLOUD_API, 'app.js'));
const { COLLECTIONS } = require(path.join(CLOUD_API, 'shared/collections.js'));
const serverEnums = require(path.join(CLOUD_API, 'shared/enums.js'));

const EXPECTED_ASSERTIONS = 195; // 实际断言总数（少算/多算都判红）

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

function register(h) {
  // ---------------------------------------------------------------- A 站点选择器（P1~P8）
  h.section('A. 站点选择器只来自 P1~P8（别名归一/无自建站名/判不准留空）', (t) => {
    const options = model.stationOptions();
    t.eq(options.map((item) => item.id), stations.STATION_IDS,
      'A1 站点选择器 id 恰为 P1~P8（顺序与服务端站点表一致，客户端不自建）');
    t.eq(options, stations.listStations(), 'A2 选择器名称逐字来自 shared/stations（无第二份站点表）');
    t.eq(options.filter((item) => Object.keys(item).sort().join(',') !== 'id,name'), [],
      'A3 选择项只有 id/name 两键（不夹带范围等额外字段）');
    t.check(options.every((item) => typeof item.name === 'string' && item.name.length > 2)
      && new Set(options.map((item) => item.name)).size === stations.STATION_COUNT,
    'A4 每个站点都有正式中文名且不重复（空名/重名不得进选择器）');
    t.eq([model.stationName('P1'), model.stationName('P8'), model.stationName('P9'), model.stationName('')],
      [stations.stationNameOf('P1'), stations.stationNameOf('P8'), '', ''],
      'A5 stationId → 正式名；P9/空不在值域 → 留空（不做模糊映射）');
    t.eq([stations.normalizeStation('西苑一栋南面菜鸟驿站').id, stations.normalizeStation('西苑1栋南面菜鸟驿站').id],
      ['P3', 'P3'], 'A6 别名（菜鸟/数字 1 栋写法）归一命中同一正式站 P3');
    t.check(stations.normalizeStation('西苑五食堂顺丰').ok === false
      && stations.normalizeStation('自建驿站').ok === false,
    'A7 非正式名/自建站名归一失败（宁可不猜，也不会把用户指到错驿站）');
    t.eq(model.stationOptions().map((item) => item.name).indexOf('自建驿站'), -1,
      'A8 选择器里不存在任何自建/临时站点（零自建站名）');
    t.notEmpty(model.stationOptions(), 'A 组样本非空');
  });

  // ---------------------------------------------------------------- B 服务类型（只有名称+说明）
  h.section('B. 服务类型只有名称+说明（已启用过滤 / 零金额）', (t) => {
    const config = {
      serviceCatalog: enums.SERVICES.map((item) => ({
        code: item.code, name: item.name, desc: item.desc
      }))
    };
    const partner = {
      services: [
        { code: enums.SERVICE_CODES[0], enabled: true },
        { code: enums.SERVICE_CODES[1], enabled: true },
        { code: enums.SERVICE_CODES[2], enabled: false }
      ]
    };
    const options = model.serviceOptions(config, partner);
    t.eq(options.map((item) => item.code), [enums.SERVICE_CODES[0], enums.SERVICE_CODES[1]],
      'B1 只展示兼职已启用服务类型（enabled:false 不下发）');
    t.eq(options.map((item) => item.name),
      [enums.serviceNameOf(enums.SERVICE_CODES[0]), enums.serviceNameOf(enums.SERVICE_CODES[1])],
      'B2 名称取自 config.serviceCatalog（服务端单源，不由客户端拼）');
    t.eq(options.filter((item) => Object.keys(item).sort().join(',') !== 'code,desc,name'), [],
      'B3 选择项只有 code/name/desc 三键（无额外计价类键）');
    t.eq(zeroMoney.scanText(JSON.stringify(options)), [],
      'B4 选择项序列化后零金额词命中 0（词表单源 tools/zero-money-scan，不另抄一份词表）');
    t.eq(zeroMoney.scanText(options.map((item) => item.desc).join('\n')), [],
      'B5 服务说明文案零金额词命中 0（D5/D6 零交易语义）');
    t.check(model.serviceOptions(null, null).length === 0,
      'B6 配置缺失时降级为空列表（页面仍可手填/不崩）');
    t.eq(model.serviceOptions(config, { services: [] }).length, enums.SERVICE_CODES.length,
      'B7 兼职未配置服务范围时展示全部目录项（enabled 未知不误杀）');
    t.notEmpty(options, 'B 组样本非空');
  });

  // ---------------------------------------------------------------- C canSubmit 五态与上界
  h.section('C. canSubmit 五态与上界（空选/超 10 件/缺站点/无码无尾号/形态闸/恰好 10 件）', (t) => {
    const empty = model.canSubmit([]);
    t.check(empty.ok === false && empty.reason.indexOf('至少选择一件') === 0,
      'C1 空选 → 拒绝（至少选择一件再提交）');
    const unchecked = model.canSubmit([Object.assign(stationItem({}), { checked: false })]);
    t.check(unchecked.ok === false && unchecked.reason.indexOf('至少选择一件') === 0,
      'C2 全部取消勾选 → 拒绝（勾选件才是提交集）');
    const tooMany = model.canSubmit(new Array(model.MAX_PARCELS + 1).fill(0)
      .map(() => stationItem({})));
    t.check(tooMany.ok === false && tooMany.reason.indexOf('一单最多 10 件') >= 0,
      'C3 超过上界（MAX_PARCELS+1=11）→ 拒绝且文案带上界 10');
    t.check(model.MAX_PARCELS === 10 && model.MAX_IMAGES === 5,
      'C4 页面上界与 CONTRACT §5.2/D23 同值（包裹 ≤10、截图 ≤5）');
    const missingStation = model.canSubmit([stationItem({ stationId: '', stationName: '' })]);
    t.check(missingStation.ok === false && missingStation.reason.indexOf('站点') >= 0 && missingStation.index === 0,
      'C5 缺站点 → 拒绝并给件序号（页面可定位到那一件）');
    const noCode = model.canSubmit([stationItem({ pickupCode: '', trackingTail: '' })]);
    t.check(noCode.ok === false && noCode.reason.indexOf('取件码') >= 0,
      'C6 无码且无尾号 → 拒绝（NEED_CODE 支路要求先填运单后 5 位）');
    const needCode = model.canSubmit([stationItem({ pickupCode: '', trackingTail: '12345' })]);
    t.check(needCode.ok === true && needCode.items[0].codeStatus === enums.CODE_STATUS.NEED_CODE,
      'C7 无码但尾号 5 位 → 可提交（NEED_CODE 允许提交，兼职补码）');
    const badTail = model.canSubmit([stationItem({ trackingTail: '1234' })]);
    t.check(badTail.ok === false && badTail.reason.indexOf('5 位') >= 0,
      'C8 尾号不是 5 位 → 形态闸拒绝（文案来自 utils/recognize 单源）');
    const badLocker = model.canSubmit([stationItem({ lockerNo: '12345678901' })]);
    t.check(badLocker.ok === false && badLocker.reason.indexOf('柜号') >= 0,
      'C9 柜号 >10 字 → 形态闸拒绝（不静默截断）');
    const exactlyMax = model.canSubmit(new Array(model.MAX_PARCELS).fill(0)
      .map((unused, index) => stationItem({ pickupCode: 'A' + (12340 + index) })));
    t.check(exactlyMax.ok === true && exactlyMax.items.length === model.MAX_PARCELS,
      'C10 恰好 MAX_PARCELS=10 件 → 可提交（上界含等于）');
    t.eq([exactlyMax.items.length, model.MAX_PARCELS], [10, 10], 'C11 上界取 CONTRACT 常量 10（不写死两份数字）');
    t.notEmpty(exactlyMax.items, 'C 组样本非空');
  });

  // ---------------------------------------------------------------- D buildPayload 形状
  h.section('D. buildPayload：parcels[]/images[]/tickets[] 单入口 + 包裹级 failureId + 整单服务/预约/备注', (t) => {
    const manual = stationItem({});
    const single = payloadOf([manual]);
    t.check(single.parcels.length === 1 && single.images.length === 1 && single.tickets.length === 1,
      'D1 单件 → 1 个包裹 + 1 张图/1 张票据（v1.0 一单多包裹，单入口 order.create）');
    t.eq(Object.keys(single.parcels[0].parcel).sort(),
      ['codeStatus', 'lockerNo', 'pickupCode', 'stationId', 'stationName', 'trackingTail', 'recognitionSource'].sort(),
      'D2 包裹 parcel 字段集与服务端 normalizeParcel 入参对齐（识别来源在 parcel 内，不再是顶层 recognition）');
    t.eq([single.parcels[0].parcel.recognitionSource, single.parcels[0].parcel.confidence],
      ['MANUAL', undefined],
      'D3 手填件 recognitionSource=MANUAL；无置信度时不带 confidence（空则不带）');
    t.eq([single.images[0].fileId, single.tickets[0]], [IMAGE.fileId, TICKET],
      'D4 images[i] ↔ tickets[i] 同序一一对应（fileId 与票据原样进 payload）');
    t.eq(single.parcels[0].failureId, undefined, 'D5 无失败记录时包裹不带 failureId（不发明记录号）');

    const ocrItem = stationItem({ source: enums.RECOGNITION_SOURCE.RULE, confidence: 'MEDIUM' });
    const ocrBuilt = payloadOf([ocrItem]);
    t.eq([ocrBuilt.parcels[0].parcel.recognitionSource, ocrBuilt.parcels[0].parcel.confidence], ['RULE', 'MEDIUM'],
      'D6 截图识别件 recognitionSource=RULE + confidence=MEDIUM（识别来源快照不丢）');

    // AI 兜底来源标识来自服务端建议（端侧不硬编码第三方名）：aiApplied 时原样透传，服务端校验值域
    const aiItem = model.makeItem(
      { stationId: 'P3', pickupCode: 'B23456', source: 'DEEPSEEK', confidence: 'HIGH', aiApplied: true },
      { serviceCode: enums.SERVICE_CODES[0] });
    const aiBuilt = payloadOf([aiItem]);
    t.eq([aiBuilt.parcels[0].parcel.recognitionSource, aiBuilt.parcels[0].parcel.confidence], ['DEEPSEEK', 'HIGH'],
      'D7 AI 兜底件来源原样透传（包裹级 recognitionSource=DEEPSEEK，与服务端 RECOGNITION_SOURCES 一致）');
    t.check(RECOGNITION_SOURCES.indexOf(aiBuilt.parcels[0].parcel.recognitionSource) >= 0
      && CONFIDENCE_VALUES.indexOf(aiBuilt.parcels[0].parcel.confidence) >= 0,
    'D8 透传值落在服务端值域内（RECOGNITION_SOURCES / CONFIDENCE_LEVEL_LIST）');
    const unappliedBuilt = payloadOf([stationItem({ source: 'DEEPSEEK', confidence: 'NONE' })]);
    t.eq([unappliedBuilt.parcels[0].parcel.recognitionSource, unappliedBuilt.parcels[0].parcel.confidence],
      ['MANUAL', undefined],
      'D9 未真正应用 AI（aiApplied!==true）或非法置信度 → 回退 MANUAL/不带（不把未知值塞给服务端）');

    const batchItems = [stationItem({ pickupCode: 'A12345' }), stationItem({ pickupCode: 'B23456' }),
      stationItem({ pickupCode: 'C34567' })];
    const batch = payloadOf(batchItems);
    t.check(batch.parcels.length === 3 && batch.single === undefined && batch.batch === undefined,
      'D10 多件 → 3 个包裹走同一单入口（v1.0 不再有 single/batch 两种载荷）');
    t.check(batch.parcels.every((row) => row.parcel.stationId === 'P3' && row.parcel.pickupCode.length >= 5),
      'D11 每件独立 parcel（不串件，逐件站点/取件码保留）');
    t.check(batch.images.length === 1 && batch.tickets.length === 1,
      'D12 同图多件共享同一 images[0]/tickets[0]（一图多件不重复上传）');
    const slotPayload = payloadOf([stationItem({})], {
      appoint: { type: 'SLOT', startAt: '2026-10-22T08:00:00+08:00', endAt: '2026-10-22T12:00:00+08:00' }
    });
    t.eq(slotPayload.appoint,
      { type: 'SLOT', startAt: '2026-10-22T08:00:00+08:00', endAt: '2026-10-22T12:00:00+08:00' },
      'D13 预约是整单一份（订单级字段，不再逐件）');
    t.eq(payloadOf([stationItem({})], { note: '放门口' }).note, '放门口',
      'D14 备注是整单一份（订单级字段，不再逐件）');
    const uncheckedThird = [stationItem({}), stationItem({}),
      Object.assign(stationItem({}), { checked: false })];
    t.eq(payloadOf(uncheckedThird).parcels.length, 2, 'D15 未勾选件不进 parcels（取消勾选不进单）');
    const failSingle = payloadOf([Object.assign(stationItem({}), { failureId: 'F-20261022-0001' })]);
    t.eq(failSingle.parcels[0].failureId, 'F-20261022-0001',
      'D16 失败记录号只放包裹级 parcels[i].failureId（契约 §4.3 v1.0）');
    const failBatch = payloadOf([
      Object.assign(stationItem({ pickupCode: 'A12345' }), { failureId: 'F-20261022-0001' }),
      Object.assign(stationItem({ pickupCode: 'B23456' }), { failureId: 'F-20261022-0002' })
    ]);
    t.eq(failBatch.parcels.map((row) => row.failureId), ['F-20261022-0001', 'F-20261022-0002'],
      'D17 多件各自包裹级 failureId（逐件独立关联，不套同一记录）');
    t.check(failBatch.images[0].failureId === undefined,
      'D18 images[] 不带 failureId（权威口径：失败记录按包裹关联，图片只做 fileId 快照）');
    const manualOnly = payloadOf([stationItem({})], { images: [], tickets: [] });
    t.check(manualOnly.images.length === 0 && manualOnly.tickets.length === 0 && manualOnly.manualEntry === true,
      'D19 无截图手填：images=[]/tickets=[] 且 manualEntry=true（D24）');
    t.eq(payloadOf([stationItem({})]).manualEntry, false, 'D20 有图时 manualEntry=false（识别链路标记）');
    const withDelivery = payloadOf([stationItem({})], {
      delivery: { zone: 'X', buildingNo: 6, room: '302', recipientName: '小王' }
    });
    t.eq(withDelivery.delivery, { zone: 'X', buildingNo: 6, room: '302', recipientName: '小王' },
      'D21 配送地址随单上送（D25，最小字段：苑/楼栋/宿舍 + 收件人称呼）');
    t.check(payloadOf([stationItem({})]).delivery === undefined,
      'D22 本人宿舍不传 delivery（服务端按资料默认，避免制造第二真相）');
    t.eq(Object.keys(withDelivery).sort(),
      ['appoint', 'delivery', 'images', 'manualEntry', 'note', 'parcels', 'serviceCode', 'tickets'].sort(),
      'D23 请求顶层键恰在 CONTRACT §5.3 v1.0 白名单内（未知键服务端 VALIDATION_FAILED）');
    t.eq(Object.keys(failBatch.parcels[0]).sort(), ['failureId', 'imageIndex', 'parcel'].sort(),
      'D24 包裹项键 = {parcel, imageIndex, failureId?}（视图态字段已剥掉）');
    t.eq(payloadOf([stationItem({})]).parcels[0].imageIndex, 0,
      'D25 截图来源件带 imageIndex 指向来源图（缺省 0，多图时逐件映射）');
    // DATA_MODEL §2.5 / CONTRACT §4.2 v1.0：手填件/无截图件必须省略 imageIndex（不许用 0 冒充来自第 1 张图）
    const manualRow = payloadOf([model.makeItem({ stationId: 'P3', pickupCode: 'A12345', manual: true }, {})])
      .parcels[0];
    t.check(Object.prototype.hasOwnProperty.call(manualRow, 'imageIndex') === false,
      'D25b 手填件（manual=true）载荷省略 imageIndex 键（不写 0 冒充来源图）');
    const secondImage = payloadOf([stationItem({ imageIndex: 1 })], {
      images: [IMAGE, IT_IMAGE_BATCH], tickets: [TICKET, IT_TICKET_BATCH]
    });
    t.eq(secondImage.parcels[0].imageIndex, 1,
      'D25c 有来源图的件写实际下标（imageIndex=1 → images[1]，不归零）');
    t.notEmpty(batch.parcels, 'D 组样本非空');
  });

  // ---------------------------------------------------------------- E submission id 生命周期
  h.section('E. submission id 生命周期（格式/重试复用/内容变更重生成/成功清空）', (t) => {
    const seeded = model.createSubmissionId(() => 0.5);
    t.check(model.SUBMISSION_ID_PATTERN.test(seeded) && seeded.length === 24,
      'E1 注入 seed 生成 24 位幂等键（16~32 位 [A-Za-z0-9_-]）');
    const auto = model.createSubmissionId();
    t.check(/^[A-Za-z0-9_-]{16,32}$/.test(auto),
      'E2 默认生成（唯一随机源在 api/client）同样落在 16~32 位值域内');
    t.check(model.isSubmissionId('E'.repeat(16)) && model.isSubmissionId('F'.repeat(32))
      && model.isSubmissionId('short') === false && model.isSubmissionId('B'.repeat(19) + ' ') === false,
    'E3 值域闸：16/32 位合法；<16 位或含空格非法');
    const items = [stationItem({ pickupCode: 'A12345' })];
    const fp = model.submissionFingerprint(items);
    const first = model.ensureSubmission(null, fp, () => 0.25);
    const retry = model.ensureSubmission(first, fp, () => 0.75);
    t.check(first.id === retry.id && model.isSubmissionId(first.id),
      'E4 失败重试（内容不变）复用同一 clientRequestId —— 服务端幂等不重复建单');
    const edited = model.ensureSubmission(first,
      model.submissionFingerprint([stationItem({ pickupCode: 'A99999' })]), () => 0.75);
    t.check(edited.id !== first.id,
      'E5 取件码变更 → 重新生成（内容修改后换键，避免旧幂等命中返回旧单）');
    const noteChanged = model.ensureSubmission(first, model.submissionFingerprint(items, {
      note: '换备注'
    }), () => 0.9);
    t.check(noteChanged.id !== first.id, 'E6 整单备注变更 → 重新生成');
    const slotChanged = model.ensureSubmission(first, model.submissionFingerprint(items, {
      appointType: 'SLOT', startAt: '2026-10-22T08:00:00+08:00', endAt: '2026-10-22T12:00:00+08:00'
    }), () => 0.9);
    t.check(slotChanged.id !== first.id, 'E7 整单预约变更 → 重新生成');
    const imageChanged = model.ensureSubmission(first, model.submissionFingerprint(items, {
      images: [{ fileId: 'cloud://test.env/orders/TKT/image2.jpg' }], tickets: ['TK-ORDER-FLOW-0002']
    }), () => 0.9);
    t.check(imageChanged.id !== first.id, 'E7b 图片/票据变更 → 重新生成（多图指纹进幂等键）');
    const deliveryChanged = model.ensureSubmission(first, model.submissionFingerprint(items, {
      deliveryFingerprint: 'OTHER|X|6|302|小王'
    }), () => 0.9);
    t.check(deliveryChanged.id !== first.id, 'E7c 配送地址变更 → 重新生成（D25）');
    const manualChanged = model.ensureSubmission(first, model.submissionFingerprint(items, {
      manualEntry: true
    }), () => 0.9);
    t.check(manualChanged.id !== first.id, 'E7d 有图↔无截图切换 → 重新生成（D24）');
    const uncheckedChanged = model.ensureSubmission(first, model.submissionFingerprint(
      items.concat([Object.assign(stationItem({}), { checked: false })])), () => 0.3);
    t.check(uncheckedChanged.id === first.id, 'E8 未勾选件变化不影响指纹（不进单的件不算内容变更）');
    t.eq(model.clearSubmission(), null, 'E9 提交成功 → 清空（下一单重新生成，不复用上一单键）');
    const afterClear = model.ensureSubmission(model.clearSubmission(), fp, () => 0.4);
    t.check(model.isSubmissionId(afterClear.id) && afterClear.id !== first.id,
      'E10 清空后再下单拿到新 id');
    t.eq(model.submissionFingerprint([stationItem({}), stationItem({})]),
      model.submissionFingerprint([stationItem({}), stationItem({})]),
      'E11 指纹是纯函数（同内容同指纹，可重复计算）');
    t.notEmpty(items, 'E 组样本非空');
  });

  // ---------------------------------------------------------------- F api/client transport 注入
  h.section('F. api/client：显式 id 进包络/非法回退/写不重试/读重试/13 码人话/超时抛 CallError', async (t) => {
    const seen = [];
    const okResult = (data) => ({ ok: true, data: data === undefined ? {} : data });
    store.reset();
    try {
      client.setTransport((payload) => {
        seen.push(payload);
        return Promise.resolve(okResult({ orderNo: '20261022-0001', order: { orderNo: '20261022-0001' } }));
      });
      const explicit = 'E'.repeat(24);
      const created = await orderApi.create({ parcel: { stationId: 'P3', pickupCode: 'A12345' } },
        { clientRequestId: explicit });
      t.eq(seen[0] && seen[0].action, 'order.create', 'F1 order.create 仍经 api/client 唯一出口');
      t.eq(seen[0] && seen[0].clientRequestId, explicit,
        'F2 显式 clientRequestId 原样进包络（页面重试复用同一键，不再每次现生成）');
      t.check(created && created.orderNo === '20261022-0001', 'F3 成功响应只返回 result.data');
      // F4（v1.0 收口）：order.createBatch 已从服务端移除 → 等价幂等改测单入口 order.create
      // （真实 handler + fake DB）：同一 clientRequestId 重放命中同单（duplicated=true）；
      // 不同 clientRequestId 且内容不同（备注不同，避开合并窗口）→ 新单。
      const idemDb = createOrderDb();
      const idemApi = orderApiOf(idemDb);
      const idemKey = 'idem' + 'E'.repeat(20);
      const idemBody = {
        parcels: [
          { parcel: { stationId: 'P3', pickupCode: 'A12345' } },
          { parcel: { stationId: 'P4', pickupCode: 'B23456' } }
        ],
        images: [IT_IMAGE],
        tickets: [IT_TICKET],
        serviceCode: enums.SERVICE_CODES[0],
        appoint: { type: 'ASAP' },
        note: '',
        manualEntry: false
      };
      const idemFirst = await idemApi.call('order.create', idemBody, { clientRequestId: idemKey });
      t.check(idemFirst.ok === true && !idemFirst.data.duplicated && !!idemFirst.data.orderNo,
        'F4 单入口 order.create 基线建单成功（一单多包裹；createBatch 已移除，等价幂等改测单入口）');
      const idemReplay = await idemApi.call('order.create', idemBody, { clientRequestId: idemKey });
      t.eq([idemReplay.data.duplicated, idemReplay.data.orderNo], [true, idemFirst.data.orderNo],
        'F4b 同 clientRequestId 重放 → duplicated=true 且 orderNo 相同（服务端幂等，不重复建单）');
      const idemOther = await idemApi.call('order.create', Object.assign({}, idemBody, {
        note: '另一张单',
        images: [IT_IMAGE_BATCH],
        tickets: [IT_TICKET_BATCH]
      }), { clientRequestId: 'idem' + 'F'.repeat(20) });
      t.check(idemOther.ok === true && idemOther.data.orderNo !== idemFirst.data.orderNo,
        'F4c 不同 clientRequestId（备注不同，避开合并窗口）→ 新订单，不复用旧单');

      client.setTransport((payload) => {
        seen.push(payload);
        return Promise.resolve(okResult({}));
      });
      await orderApi.create({}, { clientRequestId: 'too-short' });
      t.check(/^[A-Za-z0-9_-]{24}$/.test(String(seen[seen.length - 1].clientRequestId)),
        'F5 非法显式 id 静默回退自生成 24 位（不把格式错误抛给页面）');
      await orderApi.create({}, { clientRequestId: 'B'.repeat(33) });
      t.check(/^[A-Za-z0-9_-]{24}$/.test(String(seen[seen.length - 1].clientRequestId)),
        'F6 超过 32 位同样回退（服务端 16~32 位口径两端一致）');
      t.check(client.isValidClientRequestId('A'.repeat(16)) === true
        && client.isValidClientRequestId('A'.repeat(15)) === false
        && client.isValidClientRequestId('A'.repeat(33)) === false
        && client.isValidClientRequestId(null) === false,
      'F7 isValidClientRequestId 值域闸有牙（16 合法、15/33/null 非法）');

      let writeAttempts = 0;
      client.setTransport(() => {
        writeAttempts += 1;
        return Promise.reject(new client.CallError('DEPENDENCY_FAILED', errorCopy.CODE_COPY.DEPENDENCY_FAILED));
      });
      let writeError = null;
      try {
        await orderApi.create({}, { clientRequestId: explicit });
      } catch (err) {
        writeError = err;
      }
      t.check(writeAttempts === 1 && !!writeError && writeError.code === 'DEPENDENCY_FAILED',
        'F8 写动作不自动重试（attempts=1；重复建单风险由同一 clientRequestId + 服务端幂等兜）');
      t.check(writeError instanceof client.CallError && writeError.message === errorCopy.CODE_COPY.DEPENDENCY_FAILED,
        'F9 超时/网络失败以 CallError + 人话文案抛出（页面只 toast err.message，不暴露英文码）');

      let readAttempts = 0;
      client.setTransport(() => {
        readAttempts += 1;
        if (readAttempts === 1) {
          return Promise.reject(new client.CallError('DEPENDENCY_FAILED', '首次抖动'));
        }
        return Promise.resolve(okResult({ order: { orderNo: '20261022-0002' } }));
      });
      const read = await orderApi.get({ orderNo: '20261022-0002' });
      t.check(readAttempts === 2 && read.order.orderNo === '20261022-0002',
        'F10 读动作自动重试一次后成功（读可重放）');

      client.setTransport(() => Promise.resolve({ ok: false, code: 'PARTNER_CLOSED' }));
      let codeError = null;
      try {
        await orderApi.create({}, { clientRequestId: explicit });
      } catch (err) {
        codeError = err;
      }
      t.check(!!codeError && codeError.code === 'PARTNER_CLOSED'
        && codeError.message === errorCopy.CODE_COPY.PARTNER_CLOSED,
      'F11 13 码 → 人话（PARTNER_CLOSED 用 shared/error-copy 单源文案）');
      client.setTransport(() => Promise.resolve({ ok: false, code: 'BRAND_NEW_CODE' }));
      let unknownError = null;
      try {
        await orderApi.create({}, { clientRequestId: explicit });
      } catch (err) {
        unknownError = err;
      }
      t.eq(unknownError && unknownError.message, errorCopy.UNKNOWN_CODE_COPY,
        'F12 未登记码走兜底文案（不装懂）');

      client.setTransport(() => {
        readAttempts += 1;
        return Promise.reject(new client.CallError('DEPENDENCY_FAILED', errorCopy.CODE_COPY.DEPENDENCY_FAILED));
      });
      readAttempts = 0;
      let timeoutError = null;
      try {
        await orderApi.imageUrl({ orderNo: '20261022-0002' });
      } catch (err) {
        timeoutError = err;
      }
      t.check(readAttempts === 3 && !!timeoutError && timeoutError.code === 'DEPENDENCY_FAILED',
        'F13 读动作重试耗尽后按原错误抛出（有界重试，不无限重试）');
      t.check(!!timeoutError && typeof timeoutError.message === 'string' && timeoutError.message.length > 0
        && !/timeout|TIMEOUT|ECONN|errMsg/.test(timeoutError.message),
      'F14 超时对外只有人话 CallError（不外抛原始 timeout 错误/英文堆栈）');

      let aiAttempts = 0;
      client.setTransport(() => {
        aiAttempts += 1;
        return Promise.reject(new client.CallError('DEPENDENCY_FAILED', errorCopy.CODE_COPY.DEPENDENCY_FAILED));
      });
      let aiError = null;
      try {
        await aiApi.parseParcel({ ocrTextMasked: '取件码', role: 'CUSTOMER' });
      } catch (err) {
        aiError = err;
      }
      t.check(aiAttempts === 1 && !!aiError && aiError.code === 'DEPENDENCY_FAILED',
        'F15 AI 兜底页也不自动重试（attempts=1，避免重复外呼）');

      // v1.0（D23）order.create 载荷契约：单入口 + 多包裹同请求 + clientRequestId 进包络
      // （异步节并发执行，全局 transport 只能由本组独占；服务端 fake-DB 联调由 task-21 的 selftest-order.js 覆盖）
      const createSeen = [];
      client.setTransport((payload) => {
        createSeen.push(payload);
        return Promise.resolve(okResult({ order: { orderNo: '20261022-0003' }, merged: false }));
      });
      const v1Payload = payloadOf([stationItem({ pickupCode: 'A12345' }), stationItem({ pickupCode: 'B23456' })]);
      const createdV1 = await orderApi.create(v1Payload, { clientRequestId: 'ito' + 'E'.repeat(21) });
      t.check(!!createdV1 && !!createdV1.order && createdV1.order.orderNo === '20261022-0003',
        'F16 返回值透传 order（页面据此展示订单号/跳详情）');
      t.eq(createSeen.length, 1, 'F17 一次提交只发一次 order.create（失败重试由页面复用同一键）');
      const env = createSeen[0] || {};
      t.eq(env.action, 'order.create', 'F18 action 经 api/modules/order.create（页面零自拼 action 字面量）');
      t.check(typeof env.clientRequestId === 'string' && env.clientRequestId.length >= 16,
        'F19 clientRequestId 进调用包络（服务端幂等键，重试不重复建单）');
      const body = env.data || {};
      t.eq(Object.keys(body).sort(),
        ['appoint', 'images', 'manualEntry', 'note', 'parcels', 'serviceCode', 'tickets'].sort(),
        'F20 请求体顶层键恰为 CONTRACT §5.3 v1.0 白名单');
      t.eq(body.parcels.length, 2, 'F21 多件在同一请求内提交（多图/多件合成一张订单）');
      t.check(body.images.length === body.tickets.length && body.manualEntry === false,
        'F22 images[i] ↔ tickets[i] 等长；有图时 manualEntry=false');
      const manualPayload = payloadOf([stationItem({})], { images: [], tickets: [] });
      await orderApi.create(manualPayload, { clientRequestId: 'itman' + 'E'.repeat(20) });
      const manualBody = (createSeen[createSeen.length - 1] || {}).data || {};
      t.check((manualBody.images || []).length === 0 && manualBody.manualEntry === true,
        'F23 无截图手填载荷可上送（images=[] + manualEntry=true，D24）');
      t.notEmpty(seen, 'F 组样本非空');
    } finally {
      client.restoreTransport();
      store.reset();
    }
  });

  // ---------------------------------------------------------------- G 页面层静态
  h.section('G. 页面层静态：零 wx.cloud.*/零状态字面量/零 random/零自拼 action/提交接线', (t) => {
    // 有牙正控：合成样本必须被扫描命中（否则"全绿"没有意义）
    const controlHits = pageLayerHits(
      "wx.cloud.callFunction({name:'api'});\n"
      + "const s = 'SUBMITTED';\n"
      + 'const r = Math.random();\n'
      + "const a = 'order.create';\n"
    );
    t.check(controlHits.length === 4, 'G1 正控：合成违规样本被扫描捕获 4 类（扫描有牙）');
    t.eq(pageLayerHits('const x = 1; // 注释里的 wx.cloud.callFunction 不算\n'), [],
      'G2 反例：注释内违规字样不误伤（剥注释后扫描）');
    const pageFiles = listJs(PAGE_SCOPE);
    t.check(pageFiles.length >= 2, 'G3 扫描样本非空（order-create 目录 JS ' + pageFiles.length + ' 个）');
    const realHits = [];
    pageFiles.forEach((rel) => {
      pageLayerHits(textOf(rel)).forEach((hit) => realHits.push(rel + ':' + hit));
    });
    t.eq(realHits, [], 'G4 下单页 JS 零 wx.cloud.*/零七状态字面量/零 random/零自拼 order.create 字面量');
    const page = textOf(ORDER_CREATE_PAGE);
    const flowSource = orderFlowSource();
    t.check(page.indexOf("require('../../../api/modules/order')") >= 0,
      'G5 页面只经 api/modules/order 出入（action 字符串只在 api/）');
    t.check(/ensureSubmission\(/.test(flowSource) && /clearSubmission\(/.test(page),
      'G6 下单链路：进入 Step4 生成/提交前确认幂等键，成功后清空（v1.0 拆到 parts 仍可静态追踪）');
    t.check(/submissionFingerprint\(/.test(flowSource), 'G7 下单链路：内容指纹用于"变更后重新生成"');
    t.check(/clientRequestId:\s*submission\.id/.test(flowSource),
      'G8 提交带 clientRequestId（多件/合并同一键，服务端幂等）');
    t.check(/orderApi\.create\(payload,\s*\{\s*clientRequestId:\s*submission\.id/.test(flowSource)
      && !/createBatch/.test(flowSource),
    'G9 单入口 order.create（v1.0 移除 createBatch），同一 clientRequestId 贯穿整单');
    t.check(!/\bcreateBatch\b/.test(fsutil.stripComments(textOf('api/modules/order.js'))),
      'G9b api/modules/order.js 无 createBatch 导出（过渡动作已随服务端移除，客户端不再有调用入口）');
    t.check(/onManualTap/.test(textOf(ORDER_CREATE_WXML)) && /ocrState === 'ai'/.test(textOf(ORDER_CREATE_WXML)),
      'G10 识别/兜底进行中有「先手动填写」入口（§4.3.1 ③ 不阻塞手填）');
    t.check(/manualPicked/.test(flowSource), 'G11 手填优先：迟到的识别结果不覆盖已手填内容');
    t.check(/recognitionSourceOf\(item\)/.test(textOf(ORDER_MODEL))
      && /recognitionSource/.test(model.buildPayload.toString()),
    'G12 buildPayload 源文本确实把 recognitionSource 写进包裹（不是只在测试里断言）');
    const modelSource = textOf(ORDER_MODEL);
    t.check(/createRequestId\(\)/.test(modelSource),
      'G13 幂等键默认复用 api/client 的唯一随机源（views/页面零 random）');
    t.check(/onRetrySubmit\(\)\s*\{\s*this\.onSubmit\(\)/.test(page),
      'G14 结果块「重试」复用同一提交流程（不再现生成键）');
    const pageXml = textOf(ORDER_CREATE_WXML);
    t.check(/onAppointType/.test(pageXml) && /onSlotChange/.test(pageXml)
      && /onNoteInput/.test(pageXml),
    'G15 Step3 整单预约/备注控件（v1.0：服务/预约/备注每单一份）');
    t.check(/item\.appointType/.test(pageXml) === false && /item\.note/.test(pageXml) === false
      && /data\.appointType/.test(flowSource),
    'G16 无逐件预约/备注残留（提交读整单 data.appointType/note）');
    t.check(/services\[serviceIndex\]\.desc/.test(pageXml),
      'G17 服务类型渲染名称+说明（D6：说明来自 model.serviceOptions 的 desc）');
    t.check(/wx\.previewImage/.test(page) && /onPreviewImage/.test(pageXml),
      'G18 「点击查看截图」入口存在且走本地预览（仍零 wx.cloud.*）');
    t.check(/onToggleOcrText/.test(page) && /查看识别原文/.test(pageXml),
      'G19 「查看识别原文（仅本页显示，不会保存）」折叠入口存在（UX §4.3）');
    t.check(/onCancelAi/.test(page) && /onCancelAi/.test(pageXml) && /ocrState === 'ai'/.test(pageXml),
      'G20 AI 兜底中「取消」按钮（§4.3.1 ③ / AC-C-52）与兜底态条件渲染');
    const fallbackCopy = ocrFlow.AI_FALLBACK_COPY;
    t.check(fallbackCopy.TIMEOUT.text.indexOf('智能识别超时') === 0
      && fallbackCopy.TIMEOUT.text.indexOf('已反馈开发者复核') >= 0
      && fallbackCopy.TIMEOUT.text.indexOf('换一张图') >= 0,
    'G21 超时态文案逐字对齐 §4.3.1（智能识别超时/已反馈开发者复核/换一张图）');
    t.check(fallbackCopy.CLOSED.text.indexOf('没识别出来') >= 0
      && fallbackCopy.LOW.text.indexOf('识别结果不太确定') >= 0
      && fallbackCopy.USER_CANCEL.text.indexOf('已取消智能识别') >= 0,
    'G22 关闭/低置信/用户取消三态文案对齐 §4.3.1（不提示配额、不弹错误码）');
    t.eq(ocrFlow.AI_SUGGESTION_HINT, '智能识别建议，请核对',
      'G23 兜底成功态「智能识别建议，请核对」（§4.3.1 ④ 仍需人核对）');
    t.check(/aiHint/.test(page) && /item\.aiHint/.test(pageXml),
      'G24 逐件降级说明渲染（某件失败只降级该件，§4.3.1 ⑤）');
    // 合并窗口 orderMergeWindowMinutes 是服务端治理参数、不下发客户端：结果区文案不得写死分钟数（UX §4.11）
    t.check(/\d+\s*分钟/.test(pageXml) === false,
      'G25 合并结果说明不写死窗口分钟数（治理参数不下发客户端）');
    t.check(/wx:if="\{\{resultMerged\}\}"[^>]*>[^<]*自动并入/.test(pageXml),
      'G26 合并结果说明用不含量化时间的表述（「短时间内再次下单会自动并入同一订单」）');
    t.notEmpty(pageFiles, 'G 组样本非空');
  });

  // ---------------------------------------------------------------- H 逐件 AI 兜底（纯件，注入替身）
  h.section('H. 逐件 AI 兜底（按单调用/独立 failureId/只填空/某件失败只降级该件/来源优先级）', async (t) => {
    const serviceCode = enums.SERVICE_CODES[0];
    const ctx = {
      ocrTextMasked: '取件码 1234', hintTrackingTail: '99999',
      uploadTicketId: 'TK-ORDER-FLOW-0001', role: 'CUSTOMER'
    };
    const calls = [];
    const suggestionOf = (index) => ({
      recognized: true, stationId: 'P6', stationName: stations.stationNameOf('P6'),
      pickupCode: 'A' + index + '2345', trackingTail: '', lockerNo: '',
      confidence: 'MEDIUM', source: enums.RECOGNITION_SOURCE.RULE,
      needsReview: false, failureId: 'F-20261022-000' + index
    });
    const stub = (payload) => {
      calls.push(payload);
      return Promise.resolve(suggestionOf(calls.length));
    };
    const needCode = Object.assign(model.makeItem({ stationId: 'P3' }, { serviceCode: serviceCode }), {});
    const needStation = model.makeItem({ pickupCode: '' }, { serviceCode: serviceCode });
    const two = await model.applyAiFallbacks([needCode, needStation], ctx, stub);
    t.eq([two.called, two.items.length], [2, 2], 'H1 两件都缺（一件缺码、一件缺站点）→ 按单调用 2 次');
    t.eq(calls.map((payload) => payload.uploadTicketId), [ctx.uploadTicketId, ctx.uploadTicketId],
      'H2 同一张图同一 uploadTicketId（各次调用独立、共享票据）');
    t.eq(two.items.map((item) => item.failureId), ['F-20261022-0001', 'F-20261022-0002'],
      'H3 每件各自独立 failureId（订单 × 截图一条记录，调用粒度保证）');
    t.eq(two.items.map((item) => item.stationId), ['P3', 'P6'],
      'H4 规则已命中的站点不被 AI 覆盖；缺站点件才补（手填/规则优先）');
    t.eq(two.items.map((item) => item.aiState), ['OK', 'OK'], 'H5 兜底成功件标记 aiState=OK');
    t.eq(two.failed, 0, 'H6 成功批次 failed=0（不误报降级）');

    const calls2 = [];
    const stub2 = (payload) => {
      calls2.push(payload);
      return Promise.resolve(suggestionOf(calls2.length));
    };
    const complete = model.makeItem({ stationId: 'P3', pickupCode: 'A12345' }, { serviceCode: serviceCode });
    const full = await model.applyAiFallbacks([complete], ctx, stub2);
    t.eq([full.called, calls2.length, !!full.items[0].failureId], [0, 0, false],
      'H7 已有站点+取件码的件不外呼、不带 failureId（规则优先，不浪费配额）');
    const mixed = await model.applyAiFallbacks([complete, needStation], ctx, stub2);
    t.eq([mixed.called, calls2.length], [1, 1], 'H8 混合批次只对缺字段的那件外呼 1 次');

    let failCalls = 0;
    const flaky = (payload) => {
      failCalls += 1;
      if (failCalls === 1) return Promise.reject(new Error('network boom'));
      return Promise.resolve(suggestionOf(2));
    };
    const flakyResult = await model.applyAiFallbacks(
      [model.makeItem({ stationId: 'P4' }, { serviceCode: serviceCode }), needStation], ctx, flaky);
    t.eq([flakyResult.called, flakyResult.failed, failCalls], [2, 1, 2],
      'H9 逐件调用：某件失败计 failed，其他件照常调用');
    t.eq(flakyResult.items.map((item) => item.aiState), ['TIMEOUT', 'OK'],
      'H10 某件失败只降级该件（TIMEOUT），其余件不受影响');
    t.eq([flakyResult.items[0].stationId, flakyResult.items[1].stationId], ['P4', 'P6'],
      'H11 失败件保留规则字段，成功件正常补站（不互相污染）');

    const degraded = () => Promise.resolve({
      recognized: false, stationId: '', stationName: '', pickupCode: '', trackingTail: '54321',
      lockerNo: '', confidence: 'LOW', source: 'NONE', needsReview: true, failureId: 'F-DEGRADED'
    });
    const degradedResult = await model.applyAiFallbacks(
      [model.makeItem({ stationId: 'P3' }, { serviceCode: serviceCode })], ctx, degraded);
    t.eq([degradedResult.items[0].aiState, degradedResult.items[0].failureId,
      degradedResult.items[0].trackingTail], ['LOW', 'F-DEGRADED', '54321'],
    'H12 降级 DTO：低置信态 + failureId 保留 + 只填空（尾号预填、不覆盖）');
    t.eq(degradedResult.changed, 1, 'H13 降级预填也算 changed=1（页面可提示已预填）');

    const tailCalls = [];
    const tailStub = (payload) => {
      tailCalls.push(payload);
      return Promise.resolve(suggestionOf(1));
    };
    await model.applyAiFallbacks(
      [model.makeItem({ stationId: 'P3', trackingTail: '54321' }, { serviceCode: serviceCode })],
      ctx, tailStub);
    t.eq(tailCalls[0].hintTrackingTail, '54321', 'H14 逐件调用 hintTrackingTail 取该件自己的尾号（不串件）');

    const aiItem = Object.assign(
      model.makeItem({ stationId: 'P3', pickupCode: 'A12345' }, { serviceCode: serviceCode }),
      { source: 'DEEPSEEK', confidence: 'HIGH', aiApplied: true });
    const ruleItem = Object.assign(
      model.makeItem({ stationId: 'P3', pickupCode: 'B23456' }, { serviceCode: serviceCode }),
      { source: enums.RECOGNITION_SOURCE.RULE, confidence: 'MEDIUM' });
    const manualItem = model.withManualEdit(aiItem, { pickupCode: 'C34567' });
    t.eq([model.recognitionSourceOf(manualItem), model.recognitionSourceOf(aiItem),
      model.recognitionSourceOf(ruleItem)], ['MANUAL', 'DEEPSEEK', 'RULE'],
    'H15 recognitionSource 优先级 MANUAL > AI 来源 > RULE（手改覆盖 AI/RULE）');
    t.eq(payloadOf([manualItem, aiItem, ruleItem]).parcels.map((row) => row.parcel.recognitionSource),
      ['MANUAL', 'DEEPSEEK', 'RULE'], 'H16 三件同批进 payload 时包裹级 recognitionSource 互不干扰');
    t.eq(model.withManualEdit(aiItem, { serviceCode: enums.SERVICE_CODES[1] }).source, 'DEEPSEEK',
      'H17 手改非识别字段（服务类型）不降级来源');
    const shell = await model.applyAiFallbacks(
      [model.makeItem({}, { serviceCode: serviceCode })], ctx, stub);
    t.eq([shell.called, shell.items[0].stationId !== ''], [1, true],
      'H18 空壳件（规则一件没解析出）也走一次兜底并只填空');

    // D29：低置信 + AI 来源 → 不写字段，只挂可采纳建议（suggested 计数、failed 不混入）
    const lowStub = () => Promise.resolve({
      recognized: false, stationId: 'P6', stationName: stations.stationNameOf('P6'),
      pickupCode: 'D34567', trackingTail: '', lockerNo: '',
      confidence: 'LOW', source: 'DEEPSEEK', needsReview: true, failureId: 'F-20261022-LOW01'
    });
    const lowResult = await model.applyAiFallbacks(
      [model.makeItem({ stationId: 'P3' }, { serviceCode: serviceCode })], ctx, lowStub);
    t.eq([lowResult.changed, lowResult.suggested, lowResult.failed], [0, 1, 0],
      'H19 低置信+AI 来源：零字段写入、suggested=1、failed 不混入（D29）');
    t.eq([lowResult.items[0].pickupCode, lowResult.items[0].aiState], ['', 'LOW'],
      'H20 低置信件字段保持空（旧行为会预填）、aiState=LOW');
    t.check(!!lowResult.items[0].aiSuggestion
      && lowResult.items[0].aiSuggestion.stationId === 'P6'
      && lowResult.items[0].aiSuggestion.source === 'DEEPSEEK',
    'H21 建议快照挂到件上（站点/来源可展示，供「采纳建议」）');
    const adopted = model.adoptSuggestion(lowResult.items[0]);
    t.eq([adopted.item.stationId, adopted.item.pickupCode, adopted.item.aiSuggestion, adopted.adopted],
      ['P3', 'D34567', null, true],
      'H22 采纳只补空位（规则已填站点保留）、写入建议取件码并清空建议条');
    const adoptedPayload = payloadOf([adopted.item]);
    t.eq([adoptedPayload.parcels[0].parcel.recognitionSource, adoptedPayload.parcels[0].parcel.confidence],
      ['DEEPSEEK', 'LOW'], 'H23 采纳后提交载荷 recognitionSource=DEEPSEEK / confidence=LOW（快照保留）');
    const manualKeep = model.withManualEdit(lowResult.items[0], { pickupCode: 'E45678' });
    const adoptManual = model.adoptSuggestion(manualKeep);
    t.eq(adoptManual.item.pickupCode, 'E45678', 'H24 采纳不得覆盖手填字段（手填优先）');
    t.eq([model.LOW_SUGGESTION_COPY.title, model.LOW_SUGGESTION_COPY.lowHint,
      model.LOW_SUGGESTION_COPY.adopt, model.LOW_SUGGESTION_COPY.adopted],
    ['智能识别建议，请核对', '没把握，点「采纳建议」或手动填写', '采纳建议', '已采纳建议，请再核对'],
    'H25 低置信建议条四句文案逐字（UX §4.3.1 ⑤）');
    const pageSrc = fs.readFileSync(path.join(ROOT, ORDER_CREATE_PAGE), 'utf8');
    const pageXml = fs.readFileSync(path.join(ROOT, ORDER_CREATE_WXML), 'utf8');
    t.check(/model\.adoptSuggestion\(/.test(pageSrc) && /onAdoptSuggestion/.test(pageSrc),
      'H26 页面接线：onAdoptSuggestion 只调 model.adoptSuggestion（判据在纯件）');
    t.check(/wx:if="\{\{item\.aiSuggestion\}\}"/.test(pageXml)
      && /bindtap="onAdoptSuggestion"/.test(pageXml) && /data-index="\{\{index\}\}"/.test(pageXml),
    'H27 件卡建议条接线（aiSuggestion 条件 + 采纳按钮带件下标）');
    t.check(/\{\{lowCopy\.title\}\}/.test(pageXml) && /\{\{lowCopy\.adopt\}\}/.test(pageXml),
      'H28 建议条文案取单源 lowCopy（不写死第二份）');
    t.notEmpty(two.items, 'H 组样本非空');
  });

  // ---------------------------------------------------------------- J ocr-flow 纯件（P0-10 / C2 / 多图增量）
  h.section('J. ocr-flow 纯件：帧降采样 ≤1440 / 失败不谎报 / 多图增量合并', (t) => {
    const big = ocrFlow.frameSizeOf({ width: 4000, height: 3000 });
    t.check(big.ok === true && Math.max(big.width, big.height) <= ocrFlow.VISION_MAX_EDGE,
      'J1 大图 OCR 帧按长边 ≤1440 降采样（P0-10，不按原尺寸建画布）');
    t.eq([big.width, big.height], [1440, 1080], 'J2 降采样保持比例（4000×3000 → 1440×1080）');
    const small = ocrFlow.frameSizeOf({ width: 720, height: 1280 });
    t.eq([small.width, small.height], [720, 1280], 'J3 小图不放大（scale≤1）');
    t.check(ocrFlow.frameSizeOf({ width: 0, height: 0 }).ok === false, 'J4 非法尺寸 → 失败（不建画布）');
    const noQueue = ocrFlow.failureCopyFor('NO_TEXT', {});
    t.check(noQueue.text.indexOf('已反馈') < 0,
      'J5 未入队（无 failureId）不谎称"已反馈开发者复核"（C2 说真话）');
    const queued = ocrFlow.failureCopyFor('NO_TEXT', { failureId: 'F-20261022-0001', aiState: 'CLOSED' });
    t.check(queued.next.indexOf('已反馈') >= 0,
      'J6 已入队（有 failureId）才提示已反馈开发者复核 + 手填引导（C2）');
    const base = [model.makeItem({ stationId: 'P3', pickupCode: 'A12345', imageIndex: 0 }, {})];
    const perImage = [{ imageIndex: 0, ticket: TICKET, image: IMAGE }];
    const result = {
      perImage: [{ imageIndex: 0, ticket: 'TK-ORDER-FLOW-0002',
        image: { fileId: 'cloud://test.env/orders/TKT/image2.jpg', width: 1, height: 1 } }],
      items: [model.makeItem({ stationId: 'P4', pickupCode: 'B23456' }, {})]
    };
    const merged = ocrFlow.mergeItems(base, perImage, result);
    t.eq([merged.items.length, merged.perImage.length], [2, 2], 'J7 新增图的件追加到同一单（不覆盖已有件）');
    t.eq(merged.items.map((item) => item.imageIndex), [0, 1], 'J8 每件 imageIndex 指向来源图（新增图顺延）');
    const dupMerged = ocrFlow.mergeItems(base, perImage, { perImage: [], items: [base[0]] });
    t.eq([dupMerged.items.length, dupMerged.duplicated], [1, 1], 'J9 重复件去重（同站点+码只留一件）');
    // P0-10 截图上传压缩计划（纯件；真机画布/压缩能力只列 QA 点检，不在单测代宣布）
    const ticketPlan = avatar.planTicketCompression({ width: 4000, height: 3000, size: 900 * 1024 }, 500 * 1024);
    t.check(ticketPlan.required === true && ticketPlan.needResize === true
      && ticketPlan.targetLongSide === 1440 && Math.max(ticketPlan.targetWidth, ticketPlan.targetHeight) === 1440,
    'J10 超 500KB 大图压缩计划：长边目标 ≤1440（P0-10）');
    t.check(ticketPlan.qualities.length > 0 && ticketPlan.qualities.length <= 3,
      'J11 质量阶梯 ≤3 档（≤3 次仍超限才拒绝）');
    const smallPlan = avatar.planTicketCompression({ width: 720, height: 1280, size: 100 * 1024 }, 500 * 1024);
    t.check(smallPlan.required === false && smallPlan.needResize === false,
      'J12 已合规截图不压缩（不无谓重编码，避免伤识别质量）');
    t.eq(avatar.planTicketCompression({ width: 0, height: 0, size: 1 }, 500 * 1024).reason, 'UNREADABLE',
      'J13 尺寸读不到 → UNREADABLE（由 api/upload 说真话拒绝，不静默丢图）');
  });

  // ---------------------------------------------------------------- K A 批 P1-8 相册授权 + P1-4 换图替换
  h.section('K. P1-8 不再请求 writePhotosAlbum + P1-4 换图替换/去重（纯件 + 有牙扫描）', (t) => {
    const pickerSrc = textOf('components/image-picker/index.js');
    const pickerStateSrc = textOf('components/image-picker/state.js');
    const privacySrc = textOf('api/privacy.js');
    const pickerHits = (code) => ['writePhotosAlbum', 'ensureAlbumAuth', "require('../../api/privacy')"]
      .filter((key) => String(code || '').indexOf(key) >= 0);
    const oldPicker = "const p = require('../../api/privacy');\nawait privacy.ensureAlbumAuth();\nwx.authorize({ scope: 'scope.writePhotosAlbum' });\n";
    t.eq(pickerHits(oldPicker).length, 3, 'K1 有牙正控：旧实现样本被扫出 3 类（写相册授权/死导出/多余依赖）');
    t.eq(pickerHits(fsutil.stripComments(pickerSrc)).concat(pickerHits(fsutil.stripComments(pickerStateSrc))), [],
      'K2 image-picker 实际源码零命中（选相册不再请求 scope.writePhotosAlbum，TD-060 关闭条件）');
    t.check(fsutil.stripComments(privacySrc).indexOf('writePhotosAlbum') < 0
      && privacySrc.indexOf('ensureAlbumAuth') < 0 && privacySrc.indexOf('ALBUM_SCOPE') < 0,
    'K3 api/privacy.js 已删死导出 ensureAlbumAuth/ALBUM_SCOPE（无生产调用不得保留）');
    t.check(/openSource\(/.test(pickerSrc), 'K4 组件公开 openSource（「重新识别」无图时打开选择器，不空转）');
    const a = { localPath: 'a.jpg' };
    const b = { localPath: 'b.jpg' };
    t.eq([pickerState.mergeFiles([a], [b], 1), pickerState.mergeFiles([a], [b], 5), pickerState.mergeFiles([a, b, a], [b, b], 5).length],
      [[b], [a, b], 5], 'K5 单图模式再选图=替换旧图（选 A→再选 B 只剩 B，F4）；多图模式按 D23 追加并截到上限 5');
    t.eq([pickerState.pickGateOf({ count: 1, maxCount: 1 }).ok, pickerState.pickGateOf({ count: 5, maxCount: 5 }),
      pickerState.pickGateOf({ count: 1, maxCount: 5, uploading: true }).ok],
    [true, { ok: false, limit: true, maxCount: 5 }, false],
    'K6 单图模式满额仍可换图；多图模式满额拦截给上限文案；上传中不再开选择器');
    t.eq([pickerState.newPathsOf([a], ['a.jpg', 'b.jpg']), pickerState.newPathsOf([a], ['a.jpg'])],
      [['b.jpg'], []], 'K7 已上传的同一张图再选不重复上传（失败重试只上一次传新图）');
    t.eq([pickerState.isCancelOf({ errMsg: 'chooseMedia:fail cancel' }),
      pickerState.isCancelOf({ errMsg: 'chooseMedia:fail auth deny' })],
    [true, false], 'K8 用户取消不算错误；权限拒绝才走替代路径文案');
    t.check(pickerState.deniedCopyOf('camera').indexOf('从相册选择') >= 0
      && pickerState.deniedCopyOf('camera').indexOf('从聊天选择') >= 0
      && pickerState.deniedCopyOf('camera').indexOf('不传截图手动填写') >= 0
      && pickerState.deniedCopyOf('album').indexOf('拍照') >= 0,
    'K9 拍照/相册被拒 → 明确替代路径（相册/聊天/拍照 + 不传截图手填，UX §9.2）');
    t.notEmpty(Object.keys(pickerState.DENIED_COPY), 'K 组样本非空');
  });

  // ---------------------------------------------------------------- L A 批 P1-6 范围预检 + P1-9 CUSTOM 备注
  h.section('L. P1-6 提交前服务范围预检 + P1-9「其他代办」强制备注（纯件 + 页面接线）', (t) => {
    const zones = { zones: ['D', 'X'] };
    t.eq(precheck.CUSTOM_SERVICE_CODE, 'CUSTOM', 'L1 「其他代办」服务码取 shared/enums SERVICES 末项 = CUSTOM（不另抄码表）');
    t.eq([precheck.rangeCheckOf({ zone: 'D', partnerPublic: zones }).ok, precheck.rangeCheckOf({ zone: 'N', partnerPublic: zones }).ok,
      precheck.rangeCheckOf({ zone: 'N', partnerPublic: { zones: [] } }).ok, precheck.rangeCheckOf({ zone: '', partnerPublic: zones }).ok],
    [true, false, true, true], 'L2 苑在范围放行/不在范围拦（范围空=全部苑；顾客苑未知不误拦）');
    t.check(precheck.rangeCheckOf({ zone: 'N', partnerPublic: zones }).reason.indexOf('服务范围') >= 0,
      'L3 本地拦截给原因（与首页 P1-6 同句：该兼职的服务范围不含你的苑）');
    t.eq([precheck.noteErrorOf('CUSTOM', ''), precheck.noteErrorOf('CUSTOM', '   '),
      precheck.noteErrorOf('CUSTOM', '帮我去修电脑'), precheck.noteErrorOf('PICKUP_STD', '')],
    [precheck.CUSTOM_NOTE_TEXT, precheck.CUSTOM_NOTE_TEXT, '', ''],
    'L4 CUSTOM 空/纯空白备注 → 行内红字；有备注放行；非 CUSTOM 不强制（AC-C-15）');
    const step3Src = textOf('pkg-customer/pages/order-create/parts/step3.js');
    t.check(step3Src.indexOf('noteErrorOf(') >= 0 && /if \(noteError\)/.test(step3Src)
      && step3Src.indexOf('if (noteError)') < step3Src.indexOf("appointType === 'SLOT'"),
    'L5 Step3 下一步先判备注（挡在预约/地址之前），判据在 precheck 纯件（页面零判据）');
    const pageXml = textOf(ORDER_CREATE_WXML);
    t.check(/\{\{noteError\}\}/.test(pageXml) && /noteError \? 'btn-disabled'/.test(pageXml),
      'L6 备注行内红字渲染 + 下一步置灰（{{noteError}} / btn-disabled）');
    const submitSrc = textOf('pkg-customer/pages/order-create/parts/submit.js');
    t.check(submitSrc.indexOf('const range = rangeBlockOf(page)') >= 0
      && submitSrc.indexOf('const range = rangeBlockOf(page)') < submitSrc.indexOf('orderApi.create('),
    'L7 提交前先做本地范围预检（在 orderApi.create 之前 return，不产生失败请求）');
    t.check(/store\.snapshot\(\)/.test(submitSrc) && !/configApi|bindApi|customerApi/.test(submitSrc),
      'L8 预检数据只读 store 快照（customer.zone / binding.partnerPublic.zones），不新增请求');
    t.notEmpty(zones.zones, 'L 组样本非空');
  });

  // ---------------------------------------------------------------- M A 批 P1-4 重试/失败卡出路（D24）
  h.section('M. P1-4 重新识别/失败卡出路（无图打开选择器 / 有图原地重识别 / D24 两条出路）', (t) => {
    const fileA = { localPath: 'a.jpg', fileId: 'cloud://x/a.jpg', uploadTicketId: 'TK-A' };
    const manualItem = { manual: true };
    const ocrItem = { manual: false, stationId: 'P3' };
    t.eq([filesFlow.retryPlanOf({ files: [] }).mode,
      filesFlow.retryPlanOf({ files: [fileA], items: [manualItem] }).confirm,
      filesFlow.retryPlanOf({ files: [fileA], items: [ocrItem] }).confirm], ['picker', false, true],
    'M1 无本地图→打开选择器（不空转）；有图→原地重识别；清空已识别件前需二次确认（UX §4.5）');
    t.check(filesFlow.retryPlanOf({ files: [] }).source === 'album', 'M2 无图时默认打开相册选择器（用户仍可选其他来源）');
    t.check(filesFlow.FAIL_NEXT_UPLOAD.indexOf('不传截图') >= 0
      && filesFlow.FAIL_NEXT_UPLOAD.indexOf('重新选择截图') >= 0,
    'M3 上传失败卡文案给两条真实出路（补截图 / 不传截图手填，D24）');
    const oldCopyHits = (code) => /必须先(有|上传)截图/.test(String(code || ''));
    t.check(oldCopyHits('上传失败：必须先有截图才能提交'), 'M4 有牙正控：旧「必须先有截图」文案样本被扫出');
    t.eq(oldCopyHits(fsutil.stripComments(orderFlowSource())) || /必须先(有|上传)截图/.test(textOf(ORDER_CREATE_WXML)),
      false, 'M5 下单链路不再出现「必须先有截图」类旧文案（D24：无截图手填合法）');
    const flowSrc = textOf('pkg-customer/pages/order-create/parts/files-flow.js');
    t.check(flowSrc.indexOf('identifyMany(') >= 0 && flowSrc.indexOf('prepareAndUpload') < 0
      && flowSrc.indexOf('api/upload') < 0 && /filesFlow\.onRetryOcr\(this\)/.test(textOf(ORDER_CREATE_PAGE)),
    'M6 重识别复用已上传的 fileId/票据（不重新上传同一图），页面「重新识别」接到 filesFlow');
    const xml = textOf(ORDER_CREATE_WXML);
    t.check(/bindtap="onManualOnlyTap"/.test(xml) && /bindtap="onRetryOcr"/.test(xml)
      && /重新选择截图/.test(xml) && /bindtap="onManualTap"/.test(xml),
    'M7 失败卡两条出路接线（不传截图手填/手动填写 + 重新选择截图/重新识别）');
    t.notEmpty([fileA], 'M 组样本非空');
  });

}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-order-flow' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-order-flow');
  h.setExpected(EXPECTED_ASSERTIONS === 0 ? -1 : EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
