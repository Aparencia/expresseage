'use strict';
/**
 * tools/lib/workspace-cases.js — D86 工作区切换判据（从 selftest-profile 拆出，保持套件 ≤1000 行）。
 * 覆盖：双角色目标推导 / 单角色不可切 / 切换会话禁切 / 切换编排顺序 / 失败保持 / 生产接线。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const workspace = require(path.join(ROOT, 'utils/workspace.js'));
const launchRoute = require(path.join(ROOT, 'config/route.js'));

function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function register(h) {
  h.section('§5.6/D86 工作区切换（双角色 / 单角色 / 会话 / 编排）', async (t) => {
    const profileJs = readSource('pages/profile/index.js');
    const workspaceJs = readSource('utils/workspace.js');
    t.check(profileJs.indexOf("require('../../utils/workspace')") !== -1
      && profileJs.indexOf('workspace.switchTo(') !== -1,
    'pages/profile 切换工作区走 utils/workspace（不直接写 lastRole/reLaunch）');
    t.check(workspaceJs.indexOf('setLastRole') !== -1 && workspaceJs.indexOf('bootstrap(') !== -1
      && workspaceJs.indexOf('reLaunch') !== -1,
    'utils/workspace 单源：目标工作区水合 + reLaunch + 成功后写 lastRole');
    t.eq(launchRoute.workspaceHomeOf('CUSTOMER'), launchRoute.CUSTOMER_HOME,
      'D86 工作区回退单源：顾客 → 顾客首页');
    t.eq(launchRoute.workspaceHomeOf('PARTNER'), launchRoute.PARTNER_WORKBENCH,
      'D86 工作区回退单源：兼职 → 兼职工作台');
    t.eq(launchRoute.workspaceHomeOf(''), launchRoute.ROLE_PAGE,
      'D86 无工作区才回角色页（不空集放行）');
    t.eq(workspace.otherRoleOf(['CUSTOMER', 'PARTNER'], 'CUSTOMER'), 'PARTNER', 'D86 双角色从顾客工作区切到兼职');
    t.eq(workspace.otherRoleOf(['CUSTOMER', 'PARTNER'], 'PARTNER'), 'CUSTOMER', 'D86 双角色从兼职工作区切到顾客');
    t.eq(workspace.otherRoleOf(['CUSTOMER'], 'CUSTOMER'), '', 'D86 单角色不可切换（不猜目标）');
    t.eq(workspace.canSwitch({ roles: ['CUSTOMER', 'PARTNER'], activeRole: 'CUSTOMER' }), true,
      'D86 双角色可切换');
    t.eq(workspace.canSwitch({ roles: ['CUSTOMER', 'PARTNER'], activeRole: 'CUSTOMER', viewContext: { viewMode: 'READONLY' } }), false,
      'D86 切换会话不可切工作区（走会话条退出）');
    const calls = [];
    const switched = await workspace.switchTo('PARTNER', {
      bootstrap: (role) => { calls.push('bootstrap:' + role); return Promise.resolve({ activeRole: role }); },
      hydrate: () => calls.push('hydrate'),
      setLastRole: (role) => calls.push('lastRole:' + role),
      getActiveRole: () => 'CUSTOMER',
      homeOf: (role) => '/home/' + role,
      reLaunch: (opts) => { calls.push('reLaunch:' + opts.url); opts.success(); }
    });
    t.eq([switched.ok, calls.join('|')], [true, 'bootstrap:PARTNER|hydrate|reLaunch:/home/PARTNER|lastRole:PARTNER'],
      'D86 切换顺序：目标水合 → reLaunch → 成功后写 lastRole');
    const switchFailed = await workspace.switchTo('PARTNER', {
      bootstrap: () => Promise.reject(new Error('network')),
      hydrate: () => {},
      setLastRole: () => {},
      getActiveRole: () => 'CUSTOMER',
      homeOf: (role) => '/home/' + role,
      reLaunch: () => {}
    });
    t.eq([switchFailed.ok, switchFailed.code], [false, 'SWITCH_FAILED'], 'D86 水合失败保持当前工作区并给失败码');
  });
}

module.exports = { register };
