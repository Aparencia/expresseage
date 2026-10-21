// handlers/partner/unbindCustomer.js · partner.unbindCustomer（兼职解绑顾客：原因必填 + 通知顾客）
// 口径：CONTRACT v0.9 §4.2（兼职只能解绑、不能绑定）；DATA_MODEL §2.4/§7.4（有进行中订单禁止；解绑即失联）、
//       「批 7」②④（bindingId 必须属于当前兼职；进行中单按该 binding.customerId 判定，不是兼职全量）。
'use strict';

const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const bindCommon = require('../bind/_common');
const customer = require('./_customer');

function releasedResult(binding) {
  return {
    releasedAt: customer.msOf(binding.releasedAt),
    releaseReason: binding.releaseReason || '',
    duplicated: true
  };
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const checked = validate.validateReleaseReason(input.reason, input.note);
  if (!checked.ok) {
    const field = checked.field === 'note' ? 'note' : 'reason';
    throw errors.validation(field, field === 'note' ? '说明不能超过 100 字' : '请选择解绑原因');
  }
  const binding = await customer.requireOwnedBinding(ctx, partner, input.bindingId);
  if (binding.status === enums.BINDING_STATUS.RELEASED) {
    return releasedResult(binding);
  }
  // 进行中单守卫：只按该绑定顾客在本兼职名下的非终态单判定（他人进行中单不得误拦本顾客解绑）。
  const activeOrderCount = await customer.countActiveOrders(ctx, partner._id, binding.customerId);
  if (activeOrderCount > 0) {
    throw errors.invalidState('该顾客还有 ' + activeOrderCount + ' 单进行中，完成后才能解绑');
  }
  const nowDate = identity.nowDate(ctx);
  const result = await ctx.dao.transaction(async (trx) => bindCommon.releaseBindingInTx(trx, binding, {
    reason: checked.value,
    note: checked.note,
    releasedBy: enums.CANCELLED_BY.PARTNER,
    nowDate
  }));
  await bindCommon.notifyCustomerReleased(ctx, {
    customerId: binding.customerId,
    partnerOpenid: partner.openid,
    text: '兼职已解除与你的绑定：' + (enums.RELEASE_REASON_TEXT[checked.value] || '已解绑'),
    nowDate
  });
  return {
    releasedAt: result.releasedAt.getTime(),
    releaseReason: result.releaseReason,
    duplicated: false
  };
}

module.exports = { handler };
