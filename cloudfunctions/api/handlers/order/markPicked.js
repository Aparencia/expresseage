// handlers/order/markPicked.js · order.markPicked：兼职标记已取件 ACCEPTED → PICKED
// 守卫：取件码非空，或服务类型为代寄（DROP_OFF，无需取件码）。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const common = require('./_common');

module.exports = async function orderMarkPicked(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.markPicked',
    acceptsBatchActionId: true,
    guard(input) {
      const order = input.order;
      const parcel = order.parcel || {};
      const service = order.service || {};
      const hasCode = typeof parcel.pickupCode === 'string' && parcel.pickupCode !== '';
      if (!hasCode && service.code !== enums.DROP_OFF_SERVICE_CODE) {
        throw errors.invalidState('还没有取件码，请先补录取件码后再标记已取件');
      }
      return {};
    },
    build(input) {
      return {
        set: { pickedAt: input.nowDate },
        toStatus: enums.ORDER_STATUS.PICKED,
        eventType: 'PICKED',
        payload: {}
      };
    }
  });
};
