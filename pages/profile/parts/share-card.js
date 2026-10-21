// pages/profile/parts/share-card.js · 分享卡片纯件（零 wx、零 setData、零业务写）
// 口径：V4_UX_PARTNER §6、CONTRACT §11——分享卡片只带兼职编号，不带昵称/头像/宿舍/尾号；
// 只有「兼职 + 非切换会话 + 已绑定编号」才分享绑定卡，其余回通用首页分享。
// 页面 onShareAppMessage 只转发 data，取哪张卡、path 怎么拼全部在这里（可单测）。
'use strict';

const route = require('../../../config/route');

const BIND_SHARE_TITLE = '我在做校园代取，凭兼职编号找我下单';
const GENERIC_SHARE_TITLE = '校园快递代取';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 入参 { isCustomer, viewSession, partnerCard } → { title, path }
function buildShareMessage(input) {
  const source = input || {};
  const card = source.partnerCard || {};
  const partnerNo = textOf(card.partnerNo);
  // 只有明确「兼职」身份才放行；isCustomer 缺省/切换会话/无编号一律回通用分享（隐私默认收紧）
  const shareBind = source.isCustomer === false && source.viewSession !== true && partnerNo !== '';
  if (!shareBind) {
    return { title: GENERIC_SHARE_TITLE, path: route.ROLE_PAGE };
  }
  return {
    title: BIND_SHARE_TITLE,
    path: route.ROLE_PAGE + '?bind=' + encodeURIComponent(partnerNo)
  };
}

module.exports = { buildShareMessage };
