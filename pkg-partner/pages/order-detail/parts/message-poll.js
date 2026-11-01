// pkg-partner/pages/order-detail/parts/message-poll.js · 留言轮询终态守卫（纯件，零 wx/零定时器）
// 2026-11-01 P0-3：已完成/已取消订单不再 10s 轮询留言（性能研究 §4.4；顾客端同口径在 pkg-customer/parts/poll-policy）。
'use strict';

const enums = require('../../../../shared/enums');

function isTerminal(order) {
  return !!(order && enums.isTerminalOrderStatus && enums.isTerminalOrderStatus(order.status));
}

module.exports = { isTerminal };
