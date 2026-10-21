// handlers/order/confirmDelivery.js · order.confirmDelivery：顾客确认送达 DELIVERED → COMPLETED
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');

module.exports = async function orderConfirmDelivery(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.confirmDelivery',
    build(input) {
      return {
        set: { completedAt: input.nowDate },
        toStatus: enums.ORDER_STATUS.COMPLETED,
        eventType: 'COMPLETED',
        payload: {}
      };
    }
  });
};
