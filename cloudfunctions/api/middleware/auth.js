// middleware/auth.js · 身份基础层（OPENID → users 懒建 → 状态/开发者白名单；配 maintenance/隐私闸）
const { COLLECTIONS } = require('../db/collections');
const { ROLES, USER_STATUS, CANCELLED_BY } = require('../shared/enums');
const errors = require('../lib/errors');

// 开发者可按 ADMIN 业务身份执行的客户端动作（ARCHITECTURE §4.3「identity.role 按动作域解析」）。
// CONTRACT §1.1 第 4 条：开发者对订单的唯一写动作 = 异常介入取消（order.cancel）；其余业务写不得以 ADMIN 身份执行，
// 后台读数据一律走 admin.* 脱敏接口（不走 order.get/message.list 等业务读，避免绕过后台 DTO 脱敏）。
const ADMIN_BUSINESS_ACTIONS = Object.freeze(['order.cancel']);

// 双角色（users.roles 同时含 CUSTOMER+PARTNER）的「动作域角色」表：只登记恰好需要某一个业务角色的动作。
// ARCHITECTURE §4.1 冻结口径：服务端权限判定只看「users.roles 是否包含该动作所需业务角色」，不依赖客户端 activeRole，
// 同一 openid 双角色时两类动作都允许；identity.role 按动作域解析，解析不出所需角色 → 各 handler 的既有守卫拒绝。
// 双角色都可执行的动作（order.get/create/cancel、message.*、user.*、upload.*、partner.getPublic、
// partner.activate、config.getPublic 等）不登记：identity.role 留空（歧义动作不做单角色归一），
// 由 handler 用 identity.roles 成员制判定（订单归属/入参选择哪一侧）。
const ACTION_REQUIRED_ROLES = Object.freeze({
  // 顾客域
  'customer.saveProfile': ROLES.CUSTOMER,
  'customer.getProfile': ROLES.CUSTOMER,
  'bind.create': ROLES.CUSTOMER,
  'bind.release': ROLES.CUSTOMER,
  'bind.getCurrent': ROLES.CUSTOMER,
  'bind.claimGuestOrder': ROLES.CUSTOMER,
  'order.listCustomer': ROLES.CUSTOMER,
  'order.confirmDelivery': ROLES.CUSTOMER,
  'order.deleteRecord': ROLES.CUSTOMER,
  // 兼职域
  'partner.saveProfile': ROLES.PARTNER,
  'partner.saveServiceConfig': ROLES.PARTNER,
  'partner.listBindings': ROLES.PARTNER,
  'partner.getCustomer': ROLES.PARTNER,
  'partner.stats': ROLES.PARTNER,
  'partner.unbindCustomer': ROLES.PARTNER,
  'partner.saveCustomerNote': ROLES.PARTNER,
  'order.listPartner': ROLES.PARTNER,
  'order.accept': ROLES.PARTNER,
  'order.reject': ROLES.PARTNER,
  'order.markPicked': ROLES.PARTNER,
  'order.unmarkPicked': ROLES.PARTNER,
  'order.markDelivered': ROLES.PARTNER,
  'order.unmarkDelivered': ROLES.PARTNER,
  'order.reportException': ROLES.PARTNER,
  'order.resolveException': ROLES.PARTNER,
  'order.correct': ROLES.PARTNER,
  'order.undo': ROLES.PARTNER
});

// 声明式业务角色（目前只有 ai.parseParcel 的入参 role）：仅用于双角色歧义动作选定本次动作域角色，
// 不构成权限授予——调用方仍须 users.roles 已包含该角色（否则保持空角色，由 handler 校验拒绝）。
function declaredRoleOf(action, payload) {
  if (action !== 'ai.parseParcel') {
    return '';
  }
  const role = payload && typeof payload === 'object' && typeof payload.role === 'string'
    ? payload.role.trim().toUpperCase()
    : '';
  return role === ROLES.CUSTOMER || role === ROLES.PARTNER ? role : '';
}

// ADMIN_OPENIDS 只从环境变量读（每次请求重查，不缓存）；缺失/空/解析失败 ⇒ admin 通道关闭。
function resolveDeveloperNo(env, openid) {
  if (!env || !openid) {
    return '';
  }
  const raw = env.ADMIN_OPENIDS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return '';
  }
  try {
    const mapping = JSON.parse(raw);
    if (mapping && typeof mapping === 'object' && typeof mapping[openid] === 'string') {
      return mapping[openid];
    }
  } catch (error) {
    console.warn('[api] ADMIN_OPENIDS 不是合法 JSON，开发者通道已关闭');
  }
  return '';
}

async function ensureUser(ctx) {
  const existing = await ctx.dao.get(COLLECTIONS.USERS, ctx.openid);
  if (existing) {
    return existing;
  }
  const now = ctx.now;
  const doc = {
    _id: ctx.openid,
    roles: [],
    status: USER_STATUS.ACTIVE,
    isTestAccount: false,
    createdByDeveloperNo: '',
    testLastUsedAt: 0,
    messageReadAt: 0,
    privacyConsent: null,
    deletionRequestedAt: 0,
    createdAt: now,
    updatedAt: now
  };
  try {
    await ctx.dao.add(COLLECTIONS.USERS, doc);
    return doc;
  } catch (error) {
    if (ctx.dao.isDuplicateError(error)) {
      const raced = await ctx.dao.get(COLLECTIONS.USERS, ctx.openid);
      if (raced) {
        return raced;
      }
    }
    throw error;
  }
}

function resolveRole(user) {
  const roles = user && Array.isArray(user.roles) ? user.roles : [];
  if (roles.length !== 1) {
    return '';
  }
  if (roles[0] === ROLES.CUSTOMER || roles[0] === ROLES.PARTNER) {
    return roles[0];
  }
  return '';
}

// users.roles 归一为业务角色集（CUSTOMER/PARTNER，顺序固定、去重）：双角色场景成员制判定的唯一依据。
function businessRolesOf(user) {
  const raw = user && Array.isArray(user.roles) ? user.roles : [];
  const roles = [];
  if (raw.indexOf(ROLES.CUSTOMER) >= 0) {
    roles.push(ROLES.CUSTOMER);
  }
  if (raw.indexOf(ROLES.PARTNER) >= 0) {
    roles.push(ROLES.PARTNER);
  }
  return roles;
}

// identity.role 按动作域解析：
//  · 单角色：保持原语义（users.roles 恰好一个合法业务角色 → 该角色，否则空角色）；
//  · 双角色：动作在 ACTION_REQUIRED_ROLES 内 → 解析为所需角色（users.roles 必含）；不在表内 → 空角色
//    （歧义动作不归一），但 ai.parseParcel 允许按入参 role 选定（仍须 users.roles 已含该角色）；
//  · 其余形状（0 个/异常数据）：保持原「空角色」语义，不放大权限。
function resolveRoleForAction(user, action, payload) {
  const raw = user && Array.isArray(user.roles) ? user.roles : [];
  if (raw.length === 1) {
    return resolveRole(user);
  }
  if (raw.length !== 2) {
    return '';
  }
  const roles = businessRolesOf(user);
  if (roles.length !== 2) {
    return '';
  }
  const required = ACTION_REQUIRED_ROLES[action] || '';
  if (required) {
    return roles.indexOf(required) >= 0 ? required : '';
  }
  const declared = declaredRoleOf(action, payload);
  return declared && roles.indexOf(declared) >= 0 ? declared : '';
}

function isAdminAction(action) {
  return typeof action === 'string' && action.indexOf('admin.') === 0;
}

// 维护模式/隐私同意闸只在 config 种子已落库后生效（批 1 空库冷启动不阻塞 health/bootstrap）。
function assertRuntimeGates(state, user) {
  const spec = state.meta.spec || {};
  const config = state.ctx.config || {};
  const seeded = state.meta.configSeeded === true;
  const adminCaller = !!state.ctx.identity.developerNo;
  // 维护模式：客户端写接口拒绝（ENGINEERING §4.7 / UX_DEVELOPER §7.5「写接口拒绝；读与切换会话不受影响」），
  // 读动作放行——否则 user.bootstrap/config.getPublic 失败，端侧拿不到 configPublic.maintenance，全屏公告无法展示。
  // admin（developerNo）与 internal/cleanup 例外不变（后台可用）。
  if (seeded && config.maintenance && config.maintenance.enabled
    && spec.visibility === 'client' && spec.write && !adminCaller) {
    throw errors.invalidState('系统维护中，请稍后再试');
  }
  if (!seeded || spec.visibility !== 'client' || !spec.write || state.action === 'user.acceptPrivacy') {
    return;
  }
  // TD-046：开发者 openid 不是顾客/兼职业务身份（CONTRACT §1.1「开发者账号不是顾客/兼职业务身份」），
  // 其 users.privacyConsent 恒为空，照本人 consent 判定会让「后台异常介入取消」（order.cancel ADMIN）与
  // 「测试账号可写」（TEST_WRITE 写动作，身份在 switch-session 才解析为 effectiveOpenid）永远不可达。
  // 开发者写动作自带白名单闸（admin 动作在 middleware 校验 developerNo，TEST_WRITE 在 switch-session 校验票据+目标），
  // 故隐私闸对 developerNo 豁免；真实顾客/兼职仍严格按本人 consent 判定。
  if (adminCaller) {
    return;
  }
  const consent = user && user.privacyConsent;
  if (!consent || consent.version !== config.privacyVersion) {
    throw errors.invalidState('请先同意最新隐私保护指引');
  }
}

async function middleware(state) {
  const ctx = state.ctx;
  if (!ctx.openid) {
    throw errors.forbidden('请先登录后再操作');
  }
  const user = await ensureUser(ctx);
  state.meta.actorUser = user;
  if (user.status && user.status === USER_STATUS.DEACTIVATED && state.action !== 'user.bootstrap') {
    throw errors.forbidden('账号已停用，请联系开发者');
  }
  ctx.identity.developerNo = resolveDeveloperNo(ctx.env, ctx.openid);
  // users.roles 归一（双角色成员制判定的依据）；identity.role 按动作域解析（ARCHITECTURE §4.1 双角色口径）。
  ctx.identity.roles = businessRolesOf(user);
  ctx.identity.role = resolveRoleForAction(user, state.action, state.payload);
  // 开发者无业务角色时，仅 ADMIN_BUSINESS_ACTIONS 按 ADMIN 解析（否则保持空角色 → 各 handler 按业务角色守卫拒绝）。
  // 供 order 域 orderSideOf 识别「后台介入」分支（CONTRACT §5.1 order.cancel：admin 仅异常介入 + 审计）。
  if (!ctx.identity.role && ctx.identity.developerNo && ADMIN_BUSINESS_ACTIONS.indexOf(state.action) >= 0) {
    ctx.identity.role = CANCELLED_BY.ADMIN;
  }
  const spec = state.meta.spec || {};
  if (spec.visibility === 'internal' && !ctx.identity.developerNo) {
    throw errors.forbidden('该操作仅部署者或开发者可执行');
  }
  if (isAdminAction(state.action) && !ctx.identity.developerNo) {
    throw errors.forbidden('当前身份无权使用开发者后台');
  }
  assertRuntimeGates(state, user);
  return state;
}

module.exports = {
  middleware,
  ensureUser,
  resolveDeveloperNo,
  resolveRole,
  resolveRoleForAction,
  businessRolesOf,
  declaredRoleOf,
  isAdminAction,
  ADMIN_BUSINESS_ACTIONS,
  ACTION_REQUIRED_ROLES
};
