// handlers/order/accept.js · order.accept：兼职接单 SUBMITTED → ACCEPTED
// 接单不可撤销（误接单走 order.cancel）；SUSPENDED/CLOSED 由通用引擎统一拦截。
'use strict';

const common = require('./_common');

module.exports = async function orderAccept(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.accept',
    build(input) {
      return {
        set: { acceptedAt: input.nowDate },
        eventType: 'ACCEPTED',
        payload: {}
      };
    }
  });
};
