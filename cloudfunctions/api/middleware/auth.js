// middleware/auth.js · 身份基础层（OPENID → users 懒建 → 状态/开发者白名单；配 maintenance/隐私闸）
const { COLLECTIONS } = require('../db/collections');
const { ROLES, USER_STATUS } = require('../shared/enums');
const errors = require('../lib/errors');

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

function isAdminAction(action) {
  return typeof action === 'string' && action.indexOf('admin.') === 0;
}

// 维护模式/隐私同意闸只在 config 种子已落库后生效（批 1 空库冷启动不阻塞 health/bootstrap）。
function assertRuntimeGates(state, user) {
  const spec = state.meta.spec || {};
  const config = state.ctx.config || {};
  const seeded = state.meta.configSeeded === true;
  const adminCaller = !!state.ctx.identity.developerNo;
  if (seeded && config.maintenance && config.maintenance.enabled && spec.visibility === 'client' && !adminCaller) {
    throw errors.invalidState('系统维护中，请稍后再试');
  }
  if (!seeded || spec.visibility !== 'client' || !spec.write || state.action === 'user.acceptPrivacy') {
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
  ctx.identity.role = resolveRole(user);
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
  isAdminAction
};
