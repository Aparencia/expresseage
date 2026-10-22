// handlers/user/bootstrap.js · user.bootstrap（启动唯一水合接口，平铺 DTO）
// 返回形状 = DATA_MODEL §7.1 平铺口径：{roles,status,privacyConsent,messageReadAt,customerProfileCompleted,
// customerNo?,displayName?,avatarFileId?,partnerStatus,partnerNo?,isDeveloper,viewContext,configPublic,serverTime}
// + 页面需要的 partner（含 serviceConfig）/customer/binding 子块；**永不返回 openid/_id/isTestAccount**。
// 切换会话（READONLY/TEST_WRITE）返回目标上下文且 isDeveloper=false，避免客户端再分流到后台。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const roleLib = require('../../shared/role');
const time = require('../../lib/time');
const identity = require('./_common');
const configCommon = require('../config/_common');

function toMs(value) {
  return value === undefined || value === null ? 0 : time.toMs(value);
}

function buildCustomerBlock(customer, binding) {
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
    roomTag: binding ? binding.roomTag || '' : ''
  };
  if (binding && binding.dormSnapshot) {
    block.buildingText = binding.dormSnapshot.buildingText || '';
  }
  return block;
}

function buildPartnerBlock(partner) {
  if (!partner) {
    return null;
  }
  const serviceConfig = partner.serviceConfig || {};
  return {
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
}

function buildBindingBlock(binding, partner) {
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
  }
  return block;
}

async function handler(ctx) {
  const scope = identity.scopeOf(ctx);
  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  // P0-4：会话/用户/顾客/兼职/绑定五读互不依赖 → 一次 Promise.all 并行（少 4 个串行 DB RTT）；
  // boundPartner 依赖 binding 结果仍在之后取；任一读失败与旧实现同路径抛错（不新增降级分支）。
  const [viewSession, user, customer, partner, binding] = await Promise.all([
    identity.loadViewSession(ctx),
    identity.loadUser(ctx, scope.openid),
    identity.loadCustomer(ctx, scope.openid),
    identity.loadPartnerByOpenid(ctx, scope.openid),
    identity.getActiveBinding(ctx, scope.openid)
  ]);
  const viewContext = identity.buildViewContext(viewSession);
  const isSwitchView = viewContext !== null;
  const boundPartner = binding && binding.partnerId ? await identity.loadPartnerById(ctx, binding.partnerId) : null;

  let roles = [];
  let activeRole = null;
  let isDeveloper = false;
  if (isSwitchView) {
    roles = scope.role ? [scope.role] : [];
    activeRole = scope.role || null;
  } else {
    const rawRoles = user && Array.isArray(user.roles) ? user.roles : [];
    roles = rawRoles.filter((item) => item === enums.ROLES.CUSTOMER || item === enums.ROLES.PARTNER);
    activeRole = roleLib.pickActiveRole(roles);
    isDeveloper = !!scope.developerNo;
    try {
      await ctx.dao.update(COLLECTIONS.USERS, scope.openid, { lastLoginAt: nowDate, updatedAt: nowDate });
    } catch (error) {
      console.warn('[api] 登录时间更新失败', ctx.requestId);
    }
  }

  const customerBlock = buildCustomerBlock(customer, binding);
  const partnerBlock = buildPartnerBlock(partner);
  const bindingBlock = activeRole === enums.ROLES.CUSTOMER || !activeRole
    ? buildBindingBlock(binding, boundPartner)
    : null;
  const meSource = activeRole === enums.ROLES.PARTNER ? (partnerBlock || {}) : (customerBlock || {});

  return {
    // DATA_MODEL §7.1 平铺 DTO
    roles,
    status: user ? user.status || enums.USER_STATUS.ACTIVE : enums.USER_STATUS.ACTIVE,
    privacyConsent: user && user.privacyConsent
      ? { version: user.privacyConsent.version || '', at: toMs(user.privacyConsent.at) }
      : null,
    messageReadAt: user ? toMs(user.messageReadAt) : 0,
    customerProfileCompleted: !!(customer && customer.profileCompleted === true),
    customerNo: customer ? customer.customerNo || '' : '',
    displayName: meSource.displayName || '',
    avatarFileId: meSource.avatarFileId || '',
    partnerStatus: partner ? partner.status || '' : '',
    partnerNo: partner ? partner.partnerNo || '' : '',
    isDeveloper,
    viewContext,
    configPublic: await configCommon.loadPublicConfig(ctx),
    serverTime: nowMs,
    // 页面子块（嵌套不替代平铺字段）
    activeRole,
    customer: customerBlock,
    partner: partnerBlock,
    binding: bindingBlock,
    badges: { workbenchPending: 0, messages: 0 }
  };
}

module.exports = { handler };
