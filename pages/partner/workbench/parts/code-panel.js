// pages/partner/workbench/parts/code-panel.js · v1.0 逐件补码面板纯件（零 wx、零页面状态）
// 口径：UX_PARTNER §4.4（行内补码：取件码≤40/柜号/运单尾号恰 5 位）、§4.16（多包裹逐件切换 + itemIndex）；
//       CONTRACT §5.1（`order.correct` 按 `itemIndex` 纠正单件；PICKED 仅柜号/尾号由服务端字段白名单收窄）。
// 边界：只做"面板字段装配/切件"，不判订单状态、不发请求（可见性 100% 来自服务端行内 actions[]）。
'use strict';

const PICKUP_CODE_MAX = 40;
const TRACKING_TAIL_LENGTH = 5;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 逐件面板数据（v1.0/D23）：多件单由 group-view 下发 parcelRows；单件单用首件字段兜底
function codeItemsOf(row) {
  const list = row && Array.isArray(row.parcelRows) ? row.parcelRows : [];
  if (list.length) {
    return list.map((piece) => ({
      index: piece.index,
      indexText: piece.indexText,
      stationName: piece.stationName,
      code: piece.pickupCode,
      lockerNo: piece.lockerNo,
      trackingTail: piece.trackingTail,
      codeStatusText: piece.codeStatusText,
      needCode: piece.needCode === true
    }));
  }
  return [{
    index: 0,
    indexText: '第 1 件',
    stationName: textOf(row && row.stationName),
    code: textOf(row && row.pickupCode),
    lockerNo: textOf(row && row.lockerText),
    trackingTail: textOf(row && row.trackingTail),
    codeStatusText: '',
    needCode: !!(row && row.needCode)
  }];
}

// 件切换器字段：面板标题带件号；origin 快照用于"只提交真正改过的字段"
function codeFieldsOf(items, index) {
  const current = items[index] || items[0] || {};
  return {
    type: 'code',
    items: items,
    multi: items.length > 1,
    itemIndex: index,
    itemIndexText: current.indexText || '第 1 件',
    stationName: textOf(current.stationName),
    code: textOf(current.code),
    lockerNo: textOf(current.lockerNo),
    trackingTail: textOf(current.trackingTail),
    origin: { code: textOf(current.code), lockerNo: textOf(current.lockerNo), trackingTail: textOf(current.trackingTail) },
    codeMax: PICKUP_CODE_MAX,
    tailLength: TRACKING_TAIL_LENGTH
  };
}

// 面板打开时的逐件字段（itemIndex 缺省 = 首件）
function codePanelOf(row, itemIndex) {
  const items = codeItemsOf(row);
  const index = typeof itemIndex === 'number' && itemIndex >= 0 && itemIndex < items.length ? itemIndex : 0;
  return codeFieldsOf(items, index);
}

// 面板内切件（v1.0）：只重算件相关字段，保留 actionKey/orderNo，清空上次错误
function switchCodePanel(panel, itemIndex) {
  if (!panel || panel.type !== 'code') {
    return panel;
  }
  const items = Array.isArray(panel.items) ? panel.items : [];
  const index = typeof itemIndex === 'number' && itemIndex >= 0 && itemIndex < items.length ? itemIndex : 0;
  return Object.assign({}, panel, codeFieldsOf(items, index), { error: '' });
}

module.exports = {
  PICKUP_CODE_MAX,
  TRACKING_TAIL_LENGTH,
  codeItemsOf,
  codePanelOf,
  switchCodePanel
};
