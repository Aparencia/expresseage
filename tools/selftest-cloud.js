'use strict';
/**
 * tools/selftest-cloud.js — 云函数核心端到端单测（ENGINEERING §7.3；ARCHITECTURE §4）。
 *
 * 覆盖：dao 返回形状/事务、auth/validate/ratelimit/switch-session 中间件（直接注入）、
 *       health.check / admin.bootstrap / 订单状态矩阵 / 幂等 / 越权 / cleanup 时间旅行（需 handlers 齐）。
 * 纪律：fake DB 注入、不连真库、不 mock 全局 wx；有判别力（合法基线 + 只有该闸能挡的反例）。
 * 取数：node tools/selftest-cloud.js | Select-Object -Last 2
 *
 * 说明：handlers 未齐时「§7.3 端到端」「§7.3 cleanup」两节按同数量断言标记待重跑，
 *       断言总数闸仍精确；11 域齐后重跑即应全绿（届时若计数不符按提示同步 pending 数量）。
 */
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const CLEANUP = path.join(ROOT, 'cloudfunctions/cleanup');

const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const { ACTION_MAP, CLIENT_ACTIONS } = require(path.join(API, 'shared/actions.js'));
const { ROLES, USER_STATUS, ORDER_STATUS, VIEW_MODE, PARTNER_STATUS } = require(path.join(API, 'shared/enums.js'));
const { AUDIT_ACTIONS } = require(path.join(API, 'shared/audit-actions.js'));
const { baseIdentity } = require(path.join(API, 'app.js'));
const auth = require(path.join(API, 'middleware/auth.js'));
const switchSession = require(path.join(API, 'middleware/switch-session.js'));
const validateMw = require(path.join(API, 'middleware/validate.js'));
const ratelimit = require(path.join(API, 'middleware/ratelimit.js'));
const idempotency = require(path.join(API, 'middleware/idempotency.js'));

const NOW = Date.parse('2026-10-21T12:00:00+08:00');
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_OPENID = 'openid-admin-dev01';
const ADMIN_ENV = { ADMIN_OPENIDS: JSON.stringify({ [ADMIN_OPENID]: 'DEV-01' }) };

const EXPECTED_ASSERTIONS = 137;

const API_PENDING_ASSERTS = 22;
const CLEANUP_PENDING_ASSERTS = 14;

function probeApiReady() {
  try {
    const router = require(path.join(API, 'router.js'));
    router.getRouter();
    return { ready: true, error: '' };
  } catch (error) {
    return { ready: false, error: error.message };
  }
}

function probeSweeps() {
  try {
    const mod = require(path.join(CLEANUP, 'sweeps/index.js'));
    const list = Array.isArray(mod) ? mod : (mod && Array.isArray(mod.SWEEPS) ? mod.SWEEPS : []);
    return { ready: list.length > 0, sweeps: list, error: list.length ? '' : 'sweeps 注册表为空' };
  } catch (error) {
    return { ready: false, sweeps: [], error: error.message };
  }
}

function pendingAsserts(t, count, reason) {
  for (let i = 0; i < count; i += 1) {
    t.check(false, reason);
  }
}

// 内容安全桩（v2）：customer.saveProfile / partner.* 会调 cloud.openapi.security.msgSecCheck；
// 单测零真实微信外呼，按 suggest 返回 pass/risky 两种结果。
function cloudStub(suggest) {
  const result = suggest || 'pass';
  return {
    openapi: {
      security: {
        msgSecCheck: async () => ({
          result: { suggest: result, label: result === 'pass' ? 100 : 200100 }
        })
      }
    }
  };
}

function uniqueIndexesForApi() {
  return {
    users: [['_id']],
    customers: [['customerNo'], ['_id']],
    partners: [['openid'], ['partnerNo']],
    bindings: [['activeKey']],
    orders: [['orderNo'], ['requestKey']],
    order_events: [['requestKey']],
    counters: [['key']],
    admin_audit: [['requestKey']],
    admin_view_sessions: [['requestKey']],
    upload_tickets: [['ticket']],
    recognition_failures: [['failureNo'], ['requestKey']]
  };
}

function makeCtx(dao, options) {
  const opts = options || {};
  const openid = opts.openid || '';
  const now = opts.now === undefined ? NOW : opts.now;
  return {
    dao,
    ids: {},
    now,
    env: opts.env || ADMIN_ENV,
    cloud: opts.cloud || cloudStub(),
    openid,
    identity: baseIdentity(openid),
    requestId: 'req-selftest',
    clientRequestId: '',
    expectedVersion: undefined,
    config: opts.config || {}
  };
}

function makeState(ctx, action, payload, meta) {
  const base = {
    spec: { visibility: 'client', write: false },
    requestId: 'req-selftest',
    clientRequestId: undefined,
    expectedVersion: undefined,
    viewTicket: '',
    hasViewTicket: false,
    configSeeded: false
  };
  Object.assign(base, meta || {});
  return { action, payload: payload || {}, ctx, meta: base };
}

function readAction(action) {
  return { spec: { visibility: 'client', write: false } };
}

function writeAction(action) {
  return { spec: { visibility: 'client', write: true } };
}

function register(h) {
  // ---------------------------------------------------------------- §7.3 dao 返回形状与事务
  h.section('§7.3 dao 返回形状 / 事务 / 唯一冲突', async (t) => {
    const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    const dao = createDao(db);
    const added = await dao.add(COLLECTIONS.USERS, { _id: 'u-1', roles: [], status: USER_STATUS.ACTIVE });
    t.eq(added._id, 'u-1', 'add 返回 {_id}');
    t.eq((await dao.get(COLLECTIONS.USERS, 'u-1'))._id, 'u-1', 'get 命中返回 doc');
    t.eq(await dao.get(COLLECTIONS.USERS, 'u-missing'), null, 'get 未命中返回 null');
    t.eq((await dao.findOne(COLLECTIONS.USERS, { where: { _id: 'u-1' } }))._id, 'u-1', 'findOne 返回单条');
    t.eq(await dao.find(COLLECTIONS.USERS, { where: { _id: 'u-missing' } }), [], 'find 未命中返回空数组');
    t.eq(await dao.count(COLLECTIONS.USERS, { where: {} }), 1, 'count 返回数字');
    await dao.add(COLLECTIONS.COUNTERS, { key: 'orderNo:test', seq: 1 });
    const counter = await dao.findOne(COLLECTIONS.COUNTERS, { where: { key: 'orderNo:test' } });
    await dao.update(COLLECTIONS.COUNTERS, counter._id, { seq: dao.inc(2), updatedAt: NOW });
    t.eq((await dao.get(COLLECTIONS.COUNTERS, counter._id)).seq, 3, 'update + inc 原子自增');
    t.eq((await dao.updateWhere(COLLECTIONS.USERS, { _id: 'u-1' }, { status: USER_STATUS.ACTIVE })).updated, 1,
      'updateWhere 返回 {updated}');
    await dao.add(COLLECTIONS.USERS, { _id: 'u-remove' });
    t.eq((await dao.remove(COLLECTIONS.USERS, 'u-remove')).removed, 1, 'remove 返回 {removed}');
    t.eq((await dao.removeWhere(COLLECTIONS.USERS, { _id: 'u-missing' })).removed, 0, 'removeWhere 未命中 removed=0');
    const committed = await dao.transaction(async (trx) => {
      await trx.add(COLLECTIONS.USERS, { _id: 'u-tx' });
      return 'committed';
    });
    t.eq(committed, 'committed', 'transaction 返回回调返回值');
    t.check(!!(await dao.get(COLLECTIONS.USERS, 'u-tx')), 'transaction 正常返回即提交');
    try {
      await dao.transaction(async (trx) => {
        await trx.add(COLLECTIONS.USERS, { _id: 'u-rollback' });
        throw new Error('force rollback');
      });
      t.check(false, '事务抛错必须回滚');
    } catch (error) {
      t.eq(await dao.get(COLLECTIONS.USERS, 'u-rollback'), null, '事务抛错后回滚（无残留）');
    }
    t.check(dao.isDuplicateError({ errMsg: 'duplicate key error: _id' }), 'isDuplicateError 识别唯一冲突');
    t.check(!dao.isDuplicateError({ errMsg: 'other error' }), '反例：普通错误不算唯一冲突');
    let duplicateThrown = false;
    try {
      await dao.add(COLLECTIONS.USERS, { _id: 'u-1' });
    } catch (error) {
      duplicateThrown = dao.isDuplicateError(error);
    }
    t.check(duplicateThrown, '重复 _id 插入抛唯一冲突');
    await dao.add(COLLECTIONS.COUNTERS, { key: 'rl:bind:test:d20261021', seq: 1 });
    let keyConflict = false;
    try {
      await dao.add(COLLECTIONS.COUNTERS, { key: 'rl:bind:test:d20261021', seq: 1 });
    } catch (error) {
      keyConflict = dao.isDuplicateError(error);
    }
    t.check(keyConflict, '复合唯一索引（counters.key）冲突可识别');
    t.notEmpty(db.dump('users'), 'dao 样本非空');
  });

  // ---------------------------------------------------------------- §7.3 auth 中间件
  h.section('§7.3 auth：懒建用户 / 开发者白名单 / 停用 / 维护与隐私闸', async (t) => {
    const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    const dao = createDao(db);
    const normalCtx = makeCtx(dao, { openid: 'openid-normal' });
    await auth.middleware(makeState(normalCtx, 'user.bootstrap', {}, { spec: { visibility: 'client', write: false } }));
    const created = await dao.get(COLLECTIONS.USERS, 'openid-normal');
    t.eq(created.roles, [], '首次登录懒建 users 行（roles 为空，开发者不落库）');
    t.eq(normalCtx.identity.developerNo, '', '非白名单 openid 的 developerNo 为空');
    const adminCtx = makeCtx(dao, { openid: ADMIN_OPENID });
    await auth.middleware(makeState(adminCtx, 'admin.stats', {}, { spec: { visibility: 'client', write: false } }));
    t.eq(adminCtx.identity.developerNo, 'DEV-01', 'ADMIN_OPENIDS 映射给出 developerNo');
    let forbidden = null;
    try {
      await auth.middleware(makeState(makeCtx(dao, { openid: 'openid-normal' }), 'admin.bootstrap', {},
        { spec: { visibility: 'internal', write: true } }));
    } catch (error) {
      forbidden = error;
    }
    t.eq(forbidden && forbidden.code, 'FORBIDDEN', 'internal 动作非开发者 → FORBIDDEN');
    db.seed('users', [{ _id: 'openid-deact', roles: [], status: USER_STATUS.DEACTIVATED }]);
    let deactError = null;
    try {
      await auth.middleware(makeState(makeCtx(dao, { openid: 'openid-deact' }), 'order.get', {}, readAction()));
    } catch (error) {
      deactError = error;
    }
    t.eq(deactError && deactError.code, 'FORBIDDEN', 'DEACTIVATED 账号除 bootstrap 外一律 FORBIDDEN');
    db.seed('users', [{ _id: 'openid-admin-only', roles: [], status: USER_STATUS.ACTIVE }]);
    let adminOnlyError = null;
    try {
      await auth.middleware(makeState(makeCtx(dao, { openid: 'openid-admin-only' }), 'admin.stats', {}, readAction()));
    } catch (error) {
      adminOnlyError = error;
    }
    t.eq(adminOnlyError && adminOnlyError.code, 'FORBIDDEN', '非白名单 openid 调 admin.* → FORBIDDEN');
    db.seed('users', [{ _id: 'openid-maint', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE }]);
    let maintError = null;
    try {
      await auth.middleware(makeState(makeCtx(dao, {
        openid: 'openid-maint',
        config: { maintenance: { enabled: true, text: '维护中' }, privacyVersion: 'v4.0' }
      }), 'order.get', {}, Object.assign({ spec: { visibility: 'client', write: false } }, { configSeeded: true })));
    } catch (error) {
      maintError = error;
    }
    t.eq(maintError && maintError.code, 'INVALID_STATE', '维护模式开启时客户端读动作 INVALID_STATE');
    db.seed('users', [{ _id: 'openid-privacy', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, privacyConsent: null }]);
    const privacyCtx = makeCtx(dao, {
      openid: 'openid-privacy',
      config: { maintenance: { enabled: false, text: '' }, privacyVersion: 'v4.0' }
    });
    let privacyError = null;
    try {
      await auth.middleware(makeState(privacyCtx, 'order.create', {},
        Object.assign(writeAction(), { configSeeded: true })));
    } catch (error) {
      privacyError = error;
    }
    t.eq(privacyError && privacyError.code, 'INVALID_STATE', '未同意当前隐私版本时写动作 INVALID_STATE');
    db.seed('users', [{ _id: 'openid-privacy-ok', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, privacyConsent: { version: 'v4.0', at: NOW } }]);
    const privacyOkCtx = makeCtx(dao, {
      openid: 'openid-privacy-ok',
      config: { maintenance: { enabled: false, text: '' }, privacyVersion: 'v4.0' }
    });
    const privacyOkState = await auth.middleware(makeState(privacyOkCtx, 'order.create', {},
      Object.assign(writeAction(), { configSeeded: true })));
    t.eq(privacyOkState.ctx.identity.role, ROLES.CUSTOMER, '隐私已同意 + 单角色 → identity.role 归一为 CUSTOMER');
    t.notEmpty([created], 'auth 样本非空');
  });

  // ---------------------------------------------------------------- §7.3 validate 中间件
  h.section('§7.3 validate：clientRequestId / expectedVersion / 危险键剥离', async (t) => {
    const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    const dao = createDao(db);
    let error = null;
    try {
      await validateMw.middleware(makeState(makeCtx(dao, { openid: 'u-validate' }), 'order.create', {}, writeAction()));
    } catch (e) {
      error = e;
    }
    t.check(error && error.code === 'VALIDATION_FAILED' && error.data.field === 'clientRequestId',
      '写动作缺 clientRequestId → VALIDATION_FAILED + data.field');
    const okCtx = makeCtx(dao, { openid: 'u-validate' });
    const okState = await validateMw.middleware(makeState(okCtx, 'order.create', { a: 1 }, Object.assign(writeAction(), {
      clientRequestId: 'C'.repeat(24)
    })));
    t.eq(okState.ctx.clientRequestId.length, 24, '写动作合法 clientRequestId 注入 ctx');
    const readState = await validateMw.middleware(makeState(makeCtx(dao, { openid: 'u-validate' }), 'order.get', {}, readAction()));
    t.eq(readState.ctx.clientRequestId, '', '读动作可不传 clientRequestId');
    error = null;
    try {
      await validateMw.middleware(makeState(makeCtx(dao, { openid: 'u-validate' }), 'order.get', {}, Object.assign(readAction(), {
        clientRequestId: 'short'
      })));
    } catch (e) {
      error = e;
    }
    t.check(error && error.code === 'VALIDATION_FAILED' && error.data.field === 'clientRequestId',
      '反例：读动作携带格式错误 clientRequestId 也拒');
    error = null;
    try {
      await validateMw.middleware(makeState(makeCtx(dao, { openid: 'u-validate' }), 'order.accept', {}, Object.assign(writeAction(), {
        clientRequestId: 'D'.repeat(24),
        expectedVersion: -1
      })));
    } catch (e) {
      error = e;
    }
    t.check(error && error.code === 'VALIDATION_FAILED' && error.data.field === 'expectedVersion',
      '反例：expectedVersion 负数 → VALIDATION_FAILED + data.field');
    const versionCtx = makeCtx(dao, { openid: 'u-validate' });
    const versionState = await validateMw.middleware(makeState(versionCtx, 'order.accept', {}, Object.assign(writeAction(), {
      clientRequestId: 'E'.repeat(24),
      expectedVersion: 3
    })));
    t.eq(versionState.ctx.expectedVersion, 3, '合法 expectedVersion 注入 ctx');
    error = null;
    try {
      await validateMw.middleware(makeState(makeCtx(dao, { openid: 'u-validate' }), 'order.get', 'not-an-object', readAction()));
    } catch (e) {
      error = e;
    }
    t.check(error && error.code === 'VALIDATION_FAILED', '反例：payload 非对象 → VALIDATION_FAILED');
    const dirty = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    const cleanState = await validateMw.middleware(makeState(makeCtx(dao, { openid: 'u-validate' }), 'order.get', dirty, readAction()));
    t.check(!('__proto__' in cleanState.payload) && cleanState.payload.safe === 1, '危险键 __proto__ 被剥离且保留合法字段');
    t.check({}.polluted === undefined, '原型链未被污染');
    t.notEmpty(Object.keys(cleanState.payload), 'validate 样本非空');
  });

  // ---------------------------------------------------------------- §7.3 ratelimit 中间件
  h.section('§7.3 ratelimit：配额打满 / 跨日重置 / 会话独立 / 计数回退', async (t) => {
    const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    const dao = createDao(db);
    const ctx = makeCtx(dao, { openid: 'openid-rate' });
    let rateError = null;
    for (let i = 0; i < 6; i += 1) {
      const state = makeState(ctx, 'bind.create', {}, Object.assign(writeAction(), { clientRequestId: 'F'.repeat(24) }));
      try {
        await ratelimit.middleware(state);
      } catch (error) {
        rateError = error;
      }
    }
    t.eq(rateError && rateError.code, 'RATE_LIMITED', 'bind.create 每日 5 次打满 → RATE_LIMITED');
    const rateCounters = db.dump('counters').filter((row) => String(row.key).indexOf('rl:bind:openid-rate:d20261021') === 0);
    t.notEmpty(rateCounters, '限流计数落 counters.rl:{scope}:{openid}:{window}');
    t.eq(rateCounters[0].seq, 6, '第 6 次计数已记入（超限尝试不静默）');
    const nextDayCtx = makeCtx(dao, { openid: 'openid-rate', now: NOW + DAY_MS });
    let nextDayError = null;
    try {
      await ratelimit.middleware(makeState(nextDayCtx, 'bind.create', {}, Object.assign(writeAction(), { clientRequestId: 'G'.repeat(24) })));
    } catch (error) {
      nextDayError = error;
    }
    t.eq(nextDayError, null, '跨日（now 注入 +1 天）配额重置：不再 RATE_LIMITED');
    const refundCtx = makeCtx(dao, { openid: 'openid-refund' });
    const refundState = makeState(refundCtx, 'partner.activate', {}, Object.assign(writeAction(), { clientRequestId: 'H'.repeat(24) }));
    await ratelimit.middleware(refundState);
    await ratelimit.finish(refundState);
    t.eq(refundState.meta.rateRefunds.length, 1, 'partner.activate 成功回退计数（只计失败次数）');
    const refundCounter = db.dump('counters').filter((row) => String(row.key).indexOf('rl:activate:openid-refund:d20261021') === 0);
    t.eq(refundCounter[0] && refundCounter[0].seq, 0, '回退后配额计数回到 0');
    const avatarCtx = makeCtx(dao, { openid: 'openid-avatar' });
    let avatarError = null;
    for (let i = 0; i < 6; i += 1) {
      const state = makeState(avatarCtx, 'upload.prepare', { purpose: 'AVATAR' }, Object.assign(writeAction(), { clientRequestId: 'I'.repeat(24) }));
      try {
        await ratelimit.middleware(state);
      } catch (error) {
        avatarError = error;
      }
    }
    t.eq(avatarError && avatarError.code, 'RATE_LIMITED', '头像上传 5 次/日打满 → RATE_LIMITED');
    const aiCtx = makeCtx(dao, { openid: 'openid-ai-rate' });
    let aiError = null;
    for (let i = 0; i < 8; i += 1) {
      try {
        await ratelimit.middleware(makeState(aiCtx, 'ai.parseParcel', {}, writeAction()));
      } catch (error) {
        aiError = error;
      }
    }
    t.eq(aiError, null, 'ai.parseParcel 本层不抛 RATE_LIMITED（handler 内静默降级）');
    const publicCtx = makeCtx(dao, { openid: 'openid-public' });
    let publicError = null;
    for (let i = 0; i < 6; i += 1) {
      try {
        await ratelimit.middleware(makeState(publicCtx, 'partner.getPublic', { partnerNo: 'PABC23' }, readAction()));
      } catch (error) {
        publicError = error;
      }
    }
    t.eq(publicError && publicError.code, 'RATE_LIMITED', 'partner.getPublic 5 次/日打满 → RATE_LIMITED');
    const coveredRules = ratelimit.RATE_RULES.map((rule) => rule.action + ':' + rule.scope);
    t.check(['bind.create:bind', 'partner.activate:activate', 'partner.getPublic:partnerPublic', 'upload.prepare:avatarUpload']
      .every((key) => coveredRules.indexOf(key) >= 0),
    '限流策略覆盖 bind.create/partner.activate/partner.getPublic/AVATAR 上传');
    t.notEmpty(db.dump('counters'), 'ratelimit 样本非空');
  });

  // ---------------------------------------------------------------- §7.3 编号生成与公开配置
  h.section('§7.3 编号生成与公开配置（shared/defaults 委托）', async (t) => {
    const configLib = require(path.join(API, 'db/config.js'));
    const idGenerator = require(path.join(API, 'lib/id-generator.js'));
    t.check(configLib.PUBLIC_CONFIG_KEYS.indexOf('viewTicketTtlMinutes') >= 0,
      '公开配置子集含 viewTicketTtlMinutes（切换会话倒计时用）');
    const pub = configLib.publicConfig(configLib.cloneDefault());
    t.eq(pub.viewTicketTtlMinutes, 30, 'config.getPublic 公开子集 viewTicketTtlMinutes=30');
    const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    const dao = createDao(db);
    const no1 = await idGenerator.generateOrderNo(dao, NOW);
    const no2 = await idGenerator.generateOrderNo(dao, NOW);
    t.check(/^\d{8}-\d{4}$/.test(no1), 'orderNo 形如 YYYYMMDD-0001（4 位数字序号）');
    t.eq([no1.slice(-4), no2.slice(-4)], ['0001', '0002'], 'orderNo 当日序号事务自增');
    t.check(/^C[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(idGenerator.generateCustomerNo()),
      'customerNo = C + 8 位 32 字母表');
    t.check(/^P[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(idGenerator.generatePartnerNo()),
      'partnerNo = P + 6 位 32 字母表');
    t.check(/^F-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(idGenerator.generateFailureNo(NOW)),
      'failureNo = F-日期-6 位 32 字母表');
  });

  // ---------------------------------------------------------------- §7.3 switch-session 中间件
  h.section('§7.3 switch-session：READONLY 拒写 / TEST_WRITE 白名单 / 票据过期审计', async (t) => {
    const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    const dao = createDao(db);
    db.seed('users', [
      { _id: ADMIN_OPENID, roles: [], status: USER_STATUS.ACTIVE, isTestAccount: false },
      { _id: 'openid-real-c', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: false },
      { _id: 'openid-real-p', roles: [ROLES.PARTNER], status: USER_STATUS.ACTIVE, isTestAccount: false },
      { _id: 'TEST-cloudcore0001', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: true }
    ]);
    db.seed('customers', [{ _id: 'openid-real-c', customerNo: 'CABCDEFGH', displayName: '小王', profileCompleted: true, dormKey: 'D4-522' }]);
    db.seed('partners', [{ _id: 'partner-real-1', openid: 'openid-real-p', partnerNo: 'PABC23', status: PARTNER_STATUS.ACTIVE, serviceConfig: { acceptingOrders: true } }]);
    const future = NOW + 30 * 60 * 1000;
    db.seed('admin_view_sessions', [
      { _id: 'TK-READONLY', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-real-c', targetNo: 'CABCDEFGH', targetIsTest: false, createdAt: NOW, expiresAt: future, endedAt: 0 },
      { _id: 'TK-READONLY-P', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.PARTNER, targetId: 'partner-real-1', targetNo: 'PABC23', targetIsTest: false, createdAt: NOW, expiresAt: future, endedAt: 0 },
      { _id: 'TK-TEST', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.TEST_WRITE, role: ROLES.CUSTOMER, targetId: 'TEST-cloudcore0001', targetNo: 'CABCD9999', targetIsTest: true, createdAt: NOW, expiresAt: future, endedAt: 0 },
      { _id: 'TK-EXPIRED', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-real-c', targetNo: 'CABCDEFGH', targetIsTest: false, createdAt: NOW - 3600000, expiresAt: NOW - 1000, endedAt: 0 }
    ]);
    async function freshAdminCtx() {
      const ctx = makeCtx(dao, { openid: ADMIN_OPENID });
      await auth.middleware(makeState(ctx, 'order.listCustomer', {}, readAction()));
      return ctx;
    }
    const roCtx = await freshAdminCtx();
    const roState = await switchSession.middleware(makeState(roCtx, 'order.listCustomer', {}, Object.assign(readAction(), {
      viewTicket: 'TK-READONLY',
      hasViewTicket: true
    })));
    t.eq(roState.ctx.identity.effectiveOpenid, 'openid-real-c', 'READONLY：effectiveOpenid=目标真实 openid');
    t.eq(roState.ctx.identity.actorOpenid, ADMIN_OPENID, 'READONLY：actorOpenid=开发者真实 openid（审计用）');
    t.eq(roState.ctx.identity.viewMode, VIEW_MODE.READONLY, 'READONLY：viewMode 透传');
    let roError = null;
    try {
      await switchSession.middleware(makeState(await freshAdminCtx(), 'order.accept', {}, Object.assign(writeAction(), {
        viewTicket: 'TK-READONLY',
        hasViewTicket: true
      })));
    } catch (error) {
      roError = error;
    }
    t.eq(roError && roError.code, 'FORBIDDEN', 'READONLY：写动作一律 FORBIDDEN');
    let roReadError = null;
    try {
      await switchSession.middleware(makeState(await freshAdminCtx(), 'admin.listCustomers', {}, Object.assign(readAction(), {
        viewTicket: 'TK-READONLY',
        hasViewTicket: true
      })));
    } catch (error) {
      roReadError = error;
    }
    t.eq(roReadError && roReadError.code, 'FORBIDDEN', 'READONLY：白名单外读动作 FORBIDDEN');
    const roPartnerCtx = await freshAdminCtx();
    const roPartnerState = await switchSession.middleware(makeState(roPartnerCtx, 'partner.listBindings', {}, Object.assign(readAction(), {
      viewTicket: 'TK-READONLY-P',
      hasViewTicket: true
    })));
    t.eq(roPartnerState.ctx.identity.effectiveOpenid, 'openid-real-p', 'READONLY 兼职目标：effectiveOpenid=partners.openid');
    const twCtx = await freshAdminCtx();
    const twState = await switchSession.middleware(makeState(twCtx, 'order.create', {}, Object.assign(writeAction(), {
      viewTicket: 'TK-TEST',
      hasViewTicket: true
    })));
    t.check(twState.ctx.identity.effectiveOpenid === 'TEST-cloudcore0001' && twState.ctx.identity.isTestAccount === true,
      'TEST_WRITE：effectiveOpenid=目标测试账号合成 openid');
    t.eq(twState.ctx.identity.viewMode, VIEW_MODE.TEST_WRITE, 'TEST_WRITE：viewMode 透传');
    let twAdminError = null;
    try {
      await switchSession.middleware(makeState(await freshAdminCtx(), 'admin.stats', {}, Object.assign(writeAction(), {
        viewTicket: 'TK-TEST',
        hasViewTicket: true
      })));
    } catch (error) {
      twAdminError = error;
    }
    t.eq(twAdminError && twAdminError.code, 'FORBIDDEN', 'TEST_WRITE：admin.* 动作 FORBIDDEN（票据不能当后台凭据）');
    let twActivateError = null;
    try {
      await switchSession.middleware(makeState(await freshAdminCtx(), 'partner.activate', {}, Object.assign(writeAction(), {
        viewTicket: 'TK-TEST',
        hasViewTicket: true
      })));
    } catch (error) {
      twActivateError = error;
    }
    t.eq(twActivateError && twActivateError.code, 'FORBIDDEN', 'TEST_WRITE：partner.activate 禁止');
    const exitCtx = await freshAdminCtx();
    const exitState = await switchSession.middleware(makeState(exitCtx, 'admin.viewAsEnd', {}, Object.assign(writeAction(), {
      viewTicket: 'TK-READONLY',
      hasViewTicket: true
    })));
    t.eq(exitState.ctx.identity.viewMode, VIEW_MODE.READONLY, '退出会话动作 admin.viewAsEnd 在 READONLY 下放行（否则退出永远失败）');
    let missingError = null;
    try {
      await switchSession.middleware(makeState(await freshAdminCtx(), 'order.get', {}, Object.assign(readAction(), {
        viewTicket: 'TK-NOT-EXIST',
        hasViewTicket: true
      })));
    } catch (error) {
      missingError = error;
    }
    t.eq(missingError && missingError.code, 'FORBIDDEN', '不存在的票据 → FORBIDDEN（不泄露存在性）');
    let expiredError = null;
    try {
      await switchSession.middleware(makeState(await freshAdminCtx(), 'order.get', {}, Object.assign(readAction(), {
        viewTicket: 'TK-EXPIRED',
        hasViewTicket: true
      })));
    } catch (error) {
      expiredError = error;
    }
    t.eq(expiredError && expiredError.code, 'VIEW_TICKET_EXPIRED', '过期票据 → VIEW_TICKET_EXPIRED');
    const expiredAudits = db.dump('admin_audit').filter((row) => row.action === AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED);
    t.eq(expiredAudits.length, 1, '过期票据写 1 条 ACCOUNT_SWITCH_EXPIRED 审计');
    try {
      await switchSession.middleware(makeState(await freshAdminCtx(), 'order.get', {}, Object.assign(readAction(), {
        viewTicket: 'TK-EXPIRED',
        hasViewTicket: true
      })));
    } catch (error) {
      /* 第二次仍然过期 */
    }
    t.eq(db.dump('admin_audit').filter((row) => row.action === AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED).length, 1,
      '同一票据重试不重复写过期审计（每票至多一条）');
    const expiredSession = db.dump('admin_view_sessions').filter((row) => row._id === 'TK-EXPIRED')[0];
    t.eq(expiredSession.endedAt, expiredSession.expiresAt, '过期票据补写 endedAt（幂等）');
    db.seed('users', [{ _id: 'openid-gone', roles: [ROLES.CUSTOMER], status: USER_STATUS.DEACTIVATED }]);
    db.seed('admin_view_sessions', [{ _id: 'TK-GONE', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-gone', targetNo: 'CABCDEFGH', targetIsTest: false, createdAt: NOW, expiresAt: future, endedAt: 0 }]);
    let goneError = null;
    try {
      await switchSession.middleware(makeState(await freshAdminCtx(), 'order.get', {}, Object.assign(readAction(), {
        viewTicket: 'TK-GONE',
        hasViewTicket: true
      })));
    } catch (error) {
      goneError = error;
    }
    t.eq(goneError && goneError.code, 'NOT_FOUND', '目标已停用 → NOT_FOUND（不泄露状态）');
    t.notEmpty(db.dump('admin_view_sessions'), 'switch-session 样本非空');
  });

  // ---------------------------------------------------------------- §7.3 API 端到端（需 11 域齐）
  h.section('§7.3 API 端到端（health/admin.bootstrap/状态矩阵/幂等/越权）', async (t) => {
    const apiState = probeApiReady();
    if (!apiState.ready) {
      pendingAsserts(t, API_PENDING_ASSERTS, '待 11 域 handlers 齐后重跑（' + String(apiState.error).slice(0, 60) + '）');
      return;
    }
    const app = require(path.join(API, 'app.js'));
    const healthDb = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    const deployApi = app.createApi({ db: healthDb, now: () => NOW, openid: '', env: ADMIN_ENV });
    const health = await deployApi.call('health.check', {});
    t.eq(health.ok, true, '部署上下文 health.check ok:true（internal 最小链路）');
    t.eq(health.data.checks.collections, 14, 'health.check：集合数 14');
    t.eq(health.data.checks.errorCodes, 13, 'health.check：错误码 13');
    t.eq(health.data.checks.configSeeded, false, 'health.check：空库 configSeeded=false');
    const bootstrap1 = await deployApi.call('admin.bootstrap', {});
    t.eq(bootstrap1.ok, true, '部署上下文 admin.bootstrap ok:true');
    t.check(Array.isArray(bootstrap1.data.collections) && bootstrap1.data.collections.length === 14,
      'admin.bootstrap 返回 14 集合清单');
    const bootstrap2 = await deployApi.call('admin.bootstrap', {});
    t.eq(bootstrap2.data, bootstrap1.data, 'admin.bootstrap 重复调用幂等（结果一致）');
    t.eq((await deployApi.call('health.check', {})).data.checks.configSeeded, true, 'bootstrap 后 health.check configSeeded=true');

    // 内容安全桩：customer.saveProfile 走 cloud.openapi.security.msgSecCheck（v2），pass/risky 两态
    const profileDb = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    profileDb.seed('users', [{ _id: 'openid-profile', roles: [], status: USER_STATUS.ACTIVE, isTestAccount: false, privacyConsent: { version: 'v4.0', at: NOW } }]);
    const passApi = app.createApi({ db: profileDb, now: () => NOW, openid: 'openid-profile', env: ADMIN_ENV, cloud: cloudStub('pass') });
    const savedProfile = await passApi.call('customer.saveProfile', {
      displayName: '小王',
      zone: 'D',
      buildingNo: 4,
      room: '522'
    }, { clientRequestId: 'profile-request-000000001' });
    t.eq(savedProfile.ok, true, 'customer.saveProfile 内容安全通过（msgSecCheck 桩 suggest=pass）');
    const riskyApi = app.createApi({ db: profileDb, now: () => NOW, openid: 'openid-profile', env: ADMIN_ENV, cloud: cloudStub('risky') });
    const riskyProfile = await riskyApi.call('customer.saveProfile', {
      displayName: '小王',
      zone: 'D',
      buildingNo: 4,
      room: '522'
    }, { clientRequestId: 'profile-request-000000002' });
    t.check(riskyProfile.ok === false && riskyProfile.code === 'VALIDATION_FAILED',
      '命中 msgSecCheck（suggest=risky）→ VALIDATION_FAILED（不落库）');

    const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    db.seed('users', [
      { _id: 'openid-cust-order', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: false, privacyConsent: { version: 'v4.0', at: NOW } },
      { _id: 'openid-partner-order', roles: [ROLES.PARTNER], status: USER_STATUS.ACTIVE, isTestAccount: false },
      { _id: 'openid-partner-other', roles: [ROLES.PARTNER], status: USER_STATUS.ACTIVE, isTestAccount: false }
    ]);
    db.seed('customers', [{ _id: 'openid-cust-order', customerNo: 'CABCDEFGH', displayName: '小王', profileCompleted: true, dormKey: 'D4-522' }]);
    db.seed('partners', [
      { _id: 'partner-order-1', openid: 'openid-partner-order', partnerNo: 'PABC23', displayName: '小李', status: PARTNER_STATUS.ACTIVE, serviceConfig: { acceptingOrders: true } },
      { _id: 'partner-order-2', openid: 'openid-partner-other', partnerNo: 'PABC24', displayName: '小张', status: PARTNER_STATUS.ACTIVE, serviceConfig: { acceptingOrders: true } }
    ]);
    db.seed('bindings', [{ _id: 'binding-1', activeKey: 'openid-cust-order', customerId: 'openid-cust-order', partnerId: 'partner-order-1', status: 'ACTIVE', dormSnapshot: { dormKey: 'D4-522' } }]);
    db.seed('orders', [{
      _id: 'order-1',
      orderNo: '20261021-0001',
      requestKey: 'openid-cust-order:seed-request-1',
      customerId: 'openid-cust-order',
      customerOpenid: 'openid-cust-order',
      customerNo: 'CABCDEFGH',
      partnerId: 'partner-order-1',
      partnerOpenid: 'openid-partner-order',
      partnerNo: 'PABC23',
      source: 'CUSTOMER',
      isTest: false,
      status: ORDER_STATUS.SUBMITTED,
      statusUpdatedAt: NOW,
      createdAt: NOW,
      version: 1,
      parcel: { stationId: 'P3', pickupCode: 'A123' }
    }]);
    const partnerApi = app.createApi({ db, now: () => NOW, openid: 'openid-partner-order', env: ADMIN_ENV });
    const accept = await partnerApi.call('order.accept', { orderNo: '20261021-0001', expectedVersion: 1 }, { clientRequestId: 'accept-request-00000000001' });
    t.eq(accept.ok, true, '接单：SUBMITTED → ACCEPTED 合法');
    t.eq(db.dump('orders').filter((row) => row._id === 'order-1')[0].status, ORDER_STATUS.ACCEPTED, '接单后订单状态 ACCEPTED');
    const acceptAgain = await partnerApi.call('order.accept', { orderNo: '20261021-0001' }, { clientRequestId: 'accept-request-00000000002' });
    t.eq(acceptAgain.code, 'INVALID_TRANSITION', '反例：重复接单（非 SUBMITTED）INVALID_TRANSITION');
    const pick = await partnerApi.call('order.markPicked', { orderNo: '20261021-0001' }, { clientRequestId: 'pick-request-000000000001' });
    t.eq(pick.ok, true, '取件：ACCEPTED → PICKED 合法');
    const deliver = await partnerApi.call('order.markDelivered', { orderNo: '20261021-0001' }, { clientRequestId: 'deliver-request-0000000001' });
    t.eq(deliver.ok, true, '送达：PICKED → DELIVERED 合法');
    const customerApiProbe = app.createApi({ db, now: () => NOW, openid: 'openid-cust-order', env: ADMIN_ENV });
    const confirm = await customerApiProbe.call('order.confirmDelivery', { orderNo: '20261021-0001' }, { clientRequestId: 'confirm-request-0000000001' });
    t.eq(confirm.ok, true, '确认送达：DELIVERED → COMPLETED 合法');
    t.eq(db.dump('orders').filter((row) => row._id === 'order-1')[0].status, ORDER_STATUS.COMPLETED, '确认后订单状态 COMPLETED');
    const otherPartnerApi = app.createApi({ db, now: () => NOW, openid: 'openid-partner-other', env: ADMIN_ENV });
    const crossAccept = await otherPartnerApi.call('order.accept', { orderNo: '20261021-0001' }, { clientRequestId: 'cross-request-00000000001' });
    t.check(crossAccept.ok === false && (crossAccept.code === 'FORBIDDEN' || crossAccept.code === 'NOT_FOUND'),
      '越权：兼职 B 操作兼职 A 的订单 → FORBIDDEN/NOT_FOUND');

    const idemDb = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    idemDb.seed('users', [
      { _id: 'openid-idem', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: false, privacyConsent: { version: 'v4.0', at: NOW } }
    ]);
    idemDb.seed('customers', [{ _id: 'openid-idem', customerNo: 'CABCDEFGH', displayName: '小王', profileCompleted: true, dormKey: 'D4-522' }]);
    const idemApi = app.createApi({ db: idemDb, now: () => NOW, openid: 'openid-idem', env: ADMIN_ENV });
    const replayOptions = { clientRequestId: 'replay-request-000000001' };
    const bind1 = await idemApi.call('bind.create', { partnerNo: 'PABC23' }, replayOptions);
    const bind2 = await idemApi.call('bind.create', { partnerNo: 'PABC23' }, replayOptions);
    t.check(bind1.ok === true && bind2.ok === true, '同 clientRequestId 重放绑定：两次都 ok:true（幂等不报错）');
    t.eq(idemDb.dump('bindings').length, 0, '绑定失败路径（目标不存在）零写入，不产生脏数据');
    t.eq(idemLogReplay(), true, '幂等键 helper 可构造（order/event/audit 三类）');
    function idemLogReplay() {
      const ctx = { identity: { effectiveOpenid: 'openid-idem', actorOpenid: ADMIN_OPENID }, openid: 'openid-idem', clientRequestId: 'replay-request-000000001' };
      const orderKey = idempotency.orderRequestKey(ctx, 2);
      const eventKey = idempotency.eventRequestKey(ctx, 'order-1', 'order.accept');
      const auditKey = idempotency.auditRequestKey(ctx);
      return orderKey === 'openid-idem:replay-request-000000001:2'
        && eventKey === 'order-1:order.accept:replay-request-000000001'
        && auditKey === ADMIN_OPENID + ':replay-request-000000001';
    }
    t.notEmpty(db.dump('orders'), '端到端样本非空');
  });

  // ---------------------------------------------------------------- §7.3 cleanup 时间旅行（sweeps 落盘后）
  h.section('§7.3 cleanup 单触发器时间旅行（到期幂等 / 过期会话审计至多一条）', async (t) => {
    const sweepState = probeSweeps();
    if (!sweepState.ready) {
      pendingAsserts(t, CLEANUP_PENDING_ASSERTS, '待 cleanup sweeps 落盘后重跑（' + String(sweepState.error).slice(0, 60) + '）');
      return;
    }
    const byName = {};
    sweepState.sweeps.forEach((sweep) => {
      byName[sweep.name] = sweep;
    });
    t.check(!!byName.orderTimeout, 'sweeps 含 orderTimeout');
    t.check(!!byName.autoComplete, 'sweeps 含 autoComplete');
    t.check(!!byName.viewSessions, 'sweeps 含 viewSessions');
    const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
    const dao = createDao(db);
    const longAgo = NOW - 200 * 60 * 60 * 1000;
    db.seed('users', [{ _id: 'openid-timeout', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: false }]);
    db.seed('orders', [
      { _id: 'order-timeout', orderNo: '20261001-0001', requestKey: 'openid-timeout:timeout-1', customerId: 'openid-timeout', customerOpenid: 'openid-timeout', partnerId: 'partner-x', partnerOpenid: 'openid-partner-x', partnerNo: 'PABC23', status: ORDER_STATUS.SUBMITTED, statusUpdatedAt: longAgo, createdAt: longAgo, version: 1, isTest: false },
      { _id: 'order-auto', orderNo: '20261001-0002', requestKey: 'openid-timeout:auto-1', customerId: 'openid-timeout', customerOpenid: 'openid-timeout', partnerId: 'partner-x', partnerOpenid: 'openid-partner-x', partnerNo: 'PABC23', status: ORDER_STATUS.DELIVERED, statusUpdatedAt: longAgo, deliveredAt: longAgo, createdAt: longAgo, version: 1, isTest: false }
    ]);
    db.seed('config', [{ _id: 'global', orderTimeoutMinutes: 120, autoCompleteHours: 24, screenshotRetentionDays: 7, privacyVersion: 'v4.0' }]);
    db.seed('admin_view_sessions', [{ _id: 'TK-CLEANUP', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-real-c', targetNo: 'CABCDEFGH', targetIsTest: false, createdAt: longAgo, expiresAt: NOW - 1000, endedAt: 0 }]);
    const config = db.dump('config')[0];
    const ctx = { dao, db, cloud: {}, env: ADMIN_ENV, config, now: NOW, requestId: 'req-cleanup', AppError: Error, COLLECTIONS };
    const timeoutResult = await byName.orderTimeout.run(ctx);
    t.check(!!timeoutResult && typeof timeoutResult.scanned === 'number', 'orderTimeout.run 返回 {scanned,acted,failed}');
    t.eq(db.dump('orders').filter((row) => row._id === 'order-timeout')[0].status, ORDER_STATUS.CANCELLED, '超时未接单 → CANCELLED');
    t.check(db.dump('order_events').some((row) => row.type === 'TIMEOUT_CANCELLED'), '超时取消写 TIMEOUT_CANCELLED 事件');
    const timeoutRerun = await byName.orderTimeout.run(ctx);
    t.eq(timeoutRerun.acted, 0, 'orderTimeout 重跑幂等（acted=0）');
    const autoResult = await byName.autoComplete.run(ctx);
    t.check(!!autoResult && autoResult.acted >= 1, 'autoComplete 处理 DELIVERED 超时单');
    t.eq(db.dump('orders').filter((row) => row._id === 'order-auto')[0].status, ORDER_STATUS.COMPLETED, '送达超时 → COMPLETED');
    t.check(db.dump('order_events').some((row) => row.type === 'AUTO_COMPLETED'), '自动完成写 AUTO_COMPLETED 事件');
    await byName.viewSessions.run(ctx);
    const expiredSession = db.dump('admin_view_sessions').filter((row) => row._id === 'TK-CLEANUP')[0];
    t.eq(expiredSession.endedAt, expiredSession.expiresAt, '过期切换会话补写 endedAt=expiresAt');
    t.eq(db.dump('admin_audit').filter((row) => row.action === AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED).length, 1,
      '过期会话写 1 条 ACCOUNT_SWITCH_EXPIRED');
    await byName.viewSessions.run(ctx);
    t.eq(db.dump('admin_audit').filter((row) => row.action === AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED).length, 1,
      '重跑不重复写过期审计（每票至多一条）');
    t.notEmpty(db.dump('orders'), 'cleanup 样本非空');
  });

  // ---------------------------------------------------------------- §7.3 router 注册表（需 11 域齐）
  h.section('§7.3 router 注册表与 shared/actions 双向一致', (t) => {
    const apiState = probeApiReady();
    if (!apiState.ready) {
      pendingAsserts(t, 3, '待 11 域 handlers 齐后重跑（' + String(apiState.error).slice(0, 60) + '）');
      return;
    }
    const router = require(path.join(API, 'router.js'));
    const routes = router.getRouter();
    const expected = CLIENT_ACTIONS.concat(['admin.bootstrap', 'health.check']);
    const registered = Object.keys(routes).sort();
    t.eq(registered.concat().sort(), expected.concat().sort(), 'router 注册集 = client 动作 + admin.bootstrap/health.check');
    t.check(CLIENT_ACTIONS.every((action) => typeof routes[action] === 'function'), '每个 client 动作都有 handler');
    t.check(ACTION_MAP['cleanup.orderTimeout'].visibility === 'internal' && !routes['cleanup.orderTimeout'],
      'cleanup.* 为 internal 且不在 api 路由中（客户端调用一律 FORBIDDEN）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-cloud' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-cloud');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
