// pkg-partner/pages/order-detail/parts/view-model.js · 详情页视图装配（真实 DTO + 事件 → 一次 setData 的稳定快照）
// 边界：本文件只组合纯件输出（动作/凭证/面板/撤销条/编号小字），不调 wx、不发请求、不判断状态机。
const actionsPart = require('./actions');
const correctPanel = require('./correct-panel');
const deliveryPanel = require('./delivery-panel');
const exceptionPanel = require('./exception-panel');
const orderView = require('./order-view');
const undoPart = require('./undo');
const voucherPart = require('./voucher');

function nowMsOf(options) {
  const opts = options || {};
  return typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
}

// 服务端已按 UX §4.4 / DATA_MODEL §7.5 收敛（PARTNER DELIVERED 动作矩阵不含 correct）；
// 页面侧保留隐藏过滤作为双保险：即使服务端误下发，入口也不渲染（批 6-A 已修 _dto，双端断言锁定）。
function hideBlockedActions(order, actions) {
  const blocked = correctPanel.isBlocked(order);
  if (!blocked) {
    return actions;
  }
  return actions.filter((item) => item.key !== 'correct');
}

// order.get 的 {order, events} → 页面快照；events 用 parts/event-view 转好的展示行
function buildView(order, events, options) {
  const opts = options || {};
  const item = order || {};
  const readonly = opts.readonly === true;
  const nowMs = nowMsOf(opts);
  const detail = orderView.buildDetail(item);
  const actions = hideBlockedActions(item, actionsPart.buildVisibleActions(item, { readonly: readonly }));
  const voucher = voucherPart.buildVoucher(item, events);
  // 只读视角不出现撤销条（UX §4.7/§6.3：写操作全置灰/隐藏）
  const undoBar = readonly
    ? { visible: false, kind: '', remaining: 0, label: '', undoLabel: '撤销' }
    : undoPart.buildBar(item, actions, nowMs);
  return {
    order: Object.assign({}, item, detail),
    actions: actions,
    voucher: voucher,
    correctPanel: correctPanel.buildPanel(item),
    exceptionPanel: exceptionPanel.buildPanel(),
    deliveryPanel: deliveryPanel.buildPanel(item),
    deliveredChip: deliveryPanel.deliveredChip(item),
    guestAutoHint: deliveryPanel.guestAutoCompleteHint(item),
    undoBar: undoBar,
    customerNoText: detail.customerNoText,
    partnerNoText: detail.partnerNoText,
    counterpartText: detail.counterpartName,
    counterpartAvatarFileId: detail.counterpartAvatarFileId,
    isGuest: detail.isGuest,
    readonly: readonly
  };
}

module.exports = {
  buildView
};
