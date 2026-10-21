// config/route.js · 启动分流纯函数（零 wx，可直测）
// snapshot 形状见 docs/ARCHITECTURE.md §3.6；返回 { url, reason }
const CUSTOMER_HOME = '/pages/customer/home/index';
const PARTNER_WORKBENCH = '/pages/partner/workbench/index';
const ADMIN_OVERVIEW = '/pkg-admin/pages/overview/index';
const ROLE_PAGE = '/pages/role/index';
const PROFILE_PAGE = '/pages/profile/index';

function decideLaunchRoute(snapshot) {
  const state = snapshot || {};
  const view = state.viewContext;

  if (view && view.viewMode) {
    const target = view.role === 'PARTNER' ? PARTNER_WORKBENCH : CUSTOMER_HOME;
    return { url: target, reason: 'VIEW_CONTEXT' };
  }
  if (state.isDeveloper) {
    return { url: ADMIN_OVERVIEW, reason: 'DEVELOPER' };
  }
  const roles = Array.isArray(state.roles) ? state.roles : [];
  const hasRole = typeof state.hasRole === 'boolean'
    ? state.hasRole
    : roles.length > 0 || !!state.activeRole;
  if (!hasRole) {
    return { url: ROLE_PAGE, reason: 'NO_ROLE' };
  }
  const isPartner = state.activeRole === 'PARTNER';
  if (isPartner) {
    const partner = state.partner || {};
    if (!partner.profileComplete) {
      return { url: PROFILE_PAGE, reason: 'PARTNER_PROFILE' };
    }
    if (partner.status === 'SUSPENDED' || partner.status === 'CLOSED') {
      return { url: PROFILE_PAGE, reason: 'PARTNER_INACTIVE' };
    }
    return { url: PARTNER_WORKBENCH, reason: 'PARTNER_ACTIVE' };
  }
  const customer = state.customer || {};
  if (!customer.profileComplete) {
    return { url: PROFILE_PAGE, reason: 'CUSTOMER_PROFILE' };
  }
  return { url: CUSTOMER_HOME, reason: 'CUSTOMER_READY' };
}

function isRolePageAllowed(pagePath, snapshot) {
  const state = snapshot || {};
  const view = state.viewContext;
  if (view && view.viewMode) {
    const role = view.role === 'PARTNER' ? 'PARTNER' : 'CUSTOMER';
    return pagePath.indexOf('/pages/' + role.toLowerCase() + '/') === 0;
  }
  if (!state.activeRole) {
    return false;
  }
  if (state.activeRole === 'PARTNER') {
    return pagePath.indexOf('/pages/partner/') === 0;
  }
  return pagePath.indexOf('/pages/customer/') === 0;
}

module.exports = {
  decideLaunchRoute,
  isRolePageAllowed,
  CUSTOMER_HOME,
  PARTNER_WORKBENCH,
  ADMIN_OVERVIEW,
  ROLE_PAGE,
  PROFILE_PAGE
};
