// handlers/order/markDelivered.js · order.markDelivered：兼职标记已送达 PICKED → DELIVERED（备注 ≤100）
// D91：当日已到自动完成时刻（默认 22:30，UTC+8）→ 送达即完成（同一事务再写 COMPLETED + AUTO_COMPLETED），
//      不再等 10 分钟日结批；未到时刻行为不变（DELIVERED，等当天该时刻批次）。
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');
const autoComplete = require('./_auto-complete');

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
    },
    // 送达即完成（D91）：事务内条件更新 orders + 写 AUTO_COMPLETED；到点判据单源 shared/auto-complete。
    after(params) {
      return autoComplete.completeOnDelivery(params);
    }
  });
};
