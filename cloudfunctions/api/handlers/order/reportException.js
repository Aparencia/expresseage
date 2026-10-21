// handlers/order/reportException.js · order.reportException：兼职上报异常（ACCEPTED/PICKED/DELIVERED → EXCEPTION）
// 异常码六值；OTHER 必填说明（≤200）；写 exception.fromStatus 供恢复/顾客取消条件判定。
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');

module.exports = async function orderReportException(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.reportException',
    guard(input) {
      const result = common.passOrThrow(
        common.validate.validateException(input.payload.code, input.payload.text)
      );
      return { code: result.value, text: result.text || '' };
    },
    build(input) {
      const fromStatus = input.order.status;
      return {
        set: {
          exception: {
            code: input.checked.code,
            text: input.checked.text,
            fromStatus,
            by: enums.CANCELLED_BY.PARTNER,
            at: input.nowDate
          }
        },
        toStatus: enums.ORDER_STATUS.EXCEPTION,
        eventType: 'EXCEPTION_REPORTED',
        note: input.checked.text,
        payload: { code: input.checked.code, text: input.checked.text, fromStatus }
      };
    }
  });
};
