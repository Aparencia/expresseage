// handlers/order/markDelivered.js · order.markDelivered：兼职标记已送达 PICKED → DELIVERED（备注 ≤100）
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');

module.exports = async function orderMarkDelivered(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.markDelivered',
    acceptsBatchActionId: true,
    guard(input) {
      const result = common.passOrThrow(
        common.validate.validateDeliveryNote(input.payload.deliveryNote)
      );
      return { deliveryNote: result.value };
    },
    build(input) {
      const eventPayload = {};
      if (input.checked.deliveryNote) {
        eventPayload.deliveryNote = input.checked.deliveryNote;
      }
      return {
        set: { deliveredAt: input.nowDate, deliveryNote: input.checked.deliveryNote },
        toStatus: enums.ORDER_STATUS.DELIVERED,
        eventType: 'DELIVERED',
        note: input.checked.deliveryNote,
        payload: eventPayload
      };
    }
  });
};
