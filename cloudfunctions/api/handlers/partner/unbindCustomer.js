// handlers/partner/unbindCustomer.js · partner.unbindCustomer（兼职解绑顾客：原因必填 + 通知顾客）
// 口径：CONTRACT v0.9 §4.2（兼职只能解绑、不能绑定）；DATA_MODEL §2.4/§7.4（有进行中订单禁止；解绑即失联）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const bindCommon = require('../bind/_common');

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner, scope } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const checked = validate.validateReleaseReason(input.reason, input.note);
  if (!checked.ok) {
    const field = checked.field === 'note' ? 'note' : 'reason';
    throw errors.validation(field, field === 'note' ? '说明不能超过 100 字' : '请选择解绑原因');
  }
  const binding = await ctx.dao.get(COLLECTIONS.BINDINGS, input.bindingId);
  if (!binding || binding.partnerId !== partner._id) {
    throw errors.notFound('绑定关系不存在或不属于你');
  }
  if (binding.status === enums.BINDING_STATUS.RELEASED) {
    return { releasedAt: binding.releasedAt ? new Date(binding.releasedAt).getTime() : 0, releaseReason: binding.releaseReason || '', duplicated: true };
  }
  const activeOrder = await identity.hasActiveOrder(ctx, '', partner.openid);
  if (activeOrder) {
    throw errors.invalidState('该顾客还有进行中的订单，请完成或取消后再解绑');
  }
  const nowDate = identity.nowDate(ctx);
  const result = await ctx.dao.transaction(async (trx) => {
    const released = await bindCommon.releaseBindingInTx(trx, binding, {
      reason: checked.value,
      note: checked.note,
      releasedBy: enums.CANCELLED_BY.PARTNER,
      nowDate
    });
    return released;
  });
  await bindCommon.notifyCustomerReleased(ctx, {
    customerId: binding.customerId,
    partnerOpenid: partner.openid,
    text: '兼职已解除与你的绑定：' + (enums.RELEASE_REASON_TEXT[checked.value] || '已解绑'),
    nowDate
  });
  return { releasedAt: result.releasedAt.getTime(), releaseReason: result.releaseReason, duplicated: false, releaseScope: scope.role };
}

module.exports = { handler };
