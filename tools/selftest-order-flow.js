'use strict';
/**
 * tools/selftest-order-flow.js — 顾客下单链路端侧断言套件（A~O；ENGINEERING §7.2）。
 * A 站点 / B 服务类型 / C canSubmit / D buildPayload / E submission id / F api/client transport /
 * G 页面静态 / H 逐件 AI 兜底 / J ocr-flow 纯件 / K image-picker（P1-8/P1-4/D44 多图并发）/
 * L 范围预检+CUSTOM 备注 / M 重新识别失败卡出路 / N 取件码标签+Step1 回迁 / O D44 上传链路 size 解析。
 * 纪律：不 mock 全局 wx（api/client 用 setTransport 注入替身）；fake 数据、不连真云；先合法基线再反例；
 *       样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-order-flow.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard } = require('./selftest');
const ROOT = path.resolve(__dirname, '..');
const model = require(path.join(ROOT, 'pkg-customer/pages/order-create/parts/model.js'));
const appointUtil = require(path.join(ROOT, 'shared/appoint.js'));
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
const uploadApi = require(path.join(ROOT, 'api/upload.js'));
const { createFakeDb } = require('./fake-db');
const orderFlowClientCases = require('./lib/order-flow-client-cases');
const orderFlowPipelineCases = require('./lib/order-flow-pipeline-cases');
const CLOUD_API = path.join(ROOT, 'cloudfunctions/api');
const app = require(path.join(CLOUD_API, 'app.js'));
const parcelsInput = require(path.join(CLOUD_API, 'handlers/order/_parcels-input.js'));
const { COLLECTIONS } = require(path.join(CLOUD_API, 'shared/collections.js'));
const serverEnums = require(path.join(CLOUD_API, 'shared/enums.js'));
const EXPECTED_ASSERTIONS = 277; // 256 + 21：R 组 P0-1 多图 imageIndex 重映射 9 + S 组 P1-10 取消识别 8 + Q13~Q16 日历日回算 4 // 242 + 14：D47 预约客户端 Q 组（选项/载荷/摘要/指纹/文案/接线） // 210 + 32（P0-1：P1~P30 + P26b 流水线化 31 + P 组样本非空 1）

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
    t.check(model.MAX_PARCELS === 10 && model.MAX_IMAGES === 10,
      'C4 页面上界与 CONTRACT §5.2/D40 同值（包裹 ≤10、截图 ≤10，取共享常量）');
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
    const latestPayload = payloadOf([stationItem({})], {
      appoint: { type: 'LATEST', latestAt: '2026-11-01T18:00:00+08:00' }
    });
    t.eq(latestPayload.appoint, { type: 'LATEST', latestAt: '2026-11-01T18:00:00+08:00' },
      'D13 预约是整单一份（D47：LATEST 载荷整单透传，不逐件）');
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
    const latestFp = { appointType: 'LATEST', latestAt: '2026-11-01T18:00:00+08:00' };
    const latestChanged = model.ensureSubmission(first, model.submissionFingerprint(items, latestFp), () => 0.9);
    t.check(latestChanged.id !== first.id, 'E7 整单预约变更 → 重新生成（D47 最晚时间进指纹）');
    const shiftedFp = model.submissionFingerprint(items,
      Object.assign({}, latestFp, { latestAt: '2026-11-01T18:30:00+08:00' }));
    t.check(shiftedFp !== model.submissionFingerprint(items, latestFp),
      'E7e 同「最晚时间」改到另一刻 → 指纹变化（latestAt 进指纹，不复用旧幂等键）');
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
  // ---------------------------------------------------------------- F api/client transport 注入
  // （拆件：用例表外移 tools/lib/order-flow-client-cases.js，控测试文件 ≤1000 行）
  h.section('F. api/client：显式 id 进包络/非法回退/写不重试/读重试/13 码人话/超时抛 CallError', async (t) => {
    await orderFlowClientCases.clientChecks(t, {
      client, store, orderApi, aiApi, errorCopy, enums, createOrderDb, orderApiOf, payloadOf, stationItem,
      IT_TICKET, IT_IMAGE, IT_TICKET_BATCH, IT_IMAGE_BATCH
    });
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
    t.check(/onAppointType/.test(pageXml) && /onLatestDate/.test(pageXml) && /onLatestTime/.test(pageXml)
      && /onLatestPreset/.test(pageXml) && /onNoteInput/.test(pageXml),
    'G15 Step3 整单预约/备注控件（D47：尽快/最晚时间 + 日期/时间/预设；备注每单一份）');
    t.check(/item\.appoint/.test(pageXml) === false && /item\.note/.test(pageXml) === false
      && /data\.appoint/.test(flowSource),
    'G16 无逐件预约/备注残留（提交读整单 data.appoint/note）');
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
    const mergedCopyAt = pageXml.indexOf('再次下单会自动并入同一订单');
    t.check(mergedCopyAt >= 0
      && /\d+\s*分钟/.test(pageXml.slice(mergedCopyAt - 200, mergedCopyAt + 200)) === false,
    'G25 合并结果说明不写死窗口分钟数（治理参数不下发客户端；D47 时间粒度文案不在此块）');
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
    const plan = pickerState.uploadPlanOf(5);
    t.eq([pickerState.UPLOAD_CONCURRENCY, plan.concurrency, plan.batches], [2, 2, [[0, 1], [2, 3], [4]]], 'K17 D44 多图上传并发 2（分批计划纯件；P0-1 组件侧）');
    const chatMeta = pickerState.pickedFileOf({ path: 'wxfile://tmp/c.jpg', size: 4096, name: 'c.jpg', type: 'image' });
    t.eq([chatMeta.size, chatMeta.name, chatMeta.type, pickerState.fileSnapshotOf(chatMeta, { size: 2048 }).size], [4096, 'c.jpg', 'image', 2048], 'K18 聊天图 {path,size,name,type} 透传（事件快照带元数据；size 取上传后真实值）');
    const pickerSrc2 = textOf('components/image-picker/index.js');
    t.check(pickerSrc2.indexOf('pickedFilesOf') >= 0 && pickerSrc2.indexOf('uploadPlanOf') >= 0 && pickerSrc2.indexOf('Promise.all') >= 0 && pickerSrc2.indexOf('size: meta.size') >= 0 && pickerSrc2.indexOf('fileSnapshotOf(meta, uploaded)') >= 0 && pickerSrc2.indexOf("triggerEvent('change', { files })") >= 0, 'K19 组件接线：聊天图元数据透传 + 分批并发上传 + change 事件 files 快照带 size/name/type');
    const uploadSrc = textOf('api/upload.js');
    t.check(uploadSrc.indexOf('cancelTicket') < 0 && uploadSrc.indexOf('resolveTicketSize') >= 0 && uploadSrc.indexOf('boundedReadBytes') >= 0, 'K20 api/upload：删死导出 cancelTicket + size 三级解析');
    t.notEmpty(Object.keys(pickerState.DENIED_COPY), 'K 组样本非空');
  });
  // ---------------------------------------------------------------- L A 批 P1-6 范围预检 + P1-9 CUSTOM 备注
  h.section('L. P1-6 提交前服务范围预检 + P1-9「其他代办」强制备注（纯件 + 页面接线）', (t) => {
    const zones = { zones: ['D', 'X'] };
    t.eq([precheck.CUSTOM_SERVICE_CODE, enums.CUSTOM_SERVICE_CODE, serverEnums.CUSTOM_SERVICE_CODE], ['CUSTOM', 'CUSTOM', 'CUSTOM'], 'L1 「其他代办」服务码=shared/enums 显式常量 CUSTOM（TD-070：不再取 SERVICES 末项；客户端与服务端副本同值）');
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
      && step3Src.indexOf('if (noteError)') < step3Src.indexOf('appointUtil.validateOf('),
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
  // ---------------------------------------------------------------- N 第 2 批反馈 ⑧⑨（取件码标签 + Step1 回迁）
  h.section('N. ⑧取件码前置标签/同构 + ⑨Step1「下一步：核对」回迁与手填二次确认（静态接线 + 有牙正控）', (t) => {
    const xml = textOf(ORDER_CREATE_WXML);
    const src = textOf(ORDER_CREATE_PAGE);
    const step1 = xml.slice(xml.indexOf('step === 1'), xml.indexOf('step === 2'));
    const labelBeforeCode = (s) => { const l = s.indexOf('<view class="form-label">取件码</view>'); const c = s.indexOf('<code-editor'); return l >= 0 && c >= 0 && l < c; };
    const manualConfirm = (s) => /wx\.showModal\(/.test(String(s)) && String(s).indexOf('会清空已选截图和已识别') >= 0;
    t.check(labelBeforeCode('<code-editor value="{{item.pickupCode}}" placeholder="取件码（可留空，填运单后 5 位）" bind:change="onCodeChange" />') === false, 'N1 正控：旧 WXML 取件码裸输入被判「无前置标签」（判据有牙）');
    t.check(manualConfirm('onManualOnlyTap() { if (this.data.readonly) return; this.setData({ files: [] }); }') === false, 'N2 正控：旧 onManualOnlyTap 无二次确认被判否（判据有牙）');
    t.check(labelBeforeCode(xml) === true, 'N3 取件码前置标签「取件码」在 code-editor 之前（与站点/柜号/尾号同构）');
    t.check(xml.indexOf('placeholder="可留空，填运单后 5 位"') >= 0 && xml.indexOf('placeholder="取件码（') < 0, 'N4 取件码 placeholder 不再重复字段名（字段名由前置标签表达）');
    t.notEmpty(step1, 'N5 Step1 视图切片非空（样本有效）');
    t.check(/已识别 \{\{items\.length\}\} 件/.test(step1) && /截图 \{\{files\.length\}\} 张/.test(step1), 'N6 Step1 回退摘要「已识别 N 件 · 截图 M 张」（image-picker 不回显时数据仍在可见）');
    t.check(step1.indexOf('wx:if="{{items.length}}"') >= 0 && step1.indexOf('bindtap="goStep1Next"') >= 0, 'N7 Step1 有已填件时出现「下一步：核对」按钮（wx:if items.length + goStep1Next 接线）');
    t.check(/goStep1Next\(\)\s*\{\s*this\.setData\(\{\s*step:\s*2\s*\}\);\s*\}/.test(src), 'N8 goStep1Next 方法体只 setData({step:2})（不触碰 files/items，返回不丢已填件）');
    t.check(manualConfirm(src) === true, 'N9 「不传截图，手动填写」有内容时二次确认（wx.showModal + 说明清空已选截图与已识别件）');
  });
  h.section('O. D44 上传链路：聊天图 size 缺失不按 0 必拒（三级真实字节数解析）', async (t) => {
    const managerOf = (bytes) => ({ getFileSystemManager: () => ({ getFileInfo: (opts) => { if (opts && opts.fail) opts.fail(); }, readFile: (opts) => { if (opts && opts.success) opts.success({ data: new ArrayBuffer(bytes) }); } }) });
    const hitInfo = { getFileSystemManager: () => ({ getFileInfo: (opts) => { if (opts && opts.success) opts.success({ size: 512 }); } }) };
    const declared = await uploadApi.resolveTicketSize(managerOf(100), 'wxfile://tmp/a.jpg', 2048);
    const platform = await uploadApi.resolveTicketSize(hitInfo, 'wxfile://tmp/b.jpg', 0);
    const probed = await uploadApi.resolveTicketSize(managerOf(300), 'wxfile://tmp/c.jpg', 0);
    const none = await uploadApi.resolveTicketSize({}, 'wxfile://tmp/d.jpg', 0);
    t.eq([declared.size, declared.source, platform.size, platform.source, probed.size, probed.source, none.size, none.source],
      [2048, 'PICKED', 512, 'PLATFORM', 300, 'READ', 0, 'NONE'], 'O1 size 三级解析：选图元数据→getFileInfo→有界 readFile 真实字节数（元数据缺失不直接拒）');
    t.check(textOf('api/upload.js').indexOf('await resolveTicketSize(') >= 0, 'O2 prepareTicket 接到三级解析（不再按 0 必拒；真实字节数交服务端 500KB 闸）');
  });
  // ---------------------------------------------------------------- P 性能 P0-1 下单流水线化
  // （用例表外移 tools/lib/order-flow-pipeline-cases.js：组件渐进上传事件 + 页面编排侧重叠调度）
  h.section('P. P0-1 下单流水线化：上传与识别重叠/并发 2/乱序回填/AI 按件并行（纯件 + 接线）', async (t) => {
    await orderFlowPipelineCases.pipelineChecks(t, {
      ocrFlow, model, pickerState, filesFlow, textOf
    });
  });
  // ---------------------------------------------------------------- Q 预约「最晚可接受时间」（D47，客户端）
  h.section('Q. 预约「最晚可接受时间」：选项/预选/载荷/摘要/指纹/文案与接线（D47）', (t) => {
    const nowMs = Date.parse('2026-11-01T10:00:00+08:00');
    const base = appointUtil.createState(nowMs, 'ASAP');
    t.eq([base.type, appointUtil.summaryOf(base), appointUtil.payloadOf(base, nowMs)],
      ['ASAP', '尽快', { type: 'ASAP' }], 'Q1 默认尽快：摘要「尽快」、载荷不带时间');
    t.eq([appointUtil.normalizeType('ASAP'), appointUtil.normalizeType('LATEST'), appointUtil.normalizeType('SLOT')],
      ['ASAP', 'LATEST', 'ASAP'], 'Q2 新单可选预约类型只有 ASAP/LATEST（SLOT/未知值一律降级尽快）');
    const latest = appointUtil.setType(base, 'LATEST', nowMs);
    t.eq([latest.type, latest.date, latest.time, latest.latestText],
      ['LATEST', '2026-11-01', '12:00', '最晚 11月1日 12:00'],
      'Q3 切最晚时间：自动预选今天最近合法预设（30 分钟整点）');
    t.eq(appointUtil.payloadOf(latest, nowMs),
      { type: 'LATEST', latestAt: '2026-11-01T12:00:00+08:00' },
      'Q4 提交载荷 latestAt 为 UTC+8 ISO 串（服务端再按 now 收紧）');
    t.check(appointUtil.pickPreset(latest, '22:00', nowMs).time === '22:00'
      && appointUtil.setTime(latest, '18:30', nowMs).time === '18:30',
    'Q5 预设 12/18/22 与自定义 30 分钟档都可用（pickPreset/setTime）');
    t.check(appointUtil.INVALID_LATEST_COPY.indexOf('30 分钟') >= 0
      && appointUtil.LATEST_NOTE_COPY.indexOf('不改变') >= 0
      && appointUtil.LATEST_NOTE_COPY.indexOf('不会自动取消') >= 0
      && appointUtil.SLOT_DOWNGRADE_COPY.indexOf('最晚时间') >= 0,
    'Q6 文案：30 分钟粒度提示 + 不改变接单时限/不自动取消 + SLOT 降级说明（D47）');
    const bad = appointUtil.setDate(latest, '2026-10-01', nowMs);
    t.check(appointUtil.validateOf(bad, nowMs).ok === false && bad.error !== '',
      'Q7 过去日期 → 下一步拦截并给行内提示（服务端仍唯一权威）');
    t.eq(appointUtil.fingerprintOf(latest)
      !== appointUtil.fingerprintOf(appointUtil.pickPreset(latest, '18:00', nowMs)),
    true, 'Q8 最晚时间变化进提交指纹（换幂等键，避免旧键吞新内容）');
    const pageXml = textOf(ORDER_CREATE_WXML);
    t.check(/value="LATEST"/.test(pageXml) && /最晚时间/.test(pageXml)
      && /onLatestPreset/.test(pageXml) && /30 ?分钟/.test(pageXml),
    'Q9 Step3 渲染「尽快/最晚时间」单选 + 预设/时间入口 + 30 分钟粒度说明（SLOT 不再出现为可选项）');
    t.check(pageXml.indexOf('value="SLOT"') < 0 && pageXml.indexOf('预约时段</label>') < 0,
      'Q10 新单不可选 SLOT（WXML 无 SLOT 单选；历史单详情仍展示）');
    const submitSrc = textOf('pkg-customer/pages/order-create/parts/submit.js');
    t.check(/appointUtil\.payloadOf\(/.test(submitSrc) && submitSrc.indexOf("type: 'LATEST'") < 0
      && submitSrc.indexOf('startAt') < 0 && submitSrc.indexOf('endAt') < 0,
    'Q11 提交载荷走 shared/appoint 单源（页面不手拼 latestAt/时段字段）');
    const step3PageSrc = textOf(ORDER_CREATE_PAGE);
    t.check(/onLatestDate\(/.test(step3PageSrc) && /onLatestTime\(/.test(step3PageSrc)
      && /onLatestPreset\(/.test(step3PageSrc),
    'Q12 页面接线 onLatestDate/onLatestTime/onLatestPreset（方法只转发 parts/step3）');
    // P2：日历日回算（Date.UTC 会把 2026-02-30 静默归一成 3-02；回算年月日不一致即非法）
    const badDate = { type: 'LATEST', date: '2026-02-30', time: '18:00' };
    t.check(new Date(Date.UTC(2026, 1, 30)).getUTCMonth() === 2, 'Q13 正控：Date.UTC 确实把 2-30 归一成 3 月（回算判据有牙的前提）');
    t.eq([appointUtil.dateTimeMs('2026-02-28', '12:00') > 0, appointUtil.dateTimeMs('2028-02-29', '12:00') > 0], [true, true],
      'Q14 合法基线：普通日期与闰年 2-29 都能解析（回算不误伤合法值）');
    t.eq([appointUtil.dateTimeMs('2026-02-30', '12:00'), appointUtil.dateTimeMs('2026-04-31', '12:00'),
      appointUtil.dateTimeMs('2026-02-29', '12:00'), appointUtil.dateTimeMs('2026-13-01', '12:00')], [0, 0, 0, 0],
    'Q15 日历不存在的日期（2-30/4-31/非闰年 2-29/13 月）一律返回 0（不归一冒充合法值）');
    t.check(appointUtil.validateOf(badDate, nowMs).ok === false && appointUtil.payloadOf(badDate, nowMs).latestAt === '',
      'Q16 非法日历日 → 下一步拦截且提交载荷不带 latestAt（服务端仍唯一权威）');
    t.notEmpty(appointUtil.timeOptions(), 'Q 组样本非空');
  });
  // ---------------------------------------------------------------- R P0-1 多图 imageIndex 重映射（可提交性）
  h.section('R. P0-1 多图 imageIndex 重映射：images[] 过滤后件下标仍合法且指向正确来源图', (t) => {
    const files = [imageFileOf(1), imageFileOf(2), imageFileOf(3)];
    // 3 张图、中间一张 image=null（识别前解码失败）：该图被 buildImages 过滤，images 只有 2 张
    const perImage = [
      { imageIndex: 0, ticket: files[0].uploadTicketId, image: { fileId: files[0].fileId, width: 1080, height: 1440 } },
      { imageIndex: 1, ticket: files[1].uploadTicketId, image: null },
      { imageIndex: 2, ticket: files[2].uploadTicketId, image: { fileId: files[2].fileId, width: 1080, height: 1440 } }
    ];
    const page = identifyPageOf();
    filesFlow.applyIdentify(page, [
      model.makeItem({ stationId: 'P3', pickupCode: 'A12345', imageIndex: 0 }, {}),
      model.makeItem({ stationId: 'P4', pickupCode: 'B23456', imageIndex: 2 }, {})
    ], perImage, { ocrState: 'done' });
    t.eq([page.data.images.length, page.data.tickets.length], [2, 2], 'R1 被过滤图（image=null）不进 images/tickets');
    t.eq(page.data.items.map(function idx(item) { return item.imageIndex; }), [0, 1],
      'R2 件级 imageIndex 从文件序号重映射为 images[] 下标（0/2 → 0/1，不再错位）');
    t.eq([page.data.step, page.data.ocrState], [2, 'done'], 'R3 合法收口仍进 Step2（重映射不改既有步进）');
    const payload = payloadOf(page.data.items, { images: page.data.images, tickets: page.data.tickets });
    let judgeError = null;
    let normalized = [];
    try { normalized = parcelsInput.normalizeParcels(payload, 'MANUAL', payload.images.length); } catch (err) { judgeError = err; }
    t.check(judgeError === null && normalized.length === 2, 'R4 生成包裹经 _parcels-input 判据无「第 k 件的截图序号不正确」');
    t.eq(normalized.map(function idx(parcel) { return parcel.imageIndex; }), [0, 1],
      'R5 服务端归一后 imageIndex 落在 images[] 合法域（0..images.length-1）');
    t.eq(normalized.map(function file(parcel) { return payload.images[parcel.imageIndex].fileId; }),
      [files[0].fileId, files[2].fileId],
      'R6 imageIndex 指向正确来源文件（第 3 张图的件 → images[1]=第 3 张，不错指被过滤的第 2 张）');
    let redError = null;
    try {
      parcelsInput.normalizeParcels({ parcels: [{ parcel: { stationId: 'P3', pickupCode: 'A12345' }, imageIndex: 2 }],
        images: payload.images, tickets: payload.tickets }, 'MANUAL', 2);
    } catch (err) { redError = err; }
    t.check(redError !== null && !!redError.data && redError.data.field === 'imageIndex',
      'R7 正控：未重映射的 imageIndex=2（images 只有 2 张）被服务端判据拒绝（判据有牙）');
    const filteredPage = identifyPageOf();
    filesFlow.applyIdentify(filteredPage, [model.makeItem({ stationId: 'P3', pickupCode: 'C34567', imageIndex: 1 }, {})],
      perImage, { ocrState: 'failed' });
    const filteredPayload = payloadOf(filteredPage.data.items,
      { images: filteredPage.data.images, tickets: filteredPage.data.tickets });
    t.check(Object.prototype.hasOwnProperty.call(filteredPayload.parcels[0], 'imageIndex') === false,
      'R8 来源图被过滤的件省略 imageIndex 键（D25b：不写 0 冒充来源图）');
    t.notEmpty(payload.images, 'R 组样本非空');
  });
  // ---------------------------------------------------------------- S P1-10 取消智能识别
  h.section('S. P1-10 取消智能识别：丢弃在飞会话 + 迟到收口作废（不覆盖/不自动跳步）', async (t) => {
    const files = [imageFileOf(1)];
    const resultOf = function resultOf(seq) {
      return { ok: true, items: [model.makeItem({ stationId: 'P3', pickupCode: 'A' + seq + '2345' }, {})],
        perImage: [{ imageIndex: 0, ticket: files[0].uploadTicketId, image: { fileId: files[0].fileId, width: 1080, height: 1440 } }] };
    };
    const basePage = identifyPageOf();
    await filesFlow.runIdentify(basePage, files, [], [], { finish: function done() { return Promise.resolve(resultOf(1)); } });
    t.eq([basePage.data.items.length, basePage.data.step, basePage.data.ocrState], [1, 2, 'done'],
      'S1 基线：未取消时收口写回并进 Step2（取消判据不误伤正常路径）');
    const page = identifyPageOf();
    let settle = null;
    const inflight = filesFlow.runIdentify(page, files, [], [], {
      finish: function finish() { return new Promise(function executor(resolve) { settle = resolve; }); }
    });
    await Promise.resolve();
    filesFlow.onCancelAi(page);
    t.eq([page.data.manualPicked, page.data.ocrState, page.data.failureText, page.data.failureNext],
      [true, 'failed', ocrFlow.AI_FALLBACK_COPY.USER_CANCEL.text, ocrFlow.AI_FALLBACK_COPY.USER_CANCEL.next],
      'S2 取消即按 §4.3.1 USER_CANCEL 落盘（文案取 parts/ai-fallback 单源）');
    settle(resultOf(1));
    await inflight;
    t.eq([page.data.items.length, page.data.step, page.data.ocrState], [0, 1, 'failed'],
      'S3 迟到识别结果作废：不覆盖 items、不自动跳步骤、不把取消态改回 done');
    await filesFlow.runIdentify(page, files, [], [], { finish: function done() { return Promise.resolve(resultOf(2)); } });
    t.eq([page.data.items.length, page.data.items[0].pickupCode], [1, 'A22345'],
      'S4 取消后新一轮识别正常收口（取消不是粘滞态）');
    const pageSrc = textOf(ORDER_CREATE_PAGE);
    const flowSrc = textOf('pkg-customer/pages/order-create/parts/files-flow.js');
    t.check(/onCancelAi\(\) \{\s*filesFlow\.onCancelAi\(this\);\s*\}/.test(pageSrc),
      'S5 页面 onCancelAi 只一行转发 parts/files-flow（页面零编排判据）');
    const finishAt = flowSrc.indexOf('await session.finish(list)');
    t.check(finishAt >= 0 && flowSrc.indexOf('runCanceled(page, gen)', finishAt) > finishAt, 'S6 迟到收口在写回前校验取消代次（会话 token 缺口的补偿判据）');
    t.check(/cancelRun\(page\)/.test(flowSrc) && flowSrc.indexOf('discardSession(page)') >= 0,
      'S7 取消走 discardSession 单源（丢弃在飞会话，不另写一份）');
    t.notEmpty(basePage.data.items, 'S 组样本非空');
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
