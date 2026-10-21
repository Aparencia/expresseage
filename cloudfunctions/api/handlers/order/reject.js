// handlers/order/reject.js · order.reject：兼职拒单 SUBMITTED → CANCELLED（reason 必填且命中兼职枚举）
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');

module.exports = async function orderReject(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.reject',
    guard(input) {
      const scene = enums.CANCELLED_BY.PARTNER;
      const reasonResult = common.passOrThrow(
        common.validate.validateCancelReason(input.payload.reason, scene)
      );
      // OTHER 必填备注（CONTRACT §8.3 取消原因口径）；与 order.cancel 同一校验，不许静默通过。
      const noteResult = common.passOrThrow(
        common.validate.validateCancelNote(reasonResult.value, input.payload.note)
      );
      return { reason: reasonResult.value, note: noteResult.value };
    },
    build(input) {
      return {
        set: {
          cancelReason: input.checked.reason,
          cancelledBy: enums.CANCELLED_BY.PARTNER,
          cancelledAt: input.nowDate
        },
        toStatus: enums.ORDER_STATUS.CANCELLED,
        eventType: 'REJECTED',
        note: input.checked.note || enums.cancelReasonText(input.checked.reason),
        payload: { reason: input.checked.reason }
      };
    }
  });
};
