// pages/partner/workbench/parts/guide-view.js · 首用引导纯件（零 wx；完成标记由 utils/storage 单一出口写入）
// 口径：UX_PARTNER §4.8（三步遮罩可跳过 + 首屏/空态一行兼职编号；完成标记复用 utils/storage 既有键
//       PARTNER_WORKBENCH_V1；「重新看引导」入口放工作台空态，pages/profile 归 S0 不在此改）。
// 纪律：partnerNo 只从 store 快照取（不造假）；为空时整行不渲染，不写云端、不进 URL。
'use strict';

const ids = require('../../../../utils/ids');
const enums = require('../../../../shared/enums');

const GUIDE_KEY = 'PARTNER_WORKBENCH_V1';

const STEPS = [
  { title: '按站点看', text: '跑站先按站点看；点「多选」可一次标记一批已取件。' },
  { title: '先补码', text: '有「需查明」标记的件还没取件码，先补码再取。' },
  { title: '可撤销', text: '标错了别慌，5 秒内点「撤销」可以退回来。' }
];

const COPY = {
  replay: '重新看引导',
  skip: '跳过',
  last: '知道了',
  next: '下一步',
  share: '分享绑定卡片',
  createOnBehalf: '代客下单'
};

function total() {
  return STEPS.length;
}

// 编号行（UX §4.8 逐字）；partnerNo 空或非法 → ''（空态/引导首屏不渲染，不造假）
function partnerLine(partnerNo) {
  if (!ids.isPartnerNo(partnerNo || '')) {
    return '';
  }
  const display = ids.displayNo(enums.NO_KIND.PARTNER, partnerNo);
  return '你的兼职编号是 ' + display + ' —— 在「我的」可复制或分享绑定卡片给顾客';
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
    title: item.title,
    text: item.text,
    isLast: last,
    primaryText: last ? COPY.last : COPY.next,
    skipText: COPY.skip
  };
}

// 空态入口（UX §4.15）：分享绑定卡片（顾客自己确认才绑定）/ 代客下单 / 重新看引导
function emptyActions() {
  return {
    shareText: COPY.share,
    createOnBehalfText: COPY.createOnBehalf,
    replayText: COPY.replay,
    shareHint: '顾客在自己手机上确认后才建立绑定'
  };
}

// 下一步：最后一步返回 null（调用方走 finishGuide 写标记）
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
    title: '',
    text: '',
    isLast: false,
    primaryText: COPY.next,
    skipText: COPY.skip
  };
}

module.exports = {
  GUIDE_KEY,
  STEPS,
  COPY,
  total,
  partnerLine,
  stateOf,
  emptyActions,
  next,
  closedState
};
