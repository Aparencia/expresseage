// handlers/user/bootstrap.js · user.bootstrap（启动唯一水合接口，平铺 DTO）
// 返回形状 = DATA_MODEL §7.1 平铺口径：{roles,status,privacyConsent,messageReadAt,customerProfileCompleted,
// customerNo?,displayName?,avatarFileId?,partnerStatus,partnerNo?,isDeveloper,viewContext,configPublic,serverTime}
// + 页面需要的 partner（含 serviceConfig）/customer/binding 子块；**永不返回 openid/_id/isTestAccount**。
// 切换会话（READONLY/TEST_WRITE）返回目标上下文且 isDeveloper=false，避免客户端再分流到后台。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const roleLib = require('../../shared/role');
const genderLib = require('../../shared/gender');
const time = require('../../lib/time');
const identity = require('./_common');
const configCommon = require('../config/_common');

function toMs(value) {
  return value === undefined || value === null ? 0 : time.toMs(value);
}

function buildCustomerBlock(customer, binding, avatarUrl) {
  if (!customer) {
    return null;
  }
  const block = {
    profileComplete: customer.profileCompleted === true,
    customerNo: customer.customerNo || '',
    displayName: customer.displayName || '',
    avatarFileId: customer.avatarFileId || '',
    zone: customer.zone || '',
    buildingNo: customer.buildingNo === undefined ? null : customer.buildingNo,
    room: customer.room || '',
    dormKey: customer.dormKey || '',
    phoneTail: customer.phoneTail || '',
    gender: genderLib.normalizeGender(customer.gender),
    genderManual: customer.genderManual === true,
    roomTag: binding ? binding.roomTag || '' : ''
  };
  // D42：本人头像 5 分钟临时 URL（私有存储不直读 cloud://）；签发失败不下发，客户端回退 avatarFileId/默认头像。
  if (avatarUrl) {
    block.avatarUrl = avatarUrl;
  }
  if (binding && binding.dormSnapshot) {
    block.buildingText = binding.dormSnapshot.buildingText || '';
  }
  return block;
}

function buildPartnerBlock(partner, avatarUrl) {
  if (!partner) {
    return null;
  }
  const serviceConfig = partner.serviceConfig || {};
  const block = {
    status: partner.status || '',
    profileComplete: typeof partner.displayName === 'string' && partner.displayName !== '',
    partnerNo: partner.partnerNo || '',
    displayName: partner.displayName || '',
    avatarFileId: partner.avatarFileId || '',
    acceptingOrders: serviceConfig.acceptingOrders === true,
    serviceConfig: {
      services: Array.isArray(serviceConfig.services) ? serviceConfig.services : [],
      zones: Array.isArray(serviceConfig.zones) ? serviceConfig.zones : [],
      acceptingOrders: serviceConfig.acceptingOrders === true
    }
  };
  if (avatarUrl) {
    block.avatarUrl = avatarUrl;
  }
  return block;
}

function buildBindingBlock(binding, partner, partnerAvatarUrl) {
  if (!binding || !partner) {
    return null;
  }
  const block = {
    bindingId: binding._id || '',
    partnerNo: partner.partnerNo || '',
    partnerDisplayName: partner.displayName || '',
    roomTag: binding.roomTag || '',
    dormKey: binding.dormSnapshot ? binding.dormSnapshot.dormKey || '' : '',
    status: binding.status || enums.BINDING_STATUS.ACTIVE
  };
  if (partner.avatarFileId) {
    block.partnerAvatarFileId = partner.avatarFileId;
    // D42：绑定对方头像临时 URL（仅当前 ACTIVE 绑定下发；解绑后 bootstrap.binding 为 null，URL 一并消失）
    if (partnerAvatarUrl) {
      block.partnerAvatarUrl = partnerAvatarUrl;
    }
  }
  return block;
}

// P0-4：会话/用户/顾客/兼职/绑定五读互不依赖 → 一次 Promise.all 并行（少 4 个串行 DB RTT）；
// boundPartner 依赖 binding 结果仍在之后取；任一读失败与旧实现同路径抛错（不新增降级分支）。
async function loadBootState(ctx, scope) {
  const [viewSession, user, customer, partner, binding] = await Promise.all([
    identity.loadViewSession(ctx),
    identity.loadUser(ctx, scope.openid),
    identity.loadCustomer(ctx, scope.openid),
    identity.loadPartnerByOpenid(ctx, scope.openid),
    identity.getActiveBinding(ctx, scope.openid)
  ]);
  // TD-053 回退：partners.openid 随 CLOSED 匿名化后，按 users.closedPartnerNo 找回 CLOSED 行，
  // partnerStatus/partnerNo/partner 块保持注销前口径（「已注销」而不是「从未激活」）。
  const closedState = partner ? null : await identity.loadClosedPartnerState(ctx, scope.openid, user);
  const effectivePartner = partner || (closedState && closedState.partner) || null;
  const boundPartner = binding && binding.partnerId ? await identity.loadPartnerById(ctx, binding.partnerId) : null;
  return {
    viewSession,
    user,
    customer,
    partner: effectivePartner,
    closedPartnerNo: identity.closedPartnerNoOf(user),
    binding,
    boundPartner
  };
}

// 角色解析（切换会话=票据角色；真实会话=users.roles，双角色兼职优先）并记一次 lastLoginAt（失败只告警）
async function resolveRoleState(ctx, scope, user, viewContext) {
  if (viewContext) {
    return { roles: scope.role ? [scope.role] : [], activeRole: scope.role || null, isDeveloper: false };
  }
  const rawRoles = user && Array.isArray(user.roles) ? user.roles : [];
  const roles = rawRoles.filter((item) => item === enums.ROLES.CUSTOMER || item === enums.ROLES.PARTNER);
  const nowDate = identity.nowDate(ctx);
  try {
    await ctx.dao.update(COLLECTIONS.USERS, scope.openid, { lastLoginAt: nowDate, updatedAt: nowDate });
  } catch (error) {
    console.warn('[api] 登录时间更新失败', ctx.requestId);
  }
  return { roles, activeRole: roleLib.pickActiveRole(roles), isDeveloper: !!scope.developerNo };
}

function avatarFileIdOf(doc) {
  return doc && typeof doc.avatarFileId === 'string' ? doc.avatarFileId : '';
}

// D42：一次批量签发 本人（顾客/兼职）与当前绑定对方头像的 5 分钟临时 URL（单次 getTempFileURL，无头像=零外呼）。
// 失败只降级为「不下发 URL」，不回退整个启动水合（页面回退 avatarFileId，读失败不阻断首屏）。
async function signBootAvatarUrls(ctx, customer, partner, boundPartner) {
  const ids = {
    customer: avatarFileIdOf(customer),
    partner: avatarFileIdOf(partner),
    boundPartner: avatarFileIdOf(boundPartner)
  };
  const urls = await identity.signAvatarUrls(ctx, [ids.customer, ids.partner, ids.boundPartner]);
  return {
    customer: urls[ids.customer] || '',
    partner: urls[ids.partner] || '',
    boundPartner: urls[ids.boundPartner] || ''
  };
}

async function handler(ctx) {
  const scope = identity.scopeOf(ctx);
  const nowMs = identity.nowMs(ctx);
  const state = await loadBootState(ctx, scope);
  const user = state.user;
  const customer = state.customer;
  const viewContext = identity.buildViewContext(state.viewSession);
  const roleState = await resolveRoleState(ctx, scope, user, viewContext);
  const avatarUrls = await signBootAvatarUrls(ctx, customer, state.partner, state.boundPartner);

  const customerBlock = buildCustomerBlock(customer, state.binding, avatarUrls.customer);
  const partnerBlock = buildPartnerBlock(state.partner, avatarUrls.partner);
  const bindingBlock = roleState.activeRole === enums.ROLES.CUSTOMER || !roleState.activeRole
    ? buildBindingBlock(state.binding, state.boundPartner, avatarUrls.boundPartner)
    : null;
  const meSource = roleState.activeRole === enums.ROLES.PARTNER ? (partnerBlock || {}) : (customerBlock || {});
  // TD-053：CLOSED 行已匿名化（partner 块可能为空）时，平铺 partnerStatus/partnerNo 仍按 users 标记口径保留
  const partnerStatus = state.partner
    ? state.partner.status || ''
    : (state.closedPartnerNo ? enums.PARTNER_STATUS.CLOSED : '');
  const partnerNo = state.partner ? state.partner.partnerNo || '' : state.closedPartnerNo;

  return {
    // DATA_MODEL §7.1 平铺 DTO
    roles: roleState.roles,
    status: user ? user.status || enums.USER_STATUS.ACTIVE : enums.USER_STATUS.ACTIVE,
    privacyConsent: user && user.privacyConsent
      ? { version: user.privacyConsent.version || '', at: toMs(user.privacyConsent.at) }
      : null,
    messageReadAt: user ? toMs(user.messageReadAt) : 0,
    customerProfileCompleted: !!(customer && customer.profileCompleted === true),
    customerNo: customer ? customer.customerNo || '' : '',
    displayName: meSource.displayName || '',
    avatarFileId: meSource.avatarFileId || '',
    // D42：当前使用角色（me）的头像临时 URL；无头像/签发失败为空串（客户端回退默认头像）
    avatarUrl: meSource.avatarUrl || '',
    partnerStatus: partnerStatus,
    partnerNo: partnerNo,
    isDeveloper: roleState.isDeveloper,
    viewContext,
    configPublic: await configCommon.loadPublicConfig(ctx),
    serverTime: nowMs,
    // 页面子块（嵌套不替代平铺字段）
    activeRole: roleState.activeRole,
    customer: customerBlock,
    partner: partnerBlock,
    binding: bindingBlock,
    badges: { workbenchPending: 0, messages: 0 }
  };
}

module.exports = { handler };
