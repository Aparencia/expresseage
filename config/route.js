// config/route.js · 启动分流纯函数（零 wx、零 storage，可直测）
// snapshot 形状见 docs/ARCHITECTURE.md §3.6；返回 { url, reason }。
// 角色解析口径（批 2）：显式 activeRole 优先 > 单角色直进 > 双角色回角色页由用户选择。
// 「上次使用」建议由 pages/role 在显示层读 utils/storage 处理（本文件不 require storage、
// 不接收 lastRole，路由输入保持 ARCHITECTURE §3.6 冻结形状）。
const CUSTOMER_HOME = '/pages/customer/home/index';
const PARTNER_WORKBENCH = '/pages/partner/workbench/index';
const ADMIN_OVERVIEW = '/pkg-admin/pages/overview/index';
const ROLE_PAGE = '/pages/role/index';
const PROFILE_PAGE = '/pages/profile/index';
const PROFILE_EDIT_QUERY = '?edit=1';

const ROLES = { CUSTOMER: 'CUSTOMER', PARTNER: 'PARTNER' };

function isBusinessRole(role) {
  return role === ROLES.CUSTOMER || role === ROLES.PARTNER;
}

function roleListOf(snapshot) {
  const roles = snapshot && Array.isArray(snapshot.roles) ? snapshot.roles : [];
  // 服务端角色列表可能含未知值：只认两个业务角色，其余忽略（不猜、不外扩）
  return roles.filter(isBusinessRole);
}

// 角色解析单源：activeRole 合法就用它；只有一个业务角色时直进（单角色直进）；
// 双角色且没有 activeRole 时返回 ''，由决策层回角色页让用户选（页面按 lastRole 给建议）。
function resolveLaunchRole(snapshot) {
  const state = snapshot || {};
  if (isBusinessRole(state.activeRole)) {
    return state.activeRole;
  }
  const roles = roleListOf(state);
  return roles.length === 1 ? roles[0] : '';
}

// 角色页「上次使用」建议：lastRole 必须仍是本账号当前角色之一才建议（不猜、不跨账号复用）。
function suggestedRoleOf(roles, lastRole) {
  const list = Array.isArray(roles) ? roles.filter(isBusinessRole) : [];
  if (!isBusinessRole(lastRole)) {
    return '';
  }
  return list.indexOf(lastRole) >= 0 ? lastRole : '';
}

// 按已解析角色给出落地页（资料/状态判定集中在本函数，页面不再自己判）。
function routeOfRole(role, state) {
  const snapshot = state || {};
  if (role === ROLES.PARTNER) {
    const partner = snapshot.partner || {};
    if (!partner.profileComplete) {
      return { url: PROFILE_PAGE, reason: 'PARTNER_PROFILE' };
    }
    if (partner.status === 'SUSPENDED' || partner.status === 'CLOSED') {
      return { url: PROFILE_PAGE, reason: 'PARTNER_INACTIVE' };
    }
    return { url: PARTNER_WORKBENCH, reason: 'PARTNER_ACTIVE' };
  }
  const customer = snapshot.customer || {};
  if (!customer.profileComplete) {
    // P1-1（批 10 A 批）：资料未完善落地即展开编辑态（0 点击），完成态不带 edit=1（不打扰）
    return { url: PROFILE_PAGE + PROFILE_EDIT_QUERY, reason: 'CUSTOMER_PROFILE' };
  }
  return { url: CUSTOMER_HOME, reason: 'CUSTOMER_READY' };
}

function decideLaunchRoute(snapshot) {
  const state = snapshot || {};
  const view = state.viewContext;
  // ① 切换会话优先（开发者只读/测试可写都在内存 viewContext 里）
  if (view && view.viewMode) {
    const target = view.role === ROLES.PARTNER ? PARTNER_WORKBENCH : CUSTOMER_HOME;
    return { url: target, reason: 'VIEW_CONTEXT' };
  }
  // ② 开发者（无会话时进后台；不进业务 tab）
  if (state.isDeveloper) {
    return { url: ADMIN_OVERVIEW, reason: 'DEVELOPER' };
  }
  // ③ 无角色 → 角色页
  const roles = roleListOf(state);
  const hasRole = typeof state.hasRole === 'boolean'
    ? state.hasRole
    : roles.length > 0 || isBusinessRole(state.activeRole);
  if (!hasRole) {
    return { url: ROLE_PAGE, reason: 'NO_ROLE' };
  }
  // ④ 单角色直进 / 双角色无 activeRole → 角色页（选择建议由角色页读 lastRole 高亮）
  const role = resolveLaunchRole(state);
  if (!role) {
    return { url: ROLE_PAGE, reason: 'CHOOSE_ROLE' };
  }
  return routeOfRole(role, state);
}

// 决策 → 落地角色（仅资料/角色首页类 reason 有角色；会话/开发者/选角色页没有）。
// launch 用它决定「进入角色后把 lastRole 记下来」，判定仍在纯件里。
function roleOfDecision(decision) {
  const reason = (decision && decision.reason) || '';
  if (reason.indexOf('CUSTOMER_') === 0) {
    return ROLES.CUSTOMER;
  }
  if (reason.indexOf('PARTNER_') === 0) {
    return ROLES.PARTNER;
  }
  return '';
}

function isRolePageAllowed(pagePath, snapshot) {
  const state = snapshot || {};
  const view = state.viewContext;
  if (view && view.viewMode) {
    const role = view.role === ROLES.PARTNER ? ROLES.PARTNER : ROLES.CUSTOMER;
    return pagePath.indexOf('/pages/' + role.toLowerCase() + '/') === 0;
  }
  if (!state.activeRole) {
    return false;
  }
  if (state.activeRole === ROLES.PARTNER) {
    return pagePath.indexOf('/pages/partner/') === 0;
  }
  return pagePath.indexOf('/pages/customer/') === 0;
}

module.exports = {
  ROLES,
  isBusinessRole,
  resolveLaunchRole,
  suggestedRoleOf,
  roleOfDecision,
  decideLaunchRoute,
  isRolePageAllowed,
  CUSTOMER_HOME,
  PARTNER_WORKBENCH,
  ADMIN_OVERVIEW,
  ROLE_PAGE,
  PROFILE_PAGE
};
