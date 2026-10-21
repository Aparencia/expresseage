// handlers/bind/release.js · bind.release（顾客主动解绑：原因必填 + note≤100）
// 口径：CONTRACT v0.9 §4.2/§5.1；DATA_MODEL §2.4/§7.4（有进行中订单禁止；RELEASED 保留历史行）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const bindCommon = require('../bind/_common');

const CUSTOMER_RELEASE_REASONS = ['CUSTOMER_INITIATED', 'ADMIN_ACTION'];

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const scope = await identity.assertBusinessRole(ctx, enums.ROLES.CUSTOMER);
  const input = payload && typeof payload === 'object' ? payload : {};
  const checked = validate.validateReleaseReason(input.reason, input.note);
  if (!checked.ok) {
    throw errors.validation(checked.field === 'note' ? 'note' : 'reason', checked.field === 'note' ? '说明不能超过 100 字' : '请选择解绑原因');
  }
  if (CUSTOMER_RELEASE_REASONS.indexOf(checked.value) < 0) {
    throw errors.validation('reason', '请选择解绑原因');
  }
  const binding = await identity.getActiveBinding(ctx, scope.openid);
  if (!binding) {
    return { releasedAt: 0, releaseReason: '', duplicated: true };
  }
  const activeOrder = await identity.hasActiveOrder(ctx, scope.openid, '');
  if (activeOrder) {
    throw errors.invalidState('有进行中的订单，暂不能解绑');
  }
  const nowDate = identity.nowDate(ctx);
  const result = await ctx.dao.transaction(async (trx) => bindCommon.releaseBindingInTx(trx, binding, {
    reason: checked.value,
    note: checked.note,
    releasedBy: enums.CANCELLED_BY.CUSTOMER,
    nowDate
  }));
  return { releasedAt: result.releasedAt.getTime(), releaseReason: result.releaseReason, duplicated: false };
}

module.exports = { handler };
