// handlers/order/markPicked.js · order.markPicked：兼职标记已取件 ACCEPTED → PICKED
// 守卫（v1.0 一单多包裹）：整单每一件都要有取件码，或服务类型为代寄（DROP_OFF，无需取件码）。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const common = require('./_common');

function hasEveryCode(order) {
  const parcels = common.orderParcelsOf(order);
  if (parcels.length === 0) {
    return false;
  }
  return parcels.every((parcel) => typeof (parcel && parcel.pickupCode) === 'string' && parcel.pickupCode !== '');
}

module.exports = async function orderMarkPicked(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.markPicked',
    acceptsBatchActionId: true,
    guard(input) {
      const service = input.order.service || {};
      const dropOff = service.code === enums.DROP_OFF_SERVICE_CODE;
      if (!dropOff && !hasEveryCode(input.order)) {
        throw errors.invalidState('还有包裹没有取件码，请先补录后再标记已取件');
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
