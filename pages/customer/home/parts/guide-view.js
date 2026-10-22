// pages/customer/home/parts/guide-view.js · 顾客首用三步引导纯件（零 wx；完成标记由 utils/storage 单一出口写）
// 口径：UX_CUSTOMER §1.1/§3.3（首用引导三步、可跳过；「我的→重新看新手引导」重看）；键复用白名单 CUSTOMER_HOME_V1。
// 边界：只本机记忆（utils/storage 唯一写口），不上传、不进 URL；引导可跳过，不遮挡写操作。
'use strict';

const GUIDE_KEY = 'CUSTOMER_HOME_V1';

const STEPS = [
  { title: '先绑定兼职', text: '向兼职要完整编号（P-XXX-XXX），在首页输入绑定后就能下单。' },
  { title: '截图下单', text: '上传取件码截图，核对取件信息后提交；没有截图也可以手填。' },
  { title: '在「订单」看进度', text: '底部「订单」看进度和取件码；送达后点「确认送达」完成订单。' }
];

const COPY = {
  next: '下一步',
  skip: '跳过',
  last: '完成',
  stepPrefix: '第 ',
  stepSuffix: ' 步'
};

function total() {
  return STEPS.length;
}

function stateOf(step) {
  const totalSteps = total();
  const index = Math.max(0, Math.min(totalSteps - 1, Number(step) || 0));
  const item = STEPS[index];
  const last = index === totalSteps - 1;
  return {
    visible: true,
    step: index,
    total: totalSteps,
    stepText: COPY.stepPrefix + (index + 1) + '/' + totalSteps + COPY.stepSuffix,
    title: item.title,
    text: item.text,
    isLast: last,
    primaryText: last ? COPY.last : COPY.next,
    skipText: COPY.skip
  };
}

// 首次进（未看过）显示；完成/跳过写标记后不再出现（closed）
function showGuideOf(seen) {
  return seen === true ? closedState() : stateOf(0);
}

// 下一步：最后一步返回 null（调用方写标记后关闭）
function next(state) {
  const current = state || {};
  if (!current.visible) {
    return null;
  }
  const nextStep = (Number(current.step) || 0) + 1;
  if (nextStep >= total()) {
    return null;
  }
  return stateOf(nextStep);
}

function closedState() {
  return {
    visible: false,
    step: 0,
    total: total(),
    stepText: '',
    title: '',
    text: '',
    isLast: false,
    primaryText: COPY.next,
    skipText: COPY.skip
  };
}

module.exports = {
  GUIDE_KEY,
  total,
  stateOf,
  showGuideOf,
  next,
  closedState
};
