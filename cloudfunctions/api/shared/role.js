// shared/role.js · 角色判定纯函数（业务角色只有 CUSTOMER / PARTNER；开发者是白名单环境身份，不落库）
// 契约：docs/V4_CONTRACT.md v0.9 §1/§1.3/§4.2（绑定方向铁律）；docs/V4_DATA_MODEL.md §6.1/§6.3。
// 调用方：api/（按角色渲染入口）、云端 auth/guard-bind 中间件、启动分流（config/route.js 快照）。
'use strict';

const enums = require('./enums');

const ROLES = enums.ROLES;

function hasRole(roles, role) {
  return Array.isArray(roles) && roles.indexOf(role) !== -1;
}

function isCustomerRole(role) {
  return role === ROLES.CUSTOMER;
}

function isPartnerRole(role) {
  return role === ROLES.PARTNER;
}

function roleLabel(role) {
  return enums.ROLE_LABELS[role] || '';
}

// 多角色 openid 的"当前使用角色"：优先记住的偏好，否则按角色优先级（兼职优先于顾客）
function pickActiveRole(roles, preferredRole) {
  if (!Array.isArray(roles) || roles.length === 0) {
    return null;
  }
  if (preferredRole && roles.indexOf(preferredRole) !== -1) {
    return preferredRole;
  }
  if (roles.indexOf(ROLES.PARTNER) !== -1) {
    return ROLES.PARTNER;
  }
  if (roles.indexOf(ROLES.CUSTOMER) !== -1) {
    return ROLES.CUSTOMER;
  }
  return null;
}

// 兼职可执行业务动作的唯一状态：ACTIVE（SUSPENDED/CLOSED 一律 PARTNER_CLOSED）
function isPartnerActive(partner) {
  if (!partner || typeof partner !== 'object') {
    return false;
  }
  return partner.status === enums.PARTNER_STATUS.ACTIVE && !partner.deletedAt;
}

// 顾客可下单/绑定的前提：资料完整（苑/栋/宿舍号 + 昵称）
function isCustomerProfileComplete(customer) {
  return !!(customer && customer.profileCompleted === true);
}

// 绑定方向铁律（CONTRACT §4.2）：只有顾客能发起绑定；兼职端零入口，服务端一样拒绝
function canInitiateBind(role) {
  return isCustomerRole(role);
}

// 写动作角色守卫用：业务角色是否允许该动作（不给 admin 业务身份）
function isBusinessRole(role) {
  return isCustomerRole(role) || isPartnerRole(role);
}

module.exports = {
  ROLES,
  hasRole,
  isCustomerRole,
  isPartnerRole,
  roleLabel,
  pickActiveRole,
  isPartnerActive,
  isCustomerProfileComplete,
  canInitiateBind,
  isBusinessRole
};
