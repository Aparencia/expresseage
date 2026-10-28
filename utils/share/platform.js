// utils/share/platform.js · 分享相关 wx 适配（全仓唯一触碰分享类 wx API 的纯件层文件）
// 纪律（ENGINEERING §6.3 ADR）：不 mock 全局 wx——平台参数由调用方注入，单测传假 api 即可。
//   ① singlePageNow()：当前是否朋友圈单页模式（scene=1154；单页模式无登录态、不能跳页、云资源不可用）
//   ② syncSession()：切换会话禁分享（CONTRACT §1.2/§1.3/O3）——进入会话隐藏右上角转发/朋友圈菜单，
//      退出会话恢复；只有状态变化时才调 API（store 通知很密，避免每帧重复调）。
'use strict';

const share = require('./index');

// 已隐藏状态（进程级；进入/退出会话各发生一次，页面 reLaunch 后由 switch-bar 重新对齐）
let sessionHidden = false;

function platformOf(api) {
  return api || (typeof wx !== 'undefined' ? wx : null);
}

// 本次启动是否朋友圈单页模式（App.onLaunch 与页面 onLoad 看到同一个启动场景）
function singlePageNow(api) {
  const platform = platformOf(api);
  if (!platform) {
    return false;
  }
  try {
    const launch = typeof platform.getLaunchOptionsSync === 'function' ? platform.getLaunchOptionsSync() : null;
    if (launch && share.isSinglePage(launch.scene)) {
      return true;
    }
    const enter = typeof platform.getEnterOptionsSync === 'function' ? platform.getEnterOptionsSync() : null;
    return !!(enter && share.isSinglePage(enter.scene));
  } catch (err) {
    return false;
  }
}

// 入参：inSession(boolean)、可选假 platform（{hideShareMenu, showShareMenu}）。
// 返回：本次是否真的调用了平台 API（便于测试与埋点，不承诺成功）。
function syncSession(inSession, api) {
  const hidden = inSession === true;
  if (hidden === sessionHidden) {
    return false;
  }
  const platform = platformOf(api);
  if (!platform) {
    return false;
  }
  try {
    if (hidden) {
      platform.hideShareMenu({});
    } else {
      platform.showShareMenu({ withShareTicket: false });
    }
  } catch (err) {
    return false;
  }
  sessionHidden = hidden;
  return true;
}

module.exports = { singlePageNow, syncSession };
