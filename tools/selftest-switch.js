'use strict';
/**
 * tools/selftest-switch.js — 切换会话（READONLY 真实账号只读 / TEST_WRITE 测试账号可写）客户端纯件断言
 * （S15；ENGINEERING §7.2 接入范式）。
 *
 * 覆盖：
 *   §2.13  viewContext 形状与内存态：票据只在 store 内存，本地存储白名单不吐 viewTicket/viewMode/targetIsTest
 *   §2.13  服务端签发（fake DB 端到端）：viewAsStart 的 targetId 口径（顾客 openid/兼职 partners._id/测试合成 openid）、
 *          READONLY×TEST_WRITE 双保险、单活票据覆盖 + END 审计、同 requestKey 幂等
 *   §4.1   VIEW_MODE 恰两种 + validateViewMode / validateToken 的票据形态闸
 *   §4.8.2 服务端每请求校验（fake DB）：READONLY 写拒/读白名单、TEST_WRITE 四项禁、跨人/篡改/过期拒绝、
 *          actorOpenid/effectiveOpenid 分离与 testLastUsedAt 更新
 *   §4.8.3 退出会话（fake DB）：包络票据注入 payload、END 审计 reason=EXIT、重复结束幂等、非本人票据拒
 *   §10    客户端二道闸：READONLY 写全拦、TEST_WRITE 禁 admin.* 与三项写动作、viewAsEnd 放行、会话条数据、
 *          黄条/蓝条颜色与 TEST 角标数据源、账号切换页两 tab/代理切换文案/管理入口
 *   §7.2   api/client：viewTicket 注入、VIEW_TICKET_EXPIRED 清会话、读重试/写不重试、二道闸已接线（本地即拒不触达 transport）
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
const fake = require(path.join(ROOT, 'tools/fake-db.js'));
const daoModule = require(path.join(ROOT, 'cloudfunctions/api/db/dao.js'));
const cloudActions = require(path.join(ROOT, 'cloudfunctions/api/shared/actions.js'));
const cloudEnums = require(path.join(ROOT, 'cloudfunctions/api/shared/enums.js'));
const viewAsStart = require(path.join(ROOT, 'cloudfunctions/api/handlers/admin/viewAsStart.js'));
const viewAsEnd = require(path.join(ROOT, 'cloudfunctions/api/handlers/admin/viewAsEnd.js'));
const switchSession = require(path.join(ROOT, 'cloudfunctions/api/middleware/switch-session.js'));

const EXPECTED_ASSERTIONS = 140;

const VIEW_TICKET = 'T'.repeat(enums.TOKEN_LENGTH);
// 旧审计名用拼接构造：本文件不出现旧名字面量（门禁 #30 / 文档纪律）
const LEGACY_AUDIT_PREFIX = 'VIEW' + '_' + 'AS' + '_';

// ── 服务端切换会话样本（fake DB；ctx = app.js 注入形状）────────────────────────
const SWITCH_NOW = Date.UTC(2026, 9, 22, 0, 0, 0);
const SWITCH_FUTURE = SWITCH_NOW + 30 * 60 * 1000;
const ADMIN_OPENID = 'admin-openid';
const TEST_PARTNER_OPENID = 'TEST-PARTNER000001';
const SWITCH_UNIQUE = {
  admin_view_sessions: [['requestKey']],
  customers: [['customerNo']],
  partners: [['partnerNo']],
  admin_audit: [['requestKey']],
  orders: [['orderNo'], ['requestKey']],
  bindings: [['activeKey']]
};

function requestKeyOf(index) {
  return 'ABCDEFGHIJKLMNOPQRST' + String(1000 + index);
}

function switchCtx(db, options) {
  const opts = options || {};
  const openid = opts.openid || ADMIN_OPENID;
  return {
    dao: daoModule.createDao(db),
    ids: {},
    now: SWITCH_NOW,
    env: {},
    cloud: opts.cloud,
    openid: openid,
    identity: {
      actorOpenid: openid,
      effectiveOpenid: openid,
      role: '',
      isTestAccount: false,
      viewMode: '',
      viewTicketId: '',
      developerNo: opts.developerNo === undefined ? 'DEV-01' : opts.developerNo
    },
    requestId: 'req-switch-001',
    clientRequestId: opts.clientRequestId || requestKeyOf(0),
    expectedVersion: undefined,
    config: {}
  };
}

function switchState(ctx, action, payload, extraMeta) {
  return {
    action: action,
    payload: payload || {},
    ctx: ctx,
    meta: Object.assign({ spec: cloudActions.ACTION_MAP[action] }, extraMeta || {})
  };
}

async function switchResult(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

function switchSessionRow(ticket, viewMode, role, targetId, targetNo, targetIsTest, expiresAt) {
  return {
    _id: ticket,
    requestKey: 'rk-' + ticket,
    adminOpenid: ADMIN_OPENID,
    developerNo: 'DEV-01',
    viewMode: viewMode,
    role: role,
    targetId: targetId,
    targetNo: targetNo,
    targetDisplayName: '目标账号',
    targetAvatarFileId: '',
    targetIsTest: targetIsTest,
    createdAt: new Date(SWITCH_NOW),
    expiresAt: expiresAt || SWITCH_FUTURE,
    endedAt: null
  };
}

function seedSwitchBase(db) {
  const active = cloudEnums.USER_STATUS.ACTIVE;
  const nowDate = new Date(SWITCH_NOW);
  db.seed('users', [
    { _id: ADMIN_OPENID, roles: [], status: active, isTestAccount: false, createdByDeveloperNo: '', testLastUsedAt: 0, messageReadAt: 0, privacyConsent: null, deletionRequestedAt: 0, createdAt: nowDate, updatedAt: nowDate },
    { _id: 'openid-real-c', roles: [cloudEnums.ROLES.CUSTOMER], status: active, isTestAccount: false, createdAt: nowDate, updatedAt: nowDate },
    { _id: 'openid-real-p', roles: [cloudEnums.ROLES.PARTNER], status: active, isTestAccount: false, createdAt: nowDate, updatedAt: nowDate },
    { _id: TEST_PARTNER_OPENID, roles: [cloudEnums.ROLES.PARTNER], status: active, isTestAccount: true, createdByDeveloperNo: 'DEV-01', testLastUsedAt: 0, createdAt: nowDate, updatedAt: nowDate }
  ]);
  db.seed('customers', [
    { _id: 'openid-real-c', customerNo: 'CABCDEFGH', displayName: '顾客甲', avatarFileId: '', zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', profileCompleted: true, createdAt: nowDate, updatedAt: nowDate }
  ]);
  db.seed('partners', [
    { _id: 'partner-real-1', openid: 'openid-real-p', partnerNo: 'PABC23D', displayName: '兼职乙', avatarFileId: '', status: cloudEnums.PARTNER_STATUS.ACTIVE, serviceConfig: { services: [], zones: [], acceptingOrders: true }, stats: {}, createdAt: nowDate, updatedAt: nowDate },
    { _id: 'partner-test-1', openid: TEST_PARTNER_OPENID, partnerNo: 'PTEST23', displayName: '测试兼职', avatarFileId: '', status: cloudEnums.PARTNER_STATUS.ACTIVE, serviceConfig: { services: [], zones: [], acceptingOrders: true }, stats: {}, createdAt: nowDate, updatedAt: nowDate }
  ]);
}

function sessionDocOf(db, ticket) {
  return db.dump('admin_view_sessions').filter((row) => row._id === ticket)[0] || null;
}

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

    // 黄条/蓝条/TEST 角标与账号切换页文案（UI 判据；颜色常量单源在 switch-bar 组件内）
    const switchBarCss = readText('components/switch-bar/index.wxss');
    t.check(switchBarCss.indexOf('#FFF4CE') !== -1, '黄条颜色常量 #FFF4CE（READONLY）');
    t.check(switchBarCss.indexOf('#E8F0FF') !== -1, '蓝条颜色常量 #E8F0FF（TEST_WRITE）');
    const switchBarWxml = readText('components/switch-bar/index.wxml');
    t.check(switchBarWxml.indexOf('开发者只读视角') !== -1 && switchBarWxml.indexOf('测试账号') !== -1,
      '切换条两种模式文案（黄条只读/蓝条测试账号）');
    t.check(switchBarWxml.indexOf('<test-badge') !== -1, '蓝条渲染 TEST 角标组件');
    const badgeJs = readText('components/test-badge/index.js');
    t.check(/viewMode === 'TEST_WRITE'/.test(badgeJs), 'TEST 角标受 viewMode=TEST_WRITE 控制');
    const accountPageWxml = readText('pkg-admin/pages/account-switch/index.wxml');
    t.check(accountPageWxml.indexOf('应用内账号代理切换') !== -1,
      '账号切换页文案：仅应用内代理切换（小程序不能切微信登录账号）');
    const adminConstants = readText('pkg-admin/common/constants.js');
    t.check(adminConstants.indexOf('真实账号（只读）') !== -1 && adminConstants.indexOf('测试账号（可写）') !== -1,
      '账号切换页两 tab（真实只读 / 测试可写）');
    t.check(accountPageWxml.indexOf('新建测试账号') !== -1, '测试账号管理入口（新建）');
    const accountPageJs = readText('pkg-admin/pages/account-switch/index.js');
    t.check(accountPageJs.indexOf('dryRun: true') !== -1, '删除测试账号前先 dryRun 拿将删除条数');
    t.check(accountPageJs.indexOf('avatarFiles') !== -1, '删除预览展示头像/原图文件数（级联删范围可见）');
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

      // 二道闸接线：api/client 在组装包络前先过 mode-guard（本地即拒不触达 transport）
      store.reset();
      let guardTransportCalls = 0;
      client.setTransport(() => {
        guardTransportCalls += 1;
        return Promise.resolve({ ok: true, data: {}, serverTime: Date.now() });
      });
      store.setViewContext(sampleViewContext());
      let guardErr = null;
      try {
        await client.call('order.accept', {});
      } catch (err) {
        guardErr = err;
      }
      t.eq(guardErr && guardErr.code, 'FORBIDDEN', 'READONLY 写动作在 api/client 被二道闸拦（FORBIDDEN）');
      t.eq(guardTransportCalls, 0, 'READONLY 写动作未触达 transport（本地即拒）');
      store.setViewContext(sampleViewContext({
        viewMode: enums.VIEW_MODE.TEST_WRITE,
        targetIsTest: true,
        targetNo: 'C-TEST-0001'
      }));
      guardErr = null;
      try {
        await client.call('admin.purgeTestData', {});
      } catch (err) {
        guardErr = err;
      }
      t.eq(guardErr && guardErr.code, 'FORBIDDEN', 'TEST_WRITE admin.* 在 api/client 被拦（票据不当后台凭据）');
      t.eq(guardTransportCalls, 0, 'TEST_WRITE 禁项未触达 transport');
      await client.call('order.create', {});
      t.eq(guardTransportCalls, 1, 'TEST_WRITE 普通业务写放行并触达 transport');
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

  // ---------------------------------------------------------------- §2.13 服务端签发（fake DB 端到端）
  h.section('§2.13 admin.viewAsStart 签发（targetId 口径/双保险/单活票据/幂等）', async (t) => {
    const db = fake.createFakeDb({ uniqueIndexes: SWITCH_UNIQUE });
    seedSwitchBase(db);

    const first = await viewAsStart(switchCtx(db, { clientRequestId: requestKeyOf(1) }), {
      role: cloudEnums.ROLES.CUSTOMER, targetNo: 'CABCDEFGH', mode: cloudEnums.VIEW_MODE.READONLY
    });
    t.eq(first.viewMode, cloudEnums.VIEW_MODE.READONLY, '顾客 READONLY：返回 viewMode=READONLY');
    t.eq(first.targetNo, 'CABCDEFGH', '顾客 READONLY：返回 canonical 编号（展示层再分组）');
    t.eq(first.targetIsTest, false, '顾客 READONLY：targetIsTest=false');
    const firstDoc = sessionDocOf(db, first.viewTicket);
    t.eq(firstDoc && firstDoc.targetId, 'openid-real-c', '顾客 READONLY：targetId=顾客 openid（主键）');
    t.eq(firstDoc && firstDoc.adminOpenid, ADMIN_OPENID, '会话落发起人 openid（每次请求校验归属）');
    t.eq(firstDoc && firstDoc.developerNo, 'DEV-01', '会话落 developerNo（impersonatedBy 来源）');
    t.eq(firstDoc ? Number(firstDoc.expiresAt) - new Date(firstDoc.createdAt).getTime() : 0,
      30 * 60 * 1000, '票据默认 TTL=30 分钟（config 未落库走默认值）');

    const partner = await viewAsStart(switchCtx(db, { clientRequestId: requestKeyOf(2) }), {
      role: cloudEnums.ROLES.PARTNER, targetNo: 'PABC23D', mode: cloudEnums.VIEW_MODE.READONLY
    });
    const partnerDoc = sessionDocOf(db, partner.viewTicket);
    t.eq(partnerDoc && partnerDoc.targetId, 'partner-real-1', '兼职 READONLY：targetId=partners._id（不是 openid）');
    t.check(sessionDocOf(db, first.viewTicket).endedAt !== null, '新开覆盖旧票：旧票 endedAt 已写（同一开发者单活）');
    const replacedAudits = db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_END);
    t.eq(replacedAudits.length, 1, '覆盖旧票记 1 条 ACCOUNT_SWITCH_END');
    t.eq(replacedAudits[0] && replacedAudits[0].detail && replacedAudits[0].detail.reason, 'REPLACED',
      '覆盖旧票结束原因=REPLACED');
    t.eq(db.dump('admin_view_sessions').filter((row) => row.endedAt === null).length, 1, '有效票据始终 ≤1（单活）');

    const partnerState = switchState(switchCtx(db), 'partner.listBindings', {}, { viewTicket: partner.viewTicket });
    await switchSession.middleware(partnerState);
    t.eq(partnerState.ctx.identity.effectiveOpenid, 'openid-real-p',
      '兼职 READONLY 票据按 partners._id 解析出 partners.openid');

    const replay = await viewAsStart(switchCtx(db, { clientRequestId: requestKeyOf(2) }), {
      role: cloudEnums.ROLES.PARTNER, targetNo: 'PABC23D', mode: cloudEnums.VIEW_MODE.READONLY
    });
    t.eq(replay.duplicated, true, '同一 clientRequestId 重复开启：duplicated=true');
    t.eq(replay.viewTicket, partner.viewTicket, '同一 clientRequestId 重复开启：票据不变（幂等）');
    t.eq(db.dump('admin_view_sessions').filter((row) => row.endedAt === null).length, 1, '重复开启不产生第二张有效票据');

    const testWrite = await viewAsStart(switchCtx(db, { clientRequestId: requestKeyOf(3) }), {
      role: cloudEnums.ROLES.PARTNER, targetNo: 'PTEST23', mode: cloudEnums.VIEW_MODE.TEST_WRITE
    });
    const testDoc = sessionDocOf(db, testWrite.viewTicket);
    t.eq(testDoc && testDoc.targetId, TEST_PARTNER_OPENID, '测试兼职 TEST_WRITE：targetId=合成 openid（users._id=partners.openid）');
    t.eq(testDoc && testDoc.targetIsTest, true, '测试兼职 TEST_WRITE：targetIsTest=true');
    const testState = switchState(switchCtx(db), 'order.create', {}, { viewTicket: testWrite.viewTicket });
    await switchSession.middleware(testState);
    t.eq(testState.ctx.identity.effectiveOpenid, TEST_PARTNER_OPENID,
      'TEST_WRITE 票据：effectiveOpenid 必须等于 targetId（防票据挪用交叉校验）');

    const realTarget = await switchResult(() => viewAsStart(switchCtx(db, { clientRequestId: requestKeyOf(4) }), {
      role: cloudEnums.ROLES.PARTNER, targetNo: 'PABC23D', mode: cloudEnums.VIEW_MODE.TEST_WRITE
    }));
    t.eq(realTarget.code, 'FORBIDDEN', '真实账号传 TEST_WRITE → FORBIDDEN（服务端判定，前端隐藏不算）');
    const testTarget = await switchResult(() => viewAsStart(switchCtx(db, { clientRequestId: requestKeyOf(5) }), {
      role: cloudEnums.ROLES.PARTNER, targetNo: 'PTEST23', mode: cloudEnums.VIEW_MODE.READONLY
    }));
    t.eq(testTarget.code, 'NOT_FOUND', '测试账号传 READONLY → NOT_FOUND（两种模式互斥）');
    const wrongPrefix = await switchResult(() => viewAsStart(switchCtx(db, { clientRequestId: requestKeyOf(6) }), {
      role: cloudEnums.ROLES.CUSTOMER, targetNo: 'PABC23D', mode: cloudEnums.VIEW_MODE.READONLY
    }));
    t.eq(wrongPrefix.code, 'VALIDATION_FAILED', '角色与编号前缀不符 → VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------- §4.8.2 每请求校验（fake DB 端到端）
  h.section('§4.8.2 switch-session 每请求校验与身份传播（READONLY/TEST_WRITE）', async (t) => {
    const db = fake.createFakeDb({ uniqueIndexes: SWITCH_UNIQUE });
    seedSwitchBase(db);
    db.seed('admin_view_sessions', [
      switchSessionRow('TK-RO', cloudEnums.VIEW_MODE.READONLY, cloudEnums.ROLES.CUSTOMER, 'openid-real-c', 'CABCDEFGH', false),
      switchSessionRow('TK-RO-P', cloudEnums.VIEW_MODE.READONLY, cloudEnums.ROLES.PARTNER, 'partner-real-1', 'PABC23D', false),
      switchSessionRow('TK-TW', cloudEnums.VIEW_MODE.TEST_WRITE, cloudEnums.ROLES.PARTNER, TEST_PARTNER_OPENID, 'PTEST23', true),
      switchSessionRow('TK-EXPIRED', cloudEnums.VIEW_MODE.READONLY, cloudEnums.ROLES.CUSTOMER, 'openid-real-c', 'CABCDEFGH', false, SWITCH_NOW - 1000),
      switchSessionRow('TK-TAMPER', cloudEnums.VIEW_MODE.TEST_WRITE, cloudEnums.ROLES.CUSTOMER, 'openid-real-c', 'CABCDEFGH', true),
      switchSessionRow('TK-BADMODE', 'READWRITE', cloudEnums.ROLES.CUSTOMER, 'openid-real-c', 'CABCDEFGH', false),
      Object.assign(switchSessionRow('TK-OTHER', cloudEnums.VIEW_MODE.READONLY, cloudEnums.ROLES.CUSTOMER, 'openid-real-c', 'CABCDEFGH', false), { adminOpenid: 'other-admin', developerNo: 'DEV-02' })
    ]);

    const readState = switchState(switchCtx(db), 'order.listCustomer', {}, { viewTicket: 'TK-RO' });
    await switchSession.middleware(readState);
    t.eq(readState.ctx.identity.actorOpenid, ADMIN_OPENID, 'READONLY：actorOpenid=开发者真实 openid（审计用）');
    t.eq(readState.ctx.identity.effectiveOpenid, 'openid-real-c', 'READONLY：effectiveOpenid=目标真实 openid');
    t.eq(readState.ctx.identity.viewMode, cloudEnums.VIEW_MODE.READONLY, 'READONLY：viewMode 透传（黄条数据源）');
    t.eq(readState.ctx.identity.isTestAccount, false, 'READONLY：isTestAccount=false');

    const roWrite = await switchResult(() => switchSession.middleware(switchState(switchCtx(db), 'order.accept', {}, { viewTicket: 'TK-RO' })));
    t.eq(roWrite.code, 'FORBIDDEN', 'READONLY：写动作一律 FORBIDDEN（服务端双保险）');
    const roRead = await switchResult(() => switchSession.middleware(switchState(switchCtx(db), 'order.get', {}, { viewTicket: 'TK-RO' })));
    t.check(roRead.ok, 'READONLY：读白名单动作放行（order.get）');
    const roOutside = await switchResult(() => switchSession.middleware(switchState(switchCtx(db), 'partner.getPublic', {}, { viewTicket: 'TK-RO' })));
    t.eq(roOutside.code, 'FORBIDDEN', 'READONLY：读白名单外动作 FORBIDDEN');

    const roPartnerState = switchState(switchCtx(db), 'partner.listBindings', {}, { viewTicket: 'TK-RO-P' });
    await switchSession.middleware(roPartnerState);
    t.eq(roPartnerState.ctx.identity.effectiveOpenid, 'openid-real-p', 'READONLY 兼职目标：effectiveOpenid=partners.openid');

    const twState = switchState(switchCtx(db), 'order.create', {}, { viewTicket: 'TK-TW' });
    await switchSession.middleware(twState);
    t.eq(twState.ctx.identity.effectiveOpenid, TEST_PARTNER_OPENID, 'TEST_WRITE：effectiveOpenid=目标合成 openid');
    t.eq(twState.ctx.identity.viewMode, cloudEnums.VIEW_MODE.TEST_WRITE, 'TEST_WRITE：viewMode 透传（蓝条+TEST 角标数据源）');
    t.eq(twState.ctx.identity.isTestAccount, true, 'TEST_WRITE：isTestAccount=true');
    const twUser = db.dump('users').filter((row) => row._id === TEST_PARTNER_OPENID)[0];
    t.eq(twUser && twUser.testLastUsedAt, SWITCH_NOW, 'TEST_WRITE 写请求：更新 testLastUsedAt（30 天清理依据）');

    const blockedCodes = [];
    ['admin.stats', 'partner.activate', 'user.deleteAccount', 'ai.parseParcel'].forEach((action) => {
      blockedCodes.push(action);
    });
    for (let i = 0; i < blockedCodes.length; i += 1) {
      blockedCodes[i] = (await switchResult(() => switchSession.middleware(
        switchState(switchCtx(db), blockedCodes[i], {}, { viewTicket: 'TK-TW' })
      ))).code;
    }
    t.eq(blockedCodes, ['FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN'],
      'TEST_WRITE 禁四项：admin.* / partner.activate / user.deleteAccount / ai.parseParcel');

    const otherTicket = await switchResult(() => switchSession.middleware(switchState(switchCtx(db), 'order.listCustomer', {}, { viewTicket: 'TK-OTHER' })));
    t.eq(otherTicket.code, 'FORBIDDEN', '跨人票据 → FORBIDDEN（不泄露存在性）');
    const missing = await switchResult(() => switchSession.middleware(switchState(switchCtx(db), 'order.listCustomer', {}, { viewTicket: 'TK-NONE' })));
    t.eq(missing.code, 'FORBIDDEN', '不存在的票据 → FORBIDDEN');
    const expired = await switchResult(() => switchSession.middleware(switchState(switchCtx(db), 'order.listCustomer', {}, { viewTicket: 'TK-EXPIRED' })));
    t.eq(expired.code, 'VIEW_TICKET_EXPIRED', '过期票据 → VIEW_TICKET_EXPIRED');
    t.check(sessionDocOf(db, 'TK-EXPIRED').endedAt !== null, '过期票据补写 endedAt（不再可用）');
    t.eq(db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED).length, 1,
      '过期票据写 1 条 ACCOUNT_SWITCH_EXPIRED（每票至多一条）');
    const tamper = await switchResult(() => switchSession.middleware(switchState(switchCtx(db), 'order.accept', {}, { viewTicket: 'TK-TAMPER' })));
    t.check(!tamper.ok && ['FORBIDDEN', 'NOT_FOUND'].indexOf(tamper.code) >= 0,
      '伪造 targetIsTest（会话标测试但目标真实）→ 拒绝');
    const badMode = await switchResult(() => switchSession.middleware(switchState(switchCtx(db), 'order.listCustomer', {}, { viewTicket: 'TK-BADMODE' })));
    t.eq(badMode.code, 'FORBIDDEN', '会话 viewMode 非法（篡改模式）→ 拒绝');
  });

  // ---------------------------------------------------------------- §4.8.3 退出会话（fake DB 端到端）
  h.section('§4.8.3 退出会话 admin.viewAsEnd（包络票据注入/END 审计/幂等）', async (t) => {
    const db = fake.createFakeDb({ uniqueIndexes: SWITCH_UNIQUE });
    seedSwitchBase(db);
    const exitTicket = 'E'.repeat(enums.TOKEN_LENGTH);
    const otherExitTicket = 'O'.repeat(enums.TOKEN_LENGTH);
    db.seed('admin_view_sessions', [
      switchSessionRow(exitTicket, cloudEnums.VIEW_MODE.READONLY, cloudEnums.ROLES.CUSTOMER, 'openid-real-c', 'CABCDEFGH', false)
    ]);
    const exitState = switchState(switchCtx(db), 'admin.viewAsEnd', {}, { viewTicket: exitTicket, hasViewTicket: true });
    await switchSession.middleware(exitState);
    t.eq(exitState.payload.viewTicket, exitTicket, '退出会话：中间件把包络票据补进 payload（客户端 data 不带票据）');
    t.eq(exitState.ctx.identity.viewMode, cloudEnums.VIEW_MODE.READONLY, '退出会话：身份仍保留 viewMode（审计/会话归属）');
    const ended = await viewAsEnd(exitState.ctx, exitState.payload);
    t.check(ended && (typeof ended.endedAt === 'number' || ended.endedAt instanceof Date), 'viewAsEnd 返回 endedAt（幂等接口形状）');
    t.check(sessionDocOf(db, exitTicket).endedAt !== null, '退出会话：票据 endedAt 已写');
    const endAudits = db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_END);
    t.eq(endAudits.length, 1, '退出会话：写 1 条 ACCOUNT_SWITCH_END');
    t.eq(endAudits[0] && endAudits[0].detail && endAudits[0].detail.reason, 'EXIT', '退出会话：结束原因=EXIT');
    const again = await viewAsEnd(switchCtx(db), { viewTicket: exitTicket });
    t.eq(again.duplicated, true, '重复结束：幂等返回 duplicated=true');
    t.eq(db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_END).length, 1,
      '重复结束不重复写审计');
    db.seed('admin_view_sessions', [
      Object.assign(switchSessionRow(otherExitTicket, cloudEnums.VIEW_MODE.READONLY, cloudEnums.ROLES.CUSTOMER, 'openid-real-c', 'CABCDEFGH', false), { adminOpenid: 'other-admin', developerNo: 'DEV-02' })
    ]);
    const foreign = await switchResult(() => viewAsEnd(switchCtx(db), { viewTicket: otherExitTicket }));
    t.eq(foreign.code, 'FORBIDDEN', '非本人票据结束 → FORBIDDEN（不泄露存在性）');
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



