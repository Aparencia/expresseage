// handlers/user/bootstrap.js · user.bootstrap（启动唯一水合接口）
// 返回形状 = ARCHITECTURE §3.4 store 快照（roles/activeRole/isDeveloper/me/customer/partner/binding/config/badges/
// viewContext/serverTime），另带 DATA_MODEL §2.1 的兼容字段；**永不返回 openid / isTestAccount / 票据**。
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
    acceptingOrders: serviceConfig.acceptingOrders === true
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

function buildMe(customer, partner, activeRole) {
  const source = activeRole === enums.ROLES.PARTNER ? (partner || {}) : (customer || {});
  const me = { displayName: source.displayName || '' };
  if (source.avatarFileId) {
    me.avatarFileId = source.avatarFileId;
  }
  return me;
}

async function handler(ctx) {
  const scope = identity.scopeOf(ctx);
  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  const viewSession = await identity.loadViewSession(ctx);
  const viewContext = identity.buildViewContext(viewSession);
  const isSwitchView = viewContext !== null;

  const user = await identity.loadUser(ctx, scope.openid);
  const customer = await identity.loadCustomer(ctx, scope.openid);
  const partner = await identity.loadPartnerByOpenid(ctx, scope.openid);
  const binding = await identity.getActiveBinding(ctx, scope.openid);
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

  const result = {
    roles,
    activeRole,
    isDeveloper,
    me: buildMe(customerBlock, partnerBlock, activeRole),
    customer: customerBlock,
    partner: partnerBlock,
    binding: bindingBlock,
    config: await configCommon.loadPublicConfig(ctx),
    badges: { workbenchPending: 0, messages: 0 },
    viewContext,
    serverTime: nowMs,
    // DATA_MODEL §2.1 兼容字段（页面按需读取）
    status: user ? user.status || enums.USER_STATUS.ACTIVE : enums.USER_STATUS.ACTIVE,
    privacyConsent: user && user.privacyConsent
      ? { version: user.privacyConsent.version || '', at: toMs(user.privacyConsent.at) }
      : null,
    messageReadAt: user ? toMs(user.messageReadAt) : 0,
    customerProfileCompleted: !!(customer && customer.profileCompleted === true),
    customerNo: customer ? customer.customerNo || '' : '',
    partnerStatus: partner ? partner.status || '' : '',
    partnerNo: partner ? partner.partnerNo || '' : ''
  };
  return result;
}

module.exports = { handler };
