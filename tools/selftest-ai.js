'use strict';
/**
 * tools/selftest-ai.js — AI 识别兜底链路单测（ENGINEERING §7.3 #21/#22/#26；CONTRACT v0.9 §4.3；DATA_MODEL §7.9）。
 *
 * 覆盖（A~G，批 4-B / task-61）：
 *   §7.3.20  外发 payload 白名单 + 服务端二次去敏（键集合/掩码/截断/角色归一）
 *   §7.3.21  外呼适配 A：开关/Key/超时/重试/错误码映射/熔断开合/冷却后恢复可再外呼（注入 fetch，零真实外呼）
 *   §7.3.22  模型输出解析、DTO 字段闸、规则优先合并（纯件）
 *   §7.3.23  ai.parseParcel 入参/身份闸（VALIDATION_FAILED 字段、FORBIDDEN、2000 字边界）
 *   §7.3.24  B 配额：5 次/人/日边界、全局日配额、跨自然日重置、超限静默降级不外呼 + LLM_ERROR+QUOTA_EXCEEDED 入队、重放不重复计数
 *   §7.3.25  C 票据：缺失/非本人/过期/已用/purpose 不符 → 不拒绝但 ticketInvalid=true；合法票据；TEST_WRITE/READONLY 一律 FORBIDDEN
 *   §7.3.26  D 降级 DTO 形状与键集白名单（恰为 DTO_KEYS；无错误码/堆栈/原文；duplicated 不进 DTO）
 *   §7.3.27  E 入队记录字段：failureCode 5 值对齐、uploaderOpenid、ocrTextMasked 去 PII、aiTried/aiModel/aiResult、requestKey 幂等、fileId 回填前提
 *            （fileId 回填的 order 侧行为由 selftest-order G 组覆盖，跨套件引用，本套件不重复调 order.create）
 *   §7.3.28  F 规则优先合并（规则命中不覆盖 / 只补空 / 低置信 LOW_CONFIDENCE）
 *   §7.3.29  G 静态判据：handlers/ai 零直连外呼、payload 构造器唯一出口、parseParcel 去注释后 recordFailure+buildDegradedDto 单一降级出口
 *
 * 纪律：有判别力（先合法基线、再只有该闸能挡的反例）；不真实外呼（fetch 一律注入替身，零真实云）；
 *       不连数据库（fake DB）；EXPECTED_ASSERTIONS 与实际精确相等；单文件 ≤1000 行。
 * 取数：node tools/selftest-ai.js | Select-Object -Last 2
 */
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard } = require('./selftest');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const app = require(path.join(API, 'app.js'));
const payloadLib = require(path.join(API, 'lib/ai/payload.js'));
const deepseek = require(path.join(API, 'lib/ai/deepseek.js'));
const parseLib = require(path.join(API, 'lib/ai/parse.js'));
const promptLib = require(path.join(API, 'lib/ai/prompt.js'));
const aiCommon = require(path.join(API, 'handlers/ai/_common.js'));
const apiEnums = require(path.join(API, 'shared/enums.js'));
const stations = require(path.join(API, 'shared/stations.js'));
const time = require(path.join(API, 'lib/time.js'));
const sharedEnums = require(path.join(ROOT, 'shared/enums.js'));

const EXPECTED_ASSERTIONS = 197;

const NOW = Date.parse('2026-10-21T12:00:00+08:00');
const CUSTOMER_OPENID = 'openid-customer-ai';
const PARTNER_OPENID = 'openid-partner-ai';
const ADMIN_OPENID = 'openid-admin-dev01';
const TEST_CUSTOMER_OPENID = 'TEST-aicustomer01';
const ADMIN_ENV = { ADMIN_OPENIDS: JSON.stringify({ [ADMIN_OPENID]: 'DEV-01' }) };
const KEY_ENV = Object.assign({ DEEPSEEK_API_KEY: 'test-key' }, ADMIN_ENV);
const NO_KEY_ENV = Object.assign({}, ADMIN_ENV);
const DTO_KEYS = parseLib.DTO_KEYS.slice();
const DTO_KEY_SET = DTO_KEYS.slice().sort().join(',');
const AI_SOURCE_DOMAIN = ['RULE', 'DEEPSEEK', 'NONE'];
const FAILURE_NO_RE = /^F-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const QUEUE_KEYS = ['failureNo', 'requestKey', 'failureCode', 'sourceRole', 'uploaderOpenid', 'uploadTicketId',
  'fileId', 'orderId', 'ocrTextMasked', 'ruleResult', 'aiTried', 'aiModel', 'aiResult', 'aiErrorCode',
  'status', 'retentionDays', 'createdAt', 'reviewedAt', '_id'].sort();
const RULE_RESULT_KEYS = ['stationId', 'stationName', 'pickupCode', 'trackingTail', 'lockerNo', 'codeStatus',
  'conflicts', 'ticketInvalid'].sort();
const AI_RESULT_KEYS = ['recognized', 'stationId', 'stationName', 'pickupCode', 'trackingTail', 'lockerNo',
  'confidence'].sort();
const PII_TEXT = '丰巢 取件 电话13800138000 证件110101199003071234 D4-522 收件人：张三';
const EXTERNAL_TRACE = ['fetch(', 'https://', 'DEEPSEEK_API_KEY', 'api.deepseek.com'];

let ridSeq = 0;
function rid() {
  ridSeq += 1;
  return 'ai-req-' + String(ridSeq).padStart(10, '0');
}

// ---------------------------------------------------------------- 注入式 fetch 替身（零真实外呼）
function makeFetch(handler) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return handler(calls.length, url, options);
  };
  fn.calls = calls;
  fn.callCount = () => calls.length;
  return fn;
}

function okFetch(content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return makeFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] })
  }));
}

function statusFetch(status) {
  return makeFetch(async () => ({ ok: false, status, json: async () => ({ error: { message: 'stub failure' } }) }));
}

function networkErrorFetch() {
  return makeFetch(async () => { throw new Error('stub network down'); });
}

function hangingFetch() {
  return makeFetch((n, url, options) => new Promise((resolve, reject) => {
    // 保持事件循环存活：客户端超时定时器是 unref 的，纯挂起 Promise 会让进程提前退出
    const keepAlive = setInterval(() => {}, 1000);
    const abort = () => {
      clearInterval(keepAlive);
      const err = new Error('aborted by timeout');
      err.name = 'AbortError';
      reject(err);
    };
    if (options && options.signal && typeof options.signal.addEventListener === 'function') {
      options.signal.addEventListener('abort', abort);
    } else {
      setTimeout(abort, 30);
    }
  }));
}

async function withFetchStub(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete globalThis.fetch;
    else globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------- fixture / helpers
function aiFallbackOf(overrides) {
  return Object.assign({
    enabled: true,
    model: 'deepseek-chat',
    timeoutMs: 1000,
    maxPerUserPerDay: 5,
    dailyQuota: 200,
    cooldownMinutes: 10
  }, overrides || {});
}

function aiConfig(overrides) {
  return { aiFallback: aiFallbackOf(overrides) };
}

const CONSENT = { version: 'v4.0', at: NOW };

function uniqueIndexesForApi() {
  return {
    users: [['_id']],
    customers: [['_id'], ['customerNo']],
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

function userDoc(id, roles, extra) {
  return Object.assign({
    _id: id, roles: roles || [], status: 'ACTIVE', isTestAccount: false,
    createdByDeveloperNo: '', testLastUsedAt: 0, messageReadAt: 0, deletionRequestedAt: 0,
    privacyConsent: CONSENT, createdAt: NOW, updatedAt: NOW
  }, extra || {});
}

function customerDoc(id, customerNo, extra) {
  return Object.assign({
    _id: id, customerNo, displayName: '小王', phoneTail: '1234', zone: 'D', buildingNo: 4, room: '522',
    dormKey: 'D4-522', profileCompleted: true, avatarFileId: '', createdAt: NOW, updatedAt: NOW
  }, extra || {});
}

function partnerDoc() {
  return {
    _id: 'partner-ai-1', openid: PARTNER_OPENID, partnerNo: 'PABC23', displayName: '小李',
    status: 'ACTIVE', avatarFileId: '', stats: {},
    serviceConfig: {
      acceptingOrders: true,
      zones: ['D', 'X', 'N', 'B', 'C'],
      services: [{ code: 'PICKUP_STD', enabled: true }]
    },
    createdAt: NOW, updatedAt: NOW
  };
}

function bindingDoc() {
  return {
    _id: 'bind-ai-1', activeKey: CUSTOMER_OPENID, tagKey: 'partner-ai-1:D4-522:A',
    customerId: CUSTOMER_OPENID, partnerId: 'partner-ai-1', status: 'ACTIVE', roomTag: 'A',
    dormSnapshot: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D区4栋' },
    createdAt: NOW, updatedAt: NOW
  };
}

function createDb(options) {
  const opt = options || {};
  const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
  const config = { _id: 'global', privacyVersion: 'v4.0', aiFallback: aiFallbackOf(opt.aiFallback) };
  if (opt.retentionDays !== undefined) config.recognitionFailureRetentionDays = opt.retentionDays;
  db.seed('users', [
    userDoc(CUSTOMER_OPENID, ['CUSTOMER']),
    userDoc(PARTNER_OPENID, ['PARTNER']),
    userDoc(ADMIN_OPENID, []),
    userDoc(TEST_CUSTOMER_OPENID, ['CUSTOMER'], { isTestAccount: true, createdByDeveloperNo: 'DEV-01' })
  ]);
  db.seed('customers', [
    customerDoc(CUSTOMER_OPENID, 'CABCDEFGH'),
    customerDoc(TEST_CUSTOMER_OPENID, 'CABCDTEST', { displayName: '测试顾客' })
  ]);
  db.seed('partners', [partnerDoc()]);
  db.seed('bindings', [bindingDoc()]);
  db.seed('config', [config]);
  return db;
}

function apiOf(db, openid, env) {
  return app.createApi({ db, now: () => NOW, openid: openid || CUSTOMER_OPENID, env: env || KEY_ENV });
}

function basicPayload(extra) {
  return Object.assign({ ocrTextMasked: '丰巢 取件', uploadTicketId: '', role: 'CUSTOMER' }, extra || {});
}

function ticketDoc(ticket, purpose, openid, expiresAtMs, usedAtMs) {
  return {
    _id: ticket,
    ticket,
    openid,
    purpose,
    cloudPath: purpose === 'TICKET' ? 'orders/' + ticket + '/image.jpg' : 'avatars/customer/' + ticket + '.jpg',
    draftId: 'draft-000000000001',
    expiresAt: new Date(expiresAtMs),
    usedAt: usedAtMs === null ? null : new Date(usedAtMs),
    createdAt: new Date(NOW)
  };
}

function sessionDoc(id, viewMode, targetId, targetNo, targetIsTest) {
  return {
    _id: id,
    requestKey: 'vs-' + id,
    adminOpenid: ADMIN_OPENID,
    developerNo: 'DEV-01',
    viewMode,
    role: 'CUSTOMER',
    targetId,
    targetNo,
    targetIsTest,
    createdAt: NOW,
    expiresAt: NOW + 3600000,
    endedAt: 0
  };
}

function failuresOf(db) {
  return db.dump('recognition_failures');
}

function lastFailure(db) {
  return failuresOf(db).slice(-1)[0] || {};
}

function quotaKey(subject, nowMs) {
  return 'rl:ai:' + subject + ':d' + time.dayKey(nowMs);
}

function counterValue(db, key) {
  const row = db.dump('counters').filter((item) => item.key === key)[0];
  return row && typeof row.seq === 'number' ? row.seq : 0;
}

function countersSignature(db) {
  return db.dump('counters').map((item) => item.key + ':' + item.seq).sort().join('|');
}

function apiFiles(relDir) {
  return fsutil.walk(path.join(API, relDir), { exts: new Set(['.js']) }).map((full) => ({
    rel: fsutil.rel(full, ROOT),
    code: fsutil.stripComments(fsutil.readText(full))
  }));
}

function filesContaining(files, needle) {
  return files.filter((file) => file.code.indexOf(needle) !== -1).map((file) => file.rel).sort();
}

function buildDegradedKeys(dto) {
  return Object.keys(dto).sort().join(',');
}

// ---------------------------------------------------------------- §7.3.20 外发白名单与去敏
function registerPayloadSection(h) {
  h.section('§7.3.20 AI 外发 payload 白名单与二次去敏', (t) => {
    t.eq(payloadLib.AI_PAYLOAD_KEYS, ['ocrTextMasked', 'hintTrackingTail', 'role'], '外发键集合严格等于白名单');
    t.eq(payloadLib.MAX_OCR_TEXT_LENGTH, 2000, 'OCR 文本入参上限 2000');
    const baseline = payloadLib.buildAiPayload({
      ocrTextMasked: 'P3 丰巢 取件码 A123',
      hintTrackingTail: '12345',
      role: 'CUSTOMER',
      fileId: 'cloud://should-not-go',
      openid: 'o-should-not-go',
      orderId: 'order-should-not-go'
    });
    t.check(Object.keys(baseline).every((key) => payloadLib.AI_PAYLOAD_KEYS.indexOf(key) >= 0),
      '构造结果不夹带白名单外键（fileId/openid/orderId 被丢弃）');
    t.check(payloadLib.assertPayloadKeys(baseline), '合法 payload 通过键集合断言');
    t.check(!payloadLib.assertPayloadKeys({ ocrTextMasked: 'x', role: 'CUSTOMER', fileId: 'f' }),
      '反例：多一个 fileId 键必须红');
    t.check(!payloadLib.assertPayloadKeys({ ocrTextMasked: 'x' }), '反例：缺 role 必须红');
    t.throws(() => payloadLib.buildAiPayload({ ocrTextMasked: 'x', role: 'ADMIN' }),
      /must be CUSTOMER or PARTNER/, '反例：非法角色必须抛错（不静默降级）');
    t.eq(payloadLib.buildAiPayload({ ocrTextMasked: 'x', role: 'customer' }).role, 'CUSTOMER',
      '角色小写归一为大写');

    const phone = payloadLib.maskSensitiveText('联系电话 13800138000 站点 P3');
    t.check(phone.indexOf('13800138000') < 0, '手机号整串不外发');
    t.check(phone.indexOf('P3') >= 0, '站点信息保留（去敏不误伤识别必需字段）');
    const idCard = payloadLib.maskSensitiveText('证件 110101199003071234 请核对');
    t.check(idCard.indexOf('110101199003071234') < 0, '身份证整串不外发');
    const longDigits = payloadLib.maskSensitiveText('运单 1234567890123 尾号 45678');
    t.check(longDigits.indexOf('1234567890123') < 0, '连续长数字被掩码');
    t.check(payloadLib.maskSensitiveText('D4-522 取件码 A123').indexOf('D4-522') < 0,
      '房号/宿舍标识被掩码');
    t.check(payloadLib.maskSensitiveText('1234567890123 4567890123456').indexOf('4567890123456') < 0,
      '多个长数字都掩码');
    const longText = payloadLib.buildAiPayload({ ocrTextMasked: 'P3 A123 '.repeat(400), role: 'PARTNER' });
    t.eq(longText.ocrTextMasked.length, 2000, '超长 OCR 文本按 2000 截断');
    t.check(payloadLib.buildAiPayload({ ocrTextMasked: 'P3', hintTrackingTail: '12345', role: 'CUSTOMER' })
      .hintTrackingTail === '12345', '合法 5 位运单尾号保留');
    t.check(!('hintTrackingTail' in payloadLib.buildAiPayload({ ocrTextMasked: 'P3', hintTrackingTail: '1234', role: 'CUSTOMER' })),
      '反例：非 5 位尾号不进入外发 payload');
    t.notEmpty([payloadLib.maskSensitiveText('A1')], '去敏样本');
  });
}

// ---------------------------------------------------------------- §7.3.22 DTO 闸与合并纯件
function registerParseSection(h) {
  h.section('§7.3.22 AI 输出解析与 DTO 字段闸（纯件）', (t) => {
    t.eq(parseLib.DTO_KEYS.length, 10, 'DTO 固定 10 键');
    t.eq(parseLib.parseJsonObject('```json\n{"stationId":"P3"}\n```'), { stationId: 'P3' }, '可解析 fenced JSON');
    t.eq(parseLib.parseJsonObject('模型前缀 {"pickupCode":"A123"} 后缀'), { pickupCode: 'A123' }, '可解析夹带文本的 JSON 对象');
    t.eq(parseLib.parseJsonObject('not a json'), null, '非 JSON 返回 null（不抛错）');
    t.eq(parseLib.parseJsonObject('[1,2,3]'), null, '数组结果不算对象');
    t.eq(parseLib.normalizePickupCode('a1-23 4'), 'A1234', '取件码去连字符/空白并大写');
    t.eq(parseLib.normalizePickupCode('12'), '', '反例：过短取件码置空');
    t.eq(parseLib.normalizePickupCode('A1234567890123'), '', '反例：过长取件码置空');
    t.eq(parseLib.normalizeStationId('p3', ['P1', 'P2', 'P3']), 'P3', '站点小写归一并命中站点表');
    t.eq(parseLib.normalizeStationId('P9', ['P1', 'P2', 'P3']), '', '反例：站点不在 P1~P8 值域置空');
    t.eq(parseLib.resolveStationName('P3', [{ id: 'P3', name: '三号驿站' }]), '三号驿站', '站点名由服务端站点表回填');
    t.eq(parseLib.normalizeTrackingTail('12 345'), '12345', '运单尾号去空白后 5 位合法');
    t.eq(parseLib.normalizeTrackingTail('1234'), '', '反例：非 5 位尾号置空');
    t.eq(parseLib.normalizeLockerNo('1234567890'), '1234567890', '柜号 10 位保留');
    t.eq(parseLib.normalizeLockerNo('12345678901'), '', '反例：柜号超 10 位置空');
    t.eq(parseLib.normalizeConfidence('high'), 'HIGH', '置信度大写归一');
    t.eq(parseLib.normalizeConfidence('certain'), 'LOW', '反例：非法置信度按 LOW（触发复核）');

    const stationsTable = [{ id: 'P3', name: '三号驿站' }];
    const normalized = parseLib.normalizeAiFields({
      stationId: 'p3', stationName: '模型臆造站点', pickupCode: 'a-123', trackingTail: '12 345',
      lockerNo: '12 号柜', confidence: 'MEDIUM', extra: 'should-drop'
    }, { stationIds: ['P1', 'P2', 'P3'], stations: stationsTable });
    t.eq(normalized.stationName, '三号驿站', '模型给的站点名不被信任（用站点表回填）');
    t.eq(normalized.recognized, true, '站点 + 取件码齐全才 recognized=true');
    t.check(Object.keys(normalized).every((key) => parseLib.DTO_KEYS.indexOf(key) >= 0),
      '归一结果只含 DTO 白名单键（未知键被剥离）');
    const missingCode = parseLib.normalizeAiFields({ stationId: 'P3', pickupCode: '' }, { stationIds: ['P1', 'P2', 'P3'], stations: stationsTable });
    t.eq(missingCode.recognized, false, '反例：缺取件码 recognized=false');
    const missingStation = parseLib.normalizeAiFields({ stationId: '', pickupCode: 'A123' }, { stationIds: ['P1', 'P2', 'P3'], stations: stationsTable });
    t.eq(missingStation.recognized, false, '反例：缺站点 recognized=false');
  });
}

// ---------------------------------------------------------------- §7.3.22b 规则优先合并与降级 DTO（纯件）
function registerMergeSection(h) {
  h.section('§7.3.22b 规则优先合并与降级 DTO（纯件）', (t) => {
    const ruleBaseline = parseLib.mergeFields(
      { stationId: 'P2', stationName: '二号驿站', pickupCode: 'RULE1', trackingTail: '', lockerNo: '' },
      { stationId: 'P3', stationName: '三号驿站', pickupCode: 'AI123', trackingTail: '12345', lockerNo: 'A1', confidence: 'HIGH' }
    );
    t.eq(ruleBaseline.source, 'RULE', '规则字段优先：来源 RULE');
    t.eq(ruleBaseline.fields.stationId, 'P2', '规则站点不被 AI 覆盖');
    t.eq(ruleBaseline.fields.stationName, '二号驿站', '规则站点名随规则站点（不跟着 AI 站名漂移）');
    t.eq(ruleBaseline.fields.trackingTail, '12345', '规则空位由 AI 补齐');
    const ruleCodeOnly = parseLib.mergeFields({ pickupCode: 'RULE1' }, { stationId: 'P3', stationName: '三号驿站', pickupCode: 'AI123', confidence: 'HIGH' });
    t.eq({ stationId: ruleCodeOnly.fields.stationId, pickupCode: ruleCodeOnly.fields.pickupCode, source: ruleCodeOnly.source },
      { stationId: 'P3', pickupCode: 'RULE1', source: 'RULE' }, '规则只命中码：站由 AI 补、码不覆盖');
    const aiOnly = parseLib.mergeFields({ stationId: '', pickupCode: '' }, { stationId: 'P3', stationName: '三号驿站', pickupCode: 'AI123', confidence: 'HIGH' });
    t.eq(aiOnly.source, 'DEEPSEEK', '规则全空时来源 DEEPSEEK');
    const none = parseLib.mergeFields({}, { stationId: '', pickupCode: '' });
    t.eq(none.source, 'NONE', '规则与 AI 都空：来源 NONE');
    t.eq(Object.keys(sharedEnums.RECOGNITION_SOURCE).sort(), ['MANUAL', 'RULE'], '客户端可见 shared 枚举零第三方 AI 来源');
    t.eq(parseLib.RECOGNITION_SOURCES.slice().sort().join(','), 'DEEPSEEK,MANUAL,RULE', '云侧来源值域 = RULE/MANUAL/DEEPSEEK');
    t.eq(sharedEnums.RECOGNITION_SOURCE_LIST, ['RULE', 'MANUAL'], 'shared 来源值域只给客户端 RULE/MANUAL');
    t.eq(apiEnums.FAILURE_CODE_LIST, ['NO_TEXT', 'PARSE_MISS', 'LOW_CONFIDENCE', 'LLM_ERROR', 'IMAGE_UNREADABLE'],
      'failureCode 5 值逐字对齐 CONTRACT §4.3');
    const degraded = parseLib.buildDegradedDto({ failureNo: 'F-20261021-ABCDEF', duplicated: true },
      { stationId: 'P3', confidence: 'LOW' }, { source: 'RULE' });
    t.eq(buildDegradedKeys(degraded), DTO_KEY_SET, '降级 DTO 键集合恰为 DTO_KEYS（duplicated 不进 DTO）');
    t.eq({ recognized: degraded.recognized, needsReview: degraded.needsReview, failureId: degraded.failureId, source: degraded.source },
      { recognized: false, needsReview: true, failureId: 'F-20261021-ABCDEF', source: 'RULE' }, '降级 DTO 语义：recognized=false/needsReview/failureId/source');
    t.eq(parseLib.buildDegradedDto(null, {}, {}).confidence, 'LOW', '降级 DTO 缺省置信度 LOW（保守触发复核）');
  });
}

// ---------------------------------------------------------------- §7.3.29 静态判据（G）
function registerStaticSection(h) {
  h.section('§7.3.29 静态判据：外呼唯一出口 / payload 构造器 / 降级单一出口', (t) => {
    const handlerFiles = apiFiles('handlers/ai');
    t.check(handlerFiles.length >= 2, '样本非空：handlers/ai 有实现文件');
    EXTERNAL_TRACE.forEach((needle) => {
      t.eq(filesContaining(handlerFiles, needle), [], 'handlers/ai 零直连外呼痕迹：' + needle);
    });
    const libAiFiles = apiFiles('lib/ai');
    t.eq(filesContaining(libAiFiles, 'DEEPSEEK_API_KEY'), ['cloudfunctions/api/lib/ai/deepseek.js'],
      'Key 环境变量名只出现在 lib/ai/deepseek.js');
    t.eq(filesContaining(libAiFiles, 'api.deepseek.com'), ['cloudfunctions/api/lib/ai/deepseek.js'],
      '外呼端点只出现在 lib/ai/deepseek.js');
    t.eq(filesContaining(libAiFiles, 'fetchImpl('), ['cloudfunctions/api/lib/ai/deepseek.js'],
      'lib/ai 只有 deepseek.js 发外呼');
    const apiAll = apiFiles('.').filter((file) => file.rel.endsWith('.js'));
    t.eq(filesContaining(apiAll, 'buildAiPayload('),
      ['cloudfunctions/api/handlers/ai/parseParcel.js', 'cloudfunctions/api/lib/ai/deepseek.js', 'cloudfunctions/api/lib/ai/payload.js'],
      'payload 构造器唯一出口：只有定义 + 外呼层 + handler 三处调用 buildAiPayload()');
    t.eq(filesContaining(apiAll, 'response_format'), ['cloudfunctions/api/lib/ai/deepseek.js'],
      '外呼请求体（response_format）只在 deepseek.js 组装');
    const parcel = handlerFiles.filter((file) => /parseParcel\.js$/.test(file.rel))[0];
    t.check(!!parcel, '样本非空：handlers/ai/parseParcel.js 存在');
    const code = parcel ? parcel.code : '';
    t.check(code.indexOf('recordFailure(') >= 0, 'parseParcel 去注释后命中 recordFailure（失败必入队）');
    t.check(code.indexOf('buildDegradedDto(') >= 0, 'parseParcel 去注释后命中 buildDegradedDto（降级 DTO 单一出口）');
    t.eq(/recognized\s*:\s*false/.test(code), false, 'parseParcel 无手写 recognized:false（降级一律经 buildDegradedDto）');
    t.eq((code.match(/buildDegradedDto\(/g) || []).length, 7, '7 个降级返回点全部经 buildDegradedDto（新增降级点必须同步改判据）');
    t.eq(filesContaining(apiAll, 'common.recordFailure('), ['cloudfunctions/api/handlers/ai/parseParcel.js'],
      'recordFailure 生产调用只由 parseParcel 发起（_common 只定义）');
  });
}

// ---------------------------------------------------------------- A 外呼闸（注入 fetch）
async function gateConfigGroup(t) {
  t.eq(deepseek.ENDPOINT, 'https://api.deepseek.com/chat/completions', '唯一外呼端点');
  t.eq(deepseek.KEY_ENV_NAME, 'DEEPSEEK_API_KEY', 'Key 只从该环境变量读');
  t.eq(Object.keys(deepseek.AI_ERROR_CODES).length, 6, '内部排障码 6 个（不占业务错误码）');
  const def = deepseek.normalizeAiConfig(undefined);
  t.eq({ enabled: def.enabled, model: def.model, timeoutMs: def.timeoutMs },
    { enabled: false, model: 'deepseek-chat', timeoutMs: 8000 }, '缺省关闭 + 默认模型 + 8s 超时（应用可正常启动）');
  t.eq({ maxPerUserPerDay: def.maxPerUserPerDay, dailyQuota: def.dailyQuota, cooldownMinutes: def.cooldownMinutes },
    { maxPerUserPerDay: 5, dailyQuota: 200, cooldownMinutes: 10 }, '缺省配额/熔断参数对齐 DATA_MODEL §2.10');
  t.eq(deepseek.normalizeAiConfig({ aiFallback: { timeoutMs: 1e12 } }).timeoutMs, 2147483647,
    '超时上限截断到定时器上限（防 setTimeout 溢出）');
  t.eq(deepseek.normalizeAiConfig({ aiFallback: { timeoutMs: -1 } }).timeoutMs, 8000, '反例：非法超时回落 8000');
  t.eq(deepseek.normalizeAiConfig({ aiFallback: { model: '' } }).model, 'deepseek-chat', 'model 空串由 lib/ai 解析默认模型');
  t.eq(deepseek.normalizeAiConfig({ aiFallback: { enabled: false } }).enabled, false, 'enabled=false 透传');
}

async function gateDisabledKeyGroup(t) {
  deepseek.resetCircuitBreaker();
  const disabledFetch = okFetch({ stationId: 'P3' });
  const disabledClient = deepseek.createDeepSeekClient({
    fetchImpl: disabledFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig({ enabled: false }), now: () => NOW
  });
  const disabledResult = await disabledClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ ok: disabledResult.ok, aiTried: disabledResult.aiTried, errorCode: disabledResult.errorCode },
    { ok: false, aiTried: false, errorCode: 'DISABLED' }, '开关关闭：零外呼 + 不标记 aiTried + DISABLED');
  t.eq(disabledFetch.callCount(), 0, '开关关闭零外呼（fetch 调用数 0）');

  const blankKeyFetch = okFetch({});
  const blankKeyClient = deepseek.createDeepSeekClient({
    fetchImpl: blankKeyFetch, env: { DEEPSEEK_API_KEY: '   ' }, config: aiConfig(), now: () => NOW
  });
  const blankKeyResult = await blankKeyClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ code: blankKeyResult.errorCode, calls: blankKeyFetch.callCount() },
    { code: 'DISABLED', calls: 0 }, 'Key 空白视同缺失：零外呼 + DISABLED');
  t.eq(blankKeyClient.status(NOW).hasKey, false, 'status 只报 hasKey，不泄露 Key 值');
}

async function gateHappyGroup(t) {
  const okClientFetch = okFetch({ stationId: 'P3', pickupCode: 'A123' });
  const okClient = deepseek.createDeepSeekClient({
    fetchImpl: okClientFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig(), now: () => NOW
  });
  const okResult = await okClient.complete({ ocrTextMasked: 'P3 丰巢 A123', role: 'CUSTOMER' }, {});
  t.eq({ ok: okResult.ok, aiTried: okResult.aiTried, calls: okClientFetch.callCount() },
    { ok: true, aiTried: true, calls: 1 }, '正常响应：ok + aiTried + 只外呼 1 次');
  const sentBody = JSON.parse(okClientFetch.calls[0].options.body);
  t.eq(sentBody.temperature, 0, 'temperature=0');
  t.eq(sentBody.response_format, { type: 'json_object' }, 'response_format=json_object');
  t.eq({ model: sentBody.model, stream: sentBody.stream }, { model: 'deepseek-chat', stream: false },
    'model 取 config.aiFallback.model + stream=false');
  t.eq(Object.keys(sentBody).sort(), ['messages', 'model', 'response_format', 'stream', 'temperature'],
    '外呼请求体键集合固定（唯一出口，不能手拼多余字段）');
  t.eq(okClientFetch.calls[0].options.headers.Authorization, 'Bearer test-key', 'Key 只进 Authorization 头');
  t.check(JSON.stringify(sentBody).indexOf('openid') < 0 && JSON.stringify(sentBody).indexOf('fileId') < 0,
    '外发请求体零身份/文件键');
}

async function gateErrorMappingGroup(t) {
  deepseek.resetCircuitBreaker();
  const fail5xxFetch = statusFetch(500);
  const fail5xxClient = deepseek.createDeepSeekClient({ fetchImpl: fail5xxFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig(), now: () => NOW });
  const fail5xxResult = await fail5xxClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ code: fail5xxResult.errorCode, calls: fail5xxFetch.callCount() }, { code: 'HTTP_5XX', calls: 2 },
    '5xx：重试 1 次（共 2 次外呼）并归因 HTTP_5XX');

  deepseek.resetCircuitBreaker();
  const fail4xxFetch = statusFetch(400);
  const fail4xxClient = deepseek.createDeepSeekClient({ fetchImpl: fail4xxFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig(), now: () => NOW });
  const fail4xxResult = await fail4xxClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ code: fail4xxResult.errorCode, calls: fail4xxFetch.callCount() }, { code: 'PARSE_ERROR', calls: 1 },
    '4xx 不重试（只 1 次外呼）');

  deepseek.resetCircuitBreaker();
  const quotaHttpFetch = statusFetch(429);
  const quotaHttpClient = deepseek.createDeepSeekClient({ fetchImpl: quotaHttpFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig(), now: () => NOW });
  const quotaHttpResult = await quotaHttpClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ code: quotaHttpResult.errorCode, calls: quotaHttpFetch.callCount() },
    { code: 'QUOTA_EXCEEDED', calls: 1 }, '上游 429 不重试并归因 QUOTA_EXCEEDED');

  deepseek.resetCircuitBreaker();
  const unauthorizedFetch = statusFetch(401);
  const unauthorizedClient = deepseek.createDeepSeekClient({ fetchImpl: unauthorizedFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig(), now: () => NOW });
  const unauthorizedResult = await unauthorizedClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ code: unauthorizedResult.errorCode, calls: unauthorizedFetch.callCount() },
    { code: 'DISABLED', calls: 1 }, '上游 401 不重试并归因 DISABLED');

  deepseek.resetCircuitBreaker();
  const netFetch = networkErrorFetch();
  const netClient = deepseek.createDeepSeekClient({ fetchImpl: netFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig(), now: () => NOW });
  const netResult = await netClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ ok: netResult.ok, calls: netFetch.callCount() }, { ok: false, calls: 2 }, '网络错误不外抛：重试 1 次后降级');
}

async function gateTimeoutGroup(t) {
  deepseek.resetCircuitBreaker();
  const timeoutFetch = hangingFetch();
  const timeoutClient = deepseek.createDeepSeekClient({
    fetchImpl: timeoutFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig({ timeoutMs: 25 }), now: () => NOW
  });
  const timeoutStarted = Date.now();
  const timeoutResult = await timeoutClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  const timeoutElapsed = Date.now() - timeoutStarted;
  t.eq({ code: timeoutResult.errorCode, calls: timeoutFetch.callCount() },
    { code: 'TIMEOUT', calls: 2 }, '超时：按 config.timeoutMs 中止并重试 1 次（共 2 次外呼）');
  t.check(timeoutElapsed < 1000, '超时闸真实生效（25ms 配置不会拖成秒级）');
}

async function gateBreakerGroup(t) {
  deepseek.resetCircuitBreaker();
  const breakerFetch = statusFetch(503);
  const breakerClient = deepseek.createDeepSeekClient({ fetchImpl: breakerFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig(), now: () => NOW });
  for (let i = 0; i < 5; i += 1) {
    await breakerClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  }
  t.check(deepseek.breakerSnapshot().openUntil > 0, '连续 5 次失败进入熔断（cooldownMinutes=10）');
  const callsBeforeOpen = breakerFetch.callCount();
  const openResult = await breakerClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ code: openResult.errorCode, aiTried: openResult.aiTried }, { code: 'CIRCUIT_OPEN', aiTried: false },
    '熔断期内返回 CIRCUIT_OPEN 且不标记 aiTried');
  t.eq(breakerFetch.callCount(), callsBeforeOpen, '熔断期内零外呼');

  const recoveryFetch = okFetch({ stationId: 'P3' });
  const recoveryClient = deepseek.createDeepSeekClient({
    fetchImpl: recoveryFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig(), now: () => NOW + 10 * 60000 + 1
  });
  const recoveryResult = await recoveryClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
  t.eq({ ok: recoveryResult.ok, calls: recoveryFetch.callCount() }, { ok: true, calls: 1 },
    '冷却期结束（注入 now）后可再次外呼');
  t.eq({ openUntil: deepseek.breakerSnapshot().openUntil, consecutiveFailures: deepseek.breakerSnapshot().consecutiveFailures },
    { openUntil: 0, consecutiveFailures: 0 }, '恢复成功后熔断状态复位');
  deepseek.resetCircuitBreaker();
  t.eq(deepseek.breakerSnapshot(), { consecutiveFailures: 0, openUntil: 0 }, 'resetCircuitBreaker 可复位（测试隔离）');
}

async function gateBodyPromptGroup(t) {
  const body = deepseek.buildRequestBody({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, { model: 'deepseek-chat' });
  t.notEmpty(body.messages, '外呼 messages 非空');
  t.eq(body.temperature, 0, 'buildRequestBody 温度 0');
  t.eq(deepseek.buildRequestBody({ ocrTextMasked: 'x', role: 'ADMIN' }, {}), null, '非法入参构造 body 返回 null');
  t.eq(promptLib.OUTPUT_KEYS.indexOf('stationId') >= 0, true, 'system prompt 输出键含 stationId');
  const promptText = promptLib.buildMessages({ ocrTextMasked: 'A123', role: 'CUSTOMER' },
    { stations: stations.listStations() }).map((message) => message.content).join('\n');
  t.check(promptText.indexOf(stations.stationNameOf('P3')) >= 0 && promptText.indexOf('openid') < 0,
    'prompt 只拼站点表与去敏文本，零身份字段');
}

// ---------------------------------------------------------------- B 配额
async function quotaBoundaryGroup(t) {
  const db = createDb();
  db.seed('counters', [{ _id: 'q-user', key: quotaKey(CUSTOMER_OPENID, NOW), seq: 4, updatedAt: NOW }]);
  const api = apiOf(db);
  const stub = okFetch({ stationId: 'P3', pickupCode: 'A123', confidence: 'HIGH' });
  const fifth = await withFetchStub(stub, () => api.call('ai.parseParcel', basicPayload(), { clientRequestId: rid() }));
  t.eq({ ok: fifth.ok, recognized: fifth.data.recognized, calls: stub.callCount() },
    { ok: true, recognized: true, calls: 1 }, '配额第 5 次（4→5）：放行并外呼 1 次（边界含 5）');
  t.eq({ user: counterValue(db, quotaKey(CUSTOMER_OPENID, NOW)), global: counterValue(db, quotaKey('global', NOW)) },
    { user: 5, global: 1 }, '第 5 次后个人/全局计数各 +1');
  const sixth = await withFetchStub(stub, () => api.call('ai.parseParcel', basicPayload(), { clientRequestId: rid() }));
  t.eq({ ok: sixth.ok, recognized: sixth.data.recognized, needsReview: sixth.data.needsReview, code: sixth.code },
    { ok: true, recognized: false, needsReview: true, code: undefined }, '第 6 次：静默降级（无 RATE_LIMITED）+ 需复核');
  t.check(!!sixth.data.failureId, '第 6 次返回 failureId（仍入队）');
  t.eq(stub.callCount(), 1, '超限零外呼（fetch 调用数仍为 1）');
  const quotaRec = lastFailure(db);
  t.eq({ failureCode: quotaRec.failureCode, aiErrorCode: quotaRec.aiErrorCode, aiTried: quotaRec.aiTried, aiModel: quotaRec.aiModel },
    { failureCode: 'LLM_ERROR', aiErrorCode: 'QUOTA_EXCEEDED', aiTried: false, aiModel: '' },
    '超限入队：LLM_ERROR + QUOTA_EXCEEDED + 未外呼 + 无模型快照');
  t.eq({ user: counterValue(db, quotaKey(CUSTOMER_OPENID, NOW)), global: counterValue(db, quotaKey('global', NOW)) },
    { user: 5, global: 1 }, '超限请求不再重复计数');
}

async function quotaWindowGroup(t) {
  const gdb = createDb({ aiFallback: { dailyQuota: 2 } });
  gdb.seed('counters', [{ _id: 'q-global', key: quotaKey('global', NOW), seq: 2, updatedAt: NOW }]);
  const gstub = okFetch({ stationId: 'P3', pickupCode: 'A123', confidence: 'HIGH' });
  const gDenied = await withFetchStub(gstub, () => apiOf(gdb).call('ai.parseParcel', basicPayload(), { clientRequestId: rid() }));
  t.eq({ recognized: gDenied.data.recognized, calls: gstub.callCount() }, { recognized: false, calls: 0 },
    '全局日配额打满：零外呼 + 静默降级');
  t.eq(lastFailure(gdb).aiErrorCode, 'QUOTA_EXCEEDED', '全局超限同样入队 QUOTA_EXCEEDED');

  const gdb2 = createDb({ aiFallback: { dailyQuota: 2 } });
  gdb2.seed('counters', [{ _id: 'q-global2', key: quotaKey('global', NOW), seq: 1, updatedAt: NOW }]);
  const gstub2 = okFetch({ stationId: 'P3', pickupCode: 'A123', confidence: 'HIGH' });
  const gAllowed = await withFetchStub(gstub2, () => apiOf(gdb2).call('ai.parseParcel', basicPayload(), { clientRequestId: rid() }));
  t.eq({ recognized: gAllowed.data.recognized, calls: gstub2.callCount(), global: counterValue(gdb2, quotaKey('global', NOW)) },
    { recognized: true, calls: 1, global: 2 }, '全局配额边界：未满放行并自增到上限');

  const ddb = createDb();
  ddb.seed('counters', [{ _id: 'q-day1', key: quotaKey(CUSTOMER_OPENID, NOW), seq: 5, updatedAt: NOW }]);
  const dstub = okFetch({ stationId: 'P3', pickupCode: 'A123', confidence: 'HIGH' });
  const dapi = apiOf(ddb);
  const day1 = await withFetchStub(dstub, () => dapi.call('ai.parseParcel', basicPayload(), { clientRequestId: rid(), now: NOW }));
  const day2 = await withFetchStub(dstub, () => dapi.call('ai.parseParcel', basicPayload(), { clientRequestId: rid(), now: NOW + 86400000 }));
  t.eq({ day1: day1.data.recognized, day2: day2.data.recognized, calls: dstub.callCount() },
    { day1: false, day2: true, calls: 1 }, '跨自然日重置：当日打满次日恢复外呼');
  t.eq({ day1: counterValue(ddb, quotaKey(CUSTOMER_OPENID, NOW)), day2: counterValue(ddb, quotaKey(CUSTOMER_OPENID, NOW + 86400000)) },
    { day1: 5, day2: 1 }, '跨日计数分键：旧日不动、新日从 0 起算');

  const rdb = createDb();
  const rApi = apiOf(rdb);
  const rStub = okFetch({ stationId: 'P3', pickupCode: 'A123', confidence: 'LOW' });
  const replayKey = 'ai-req-replay-0001';
  const first = await withFetchStub(rStub, () => rApi.call('ai.parseParcel', basicPayload(), { clientRequestId: replayKey }));
  const countersAfterFirst = countersSignature(rdb);
  const callsAfterFirst = rStub.callCount();
  const replay = await withFetchStub(rStub, () => rApi.call('ai.parseParcel', basicPayload(), { clientRequestId: replayKey }));
  t.eq({ failureId: replay.data.failureId, keys: buildDegradedKeys(replay.data), records: failuresOf(rdb).length },
    { failureId: first.data.failureId, keys: DTO_KEY_SET, records: 1 }, '同 requestKey 重放：同一 failureId、DTO 键集不变、零新增记录');
  t.eq({ counters: countersSignature(rdb), calls: rStub.callCount() }, { counters: countersAfterFirst, calls: callsAfterFirst },
    '重放不重复配额计数、不重复外呼');
}

// ---------------------------------------------------------------- C 票据
async function ticketSilentGroup(t) {
  const db = createDb({ aiFallback: { enabled: false } });
  db.seed('upload_tickets', [
    ticketDoc('TICKET-AI-OK000001', 'TICKET', CUSTOMER_OPENID, NOW + 300000, null),
    ticketDoc('TICKET-AI-EXP00001', 'TICKET', CUSTOMER_OPENID, NOW - 1000, null),
    ticketDoc('TICKET-AI-USED0001', 'TICKET', CUSTOMER_OPENID, NOW + 300000, NOW - 500),
    ticketDoc('TICKET-AI-AVATAR01', 'AVATAR', CUSTOMER_OPENID, NOW + 300000, null),
    ticketDoc('TICKET-AI-OTHER001', 'TICKET', PARTNER_OPENID, NOW + 300000, null)
  ]);
  const api = apiOf(db, CUSTOMER_OPENID, NO_KEY_ENV);
  const cases = [
    ['TICKET-AI-OK000001', false, '合法票据：ticketInvalid=false'],
    ['TICKET-AI-EXP00001', true, '过期票据：不拒绝但 ticketInvalid=true（仍入队供排查）'],
    ['TICKET-AI-USED0001', true, '已消费票据：不拒绝但 ticketInvalid=true'],
    ['TICKET-AI-AVATAR01', true, 'purpose=AVATAR 票据：不拒绝但 ticketInvalid=true'],
    ['TICKET-AI-OTHER001', true, '非本人票据：不拒绝但 ticketInvalid=true'],
    ['TICKET-AI-MISSING01', true, '票据缺失：不拒绝但 ticketInvalid=true']
  ];
  const normalized = [];
  for (let i = 0; i < cases.length; i += 1) {
    const resp = await api.call('ai.parseParcel', basicPayload({ uploadTicketId: cases[i][0] }), { clientRequestId: rid() });
    const record = lastFailure(db);
    normalized.push({ resp, record });
    t.eq({ ok: resp.ok, code: resp.code, ticketInvalid: record.ruleResult && record.ruleResult.ticketInvalid },
      { ok: true, code: undefined, ticketInvalid: cases[i][1] }, cases[i][2]);
  }
  t.check(normalized.every((item) => !!item.resp.data.failureId), '票据失效各路径都返回 failureId（§7.9 静默降级）');
  t.eq(normalized[0].record.uploadTicketId, 'TICKET-AI-OK000001', '合法票据 id 原样写入失败记录（不复制 cloudPath）');
  t.eq(normalized[0].record.ruleResult.conflicts, [], '合法票据无冲突码');
  t.notEmpty(failuresOf(db), '票据样本非空（失败记录确实写入）');
}

async function ticketSessionGroup(t) {
  const sdb = createDb({ aiFallback: { enabled: false } });
  sdb.seed('admin_view_sessions', [
    sessionDoc('TK-AI-TEST', 'TEST_WRITE', TEST_CUSTOMER_OPENID, 'CABCDTEST', true),
    sessionDoc('TK-AI-RO', 'READONLY', CUSTOMER_OPENID, 'CABCDEFGH', false)
  ]);
  const sapi = apiOf(sdb, ADMIN_OPENID, NO_KEY_ENV);
  const testWrite = await sapi.call('ai.parseParcel', basicPayload(), { viewTicket: 'TK-AI-TEST', clientRequestId: rid() });
  const readonly = await sapi.call('ai.parseParcel', basicPayload(), { viewTicket: 'TK-AI-RO', clientRequestId: rid() });
  t.eq({ testWrite: testWrite.code, readonly: readonly.code }, { testWrite: 'FORBIDDEN', readonly: 'FORBIDDEN' },
    '切换会话（TEST_WRITE/READONLY）调识别兜底一律 FORBIDDEN（ENGINEERING §4.10.7）');
  t.eq(failuresOf(sdb).length, 0, 'FORBIDDEN 路径零入队（不产生测试复核记录）');
  t.eq(sdb.dump('counters').length, 0, 'FORBIDDEN 路径零配额计数（未进 handler）');
  const scope = aiCommon.scopeOf({
    identity: { effectiveOpenid: TEST_CUSTOMER_OPENID, role: 'CUSTOMER', viewMode: 'TEST_WRITE' },
    openid: ADMIN_OPENID
  });
  t.eq({ openid: scope.openid, role: scope.role, viewMode: scope.viewMode },
    { openid: TEST_CUSTOMER_OPENID, role: 'CUSTOMER', viewMode: 'TEST_WRITE' }, 'scopeOf 归属 effectiveOpenid（票据会话身份口径）');
}

// ---------------------------------------------------------------- D 降级 DTO 形状
async function gdbCall(db, stub, payloadExtra) {
  const api = apiOf(db);
  return withFetchStub(stub, () => api.call('ai.parseParcel', basicPayload(payloadExtra), { clientRequestId: rid() }));
}

async function degradedGroup(t) {
  const db = createDb();
  const disabledApi = apiOf(db, CUSTOMER_OPENID, NO_KEY_ENV);
  const cases = [
    ['disabled', () => withFetchStub(okFetch({}), () => disabledApi.call('ai.parseParcel', basicPayload(), { clientRequestId: rid() }))],
    ['noText', () => gdbCall(db, okFetch({}), { ocrTextMasked: '   ' })],
    ['llmError', () => gdbCall(db, statusFetch(500), {})],
    ['parseMiss', () => gdbCall(db, okFetch({ stationId: 'P3', confidence: 'HIGH' }), {})],
    ['lowConfidence', () => gdbCall(db, okFetch({ stationId: 'P3', pickupCode: 'A123', confidence: 'LOW' }), {})]
  ];
  for (let i = 0; i < cases.length; i += 1) {
    const resp = await cases[i][1]();
    const data = resp.data || {};
    t.eq({ ok: resp.ok, recognized: data.recognized, needsReview: data.needsReview },
      { ok: true, recognized: false, needsReview: true }, cases[i][0] + '：降级仍 ok:true/recognized:false/needsReview:true');
    t.eq(buildDegradedKeys(data), DTO_KEY_SET, cases[i][0] + '：响应键集合恰为 DTO_KEYS');
    t.check(AI_SOURCE_DOMAIN.indexOf(data.source) >= 0, cases[i][0] + '：source∈{RULE,DEEPSEEK,NONE}');
    t.check(FAILURE_NO_RE.test(data.failureId || ''), cases[i][0] + '：failureId 形态合法');
  }
  const data = (await cases[2][1]()).data;
  t.eq(['code', 'message', 'stack', 'ocrText', 'ocrTextMasked', 'duplicated'].filter((key) => key in data), [],
    '降级响应不返回错误码/堆栈/原始 ocrText/幂等内部字段');
  t.eq(Object.keys(data).every((key) => DTO_KEYS.indexOf(key) >= 0), true, '降级响应无 DTO 白名单外键');
  const dto = parseLib.buildDegradedDto({ failureNo: 'F-20261021-ABCDEF', duplicated: true }, {}, { source: 'NONE' });
  t.eq({ duplicated: 'duplicated' in dto, failureId: dto.failureId, confidence: dto.confidence },
    { duplicated: false, failureId: 'F-20261021-ABCDEF', confidence: 'LOW' }, 'buildDegradedDto：duplicated 不进 DTO、failureId/failureNo 映射');
}

// ---------------------------------------------------------------- E 入队字段 + fileId 回填前提
async function queueFieldsGroup(t) {
  const db = createDb({ retentionDays: 7 });
  db.seed('upload_tickets', [ticketDoc('TICKET-AI-QUEUE01', 'TICKET', CUSTOMER_OPENID, NOW + 300000, null)]);
  const stub = okFetch({ stationId: 'P3', pickupCode: 'A123', confidence: 'LOW' });
  const resp = await withFetchStub(stub, () => apiOf(db).call('ai.parseParcel',
    { ocrTextMasked: PII_TEXT, uploadTicketId: 'TICKET-AI-QUEUE01', role: 'CUSTOMER' }, { clientRequestId: 'ai-req-queue-0001' }));
  const record = lastFailure(db);
  t.eq({ ok: resp.ok, recognized: resp.data.recognized, calls: stub.callCount() },
    { ok: true, recognized: false, calls: 1 }, '低置信：静默降级且外呼 1 次');
  t.eq(Object.keys(record).sort(), QUEUE_KEYS, '入队记录键集合对齐 DATA_MODEL §2.14（无多余/缺失字段）');
  t.eq({ failureCode: record.failureCode, status: record.status, reviewedAt: record.reviewedAt },
    { failureCode: 'LOW_CONFIDENCE', status: 'PENDING', reviewedAt: null }, '低置信 failureCode=LOW_CONFIDENCE + PENDING');
  t.check(FAILURE_NO_RE.test(record.failureNo || ''), 'failureNo 形态 F-YYYYMMDD-XXXXXX');
  t.eq({ requestKey: record.requestKey, uploaderOpenid: record.uploaderOpenid, sourceRole: record.sourceRole },
    { requestKey: CUSTOMER_OPENID + ':ai.parseParcel:ai-req-queue-0001', uploaderOpenid: CUSTOMER_OPENID, sourceRole: 'CUSTOMER' },
    'requestKey/uploaderOpenid/sourceRole 归属 effectiveOpenid');
  t.eq({ uploadTicketId: record.uploadTicketId, fileId: record.fileId, orderId: record.orderId },
    { uploadTicketId: 'TICKET-AI-QUEUE01', fileId: '', orderId: '' },
    '入队保留 uploadTicketId；fileId/orderId 为空（回填前提：入参白名单无 fileId，order 侧 selftest-order G 组覆盖回填）');
  const masked = record.ocrTextMasked;
  t.check(masked.indexOf('13800138000') < 0, 'ocrTextMasked 不含手机号');
  t.check(masked.indexOf('110101199003071234') < 0, 'ocrTextMasked 不含身份证');
  t.check(masked.indexOf('D4-522') < 0, 'ocrTextMasked 不含详细门牌');
  t.check(masked.length <= 2000 && masked.indexOf('取件') >= 0, 'ocrTextMasked ≤2000 且保留识别必需文本');
  t.eq(Object.keys(record.ruleResult).sort(), RULE_RESULT_KEYS, 'ruleResult 快照键集合对齐');
  t.eq({ ticketInvalid: record.ruleResult.ticketInvalid, conflicts: record.ruleResult.conflicts },
    { ticketInvalid: false, conflicts: [] }, '合法票据 ruleResult.ticketInvalid=false 且无冲突码');
  t.eq({ aiTried: record.aiTried, aiModel: record.aiModel, aiErrorCode: record.aiErrorCode },
    { aiTried: true, aiModel: 'deepseek-chat', aiErrorCode: '' }, '外呼成功但低置信：aiTried=true + 模型快照 + 无错误码');
  t.eq(Object.keys(record.aiResult || {}).sort(), AI_RESULT_KEYS, 'aiResult 快照键集合对齐');
  t.eq({ stationId: record.aiResult.stationId, confidence: record.aiResult.confidence },
    { stationId: 'P3', confidence: 'LOW' }, 'aiResult 记录 AI 原始归一结果');
  t.eq(record.retentionDays, 7, 'retentionDays 入队快照 config.recognitionFailureRetentionDays（改配置不影响已入队）');
  t.check(record.createdAt instanceof Date, 'createdAt 落 Date（服务端时间）');

  const defaultDb = createDb({ aiFallback: { enabled: false } });
  await apiOf(defaultDb, CUSTOMER_OPENID, NO_KEY_ENV).call('ai.parseParcel', basicPayload(), { clientRequestId: rid() });
  t.eq(lastFailure(defaultDb).retentionDays, 30, '未配置保留期时默认 30 天');
  const badRetentionDb = createDb({ aiFallback: { enabled: false }, retentionDays: 5 });
  await apiOf(badRetentionDb, CUSTOMER_OPENID, NO_KEY_ENV).call('ai.parseParcel', basicPayload(), { clientRequestId: rid() });
  t.eq(lastFailure(badRetentionDb).retentionDays, 30, '反例：越界保留期（5 天）回落默认 30');
  t.eq(apiEnums.FAILURE_CODE_LIST.indexOf(lastFailure(db).failureCode) >= 0, true, '入队 failureCode ∈ 5 值集合');
}

// ---------------------------------------------------------------- F 规则优先合并（端到端）
async function mergeGroup(t) {
  const db = createDb();
  const api = apiOf(db);
  const aiHigh = okFetch({ stationId: 'P3', pickupCode: 'B456', confidence: 'HIGH' });
  const ruleBoth = await withFetchStub(aiHigh, () => api.call('ai.parseParcel',
    { ocrTextMasked: '西苑菜鸟驿站（西苑五食堂22栋） 取件码 A123', uploadTicketId: '', role: 'CUSTOMER' },
    { clientRequestId: rid() }));
  t.eq({ ok: ruleBoth.ok, recognized: ruleBoth.data.recognized, calls: aiHigh.callCount() },
    { ok: true, recognized: true, calls: 1 }, '规则已命中站点+码：仍按实现外呼 1 次后合并');
  t.eq({ stationId: ruleBoth.data.stationId, stationName: ruleBoth.data.stationName },
    { stationId: 'P5', stationName: stations.stationNameOf('P5') }, '规则站点不被 AI 覆盖（即使 AI 给 P3）');
  t.eq({ pickupCode: ruleBoth.data.pickupCode, source: ruleBoth.data.source, needsReview: ruleBoth.data.needsReview },
    { pickupCode: 'A123', source: 'RULE', needsReview: false }, '规则取件码不被覆盖 + 来源 RULE');
  t.eq(failuresOf(db).length, 0, '规则直接可用：不写失败队列（不产生空记录）');

  const aiFill = okFetch({ stationId: 'P3', pickupCode: 'C789D', confidence: 'HIGH' });
  const ruleStationOnly = await withFetchStub(aiFill, () => api.call('ai.parseParcel',
    { ocrTextMasked: '西苑一栋邮政 取件', uploadTicketId: '', role: 'CUSTOMER' }, { clientRequestId: rid() }));
  t.eq({ stationId: ruleStationOnly.data.stationId, pickupCode: ruleStationOnly.data.pickupCode, source: ruleStationOnly.data.source },
    { stationId: 'P7', pickupCode: 'C789D', source: 'RULE' }, '规则缺码：AI 只补空码，不覆盖规则站点');

  const aiStation = okFetch({ stationId: 'P6', pickupCode: 'B456', confidence: 'HIGH' });
  const ruleCodeOnly = await withFetchStub(aiStation, () => api.call('ai.parseParcel',
    { ocrTextMasked: '取件码 A123', uploadTicketId: '', role: 'CUSTOMER' }, { clientRequestId: rid() }));
  t.eq({ stationId: ruleCodeOnly.data.stationId, pickupCode: ruleCodeOnly.data.pickupCode },
    { stationId: 'P6', pickupCode: 'A123' }, '规则缺站：AI 只补空站，不覆盖规则取件码');

  const lowDb = createDb();
  const aiLow = okFetch({ stationId: 'P3', pickupCode: 'A123', confidence: 'LOW' });
  const lowResp = await withFetchStub(aiLow, () => apiOf(lowDb).call('ai.parseParcel', basicPayload(), { clientRequestId: rid() }));
  const lowRecord = lastFailure(lowDb);
  t.eq({ recognized: lowResp.data.recognized, confidence: lowResp.data.confidence, needsReview: lowResp.data.needsReview, source: lowResp.data.source },
    { recognized: false, confidence: 'LOW', needsReview: true, source: 'DEEPSEEK' }, 'AI 低置信：needsReview + 来源 DEEPSEEK 预填建议');
  t.eq({ failureCode: lowRecord.failureCode, aiResult: !!lowRecord.aiResult },
    { failureCode: 'LOW_CONFIDENCE', aiResult: true }, '低置信写 LOW_CONFIDENCE 并保留 AI 结果快照');
  t.eq({ stationId: lowResp.data.stationId, pickupCode: lowResp.data.pickupCode },
    { stationId: 'P3', pickupCode: 'A123' }, '低置信仍可预填字段（客户端只填空、不覆盖手填）');
}

// ---------------------------------------------------------------- §7.3.23 入参/身份闸
async function inputGateGroup(t) {
  const db = createDb({ aiFallback: { enabled: false } });
  const api = apiOf(db);
  const noRid = await api.call('ai.parseParcel', basicPayload(), { clientRequestId: '' });
  t.eq({ ok: noRid.ok, code: noRid.code, field: noRid.data && noRid.data.field },
    { ok: false, code: 'VALIDATION_FAILED', field: 'clientRequestId' }, '写动作必须带 clientRequestId（幂等键无法构造即拒绝）');
  const tooLong = await api.call('ai.parseParcel', basicPayload({ ocrTextMasked: 'x'.repeat(2001) }), { clientRequestId: rid() });
  t.eq({ code: tooLong.code, field: tooLong.data && tooLong.data.field },
    { code: 'VALIDATION_FAILED', field: 'ocrTextMasked' }, 'ocrTextMasked 超 2000：VALIDATION_FAILED 且指明字段');
  const boundary = await api.call('ai.parseParcel', basicPayload({ ocrTextMasked: 'x'.repeat(2000) }), { clientRequestId: rid() });
  t.eq(boundary.ok, true, 'ocrTextMasked 恰 2000 字：放行（边界含 2000）');
  const notString = await api.call('ai.parseParcel', basicPayload({ ocrTextMasked: 123 }), { clientRequestId: rid() });
  t.eq({ code: notString.code, field: notString.data && notString.data.field },
    { code: 'VALIDATION_FAILED', field: 'ocrTextMasked' }, '非字符串 ocrTextMasked：VALIDATION_FAILED');
  const badTail = await api.call('ai.parseParcel', basicPayload({ hintTrackingTail: '1234' }), { clientRequestId: rid() });
  t.eq({ code: badTail.code, field: badTail.data && badTail.data.field },
    { code: 'VALIDATION_FAILED', field: 'hintTrackingTail' }, '非法运单尾号：VALIDATION_FAILED 且指明字段');
  const mismatch = await api.call('ai.parseParcel', basicPayload({ role: 'PARTNER' }), { clientRequestId: rid() });
  t.eq({ code: mismatch.code, field: mismatch.data && mismatch.data.field },
    { code: 'VALIDATION_FAILED', field: 'role' }, 'role 与当前身份不一致：VALIDATION_FAILED（防越权冒用角色）');
  const adminRole = await api.call('ai.parseParcel', basicPayload({ role: 'ADMIN' }), { clientRequestId: rid() });
  t.eq({ code: adminRole.code, ok: adminRole.ok }, { code: 'FORBIDDEN', ok: false }, 'role=ADMIN：无业务角色 → FORBIDDEN');
  const noRoleDb = createDb({ aiFallback: { enabled: false } });
  noRoleDb.seed('users', [userDoc('openid-no-role', [], {})]);
  const noRole = await apiOf(noRoleDb, 'openid-no-role').call('ai.parseParcel', basicPayload(), { clientRequestId: rid() });
  t.eq(noRole.code, 'FORBIDDEN', '无业务角色用户：FORBIDDEN（不静默降级）');
  const anonymous = await app.createApi({ db: createDb({ aiFallback: { enabled: false } }), now: () => NOW, openid: '', env: KEY_ENV })
    .call('ai.parseParcel', basicPayload(), { clientRequestId: rid() });
  t.eq({ ok: anonymous.ok, code: anonymous.code }, { ok: false, code: 'FORBIDDEN' }, '未登录（无 OPENID）：FORBIDDEN');
}

function register(h) {
  registerPayloadSection(h);
  registerParseSection(h);
  registerMergeSection(h);
  registerStaticSection(h);
  h.section('§7.3.21/23~28 AI 兜底链路端到端（外呼闸/入参闸/配额/票据/降级 DTO/入队/规则优先；串行）', async (t) => {
    await gateConfigGroup(t);
    await gateDisabledKeyGroup(t);
    await gateHappyGroup(t);
    await gateErrorMappingGroup(t);
    await gateTimeoutGroup(t);
    await gateBreakerGroup(t);
    await gateBodyPromptGroup(t);
    await inputGateGroup(t);
    await quotaBoundaryGroup(t);
    await quotaWindowGroup(t);
    await ticketSilentGroup(t);
    await ticketSessionGroup(t);
    await degradedGroup(t);
    await queueFieldsGroup(t);
    await mergeGroup(t);
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-ai' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-ai');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
