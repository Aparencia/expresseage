// utils/privacy-gate.js · 非启动页直落兜底：未同意/版本变更时回 launch 过隐私闸（D37 兜底）
// 为什么需要：分享卡 path 在分享那一刻固化——修复前发出的绑定卡仍指向 /pages/role/index，
// 朋友圈卡落当前页（role/home）；这些冷启动都不经过 pages/launch 这一唯一同意入口，用户会再次
// 走进「写动作全被拒、却找不到同意入口」的死路（2026-10-28 反馈①，2026-10-30 用户侧复现）。
// 纪律：本层只做「读 store → 纯件判定 → 给页面一个 reLaunch 目标」；弹窗、文案、写库仍只在 launch。
'use strict';

const store = require('../store/index');
const privacy = require('./privacy-policy');
const route = require('../config/route');

// 返回 { needed, url, reason }：needed=true 时直落页只能 reLaunch(url)，不得继续渲染业务/发写动作。
// 判定用 utils/privacy-policy 纯件（页面不比较版本字符串）；路径用 config/route 单源。
function launchRedirectOf(entry) {
  const snapshot = store.snapshot() || {};
  // 切换会话（开发者看真实/测试账号）不重走隐私弹窗：目标账号的 privacyConsent 不是本机操作者的同意，
  // 会话写入由服务端按 developerNo 豁免（TD-046）；此处放行，避免把后台排障卡在隐私弹窗。
  if (snapshot.viewContext) {
    return { needed: false, url: '', reason: 'VIEW_SESSION' };
  }
  const status = privacy.consentStatus(snapshot.privacyConsent, snapshot.config);
  if (status.canProceed) {
    return { needed: false, url: '', reason: status.reason };
  }
  // 配置未就绪（CONFIG_MISSING）同样回 launch：由启动页 fail-closed 提示并重试，不在直落页猜放行。
  return { needed: true, url: route.launchPathOf(entry || {}), reason: status.reason };
}

// 页面 onLoad/onShow 的统一接线：等启动水合完成 → 判定 → 需要时回启动页过闸。
// 返回 Promise<boolean>：true=已拦截（页面必须停止后续初始化）；false=可以继续。
// 等 startupPromise 再看 store，避免冷启动早期 store 还是空快照时误判（把已同意用户也踢回启动页）。
function redirectIfNeeded(entry) {
  const app = typeof getApp === 'function' ? getApp() : null;
  const startup = app && app.startupPromise;
  return Promise.resolve(startup).catch(function ignore() {
    return null;
  }).then(() => {
    const guard = launchRedirectOf(entry || {});
    if (!guard.needed) {
      return false;
    }
    wx.reLaunch({ url: guard.url });
    return true;
  });
}

module.exports = {
  launchRedirectOf,
  redirectIfNeeded
};
