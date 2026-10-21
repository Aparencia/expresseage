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
      return { reason: reasonResult.value };
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
        note: enums.cancelReasonText(input.checked.reason),
        payload: { reason: input.checked.reason }
      };
    }
  });
};
