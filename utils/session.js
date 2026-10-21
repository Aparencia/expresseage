// utils/session.js · 切换会话退出统一实现（唯一退出流程；组件与页面共用）
const store = require('../store/index');
const adminModule = require('../api/modules/admin');
const ACCOUNT_SWITCH_PAGE = '/pkg-admin/pages/account-switch/index';

async function exitViewContext() {
  const view = store.getViewContext();
  if (!view) {
    wx.reLaunch({ url: ACCOUNT_SWITCH_PAGE });
    return;
  }
  try {
    await adminModule.viewAsEnd({});
  } catch (err) {
    // 失败也本地清，避免卡在会话中
  } finally {
    store.clearViewContext();
    wx.reLaunch({ url: ACCOUNT_SWITCH_PAGE });
  }
}

module.exports = {
  exitViewContext,
  ACCOUNT_SWITCH_PAGE
};
