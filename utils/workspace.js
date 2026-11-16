// utils/workspace.js · 工作区切换单源（D86）
// 口径：V4_CONTRACT §1/§13 D86；V4_ARCHITECTURE §3.6。工作区只是同一账号的呈现上下文，
// 不是新账号/新权限主体；服务端鉴权仍按 users.roles + 资源归属，本文件只做展示/导航编排。
// 页面层不出现角色字符串与 reLaunch 目标：页面只取 otherRoleOf/canSwitch/switchTo。
'use strict';

const route = require('../config/route');

const FAIL_COPY = '切换工作台失败，请重试';

// 双角色才可切换：返回另一个业务角色；单角色/未知返回 ''（不猜）。
function otherRoleOf(roles, currentRole) {
  const list = Array.isArray(roles) ? roles : [];
  const hasCustomer = list.indexOf(route.ROLES.CUSTOMER) >= 0;
  const hasPartner = list.indexOf(route.ROLES.PARTNER) >= 0;
  if (!hasCustomer || !hasPartner) {
    return '';
  }
  if (currentRole === route.ROLES.CUSTOMER) {
    return route.ROLES.PARTNER;
  }
  if (currentRole === route.ROLES.PARTNER) {
    return route.ROLES.CUSTOMER;
  }
  return '';
}

// 切换入口可见性：双角色 + 非切换会话（只读/测试会话不切工作区，走会话条退出）。
function canSwitch(snapshot) {
  const snap = snapshot || {};
  if (snap.viewContext) {
    return false;
  }
  return !!otherRoleOf(snap.roles, snap.activeRole);
}

// 默认依赖延迟到调用时取：纯函数 otherRoleOf/canSwitch 可脱离 wx/网络单测。
function defaultDeps() {
  const store = require('../store/index');
  const storage = require('./storage');
  const userApi = require('../api/modules/user');
  return {
    bootstrap: userApi.bootstrap,
    hydrate: store.hydrateFromBootstrap,
    setLastRole: storage.setLastRole,
    getActiveRole: function getActiveRole() {
      return store.get('activeRole');
    },
    homeOf: route.workspaceHomeOf,
    reLaunch: function reLaunch(options) {
      return wx.reLaunch(options);
    }
  };
}

// 一次切换 = 目标工作区水合 → reLaunch 目标首页；不经过角色页。
// 失败不改变 lastRole；reLaunch 失败时回滚旧工作区投影，避免 store 与页面分离。
function switchTo(role, deps) {
  const d = deps || defaultDeps();
  if (!route.isBusinessRole(role)) {
    return Promise.resolve({ ok: false, code: 'INVALID_ROLE', message: FAIL_COPY });
  }
  const previousRole = typeof d.getActiveRole === 'function' ? d.getActiveRole() : '';
  return Promise.resolve(d.bootstrap(role)).then(function onData(data) {
    d.hydrate(data);
    return new Promise(function navigate(resolve) {
      d.reLaunch({
        url: d.homeOf(role),
        success: function ok() {
          d.setLastRole(role);
          resolve({ ok: true, role: role });
        },
        fail: function failed() {
          rollback(d, previousRole, role);
          resolve({ ok: false, code: 'RELAUNCH_FAILED', message: FAIL_COPY });
        }
      });
    });
  }).catch(function onError(err) {
    return { ok: false, code: (err && err.code) || 'SWITCH_FAILED', message: FAIL_COPY };
  });
}

// reLaunch 失败的回滚：把展示投影恢复为切换前的工作区；回滚失败静默（页面仍提示重试）。
function rollback(deps, previousRole, attemptedRole) {
  if (!previousRole || previousRole === attemptedRole || !route.isBusinessRole(previousRole)) {
    return;
  }
  Promise.resolve(deps.bootstrap(previousRole))
    .then(function restore(data) {
      deps.hydrate(data);
    })
    .catch(function ignore() {
      return null;
    });
}

module.exports = {
  otherRoleOf,
  canSwitch,
  switchTo,
  FAIL_COPY
};
