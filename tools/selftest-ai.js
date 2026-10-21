'use strict';
/**
 * tools/selftest-ai.js — AI 识别兜底单测（ENGINEERING §7.3 #21/#22；CONTRACT v0.9 §4.3）。
 *
 * 覆盖：外发 payload 白名单 / 服务端二次去敏 / 外呼适配（注入 fetch，零真实外呼）/ 超时重试熔断 /
 *       模型输出解析与 DTO 字段闸 / 失败必写 recognition_failures（handler 齐后启用）。
 * 纪律：有判别力（先合法基线、再只有该闸能挡的反例）；不真实外呼、不连真库；单文件 ≤1000 行。
 *
 * 取数：node tools/selftest-ai.js | Select-Object -Last 2
 */
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const payloadLib = require(path.join(API, 'lib/ai/payload.js'));
const deepseek = require(path.join(API, 'lib/ai/deepseek.js'));
const parseLib = require(path.join(API, 'lib/ai/parse.js'));
const promptLib = require(path.join(API, 'lib/ai/prompt.js'));
const sharedEnums = require(path.join(ROOT, 'shared/enums.js'));

const EXPECTED_ASSERTIONS = 86;

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
  return makeFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  }));
}

function statusFetch(status) {
  return makeFetch(async () => ({
    ok: false,
    status,
    json: async () => ({ error: { message: 'stub failure' } })
  }));
}

function networkErrorFetch() {
  return makeFetch(async () => {
    throw new Error('stub network down');
  });
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

function aiConfig(overrides) {
  return {
    aiFallback: Object.assign({
      enabled: true,
      model: 'deepseek-chat',
      timeoutMs: 1000,
      maxPerUserPerDay: 5,
      dailyQuota: 200,
      cooldownMinutes: 10
    }, overrides || {})
  };
}

function probeApiReady() {
  try {
    const router = require(path.join(API, 'router.js'));
    router.getRouter();
    return { ready: true, error: '' };
  } catch (error) {
    return { ready: false, error: error.message };
  }
}

function pendingAsserts(t, count, reason) {
  for (let i = 0; i < count; i += 1) {
    t.check(false, '待 11 域 handlers 齐后重跑：' + reason);
  }
}

function register(h) {
  // ---------------------------------------------------------------- §7.3.20 外发白名单与二次去敏
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

  // ---------------------------------------------------------------- §7.3.21 外呼适配（注入 fetch）
  h.section('§7.3.21 AI 外呼：开关/Key/超时/重试/熔断', async (t) => {
    t.eq(deepseek.ENDPOINT, 'https://api.deepseek.com/chat/completions', '唯一外呼端点');
    t.eq(deepseek.KEY_ENV_NAME, 'DEEPSEEK_API_KEY', 'Key 只从该环境变量读');
    t.eq(Object.keys(deepseek.AI_ERROR_CODES).length, 6, '内部排障码 6 个（不占业务错误码）');
    t.eq(deepseek.normalizeAiConfig(undefined).timeoutMs, 8000, '缺省超时 8000ms');
    t.eq(deepseek.normalizeAiConfig(undefined).enabled, false, '缺省关闭（未配置不外呼）');

    deepseek.resetCircuitBreaker();
    const disabledFetch = okFetch('{}');
    const disabledClient = deepseek.createDeepSeekClient({
      fetchImpl: disabledFetch,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      config: aiConfig({ enabled: false })
    });
    const disabledResult = await disabledClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
    t.check(disabledResult.ok === false && disabledResult.aiTried === false && disabledResult.errorCode === 'DISABLED',
      '开关关闭：零外呼 + 不标记 aiTried');
    t.eq(disabledFetch.callCount(), 0, '开关关闭零外呼（fetch 调用数 0）');

    const noKeyFetch = okFetch('{}');
    const noKeyClient = deepseek.createDeepSeekClient({ fetchImpl: noKeyFetch, env: {}, config: aiConfig() });
    const noKeyResult = await noKeyClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
    t.check(noKeyResult.errorCode === 'DISABLED' && noKeyFetch.callCount() === 0,
      'Key 缺失：零外呼 + DISABLED');

    deepseek.resetCircuitBreaker();
    const okClientFetch = okFetch('{"stationId":"P3","pickupCode":"A123"}');
    const okClient = deepseek.createDeepSeekClient({
      fetchImpl: okClientFetch,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      config: aiConfig()
    });
    const okResult = await okClient.complete({ ocrTextMasked: 'P3 丰巢 A123', role: 'CUSTOMER' }, {});
    t.check(okResult.ok === true && okResult.aiTried === true, '正常响应：ok + aiTried');
    t.eq(okClientFetch.callCount(), 1, '正常响应只外呼 1 次');
    const sentBody = JSON.parse(okClientFetch.calls[0].options.body);
    t.eq(sentBody.temperature, 0, 'temperature=0');
    t.eq(sentBody.response_format, { type: 'json_object' }, 'response_format=json_object');
    t.eq(sentBody.model, 'deepseek-chat', 'model 取 config.aiFallback.model');
    t.check(okClientFetch.calls[0].options.body.indexOf('openid') < 0 &&
      okClientFetch.calls[0].options.body.indexOf('fileId') < 0,
      '外发请求体零身份/文件键');

    deepseek.resetCircuitBreaker();
    const fail5xxFetch = statusFetch(500);
    const fail5xxClient = deepseek.createDeepSeekClient({
      fetchImpl: fail5xxFetch,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      config: aiConfig()
    });
    const fail5xxResult = await fail5xxClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
    t.check(fail5xxResult.ok === false && fail5xxResult.errorCode === 'HTTP_5XX', '5xx 失败归因 HTTP_5XX');
    t.eq(fail5xxFetch.callCount(), 2, '5xx 重试 1 次（共 2 次外呼）');

    deepseek.resetCircuitBreaker();
    const fail4xxFetch = statusFetch(400);
    const fail4xxClient = deepseek.createDeepSeekClient({
      fetchImpl: fail4xxFetch,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      config: aiConfig()
    });
    await fail4xxClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
    t.eq(fail4xxFetch.callCount(), 1, '4xx 不重试（只 1 次外呼）');

    deepseek.resetCircuitBreaker();
    const netFetch = networkErrorFetch();
    const netClient = deepseek.createDeepSeekClient({
      fetchImpl: netFetch,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      config: aiConfig()
    });
    const netResult = await netClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
    t.check(netResult.ok === false, '网络错误不外抛（降级结果）');
    t.eq(netFetch.callCount(), 2, '网络错误重试 1 次（共 2 次外呼）');

    deepseek.resetCircuitBreaker();
    const timeoutFetch = hangingFetch();
    const timeoutClient = deepseek.createDeepSeekClient({
      fetchImpl: timeoutFetch,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      config: aiConfig({ timeoutMs: 25 })
    });
    const timeoutResult = await timeoutClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
    t.eq(timeoutResult.errorCode, 'TIMEOUT', '超时归因 TIMEOUT（不外抛）');
    t.check(timeoutFetch.callCount() >= 1, '超时路径确实发起了外呼替身调用');

    deepseek.resetCircuitBreaker();
    const breakerFetch = statusFetch(503);
    const breakerClient = deepseek.createDeepSeekClient({
      fetchImpl: breakerFetch,
      env: { DEEPSEEK_API_KEY: 'test-key' },
      config: aiConfig()
    });
    for (let i = 0; i < 5; i += 1) {
      await breakerClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
    }
    t.check(deepseek.breakerSnapshot().openUntil > 0, '连续 5 次失败进入熔断');
    const callsBeforeOpen = breakerFetch.callCount();
    const openResult = await breakerClient.complete({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, {});
    t.eq(openResult.errorCode, 'CIRCUIT_OPEN', '熔断期内返回 CIRCUIT_OPEN');
    t.eq(breakerFetch.callCount(), callsBeforeOpen, '熔断期内零外呼');
    deepseek.resetCircuitBreaker();
    t.eq(deepseek.breakerSnapshot().openUntil, 0, 'resetCircuitBreaker 可复位（测试隔离）');

    const body = deepseek.buildRequestBody({ ocrTextMasked: 'P3 A123', role: 'CUSTOMER' }, { model: 'deepseek-chat' });
    t.notEmpty(body.messages, '外呼 messages 非空');
    t.eq(body.temperature, 0, 'buildRequestBody 温度 0');
    t.eq(deepseek.buildRequestBody({ ocrTextMasked: 'x', role: 'ADMIN' }, {}), null, '非法入参构造 body 返回 null');
    t.eq(promptLib.OUTPUT_KEYS.indexOf('stationId') >= 0, true, 'system prompt 输出键含 stationId');
  });

  // ---------------------------------------------------------------- §7.3.22 模型输出解析与 DTO 闸
  h.section('§7.3.22 AI 输出解析与 DTO 字段闸', (t) => {
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

    const stations = [{ id: 'P3', name: '三号驿站' }];
    const normalized = parseLib.normalizeAiFields({
      stationId: 'p3',
      stationName: '模型臆造站点',
      pickupCode: 'a-123',
      trackingTail: '12 345',
      lockerNo: '12 号柜',
      confidence: 'MEDIUM',
      extra: 'should-drop'
    }, { stationIds: ['P1', 'P2', 'P3'], stations });
    t.eq(normalized.stationName, '三号驿站', '模型给的站点名不被信任（用站点表回填）');
    t.eq(normalized.recognized, true, '站点 + 取件码齐全才 recognized=true');
    t.check(Object.keys(normalized).every((key) => parseLib.DTO_KEYS.indexOf(key) >= 0),
      '归一结果只含 DTO 白名单键（未知键被剥离）');
    const missingCode = parseLib.normalizeAiFields({ stationId: 'P3', pickupCode: '' }, { stationIds: ['P1', 'P2', 'P3'], stations });
    t.eq(missingCode.recognized, false, '反例：缺取件码 recognized=false');
    const missingStation = parseLib.normalizeAiFields({ stationId: '', pickupCode: 'A123' }, { stationIds: ['P1', 'P2', 'P3'], stations });
    t.eq(missingStation.recognized, false, '反例：缺站点 recognized=false');

    const ruleBaseline = parseLib.mergeFields(
      { stationId: 'P2', stationName: '二号驿站', pickupCode: 'RULE1', trackingTail: '', lockerNo: '' },
      { stationId: 'P3', stationName: '三号驿站', pickupCode: 'AI123', trackingTail: '12345', lockerNo: 'A1', confidence: 'HIGH' }
    );
    t.eq(ruleBaseline.source, 'RULE', '规则字段优先：来源 RULE');
    t.eq(ruleBaseline.fields.stationId, 'P2', '规则站点不被 AI 覆盖');
    t.eq(ruleBaseline.fields.trackingTail, '12345', '规则空位由 AI 补齐');
    const aiOnly = parseLib.mergeFields({ stationId: '', pickupCode: '' }, { stationId: 'P3', stationName: '三号驿站', pickupCode: 'AI123', trackingTail: '', lockerNo: '', confidence: 'HIGH' });
    t.eq(aiOnly.source, 'DEEPSEEK', '规则全空时来源 DEEPSEEK');
    const none = parseLib.mergeFields({}, { stationId: '', pickupCode: '' });
    t.eq(none.source, 'NONE', '规则与 AI 都空：来源 NONE');
    t.eq(Object.keys(sharedEnums.RECOGNITION_SOURCE).sort(), ['MANUAL', 'RULE'], '客户端可见 shared 枚举零第三方 AI 来源');
    t.check(parseLib.RECOGNITION_SOURCES.indexOf('DEEPSEEK') >= 0, '云侧识别来源值域含 AI 兜底来源');
  });

  // ---------------------------------------------------------------- §7.3.23 ai.parseParcel handler（需 11 域齐）
  h.section('§7.3.23 ai.parseParcel 降级/入队/handler 闸（端到端）', async (t) => {
    const apiState = probeApiReady();
    if (!apiState.ready) {
      pendingAsserts(t, 10, 'handlers/ai 尚未落盘（' + apiState.error.slice(0, 80) + '）');
      return;
    }
    const app = require(path.join(API, 'app.js'));
    const db = createFakeDb({ uniqueIndexes: {
      users: [['_id']],
      customers: [['customerNo']],
      partners: [['openid'], ['partnerNo']],
      counters: [['key']],
      recognition_failures: [['failureNo'], ['requestKey']],
      admin_view_sessions: [['requestKey']]
    } });
    const NOW = Date.parse('2026-10-21T12:00:00+08:00');
    const CUSTOMER_OPENID = 'openid-customer-ai';
    db.seed('users', [
      { _id: CUSTOMER_OPENID, roles: ['CUSTOMER'], status: 'ACTIVE', isTestAccount: false, createdAt: NOW, privacyConsent: { version: 'v4.0', at: NOW } },
      { _id: 'openid-partner-ai', roles: ['PARTNER'], status: 'ACTIVE', isTestAccount: false, createdAt: NOW }
    ]);
    db.seed('customers', [{ _id: CUSTOMER_OPENID, customerNo: 'CABCDEFGH', profileCompleted: true, dormKey: 'D4-522' }]);
    db.seed('partners', [{ _id: 'partner-ai-1', openid: 'openid-partner-ai', partnerNo: 'PABC23', status: 'ACTIVE', serviceConfig: { acceptingOrders: true } }]);
    db.seed('config', [{ _id: 'global', aiFallback: { enabled: false, model: 'deepseek-chat', timeoutMs: 8000, maxPerUserPerDay: 5, dailyQuota: 200, cooldownMinutes: 10 }, privacyVersion: 'v4.0' }]);
    const api = app.createApi({ db, now: () => NOW, openid: CUSTOMER_OPENID, env: {} });

    const degraded = await api.call('ai.parseParcel', {
      ocrTextMasked: 'P3 丰巢 取件码 A123',
      uploadTicketId: '',
      role: 'CUSTOMER'
    }, { clientRequestId: 'ai-request-000000000001' });
    t.check(degraded.ok === true, 'AI 关闭时仍返回 ok:true（降级不占错误码）');
    t.check(degraded.data.recognized === false, '降级：recognized=false');
    t.check(degraded.data.needsReview === true, '降级：needsReview=true');
    t.check(!!degraded.data.failureId, '降级：返回 failureId');
    const failuresOf = db.dump('recognition_failures');
    t.eq(failuresOf.length, 1, '失败必入队：写 1 条 recognition_failures');
    t.check(!!failuresOf[0] && failuresOf[0].uploaderOpenid === CUSTOMER_OPENID, '失败记录归属 effectiveOpenid');
    const replay = await api.call('ai.parseParcel', {
      ocrTextMasked: 'P3 丰巢 取件码 A123',
      uploadTicketId: '',
      role: 'CUSTOMER'
    }, { clientRequestId: 'ai-request-000000000001' });
    t.check(replay.ok === true, '同 requestKey 重放仍 ok:true');
    t.eq(db.dump('recognition_failures').length, 1, '同 requestKey 重放不新增失败记录');
    const invalidRole = await api.call('ai.parseParcel', { ocrTextMasked: 'x', role: 'ADMIN' }, { clientRequestId: 'ai-request-000000000002' });
    t.check(invalidRole.ok === false, '反例：非法角色被拒（非 ok:true 降级）');
    t.eq(invalidRole.code, 'FORBIDDEN', '非法角色错误码 FORBIDDEN（无业务角色）');
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
