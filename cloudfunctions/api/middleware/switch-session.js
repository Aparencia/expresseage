// middleware/switch-session.js · 开发者切换会话（READONLY 真实账号只读 / TEST_WRITE 测试账号可写）
// 口径：CONTRACT v0.9 §1.2/§1.3、ENGINEERING §4.8、ARCHITECTURE §4.1/§4.3。
// 身份传播：actorOpenid=开发者真实 openid（审计/白名单）；effectiveOpenid=业务身份（查询/写入归属）。
const { COLLECTIONS } = require('../db/collections');
const { ROLES, ROLE_LIST, USER_STATUS, VIEW_MODE, VIEW_MODE_LIST } = require('../shared/enums');
const { AUDIT_ACTIONS } = require('../shared/audit-actions');
const { isPartnerActive } = require('../shared/role');
const time = require('../lib/time');
const audit = require('./audit');
const errors = require('../lib/errors');

// 切换会话读白名单（两模式共用；其余读动作一律 FORBIDDEN）
const VIEW_READ_WHITELIST = Object.freeze([
  'user.bootstrap',
  'customer.getProfile',
  'partner.listBindings',
  'bind.getCurrent',
  'order.get',
  'order.listCustomer',
  'order.listPartner',
  'message.list',
  'order.imageUrl',
  'config.getPublic'
]);

// TEST_WRITE 白名单外禁止项（业务写动作仍只作用于目标测试账号）
const TEST_WRITE_BLOCKED_ACTIONS = Object.freeze([
  'partner.activate',
  'user.deleteAccount',
  'ai.parseParcel'
]);

// 退出会话动作：两种模式都必须放行（否则黄条/蓝条的「退出」永远失败）
const EXIT_ACTION = 'admin.viewAsEnd';

function isWhitelistedRead(action) {
  return VIEW_READ_WHITELIST.indexOf(action) >= 0;
}

function invalidTicket(message) {
  return errors.forbidden(message || '切换会话无效，请回到「切换账号」重新开启');
}

function targetNotFound() {
  return errors.notFound('该用户当前不可查看');
}

async function resolveReadonlyTarget(ctx, session) {
  const dao = ctx.dao;
  if (session.role === ROLES.CUSTOMER) {
    const customer = await dao.get(COLLECTIONS.CUSTOMERS, session.targetId);
    if (!customer) {
      throw targetNotFound();
    }
    const user = await dao.get(COLLECTIONS.USERS, session.targetId);
    if (!user || user.status !== USER_STATUS.ACTIVE || user.isTestAccount) {
      throw targetNotFound();
    }
    return { effectiveOpenid: session.targetId, isTestAccount: false };
  }
  if (session.role === ROLES.PARTNER) {
    const partner = await dao.get(COLLECTIONS.PARTNERS, session.targetId);
    if (!isPartnerActive(partner)) {
      throw targetNotFound();
    }
    const user = await dao.get(COLLECTIONS.USERS, partner.openid);
    if (!user || user.status !== USER_STATUS.ACTIVE || user.isTestAccount) {
      throw targetNotFound();
    }
    return { effectiveOpenid: partner.openid, isTestAccount: false };
  }
  throw invalidTicket('切换会话参数不完整，请重新开启');
}

async function resolveTestWriteTarget(ctx, session) {
  // TEST_WRITE 会话的 targetId 必须是合成 openid（users._id === customers._id === partners.openid）
  const user = await ctx.dao.get(COLLECTIONS.USERS, session.targetId);
  if (!user || user.status !== USER_STATUS.ACTIVE || user.isTestAccount !== true) {
    throw targetNotFound();
  }
  if (session.role === ROLES.PARTNER) {
    const partner = await ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { openid: session.targetId } });
    if (!isPartnerActive(partner)) {
      throw targetNotFound();
    }
  }
  return { effectiveOpenid: session.targetId, isTestAccount: true };
}

// 过期票据：补 endedAt（若空）+ 一次性 ACCOUNT_SWITCH_EXPIRED 审计（requestKey 幂等）。
async function markExpired(ctx, session, viewTicket) {
  if (!session.endedAt) {
    try {
      await ctx.dao.update(COLLECTIONS.ADMIN_VIEW_SESSIONS, viewTicket, {
        endedAt: session.expiresAt || ctx.now,
        updatedAt: ctx.now
      });
    } catch (error) {
      console.error('[api] 过期会话补写 endedAt 失败', ctx.requestId);
    }
  }
  await audit.writeOnce(ctx, {
    action: AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED,
    adminOpenid: session.adminOpenid || ctx.openid,
    developerNo: session.developerNo || ctx.identity.developerNo,
    target: { type: 'view_session', id: viewTicket },
    detail: { viewMode: session.viewMode || '', targetIsTest: !!session.targetIsTest, reason: 'EXPIRED' },
    requestKey: 'switch-expired:' + viewTicket
  });
}

function assertModeScope(state, mode, spec) {
  const action = state.action;
  if (mode === VIEW_MODE.READONLY) {
    if (spec.write) {
      throw errors.forbidden('开发者只读视角不能操作');
    }
    if (!isWhitelistedRead(action)) {
      throw errors.forbidden('开发者只读视角不能执行该操作');
    }
    return;
  }
  if (action === EXIT_ACTION) {
    return;
  }
  if (typeof action === 'string' && action.indexOf('admin.') === 0) {
    throw errors.forbidden('切换会话不能执行开发者后台动作');
  }
  if (TEST_WRITE_BLOCKED_ACTIONS.indexOf(action) >= 0) {
    throw errors.forbidden('测试会话不支持该操作');
  }
  if (!spec.write && !isWhitelistedRead(action)) {
    throw errors.forbidden('测试会话不支持该操作');
  }
}

async function middleware(state) {
  const ctx = state.ctx;
  const viewTicket = state.meta.viewTicket;
  if (!viewTicket) {
    return state;
  }
  const spec = state.meta.spec || {};
  const session = await ctx.dao.get(COLLECTIONS.ADMIN_VIEW_SESSIONS, viewTicket);
  if (!session || session.adminOpenid !== ctx.openid) {
    throw invalidTicket();
  }
  if (!ctx.identity.developerNo) {
    throw errors.forbidden('开发者身份已失效，请刷新后重试');
  }
  if (session.endedAt) {
    throw invalidTicket('切换会话已结束，请回到「切换账号」重新开启');
  }
  if (time.isPast(session.expiresAt, ctx.now)) {
    await markExpired(ctx, session, viewTicket);
    throw errors.viewTicketExpired('切换会话已过期，请回到「切换账号」重新开启');
  }
  if (VIEW_MODE_LIST.indexOf(session.viewMode) < 0 || ROLE_LIST.indexOf(session.role) < 0 || !session.targetId) {
    throw invalidTicket('切换会话参数不完整，请重新开启');
  }
  const target = session.viewMode === VIEW_MODE.READONLY
    ? await resolveReadonlyTarget(ctx, session)
    : await resolveTestWriteTarget(ctx, session);
  if (!!session.targetIsTest !== target.isTestAccount) {
    throw invalidTicket('切换会话状态不一致，请重新开启');
  }
  if (state.action !== EXIT_ACTION) {
    assertModeScope(state, session.viewMode, spec);
  }
  ctx.identity = {
    actorOpenid: ctx.openid,
    effectiveOpenid: target.effectiveOpenid,
    role: session.role,
    isTestAccount: target.isTestAccount,
    viewMode: session.viewMode,
    viewTicketId: viewTicket,
    developerNo: ctx.identity.developerNo
  };
  if (spec.write && session.viewMode === VIEW_MODE.TEST_WRITE) {
    try {
      await ctx.dao.update(COLLECTIONS.USERS, target.effectiveOpenid, { testLastUsedAt: ctx.now, updatedAt: ctx.now });
    } catch (error) {
      console.warn('[api] 测试账号最近使用时间更新失败', ctx.requestId);
    }
  }
  return state;
}

module.exports = {
  middleware,
  VIEW_READ_WHITELIST,
  TEST_WRITE_BLOCKED_ACTIONS,
  EXIT_ACTION,
  markExpired
};
