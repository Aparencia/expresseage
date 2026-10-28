// utils/share/index.js · 分享卡片纯件（零 wx、零 setData、零业务写；单测直测）
// 口径（CONTRACT §8/§11、D36）：
//   ① 好友转发：兼职身份 + 非切换会话 + 有兼职编号 → 绑定卡（path 只带 partnerNo，
//      不带头像/昵称/宿舍/尾号/订单/票据）；其余一律回通用邀请卡（path=/pages/role/index）。
//   ② 朋友圈：onShareTimeline 只能分享当前页（平台不允许自定义 path），卡片 = 固定标题 +
//      固定中性封面，query 恒为空串，不把任何页面参数/业务值带进卡片。
//   ③ 所有卡片使用固定中性封面，禁止使用页面截图（否则会把取件码/宿舍/尾号等 L3 截进卡片）。
'use strict';

const route = require('../../config/route');

const COVER = '/assets/share/cover.png';
const COVER_TIMELINE = '/assets/share/cover-timeline.png';

const TITLES = {
  GENERIC: '校园快递代取｜上传取件码，快递送到宿舍',
  BIND: '我在做校园代取，凭兼职编号找我下单',
  TIMELINE: '校园快递代取｜宿舍区内互取互送'
};

// 场景值 1154 = 朋友圈单页模式（官方：用场景值判断并做页面适配）
const SINGLE_PAGE_SCENE = 1154;
const SINGLE_PAGE_HINT = '这是朋友圈预览：只能浏览，点底部「前往小程序」使用完整功能。';
const SHARE_TIP = '分享到朋友圈：点右上角 ··· 选择「分享到朋友圈」。';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 入参 { isCustomer, viewSession, partnerCard } → { title, path, imageUrl }
// 只认这三个入参：订单号/取件码/宿舍等多余字段一律忽略（卡片零业务值，隐私默认收紧）。
function buildAppMessage(input) {
  const source = input || {};
  const card = source.partnerCard || {};
  const partnerNo = textOf(card.partnerNo);
  // 只有明确「兼职」身份才放行；isCustomer 缺省/切换会话/无编号一律回通用卡
  const shareBind = source.isCustomer === false && source.viewSession !== true && partnerNo !== '';
  if (!shareBind) {
    return { title: TITLES.GENERIC, path: route.ROLE_PAGE, imageUrl: COVER };
  }
  return {
    title: TITLES.BIND,
    path: route.ROLE_PAGE + '?bind=' + encodeURIComponent(partnerNo),
    imageUrl: COVER
  };
}

// 朋友圈卡片：无入参——标题/封面固定、query 恒为空（平台落地页=当前页，不携带业务数据）
function buildTimeline() {
  return { title: TITLES.TIMELINE, query: '', imageUrl: COVER_TIMELINE };
}

function isSinglePage(scene) {
  return Number(scene) === SINGLE_PAGE_SCENE;
}

module.exports = {
  COVER,
  COVER_TIMELINE,
  TITLES,
  SINGLE_PAGE_SCENE,
  SINGLE_PAGE_HINT,
  SHARE_TIP,
  buildAppMessage,
  buildTimeline,
  isSinglePage
};
