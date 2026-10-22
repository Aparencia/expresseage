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
const { cloudStub, createTestDb, createUpdateProbeDb } = require('./selftest-cloud-fixtures');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const CLEANUP = path.join(ROOT, 'cloudfunctions/cleanup');

const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const { ACTION_MAP, CLIENT_ACTIONS } = require(path.join(API, 'shared/actions.js'));
const { ROLES, USER_STATUS, ORDER_STATUS, VIEW_MODE, PARTNER_STATUS, BINDING_STATUS } = require(path.join(API, 'shared/enums.js'));
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

const EXPECTED_ASSERTIONS = 174;

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

// 异步分节串行执行：harness 的 sectionTitle 是全局的，并发跑会让失败标签串到别的节。
let serialQueue = Promise.resolve();
function serial(fn) {
  const run = serialQueue.then(fn);
  serialQueue = run.catch(() => {});
  return run;
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
  const asyncSection = (title, fn) => h.section(title, (t) => serial(() => {
    h.sectionTitle = title;
    return fn(t);
  }));

  // ---------------------------------------------------------------- §7.3 dao 返回形状与事务
  asyncSection('§7.3 dao 返回形状 / 事务 / 唯一冲突', async (t) => {
    const db = createTestDb();
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
    // 写入语义：对象字段 = 整值替换（dao 包 command.set），标量与既有指令透传。
    // 真实 wx-server-sdk 会把嵌套对象拍平成点路径 $set；父字段为 null 时报 -502001（2026-10-22 隐私同意事故）。
    const probe = createUpdateProbeDb();
    const probeDao = createDao(probe.db);
    await probeDao.update(COLLECTIONS.USERS, 'u-1', {
      privacyConsent: { version: 'v4.0', at: new Date(NOW) },
      updatedAt: new Date(NOW)
    });
    const probeData = probe.updates[0].data;
    t.check(probeData.privacyConsent && probeData.privacyConsent.type === 'set'
      && probeData.privacyConsent.value.version === 'v4.0',
    '§7.3 update 对象字段包成整值替换指令 set（不交给 SDK 拍平点路径：父级 null 时线上会 -502001）');
    t.check(probeData.updatedAt instanceof Date && probeData.updatedAt.type === undefined,
      '§7.3 update 标量/Date 不做整值替换包装（透传，时间字段保持 Date）');
    await probeDao.update(COLLECTIONS.COUNTERS, 'c-1', { seq: probeDao.inc(2) });
    t.eq(probe.updates[1].data.seq.type, 'inc', '§7.3 update 既有更新指令原样透传（inc 不被二次包装）');
    const rawDb = createTestDb();
    rawDb.seed('users', [{ _id: 'u-null-parent', privacyConsent: null }]);
    let nullParentError = null;
    try {
      await rawDb.collection('users').where({ _id: 'u-null-parent' }).update({
        data: { privacyConsent: { version: 'v4.0', at: new Date(NOW) } }
      });
    } catch (error) {
      nullParentError = error;
    }
    t.check(!!nullParentError && nullParentError.errCode === -502001
      && /Cannot create field/.test(String(nullParentError.message || '')),
    '§7.3 fake DB 复刻真实语义：嵌套对象 update 遇 null 父级 → -502001 Cannot create field（防再次假绿）');
    const fixedDb = createTestDb();
    fixedDb.seed('users', [{ _id: 'u-null-parent', privacyConsent: null }]);
    await createDao(fixedDb).update(COLLECTIONS.USERS, 'u-null-parent', {
      privacyConsent: { version: 'v4.0', at: new Date(NOW) }
    });
    t.eq(fixedDb.dump('users')[0].privacyConsent.version, 'v4.0',
      '§7.3 dao.update 在 null 父级上整值替换成功（本条即云端「同意隐私政策」故障回归）');
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
  asyncSection('§7.3 auth：懒建用户 / 开发者白名单 / 停用 / 维护与隐私闸', async (t) => {
    const db = createTestDb();
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
    // 维护模式只拦写（ENGINEERING §4.7 / UX_DEVELOPER §7.5）：读放行；完整读/写/admin 用例见 selftest-admin §A11~A16。
    let maintError = null;
    try {
      await auth.middleware(makeState(makeCtx(dao, {
        openid: 'openid-maint',
        config: { maintenance: { enabled: true, text: '维护中' }, privacyVersion: 'v4.0' }
      }), 'order.get', {}, Object.assign({ spec: { visibility: 'client', write: false } }, { configSeeded: true })));
    } catch (error) {
      maintError = error;
    }
    t.eq(maintError, null, '维护模式开启时客户端读动作放行（写动作 INVALID_STATE 见 selftest-admin）');
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
  asyncSection('§7.3 validate：clientRequestId / expectedVersion / 危险键剥离', async (t) => {
    const db = createTestDb();
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
    t.check(!Object.prototype.hasOwnProperty.call(cleanState.payload, '__proto__') && cleanState.payload.safe === 1, '危险键 __proto__ 被剥离且保留合法字段');
    t.check({}.polluted === undefined, '原型链未被污染');
    t.notEmpty(Object.keys(cleanState.payload), 'validate 样本非空');
  });

  // ---------------------------------------------------------------- §7.3 ratelimit 中间件
  asyncSection('§7.3 ratelimit：配额打满 / 跨日重置 / 会话独立 / 计数回退', async (t) => {
    const db = createTestDb();
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
  asyncSection('§7.3 编号生成与公开配置（shared/defaults 委托）', async (t) => {
    const configLib = require(path.join(API, 'db/config.js'));
    const idGenerator = require(path.join(API, 'lib/id-generator.js'));
    t.check(configLib.PUBLIC_CONFIG_KEYS.indexOf('viewTicketTtlMinutes') >= 0,
      '公开配置子集含 viewTicketTtlMinutes（切换会话倒计时用）');
    const pub = configLib.publicConfig(configLib.cloneDefault());
    t.eq(pub.viewTicketTtlMinutes, 30, 'config.getPublic 公开子集 viewTicketTtlMinutes=30');
    const db = createTestDb();
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
  asyncSection('§7.3 switch-session：READONLY 拒写 / TEST_WRITE 白名单 / 票据过期审计', async (t) => {
    const db = createTestDb();
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
      { _id: 'TK-READONLY', requestKey: 'vs-readonly-0001', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-real-c', targetNo: 'CABCDEFGH', targetIsTest: false, createdAt: NOW, expiresAt: future, endedAt: 0 },
      { _id: 'TK-READONLY-P', requestKey: 'vs-readonly-0002', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.PARTNER, targetId: 'partner-real-1', targetNo: 'PABC23', targetIsTest: false, createdAt: NOW, expiresAt: future, endedAt: 0 },
      { _id: 'TK-TEST', requestKey: 'vs-test-0001', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.TEST_WRITE, role: ROLES.CUSTOMER, targetId: 'TEST-cloudcore0001', targetNo: 'CABCD9999', targetIsTest: true, createdAt: NOW, expiresAt: future, endedAt: 0 },
      { _id: 'TK-EXPIRED', requestKey: 'vs-expired-0001', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-real-c', targetNo: 'CABCDEFGH', targetIsTest: false, createdAt: NOW - 3600000, expiresAt: NOW - 1000, endedAt: 0 }
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
    db.seed('admin_view_sessions', [{ _id: 'TK-GONE', requestKey: 'vs-gone-0001', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-gone', targetNo: 'CABCDEFGH', targetIsTest: false, createdAt: NOW, expiresAt: future, endedAt: 0 }]);
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
  asyncSection('§7.3 API 端到端（health/admin.bootstrap/状态矩阵/幂等/越权）', async (t) => {
    const apiState = probeApiReady();
    if (!apiState.ready) {
      pendingAsserts(t, API_PENDING_ASSERTS, '待 11 域 handlers 齐后重跑（' + String(apiState.error).slice(0, 60) + '）');
      return;
    }
    const app = require(path.join(API, 'app.js'));
    const healthDb = createTestDb();
    const deployApi = app.createApi({ db: healthDb, now: () => NOW, openid: '', env: ADMIN_ENV });
    const health = await deployApi.call('health.check', {});
    t.eq(health.ok, true, '部署上下文 health.check ok:true（internal 最小链路）');
    t.eq(health.data.checks.collections, 14, 'health.check：集合数 14');
    t.eq(health.data.checks.errorCodes, 13, 'health.check：错误码 13');
    t.eq(health.data.checks.configSeeded, false, 'health.check：空库 configSeeded=false');
    const bootstrap1 = await deployApi.call('admin.bootstrap', {});
    t.eq(bootstrap1.ok, true, '部署上下文 admin.bootstrap ok:true');
    t.check(Array.isArray(bootstrap1.data.collections) && bootstrap1.data.collections.length === 14, 'admin.bootstrap 返回 14 集合清单');
    t.eq(bootstrap1.data.indexes.map((i) => i.collection + '.' + i.name).sort().join(' '), 'admin_audit.uk_request_key admin_view_sessions.uk_request_key bindings.uk_active_key bindings.uk_tag_key counters.uk_key customers.uk_customer_no invitation_codes.uk_code order_events.uk_request_key orders.uk_order_no orders.uk_request_key partners.uk_openid partners.uk_partner_no recognition_failures.uk_failure_no recognition_failures.uk_request_key upload_tickets.uk_ticket', '部署清单唯一索引 = DATA_MODEL §5.1 全 15 项（含 bindings.uk_tag_key）');
    const bootstrap2 = await deployApi.call('admin.bootstrap', {});
    t.eq(bootstrap2.data, bootstrap1.data, 'admin.bootstrap 重复调用幂等（结果一致）');
    t.eq((await deployApi.call('health.check', {})).data.checks.configSeeded, true, 'bootstrap 后 health.check configSeeded=true');

    // 内容安全桩：customer.saveProfile 走 cloud.openapi.security.msgSecCheck（v2），pass/risky 两态
    const profileDb = createTestDb();
    profileDb.seed('users', [{ _id: 'openid-profile', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: false, privacyConsent: { version: 'v4.0', at: NOW } }]);
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
      displayName: '小李',
      zone: 'D',
      buildingNo: 4,
      room: '522'
    }, { clientRequestId: 'profile-request-000000002' });
    t.check(riskyProfile.ok === false && riskyProfile.code === 'VALIDATION_FAILED',
      '命中 msgSecCheck（suggest=risky）→ VALIDATION_FAILED（不落库）');

    // 角色授予：auth 对全新用户懒建 users 时 roles=[]；全仓没有别的入口写 CUSTOMER，
    // customer.saveProfile 首存成功即 union 授予 CUSTOMER（二次保存幂等，不重复授予）。
    const roleDb = createTestDb();
    roleDb.seed('users', [{ _id: 'openid-newbie', roles: [], status: USER_STATUS.ACTIVE, isTestAccount: false, privacyConsent: { version: 'v4.0', at: NOW } }]);
    const newbieApi = app.createApi({ db: roleDb, now: () => NOW, openid: 'openid-newbie', env: ADMIN_ENV, cloud: cloudStub('pass') });
    const firstSave = await newbieApi.call('customer.saveProfile', {
      displayName: '小新',
      zone: 'D',
      buildingNo: 4,
      room: '522'
    }, { clientRequestId: 'newbie-profile-0000000001' });
    t.eq(firstSave.ok, true, '§7.3 新用户 roles=[] 首次保存资料：ok:true（角色懒建不再挡住首存）');
    const newbieRoles = roleDb.dump('users').filter((row) => row._id === 'openid-newbie')[0].roles;
    t.eq(newbieRoles, [ROLES.CUSTOMER], '§7.3 首存成功即授予 CUSTOMER 角色（users.roles 精确含 CUSTOMER）');
    const secondSave = await newbieApi.call('customer.saveProfile', {
      displayName: '小新'
    }, { clientRequestId: 'newbie-profile-0000000002' });
    const newbieRolesAfterSecond = roleDb.dump('users').filter((row) => row._id === 'openid-newbie')[0].roles;
    t.check(secondSave.ok === true && newbieRolesAfterSecond.length === 1,
      '§7.3 二次保存不重复授予：ok:true 且 roles 仍只有 1 个 CUSTOMER');
    t.eq(newbieRolesAfterSecond, [ROLES.CUSTOMER], '§7.3 二次保存后 users.roles 仍精确为 [CUSTOMER]（幂等）');
    // 双角色：PARTNER-only 用户首存顾客资料 → 保留 PARTNER 并追加 CUSTOMER（原角色不被覆盖）
    const dualDb = createTestDb();
    dualDb.seed('users', [{ _id: 'openid-dual', roles: [ROLES.PARTNER], status: USER_STATUS.ACTIVE, isTestAccount: false, privacyConsent: { version: 'v4.0', at: NOW } }]);
    const dualApi = app.createApi({ db: dualDb, now: () => NOW, openid: 'openid-dual', env: ADMIN_ENV, cloud: cloudStub('pass') });
    const dualSave = await dualApi.call('customer.saveProfile', {
      displayName: '小双',
      zone: 'D',
      buildingNo: 5,
      room: '610'
    }, { clientRequestId: 'dual-profile-00000000001' });
    t.eq(dualSave.ok, true, '§7.3 PARTNER-only 用户首存顾客资料：ok:true（同一 openid 双角色允许）');
    const dualRoles = dualDb.dump('users').filter((row) => row._id === 'openid-dual')[0].roles;
    t.eq(dualRoles.slice().sort(), [ROLES.CUSTOMER, ROLES.PARTNER],
      '§7.3 PARTNER-only 首存后 roles 同时含 PARTNER+CUSTOMER（原角色不被覆盖）');

    // bind.create 幂等重放：去重键 = bindings.activeKey（同顾客）；同顾客+同兼职重复提交
    // 返回 ok:true + 当前对象 + duplicated=true（不写第二条、不报 CONFLICT）；换另一兼职仍 CONFLICT。
    const bindDb = createTestDb();
    bindDb.seed('users', [
      { _id: 'openid-bind-c', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: false, privacyConsent: { version: 'v4.0', at: NOW } },
      { _id: 'openid-bind-p1', roles: [ROLES.PARTNER], status: USER_STATUS.ACTIVE, isTestAccount: false },
      { _id: 'openid-bind-p2', roles: [ROLES.PARTNER], status: USER_STATUS.ACTIVE, isTestAccount: false }
    ]);
    bindDb.seed('customers', [{ _id: 'openid-bind-c', customerNo: 'CABCDEFGH', displayName: '小王', profileCompleted: true, zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522' }]);
    bindDb.seed('partners', [
      { _id: 'partner-bind-1', openid: 'openid-bind-p1', partnerNo: 'PABC234', displayName: '小李', status: PARTNER_STATUS.ACTIVE, serviceConfig: { acceptingOrders: true } },
      { _id: 'partner-bind-2', openid: 'openid-bind-p2', partnerNo: 'PABC235', displayName: '小张', status: PARTNER_STATUS.ACTIVE, serviceConfig: { acceptingOrders: true } }
    ]);
    const bindApi = app.createApi({ db: bindDb, now: () => NOW, openid: 'openid-bind-c', env: ADMIN_ENV });
    const bindReplayOptions = { clientRequestId: 'bind-request-000000000001' };
    const bindReplay1 = await bindApi.call('bind.create', { partnerNo: 'PABC234' }, bindReplayOptions);
    const bindReplay2 = await bindApi.call('bind.create', { partnerNo: 'PABC234' }, bindReplayOptions);
    t.check(bindReplay1.ok === true && bindReplay2.ok === true && !!bindReplay2.data && bindReplay2.data.duplicated === true,
      '§7.3 bind.create 同请求重放：两次 ok:true 且第二次 duplicated=true（幂等非 CONFLICT）');
    t.eq(bindDb.dump('bindings').filter((row) => row.status === BINDING_STATUS.ACTIVE).length, 1,
      '§7.3 bind.create 重放不重复写绑定（ACTIVE 绑定仍 1 条）');
    const rebind = await bindApi.call('bind.create', { partnerNo: 'PABC235' }, { clientRequestId: 'bind-request-000000000002' });
    t.check(rebind.ok === false && rebind.code === 'CONFLICT',
      '§7.3 bind.create 换另一兼职再绑定 → CONFLICT（换绑需先 release）');

    // order.listPartner DTO 铁律（task-47）：曾把 raw order 文档塞进 groups[].orders（泄露 _id/openid/requestKey）；
    // 修复后响应 = {list,nextCursor,counts} 且列表逐条递归不含 raw 文档敏感键。先证扫描有牙，再扫响应。
    const SENSITIVE_ORDER_KEYS = ['_id', 'customerOpenid', 'partnerOpenid', 'customerId', 'partnerId',
      'clientRequestId', 'requestKey', 'cloudPath', 'claimTokenHash', 'batchActionId'];
    function hasSensitiveKeyDeep(value, keys) {
      if (!value || typeof value !== 'object') {
        return false;
      }
      if (Array.isArray(value)) {
        return value.some((item) => hasSensitiveKeyDeep(item, keys));
      }
      for (let i = 0; i < keys.length; i += 1) {
        if (Object.prototype.hasOwnProperty.call(value, keys[i])) {
          return true;
        }
      }
      return Object.keys(value).some((key) => hasSensitiveKeyDeep(value[key], keys));
    }
    const listDb = createTestDb();
    listDb.seed('users', [
      { _id: 'openid-list-p', roles: [ROLES.PARTNER], status: USER_STATUS.ACTIVE, isTestAccount: false },
      { _id: 'openid-list-c', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: false }
    ]);
    listDb.seed('partners', [{ _id: 'partner-list-1', openid: 'openid-list-p', partnerNo: 'PABC234', displayName: '小李', status: PARTNER_STATUS.ACTIVE, serviceConfig: { acceptingOrders: true } }]);
    listDb.seed('customers', [{ _id: 'openid-list-c', customerNo: 'CABCDEFGH', displayName: '小王', profileCompleted: true, dormKey: 'D4-522' }]);
    listDb.seed('orders', [
      { _id: 'order-list-1', orderNo: '20261021-1001', requestKey: 'openid-list-c:list-1', customerId: 'openid-list-c', customerOpenid: 'openid-list-c', customerNo: 'CABCDEFGH', partnerId: 'partner-list-1', partnerOpenid: 'openid-list-p', partnerNo: 'PABC234', source: 'CUSTOMER', isTest: false, status: ORDER_STATUS.SUBMITTED, statusUpdatedAt: NOW, createdAt: NOW, version: 1, parcel: { stationId: 'P3', pickupCode: 'A123' } },
      { _id: 'order-list-2', orderNo: '20261021-1002', requestKey: 'openid-list-c:list-2', customerId: 'openid-list-c', customerOpenid: 'openid-list-c', customerNo: 'CABCDEFGH', partnerId: 'partner-list-1', partnerOpenid: 'openid-list-p', partnerNo: 'PABC234', source: 'CUSTOMER', isTest: false, status: ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 3600000, completedAt: NOW - 3600000, createdAt: NOW - 7200000, version: 1, parcel: { stationId: 'P3', pickupCode: 'A124' } }
    ]);
    const partnerListApi = app.createApi({ db: listDb, now: () => NOW, openid: 'openid-list-p', env: ADMIN_ENV });
    const partnerList = await partnerListApi.call('order.listPartner', { view: 'workbench' });
    const rawOrderDoc = listDb.dump('orders').filter((row) => row._id === 'order-list-1')[0] || {};
    t.eq(SENSITIVE_ORDER_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(rawOrderDoc, key)),
      ['_id', 'customerOpenid', 'partnerOpenid', 'customerId', 'partnerId', 'requestKey'],
      '§7.3 正控：fake-db raw order 文档确实含敏感键（扫描判据有牙，非空集）');
    t.check(partnerList.ok === true && !!partnerList.data && !('groups' in partnerList.data)
      && Object.keys(partnerList.data).sort().join(',') === 'counts,list,nextCursor',
      '§7.3 order.listPartner 响应无 groups，顶层键恰为 list/nextCursor/counts（不再直出分组 raw 文档）');
    t.check(Array.isArray(partnerList.data.list) && partnerList.data.list.length > 0
      && partnerList.data.list.every((item) => !hasSensitiveKeyDeep(item, SENSITIVE_ORDER_KEYS)),
      '§7.3 order.listPartner 列表逐条递归不含 raw 文档敏感键（_id/openid/id/requestKey/cloudPath 等）');

    const db = createTestDb();
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

    // 幂等：admin 写动作按 admin_audit.requestKey 预查重放（DATA_MODEL §4.7：重复写返回 ok:true+当前对象+duplicated）
    const idemDb = createTestDb();
    idemDb.seed('users', [{ _id: ADMIN_OPENID, roles: [], status: USER_STATUS.ACTIVE, isTestAccount: false }]);
    const idemApi = app.createApi({ db: idemDb, now: () => NOW, openid: ADMIN_OPENID, env: ADMIN_ENV });
    const replayOptions = { clientRequestId: 'invite-request-0000000001' };
    const invite1 = await idemApi.call('admin.createInvites', { count: 1, expiresInHours: 24 }, replayOptions);
    const invite2 = await idemApi.call('admin.createInvites', { count: 1, expiresInHours: 24 }, replayOptions);
    t.check(invite1.ok === true && invite2.ok === true && !!invite2.data && invite2.data.duplicated === true,
      '同 clientRequestId 重放 admin 写动作：返回当前对象 + duplicated=true（幂等成功）');
    t.eq(idemDb.dump('invitation_codes').length, 1, '重放不重复写邀请码（唯一键 + 预查双保险）');
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
  asyncSection('§7.3 cleanup 单触发器时间旅行（到期幂等 / 过期会话审计至多一条）', async (t) => {
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
    const db = createTestDb();
    const dao = createDao(db);
    const longAgo = NOW - 200 * 60 * 60 * 1000;
    db.seed('users', [{ _id: 'openid-timeout', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, isTestAccount: false }]);
    db.seed('orders', [
      { _id: 'order-timeout', orderNo: '20261001-0001', requestKey: 'openid-timeout:timeout-1', customerId: 'openid-timeout', customerOpenid: 'openid-timeout', partnerId: 'partner-x', partnerOpenid: 'openid-partner-x', partnerNo: 'PABC23', status: ORDER_STATUS.SUBMITTED, statusUpdatedAt: longAgo, createdAt: longAgo, version: 1, isTest: false },
      { _id: 'order-auto', orderNo: '20261001-0002', requestKey: 'openid-timeout:auto-1', customerId: 'openid-timeout', customerOpenid: 'openid-timeout', partnerId: 'partner-x', partnerOpenid: 'openid-partner-x', partnerNo: 'PABC23', status: ORDER_STATUS.DELIVERED, statusUpdatedAt: longAgo, deliveredAt: longAgo, createdAt: longAgo, version: 1, isTest: false }
    ]);
    db.seed('config', [{ _id: 'global', orderTimeoutMinutes: 120, autoCompleteHours: 24, screenshotRetentionDays: 7, privacyVersion: 'v4.0' }]);
    db.seed('admin_view_sessions', [{ _id: 'TK-CLEANUP', requestKey: 'vs-cleanup-0001', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-real-c', targetNo: 'CABCDEFGH', targetIsTest: false, createdAt: longAgo, expiresAt: NOW - 1000, endedAt: 0 }]);
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
    const endedAtMs = expiredSession.endedAt instanceof Date
      ? expiredSession.endedAt.getTime()
      : (typeof expiredSession.endedAt === 'string' ? Date.parse(expiredSession.endedAt) : expiredSession.endedAt);
    t.eq(endedAtMs, expiredSession.expiresAt, '过期切换会话补写 endedAt=expiresAt（毫秒口径）');
    t.eq(db.dump('admin_audit').filter((row) => row.action === AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED).length, 1,
      '过期会话写 1 条 ACCOUNT_SWITCH_EXPIRED');
    await byName.viewSessions.run(ctx);
    t.eq(db.dump('admin_audit').filter((row) => row.action === AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED).length, 1,
      '重跑不重复写过期审计（每票至多一条）');
    t.notEmpty(db.dump('orders'), 'cleanup 样本非空');
  });

  // ---------------------------------------------------------------- §7.3 身份域（批 2-A：身份/编号/邀请码/头像票据）
  asyncSection('§7.3 身份域（批2-A bootstrap/隐私同意/资料编号/邀请码激活/头像票据）', async (t) => {
    const app = require(path.join(API, 'app.js'));
    const apiOf = (db, openid, cloud) => app.createApi({ db, now: () => NOW, openid, env: ADMIN_ENV, cloud: cloud || cloudStub('pass') });
    const userOf = (id, roles, extra) => Object.assign({ _id: id, roles: roles || [], status: USER_STATUS.ACTIVE, isTestAccount: false, privacyConsent: { version: 'v4.0', at: NOW } }, extra || {});
    // 1) user.bootstrap：平铺 DTO / isDeveloper 白名单 / viewContext / 首登 roles=[] 不报错
    const bDb = createTestDb();
    const bFlat = await apiOf(bDb, 'openid-boot-new').call('user.bootstrap', {});
    t.eq([bFlat.data.roles, bFlat.data.status, bFlat.data.privacyConsent, bFlat.data.messageReadAt, bFlat.data.customerProfileCompleted, bFlat.data.partnerStatus, bFlat.data.isDeveloper, bFlat.data.viewContext],
      [[], USER_STATUS.ACTIVE, null, 0, false, '', false, null], '§7.3 首登（无 users 行）bootstrap 不报错：平铺 roles/status/privacyConsent/messageReadAt/customerProfileCompleted/partnerStatus/isDeveloper/viewContext 均为初始值');
    t.check(JSON.stringify(bFlat.data).indexOf('openid-boot-new') < 0, '§7.3 bootstrap 永不返回 openid（全响应递归无本次 openid）');
    t.eq((await apiOf(bDb, ADMIN_OPENID).call('user.bootstrap', {})).data.isDeveloper, true, '§7.3 isDeveloper 只由 ADMIN_OPENIDS 环境映射决定（白名单内 true，不看 users.roles）');
    bDb.seed('users', [userOf(ADMIN_OPENID, []), userOf('openid-view-c', [ROLES.CUSTOMER])]);
    bDb.seed('customers', [{ _id: 'openid-view-c', customerNo: 'CABCDEFGH', displayName: '小王', profileCompleted: true, dormKey: 'D4-522' }]);
    bDb.seed('admin_view_sessions', [{ _id: 'TK-VIEW1', requestKey: ADMIN_OPENID + ':vs-view1', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-view-c', targetNo: 'CABCDEFGH', targetDisplayName: '小王', targetIsTest: false, createdAt: NOW, expiresAt: NOW + 3600000, endedAt: 0 }]);
    const bView = await apiOf(bDb, ADMIN_OPENID).call('user.bootstrap', {}, { viewTicket: 'TK-VIEW1' });
    t.eq(bView.data.viewContext, { viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetNo: 'CABCDEFGH', targetDisplayName: '小王', targetIsTest: false, expiresAt: NOW + 3600000 }, '§7.3 viewContext 形状={viewMode,role,targetNo,targetDisplayName,targetIsTest,expiresAt}（切换会话目标上下文）');
    t.eq([bView.data.roles, bView.data.activeRole, bView.data.isDeveloper], [[ROLES.CUSTOMER], ROLES.CUSTOMER, false], '§7.3 切换会话 bootstrap 返回目标角色且 isDeveloper=false（不再分流后台）');
    // 2) user.acceptPrivacy：版本闸 / 同版本幂等 / users.privacyConsent 落库（与 saveProfile/upload 共用一库）
    const sDb = createTestDb();
    sDb.seed('config', [{ _id: 'global', privacyVersion: 'v4.0', avatarMaxBytes: 102400 }]);
    sDb.seed('users', [userOf('openid-privacy', [], { privacyConsent: null }), userOf('openid-sp-a'), userOf('openid-sp-b'), userOf('openid-up-c', [ROLES.CUSTOMER]), userOf('openid-up-p', [ROLES.PARTNER]), userOf('openid-up-victim'), userOf('openid-up-lim', [ROLES.CUSTOMER])]);
    sDb.seed('partners', [{ _id: 'partner-up-p', openid: 'openid-up-p', partnerNo: 'PABC23', displayName: '小李', status: PARTNER_STATUS.ACTIVE, serviceConfig: { acceptingOrders: true } }]);
    sDb.seed('upload_tickets', [{ _id: 'ut-victim', ticket: 'VICTIMTICKET00000000000000000001', openid: 'openid-victim', purpose: 'AVATAR', cloudPath: 'avatars/customer/victimavatar00000000.jpg', size: 1000, contentType: 'image/jpeg', expiresAt: NOW + 60000, usedAt: null, createdAt: NOW },
      { _id: 'ut-used', ticket: 'USEDTICKET0000000000000000000001', openid: 'openid-up-c', purpose: 'AVATAR', cloudPath: 'avatars/customer/usedavatar000000000000.jpg', usedAt: NOW, expiresAt: NOW + 60000, createdAt: NOW }]);
    const pApi = apiOf(sDb, 'openid-privacy');
    const pBad = await pApi.call('user.acceptPrivacy', { version: 'v3.9' });
    t.check(pBad.ok === false && pBad.code === 'VALIDATION_FAILED' && pBad.data.field === 'version', '§7.3 acceptPrivacy 非法版本 → VALIDATION_FAILED(data.field=version)');
    const pOk = await pApi.call('user.acceptPrivacy', { version: 'v4.0' });
    t.check(pOk.ok === true && pOk.data.duplicated === false && pOk.data.privacyConsent.version === 'v4.0', '§7.3 acceptPrivacy 当前版本成功：ok:true、duplicated=false、回读 privacyConsent.version');
    const pDoc = sDb.dump('users').filter((row) => row._id === 'openid-privacy')[0].privacyConsent;
    t.check(!!pDoc && pDoc.version === 'v4.0' && pDoc.at instanceof Date, '§7.3 acceptPrivacy 落库 users.privacyConsent{version,at}（at 为 Date）');
    const pAgain = await pApi.call('user.acceptPrivacy', { version: 'v4.0' });
    t.check(pAgain.ok === true && pAgain.data.duplicated === true, '§7.3 同版本重复同意幂等：duplicated=true、不报错');
    // 3) customer.saveProfile：首存编号 / 不换号 / 重放 / 昵称截断与内容安全 / 头像票据归属
    const sApi = apiOf(sDb, 'openid-sp-a');
    const spDoc = () => sDb.dump('customers').filter((row) => row._id === 'openid-sp-a')[0] || {};
    const spFirst = await sApi.call('customer.saveProfile', { displayName: 'A'.repeat(25), zone: 'D', buildingNo: 4, room: '522' }, { clientRequestId: 'sp-replay-000000000001' });
    t.check(spFirst.ok === true && /^C[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(spFirst.data.customerNo), '§7.3 saveProfile 首存生成 customerNo=C+8 位 32 字母表');
    t.eq([spDoc().displayName.length, spDoc().profileCompleted, sDb.dump('customers').length], [20, true, 1], '§7.3 25 字昵称截断为 20 字；首存只建 1 条 customers 且 profileCompleted=true');
    t.eq(sDb.dump('users').filter((row) => row._id === 'openid-sp-a')[0].roles, [ROLES.CUSTOMER], '§7.3 首存成功 union 授予 CUSTOMER 角色（原 roles 为空）');
    const spReplay = await sApi.call('customer.saveProfile', { displayName: spDoc().displayName, zone: 'D', buildingNo: 4, room: '522' }, { clientRequestId: 'sp-replay-000000000001' });
    t.check(spReplay.ok === true && spReplay.data.customerNo === spFirst.data.customerNo && sDb.dump('customers').length === 1, '§7.3 同 clientRequestId 重放幂等：ok:true、customerNo 不变、不新建文档');
    const spRisky = await apiOf(sDb, 'openid-sp-b', cloudStub('risky')).call('customer.saveProfile', { displayName: '坏昵称', zone: 'D', buildingNo: 4, room: '522' }, { clientRequestId: 'sp-replay-000000000002' });
    t.check(spRisky.ok === false && spRisky.code === 'VALIDATION_FAILED' && spRisky.data.field === 'displayName' && sDb.dump('customers').length === 1, '§7.3 昵称 msgSecCheck=risky → VALIDATION_FAILED(displayName) 且零落库');
    t.eq((await sApi.call('customer.saveProfile', { displayName: spDoc().displayName, avatarFileId: 'cloud://env/avatars/customer/HACKED0000000000000.jpg' }, { clientRequestId: 'sp-replay-000000000003' })).data.avatarFileId, '', '§7.3 无 AVATAR 票据直接传 avatarFileId 不被采信（归属只认票据一条路）');
    t.eq((await sApi.call('customer.saveProfile', { displayName: spDoc().displayName, avatarTicket: 'VICTIMTICKET00000000000000000001', avatarFileId: 'cloud://env/avatars/customer/victimavatar00000000.jpg' }, { clientRequestId: 'sp-replay-000000000004' })).code, 'NOT_FOUND', '§7.3 用他人 AVATAR 票据 → NOT_FOUND（票据归属 effectiveOpenid 校验）');
    const spPrep = await sApi.call('upload.prepare', { purpose: 'AVATAR', size: 50000 }, { clientRequestId: 'sp-avatar-000000000001' });
    const spFile = 'cloud://env.avatars/' + spPrep.data.cloudPath;
    const spAvatar = await sApi.call('customer.saveProfile', { displayName: spDoc().displayName, avatarTicket: spPrep.data.ticket, avatarFileId: spFile }, { clientRequestId: 'sp-replay-000000000005' });
    t.check(spAvatar.ok === true && spAvatar.data.avatarFileId === spFile, '§7.3 本人 AVATAR 票据消费成功：路径/归属/大小校验通过并写 avatarFileId');
    const spTicketUsedAt = sDb.dump('upload_tickets').filter((row) => row.ticket === spPrep.data.ticket)[0].usedAt;
    const spUsedAtMs = spTicketUsedAt instanceof Date ? spTicketUsedAt.getTime() : spTicketUsedAt;
    t.eq([spTicketUsedAt instanceof Date, spUsedAtMs], [true, NOW], '§7.3 头像票据消费后写 usedAt=Date（与订单截图票据 usedAt 同字段口径；一次性）');
    t.eq((await sApi.call('customer.saveProfile', { displayName: spDoc().displayName, avatarTicket: spPrep.data.ticket, avatarFileId: spFile }, { clientRequestId: 'sp-replay-000000000006' })).code, 'INVALID_STATE', '§7.3 头像票据二次消费 → INVALID_STATE（票据一次性）');
    // 4) partner.activate：邀请码状态机 / 角色追加 / 开发者与切换会话分流 / 内容安全零消耗
    const aDb = createTestDb();
    const actIds = ['openid-act-fmt', 'openid-act-nf', 'openid-act-used', 'openid-act-rev', 'openid-act-exp', 'openid-act-ok', 'openid-act-dual', 'openid-act-risky', 'openid-act-limit', 'openid-act-closed'];
    aDb.seed('users', [userOf(ADMIN_OPENID, [])].concat(actIds.map((id) => userOf(id, id === 'openid-act-dual' ? [ROLES.CUSTOMER] : (id === 'openid-act-closed' ? [ROLES.PARTNER] : [])))));
    aDb.seed('customers', [{ _id: 'openid-act-nf', customerNo: 'CABCDEFGJ', displayName: '小王', profileCompleted: true, dormKey: 'D4-522' }]);
    aDb.seed('partners', [{ _id: 'partner-act-closed', openid: 'openid-act-closed', partnerNo: 'PABC24', displayName: '老李', status: PARTNER_STATUS.CLOSED, serviceConfig: {} }]);
    const invDoc = (id, code, extra) => Object.assign({ _id: id, code, status: 'UNUSED', expiresAt: NOW + 3600000, usedBy: '', usedAt: 0, batchId: 'b1', createdBy: 'DEV-01', createdAt: NOW, note: '' }, extra || {});
    aDb.seed('invitation_codes', [invDoc('inv-ok', 'ABCD2345EFGH'), invDoc('inv-used', 'JKMN6789PQRS', { status: 'USED', usedBy: 'partner-x', usedAt: NOW - 1000 }), invDoc('inv-revoked', 'TUVW2345XYZA', { status: 'REVOKED' }), invDoc('inv-expired', 'BCDE3456FGHJ', { expiresAt: new Date(NOW - 1000) }), invDoc('inv-risky', 'CDEF4567GHJK'), invDoc('inv-dual', 'EFGH6789JKMN')]);
    aDb.seed('admin_view_sessions', [{ _id: 'TK-ACT-RO', requestKey: ADMIN_OPENID + ':vs-act-ro', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01', viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-act-nf', targetNo: 'CABCDEFGJ', targetDisplayName: '小王', targetIsTest: false, createdAt: NOW, expiresAt: NOW + 3600000, endedAt: 0 }]);
    const actCall = (openid, payload, extra, cloud) => apiOf(aDb, openid, cloud).call('partner.activate', payload, extra);
    const actFmt = await actCall('openid-act-fmt', { invitationCode: 'bad', displayName: '小李' }, { clientRequestId: 'act-fmt-000000000001' });
    t.check(actFmt.ok === false && actFmt.code === 'VALIDATION_FAILED' && actFmt.data.field === 'invitationCode', '§7.3 activate 邀请码格式错 → VALIDATION_FAILED(data.field=invitationCode)');
    const codeSeq = [(await actCall('openid-act-nf', { invitationCode: 'NPQR2345STUV', displayName: '小李' }, { clientRequestId: 'act-nf-0000000000001' })).code, (await actCall('openid-act-rev', { invitationCode: 'TUVW-2345-XYZA', displayName: '小李' }, { clientRequestId: 'act-rev-000000000001' })).code, (await actCall('openid-act-used', { invitationCode: 'JKMN-6789-PQRS', displayName: '小李' }, { clientRequestId: 'act-used-00000000001' })).code, (await actCall('openid-act-exp', { invitationCode: 'BCDE-3456-FGHJ', displayName: '小李' }, { clientRequestId: 'act-exp-000000000001' })).code];
    t.eq(codeSeq, ['NOT_FOUND', 'NOT_FOUND', 'INVITE_USED', 'INVITE_EXPIRED'], '§7.3 activate 错误映射：不存在/已作废→NOT_FOUND、已用→INVITE_USED、过期→INVITE_EXPIRED（过期用例 expiresAt 用 admin.createInvites 的生产形状 Date，回归惰性过期判定）');
    t.eq(aDb.dump('partners').filter((row) => row.openid === 'openid-act-exp').length, 0, '§7.3 过期邀请码零建号（Date expiresAt 惰性过期判定先于事务写入）');
    const timeLib = require(path.join(API, 'lib/time.js'));
    t.eq([timeLib.isPast(new Date(NOW + 60000), NOW), timeLib.isPast(new Date(NOW - 1000), NOW), timeLib.isPast('2026-10-21T11:59:00+08:00', NOW), timeLib.isPast('2026-10-21T12:01:00+08:00', NOW)], [false, true, true, false], '§7.3 time.isPast 归一 Date/可解析字符串（生产 expiresAt 常为 Date）：过去→true、未来→false');
    t.eq([timeLib.isPast(NOW + 60000, NOW), timeLib.isPast(NOW - 1000, NOW), timeLib.isPast('not-a-date', NOW), timeLib.isPast(undefined, NOW), timeLib.isPast(0, NOW), timeLib.isPast(NaN, NOW)], [false, true, false, false, false, false], '§7.3 time.isPast number 基线不变；无值/非法/非正数 → false（不误判过期）');
    const actOk = await actCall('openid-act-ok', { invitationCode: 'ABCD-2345-EFGH', displayName: '小李' }, { clientRequestId: 'act-ok-0000000000001' });
    t.check(actOk.ok === true && /^P[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(actOk.data.partnerNo) && actOk.data.partner.status === PARTNER_STATUS.ACTIVE && actOk.data.roles.indexOf(ROLES.PARTNER) >= 0, '§7.3 activate 成功：ok:true、partnerNo=P+6 位 32 字母表、partner.status=ACTIVE、roles 含 PARTNER');
    const invOk = aDb.dump('invitation_codes').filter((row) => row.code === 'ABCD2345EFGH')[0];
    const partnerOk = aDb.dump('partners').filter((row) => row.openid === 'openid-act-ok')[0];
    t.eq([invOk.status, invOk.usedBy, invOk.usedAt instanceof Date], ['USED', partnerOk._id, true], '§7.3 激活成功原子消耗邀请码：status=USED、usedBy=partnerId、usedAt 落库（审计链）');
    t.eq(aDb.dump('users').filter((row) => row._id === 'openid-act-ok')[0].roles, [ROLES.PARTNER], '§7.3 激活成功 users.roles 追加 PARTNER');
    const actReplay = await actCall('openid-act-ok', { invitationCode: 'ABCD-2345-EFGH', displayName: '小李' }, { clientRequestId: 'act-ok-0000000000001' });
    t.check(actReplay.code === 'CONFLICT' && aDb.dump('partners').filter((row) => row.openid === 'openid-act-ok').length === 1, '§7.3 activate 重放 → CONFLICT 且不重复建 partners（邀请码状态机+openid 唯一双闸）');
    const actDual = await actCall('openid-act-dual', { invitationCode: 'EFGH-6789-JKMN', displayName: '小双' }, { clientRequestId: 'act-dual-00000000001' });
    t.eq(actDual.data.roles.slice().sort(), [ROLES.CUSTOMER, ROLES.PARTNER], '§7.3 双角色：激活追加 PARTNER 不覆盖原 CUSTOMER');
    t.eq((await actCall('openid-act-closed', { invitationCode: 'ABCD-2345-EFGH', displayName: '小李' }, { clientRequestId: 'act-closed-0000000001' })).code, 'CONFLICT', '§7.3 已是兼职（含 CLOSED）重复激活 → CONFLICT');
    t.eq((await actCall(ADMIN_OPENID, { invitationCode: 'ABCD-2345-EFGH', displayName: '小李' }, { clientRequestId: 'act-dev-000000000001' })).code, 'FORBIDDEN', '§7.3 开发者账号不激活兼职业务身份 → FORBIDDEN');
    t.eq((await actCall(ADMIN_OPENID, { invitationCode: 'ABCD-2345-EFGH', displayName: '小李' }, { viewTicket: 'TK-ACT-RO', clientRequestId: 'act-ro-000000000001' })).code, 'FORBIDDEN', '§7.3 切换会话（READONLY）调 activate → FORBIDDEN');
    const riskyAct = await actCall('openid-act-risky', { invitationCode: 'CDEF-4567-GHJK', displayName: '坏昵称' }, { clientRequestId: 'act-risky-0000000001' }, cloudStub('risky'));
    t.check(riskyAct.code === 'VALIDATION_FAILED' && aDb.dump('invitation_codes').filter((row) => row.code === 'CDEF4567GHJK')[0].status === 'UNUSED' && aDb.dump('partners').filter((row) => row.openid === 'openid-act-risky').length === 0, '§7.3 激活昵称内容安全不过 → VALIDATION_FAILED 且邀请码不消耗、零建号（准入闸先于事务）');
    const actLimit = [];
    for (let i = 0; i < 6; i += 1) actLimit.push((await actCall('openid-act-limit', { invitationCode: 'bad' + i, displayName: '小李' }, { clientRequestId: 'act-limit-0000000000' + i })).code);
    t.eq([actLimit[4], actLimit[5]], ['VALIDATION_FAILED', 'RATE_LIMITED'], '§7.3 activate 5 次失败/日/openid：第 6 次 RATE_LIMITED');
    // 5) upload.prepare(AVATAR) 路径/零 openid/类型/大小/限流 + upload.cancel 自然幂等
    const uApi = apiOf(sDb, 'openid-up-c');
    const uPrep1 = await uApi.call('upload.prepare', { purpose: 'AVATAR' }, { clientRequestId: 'up-path-000000000001' });
    const uPrep2 = await uApi.call('upload.prepare', { purpose: 'AVATAR' }, { clientRequestId: 'up-path-000000000002' });
    t.check(/^avatars\/customer\/[A-Za-z0-9]{20}\.jpg$/.test(uPrep1.data.cloudPath) && uPrep1.data.cloudPath.indexOf('openid-up-c') < 0, '§7.3 upload.prepare(AVATAR) 路径 avatars/customer/{20 位随机}.jpg 且零 openid');
    t.check(uPrep1.data.cloudPath !== uPrep2.data.cloudPath && sDb.dump('upload_tickets').filter((row) => row.ticket === uPrep1.data.ticket)[0].openid === 'openid-up-c', '§7.3 头像路径随机值由服务端生成（两次不同）且票据 openid=effectiveOpenid');
    t.eq((await uApi.call('upload.prepare', { purpose: 'AVATAR', contentType: 'image/gif' }, { clientRequestId: 'up-type-000000000001' })).data.field, 'contentType', '§7.3 AVATAR 只允许 jpg/png：image/gif → VALIDATION_FAILED(contentType)');
    const uMax = await uApi.call('upload.prepare', { purpose: 'AVATAR', size: 102400 }, { clientRequestId: 'up-size-000000000001' });
    const uBig = await uApi.call('upload.prepare', { purpose: 'AVATAR', size: 102401 }, { clientRequestId: 'up-size-000000000002' });
    t.check(uMax.ok === true && uBig.code === 'VALIDATION_FAILED' && uBig.data.field === 'size', '§7.3 头像大小闸=config.avatarMaxBytes（102400 通过、102401 → VALIDATION_FAILED(size)）');
    t.check(/^avatars\/partner\/[A-Za-z0-9]{20}\.jpg$/.test((await apiOf(sDb, 'openid-up-p').call('upload.prepare', { purpose: 'AVATAR' }, { clientRequestId: 'up-path-000000000003' })).data.cloudPath), '§7.3 兼职身份头像路径 avatars/partner/…（role 由服务端身份判定）');
    const uCancel1 = await uApi.call('upload.cancel', { uploadTicketId: uPrep1.data.ticket });
    const uCancel2 = await uApi.call('upload.cancel', { uploadTicketId: uPrep1.data.ticket });
    const uCancelMissing = await uApi.call('upload.cancel', { uploadTicketId: 'NOSUCHTICKET00000000000000000001' });
    t.check(uCancel1.data.cancelled === true && uCancel2.ok === true && uCancel2.data.cancelled === false && uCancelMissing.ok === true, '§7.3 upload.cancel 自然幂等：首次 cancelled=true、重复/不存在均 ok:true+cancelled=false');
    t.eq((await apiOf(sDb, 'openid-up-victim').call('upload.cancel', { uploadTicketId: uPrep2.data.ticket })).code, 'NOT_FOUND', '§7.3 非本人撤销票据 → NOT_FOUND（不暴露存在性）');
    t.eq((await uApi.call('upload.cancel', { uploadTicketId: 'USEDTICKET0000000000000000000001' })).code, 'INVALID_STATE', '§7.3 已消费票据撤销 → INVALID_STATE');
    const limApi = apiOf(sDb, 'openid-up-lim');
    const limCodes = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await limApi.call('upload.prepare', { purpose: 'AVATAR' }, { clientRequestId: 'up-limit-0000000000' + i });
      limCodes.push(res.ok ? 'OK' : res.code);
    }
    t.eq(limCodes, ['OK', 'OK', 'OK', 'OK', 'OK', 'RATE_LIMITED'], '§7.3 头像上传 5 次/日/人：第 6 次 RATE_LIMITED');
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
