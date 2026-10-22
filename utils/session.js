// utils/session.js · 切换会话进入/退出统一实现（唯一流程；组件与页面共用）
// 铁律：`admin.viewAsStart` 只签发 viewContext，不写业务身份快照；进入/退出会话后必须重新拉
// `user.bootstrap` 水合 store（目标身份的角色/顾客/兼职/绑定/配置），否则页面会拿开发者自己的
// 空身份渲染测试账号——测试顾客显示「资料未完善」、测试兼职显示「待激活」（CONTRACT §1.3 单机验收）。
const store = require('../store/index');
const adminModule = require('../api/modules/admin');
const userModule = require('../api/modules/user');

const ACCOUNT_SWITCH_PAGE = '/pkg-admin/pages/account-switch/index';

// 以当前请求包络（含会话票据）拉 user.bootstrap 并水合 store；失败不阻断切换（页面读接口仍会兜底）。
async function hydrateIdentity(bootstrap, state) {
  const call = typeof bootstrap === 'function' ? bootstrap : userModule.bootstrap;
  try {
    const data = await call();
    (state || store).hydrateFromBootstrap(data);
    return data;
  } catch (err) {
    return null;
  }
}

// 进入会话：先写 viewContext（后续请求必须带票据），再水合目标身份。顺序不可颠倒。
async function enterViewContext(viewContext, deps) {
  const opts = deps || {};
  const state = opts.store || store;
  state.setViewContext(viewContext);
  await hydrateIdentity(opts.bootstrap, state);
  return viewContext;
}

async function exitViewContext(deps) {
  const opts = deps || {};
  const state = opts.store || store;
  const view = state.getViewContext();
  const relaunch = opts.relaunch || function defaultRelaunch(url) { wx.reLaunch(url); };
  if (!view) {
    relaunch({ url: ACCOUNT_SWITCH_PAGE });
    return;
  }
  try {
    await (opts.admin || adminModule).viewAsEnd({});
  } catch (err) {
    // 退出失败也本地清，避免卡在会话中
  }
  state.clearViewContext();
  // 先回「账号切换」页再等水合：后台页不依赖 store 业务快照，不让网络慢把退出卡在会话页。
  const hydration = hydrateIdentity(opts.bootstrap, state);
  relaunch({ url: ACCOUNT_SWITCH_PAGE });
  await hydration;
}

module.exports = {
  hydrateIdentity,
  enterViewContext,
  exitViewContext,
  ACCOUNT_SWITCH_PAGE
};
