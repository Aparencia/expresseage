// handlers/partner/saveCustomerNote.js · partner.saveCustomerNote（兼职私有备注，顾客不可见）
// 口径：CONTRACT v0.9 §5.2（≤100 字）；DATA_MODEL §2.4（bindings.partnerNote，随顾客注销删除）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const binding = await ctx.dao.get(COLLECTIONS.BINDINGS, input.bindingId);
  if (!binding || binding.partnerId !== partner._id || binding.status !== enums.BINDING_STATUS.ACTIVE) {
    throw errors.notFound('绑定关系不存在或已解除');
  }
  const checked = validate.validatePartnerNote(input.partnerNote);
  if (!checked.ok) {
    throw errors.validation('partnerNote', '备注不能超过 100 字');
  }
  if (checked.value !== (binding.partnerNote || '')) {
    await ctx.dao.update(COLLECTIONS.BINDINGS, binding._id, { partnerNote: checked.value, updatedAt: identity.nowDate(ctx) });
  }
  return { partnerNote: checked.value };
}

module.exports = { handler };
