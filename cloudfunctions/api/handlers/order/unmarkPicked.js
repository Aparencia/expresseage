// handlers/order/unmarkPicked.js · order.unmarkPicked：兼职撤销已取件 PICKED → ACCEPTED（清 pickedAt）
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');

module.exports = async function orderUnmarkPicked(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.unmarkPicked',
    build(input) {
      const previousAt = input.order.pickedAt || null;
      return {
        set: { pickedAt: null },
        toStatus: enums.ORDER_STATUS.ACCEPTED,
        eventType: 'PICKED_REVERTED',
        payload: { undoneAction: 'order.unmarkPicked', previousAt: previousAt ? new Date(input.order.pickedAt) : null }
      };
    }
  });
};
