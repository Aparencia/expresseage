// handlers/order/cancel.js · order.cancel：顾客/兼职/admin 取消（非终态）
// 顾客取消条件（EXCEPTION 仅当 exception.fromStatus ∈ {SUBMITTED,ACCEPTED}）由 shared/order-state.canCustomerCancel 判定；
// admin 仅异常介入：原因必填 + 审计 ORDER_ANOMALY_CANCEL（与订单事件同事务，幂等键 adminOpenid:clientRequestId）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const { errors } = require('../../lib/errors');
const common = require('./_common');

const ADMIN_ALLOWED_REASONS = enums.CANCEL_REASONS[enums.CANCELLED_BY.CUSTOMER]
  .map((item) => item.code)
  .concat(enums.CANCEL_REASONS[enums.CANCELLED_BY.PARTNER].map((item) => item.code));

function validateAdminReason(payload) {
  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  if (ADMIN_ALLOWED_REASONS.indexOf(reason) < 0) {
    throw errors.validation('reason', '请选择取消原因');
  }
  const noteResult = common.passOrThrow(common.validate.validateNote(payload.note));
  if (reason === enums.OTHER_REASON_CODE && noteResult.value === '') {
    throw errors.validation('note', '选择其他原因时请填写备注');
  }
  return { reason, note: noteResult.value };
}

function validateReason(actorRole, payload) {
  if (actorRole === enums.CANCELLED_BY.ADMIN) {
    return validateAdminReason(payload);
  }
  const scene = actorRole === enums.ROLES.CUSTOMER
    ? enums.CANCELLED_BY.CUSTOMER
    : enums.CANCELLED_BY.PARTNER;
  const reasonResult = common.passOrThrow(common.validate.validateCancelReason(payload.reason, scene));
  const noteResult = common.passOrThrow(
    common.validate.validateCancelNote(reasonResult.value, payload.note)
  );
  return { reason: reasonResult.value, note: noteResult.value };
}

async function writeCancelAudit(input) {
  await input.trx.add(COLLECTIONS.ADMIN_AUDIT, {
    adminOpenid: input.scope.actorOpenid,
    developerNo: input.scope.developerNo || 'SYSTEM',
    action: AUDIT_ACTIONS.ORDER_ANOMALY_CANCEL,
    target: { type: 'order', id: input.order.orderNo },
    detail: { reason: input.built.payload.cancelReason, fromStatus: input.fromStatus },
    at: input.nowDate,
    requestKey: input.scope.actorOpenid + ':' + input.clientRequestId
  });
}

module.exports = async function orderCancel(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.cancel',
    guard(input) {
      return validateReason(input.actorRole, input.payload);
    },
    build(input) {
      const noteText = input.checked.note || enums.cancelReasonText(input.checked.reason);
      return {
        set: {
          cancelReason: input.checked.reason,
          cancelledBy: input.actorRole,
          cancelledAt: input.nowDate
        },
        toStatus: enums.ORDER_STATUS.CANCELLED,
        eventType: 'CANCELLED',
        note: noteText,
        payload: { cancelReason: input.checked.reason }
      };
    },
    after(input) {
      if (input.actorRole !== enums.CANCELLED_BY.ADMIN) {
        return null;
      }
      return writeCancelAudit(input);
    }
  });
};
