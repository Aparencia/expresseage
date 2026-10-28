'use strict';
/**
 * tools/selftest-security.js — v1.1/D34「后端安全基线」断言套件。
 *
 * 覆盖：
 *   A. 入参总闸 request-guard：合法基线、体积上限、层级上限、键数上限、单字符串上限、
 *      嵌套危险键剥离（含数组内）、非对象 payload 交由 validate、链首装配；
 *   B. 协议层：clientRequestId 写动作强校验、expectedVersion 格式、顶层危险键剥离；
 *   C. 限流覆盖：资料/配置/解绑/URL 签发/后台补录等写与敏感读均登记规则；ai.parseParcel 本层豁免；
 *      新增规则实际打满行为（fake DAO 计数）；
 *   D. 管理员闸：无 developerNo 拒绝、带票据拒绝、requireAdmin fail-closed、写动作必须 clientRequestId；
 *   E. 切换会话边界：读白名单/测试写禁止项/退出动作；
 *   F. 静态与包络：云函数层无 userInfo 伪造入口、日志不含敏感变量、内部动作分支唯一、
 *      错误包络不回堆栈、错误码集合恰 13、admin handler 均走 createAdminScope。
 *
 * 取数：node tools/selftest-security.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const fsutil = require('./lib/fsutil');

const API = path.join(ROOT, 'cloudfunctions/api');
const requestGuard = require(path.join(API, 'middleware/request-guard.js'));
const middlewares = require(path.join(API, 'middleware/index.js'));
const validateMw = require(path.join(API, 'middleware/validate.js'));
const idempotency = require(path.join(API, 'middleware/idempotency.js'));
const auditMw = require(path.join(API, 'middleware/audit.js'));
const switchSession = require(path.join(API, 'middleware/switch-session.js'));
const ratelimit = require(path.join(API, 'middleware/ratelimit.js'));
const actions = require(path.join(API, 'shared/actions.js'));
const errorCodes = require(path.join(API, 'shared/error-codes.js'));
const adminCommon = require(path.join(API, 'handlers/admin/_common.js'));
const errors = require(path.join(API, 'lib/errors.js'));
const respond = require(path.join(API, 'lib/respond.js'));

const EXPECTED_ASSERTIONS = 56; // 运行后校准（少算/多算都判红）
const NOW = Date.parse('2026-10-29T10:00:00+08:00');

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

function codeOf(rel) {
  return fsutil.stripComments(textOf(rel));
}

function makeState(action, payload, ctxPatch, metaPatch) {
  const spec = actions.ACTION_MAP[action] || { visibility: 'client', write: false };
  const ctx = Object.assign({
    openid: 'openid-sec',
    identity: {
      actorOpenid: 'openid-sec',
      effectiveOpenid: 'openid-sec',
      role: 'CUSTOMER',
      isTestAccount: false,
      viewMode: '',
      viewTicketId: '',
      developerNo: ''
    },
    clientRequestId: '',
    requestId: 'req-sec',
    now: NOW
  }, ctxPatch || {});
  return {
    action: action,
    payload: payload === undefined ? {} : payload,
    ctx: ctx,
    meta: Object.assign({ spec: spec, viewTicket: '', hasViewTicket: false, clientRequestId: '' }, metaPatch || {})
  };
}

async function expectReject(promise, code, message) {
  try {
    await promise;
  } catch (error) {
    if (error && error.code === code) {
      return true;
    }
    console.log('[detail] ' + message + ' | 实际错误码=' + (error && error.code) + ' 消息=' + (error && error.message));
    return false;
  }
  console.log('[detail] ' + message + ' | 未抛错');
  return false;
}

function expectSyncError(fn, code, message) {
  try {
    fn();
  } catch (error) {
    if (error && error.code === code) {
      return true;
    }
    console.log('[detail] ' + message + ' | 实际错误码=' + (error && error.code) + ' 消息=' + (error && error.message));
    return false;
  }
  console.log('[detail] ' + message + ' | 未抛错');
  return false;
}

function walkJs(dir) {
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push.apply(out, walkJs(full));
      return;
    }
    if (entry.isFile() && /\.js$/.test(entry.name)) {
      out.push(full);
    }
  });
  return out;
}

function buildCountingDao() {
  const rows = new Map();
  return {
    rows: rows,
    transaction: async (fn) => fn({
      findOne: async (coll, opts) => {
        const key = opts && opts.where && opts.where.key;
        return rows.has(key) ? { _id: key, seq: rows.get(key) } : null;
      },
      add: async (coll, doc) => {
        rows.set(doc.key, doc.seq);
        return { _id: doc.key };
      },
      update: async (coll, id, patch) => {
        rows.set(id, patch.seq);
      }
    })
  };
}

function register(h) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };
  const asyncSection = (title, fn) => h.section(title, (t) => serial(() => fn(t)));

  // ---------------------------------------------------------------- A. request-guard
  asyncSection('§11.3 A 入参总闸（体积/层级/键数/字符串/危险键）', async (t) => {
    t.eq(middlewares.CHAIN[0], requestGuard.middleware, 'A1 中间件链首位=request-guard（先于 auth，只读 payload 形状）');
    t.check(requestGuard.MAX_PAYLOAD_BYTES >= 8192 && requestGuard.MAX_PAYLOAD_BYTES <= 262144,
      'A2 体积上限在合理区间（≥8KB 且 ≤256KB）');

    const baseline = makeState('order.get', { orderNo: 'O1', nested: { page: 1 } });
    await requestGuard.middleware(baseline);
    t.eq(baseline.payload, { orderNo: 'O1', nested: { page: 1 } }, 'A3 合法基线原样保留');
    t.check(baseline.meta.requestGuard && baseline.meta.requestGuard.bytes > 0, 'A4 合法基线记录体积');

    const oversize = makeState('order.get', { big: 'x'.repeat(requestGuard.MAX_PAYLOAD_BYTES + 100) });
    t.check(await expectReject(requestGuard.middleware(oversize), 'VALIDATION_FAILED', 'A5 超体积'),
      'A5 超体积 payload → VALIDATION_FAILED（不是抛 INTERNAL_ERROR）');

    let deep = { leaf: 1 };
    for (let i = 0; i < requestGuard.MAX_DEPTH + 3; i += 1) {
      deep = { child: deep };
    }
    t.check(await expectReject(requestGuard.middleware(makeState('order.get', deep)), 'VALIDATION_FAILED', 'A6'),
      'A6 深层嵌套 → VALIDATION_FAILED');

    const keys = {};
    for (let i = 0; i < requestGuard.MAX_KEYS + 20; i += 1) {
      keys['k' + i] = i;
    }
    t.check(await expectReject(requestGuard.middleware(makeState('order.get', keys)), 'VALIDATION_FAILED', 'A7'),
      'A7 字段数超限 → VALIDATION_FAILED');

    const longState = makeState('message.send', { text: 'x'.repeat(requestGuard.MAX_STRING_LENGTH + 1) });
    t.check(await expectReject(requestGuard.middleware(longState), 'VALIDATION_FAILED', 'A8'),
      'A8 单字段超长 → VALIDATION_FAILED');

    const polluted = JSON.parse('{"rows":[{"__proto__":{"polluted":true},"ok":1}],"safe":2}');
    const protoState = makeState('order.get', polluted);
    await requestGuard.middleware(protoState);
    t.eq(protoState.payload.rows[0].ok, 1, 'A9 数组内危险键被剥离、合法字段保留');
    t.check(!Object.prototype.hasOwnProperty.call(protoState.payload.rows[0], '__proto__'),
      'A10 剥离后不存在自有 __proto__ 键');
    t.eq({}.polluted, undefined, 'A11 原型链未被污染');
    t.check(protoState.meta.requestGuard.stripped >= 1, 'A12 危险键剥离计数可观测');

    const passthrough = makeState('order.get', 'not-an-object');
    await requestGuard.middleware(passthrough);
    t.eq(passthrough.payload, 'not-an-object', 'A13 非对象 payload 不擅自改写（交给 validate 报错）');
  });

  // ---------------------------------------------------------------- B. 协议层
  asyncSection('§11.3 B 协议层（clientRequestId / expectedVersion / 顶层危险键）', async (t) => {
    const writeState = makeState('order.create', { parcels: [] });
    t.check(await expectReject(idempotency.middleware(writeState), 'VALIDATION_FAILED', 'B1 缺幂等键'),
      'B1 客户端写动作缺 clientRequestId → VALIDATION_FAILED（handler 之前拦截）');
    writeState.ctx.clientRequestId = 'A'.repeat(24);
    await idempotency.middleware(writeState);
    t.eq(writeState.meta.idempotency && writeState.meta.idempotency.clientRequestId, 'A'.repeat(24),
      'B2 合法写动作登记幂等元数据');
    const readState = makeState('order.get', { orderNo: 'O1' });
    await idempotency.middleware(readState);
    t.eq(readState.meta.idempotency, undefined, 'B3 读动作不要求幂等键');

    const badVersion = makeState('order.confirmDelivery', { orderNo: 'O1' }, {}, { expectedVersion: 'abc' });
    t.check(await expectReject(validateMw.middleware(badVersion), 'VALIDATION_FAILED', 'B4 版本号'),
      'B4 expectedVersion 非正整数 → VALIDATION_FAILED（不进 handler）');

    const dirty = JSON.parse('{"__proto__":{"polluted":1},"safe":2}');
    const clean = validateMw.sanitizePayload(dirty);
    t.eq(clean.safe, 2, 'B5 顶层危险键剥离后保留合法字段');
    t.check(!Object.prototype.hasOwnProperty.call(clean, '__proto__'), 'B6 顶层不存在自有 __proto__ 键');
  });

  // ---------------------------------------------------------------- C. 限流覆盖
  asyncSection('§11.3 C 限流覆盖（写与敏感读配额）', async (t) => {
    const required = [
      'customer.saveProfile:profileSave',
      'partner.saveProfile:partnerProfileSave',
      'partner.saveServiceConfig:serviceConfigSave',
      'bind.release:bindRelease',
      'partner.unbindCustomer:partnerUnbind',
      'order.imageUrl:imageUrl',
      'order.reportException:orderException',
      'admin.updateConfig:adminConfig',
      'admin.getRecognitionFailure:failureView',
      'admin.fixRecognitionFailure:failureFix'
    ];
    const covered = ratelimit.RATE_RULES.map((rule) => rule.action + ':' + rule.scope);
    required.forEach((key) => {
      t.check(covered.indexOf(key) >= 0, 'C1 限流覆盖 ' + key);
    });
    t.check(ratelimit.RATE_RULES.every((rule) => typeof rule.limit === 'number' && rule.limit > 0),
      'C2 所有限流规则 limit 为正整数');
    t.check(['identity', 'actor', 'order'].indexOf(ratelimit.rulesOf('admin.updateConfig', {})[0].subject) >= 0,
      'C3 后台写按 actor 主体计数（不是业务 effectiveOpenid）');
    t.eq(ratelimit.rulesOf('ai.parseParcel', {}).length, 0, 'C4 ai.parseParcel 不走本层限流（handler 静默降级）');

    const dao = buildCountingDao();
    const writeSpec = actions.ACTION_MAP['customer.saveProfile'];
    const ctx = {
      openid: 'openid-sec',
      identity: { effectiveOpenid: 'openid-sec', actorOpenid: 'openid-sec', developerNo: '' },
      now: NOW,
      requestId: 'req-rate',
      dao: dao
    };
    const rule = ratelimit.rulesOf('customer.saveProfile', {})[0];
    for (let i = 0; i < rule.limit; i += 1) {
      await ratelimit.middleware({ action: 'customer.saveProfile', payload: {}, meta: { spec: writeSpec }, ctx: ctx });
    }
    let limited = null;
    try {
      await ratelimit.middleware({ action: 'customer.saveProfile', payload: {}, meta: { spec: writeSpec }, ctx: ctx });
    } catch (error) {
      limited = error;
    }
    t.eq(limited && limited.code, 'RATE_LIMITED', 'C5 资料保存达到日额度后 → RATE_LIMITED');
    t.eq(dao.rows.size, 1, 'C6 限流计数落 counters 键（单键原子自增）');
  });

  // ---------------------------------------------------------------- D. 管理员闸
  asyncSection('§11.3 D 管理员闸（无 developerNo / 带票据 / 写动作幂等）', async (t) => {
    t.check(await expectReject(auditMw.middleware(makeState('admin.stats', {})), 'FORBIDDEN', 'D1'),
      'D1 客户端 admin.* 且身份无 developerNo → FORBIDDEN');

    const withDev = makeState('admin.stats', {}, {
      identity: {
        actorOpenid: 'openid-sec', effectiveOpenid: 'openid-sec', developerNo: 'DEV-01',
        viewMode: '', viewTicketId: '', isTestAccount: false, role: ''
      }
    });
    await auditMw.middleware(withDev);
    const withTicket = makeState('admin.stats', {}, {
      identity: {
        actorOpenid: 'openid-sec', effectiveOpenid: 'openid-target', developerNo: 'DEV-01',
        viewMode: 'READONLY', viewTicketId: 'T'.repeat(32), isTestAccount: false, role: 'CUSTOMER'
      }
    }, { hasViewTicket: true });
    t.check(await expectReject(auditMw.middleware(withTicket), 'FORBIDDEN', 'D2 带票据'),
      'D2 切换会话票据不能执行 admin.* → FORBIDDEN');

    t.check(expectSyncError(() => adminCommon.requireAdmin({ identity: {} }), 'FORBIDDEN', 'D3'),
      'D3 requireAdmin fail-closed：无 developerNo → FORBIDDEN');
    const admin = adminCommon.requireAdmin({ identity: { actorOpenid: 'o', effectiveOpenid: 'o', developerNo: 'DEV-01' } });
    t.eq(admin.developerNo, 'DEV-01', 'D4 requireAdmin 成功返回 developerNo（不返回票据/敏感值）');
    t.check(expectSyncError(() => adminCommon.requireAdmin({
      identity: { actorOpenid: 'o', effectiveOpenid: 't', developerNo: 'DEV-01', viewMode: 'READONLY' }
    }), 'FORBIDDEN', 'D5 票据身份'), 'D5 requireAdmin 拒绝切换会话身份');
    t.check(expectSyncError(() => adminCommon.requireClientRequestId({}), 'VALIDATION_FAILED', 'D6'),
      'D6 后台写动作缺 clientRequestId → VALIDATION_FAILED');
    t.eq(adminCommon.requireClientRequestId({ clientRequestId: 'A'.repeat(24) }), 'A'.repeat(24),
      'D7 后台写动作合法幂等键透传');
  });

  // ---------------------------------------------------------------- E. 切换会话边界
  asyncSection('§11.3 E 切换会话边界（白名单/禁止项/退出动作）', async (t) => {
    t.check(switchSession.VIEW_READ_WHITELIST.indexOf('order.get') >= 0
      && switchSession.VIEW_READ_WHITELIST.indexOf('config.getPublic') >= 0,
    'E1 只读视角读白名单含订单详情与公开配置');
    t.check(switchSession.VIEW_READ_WHITELIST.indexOf('order.create') < 0,
      'E2 写动作不在读白名单（票据不能借读白名单放行写）');
    t.check(['ai.parseParcel', 'partner.activate', 'user.deleteAccount']
      .every((action) => switchSession.TEST_WRITE_BLOCKED_ACTIONS.indexOf(action) >= 0),
    'E3 测试写会话禁止项含激活/注销/AI 兜底');
    t.eq(switchSession.EXIT_ACTION, 'admin.viewAsEnd', 'E4 退出动作固定 admin.viewAsEnd');
  });

  // ---------------------------------------------------------------- F. 静态与包络
  asyncSection('§11.3 F 静态与错误包络（伪造入口/日志/内部分支/错误码）', async (t) => {
    const apiFiles = walkJs(API);
    const userInfoHits = apiFiles.filter((file) => fsutil.stripComments(fs.readFileSync(file, 'utf8')).indexOf('userInfo') >= 0);
    t.eq(userInfoHits.length, 0, 'F1 云函数层零 userInfo 引用（身份只取 getWXContext OPENID）');

    const leakRe = /console\.(log|warn|error|info)\([^\n]*(payload|ocrTextMasked|phoneTail|displayName|fileId|event\.data)/;
    const logLeaks = apiFiles.filter((file) => leakRe.test(fsutil.stripComments(fs.readFileSync(file, 'utf8'))));
    t.eq(logLeaks.length, 0, 'F2 云函数日志语句不含 payload/敏感字段变量');

    t.check(codeOf('cloudfunctions/api/app.js').indexOf("spec.visibility === 'internal' && !ctx.openid") >= 0,
      'F3 无 OPENID 的内部动作分支唯一且按 visibility=internal 判定');
    const respondCode = codeOf('cloudfunctions/api/lib/respond.js');
    t.check(respondCode.indexOf('stack') < 0, 'F4 响应包络构造不引用 stack（异常细节只进日志）');
    const envelope = respond.failure(new Error('internal detail should not leak'));
    t.check(!Object.prototype.hasOwnProperty.call(envelope, 'stack')
      && JSON.stringify(envelope).indexOf('internal detail should not leak') < 0,
    'F5 非 AppError → 客户端只收到通用文案，不含内部 message/stack');
    t.eq(envelope.code, 'INTERNAL_ERROR', 'F6 非 AppError 收敛为 INTERNAL_ERROR（13 码内）');

    t.eq(errorCodes.ERROR_CODES.length, 13, 'F7 错误码集合恰 13 个（不新增安全专用错误码）');
    const adminDir = path.join(API, 'handlers/admin');
    const adminFiles = fs.readdirSync(adminDir).filter((name) => /\.js$/.test(name) && name.indexOf('_') !== 0 && name !== 'index.js');
    const guarded = adminFiles.filter((name) => name !== 'bootstrap.js'
      && fs.readFileSync(path.join(adminDir, name), 'utf8').indexOf('createAdminScope') >= 0);
    t.check(guarded.length === adminFiles.length - 1,
      'F8 除 bootstrap 外的 admin handler（' + (adminFiles.length - 1) + ' 个）都经 createAdminScope 鉴权');
    t.check(fs.readFileSync(path.join(adminDir, 'bootstrap.js'), 'utf8').indexOf('createInternalScope') >= 0,
      'F9 部署上下文（admin.bootstrap）走 createInternalScope，不放大用户身份');

    const actionNames = Object.keys(actions.ACTION_MAP);
    const adminClientActions = actionNames.filter((name) => name.indexOf('admin.') === 0
      && actions.ACTION_MAP[name].visibility === 'client');
    t.check(adminClientActions.length >= 20, 'F10 admin.* 客户端动作全部登记在 actions 注册表（' + adminClientActions.length + ' 个）');
    t.check(adminClientActions.every((name) => typeof actions.ACTION_MAP[name].write === 'boolean'),
      'F11 每个 admin.* 动作显式声明 write（审计/幂等层据此判定）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-security' });
  h.setExpected(EXPECTED_ASSERTIONS);
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-security');
  register(h);
  h.finish();
}
