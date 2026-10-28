// utils/share/handlers.js · 页面分享事件薄适配（store 快照 → 卡片；页面只挂两个生命周期钩子）
// 页面层零判据（CONTRACT §12/ENGINEERING §5.1）：页面不拼 path/title，只 return 本纯件结果。
'use strict';

const store = require('../../store/index');
const share = require('./index');

// 好友转发：兼职身份 + 非切换会话 + 有编号 → 绑定卡；其余回通用邀请卡。
// 切换会话下 store.partner 是目标账号身份，必须靠 viewSession 挡掉（不把目标编号转出去）。
function appMessage() {
  const snapshot = store.snapshot() || {};
  const partner = snapshot.partner || {};
  return share.buildAppMessage({
    isCustomer: snapshot.activeRole !== 'PARTNER',
    viewSession: !!snapshot.viewContext,
    partnerCard: { partnerNo: partner.partnerNo || '' }
  });
}

// 朋友圈：标题/封面固定、query 恒空（平台落地页=当前页，卡片零业务值）
function timeline() {
  return share.buildTimeline();
}

module.exports = {
  appMessage,
  timeline,
  SINGLE_PAGE_HINT: share.SINGLE_PAGE_HINT,
  SHARE_TIP: share.SHARE_TIP
};
