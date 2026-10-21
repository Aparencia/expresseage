// handlers/user/_common.js · 身份域公共件（user/customer/partner/bind 四个域共用）
// 口径：ARCHITECTURE §4.1（handler 签名/ctx.identity）、DATA_MODEL §2.1/§6.1/§7.3/§7.7；
//       CONTRACT v0.9 §1.3（actorOpenid vs effectiveOpenid）。
// 纪律：handler 只读 ctx.identity，不自行解析票据、不写"if 视角"业务分支。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const role = require('../../shared/role');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');

function nowMs(ctx) {
  const value = ctx ? ctx.now : null;
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return Date.now();
}

function nowDate(ctx) {
  return new Date(nowMs(ctx));
}

// 业务身份：真实会话=本人 openid；切换会话=中间件解析出的 effectiveOpenid（目标本人/测试账号合成 openid）
function scopeOf(ctx) {
  const identity = (ctx && ctx.identity) || {};
  const effective = identity.effectiveOpenid || (ctx && ctx.openid) || '';
  const actor = identity.actorOpenid || (ctx && ctx.openid) || '';
  return {
    role: identity.role || '',
    openid: effective,
    actorOpenid: actor,
    developerNo: identity.developerNo || '',
    viewMode: identity.viewMode || '',
    viewTicketId: identity.viewTicketId || '',
    isTestAccount: identity.isTestAccount === true,
    readOnly: identity.viewMode === enums.VIEW_MODE.READONLY,
    testWrite: identity.viewMode === enums.VIEW_MODE.TEST_WRITE,
    impersonatedBy: identity.viewMode === enums.VIEW_MODE.TEST_WRITE ? (identity.developerNo || '') : ''
  };
}

function assertWritable(ctx) {
  if (scopeOf(ctx).readOnly) {
    throw errors.forbidden('开发者只读视角不能操作');
  }
}

function loadUser(ctx, openid) {
  if (!openid) {
    return Promise.resolve(null);
  }
  return ctx.dao.get(COLLECTIONS.USERS, openid);
}

function loadCustomer(ctx, openid) {
  if (!openid) {
    return Promise.resolve(null);
  }
  return ctx.dao.get(COLLECTIONS.CUSTOMERS, openid);
}

function loadPartnerByOpenid(ctx, openid) {
  if (!openid) {
    return Promise.resolve(null);
  }
  return ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { openid } });
}

function loadPartnerById(ctx, partnerId) {
  if (!partnerId) {
    return Promise.resolve(null);
  }
  return ctx.dao.get(COLLECTIONS.PARTNERS, partnerId);
}

function getActiveBinding(ctx, customerId) {
  if (!customerId) {
    return Promise.resolve(null);
  }
  return ctx.dao.findOne(COLLECTIONS.BINDINGS, {
    where: { customerId, status: enums.BINDING_STATUS.ACTIVE }
  });
}

// 业务角色守卫：真实会话按 users.roles 判定（同一 openid 可同时是顾客与兼职）；
// 切换会话按票据解析出的 role 判定。PARTNER 调顾客动作、或反之 → FORBIDDEN。
async function assertBusinessRole(ctx, wanted) {
  const scope = scopeOf(ctx);
  if (scope.role === wanted) {
    return scope;
  }
  if (scope.role && scope.role !== wanted) {
    throw errors.forbidden('当前身份不能执行该操作');
  }
  const user = await loadUser(ctx, scope.openid);
  const roles = user && Array.isArray(user.roles) ? user.roles : [];
  if (roles.indexOf(wanted) < 0) {
    throw errors.forbidden(wanted === enums.ROLES.CUSTOMER ? '请先完善顾客资料' : '请先激活兼职身份');
  }
  return scope;
}

async function requireCustomerProfile(ctx) {
  const scope = await assertBusinessRole(ctx, enums.ROLES.CUSTOMER);
  const customer = await loadCustomer(ctx, scope.openid);
  if (!customer) {
    throw errors.invalidState('请先完善顾客资料');
  }
  return { scope, customer };
}

async function requireActivePartner(ctx) {
  const scope = await assertBusinessRole(ctx, enums.ROLES.PARTNER);
  let partner = await loadPartnerByOpenid(ctx, scope.openid);
  if (!partner && scope.role === enums.ROLES.PARTNER) {
    partner = await loadPartnerById(ctx, scope.openid);
  }
  if (!partner) {
    throw errors.forbidden('请先激活兼职身份');
  }
  if (partner.deletedAt || partner.status === enums.PARTNER_STATUS.CLOSED) {
    throw errors.partnerClosed('兼职已注销，无法操作');
  }
  if (partner.status === enums.PARTNER_STATUS.SUSPENDED) {
    throw errors.partnerClosed('兼职已停用，无法操作');
  }
  return { scope, partner };
}

// "有进行中订单"守卫（换宿舍/解绑/注销共用；status 只有等值查询能力，逐状态各取一条）
async function hasActiveOrder(ctx, customerId, partnerOpenid) {
  const where = {};
  if (customerId) {
    where.customerId = customerId;
  }
  if (partnerOpenid) {
    where.partnerOpenid = partnerOpenid;
  }
  for (let i = 0; i < enums.ORDER_ACTIVE_STATUSES.length; i += 1) {
    const status = enums.ORDER_ACTIVE_STATUSES[i];
    const row = await ctx.dao.findOne(COLLECTIONS.ORDERS, {
      where: Object.assign({}, where, { status }),
      limit: 1
    });
    if (row) {
      return row;
    }
  }
  return null;
}

// 切换会话上下文（user.bootstrap 用）：从票据文档取展示快照，不返回票据本身
async function loadViewSession(ctx) {
  const scope = scopeOf(ctx);
  if (!scope.viewMode || !scope.viewTicketId) {
    return null;
  }
  const session = await ctx.dao.get(COLLECTIONS.ADMIN_VIEW_SESSIONS, scope.viewTicketId);
  return session && !session.endedAt ? session : null;
}

function buildViewContext(session) {
  if (!session) {
    return null;
  }
  const view = {
    viewMode: session.viewMode,
    role: session.role,
    targetNo: session.targetNo || '',
    targetDisplayName: session.targetDisplayName || '',
    targetIsTest: session.isTestAccount === true || session.targetIsTest === true,
    expiresAt: time.toMs(session.expiresAt)
  };
  if (session.targetAvatarFileId) {
    view.targetAvatarFileId = session.targetAvatarFileId;
  }
  return view;
}

// 昵称/留言等内容安全闸：security.msgSecCheck v2（v0.9 要求昵称必检）
// 云函数运行环境必有 ctx.cloud；单元测试未注入 cloud 时放行并告警（测试桩不走平台外呼）。
async function assertTextSafe(ctx, content, field) {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) {
    throw errors.validation(field || 'text', '内容不能为空');
  }
  if (!ctx || !ctx.cloud) {
    console.warn('[api] 内容安全：ctx.cloud 未注入，跳过平台外呼（仅测试环境）');
    return;
  }
  const openapi = ctx.cloud.openapi;
  const security = openapi && openapi.security;
  if (!security || typeof security.msgSecCheck !== 'function') {
    throw errors.dependencyFailed('内容安全检查暂不可用，请稍后重试');
  }
  const scope = scopeOf(ctx);
  let result;
  try {
    result = await security.msgSecCheck({ openid: scope.openid, scene: 2, version: 2, content: text });
  } catch (error) {
    const message = String((error && (error.errMsg || error.message)) || '');
    if (/87014|risky|illegal/i.test(message)) {
      throw errors.validation(field || 'text', '内容包含不当信息，请修改后重试');
    }
    throw errors.dependencyFailed('内容安全检查暂不可用，请稍后重试');
  }
  const suggest = result && result.result ? result.result.suggest : '';
  if (suggest === 'risky') {
    throw errors.validation(field || 'text', '内容包含不当信息，请修改后重试');
  }
}

// 删除云存储文件（替换头像/注销/删除测试账号用）：失败只告警，不回滚业务写入
async function tryDeleteFile(ctx, fileId) {
  const target = typeof fileId === 'string' ? fileId : '';
  if (!target || !ctx || !ctx.cloud || typeof ctx.cloud.deleteFile !== 'function') {
    return false;
  }
  try {
    await ctx.cloud.deleteFile({ fileList: [target] });
    return true;
  } catch (error) {
    console.warn('[api] 云存储文件删除失败', ctx.requestId);
    return false;
  }
}

function isSameTestSide(a, b) {
  return (a === true) === (b === true);
}

function isActivePartnerDoc(partner) {
  return role.isPartnerActive(partner);
}

module.exports = {
  nowMs,
  nowDate,
  scopeOf,
  assertWritable,
  loadUser,
  loadCustomer,
  loadPartnerByOpenid,
  loadPartnerById,
  getActiveBinding,
  assertBusinessRole,
  requireCustomerProfile,
  requireActivePartner,
  hasActiveOrder,
  loadViewSession,
  buildViewContext,
  assertTextSafe,
  tryDeleteFile,
  isSameTestSide,
  isActivePartnerDoc
};
