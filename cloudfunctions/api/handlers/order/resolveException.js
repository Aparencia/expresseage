// handlers/order/resolveException.js · order.resolveException：异常恢复 EXCEPTION → exception.fromStatus
// fromStatus 仅 ACCEPTED/PICKED/DELIVERED 合法，否则回 ACCEPTED（CONTRACT §5.1）；
// PICKED/DELIVERED 上报的异常恢复后顾客取消条件由 order-state.canCustomerCancel 统一判定。
'use strict';

const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
const { errors } = require('../../lib/errors');
const common = require('./_common');

module.exports = async function orderResolveException(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.resolveException',
    guard(input) {
      const exception = input.order.exception;
      if (!exception || typeof exception !== 'object') {
        throw errors.invalidTransition('订单没有异常记录，无法恢复');
      }
      const textResult = common.passOrThrow(
        common.validate.validateExceptionText(input.payload.text)
      );
      return {
        restoredTo: orderState.resolveExceptionTo(exception),
        text: textResult.value
      };
    },
    build(input) {
      const eventPayload = { restoredTo: input.checked.restoredTo };
      if (input.checked.text) {
        eventPayload.text = input.checked.text;
      }
      return {
        set: { exception: null },
        toStatus: input.checked.restoredTo,
        eventType: 'EXCEPTION_RESOLVED',
        note: input.checked.text,
        payload: eventPayload
      };
    }
  });
};
