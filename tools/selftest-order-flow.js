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
 *      某件失败只降级该件/降级 DTO 只预填/recognitionSource 优先级 MANUAL > AI 来源 > RULE
 *   I. 服务端契约联调（fake DB，真实 handler）：严格白名单接受/拒绝、recognition.source 落库、
 *      拆单逐单 source 不串、ORDER_CREATED 事件与零写入
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
const { createFakeDb } = require('./fake-db');

const CLOUD_API = path.join(ROOT, 'cloudfunctions/api');
const app = require(path.join(CLOUD_API, 'app.js'));
const { COLLECTIONS } = require(path.join(CLOUD_API, 'shared/collections.js'));
const serverEnums = require(path.join(CLOUD_API, 'shared/enums.js'));

const EXPECTED_ASSERTIONS = 135; // 实际断言总数（少算/多算都判红）

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

function payloadOf(items, recognition) {
  return model.buildPayload(items, TICKET, IMAGE, recognition || {});
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
  h.section('C. canSubmit 五态与上界（空选/超 5 件/缺站点/无码无尾号/形态闸/恰好 5 件）', (t) => {
    const empty = model.canSubmit([]);
    t.check(empty.ok === false && empty.reason.indexOf('至少选择一件') === 0,
      'C1 空选 → 拒绝（至少选择一件再提交）');
    const unchecked = model.canSubmit([Object.assign(stationItem({}), { checked: false })]);
    t.check(unchecked.ok === false && unchecked.reason.indexOf('至少选择一件') === 0,
      'C2 全部取消勾选 → 拒绝（勾选件才是提交集）');
    const tooMany = model.canSubmit(new Array(orderState.MAX_CREATE_BATCH + 1).fill(0)
      .map(() => stationItem({})));
    t.check(tooMany.ok === false && tooMany.reason.indexOf('一图最多拆 5 件') >= 0,
      'C3 超过上界（MAX_CREATE_BATCH+1）→ 拒绝且文案带上界');
    t.eq(orderState.MAX_CREATE_BATCH, model.MAX_BATCH,
      'C4 页面上界与服务端 MAX_CREATE_BATCH 同源（不写死两份数字）');
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
    const exactlyMax = model.canSubmit(new Array(orderState.MAX_CREATE_BATCH).fill(0)
      .map(() => stationItem({})));
    t.check(exactlyMax.ok === true && exactlyMax.items.length === orderState.MAX_CREATE_BATCH,
      'C10 恰好 MAX_CREATE_BATCH 件 → 可提交（上界含等于）');
    t.eq([exactlyMax.items.length, model.MAX_BATCH], [5, 5], 'C11 上界取真实常量 5（CONTRACT §5.3）');
    t.notEmpty(exactlyMax.items, 'C 组样本非空');
  });

  // ---------------------------------------------------------------- D buildPayload 形状
  h.section('D. buildPayload：单件/拆单/共享 image/failureId/recognitionSource/confidence', (t) => {
    const manual = stationItem({});
    const single = payloadOf([manual]);
    t.check(single.single === true && single.batch === false && single.items.length === 1,
      'D1 单件 → single:true（页面据此走 order.create）');
    t.eq(Object.keys(single.items[0].parcel).sort(),
      ['codeStatus', 'lockerNo', 'pickupCode', 'stationId', 'stationName', 'trackingTail'].sort(),
      'D2 单件 parcel 字段集与服务端 _parcel.normalizeParcel 入参一致（识别来源走 recognition，不塞 parcel）');
    t.eq([single.recognition, single.items[0].parcel.confidence],
      [{ source: 'MANUAL' }, undefined],
      'D3 手填件 recognition.source=MANUAL；无置信度时不带 confidence（空则不带）');
    t.check(single.ticket === TICKET && single.image === IMAGE,
      'D4 ticket/image 原样进 payload（服务端按票据校验归属）');
    t.eq([single.items[0].recognition, single.recognition.failureId], [undefined, undefined],
      'D5 单件件级不重复带 recognition；无失败记录时顶层不带 failureId（不发明）');

    const ocrItem = stationItem({ source: enums.RECOGNITION_SOURCE.RULE, confidence: 'MEDIUM' });
    const ocrBuilt = payloadOf([ocrItem]);
    t.eq([ocrBuilt.recognition.source, ocrBuilt.items[0].parcel.confidence], ['RULE', 'MEDIUM'],
      'D6 截图识别件 recognition.source=RULE + confidence=MEDIUM（识别来源快照不丢）');

    // AI 兜底来源标识来自服务端建议（端侧不硬编码第三方名）：aiApplied 时原样透传，服务端校验值域
    const aiParcel = { stationId: 'P3', pickupCode: 'B23456', source: 'DEEPSEEK', confidence: 'HIGH', aiApplied: true };
    const aiItem = model.makeItem(aiParcel, { serviceCode: enums.SERVICE_CODES[0] });
    const aiBuilt = payloadOf([aiItem]);
    t.eq([aiBuilt.recognition.source, aiBuilt.items[0].parcel.confidence], ['DEEPSEEK', 'HIGH'],
      'D7 AI 兜底件来源原样透传（recognition.source=DEEPSEEK，与服务端 RECOGNITION_SOURCES 一致）');
    t.check(RECOGNITION_SOURCES.indexOf(aiBuilt.recognition.source) >= 0
      && CONFIDENCE_VALUES.indexOf(aiBuilt.items[0].parcel.confidence) >= 0,
    'D8 透传值落在服务端值域内（RECOGNITION_SOURCES / CONFIDENCE_LEVEL_LIST）');
    const unapplied = stationItem({ source: 'DEEPSEEK', confidence: 'NONE' });
    const unappliedBuilt = payloadOf([unapplied]);
    t.eq([unappliedBuilt.recognition.source, unappliedBuilt.items[0].parcel.confidence], ['MANUAL', undefined],
      'D9 未真正应用 AI（aiApplied!==true）或非法置信度 → 回退 MANUAL/不带（不把未知值塞给服务端）');

    const batchItems = [stationItem({ pickupCode: 'A12345' }), stationItem({ pickupCode: 'B23456' }),
      stationItem({ pickupCode: 'C34567' })];
    const batch = payloadOf(batchItems);
    t.check(batch.batch === true && batch.single === false && batch.items.length === 3,
      'D10 多码拆单 → batch:true（页面据此走 order.createBatch）');
    t.check(batch.items.every((item) => item.parcel.stationId === 'P3' && item.parcel.pickupCode.length >= 5),
      'D11 拆单每件独立 parcel（不串件，逐件站点/取件码保留）');
    t.check(batch.image === IMAGE && batch.ticket === TICKET,
      'D12 拆单共享同一 image/ticket（一图多件不重复上传）');
    // 每件独立预约/备注（UX §3.7/§4.4：不再用页面级统一值）
    const slotItem = Object.assign(stationItem({ pickupCode: 'A12345' }), {
      appointType: 'SLOT', startAt: '2026-10-22T08:00:00+08:00', endAt: '2026-10-22T12:00:00+08:00'
    });
    const noteItem = Object.assign(stationItem({ pickupCode: 'B23456' }), { note: '放门口' });
    const perItem = payloadOf([slotItem, noteItem]);
    t.eq(perItem.items.map((row) => row.appoint),
      [{ type: 'SLOT', startAt: '2026-10-22T08:00:00+08:00', endAt: '2026-10-22T12:00:00+08:00' },
        { type: 'ASAP' }], 'D13 拆单每件独立预约（一件 SLOT 一件 ASAP，页面级统一值已删除）');
    t.eq(perItem.items.map((row) => row.note), ['', '放门口'], 'D14 拆单每件独立备注（不串件）');
    const uncheckedThird = [stationItem({}), stationItem({}),
      Object.assign(stationItem({}), { checked: false })];
    t.eq(payloadOf(uncheckedThird).items.length, 2, 'D15 未勾选件不进 items（取消勾选不进单）');
    // 逐件 failureId/source：单件顶层、拆单件级（DATA_MODEL §4.9「订单 × 截图一条记录」）
    const failSingle = payloadOf([Object.assign(stationItem({}), { failureId: 'F-20261022-0001' })]);
    t.eq([failSingle.recognition, failSingle.items[0].recognition],
      [{ source: 'MANUAL', failureId: 'F-20261022-0001' }, undefined],
      'D16 单件：recognition 在顶层（含 source+failureId），件级不重复带');
    const failBatch = payloadOf([
      Object.assign(stationItem({ pickupCode: 'A12345' }), { failureId: 'F-20261022-0001' }),
      Object.assign(stationItem({ pickupCode: 'B23456' }), { failureId: 'F-20261022-0002' })
    ]);
    t.eq(failBatch.items.map((row) => (row.recognition || {}).failureId),
      ['F-20261022-0001', 'F-20261022-0002'],
      'D17 拆单每项各自 recognition.failureId（同图多单独立关联，不套同一记录）');
    t.eq(failBatch.recognition, null, 'D18 拆单不带顶层 recognition（逐单关联优先，避免串单）');
    const noFailBatch = payloadOf([stationItem({}), stationItem({})]);
    t.eq(noFailBatch.items.map((row) => row.recognition.failureId), [undefined, undefined],
      'D19 无失败记录的件 recognition 只带 source、不带 failureId（不发明记录号）');
    t.eq(payloadOf([stationItem({ codeStatus: 'NEED_CODE' })]).items[0].parcel.codeStatus,
      enums.CODE_STATUS.OK, 'D20 codeStatus 由形态闸重新派生（不信任页面残留旧值：有码即 OK）');
    // 严格白名单：视图态字段（key/serviceIndex/formErrors/checked 等）绝不进 payload（DATA_MODEL §12 #12）
    const singleRequest = Object.assign({}, single.items[0], { ticket: single.ticket, image: single.image });
    if (single.recognition) singleRequest.recognition = single.recognition;
    t.eq(Object.keys(singleRequest).sort(),
      ['appoint', 'image', 'note', 'parcel', 'recognition', 'serviceCode', 'ticket'].sort(),
      'D21 单件请求顶层键恰在服务端白名单内（未知键会 VALIDATION_FAILED）');
    t.eq(Object.keys(failBatch.items[0]).sort(),
      ['appoint', 'note', 'parcel', 'recognition', 'serviceCode'].sort(),
      'D22 拆单项键恰在 items[i] 白名单内（视图态字段已剥掉）');
    t.notEmpty(batch.items, 'D 组样本非空');
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
    const noteChanged = model.ensureSubmission(first, model.submissionFingerprint(
      [Object.assign(stationItem({ pickupCode: 'A12345' }), { note: '换备注' })]), () => 0.9);
    t.check(noteChanged.id !== first.id, 'E6 件级备注变更 → 重新生成');
    const slotChanged = model.ensureSubmission(first, model.submissionFingerprint([
      Object.assign(stationItem({ pickupCode: 'A12345' }), {
        appointType: 'SLOT', startAt: '2026-10-22T08:00:00+08:00', endAt: '2026-10-22T12:00:00+08:00'
      })
    ]), () => 0.9);
    t.check(slotChanged.id !== first.id, 'E7 件级预约变更 → 重新生成');
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
      const explicitBatch = 'K'.repeat(20);
      await orderApi.createBatch({ items: [{ parcel: { stationId: 'P3' } }] }, { clientRequestId: explicitBatch });
      t.eq(seen[seen.length - 1].clientRequestId, explicitBatch,
        'F4 createBatch 同样透传显式幂等键（拆单原子创建可重试）');

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
    t.check(page.indexOf("require('../../../api/modules/order')") >= 0,
      'G5 页面只经 api/modules/order 出入（action 字符串只在 api/）');
    t.check(/ensureSubmission\(/.test(page) && /clearSubmission\(/.test(page),
      'G6 页面接线：进入 Step4 生成/提交前确认幂等键，成功后清空');
    t.check(/model\.submissionFingerprint\(/.test(page), 'G7 页面接线：内容指纹用于"变更后重新生成"');
    t.check(/clientRequestId:\s*submission\.id/.test(page),
      'G8 页面接线：create/createBatch 都带 clientRequestId（拆单同一键）');
    t.check(/create\(singlePayload,\s*submitOptions\)/.test(page)
      && /createBatch\(batchPayload,\s*submitOptions\)/.test(page),
    'G9 单件走 order.create、拆单走 order.createBatch（同一 submitOptions）');
    t.check(/onManualTap/.test(textOf(ORDER_CREATE_WXML)) && /ocrState === 'ai'/.test(textOf(ORDER_CREATE_WXML)),
      'G10 识别/兜底进行中有「先手动填写」入口（§4.3.1 ③ 不阻塞手填）');
    t.check(/manualPicked/.test(page), 'G11 手填优先：迟到的识别结果不覆盖已手填内容');
    t.check(/recognitionOfItem/.test(model.buildPayload.toString())
      && /recognitionSourceOf\(item\)/.test(textOf(ORDER_MODEL)),
    'G12 buildPayload 源文本确实经 recognitionOfItem 发 recognition.source（不是只在测试里断言）');
    const modelSource = textOf(ORDER_MODEL);
    t.check(/createRequestId\(\)/.test(modelSource),
      'G13 幂等键默认复用 api/client 的唯一随机源（views/页面零 random）');
    t.check(/onRetrySubmit\(\)\s*\{\s*this\.onSubmit\(\)/.test(page),
      'G14 结果块「重试」复用同一提交流程（不再现生成键）');
    const pageXml = textOf(ORDER_CREATE_WXML);
    t.check(/onItemAppointType/.test(pageXml) && /onItemSlotChange/.test(pageXml)
      && /onItemNoteInput/.test(pageXml),
    'G15 Step3 每件独立预约/备注控件（UX §3.7/§4.4：不再用页面级统一值）');
    t.check(/this\.data\.appointType/.test(page) === false && /this\.data\.note/.test(page) === false,
      'G16 页面无页面级 appointType/note 残留（逐件字段才是唯一来源）');
    t.check(/services\[item\.serviceIndex \|\| 0\]\.desc/.test(pageXml),
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
    t.eq([full.called, calls2.length, full.items[0].failureId], [0, 0, undefined],
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
    t.eq(payloadOf([manualItem, aiItem, ruleItem]).items.map((row) => row.recognition.source),
      ['MANUAL', 'DEEPSEEK', 'RULE'], 'H16 三件同批进 payload 时 recognition.source 互不干扰');
    t.eq(model.withManualEdit(aiItem, { serviceCode: enums.SERVICE_CODES[1] }).source, 'DEEPSEEK',
      'H17 手改非识别字段（服务类型）不降级来源');
    const shell = await model.applyAiFallbacks(
      [model.makeItem({}, { serviceCode: serviceCode })], ctx, stub);
    t.eq([shell.called, shell.items[0].stationId !== ''], [1, true],
      'H18 空壳件（规则一件没解析出）也走一次兜底并只填空');
    t.notEmpty(two.items, 'H 组样本非空');
  });

  // ---------------------------------------------------------------- I 服务端契约联调（fake DB）
  h.section('I. 服务端契约联调（fake DB）：严格白名单 + recognition.source 落库 + 逐单不串', async (t) => {
    const db = createOrderDb();
    const api = orderApiOf(db);
    // 单件：buildPayload 输出原样提交
    const single = model.buildPayload(
      [stationItem({ pickupCode: 'A12345', source: enums.RECOGNITION_SOURCE.RULE, confidence: 'MEDIUM' })],
      IT_TICKET, IT_IMAGE, {});
    const singleRequest = Object.assign({}, single.items[0], {
      ticket: IT_TICKET, image: IT_IMAGE, recognition: single.recognition
    });
    const created = await api.call('order.create', singleRequest, { clientRequestId: 'itest-single-00000001' });
    t.check(created.ok === true && !!created.data.order, 'I1 客户端单件形状被服务端接受（含 recognition.source，严格白名单不拒）');
    t.eq(created.data.order.parcel.recognitionSource, 'RULE',
      'I2 顶层 recognition.source 落库为订单 parcel.recognitionSource（来源快照真的存住了）');
    t.check(serverEnums.ORDER_NO_PATTERN.test(created.data.order.orderNo),
      'I3 返回 orderNo 可直接用于 redirectTo 详情页');
    // 负控：视图态字段混进请求 → 严格白名单 VALIDATION_FAILED（说明 D21/D22 断言有牙）
    const badSingle = Object.assign({}, singleRequest, { checked: true });
    const bad = await api.call('order.create', badSingle, { clientRequestId: 'itest-bad-000000001' });
    t.check(bad.code === 'VALIDATION_FAILED' && bad.data && bad.data.field === 'checked',
      'I4 视图态字段 checked 进顶层 → VALIDATION_FAILED（未知键不静默忽略）');
    t.eq(db.dump('orders').length, 1, 'I5 白名单拒绝零写入（仍 1 单）');
    // 拆单：逐单 recognition.source 各自落库（item0 不被顶层覆盖，也不串单）
    const batch = model.buildPayload([
      stationItem({ pickupCode: 'C34567', source: enums.RECOGNITION_SOURCE.RULE }),
      Object.assign(stationItem({ pickupCode: 'D45678' }), {
        source: serverEnums.RECOGNITION_SOURCE.MANUAL, aiApplied: false
      })
    ], IT_TICKET_BATCH, IT_IMAGE_BATCH, {});
    const batchCreated = await api.call('order.createBatch',
      { items: batch.items, ticket: IT_TICKET_BATCH, image: IT_IMAGE_BATCH },
      { clientRequestId: 'itest-batch-00000001' });
    t.check(batchCreated.ok === true && batchCreated.data.orders.length === 2,
      'I6 拆单 items[i].recognition 形状被接受，原子创建 2 单');
    t.eq(batchCreated.data.orders.map((order) => order.parcel.recognitionSource), ['RULE', 'MANUAL'],
      'I7 逐单 recognition.source 各自落库（手填件的 MANUAL 不与识别件的 RULE 串单）');
    const badBatch = await api.call('order.createBatch',
      { items: [Object.assign({}, batch.items[0], { codeStatus: serverEnums.CODE_STATUS.OK })] },
      { clientRequestId: 'itest-bad-000000002' });
    t.check(badBatch.code === 'VALIDATION_FAILED' && badBatch.data && badBatch.data.field === 'codeStatus',
      'I8 items[i] 视图态字段 codeStatus → VALIDATION_FAILED（逐项白名单同样有牙）');
    t.eq(db.dump('orders').length, 3, 'I9 拒绝后订单数不变（仍 3 单：1 单件 + 2 拆单）');
    t.eq(db.dump('order_events').filter((row) => row.requestKey.indexOf('order.create:') > 0).length >= 3, true,
      'I10 三单都写了 ORDER_CREATED 事件（幂等键含 clientRequestId）');
    t.notEmpty(db.dump('orders'), 'I 组样本非空');
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
