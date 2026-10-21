// handlers/order/unmarkDelivered.js · order.unmarkDelivered：兼职撤销已送达 DELIVERED → PICKED
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');

module.exports = async function orderUnmarkDelivered(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.unmarkDelivered',
    build(input) {
      return {
        set: { deliveredAt: null, deliveryNote: '' },
        toStatus: enums.ORDER_STATUS.PICKED,
        eventType: 'DELIVERED_REVERTED',
        payload: {
          undoneAction: 'order.unmarkDelivered',
          previousAt: input.order.deliveredAt ? new Date(input.order.deliveredAt) : null
        }
      };
    }
  });
};
