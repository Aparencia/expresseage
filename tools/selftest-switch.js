'use strict';
/**
 * tools/selftest-switch.js — 切换会话（READONLY 真实账号只读 / TEST_WRITE 测试账号可写）客户端纯件断言
 * （S15；ENGINEERING §7.2 接入范式）。
 *
 * 覆盖：
 *   §2.13  viewContext 形状与内存态：票据只在 store 内存，本地存储白名单不吐 viewTicket/viewMode/targetIsTest
 *   §4.1   VIEW_MODE 恰两种 + validateViewMode / validateToken 的票据形态闸
 *   §10    客户端二道闸：READONLY 写全拦、TEST_WRITE 禁 admin.* 与三项写动作、viewAsEnd 放行、会话条数据
 *   §7.2   api/client：viewTicket 注入、VIEW_TICKET_EXPIRED 清会话、读重试/写不重试（transport 注入，不 mock wx）
 *   §3.6   config/route 启动分流：有会话→目标角色首页（优先于开发者后台）；无会话→activeRole/角色页
 *   §4.3   审计动作集合：ACCOUNT_SWITCH_* 在册、旧 VIEW_AS_* 零残留（读侧换算、写侧零旧名）
 *
 * 纪律：样本非空、先合法基线再反例；不 mock 全局 wx（api/client 用 setTransport 注入替身）；
 *       旧审计名以拼接构造，本文件不出现旧名字面量（门禁 #30 口径）；EXPECTED_ASSERTIONS 与实际精确相等。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const enums = require(path.join(ROOT, 'shared/enums.js'));
const validate = require(path.join(ROOT, 'shared/validate.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const audit = require(path.join(ROOT, 'shared/audit-actions.js'));
const storage = require(path.join(ROOT, 'utils/storage.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const modeGuard = require(path.join(ROOT, 'api/mode-guard.js'));
const client = require(path.join(ROOT, 'api/client.js'));
const route = require(path.join(ROOT, 'config/route.js'));
const adminDto = require(path.join(ROOT, 'cloudfunctions/api/handlers/admin/_dto.js'));

const EXPECTED_ASSERTIONS = 74;

const VIEW_TICKET = 'T'.repeat(enums.TOKEN_LENGTH);
// 旧审计名用拼接构造：本文件不出现旧名字面量（门禁 #30 / 文档纪律）
const LEGACY_AUDIT_PREFIX = 'VIEW' + '_' + 'AS' + '_';

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function noThrow(fn) {
  try {
    fn();
    return true;
  } catch (err) {
    return false;
  }
}

function errorCodeOf(fn) {
  try {
    fn();
    return '';
  } catch (err) {
    return err && err.code ? err.code : 'UNKNOWN_THROW';
  }
}

// 客户端 viewContext 形状（admin.viewAsStart 下发的内存态；含票据本身，只存内存）
function sampleViewContext(overrides) {
  return Object.assign({
    viewTicket: VIEW_TICKET,
    viewMode: enums.VIEW_MODE.READONLY,
    role: 'CUSTOMER',
    targetNo: 'C-ABCD-2345',
    targetDisplayName: '只读目标',
    targetIsTest: false,
    expiresAt: 1700000000000
  }, overrides || {});
}

function register(h) {
  // ---------------------------------------------------------------- §2.13 会话上下文
  h.section('§2.13 viewContext 形状与内存态（票据不落盘）', (t) => {
    store.reset();
    const view = sampleViewContext();
    store.setViewContext(view);
    t.eq(store.getViewContext(), view,
      'viewContext 形状原样入内存（票据/模式/角色/编号/昵称/测试标记/到期 7 字段）');
    t.eq(store.snapshot().viewContext.viewMode, enums.VIEW_MODE.READONLY, '快照含会话模式（黄条数据源）');
    t.eq(store.hasRole('CUSTOMER'), false, '会话不冒充业务角色（store.roles 不变；权限仍看 users.roles）');
    const snap = store.snapshot();
    snap.viewContext.targetNo = 'C-MUTATED-0000';
    t.eq(store.getViewContext().targetNo, 'C-ABCD-2345', 'snapshot 深拷贝：改快照不回写会话上下文');
    store.clearViewContext();
    t.eq(store.getViewContext(), null, '结束会话清空内存上下文（回到账号切换）');
    store.setViewContext(sampleViewContext());
    store.reset();
    t.eq(store.getViewContext(), null, 'store.reset 清空会话上下文（冷启动丢失，不还原）');

    // 不落盘：本地存储白名单只认 lastRole/guides/draftPointer
    const dirtyRaw = JSON.stringify({
      lastRole: 'PARTNER',
      guides: { PARTNER_WORKBENCH_V1: true },
      draftPointer: 'draft_1',
      viewMode: 'TEST_WRITE',
      viewTicket: VIEW_TICKET,
      targetIsTest: true,
      viewContext: { targetNo: 'C-TEST-0001' }
    });
    let saved = dirtyRaw;
    const platform = {
      getStorageSync: function getStorageSync() { return saved; },
      setStorageSync: function setStorageSync(key, value) { saved = value; },
      removeStorageSync: function removeStorageSync() { saved = ''; }
    };
    const loaded = storage.load(platform);
    t.eq(Object.keys(loaded).sort(), ['draftPointer', 'guides', 'lastRole'],
      '本地存储只归三键（会话票据/模式/目标测试标记不进存储）');
    t.check(!/viewTicket|viewMode|targetIsTest|viewContext/.test(JSON.stringify(loaded)),
      '存储读数零会话字段（ENGINEERING §5.6 / 门禁 #15）');
    t.eq(loaded.guides, { PARTNER_WORKBENCH_V1: true }, '引导标记按白名单保留（纯 UI 偏好）');
    t.check(storage.ALLOWED_ROLES.indexOf('DEVELOPER') === -1, '本地存储只记业务角色（开发者身份不入本地存储）');
  });

  // ---------------------------------------------------------------- §4.1 模式与票据
  h.section('§4.1 VIEW_MODE/票据形态校验（会话参数只认两种模式）', (t) => {
    t.eq(enums.VIEW_MODE_LIST, [enums.VIEW_MODE.READONLY, enums.VIEW_MODE.TEST_WRITE], '会话模式恰两种（READONLY/TEST_WRITE）');
    t.check(Object.keys(enums.VIEW_MODE_TEXT).every((key) => enums.VIEW_MODE_TEXT[key].length > 0), '两种模式都有中文条文案');
    t.check(validate.validateViewMode(enums.VIEW_MODE.READONLY).ok, '合法基线：READONLY 通过');
    t.check(validate.validateViewMode(enums.VIEW_MODE.TEST_WRITE).ok, '合法基线：TEST_WRITE 通过');
    t.check(!validate.validateViewMode('READWRITE').ok, '反例：未登记模式被挡（不发明第三种）');
    t.check(!validate.validateViewMode('readonly').ok, '反例：小写模式被挡（严格字面量）');
    t.eq(enums.TOKEN_LENGTH, 32, '会话票据 32 位');
    t.check(validate.validateToken(VIEW_TICKET).ok && !validate.validateToken('T'.repeat(31)).ok,
      '票据校验：32 位通过、31 位被挡');
  });

  // ---------------------------------------------------------------- §10 客户端二道闸
  h.section('§10 客户端二道闸（READONLY 禁写 / TEST_WRITE 禁管理动作）', (t) => {
    store.reset();
    t.check(modeGuard.isReadonly() === false && modeGuard.canRenderWriteButton() === true,
      '无会话：非只读、写按钮可渲染');
    t.check(noThrow(() => modeGuard.assertWritable('order.accept')), '无会话：写动作放行（安全边界在服务端）');
    t.eq(modeGuard.sessionBanner(), null, '无会话：不渲染会话条');

    store.setViewContext(sampleViewContext());
    t.check(modeGuard.isReadonly() === true && modeGuard.isTestWrite() === false, 'READONLY：只读标记');
    t.eq(errorCodeOf(() => modeGuard.assertWritable('order.accept')), 'FORBIDDEN', 'READONLY：写动作被客户端二道闸挡住');
    t.eq(errorCodeOf(() => modeGuard.assertWritable('bind.create')), 'FORBIDDEN', 'READONLY：绑定写动作被挡');
    t.check(noThrow(() => modeGuard.assertWritable('order.listPartner')), 'READONLY：读动作照常放行');
    t.check(noThrow(() => modeGuard.assertWritable('admin.viewAsEnd')), 'READONLY：退出会话动作必须放行');
    t.eq(modeGuard.canRenderWriteButton(), false, 'READONLY：写按钮不渲染');
    const readonlyBanner = modeGuard.sessionBanner();
    t.check(readonlyBanner !== null && readonlyBanner.readonly === true
      && readonlyBanner.mode === enums.VIEW_MODE.READONLY, 'READONLY：黄条数据（readonly=true）');

    store.setViewContext(sampleViewContext({
      viewMode: enums.VIEW_MODE.TEST_WRITE,
      targetIsTest: true,
      targetNo: 'C-TEST-0001'
    }));
    t.check(modeGuard.isTestWrite() === true && modeGuard.isReadonly() === false, 'TEST_WRITE：可写标记');
    t.check(modeGuard.canRenderWriteButton() === true, 'TEST_WRITE：写按钮可渲染（蓝条 + 角标）');
    t.eq(modeGuard.TEST_BANNED_ACTIONS.slice().sort(),
      ['ai.parseParcel', 'partner.activate', 'user.deleteAccount'], 'TEST_WRITE 禁写清单精确三项');
    ['admin.purgeTestData', 'admin.createTestAccount', 'partner.activate', 'user.deleteAccount', 'ai.parseParcel']
      .forEach((action) => {
        t.eq(errorCodeOf(() => modeGuard.assertWritable(action)), 'FORBIDDEN', 'TEST_WRITE：' + action + ' 被挡');
      });
    t.check(noThrow(() => modeGuard.assertWritable('order.create'))
      && noThrow(() => modeGuard.assertWritable('order.accept'))
      && noThrow(() => modeGuard.assertWritable('bind.create')),
    'TEST_WRITE：普通业务写动作放行（以目标测试账号身份执行）');
    const testBanner = modeGuard.sessionBanner();
    t.check(testBanner !== null && testBanner.mode === enums.VIEW_MODE.TEST_WRITE
      && testBanner.targetIsTest === true && testBanner.readonly === false,
    'TEST_WRITE：蓝条数据（targetIsTest=true）');
    t.check(modeGuard.isWriteAction('order.accept') && !modeGuard.isWriteAction('order.listCustomer')
      && !modeGuard.isWriteAction('not.registered'), '写标记取自 action 注册表；未登记动作不当写处理');
    store.reset();
  });

  // ---------------------------------------------------------------- §7.2 请求包络（异步）
  h.section('§7.2 请求包络（viewTicket 注入/过期清会话/读重试写不重试）', async (t) => {
    store.reset();
    const seen = [];
    let caught = null;
    try {
      client.setTransport((payload) => {
        seen.push(payload);
        return Promise.resolve({ ok: true, data: { list: [] }, serverTime: Date.now() });
      });
      await client.call('order.listPartner', { view: 'workbench' });
      t.check(seen.length === 1 && seen[0].viewTicket === undefined, '无会话：包络不带 viewTicket');
      t.eq(seen[0].data, { view: 'workbench' }, '包络 data 原样透传');

      store.setViewContext(sampleViewContext());
      await client.call('order.listPartner', {});
      t.eq(seen[seen.length - 1].viewTicket, VIEW_TICKET, 'READONLY：每次请求注入会话票据');

      store.setViewContext(sampleViewContext({
        viewMode: enums.VIEW_MODE.TEST_WRITE,
        targetIsTest: true,
        targetNo: 'C-TEST-0001'
      }));
      await client.call('order.accept', { orderNo: '20261021-0001' });
      t.eq(seen[seen.length - 1].viewTicket, VIEW_TICKET, 'TEST_WRITE：写请求同样带票据（服务端交叉校验 targetIsTest）');

      // 会话内存态但票据缺失（异常恢复路径）：不得注入空值冒充票据
      store.setViewContext({ viewMode: enums.VIEW_MODE.READONLY, role: 'CUSTOMER' });
      await client.call('order.listCustomer', {});
      t.check(seen[seen.length - 1].viewTicket === undefined, '会话缺票据时不注入空值（服务端按无票据处理）');

      client.setTransport(() => Promise.resolve({ ok: false, code: 'VIEW_TICKET_EXPIRED' }));
      caught = null;
      try {
        await client.call('order.listCustomer', {});
      } catch (err) {
        caught = err;
      }
      t.check(caught !== null && caught.code === 'VIEW_TICKET_EXPIRED' && store.getViewContext() === null,
        '票据过期：清本地会话（回到账号切换）');
      t.check(caught !== null && caught.message === errorCopy.CODE_COPY.VIEW_TICKET_EXPIRED,
        '票据过期文案取同源人话（不暴露英文码）');
      t.check(/重新开启/.test(errorCopy.CODE_COPY.VIEW_TICKET_EXPIRED), '过期文案给出下一步（重新开启会话）');

      store.reset();
      let attempts = 0;
      client.setTransport(() => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new client.CallError('DEPENDENCY_FAILED', '读动作首次失败'));
        }
        return Promise.resolve({ ok: true, data: { list: [] }, serverTime: Date.now() });
      });
      const retried = await client.call('order.listPartner', {});
      t.check(attempts === 2 && Array.isArray(retried.list), '读动作自动重试一次（读可重放）');

      attempts = 0;
      let writePayload = null;
      client.setTransport((payload) => {
        attempts += 1;
        writePayload = payload;
        return Promise.reject(new client.CallError('DEPENDENCY_FAILED', '写动作失败'));
      });
      caught = null;
      try {
        await client.call('order.accept', { orderNo: '20261021-0001' });
      } catch (err) {
        caught = err;
      }
      t.check(attempts === 1 && caught !== null && caught.code === 'DEPENDENCY_FAILED',
        '写动作不自动重试（重复提交风险由 clientRequestId/服务端幂等兜）');
      t.check(/^[A-Za-z0-9_-]{24}$/.test(String(writePayload && writePayload.clientRequestId)),
        '写包络 clientRequestId 24 位（重试不换键）');
    } finally {
      client.restoreTransport();
      store.reset();
    }
  });

  // ---------------------------------------------------------------- §3.6 启动分流
  h.section('§3.6 启动分流（有会话→目标角色首页；无会话→activeRole/角色页）', (t) => {
    store.reset();
    t.eq(route.decideLaunchRoute({ viewContext: sampleViewContext(), isDeveloper: true, roles: [] }),
      { url: route.CUSTOMER_HOME, reason: 'VIEW_CONTEXT' }, '有会话（顾客目标）→ 顾客首页（优先于开发者后台）');
    t.eq(route.decideLaunchRoute({ viewContext: sampleViewContext({ role: 'PARTNER' }), isDeveloper: true }),
      { url: route.PARTNER_WORKBENCH, reason: 'VIEW_CONTEXT' }, '有会话（兼职目标）→ 兼职工作台');
    t.eq(route.decideLaunchRoute({ isDeveloper: true }),
      { url: route.ADMIN_OVERVIEW, reason: 'DEVELOPER' }, '无会话开发者 → 后台总览');
    t.eq(route.decideLaunchRoute({ roles: [], activeRole: null }),
      { url: route.ROLE_PAGE, reason: 'NO_ROLE' }, '无角色 → 角色页');
    t.eq(route.decideLaunchRoute({
      roles: ['PARTNER'], activeRole: 'PARTNER', partner: { profileComplete: true, status: 'ACTIVE' }
    }), { url: route.PARTNER_WORKBENCH, reason: 'PARTNER_ACTIVE' }, '兼职已完善 → 工作台');
    t.eq(route.decideLaunchRoute({ roles: ['PARTNER'], activeRole: 'PARTNER', partner: { profileComplete: false } }),
      { url: route.PROFILE_PAGE, reason: 'PARTNER_PROFILE' }, '兼职未完善 → 资料页');
    t.eq(route.decideLaunchRoute({
      roles: ['PARTNER'], activeRole: 'PARTNER', partner: { profileComplete: true, status: 'SUSPENDED' }
    }), { url: route.PROFILE_PAGE, reason: 'PARTNER_INACTIVE' }, '兼职停用 → 资料页（不去工作台接单）');
    t.eq(route.decideLaunchRoute({ roles: ['CUSTOMER'], activeRole: 'CUSTOMER', customer: { profileComplete: true } }),
      { url: route.CUSTOMER_HOME, reason: 'CUSTOMER_READY' }, '顾客已完善 → 首页');
    t.eq(route.decideLaunchRoute({ roles: ['CUSTOMER'], activeRole: 'CUSTOMER', customer: { profileComplete: false } }),
      { url: route.PROFILE_PAGE, reason: 'CUSTOMER_PROFILE' }, '顾客未完善 → 资料页');
    const viewCustomer = { viewContext: sampleViewContext() };
    t.check(route.isRolePageAllowed('/pages/customer/home/index', viewCustomer) === true
      && route.isRolePageAllowed('/pages/partner/workbench/index', viewCustomer) === false,
    '有会话：只允许目标角色页面（会话内不串角色入口）');
    t.check(route.isRolePageAllowed('/pages/customer/home/index', {}) === false,
      '无会话且无 activeRole：角色页鉴权一律拒绝');
    t.check(route.isRolePageAllowed('/pages/partner/workbench/index', { activeRole: 'PARTNER' }) === true
      && route.isRolePageAllowed('/pages/customer/home/index', { activeRole: 'PARTNER' }) === false,
    '无会话：按 activeRole 放行对应角色页');
    store.reset();
  });

  // ---------------------------------------------------------------- §4.3 审计
  h.section('§4.3 审计动作集合（ACCOUNT_SWITCH_*；旧名零残留）', (t) => {
    t.eq(audit.AUDIT_ACTION_COUNT, 16, '审计动作恰好 16 个（v0.9 集合）');
    t.check(['ACCOUNT_SWITCH_START', 'ACCOUNT_SWITCH_END', 'ACCOUNT_SWITCH_EXPIRED']
      .every((action) => audit.AUDIT_ACTION_LIST.indexOf(action) !== -1), '切换会话三审计在册');
    t.check(audit.AUDIT_ACTION_LIST.every((action) => action.indexOf(LEGACY_AUDIT_PREFIX) === -1),
      '注册表零旧审计名（只写 ACCOUNT_SWITCH_*）');
    t.eq(audit.isAuditAction(audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_START), true, 'isAuditAction 认新名');
    t.eq(audit.isAuditAction(LEGACY_AUDIT_PREFIX + 'START'), false, 'isAuditAction 不认旧名（新日志不会写旧值）');
    t.eq(adminDto.auditActionOf(LEGACY_AUDIT_PREFIX + 'START'), audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_START,
      '历史旧名 START 读侧换算到新名');
    t.eq(adminDto.auditActionOf(LEGACY_AUDIT_PREFIX + 'END'), audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_END,
      '历史旧名 END 读侧换算到新名');
    t.eq(adminDto.auditActionOf(LEGACY_AUDIT_PREFIX + 'EXPIRED'), audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED,
      '历史旧名 EXPIRED 读侧换算到新名');
    t.eq(adminDto.auditActionOf('ACCOUNT_SWITCH_START'), 'ACCOUNT_SWITCH_START', '新名原样透传（读侧幂等）');
    const startSrc = readText('cloudfunctions/api/handlers/admin/viewAsStart.js');
    const endSrc = readText('cloudfunctions/api/handlers/admin/viewAsEnd.js');
    const switchSrc = readText('cloudfunctions/api/middleware/switch-session.js');
    t.check(startSrc.indexOf('ACCOUNT_SWITCH_START') !== -1 && startSrc.indexOf('ACCOUNT_SWITCH_END') !== -1,
      '开启会话：写 ACCOUNT_SWITCH_START（覆盖旧会话补 END）');
    t.check(endSrc.indexOf('ACCOUNT_SWITCH_END') !== -1, '结束会话：写 ACCOUNT_SWITCH_END');
    t.check(switchSrc.indexOf('ACCOUNT_SWITCH_EXPIRED') !== -1, '票据过期：写 ACCOUNT_SWITCH_EXPIRED');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const { createHarness, installCrashGuard } = require('./selftest');
  const h = createHarness({ name: 'selftest-switch' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-switch');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
